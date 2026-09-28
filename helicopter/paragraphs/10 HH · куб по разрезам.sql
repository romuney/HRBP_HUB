-- ============================================================================
-- HH · куб по разрезам → hrbp_hub_cube. Ключ строки — путь юнита × 6 разрезов
-- численности; значения — массивы по слотам: m_* 24 месяца, w_* 24 недели
-- (позиция = idx из hrbp_hub_calendar). Проценты не храним — только числитель и
-- знаменатель, поэтому любую строку можно складывать с любой другой.
--
-- ОКНА (меняются здесь и только здесь):
--   rg, nrg (regrettable / non-regrettable увольнения), hcw (Σ численности за окно,
--   знаменатель текучести; средняя = hcw / 12 или / 52) — 12 мес / 52 нед;
--   nr (незаполненные причины) — 3 мес / 13 нед;
--   r3*/r6* (созревшие новички и дожившие) — 3 мес / 13 нед.
--   hc, jun, hire, fire — без окна (запас на конец слота и поток слота).
-- Окно считается на каждой строке куба: сумма окон по строкам = окно суммы.
-- ============================================================================
drop table if exists hh_cube_long;
create table hh_cube_long as
select md5(path_s || '|' || paint || '|' || it || '|' || stream || '|' || spec || '|' || staff || '|' || hct) as kid,
       path_s, paint, it, stream, spec, staff, hct, grain, idx,
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
from hh_evt
group by path_s, paint, it, stream, spec, staff, hct, grain, idx
distributed by (kid);

-- Плотная сетка «ключ × все слоты», иначе окно в строках захватит не те слоты.
drop table if exists hh_cube_win;
create table hh_cube_win as
select x.kid, x.grain, x.idx,
       x.hc,
       x.jun,
       case when x.grain = 'm' then sum(x.rg) over w12 else sum(x.rg) over w52 end as rg,
       case when x.grain = 'm' then sum(x.nrg) over w12 else sum(x.nrg) over w52 end as nrg,
       case when x.grain = 'm' then sum(x.hc) over w12 else sum(x.hc) over w52 end as hcw,
       case when x.grain = 'm' then sum(x.nr) over w3 else sum(x.nr) over w13 end as nr,
       case when x.grain = 'm' then sum(x.r3n) over w3 else sum(x.r3n) over w13 end as r3n,
       case when x.grain = 'm' then sum(x.r3d) over w3 else sum(x.r3d) over w13 end as r3d,
       case when x.grain = 'm' then sum(x.r6n) over w3 else sum(x.r6n) over w13 end as r6n,
       case when x.grain = 'm' then sum(x.r6d) over w3 else sum(x.r6d) over w13 end as r6d,
       case when x.grain = 'm' then sum(x.r3an) over w3 else sum(x.r3an) over w13 end as r3an,
       case when x.grain = 'm' then sum(x.r3ad) over w3 else sum(x.r3ad) over w13 end as r3ad,
       case when x.grain = 'm' then sum(x.r6an) over w3 else sum(x.r6an) over w13 end as r6an,
       case when x.grain = 'm' then sum(x.r6ad) over w3 else sum(x.r6ad) over w13 end as r6ad,
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
          from (select distinct kid from hh_cube_long) k
          cross join hh_calendar c) g
    left join hh_cube_long l
        on l.kid = g.kid and l.grain = g.grain and l.idx = g.idx
) x
window w12 as (partition by x.kid, x.grain order by x.idx rows between 11 preceding and current row),
       w52 as (partition by x.kid, x.grain order by x.idx rows between 51 preceding and current row),
       w3 as (partition by x.kid, x.grain order by x.idx rows between 2 preceding and current row),
       w13 as (partition by x.kid, x.grain order by x.idx rows between 12 preceding and current row)
distributed by (kid);

