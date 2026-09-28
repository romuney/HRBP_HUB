-- ============================================================================
-- HH · календарь слотов. Окно отчёта фиксировано, поэтому период — не измерение,
-- а ПОЗИЦИЯ в массиве витрины:
--   месяцы: idx 0…11 — прошлый календарный год, 12…23 — текущий (год последнего
--           закрытого месяца); незакрытые слоты текущего года пустые;
--   недели: idx 0…23 — последние 24 закрытые недели пн–вс, 23 — последняя.
-- Отрицательные idx — история для скользящих окон (11 мес под окно 12 мес,
-- 51 неделя под окно 52 нед). В ClickHouse уезжают только idx ≥ 0.
-- ============================================================================
drop table if exists hh_calendar;
create table hh_calendar as
select c.grain, c.idx, c.slot_start, c.slot_end,
       case when c.slot_end <= p.data_dt then 1 else 0 end as is_closed
from (
    select 'm'::text as grain, i as idx,
           (make_date(extract(year from p.last_month_end)::int - 1, 1, 1) + i * interval '1 month')::date                          as slot_start,
           (make_date(extract(year from p.last_month_end)::int - 1, 1, 1) + (i + 1) * interval '1 month' - interval '1 day')::date as slot_end
    from hh_param p, generate_series(-11, 23) i
    union all
    select 'w'::text, i,
           (p.last_week_end - (23 - i) * 7 - 6)::date,
           (p.last_week_end - (23 - i) * 7)::date
    from hh_param p, generate_series(-51, 23) i
) c
cross join hh_param p
distributed replicated;

drop table if exists hrbp_hub_calendar;
create table hrbp_hub_calendar as
select c.grain, c.idx, c.slot_start, c.slot_end, c.is_closed, p.data_dt
from hh_calendar c
cross join hh_param p
where c.idx >= 0
distributed replicated;

-- Форма окна: по 24 слота на гранул, индексы без дыр. Массивы позиционные —
-- сдвиг на один слот тихо переставил бы весь ряд, поэтому стоп здесь, а не потом.
select 1 / (case when count(*) = 0 then 1 else 0 end) as calendar_shape_check
from (select grain from hrbp_hub_calendar group by grain
      having count(*) <> 24 or min(idx) <> 0 or max(idx) <> 23) t;
