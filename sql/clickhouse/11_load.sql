/* ============================================================
   HRBP HUB · ClickHouse · загрузка из Greenplum
   ------------------------------------------------------------
   Данные едут через parquet в объектном хранилище: GP выгружает внешней
   таблицей (gpfdist/PXF/s3), ClickHouse читает функцией s3().
   Прямого коннектора между GP и CH нет, и городить его ради суточной
   выгрузки незачем.

   Главное требование к загрузке — атомарность. Дашборд читают в рабочее
   время, и он не должен ни на секунду увидеть половину витрины.
   Поэтому: льём в staging-таблицу той же структуры, проверяем, затем
   меняем партиции местами одной командой.
   ============================================================ */

/* ---------- 1 · staging ---------- */
create table if not exists hrbp.hub_fact_stage as hrbp.hub_fact;

truncate table hrbp.hub_fact_stage;

insert into hrbp.hub_fact_stage
select *
from s3('https://storage.example/hrbp/hub_fact/dt={{ ds }}/*.parquet',
        '{{ s3_key }}', '{{ s3_secret }}', 'Parquet');

/* ---------- 2 · проверки до публикации ----------
   Дешёвые инварианты, которые ловят почти все ошибки сборки.
   Любое ненулевое значение — стоп-кран пайплайна.
*/
select
    /* строк не убыло больше чем на 10% — обычно значит, что источник
       отдал неполный срез */
    countIf(cnt_new < cnt_old * 0.9)                                   as shrunk_periods,
    /* доля не может быть больше знаменателя */
    (select count() from hrbp.hub_fact_stage
      where is_ratio = 1 and value_den > 0 and value_num > value_den)  as broken_ratio,
    /* знаменатель у доли обязан быть */
    (select count() from hrbp.hub_fact_stage
      where is_ratio = 1 and value_den is null)                        as missing_den,
    /* численность компании должна сойтись с суммой по блокам: каждый лист
       встречается ровно один раз внутри КАЖДОГО уровня развёртки, поэтому
       сумма по уровню 1 обязана равняться сумме по уровню 2 */
    (select count() from (
        select period_start,
               sumIf(value_num, scope_unit_level = 1) as company,
               sumIf(value_num, scope_unit_level = 2) as blocks
        from hrbp.hub_fact_stage
        where grain = 'month' and metric_id = 'headcount'
        group by period_start
        having abs(company - blocks) > 0.5))                           as hierarchy_mismatch
from (
    select period_start,
           count() as cnt_new,
           (select count() from hrbp.hub_fact f
             where f.period_start = s.period_start and f.grain = 'month') as cnt_old
    from hrbp.hub_fact_stage s
    where grain = 'month'
    group by period_start
);

/* ---------- 3 · публикация ----------
   Переносим только пересчитанные партиции. История не трогается —
   её незачем перекладывать каждую ночь.
*/
alter table hrbp.hub_fact
      replace partition ('month', 2026) from hrbp.hub_fact_stage;
alter table hrbp.hub_fact
      replace partition ('week', 2026) from hrbp.hub_fact_stage;

/* ---------- 4 · маленькие таблицы ----------
   База, цели и справочники целиком помещаются в память и перекладываются
   через обмен таблицами: старая версия живёт до последнего момента.
*/
create table if not exists hrbp.kpi_effective_stage as hrbp.kpi_effective;
truncate table hrbp.kpi_effective_stage;
insert into hrbp.kpi_effective_stage
select * from s3('https://storage.example/hrbp/kpi_effective/*.parquet',
                 '{{ s3_key }}', '{{ s3_secret }}', 'Parquet');
exchange tables hrbp.kpi_effective and hrbp.kpi_effective_stage;

/* Цели перекладываются каждые 15 минут, факт — раз в сутки.
   Это не оптимизация, а сценарий: HRBP ставит цель в своём инструменте
   и идёт смотреть, что изменилось в отчёте. Ждать до завтра он не станет. */
