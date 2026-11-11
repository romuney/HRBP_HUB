-- ============================================================================
-- HRBP HUB · отпуска (unused_vac) · этап 0 — проверки источника перед сборкой.
-- Где: GP (параграф gp в Helicopter или любой GP-клиент). Запросы независимые:
-- выделить один и выполнить. Каждый — с подписью «ждали».
-- Источник: prod_v_sse_crossdata.legal_position_vacation (версионная, бизнес-версии).
-- Срез: концы 24 закрытых месяцев + дата данных (= как месяцы в отчёте).
-- Версия на дату d: deleted_flg = 0 и d >= valid_from::date и d < valid_to::date.
-- ============================================================================


-- 1. Обзор таблицы по типам отпуска.
--    Ждали: все 7 типов (MAIN, ADDITIONAL, NORTHERN, …); min_from — не позже чем 24 мес назад;
--    v9999 = 0 (вечная версия — 5999-01-01); not_midnight — сколько версий начинается не в 00:00
--    (если много — граница по дате может отрезать «утренние» версии, обсудим); same_day — версии,
--    которые начались и закончились в один день (в срез по дате они не попадают — это нормально).
select v.vacation_type_code,
       count(*)                                                                         as rows_all,
       sum(case when v.deleted_flg = 0 then 1 else 0 end)                               as rows_live,
       count(distinct v.legal_position_rk)                                              as positions,
       min(v.valid_from_dttm)                                                           as min_from,
       max(v.valid_from_dttm)                                                           as max_from,
       sum(case when v.deleted_flg = 0
                 and v.valid_to_dttm = timestamp '5999-01-01 00:00:00' then 1 else 0 end) as live_current,
       sum(case when v.valid_to_dttm >= timestamp '9999-01-01 00:00:00' then 1 else 0 end) as v9999,
       sum(case when v.valid_from_dttm::time <> time '00:00' then 1 else 0 end)         as not_midnight,
       sum(case when v.deleted_flg = 0
                 and v.valid_from_dttm::date = v.valid_to_dttm::date then 1 else 0 end) as same_day
from prod_v_sse_crossdata.legal_position_vacation v
group by 1
order by 2 desc;


-- 2. Как стыкуются версии одной позиции и типа (граница включительная или нет).
--    Ждали: почти всё — «стык» (to = from следующей) или «последняя»; «пересечение» = 0.
--    Если основная масса — «+1 сек» или «+1 день», значит valid_to включительный: скажи, поправлю условие среза.
select case when q.nxt is null                                 then '1 последняя'
            when q.nxt = q.valid_to_dttm                       then '2 стык: to = from следующей'
            when q.nxt = q.valid_to_dttm + interval '1 second' then '3 стык +1 сек'
            when q.nxt = q.valid_to_dttm + interval '1 day'    then '4 стык +1 день'
            when q.nxt > q.valid_to_dttm                       then '5 дыра'
            else                                                    '6 пересечение'
       end                                                     as kind,
       count(*)                                                as versions,
       min(q.nxt - q.valid_to_dttm)                            as min_gap,
       max(q.nxt - q.valid_to_dttm)                            as max_gap
from (select v.valid_from_dttm, v.valid_to_dttm,
             lead(v.valid_from_dttm) over (partition by v.legal_position_rk, v.vacation_type_code
                                           order by v.valid_from_dttm) as nxt
      from prod_v_sse_crossdata.legal_position_vacation v
      where v.deleted_flg = 0) q
group by 1
order by 1;


-- 3. Дубли на срезах: больше одной версии на (позиция, тип) в одну дату.
--    Ждали: 0 строк. Есть строки — в отчёте остаток задвоится, нужен отбор «последняя версия».
with p as (
    select max(business_dt)::date as data_dt
    from prod_v_emart.mdm_employee_structure_d
    where business_dt >= current_date - 14 and last_day_flg = 1
), d as (
    select (date_trunc('month', p.data_dt) - g * interval '1 month' - interval '1 day')::date as dt
    from p cross join generate_series(0, 23) g
    union
    select data_dt from p
)
select d.dt, count(*) as dup_keys, max(x.n) as max_versions
from (select d.dt, v.legal_position_rk, v.vacation_type_code, count(*) as n
      from prod_v_sse_crossdata.legal_position_vacation v
      join d on d.dt >= v.valid_from_dttm::date and d.dt < v.valid_to_dttm::date
      where v.deleted_flg = 0
      group by 1, 2, 3
      having count(*) > 1) x
join d on d.dt = x.dt
group by 1
order by 1;


-- 4. Значения остатка на срезах (сумма по всем типам на позицию): точность и диапазон.
--    Ждали: neg — единицы (отпуск авансом) или 0; frac3 = 0 (не больше двух знаков после запятой —
--    тогда сотые доли дня хранятся без потерь); max_days — правдоподобный (десятки, не тысячи).
with p as (
    select max(business_dt)::date as data_dt
    from prod_v_emart.mdm_employee_structure_d
    where business_dt >= current_date - 14 and last_day_flg = 1
), d as (
    select (date_trunc('month', p.data_dt) - g * interval '1 month' - interval '1 day')::date as dt
    from p cross join generate_series(0, 23) g
    union
    select data_dt from p
)
select x.dt,
       count(*)                                                                    as positions,
       sum(case when x.days < 0 then 1 else 0 end)                                 as neg,
       sum(case when x.days <> trunc(x.days) then 1 else 0 end)                    as frac,
       sum(case when x.days * 100 <> round(x.days * 100) then 1 else 0 end)        as frac3,
       min(x.days)                                                                 as min_days,
       max(x.days)                                                                 as max_days,
       round(avg(x.days), 2)                                                       as avg_days
