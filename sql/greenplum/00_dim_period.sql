/* ============================================================
   HRBP HUB · Greenplum · 00 — календарь слотов
   ------------------------------------------------------------
   Окно отчёта ФИКСИРОВАНО. Пользователь период не выбирает, поэтому
   и хранить период как измерение незачем: у каждого гранула есть
   ровно 24 позиции, и они одни и те же для всех строк витрины.

   МЕСЯЦЫ — 24 слота, привязанных к календарю:
     0…11  — прошлый календарный год целиком
     12…23 — текущий календарный год, хвост ещё не закрыт
   Такая привязка нужна графику «год к году»: две линии по двенадцать
   точек ложатся на одну ось, и слот i сравнивается со слотом i+12 —
   это тот же месяц год назад. Скользящее окно «12 мес» для спарклайна
   получается срезом последних двенадцати закрытых слотов.

   НЕДЕЛИ — 24 слота:
     0…11  — предыдущие двенадцать недель
     12…23 — последние двенадцать закрытых недель
   Неделя пн–вс, последняя ЗАКРЫТА: недостроенная неделя в ряду
   читается как обвал метрики, хотя это просто ещё не набранные дни.

   Справочник уезжает на фронт (48 строк) — из него подписи осей,
   границы недель и понимание, какой слот последний закрытый.
   ============================================================ */

drop table if exists hrbp_mart.dim_period;
create table hrbp_mart.dim_period as
with anchor as (
  /* последний закрытый месяц и последняя закрытая неделя */
  select (date_trunc('month', current_date) - interval '1 day')::date       as last_month_end,
         (current_date - (extract(isodow from current_date)::int))::date    as last_sunday
),
months as (
  select 'month'::text                                              as grain,
         (row_number() over (order by d))::int - 1                   as slot_idx,
         d::date                                                     as period_start,
         (d + interval '1 month' - interval '1 day')::date           as period_end
  from anchor a,
       generate_series(date_trunc('year', a.last_month_end) - interval '1 year',
                       date_trunc('year', a.last_month_end) + interval '11 month',
                       interval '1 month') d
),
weeks as (
  select 'week'::text                                                as grain,
         (23 - i)::int                                               as slot_idx,
         (a.last_sunday - (i * 7 + 6))::date                         as period_start,
         (a.last_sunday - (i * 7))::date                             as period_end
  from anchor a, generate_series(0, 23) i
)
select p.grain, p.slot_idx, p.period_start, p.period_end,
       (p.period_end <= a.last_month_end or p.grain = 'week')        as is_closed,
       case when p.grain = 'month'
            then extract(year from p.period_start)::int
            else null end                                            as period_year
from (select * from months union all select * from weeks) p
cross join anchor a
distributed replicated;

/* Проверка формы: по 24 слота на гранул, индексы без дыр.
   Массивы витрины позиционные — сдвиг на один слот тихо переставит
   весь ряд, поэтому проверяем до сборки, а не после. */
do $$
declare bad int;
begin
  select count(*) into bad from (
    select grain, count(*) as c, min(slot_idx) as lo, max(slot_idx) as hi
    from hrbp_mart.dim_period group by grain
    having count(*) <> 24 or min(slot_idx) <> 0 or max(slot_idx) <> 23) t;
  if bad > 0 then raise exception 'dim_period: неверная форма окна'; end if;
end $$;
