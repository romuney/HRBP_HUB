/* ============================================================
   HRBP HUB · Greenplum · 01 — оргструктура
   ------------------------------------------------------------
   Три объекта:
     dim_unit          — узлы с путём и уровнем
     dim_unit_closure  — все пары «предок → потомок» + относительные уровни
     dim_hrbp_scope    — какие узлы видит каждый HRBP (фильтр и RLS)

   Путь собирается из unit_id, а не из названий: имена меняются при
   реорганизациях, и путь из имён пришлось бы пересобирать вместе с ними.

   Источник (подставить свой):
     hr_dwh.org_unit(unit_id, parent_unit_id, unit_name, is_current)
   ============================================================ */

create schema if not exists hrbp_mart;

/* ---------- Узлы ---------- */
drop table if exists hrbp_mart.dim_unit;
create table hrbp_mart.dim_unit as
with recursive tree as (
  select u.unit_id,
         u.parent_unit_id,
         u.unit_name,
         1::int                     as unit_level,
         u.unit_id::text            as unit_path,
         u.unit_name::text          as unit_path_name
  from hr_dwh.org_unit u
  where u.parent_unit_id is null
    and u.is_current
  union all
  select c.unit_id,
         c.parent_unit_id,
         c.unit_name,
         t.unit_level + 1,
         t.unit_path || '/' || c.unit_id,
         t.unit_path_name || ' › ' || c.unit_name
  from hr_dwh.org_unit c
  join tree t on t.unit_id = c.parent_unit_id
  where c.is_current
)
select t.unit_id,
       t.parent_unit_id,
       t.unit_name,
       t.unit_level,
       t.unit_path,
       t.unit_path_name,
       not exists (select 1
                     from hr_dwh.org_unit k
                    where k.parent_unit_id = t.unit_id
                      and k.is_current)                as is_leaf
from tree t
distributed by (unit_id);

/* ---------- Замыкание дерева ----------
   Строк здесь немного (узлы × средняя глубина), а платим мы этой таблицей
   за то, что дальше нигде не нужна рекурсия: ни в витрине, ни в BI.

   child_unit_id / grandchild_unit_id — узлы на −1 и −2 от предка ПО ПУТИ
   потомка. Сегмент пути и есть unit_id, поэтому достаточно взять нужный
   элемент массива; если потомок лежит выше этого уровня, берём его самого
   (least) — так строка «лист прямо под юнитом» не теряется.
*/
drop table if exists hrbp_mart.dim_unit_closure;
create table hrbp_mart.dim_unit_closure as
select s.unit_id                                        as scope_unit_id,
       s.unit_name                                      as scope_unit_name,
       s.unit_level                                     as scope_unit_level,
       d.unit_id                                        as unit_id,
       d.unit_level                                     as unit_level,
       d.is_leaf                                        as unit_is_leaf,
       d.unit_level - s.unit_level                      as rel_depth,
       (string_to_array(d.unit_path, '/'))[least(s.unit_level + 1, d.unit_level)] as child_unit_id,
       (string_to_array(d.unit_path, '/'))[least(s.unit_level + 2, d.unit_level)] as grandchild_unit_id
from hrbp_mart.dim_unit s
join hrbp_mart.dim_unit d
  on d.unit_path = s.unit_path
  or d.unit_path like s.unit_path || '/%'
distributed by (unit_id);

create index dim_unit_closure_scope_idx on hrbp_mart.dim_unit_closure (scope_unit_id);

/* ---------- Зоны HRBP ----------
   Зона — поддерево. Senior видит ещё и зоны подчинённых, поэтому берём
   транзитивное замыкание по подчинённости HRBP, а потом разворачиваем
   каждый корень зоны в поддерево узлов.

   Источники:
     hr_dwh.hrbp(hrbp_id, hrbp_login, hrbp_name, role, reports_to)
     hr_dwh.hrbp_scope(hrbp_id, unit_id)   -- корни зон
*/
drop table if exists hrbp_mart.dim_hrbp_scope;
create table hrbp_mart.dim_hrbp_scope as
with recursive chain as (
  /* сам HRBP */
  select h.hrbp_id as hrbp_id, h.hrbp_id as covered_hrbp_id
  from hr_dwh.hrbp h
  union all
  /* и все, кто под ним */
  select c.hrbp_id, s.hrbp_id
  from chain c
  join hr_dwh.hrbp s on s.reports_to = c.covered_hrbp_id
)
select distinct
       h.hrbp_id,
       h.hrbp_login,
       cl.unit_id,
       first_value(sc.unit_id) over (partition by h.hrbp_id, cl.unit_id
                                     order by u.unit_level desc) as zone_root_unit_id
from chain c
join hr_dwh.hrbp h        on h.hrbp_id = c.hrbp_id
join hr_dwh.hrbp_scope sc on sc.hrbp_id = c.covered_hrbp_id
join hrbp_mart.dim_unit_closure cl on cl.scope_unit_id = sc.unit_id
join hrbp_mart.dim_unit u on u.unit_id = sc.unit_id
distributed by (unit_id);

/* HRBP, отвечающий за узел: самая глубокая зона, накрывающая путь.
   Нужен как атрибут строки витрины — по нему работает фильтр «HRBP». */
drop table if exists hrbp_mart.dim_unit_owner;
create table hrbp_mart.dim_unit_owner as
select distinct on (cl.unit_id)
       cl.unit_id,
       sc.hrbp_id      as owner_hrbp_id,
       sc.unit_id      as owner_zone_root_unit_id
from hrbp_mart.dim_unit_closure cl
join hr_dwh.hrbp_scope sc on sc.unit_id = cl.scope_unit_id
join hrbp_mart.dim_unit u on u.unit_id = sc.unit_id
order by cl.unit_id, u.unit_level desc
distributed by (unit_id);
