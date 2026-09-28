-- ============================================================================
-- HH · проверки. Стоп-проверки падают делением на ноль (как «Проверка на дубли»
-- в ультраширокой) — до выгрузки в ClickHouse, чтобы отчёт не получил битые
-- массивы. Последние два запроса — диагностика, ничего не роняют: их результат
-- стоит глянуть после первого запуска.
-- ============================================================================

-- 1. Дубли источника на днях, которые читает ноут: одна строка на (сотрудник, день).
select 1 / (case when count(*) > 0 then 0 else 1 end) as source_duplicates_check
from (
    select e.mdm_employee_rk, e.business_dt
    from prod_v_emart.mdm_employee_structure_d e
    join (select distinct c.slot_end as d from hh_calendar c cross join hh_param p where c.slot_end <= p.data_dt) sd
        on sd.d = e.business_dt
    group by 1, 2
    having count(*) > 1
) t;

-- 2. Короткие id узлов уникальны (первые 12 знаков md5 от rk).
select 1 / (case when count(distinct rk) = count(distinct id) and count(*) = count(distinct id) then 1 else 0 end) as unit_id_check
from hrbp_hub_unit;

-- 3. Все массивы куба — ровно 24 позиции.
select 1 / (case when count(*) > 0 then 0 else 1 end) as cube_array_length_check
from hrbp_hub_cube
where array_length(m_hc, 1) <> 24 or array_length(w_hc, 1) <> 24
   or array_length(m_hcw, 1) <> 24 or array_length(w_r6ad, 1) <> 24;
select 1 / (case when count(*) > 0 then 0 else 1 end) as attr_array_length_check
from hrbp_hub_attr
where array_length(m_hc, 1) <> 24 or array_length(m_r6ad, 1) <> 24;

-- 4. Куб сходится с источником: численность на конец последнего закрытого месяца.
select 1 / (case when c.hc = s.hc then 1 else 0 end) as cube_headcount_check, c.hc as cube_hc, s.hc as source_hc
from (
    select sum(k.m_hc[l.pos]) as hc
    from hrbp_hub_cube k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) c
cross join (
    select count(*) as hc
    from hh_src s join hh_param p on s.business_dt = p.last_month_end
    where s.is_slot_row = 1 and s.hc = 1 and s.path_s <> ''
) s;

-- 4б. База сходится с кубом: вся компания без пути = сумма куба (месяцы и недели,
--     численность и знаменатель текучести) и массивы по 24 позиции.
select 1 / (case when b.m_hc = c.m_hc and b.w_hc = c.w_hc and b.m_hcw = c.m_hcw and b.bad = 0 then 1 else 0 end) as base_equals_cube_check,
       b.m_hc as base_hc, c.m_hc as cube_hc
from (
    select sum(k.m_hc[l.pos]) as m_hc, sum(k.w_hc[24]) as w_hc, sum(k.m_hcw[l.pos]) as m_hcw,
           sum(case when array_length(k.m_hc, 1) <> 24 or array_length(k.w_r6ad, 1) <> 24 then 1 else 0 end) as bad
    from hrbp_hub_base k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) b
cross join (
    select sum(k.m_hc[l.pos]) as m_hc, sum(k.w_hc[24]) as w_hc, sum(k.m_hcw[l.pos]) as m_hcw
    from hrbp_hub_cube k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) c;

-- 4в. Глубина пути: компания + не больше 10 уровней (lvl3…lvl12).
select 1 / (case when max(array_length(path, 1)) <= 11 then 1 else 0 end) as path_depth_check,
       max(array_length(path, 1)) as max_path_len
from hrbp_hub_cube;

-- 5. Каждый узел из путей куба есть в справочнике.
select 1 / (case when count(*) > 0 then 0 else 1 end) as cube_units_in_dictionary_check
from (select distinct unnest(path) as id from hrbp_hub_cube) x
left join hrbp_hub_unit u on u.id = x.id
where u.id is null;

-- 6. Доступ не пуст: хотя бы один HRBP с зоной.
select 1 / (case when count(*) > 0 then 1 else 0 end) as access_not_empty_check
from hrbp_hub_access where role in ('hrbp', 'super');

-- Диагностика: строки без юнита (в отчёт не попадают), увольнения без разметки
-- regrettable, незаполненные причины; правила KPI, не попавшие в отчёт.
select (select count(*) from hh_src where path_s = '')                     as rows_without_unit,
       (select count(*) from hh_fire)                                        as fires,
       (select count(*) from hh_fire where rg = 0 and nrg = 0)               as fires_without_regret_marking,
       (select count(*) from hh_fire where nr = 1)                           as fires_without_reason,
       (select count(*) from hrbp_hub_cube)                                  as cube_rows,
       (select count(*) from hrbp_hub_attr)                                  as attr_rows,
       (select count(*) from hrbp_hub_base)                                  as base_rows,
       (select count(*) from hrbp_hub_unit where is_current = 1)             as units_now,
       (select count(distinct login) from hrbp_hub_access)                   as logins;
select r.rule_id, r.unit_rk, r.metric_id,
       case when u.id is null then 'нет такого юнита' else 'неизвестная метрика или пустая цель' end as problem
from hh_kpi_src r
left join hrbp_hub_unit u on u.rk = trim(r.unit_rk)
where u.id is null
   or trim(r.metric_id) not in ('retention_new_3', 'retention_new_6', 'regret', 'exit_reasons', 'jun_team')
   or r.target is null;
