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
   or array_length(m_hcw, 1) <> 24 or array_length(w_r6ad, 1) <> 24
   or array_length(m_vr, 1) <> 24 or array_length(w_vr, 1) <> 24;
select 1 / (case when count(*) > 0 then 0 else 1 end) as attr_array_length_check
from hrbp_hub_attr
where array_length(m_hc, 1) <> 24 or array_length(m_r6ad, 1) <> 24 or array_length(m_vr, 1) <> 24;
select 1 / (case when count(*) > 0 then 0 else 1 end) as attr_top_array_length_check
from hrbp_hub_attr_top
where array_length(m_hc, 1) <> 24 or array_length(m_r6ad, 1) <> 24 or array_length(m_vr, 1) <> 24;

-- 3б. Свёртка атрибутов = листовой куб: свёртки верхних узлов дерева (pid = '') вместе —
--     это весь куб юридической численности (свёртка — «без разрезов», 13.10); по каждому атрибуту сходятся
--     численность, увольнения и накопленный отпуск (штатные и их остаток, 11.11) за все месяцы.
select 1 / (case when count(*) > 0 then 0 else 1 end) as attr_top_equals_leaf_check
from (
    select coalesce(l.attr_k, t.attr_k) as attr_k
    from (select x.attr_k, sum(x.hc) as hc, sum(x.fire) as fire, sum(x.vacd) as vacd, sum(x.vac) as vac
          from (select attr_k, unnest(m_hc) as hc, unnest(m_fire) as fire, unnest(m_vacd) as vacd, unnest(m_vac) as vac
                from hrbp_hub_attr a cross join hh_param pr where a.hct <> pr.nonlegal_type) x
          group by 1) l
    full join (select x.attr_k, sum(x.hc) as hc, sum(x.fire) as fire, sum(x.vacd) as vacd, sum(x.vac) as vac
               from (select a.attr_k, unnest(a.m_hc) as hc, unnest(a.m_fire) as fire, unnest(a.m_vacd) as vacd, unnest(a.m_vac) as vac
                     from hrbp_hub_attr_top a
                     join hrbp_hub_unit u on u.id = a.unit_id and u.pid = '') x
               group by 1) t
        on t.attr_k = l.attr_k
    where coalesce(l.hc, -1) <> coalesce(t.hc, -1) or coalesce(l.fire, -1) <> coalesce(t.fire, -1)
       or coalesce(l.vacd, -1) <> coalesce(t.vacd, -1) or coalesce(l.vac, -1) <> coalesce(t.vac, -1)
) d;

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

-- 4г. Уволенные без причины (поставка 56) сходятся с метрикой: всей компании с начала года — с прошедшими 30 днями
--     столько же, сколько m_nr базы в последнем месяце, всех (и свежих) — сколько w_nr.
select 1 / (case when p.r = b.r and p.a = b.a then 1 else 0 end) as nr_people_check,
       p.r as people_ripe, b.r as base_nr, p.a as people_all, b.a as base_nr_all
from (select coalesce(sum(ripe), 0) as r, count(*) as a from hrbp_hub_nr_people) p
cross join (
    select coalesce(sum(k.m_nr[l.pos]), 0) as r, coalesce(sum(k.w_nr[l.pos]), 0) as a
    from hrbp_hub_base k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) b;

-- 4д. Накопленный отпуск (11.11) сходится с «HH · отпуска»: на конец последнего месяца штатные в численности (vacd),
--     их остаток в сотых долях дня (vac) и люди в жёлтой / красной зоне (vy / vr) — в кубе, в базе и в hh_vac одно и
--     то же; если метрика ещё не началась (покрытие ниже порога) — везде нули.
select 1 / (case when c.d = s.d and c.v = s.v and c.y = s.y and c.r = s.r
                  and b.d = s.d and b.v = s.v and b.y = s.y and b.r = s.r then 1 else 0 end) as vac_check,
       s.d as src_staff, c.d as cube_staff, s.v as src_vac, c.v as cube_vac, s.y as src_yellow, c.y as cube_yellow,
       s.r as src_red, c.r as cube_red
from (
    select coalesce(sum(k.m_vacd[l.pos]), 0) as d, coalesce(sum(k.m_vac[l.pos]), 0) as v,
           coalesce(sum(k.m_vy[l.pos]), 0) as y, coalesce(sum(k.m_vr[l.pos]), 0) as r
    from hrbp_hub_cube k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) c
cross join (
    select coalesce(sum(k.m_vacd[l.pos]), 0) as d, coalesce(sum(k.m_vac[l.pos]), 0) as v,
           coalesce(sum(k.m_vy[l.pos]), 0) as y, coalesce(sum(k.m_vr[l.pos]), 0) as r
    from hrbp_hub_base k
    cross join (select c.idx + 1 as pos
                from hrbp_hub_calendar c
                join hh_param p on c.grain = 'm' and c.slot_end = p.last_month_end) l
) b
cross join (
    select coalesce(sum(o.ison), 0) as d,
           coalesce(sum(o.ison * round(v.days * 100)), 0) as v,
           coalesce(sum(o.ison * case when v.days >= 28 and v.days < 56 then 1 else 0 end), 0) as y,
           coalesce(sum(o.ison * case when v.days >= 56 then 1 else 0 end), 0) as r
    from hh_vac v
    join hh_param p on v.business_dt = p.last_month_end
    cross join (select case when p.last_month_end >= s.vac_start_dt then 1 else 0 end as ison
                from hh_param p cross join hh_vac_start s) o
) s;

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
   or trim(r.metric_id) not in ('retention_new_3', 'retention_new_6', 'regret', 'exit_reasons', 'jun_team', 'vac_yellow', 'vac_red')
   or r.target is null;

-- Диагностика отпусков (11.11): с какого месяца метрика в отчёте (vac_start_dt; 5999-01-01 — ни один месяц не набрал
-- порог покрытия), покрытие штатных записями об отпуске в последнем месяце и сколько месяцев после начала ниже порога
-- (их отчёт показывает — проверить источник; помесячно — таблица hh_vac_cov).
select s.vac_start_dt,
       (select c.cov from hh_vac_cov c where c.slot_end = p.last_month_end)                          as vac_cov_now,
       p.vac_min_cov,
       (select count(*) from hh_vac_cov c where c.slot_start >= s.vac_start_dt and c.cov < p.vac_min_cov) as vac_low_months
from hh_vac_start s
cross join hh_param p;
