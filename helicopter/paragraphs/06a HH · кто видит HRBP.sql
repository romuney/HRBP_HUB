-- ============================================================================
-- HH · кто видит HRBP → hrbp_hub_hrbp_viewers. Справочный параграф: отчёт и выгрузку не
-- меняет, датасет таблицу не читает. Строится из hrbp_hub_access (параграф 06), то есть
-- по тем же правилам, по которым доступ работает в отчёте.
--
-- Одна строка = связь (HRBP, видящий его данные):
--   HRBP     — логин с ролью hrbp или super (его зона — корни в hrbp_hub_access);
--   видящий  — любой другой логин отчёта, у которого корень зоны стоит на пути корня HRBP
--              (выше или на том же юните): HRBP с более широкой зоной (роль hrbp), супер-HRBP
--              и админы (super / admin видят всю компанию — значит, и любого HRBP).
--   HRBP внутри чужой зоны видит только её часть — такой связи здесь нет.
-- Старший — по должности (10.11): в должности на data_dt есть слово «старший» (любой регистр,
-- «старшая» тоже). Должность — legal_position_nm, пустая — management_position_nm; ищется по rk
-- сотрудника, у админов — по ad_login.
-- Колонки:
--   roots_n / seen_n — корней в зоне HRBP / из них видит видящий; cover — «вся зона» или «часть зоны»;
--   link             — как видит: «супер-HRBP», «админ», «зона выше», «тот же юнит» (корень общий);
--   via_nm           — через какие свои корни видящий видит HRBP (у super / admin — «вся компания»);
--   is_head_flg      — 1, если видящий — руководитель HRBP по структуре на data_dt (есть в его
--                      цепочке lvl1…lvl13_management_head_mdm_employee_rk), иначе 0;
--   hrbp_position_nm, hrbp_senior_flg     — должность HRBP и 1, если он старший;
--   viewer_position_nm, viewer_senior_flg — то же у видящего;
--   senior_login     — кто в связи старший: логин, оба логина через «, » или «—».
-- ============================================================================
drop table if exists hrbp_hub_hrbp_viewers;
create table hrbp_hub_hrbp_viewers as
with j as (                                  -- HRBP: логин, rk, имя, роль
    select a.login, max(a.hrbp_rk) as hrbp_rk, max(a.hrbp_nm) as hrbp_nm, max(a.role) as role
    from hrbp_hub_access a
    where a.role in ('hrbp', 'super')
    group by a.login
),
jr as (
    select distinct a.login, a.root_id
    from hrbp_hub_access a
    where a.role in ('hrbp', 'super')
),
v as (                                       -- видящий: логин и его роль (admin поверх прочих)
    select a.login, max(a.hrbp_rk) as hrbp_rk, max(a.hrbp_nm) as hrbp_nm,
           case when max(case when a.role = 'admin' then 1 else 0 end) = 1 then 'admin'
                when max(case when a.role = 'super' then 1 else 0 end) = 1 then 'super'
                else 'hrbp' end as role
    from hrbp_hub_access a
    group by a.login
),
pair as (                                    -- корень HRBP, который виден через корень видящего
    select jr.login as j_login, va.login as v_login, jr.root_id, va.root_id as via_id,
           case when va.root_id = jr.root_id then 1 else 0 end as is_same
    from jr
    join hrbp_hub_unit u on u.id = jr.root_id
    join (select distinct login, root_id from hrbp_hub_access) va
        on va.root_id = any(u.path) and va.login <> jr.login
),
agg as (
    select p.j_login, p.v_login,
           count(distinct p.root_id) as seen_n,
           count(distinct case when p.is_same = 1 then p.root_id end) as same_n
    from pair p
    group by 1, 2
),
via as (
    select x.j_login, x.v_login, string_agg(x.nm, ', ' order by x.nm) as via_nm
    from (select distinct p.j_login, p.v_login, coalesce(u.nm, p.via_id) as nm
          from pair p
          left join hrbp_hub_unit u on u.id = p.via_id) x
    group by 1, 2
),
emp as (                                     -- сотрудники отчёта на data_dt: должность и цепочка руководителей
    select e.mdm_employee_rk::text as rk,
           lower(trim(e.ad_login::text)) as login,
           coalesce(nullif(trim(e.legal_position_nm::text), ''), nullif(trim(e.management_position_nm::text), '')) as pos_nm,
           array[e.lvl1_management_head_mdm_employee_rk::text,
                 e.lvl2_management_head_mdm_employee_rk::text,
                 e.lvl3_management_head_mdm_employee_rk::text,
                 e.lvl4_management_head_mdm_employee_rk::text,
                 e.lvl5_management_head_mdm_employee_rk::text,
                 e.lvl6_management_head_mdm_employee_rk::text,
                 e.lvl7_management_head_mdm_employee_rk::text,
                 e.lvl8_management_head_mdm_employee_rk::text,
                 e.lvl9_management_head_mdm_employee_rk::text,
                 e.lvl10_management_head_mdm_employee_rk::text,
                 e.lvl11_management_head_mdm_employee_rk::text,
                 e.lvl12_management_head_mdm_employee_rk::text,
                 e.lvl13_management_head_mdm_employee_rk::text] as heads
    from prod_v_emart.mdm_employee_structure_d e
    join hh_param p on e.business_dt = p.data_dt
    where e.mdm_employee_rk::text in (select hrbp_rk from v where hrbp_rk <> '')
       or lower(trim(e.ad_login::text)) in (select login from v)
),
pos as (                                     -- логин → должность: по rk из доступа, иначе по ad_login
    select v.login,
           coalesce(max(er.pos_nm), max(el.pos_nm)) as pos_nm
    from v
    left join emp er on er.rk = v.hrbp_rk and v.hrbp_rk <> ''
    left join emp el on el.login = v.login
    group by v.login
),
t as (
    select j.login                                       as hrbp_login,
           j.hrbp_nm,
           j.role                                        as hrbp_role,
           n.roots_n,
           v.login                                       as viewer_login,
           v.hrbp_nm                                     as viewer_nm,
           v.role                                        as viewer_role,
           g.seen_n,
           case when g.seen_n >= n.roots_n then 'вся зона' else 'часть зоны' end as cover,
           case when v.role = 'admin' then 'админ'
                when v.role = 'super' then 'супер-HRBP'
                when g.same_n > 0     then 'тот же юнит'
                else 'зона выше' end                     as link,
           case when v.role in ('super', 'admin') then 'вся компания' else w.via_nm end as via_nm,
           max(case when v.hrbp_rk <> '' and v.hrbp_rk = any(h.heads) then 1 else 0 end) as is_head_flg,
           max(pj.pos_nm)                                as hrbp_position_nm,
           max(pv.pos_nm)                                as viewer_position_nm,
           p.data_dt
    from agg g
    join j on j.login = g.j_login
    join v on v.login = g.v_login
    join (select login, count(*) as roots_n from jr group by login) n on n.login = j.login
    join via w on w.j_login = g.j_login and w.v_login = g.v_login
    left join emp h on h.rk = j.hrbp_rk
    left join pos pj on pj.login = j.login
    left join pos pv on pv.login = v.login
    cross join hh_param p
    group by j.login, j.hrbp_nm, j.role, n.roots_n, v.login, v.hrbp_nm, v.role, g.seen_n, g.same_n, w.via_nm, p.data_dt
)
select t.hrbp_login, t.hrbp_nm, t.hrbp_role, t.roots_n,
       t.viewer_login, t.viewer_nm, t.viewer_role, t.seen_n,
       t.cover, t.link, t.via_nm, t.is_head_flg,
       t.hrbp_position_nm,
       case when lower(coalesce(t.hrbp_position_nm, '')) like '%старш%' then 1 else 0 end   as hrbp_senior_flg,
       t.viewer_position_nm,
       case when lower(coalesce(t.viewer_position_nm, '')) like '%старш%' then 1 else 0 end as viewer_senior_flg,
       case when lower(coalesce(t.hrbp_position_nm, '')) like '%старш%'
             and lower(coalesce(t.viewer_position_nm, '')) like '%старш%' then t.hrbp_login || ', ' || t.viewer_login
            when lower(coalesce(t.hrbp_position_nm, '')) like '%старш%'   then t.hrbp_login
            when lower(coalesce(t.viewer_position_nm, '')) like '%старш%' then t.viewer_login
            else '—' end                                                                     as senior_login,
       t.data_dt
from t
distributed by (hrbp_login);

-- Сводка: строка на связь «HRBP · видящий», связь и старший — отдельными столбцами (админы — только в таблице).
select hrbp_login, hrbp_nm, hrbp_position_nm                    as "должность HRBP",
       viewer_login, viewer_nm, viewer_position_nm              as "должность видящего",
       link                                                     as "связь",
       senior_login                                             as "старший в связи",
       cover                                                    as "охват",
       case when is_head_flg = 1 then 'да' else 'нет' end       as "руководитель"
from hrbp_hub_hrbp_viewers
where viewer_role <> 'admin'
order by case hrbp_role when 'hrbp' then 0 else 1 end, hrbp_login,
         case viewer_role when 'hrbp' then 0 else 1 end, viewer_login;
