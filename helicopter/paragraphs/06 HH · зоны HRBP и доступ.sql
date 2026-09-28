-- ============================================================================
-- HH · зоны HRBP и доступ → hrbp_hub_access. Правила — из ноута «Связи и
-- подчинения», срез data_dt:
--   корни HRBP   — юниты, где сидят сотрудники с этим HRBP (tmp_hrbp_roots);
--                  видимость — поддеревья корней;
--   подъём       — если ВСЕ сотрудники поддерева юнита у одного HRBP, корнем
--                  становится сам юнит (зона «Департамент карт», а не шесть его
--                  отделов). Видимые люди от этого не меняются — меняется только то,
--                  какими узлами зона называется и с какого узла открывается отчёт;
--   покрытие     — корень выпадает, если выше по пути стоит другой корень того же HRBP;
--   супер-HRBP   — три условия tmp_super_hrbp: является HRBP; в его цепочке
--                  руководителей нет других HRBP; сидит в юните super_hrbp_unit_rk.
--                  Видит всю компанию («лид эйчар»);
--   администратор — логин из hh_param_admin, видит всю компанию.
-- Одна строка = (логин, корень). Датасет берёт корни по current_username().
-- ============================================================================
drop table if exists hh_hrbp_root;
create table hh_hrbp_root as
select s.hrbp_rk, s.hrbp_login, max(s.hrbp_nm) as hrbp_nm,
       split_part(s.path_s, '/', array_length(string_to_array(s.path_s, '/'), 1)) as root_id
from hh_src s
join hh_param p on s.business_dt = p.data_dt
where s.is_slot_row = 1
  and s.hrbp_rk is not null
  and coalesce(s.hrbp_login, '') <> ''
  and s.path_s <> ''
group by 1, 2, 4
distributed by (hrbp_rk);

-- Узлы, целиком закрытые одним HRBP: все сотрудники поддерева в срезе — у него.
drop table if exists hh_hrbp_full;
create table hh_hrbp_full as
select c.id, c.hrbp_rk
from (
    select x.id, x.hrbp_rk, count(*) as n
    from (select unnest(string_to_array(s.path_s, '/')) as id, s.hrbp_rk
          from hh_src s join hh_param p on s.business_dt = p.data_dt
          where s.is_slot_row = 1 and s.path_s <> '') x
    group by 1, 2
) c
join (
    select x.id, count(*) as n
    from (select unnest(string_to_array(s.path_s, '/')) as id
          from hh_src s join hh_param p on s.business_dt = p.data_dt
          where s.is_slot_row = 1 and s.path_s <> '') x
    group by 1
) t on t.id = c.id and t.n = c.n
where c.hrbp_rk is not null
distributed by (id);

-- Кандидаты в корни: верхние целиком закрытые узлы (родитель уже не закрыт тем же
-- HRBP) + юниты сотрудников, не лежащие ни под одним закрытым узлом этого HRBP.
drop table if exists hh_hrbp_cand;
create table hh_hrbp_cand as
select f.hrbp_rk, f.id as root_id
from hh_hrbp_full f
join hrbp_hub_unit u on u.id = f.id
left join hh_hrbp_full fp on fp.id = u.pid and fp.hrbp_rk = f.hrbp_rk
where fp.id is null
union
select r.hrbp_rk, r.root_id
from hh_hrbp_root r
join hrbp_hub_unit u on u.id = r.root_id
left join (
    select distinct r1.hrbp_rk, r1.root_id
    from hh_hrbp_root r1
    join hrbp_hub_unit u1 on u1.id = r1.root_id
    join hh_hrbp_full f1 on f1.hrbp_rk = r1.hrbp_rk
    where f1.id = any(u1.path)
) cov on cov.hrbp_rk = r.hrbp_rk and cov.root_id = r.root_id
where cov.root_id is null
distributed by (hrbp_rk);

