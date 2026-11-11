-- ============================================================================
-- HRBP HUB · накопленный отпуск · этап 0б — неосновные позиции (совместительство).
-- Где: GP. Запросы независимые, выполнять по порядку: если 2-й или 3-й упадёт на имени колонки —
-- пришлите результат 1-го, поправлю имена.
-- Решение владельца (11.11): доли зон — как есть, по основной позиции; отдельно — пометкой у метрики — штатные,
-- у кого сумма накопленных дней по НЕОСНОВНЫМ позициям попала в 28–56 или 56+.
-- Источник позиций сотрудника (инструкция emart): prod_v_emart.legal_position_d — подневные позиции по mdm_employee_rk;
-- имена колонок ниже — предположение, первый запрос их показывает.
-- ============================================================================


-- 1. Какие таблицы позиций есть и какие у них колонки (ищем: ключ сотрудника, ключ позиции, признак основной,
--    дата среза или период действия, даты найма / увольнения на позицию).
select c.table_schema, c.table_name, c.ordinal_position, c.column_name, c.data_type
from information_schema.columns c
where c.table_schema in ('prod_v_emart', 'prod_v_hrmart', 'prod_v_dds')
  and c.table_name like '%legal_position%'
  and c.table_name not like '%vacation%'
order by 1, 2, 3;


-- 2. Неосновные позиции штатных на дату данных: сколько людей с ними, у скольких есть запись об отпуске,
--    и как сумма дней по неосновным позициям ложится в зоны.
--    Ждали: людей с неосновными позициями — единицы процентов штатных; в зонах — десятки–сотни человек.
with p as (
    select max(business_dt)::date as data_dt
    from prod_v_emart.mdm_employee_structure_d
    where business_dt >= current_date - 14 and last_day_flg = 1
), s as (   -- штатные в численности, как в отчёте: основная позиция — из витрины структуры
    select e.mdm_employee_rk, e.legal_position_rk::text as main_rk
    from prod_v_emart.mdm_employee_structure_d e
    cross join p
    where e.business_dt = p.data_dt
      and coalesce(e.company_hire_dt, e.business_dt) <= e.business_dt
      and (e.company_fire_dt is null or e.company_fire_dt >= e.business_dt)
      and coalesce(e.company_fire_flg, 0) = 0
      and coalesce(e.legal_employee_flg, 0) = 1
      and e.employment_relation_type_desc = 'Штатный сотрудник'
), lp as (  -- все позиции этих людей на ту же дату, кроме основной
    select distinct d.mdm_employee_rk, d.legal_position_rk::text as rk
    from prod_v_emart.legal_position_d d
    cross join p
    join s on s.mdm_employee_rk = d.mdm_employee_rk
    where d.business_dt = p.data_dt
      and d.legal_position_rk::text <> s.main_rk
), v as (
    select lp.mdm_employee_rk, sum(x.accum_vacation_day)::numeric as days
    from lp
    cross join p
    join prod_v_sse_crossdata.legal_position_vacation x
      on x.legal_position_rk::text = lp.rk
     and x.valid_from_dttm <= p.data_dt + interval '1 day' - interval '1 second'
     and x.valid_to_dttm   >= p.data_dt + interval '1 day' - interval '1 second'
    where x.deleted_flg = 0
    group by 1
)
select (select count(*) from s)                                              as staff,
       (select count(distinct mdm_employee_rk) from lp)                      as with_secondary,
       (select count(*) from v)                                              as secondary_with_vac,
       (select count(*) from v where days >= 28 and days < 56)               as sec_yellow,
       (select count(*) from v where days >= 56)                             as sec_red,
       (select round(avg(days), 2) from v)                                   as sec_avg_days,
       (select max(days) from v)                                             as sec_max_days;


-- 3. Признак основной позиции в таблице позиций: совпадает ли он с позицией из витрины структуры.
--    Ждали: почти всё — «основная = как в структуре»; иначе скажите — решим, чем считать основную.
with p as (
    select max(business_dt)::date as data_dt
    from prod_v_emart.mdm_employee_structure_d
    where business_dt >= current_date - 14 and last_day_flg = 1
)
select case when d.legal_position_rk::text = e.legal_position_rk::text then 'основная = как в структуре'
            else 'другая позиция сотрудника' end                              as kind,
       d.main_legal_position_flg,
       count(*)                                                               as positions
from prod_v_emart.legal_position_d d
cross join p
join prod_v_emart.mdm_employee_structure_d e
  on e.mdm_employee_rk = d.mdm_employee_rk and e.business_dt = p.data_dt
where d.business_dt = p.data_dt
group by 1, 2
order by 1, 2;
