-- ============================================================================
-- HH · справочник юнитов → hrbp_hub_unit. Все узлы, которые встречаются в путях
-- строк источника (текущие и исторические): имя и родитель — по самой свежей строке,
-- где узел встречался; is_current — есть в срезе data_dt; hc_now — численность
-- поддерева на data_dt (для выбора юнита). rk — исходный mapped rk: по нему
-- заводят цели KPI. Путь — от корня до узла, те же id, что в кубе.
-- ============================================================================
drop table if exists hh_chain;
create table hh_chain as
select t.chain_ids, t.names_s, t.lvls_s, t.rks_s, t.leaf_id, t.leaf_rk, t.leaf_nm, t.leaf_lvl,
       max(t.business_dt) as last_dt,
       max(t.is_now)      as is_now
from (
    select e.business_dt::date                                             as business_dt,
           case when e.business_dt = p.data_dt then 1 else 0 end            as is_now,
           concat_ws('/',
               substr(md5(nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl2_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-')), 1, 12),
               substr(md5(nullif(nullif(trim(e.lvl13_mapped_management_unit_rk::text), ''), '-')), 1, 12)
           )                                                                as chain_ids,
           concat_ws(chr(31),
               case when nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl1_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl2_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl2_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl3_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl4_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl5_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl6_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl7_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl8_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl9_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl10_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl11_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl12_mapped_management_unit_nm::text), ''), '—') end,
               case when nullif(nullif(trim(e.lvl13_mapped_management_unit_rk::text), ''), '-') is not null then coalesce(nullif(trim(e.lvl13_mapped_management_unit_nm::text), ''), '—') end
           )                                                                as names_s,
           concat_ws(',',
               case when nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-') is not null then '1' end,
               case when nullif(nullif(trim(e.lvl2_mapped_management_unit_rk::text), ''), '-') is not null then '2' end,
               case when nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-') is not null then '3' end,
               case when nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-') is not null then '4' end,
               case when nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-') is not null then '5' end,
               case when nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-') is not null then '6' end,
               case when nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-') is not null then '7' end,
               case when nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-') is not null then '8' end,
               case when nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-') is not null then '9' end,
               case when nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-') is not null then '10' end,
               case when nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-') is not null then '11' end,
               case when nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-') is not null then '12' end,
               case when nullif(nullif(trim(e.lvl13_mapped_management_unit_rk::text), ''), '-') is not null then '13' end
           )                                                                as lvls_s,
           concat_ws(',',
               nullif(nullif(trim(e.lvl1_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl2_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl3_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl4_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl5_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl6_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl7_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl8_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl9_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl10_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl11_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl12_mapped_management_unit_rk::text), ''), '-'),
               nullif(nullif(trim(e.lvl13_mapped_management_unit_rk::text), ''), '-')
           )                                                                as rks_s,
           substr(md5(nullif(nullif(trim(e.mapped_management_unit_rk::text), ''), '-')), 1, 12) as leaf_id,
           nullif(nullif(trim(e.mapped_management_unit_rk::text), ''), '-')  as leaf_rk,
           coalesce(nullif(trim(e.mapped_management_unit_nm::text), ''), '—') as leaf_nm,
           coalesce(e.management_unit_lvl_num::int, 0)                     as leaf_lvl
    from prod_v_emart.mdm_employee_structure_d e
    join hh_src s
        on s.mdm_employee_rk = e.mdm_employee_rk
       and s.business_dt = e.business_dt
    cross join hh_param p
    where e.business_dt >= (select min(business_dt) from hh_src)
) t
group by 1, 2, 3, 4, 5, 6, 7, 8
distributed randomly;

-- Цепочка + лист (если лист не последний в цепочке) — так же, как path_s в hh_src.
drop table if exists hh_unit_long;
create table hh_unit_long as
select q.last_dt, q.is_now, q.i,
       (string_to_array(q.path_s, '/'))[q.i]                                as id,
       (string_to_array(q.rks_all, ','))[q.i]                               as rk,
       (string_to_array(q.names_all, chr(31)))[q.i]                         as nm,
       coalesce(nullif((string_to_array(q.lvls_all, ','))[q.i], ''), '0')::int as lvl,
       case when q.i > 1 then (string_to_array(q.path_s, '/'))[q.i - 1] else '' end as pid,
       array_to_string((string_to_array(q.path_s, '/'))[1:q.i], '/')        as upath
from (
    select c.*, generate_series(1, array_length(string_to_array(c.path_s, '/'), 1)) as i
    from (
        select h.last_dt, h.is_now,
               case when not h.app then h.chain_ids
                    when h.chain_ids = '' then h.leaf_id
                    else h.chain_ids || '/' || h.leaf_id end                  as path_s,
               case when not h.app then h.names_s
                    when h.chain_ids = '' then h.leaf_nm
                    else h.names_s || chr(31) || h.leaf_nm end                as names_all,
               case when not h.app then h.lvls_s
                    when h.chain_ids = '' then h.leaf_lvl::text
                    else h.lvls_s || ',' || h.leaf_lvl::text end              as lvls_all,
               case when not h.app then h.rks_s
                    when h.chain_ids = '' then h.leaf_rk
                    else h.rks_s || ',' || h.leaf_rk end                      as rks_all
        from (
            select x.*,
                   (x.leaf_id is not null
                    and not (x.chain_ids = x.leaf_id or x.chain_ids like '%/' || x.leaf_id)) as app
            from hh_chain x
        ) h
    ) c
    where c.path_s <> ''
) q
distributed randomly;

drop table if exists hrbp_hub_unit;
create table hrbp_hub_unit as
select d.id, d.rk, d.nm, d.lvl, d.pid,
       string_to_array(d.upath, '/')            as path,
       coalesce(n.is_current, 0)                as is_current,
       coalesce(h.hc_now, 0)::int               as hc_now,
       d.last_dt
from (
    select distinct on (id) id, rk, nm, lvl, pid, upath, last_dt
    from hh_unit_long
    where id <> ''
    order by id, last_dt desc, is_now desc
) d
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
distributed by (id);
