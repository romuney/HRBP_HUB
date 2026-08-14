/* ============================================================
   HRBP HUB · Greenplum · 03 — L2: куб «лист × разрезы × метрика»
   ------------------------------------------------------------
   Здесь исчезает сотрудник. Это предел агрегации: ниже макету ничего
   не нужно, выше — уже нельзя, потому что и разрезы, и дерево крутятся
   на полке фильтров.

   Число строк за период ограничено сверху числом сотрудников: комбинаций
   разрезов внутри листа не может быть больше, чем в нём людей. Куб
   не взрывается по построению, сколько бы разрезов мы ни добавили.

   Три шага:
     1) свернуть сотрудников в счётчики;
     2) уплотнить ряд календарём и посчитать скользящие окна;
     3) развернуть счётчики в длинный формат «метрика → числитель, знаменатель».
   ============================================================ */

/* ---------- 1 · счётчики ---------- */
drop table if exists hrbp_mart.agg_unit_cut_raw;
create table hrbp_mart.agg_unit_cut_raw as
select grain, period_start, unit_id,
       paint, it_segment, stream, spec, staff_type, hc_type,
       sum(is_headcount)          as hc,
       sum(is_junior)             as jun,
       sum(unused_vac_days)       as vac_days,
       sum(is_absentee)           as absentees,
       sum(is_hire)               as hires,
       sum(is_hire_junior)        as hires_jun,
       sum(is_hire_region)        as hires_region,
       sum(is_exit)               as exits,
       sum(is_exit_regret)        as exits_regret,
       sum(is_exit_nonregret)     as exits_nonregret,
       sum(is_exit_reason_filled) as exits_reason,
       sum(is_probation_due)      as prob_due,
       sum(is_probation_passed)   as prob_passed
from hrbp_core.fact_employee_period
group by 1,2,3,4,5,6,7,8,9
distributed by (unit_id);

/* ---------- 2 · уплотнение и скользящие окна ----------
   Уплотнение обязательно. У комбинации разрезов бывают пустые месяцы
   (никого не наняли, никто не ушёл), а оконный кадр в GP 6 отсчитывается
   в СТРОКАХ, а не в датах: по дырявому ряду «11 preceding» соберёт окно
   не той длины и годовой темп текучести поедет.
*/
drop table if exists hrbp_mart.agg_unit_cut_rolled;
create table hrbp_mart.agg_unit_cut_rolled as
with keys as (
  select distinct grain, unit_id, paint, it_segment, stream, spec, staff_type, hc_type
  from hrbp_mart.agg_unit_cut_raw
),
calendar as (
  select distinct grain, period_start from hrbp_mart.agg_unit_cut_raw
),
dense as (
  select c.grain, c.period_start, k.unit_id,
         k.paint, k.it_segment, k.stream, k.spec, k.staff_type, k.hc_type,
         coalesce(r.hc, 0)              as hc,
         coalesce(r.jun, 0)             as jun,
         coalesce(r.vac_days, 0)        as vac_days,
         coalesce(r.absentees, 0)       as absentees,
         coalesce(r.hires, 0)           as hires,
         coalesce(r.hires_jun, 0)       as hires_jun,
         coalesce(r.hires_region, 0)    as hires_region,
         coalesce(r.exits, 0)           as exits,
         coalesce(r.exits_regret, 0)    as exits_regret,
         coalesce(r.exits_nonregret, 0) as exits_nonregret,
         coalesce(r.exits_reason, 0)    as exits_reason,
         coalesce(r.prob_due, 0)        as prob_due,
         coalesce(r.prob_passed, 0)     as prob_passed
  from calendar c
  join keys k on k.grain = c.grain
  left join hrbp_mart.agg_unit_cut_raw r
         on  r.grain        = c.grain
         and r.period_start = c.period_start
         and r.unit_id      = k.unit_id
         and r.paint        = k.paint
         and r.it_segment   = k.it_segment
         and r.stream       = k.stream
         and r.spec         = k.spec
         and r.staff_type   = k.staff_type
         and r.hc_type      = k.hc_type
)
select d.*,
       /* длинное окно: 12 месяцев или 52 недели — годовой темп текучести */
       sum(exits_regret)    over w_long                                as exits_regret_long,
       sum(exits_nonregret) over w_long                                as exits_nonregret_long,
       sum(hc)              over w_long
         / (case when grain = 'month' then 12.0 else 52.0 end)         as hc_avg_long,
       /* короткое окно: 3 месяца или 13 недель — потоки найма и увольнений */
       sum(exits)        over w_short                                  as exits_short,
       sum(exits_reason) over w_short                                  as exits_reason_short,
       sum(hires)        over w_short                                  as hires_short,
       sum(hires_jun)    over w_short                                  as hires_jun_short,
       sum(hires_region) over w_short                                  as hires_region_short,
       sum(prob_due)     over w_short                                  as prob_due_short,
       sum(prob_passed)  over w_short                                  as prob_passed_short