drop table if exists hrbp_hub_cube;
create table hrbp_hub_cube as
select k.path_s,
       string_to_array(k.path_s, '/')                                          as path,
       split_part(k.path_s, '/', array_length(string_to_array(k.path_s, '/'), 1)) as leaf,
       k.paint, k.it, k.stream, k.spec, k.staff, k.hct,
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
       m.fire as m_fire,
       w.hc as w_hc,
       w.jun as w_jun,
       w.rg as w_rg,
       w.nrg as w_nrg,
       w.hcw as w_hcw,
       w.nr as w_nr,
       w.r3n as w_r3n,
       w.r3d as w_r3d,
       w.r6n as w_r6n,
       w.r6d as w_r6d,
       w.r3an as w_r3an,
       w.r3ad as w_r3ad,
       w.r6an as w_r6an,
       w.r6ad as w_r6ad,
       w.hire as w_hire,
       w.fire as w_fire
from (select distinct kid, path_s, paint, it, stream, spec, staff, hct from hh_cube_long) k
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
    from hh_cube_win
    where grain = 'm' and idx >= 0
    group by kid) m
    on m.kid = k.kid
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
    from hh_cube_win
    where grain = 'w' and idx >= 0
    group by kid) w
    on w.kid = k.kid
where m.tot + w.tot > 0
distributed by (path_s);


-- ============================================================================
-- База сравнения → hrbp_hub_base: вся компания по 6 разрезам, БЕЗ пути юнита.
-- Датасет берёт базу отсюда, а не суммой куба: запрос юнита читает только его
-- поддерево (при 100 тыс. сотрудников это разница между «весь куб на каждый
-- клик» и «ветка юнита»). Окна аддитивны — Σ окон по юнитам = окно суммы, —
-- поэтому база собирается из того же hh_cube_win.
-- ============================================================================
drop table if exists hh_base_win;
create table hh_base_win as
select k.paint, k.it, k.stream, k.spec, k.staff, k.hct, w.grain, w.idx,
       sum(w.hc) as hc,
       sum(w.jun) as jun,
       sum(w.rg) as rg,
       sum(w.nrg) as nrg,
       sum(w.hcw) as hcw,
       sum(w.nr) as nr,
       sum(w.r3n) as r3n,
       sum(w.r3d) as r3d,
       sum(w.r6n) as r6n,
       sum(w.r6d) as r6d,
       sum(w.r3an) as r3an,
       sum(w.r3ad) as r3ad,
       sum(w.r6an) as r6an,
       sum(w.r6ad) as r6ad,
       sum(w.hire) as hire,
       sum(w.fire) as fire
from hh_cube_win w
join (select distinct kid, paint, it, stream, spec, staff, hct from hh_cube_long) k
    on k.kid = w.kid
where w.idx >= 0
group by 1, 2, 3, 4, 5, 6, 7, 8
distributed randomly;

drop table if exists hrbp_hub_base;
create table hrbp_hub_base as
select m.paint, m.it, m.stream, m.spec, m.staff, m.hct,
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
       m.fire as m_fire,
       w.hc as w_hc,
       w.jun as w_jun,
       w.rg as w_rg,
       w.nrg as w_nrg,
       w.hcw as w_hcw,
       w.nr as w_nr,
       w.r3n as w_r3n,
       w.r3d as w_r3d,
       w.r6n as w_r6n,
       w.r6d as w_r6d,
       w.r3an as w_r3an,
       w.r3ad as w_r3ad,
       w.r6an as w_r6an,
       w.r6ad as w_r6ad,
       w.hire as w_hire,
       w.fire as w_fire
from (select paint, it, stream, spec, staff, hct,
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
             array_agg(fire::int order by idx) as fire
      from hh_base_win
      where grain = 'm'
      group by 1, 2, 3, 4, 5, 6) m
join (select paint, it, stream, spec, staff, hct,
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
             array_agg(fire::int order by idx) as fire
      from hh_base_win
      where grain = 'w'
      group by 1, 2, 3, 4, 5, 6) w
    using (paint, it, stream, spec, staff, hct)
distributed randomly;
