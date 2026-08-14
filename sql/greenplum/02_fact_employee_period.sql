/* ============================================================
   HRBP HUB · Greenplum · 02 — L1: сотрудник × период
   ------------------------------------------------------------
   Единственное место, где написаны определения: кто в списочной
   численности, кто джун, какое увольнение regrettable. Дальше по конвейеру
   этих вопросов больше не возникает — только суммы.

   В BI эта таблица не уходит: в макете нет ни одного экрана со списком
   людей. Она существует ради согласованности знаменателей: численность
   в «% джунов» и в «прогульщиках» обязана быть одним и тем же числом.

   ПРАВИЛО АТРИБУТОВ
     запасы (численность, джуны, отпуска) — разрезы на конец периода;
     потоки (найм, увольнения)            — разрезы на дату события.
   Если у сотрудника разрез сменился внутри периода и он же уволился,
   он даёт две строки: с одной атрибутикой считается запас, с другой поток.
   Ключ таблицы поэтому включает разрезы, а не только сотрудника.

   Источники (подставить свои витрины):
     hr_dwh.headcount_snapshot   численность на конец периода + атрибуты
     hr_dwh.employee_movement    приём/увольнение, причина, regrettable
     hr_dwh.grade                грейд на дату
     hr_dwh.vacation_balance     остаток неотгуленных дней
     hr_dwh.absence              неоправданные отсутствия
   ============================================================ */

create schema if not exists hrbp_core;

drop table if exists hrbp_core.fact_employee_period;
create table hrbp_core.fact_employee_period (
  grain                  text    not null,   -- month | week
  period_start           date    not null,
  period_end             date    not null,
  employee_id            bigint  not null,
  unit_id                text    not null,   -- лист оргструктуры
  /* разрезы численности — те же шесть, что на полке фильтров и в правилах KPI */
  paint                  text    not null,
  it_segment             text    not null,
  stream                 text    not null,
  spec                   text    not null,
  staff_type             text    not null,
  hc_type                text    not null,
  /* запасы на конец периода */
  is_headcount           smallint not null default 0,
  is_junior              smallint not null default 0,
  is_absentee            smallint not null default 0,
  unused_vac_days        numeric(6,1) not null default 0,
  /* потоки за период */
  is_hire                smallint not null default 0,
  is_hire_junior         smallint not null default 0,
  is_hire_region         smallint not null default 0,
  is_exit                smallint not null default 0,
  is_exit_regret         smallint not null default 0,
  is_exit_nonregret      smallint not null default 0,
  is_exit_reason_filled  smallint not null default 0,
  /* когорта испытательного срока: due — у кого ИС закрылся в этом периоде */
  is_probation_due       smallint not null default 0,
  is_probation_passed    smallint not null default 0
)
distributed by (employee_id)
partition by range (period_start)
( start (date '2024-01-01') end (date '2027-01-01') every (interval '1 month') );

/* ---------- Наполнение: месяц ----------
   Пересчитываем только последние N периодов — история не меняется,
   кроме исправлений задним числом (для них есть параметр глубины).
*/
delete from hrbp_core.fact_employee_period
 where grain = 'month'
   and period_start >= date_trunc('month', current_date) - interval '3 month';