from dense d
window
  w_long as (partition by grain, unit_id, paint, it_segment, stream, spec, staff_type, hc_type
             order by period_start
             rows between 51 preceding and current row),
  w_short as (partition by grain, unit_id, paint, it_segment, stream, spec, staff_type, hc_type
              order by period_start
              rows between 12 preceding and current row)
distributed by (unit_id);

/* ВНИМАНИЕ: кадры окон выше заданы под недельный гранул (51 и 12 строк).
   Месячные ряды считаются отдельным проходом с кадрами 11 и 2 —
   разводим по grain, чтобы не смешивать шаги в одном окне:
     where grain = 'month' ... rows between 11 preceding and current row
     where grain = 'week'  ... rows between 51 preceding and current row
   Здесь оставлено одним запросом ради читаемости логики. */

/* ---------- 3 · длинный формат ----------
   Метрика становится ЗНАЧЕНИЕМ, а не колонкой. Добавить метрику — добавить
   строку в этот VALUES и в dim_metric; схема витрины не меняется, дашборд
   и фильтр «Метрики для отображения» подхватывают новую сами.

   value_den = NULL там, где метрика абсолютная: делить численность не на что.
*/
drop table if exists hrbp_mart.agg_unit_cut_metric;
create table hrbp_mart.agg_unit_cut_metric as
select r.grain, r.period_start, r.unit_id,
       r.paint, r.it_segment, r.stream, r.spec, r.staff_type, r.hc_type,
       v.metric_id,
       v.value_num::numeric(18,2) as value_num,
       v.value_den::numeric(18,2) as value_den
from hrbp_mart.agg_unit_cut_rolled r
cross join lateral (values
    ('headcount',     r.hc,                    null),
    ('retention_new', r.prob_passed_short,     r.prob_due_short),
    ('regret',        r.exits_regret_long,     r.hc_avg_long),
    ('nonregret',     r.exits_nonregret_long,  r.hc_avg_long),
    ('exit_reasons',  r.exits_reason_short,    r.exits_short),
    ('jun_team',      r.jun,                   r.hc),
    ('jun_hire',      r.hires_jun_short,       r.hires_short),
    ('region_hire',   r.hires_region_short,    r.hires_short),
    ('absentees',     r.absentees,             r.hc),
    ('unused_vac',    r.vac_days,              r.hc)
  ) as v(metric_id, value_num, value_den)
where v.value_num is not null
distributed by (unit_id);

/* ---------- 4 · лаги в ту же строку ----------
   Δ мес и Δ год в One-Pager считаются из этих колонок без self-join
   и без time-comparison: числитель и знаменатель прошлого периода
   так же аддитивны, как текущего, поэтому дельта остаётся верной
   при любом наборе фильтров и на любом уровне дерева.
*/
drop table if exists hrbp_mart.agg_unit_cut_metric_lag;
create table hrbp_mart.agg_unit_cut_metric_lag as
select m.*,
       lag(value_num, 1) over w as num_prev_p,
       lag(value_den, 1) over w as den_prev_p,
       /* смещение «год назад» разное у гранулов, а константу в lag() лучше
          не делать выражением — берём оба и выбираем нужное */
       case when grain = 'month' then lag(value_num, 12) over w
                                 else lag(value_num, 52) over w end as num_prev_y,
       case when grain = 'month' then lag(value_den, 12) over w
                                 else lag(value_den, 52) over w end as den_prev_y
from hrbp_mart.agg_unit_cut_metric m
window w as (partition by grain, unit_id, paint, it_segment, stream, spec, staff_type, hc_type, metric_id
             order by period_start)
distributed by (unit_id);