-- Корень, над которым по пути стоит другой корень того же HRBP, — лишний.
drop table if exists hh_hrbp_zone;
create table hh_hrbp_zone as
select c.hrbp_rk, n.hrbp_login, n.hrbp_nm, c.root_id
from hh_hrbp_cand c
join (select hrbp_rk, max(hrbp_login) as hrbp_login, max(hrbp_nm) as hrbp_nm
      from hh_hrbp_root group by 1) n on n.hrbp_rk = c.hrbp_rk
left join (
    select distinct c1.hrbp_rk, c1.root_id
    from hh_hrbp_cand c1
    join hrbp_hub_unit u  on u.id = c1.root_id
    join hh_hrbp_cand c2  on c2.hrbp_rk = c1.hrbp_rk and c2.root_id <> c1.root_id
    where c2.root_id = any(u.path)
) a on a.hrbp_rk = c.hrbp_rk and a.root_id = c.root_id
where a.root_id is null
distributed by (hrbp_rk);

drop table if exists hh_hrbp_super;
create table hh_hrbp_super as
with me as (
    select e.mdm_employee_rk as hrbp_rk,
           e.management_unit_rk::text as unit_rk,
           array[e.lvl1_management_head_mdm_employee_rk,
                   e.lvl2_management_head_mdm_employee_rk,
                   e.lvl3_management_head_mdm_employee_rk,
                   e.lvl4_management_head_mdm_employee_rk,
                   e.lvl5_management_head_mdm_employee_rk,
                   e.lvl6_management_head_mdm_employee_rk,
                   e.lvl7_management_head_mdm_employee_rk,
                   e.lvl8_management_head_mdm_employee_rk,
                   e.lvl9_management_head_mdm_employee_rk,
                   e.lvl10_management_head_mdm_employee_rk,
                   e.lvl11_management_head_mdm_employee_rk,
                   e.lvl12_management_head_mdm_employee_rk,
                   e.lvl13_management_head_mdm_employee_rk] as heads
    from prod_v_emart.mdm_employee_structure_d e
    join hh_param p on e.business_dt = p.data_dt
    where e.mdm_employee_rk in (select hrbp_rk from hh_hrbp_root)
),
above as (
    select distinct m.hrbp_rk
    from me m
    join (select distinct hrbp_rk from hh_hrbp_root) h
        on h.hrbp_rk = any(m.heads) and h.hrbp_rk <> m.hrbp_rk
)
select distinct m.hrbp_rk
from me m
cross join hh_param p
left join above a on a.hrbp_rk = m.hrbp_rk
where a.hrbp_rk is null
  and m.unit_rk = p.super_hrbp_unit_rk
distributed replicated;

-- Корни компании: узлы первого уровня в срезе.
drop table if exists hh_company_root;
create table hh_company_root as
select distinct split_part(s.path_s, '/', 1) as root_id
from hh_src s
join hh_param p on s.business_dt = p.data_dt
where s.is_slot_row = 1 and s.path_s <> ''
distributed replicated;

drop table if exists hrbp_hub_access;
create table hrbp_hub_access as
select z.hrbp_login as login, z.hrbp_rk::text as hrbp_rk, z.hrbp_nm, 'hrbp'::text as role, z.root_id
from hh_hrbp_zone z
where z.hrbp_rk not in (select hrbp_rk from hh_hrbp_super)
union all
select h.hrbp_login, h.hrbp_rk::text, h.hrbp_nm, 'super'::text, c.root_id
from (select hrbp_rk, hrbp_login, max(hrbp_nm) as hrbp_nm
      from hh_hrbp_root
      where hrbp_rk in (select hrbp_rk from hh_hrbp_super)
      group by 1, 2) h
cross join hh_company_root c
union all
select lower(trim(a.login)), ''::text, lower(trim(a.login)), 'admin'::text, c.root_id
from hh_param_admin a
cross join hh_company_root c
distributed by (login);