from (select d.dt, v.legal_position_rk, sum(v.accum_vacation_day)::numeric as days
      from prod_v_sse_crossdata.legal_position_vacation v
      join d on d.dt >= v.valid_from_dttm::date and d.dt < v.valid_to_dttm::date
      where v.deleted_flg = 0
      group by 1, 2) x
group by 1
order by 1;


-- 5. Главный: численность × отпуска по основной позиции — покрытие и зоны по месяцам.
--    Численность — как в отчёте (параграф 04): юридическая, нанят, не уволен, не уволен в этот день.
--    Зоны: жёлтая 28 ≤ дни < 56, красная ≥ 56; доли — от людей с записью об отпуске.
--    Ждали: pct_cov у «Активной» — близко к 100 % (сколько людей без записи — главный вопрос);
--    доли зон месяц к месяцу меняются плавно (скачок — смотреть версии в этом месяце).
with p as (
    select max(business_dt)::date as data_dt
    from prod_v_emart.mdm_employee_structure_d
    where business_dt >= current_date - 14 and last_day_flg = 1
), d as (
    select (date_trunc('month', p.data_dt) - g * interval '1 month' - interval '1 day')::date as dt
    from p cross join generate_series(0, 23) g
    union
    select data_dt from p
), s as (
    select e.business_dt::date                                                   as dt,
           e.legal_position_rk::text                                             as rk,
           case when lower(trim(e.active_type_nm)) = 'активная'
                then 'Активная' else 'Прочие типы' end                           as hct
    from prod_v_emart.mdm_employee_structure_d e
    where e.business_dt in (select dt from d)
      and coalesce(e.company_hire_dt, e.business_dt) <= e.business_dt
      and (e.company_fire_dt is null or e.company_fire_dt >= e.business_dt)
      and coalesce(e.company_fire_flg, 0) = 0
      and coalesce(e.legal_employee_flg, 0) = 1
), v as (
    select d.dt, v.legal_position_rk::text as rk, sum(v.accum_vacation_day)::numeric as days
    from prod_v_sse_crossdata.legal_position_vacation v
    join d on d.dt >= v.valid_from_dttm::date and d.dt < v.valid_to_dttm::date
    where v.deleted_flg = 0
    group by 1, 2
)
select q.dt, q.hct, q.hc, q.with_vac,
       round(100.0 * q.with_vac / nullif(q.hc, 0), 1)       as pct_cov,
       q.yellow,
       round(100.0 * q.yellow / nullif(q.with_vac, 0), 1)   as pct_yellow,
       q.red,
       round(100.0 * q.red / nullif(q.with_vac, 0), 1)      as pct_red,
       q.avg_days
from (select s.dt, s.hct,
             count(*)                                                          as hc,
             sum(case when v.rk is not null then 1 else 0 end)                 as with_vac,
             sum(case when v.days >= 28 and v.days < 56 then 1 else 0 end)     as yellow,
             sum(case when v.days >= 56 then 1 else 0 end)                     as red,
             round(avg(v.days), 2)                                             as avg_days
      from s
      left join v on v.dt = s.dt and v.rk = s.rk
      group by 1, 2) q
order by 1, 2;


-- 6. Сверка с витриной старого хелика «Накопленные дни отпуска» (prod_v_hrmart.legal_position_accum_vacation)
--    на актуальную версию. Ждали: diff_001 — мало; если много — разобраться, какая из двух «правильная».
select count(*)                                                                   as positions_both,
       sum(case when abs(n.days - o.days) > 0.01 then 1 else 0 end)               as diff_001,
       max(abs(n.days - o.days))                                                  as max_diff,
       sum(n.days)                                                                as sum_new,
       sum(o.days)                                                                as sum_old
from (select v.legal_position_rk::text as rk, sum(v.accum_vacation_day)::numeric as days
      from prod_v_sse_crossdata.legal_position_vacation v
      where v.deleted_flg = 0
        and v.valid_to_dttm = timestamp '5999-01-01 00:00:00'
      group by 1) n
join (select a.legal_position_rk::text as rk,
             (coalesce(a.main_vacation_day_cnt, 0) + coalesce(a.additional_vacation_day_cnt, 0)
              + coalesce(a.northern_vacation_day_cnt, 0) + coalesce(a.disability_vacation_day_cnt, 0)
              + coalesce(a.hazard_vacation_day_cnt, 0) + coalesce(a.chernobyl_vacation_day_cnt, 0)
              + coalesce(a.extended_vacation_day_cnt, 0))::numeric as days
      from prod_v_hrmart.legal_position_accum_vacation a) o
  on o.rk = n.rk;