insert into hrbp_core.fact_employee_period
with periods as (
  select d::date                                              as period_start,
         (d + interval '1 month' - interval '1 day')::date     as period_end
  from generate_series(date_trunc('month', current_date) - interval '3 month',
                       date_trunc('month', current_date),
                       interval '1 month') d
),
/* запас: кто числится на конец периода и с какими атрибутами */
stock as (
  select p.period_start, p.period_end,
         h.employee_id, h.unit_id,
         h.paint, h.it_segment, h.stream, h.spec, h.staff_type, h.hc_type,
         1                                                          as is_headcount,
         case when g.grade_group in ('Junior','Junior+') then 1 else 0 end as is_junior,
         coalesce(v.unused_days, 0)                                 as unused_vac_days,
         case when a.absence_days > 0 then 1 else 0 end             as is_absentee
  from periods p
  join hr_dwh.headcount_snapshot h
    on h.snapshot_date = p.period_end
  left join hr_dwh.grade g
    on g.employee_id = h.employee_id
   and p.period_end between g.valid_from and g.valid_to
  left join hr_dwh.vacation_balance v
    on v.employee_id = h.employee_id
   and v.balance_date = p.period_end
  left join (
        select employee_id, date_trunc('month', absence_date)::date as m,
               count(*) as absence_days
        from hr_dwh.absence
        where is_unexcused
        group by 1, 2
       ) a
    on a.employee_id = h.employee_id
   and a.m = p.period_start
),
/* поток: события периода с атрибутами на дату события */
flow as (
  select p.period_start, p.period_end,
         m.employee_id, m.unit_id,
         m.paint, m.it_segment, m.stream, m.spec, m.staff_type, m.hc_type,
         max(case when m.event_type = 'hire' then 1 else 0 end)                       as is_hire,
         max(case when m.event_type = 'hire' and m.grade_group in ('Junior','Junior+')
                  then 1 else 0 end)                                                  as is_hire_junior,
         max(case when m.event_type = 'hire'
                   and m.work_city not in ('Москва','Санкт-Петербург')
                  then 1 else 0 end)                                                  as is_hire_region,
         max(case when m.event_type = 'exit' then 1 else 0 end)                       as is_exit,
         max(case when m.event_type = 'exit' and m.is_regrettable      then 1 else 0 end) as is_exit_regret,
         max(case when m.event_type = 'exit' and not m.is_regrettable  then 1 else 0 end) as is_exit_nonregret,
         max(case when m.event_type = 'exit' and m.exit_reason_id is not null
                  then 1 else 0 end)                                                  as is_exit_reason_filled,
         max(case when m.probation_end_date between p.period_start and p.period_end
                  then 1 else 0 end)                                                  as is_probation_due,
         max(case when m.probation_end_date between p.period_start and p.period_end
                   and m.probation_result = 'passed'
                  then 1 else 0 end)                                                  as is_probation_passed
  from periods p
  join hr_dwh.employee_movement m
    on m.event_date between p.period_start and p.period_end
    or m.probation_end_date between p.period_start and p.period_end
  group by 1,2,3,4,5,6,7,8,9,10
)
select 'month'                                       as grain,
       coalesce(s.period_start, f.period_start)       as period_start,
       coalesce(s.period_end,   f.period_end)         as period_end,
       coalesce(s.employee_id,  f.employee_id)        as employee_id,
       coalesce(s.unit_id,      f.unit_id)            as unit_id,
       coalesce(s.paint,        f.paint)              as paint,
       coalesce(s.it_segment,   f.it_segment)         as it_segment,
       coalesce(s.stream,       f.stream)             as stream,
       coalesce(s.spec,         f.spec)               as spec,
       coalesce(s.staff_type,   f.staff_type)         as staff_type,
       coalesce(s.hc_type,      f.hc_type)            as hc_type,
       coalesce(s.is_headcount, 0),
       coalesce(s.is_junior, 0),
       coalesce(s.is_absentee, 0),
       coalesce(s.unused_vac_days, 0),
       coalesce(f.is_hire, 0),
       coalesce(f.is_hire_junior, 0),
       coalesce(f.is_hire_region, 0),
       coalesce(f.is_exit, 0),
       coalesce(f.is_exit_regret, 0),
       coalesce(f.is_exit_nonregret, 0),
       coalesce(f.is_exit_reason_filled, 0),
       coalesce(f.is_probation_due, 0),
       coalesce(f.is_probation_passed, 0)
from stock s
full outer join flow f
  on  f.period_start = s.period_start
  and f.employee_id  = s.employee_id
  and f.unit_id      = s.unit_id
  and f.paint        = s.paint
  and f.it_segment   = s.it_segment
  and f.stream       = s.stream
  and f.spec         = s.spec
  and f.staff_type   = s.staff_type
  and f.hc_type      = s.hc_type;

/* ---------- Наполнение: неделя ----------
   Тот же запрос с другими границами периода: period_start — понедельник,
   period_end — воскресенье, и берём ТОЛЬКО ЗАКРЫТЫЕ недели.
   Недостроенная неделя в ряду читается как обвал метрики, хотя это просто
   ещё не набранные дни, — макет специально её отрезает (data.js, WEEKS).
     where period_end < current_date
*/
