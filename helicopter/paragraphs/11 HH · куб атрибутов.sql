-- ============================================================================
-- HH · куб атрибутов → hrbp_hub_attr. Для вкладки «Трансформеры»: та же метрика,
-- разложенная по атрибуту сотрудника, при тех же 6 разрезах и юните. Только месяцы.
-- Атрибут (attr_k → attr_v) берётся на дату строки, как и разрезы:
--   grade — грейд; seniority — старшинство; exp — стаж (experience_group_nm);
--   gender — пол; age — возрастная группа; office — офис; work — тип работы
--   (employee_contract_type_desc); head — руководитель / нет; legal — юрлицо
--   (lvl1_legal_unit_nm); macro — макрорегион; city — город (mdm_employee_residence).
-- Окна — как в «HH · куб по разрезам» (месячные: 12 / 3 / 3).
-- ============================================================================
drop table if exists hh_attr_long;
create table hh_attr_long as
select md5(path_s || '|' || paint || '|' || it || '|' || stream || '|' || spec || '|' || staff || '|' || hct || '|' || attr_k || '|' || attr_v) as kid,
       path_s, paint, it, stream, spec, staff, hct, attr_k, attr_v, idx,
       sum(hc) as hc,
       sum(jun) as jun,
       sum(fire) as fire,
       sum(rg) as rg,
       sum(nrg) as nrg,
       sum(nr) as nr,
       sum(hire) as hire,
       sum(r3n) as r3n,
       sum(r3d) as r3d,
       sum(r6n) as r6n,
       sum(r6d) as r6d,
       sum(r3an) as r3an,
       sum(r3ad) as r3ad,
       sum(r6an) as r6an,
       sum(r6ad) as r6ad
from (
    select e.*, a.attr_k,
           coalesce(case a.attr_k when 'grade' then e.a_grade when 'seniority' then e.seniority when 'exp' then e.a_exp when 'gender' then e.a_gender when 'age' then e.a_age when 'office' then e.a_office when 'work' then e.a_work when 'head' then e.a_head when 'legal' then e.a_legal when 'macro' then e.a_macro when 'city' then e.a_city end, '-') as attr_v
    from hh_evt e
    cross join (values ('grade'), ('seniority'), ('exp'), ('gender'), ('age'), ('office'), ('work'), ('head'), ('legal'), ('macro'), ('city')) a(attr_k)
    where e.grain = 'm'
) t
group by path_s, paint, it, stream, spec, staff, hct, attr_k, attr_v, idx
distributed by (kid);

drop table if exists hh_attr_win;
create table hh_attr_win as
select x.kid, x.grain, x.idx,
       x.hc,
       x.jun,
       sum(x.rg) over w12 as rg,
       sum(x.nrg) over w12 as nrg,
       sum(x.hc) over w12 as hcw,
       sum(x.nr) over w3 as nr,
       sum(x.r3n) over w3 as r3n,
       sum(x.r3d) over w3 as r3d,
       sum(x.r6n) over w3 as r6n,
       sum(x.r6d) over w3 as r6d,
       sum(x.r3an) over w3 as r3an,
       sum(x.r3ad) over w3 as r3ad,
       sum(x.r6an) over w3 as r6an,
       sum(x.r6ad) over w3 as r6ad,
       x.hire,
       x.fire
from (
    select g.kid, g.grain, g.idx,
           coalesce(l.hc, 0) as hc,
                   coalesce(l.jun, 0) as jun,
                   coalesce(l.fire, 0) as fire,
                   coalesce(l.rg, 0) as rg,
                   coalesce(l.nrg, 0) as nrg,
                   coalesce(l.nr, 0) as nr,
                   coalesce(l.hire, 0) as hire,
                   coalesce(l.r3n, 0) as r3n,
                   coalesce(l.r3d, 0) as r3d,
                   coalesce(l.r6n, 0) as r6n,
                   coalesce(l.r6d, 0) as r6d,
                   coalesce(l.r3an, 0) as r3an,
                   coalesce(l.r3ad, 0) as r3ad,
                   coalesce(l.r6an, 0) as r6an,
                   coalesce(l.r6ad, 0) as r6ad
    from (select k.kid, c.grain, c.idx
          from (select distinct kid from hh_attr_long) k
          cross join hh_calendar c
          where c.grain = 'm') g
    left join hh_attr_long l
        on l.kid = g.kid and l.idx = g.idx
) x
window w12 as (partition by x.kid, x.grain order by x.idx rows between 11 preceding and current row),
       w3 as (partition by x.kid, x.grain order by x.idx rows between 2 preceding and current row)
distributed by (kid);

drop table if exists hrbp_hub_attr;
create table hrbp_hub_attr as
select k.path_s,
       string_to_array(k.path_s, '/')                                          as path,
       split_part(k.path_s, '/', array_length(string_to_array(k.path_s, '/'), 1)) as leaf,
       k.paint, k.it, k.stream, k.spec, k.staff, k.hct, k.attr_k, k.attr_v,
       m.hc as m_hc,
       m.jun as m_jun,
       m.rg as m_rg,
       m.nrg as m_nrg,
       m.hcw as m_hcw,
       m.nr as m_nr,
       m.r3n as m_r3n,
       m.r3d as m_r3d,
       m.r6n as m_r6n,
       m.r6d as m_r6d,
       m.r3an as m_r3an,
       m.r3ad as m_r3ad,
       m.r6an as m_r6an,
       m.r6ad as m_r6ad,
       m.hire as m_hire,
       m.fire as m_fire
from (select distinct kid, path_s, paint, it, stream, spec, staff, hct, attr_k, attr_v from hh_attr_long) k
join (select kid,
           array_agg(hc::int order by idx) as hc,
           array_agg(jun::int order by idx) as jun,
           array_agg(rg::int order by idx) as rg,
           array_agg(nrg::int order by idx) as nrg,
           array_agg(hcw::int order by idx) as hcw,
           array_agg(nr::int order by idx) as nr,
           array_agg(r3n::int order by idx) as r3n,
           array_agg(r3d::int order by idx) as r3d,
           array_agg(r6n::int order by idx) as r6n,
           array_agg(r6d::int order by idx) as r6d,
           array_agg(r3an::int order by idx) as r3an,
           array_agg(r3ad::int order by idx) as r3ad,
           array_agg(r6an::int order by idx) as r6an,
           array_agg(r6ad::int order by idx) as r6ad,
           array_agg(hire::int order by idx) as hire,
           array_agg(fire::int order by idx) as fire,
           sum(abs(hc)) + sum(abs(jun)) + sum(abs(rg)) + sum(abs(nrg)) + sum(abs(hcw)) + sum(abs(nr)) + sum(abs(r3n)) + sum(abs(r3d)) + sum(abs(r6n)) + sum(abs(r6d)) + sum(abs(r3an)) + sum(abs(r3ad)) + sum(abs(r6an)) + sum(abs(r6ad)) + sum(abs(hire)) + sum(abs(fire)) as tot
    from hh_attr_win
    where grain = 'm' and idx >= 0
    group by kid) m
    on m.kid = k.kid
where m.tot > 0
distributed by (path_s);
