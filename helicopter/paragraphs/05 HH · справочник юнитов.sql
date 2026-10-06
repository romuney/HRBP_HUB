-- ============================================================================
-- HH · справочник юнитов → hrbp_hub_unit. Все узлы, которые встречаются в путях
-- строк источника (текущие и исторические): имя и родитель — по самой свежей строке,
-- где узел встречался; is_current — есть в срезе data_dt; hc_now — численность
-- поддерева на data_dt (для выбора юнита); kids_n — сколько у узла дочерних юнитов
-- (выбор юнита показывает каретку, даже когда детей нет в ответе); sub_n — сколько
-- юнитов в поддереве вместе с самим узлом (по нему датасет решает, разрешать ли «все уровни»
-- «Команд»); attr_top — у юнита есть готовая свёртка атрибутов (hrbp_hub_attr_top), здесь 0,
-- ставит параграф «HH · куб атрибутов». rk — исходный
-- mapped rk: по нему заводят цели KPI. lvl — номер уровня из источника: 1 —
-- компания, дальше 3…12 (как в ультраширокой: lvl2 и глубже lvl12 не берутся).
-- Путь — от корня до узла, те же id, что в кубе.
-- ============================================================================
drop table if exists hh_chain;
create table hh_chain as
select t.path_s, t.names_s, t.lvls_s, t.rks_s,
       max(t.business_dt) as last_dt,
       max(t.is_now)      as is_now
from (
    select e.business_dt::date                                             as business_dt,
           case when e.business_dt = p.data_dt then 1 else 0 end            as is_now,
           concat_ws('/',
               substr(md5(nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-')), 1, 12)
           )                                                                as path_s,
           concat_ws(chr(31),
               case when nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl1_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl3_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl4_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl5_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl6_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl7_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl8_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl9_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl10_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl11_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl12_mapped_management_unit_nm::text), ''), '—') end
           )                                                                as names_s,
           concat_ws(',',
               case when nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-') is not null then '1' end,
               case when nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-') is not null then '3' end,
               case when nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-') is not null then '4' end,
               case when nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-') is not null then '5' end,
               case when nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-') is not null then '6' end,
               case when nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-') is not null then '7' end,
               case when nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-') is not null then '8' end,
               case when nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-') is not null then '9' end,
               case when nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-') is not null then '10' end,
               case when nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-') is not null then '11' end,
               case when nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-') is not null then '12' end
           )                                                                as lvls_s,
           concat_ws(',',
               nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-')
           )                                                                as rks_s
    from prod_v_emart.mdm_employee_structure_d e
    join hh_src s
        on s.mdm_employee_rk = e.mdm_employee_rk
       and s.business_dt = e.business_dt
    cross join hh_param p
    where e.business_dt >= (select min(business_dt) from hh_src)
) t
where t.path_s <> ''
group by 1, 2, 3, 4
distributed randomly;

-- Узел на каждой позиции пути: id, rk, имя и уровень — с той же позиции строк.
drop table if exists hh_unit_long;
create table hh_unit_long as
select q.last_dt, q.is_now, q.i,
       (string_to_array(q.path_s, '/'))[q.i]                                as id,
       (string_to_array(q.rks_s, ','))[q.i]                                 as rk,
       (string_to_array(q.names_s, chr(31)))[q.i]                           as nm,
       coalesce(nullif((string_to_array(q.lvls_s, ','))[q.i], ''), '0')::int as lvl,
       case when q.i > 1 then (string_to_array(q.path_s, '/'))[q.i - 1] else '' end as pid,
       array_to_string((string_to_array(q.path_s, '/'))[1:q.i], '/')        as upath
from (
    select c.*, generate_series(1, array_length(string_to_array(c.path_s, '/'), 1)) as i
    from hh_chain c
) q
distributed randomly;

drop table if exists hrbp_hub_unit;
create table hrbp_hub_unit as
with d as (
    select distinct on (id) id, rk, nm, lvl, pid, upath, last_dt
    from hh_unit_long
    where id <> ''
    order by id, last_dt desc, is_now desc
)
select d.id, d.rk, d.nm, d.lvl, d.pid,
       string_to_array(d.upath, '/')            as path,
       coalesce(n.is_current, 0)                as is_current,
       coalesce(h.hc_now, 0)::int               as hc_now,
       coalesce(k.kids_n, 0)::int               as kids_n,
       coalesce(sb.sub_n, 1)::int               as sub_n,
       0                                        as attr_top,
       d.last_dt
from d
left join (select id, max(is_now) as is_current from hh_unit_long group by id) n
    on n.id = d.id
left join (
    select x.id, count(*) as hc_now
    from (select unnest(string_to_array(s.path_s, '/')) as id
          from hh_src s
          join hh_param p on s.business_dt = p.data_dt
          where s.is_slot_row = 1 and s.hc = 1 and s.path_s <> '') x
    group by x.id
) h on h.id = d.id
left join (select pid, count(*) as kids_n from d where pid <> '' group by pid) k
    on k.pid = d.id
left join (
    select x.id, count(*) as sub_n
    from (select unnest(string_to_array(upath, '/')) as id from d) x
    group by x.id
) sb on sb.id = d.id
distributed by (id);
