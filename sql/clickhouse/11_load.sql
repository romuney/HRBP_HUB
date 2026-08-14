/* ============================================================
   HRBP HUB · ClickHouse · загрузка из Greenplum
   ------------------------------------------------------------
   Данные едут через parquet в объектном хранилище: GP выгружает внешней
   таблицей (gpfdist/PXF/s3), ClickHouse читает функцией s3().
   Прямого коннектора между GP и CH нет, и городить его ради суточной
   выгрузки незачем.

   Со свёрткой времени в массивы витрина стала маленькой (единицы
   миллионов строк), поэтому никакой возни с партициями: таблица
   перекладывается целиком обменом. Дашборд не должен ни на секунду
   увидеть половину витрины — обмен атомарен, а частичная замена
   партиций при фиксированном окне ещё и неверна: окно каждый месяц
   сдвигается, и старые слоты меняют смысл.
   ============================================================ */

/* ---------- 1 · staging ---------- */
create table if not exists hrbp.hub_fact_stage as hrbp.hub_fact;
truncate table hrbp.hub_fact_stage;

insert into hrbp.hub_fact_stage
select *
from s3('https://storage.example/hrbp/hub_fact/*.parquet',
        '{{ s3_key }}', '{{ s3_secret }}', 'Parquet');

/* ---------- 2 · проверки до публикации ----------
   Дешёвые инварианты, которые ловят почти все ошибки сборки.
   Любое ненулевое значение — стоп-кран пайплайна.
*/
select
    /* форма массивов: позиционный ряд не прощает недобора элементов.
       CONSTRAINT в DDL уже не даст вставить такую строку, но проверка
       остаётся здесь на случай, если таблицу пересоздадут без него */
    countIf(length(num_m) != 24 or length(den_m) != 24
         or length(num_w) != 24 or length(den_w) != 24)          as bad_array_len,

    /* доля не может быть больше знаменателя ни в одном слоте */
    countIf(is_ratio = 1
            and arrayExists((n, d) -> d > 0 and n > d, num_m, den_m)) as broken_ratio,

    /* строк не убыло больше чем на 10% — обычно значит, что источник
       отдал неполный срез */
    if((select count() from hrbp.hub_fact) > 0
       and count() < (select count() from hrbp.hub_fact) * 0.9, 1, 0) as shrunk,

    /* численность компании должна сойтись с суммой по блокам: каждый
       лист встречается ровно один раз внутри КАЖДОГО уровня развёртки,
       поэтому поэлементные суммы по уровню 1 и по уровню 2 совпадают */
    (select count()
       from (select arrayJoin(arrayMap((x, y) -> abs(x - y),
                      sumForEachIf(num_m, scope_unit_level = 1),
                      sumForEachIf(num_m, scope_unit_level = 2))) as d
             from hrbp.hub_fact_stage
             where metric_id = 'headcount')
      where d > 0.5)                                             as hierarchy_mismatch
from hrbp.hub_fact_stage;

/* ---------- 3 · публикация ---------- */
exchange tables hrbp.hub_fact and hrbp.hub_fact_stage;

/* ---------- 4 · остальные таблицы ----------
   Все маленькие, все перекладываются так же: старая версия живёт
   до последнего момента.
*/
create table if not exists hrbp.hub_bench_stage     as hrbp.hub_bench;
create table if not exists hrbp.kpi_effective_stage as hrbp.kpi_effective;
create table if not exists hrbp.dim_unit_stage      as hrbp.dim_unit;
create table if not exists hrbp.dim_period_stage    as hrbp.dim_period;

truncate table hrbp.hub_bench_stage;
insert into hrbp.hub_bench_stage
select * from s3('https://storage.example/hrbp/hub_bench/*.parquet',
                 '{{ s3_key }}', '{{ s3_secret }}', 'Parquet');
exchange tables hrbp.hub_bench and hrbp.hub_bench_stage;

truncate table hrbp.kpi_effective_stage;
insert into hrbp.kpi_effective_stage
select * from s3('https://storage.example/hrbp/kpi_effective/*.parquet',
                 '{{ s3_key }}', '{{ s3_secret }}', 'Parquet');
exchange tables hrbp.kpi_effective and hrbp.kpi_effective_stage;

/* Цели перекладываются каждые 15 минут, факт — раз в сутки.
   Это не оптимизация, а сценарий: HRBP ставит цель в своём инструменте
   и идёт смотреть, что изменилось в отчёте. Ждать до завтра он не станет.

   ВАЖНО: массив цели строится по тому же календарю слотов, что и факт.
   Если факт пересобрался с новым окном, а цели ещё со старым, линия цели
   уедет на месяц. Поэтому dim_period перекладывается вместе с фактом,
   а сборка целей всегда читает актуальный dim_period из Greenplum. */
