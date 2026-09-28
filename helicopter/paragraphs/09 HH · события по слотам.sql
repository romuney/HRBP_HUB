-- ============================================================================
-- HH · события по слотам → hh_evt. Длинная таблица «вклад строки в компонент
-- метрики в слоте». Всё, что дальше, — суммы по ней.
--   запасы     hc, jun          сотрудник в списочной численности на конец слота
--                               (active_employee_flg = 1); джун — по hh_seniority
--   поток      fire, rg, nrg, nr в слоте дня увольнения
--   найм       hire             в слоте дня найма (база company_hire_dt)
--   когорты    r3d / r3n        новичок созрел (найм + 3 мес / + 13 нед) в этом слоте
--              r6d / r6n        и дожил ли (+ 6 мес / + 26 нед); суффикс a — база
--                               active_hire_dt. Незрелые (срок позже data_dt) — не в счёт.
-- Слоты — с историей окон (idx < 0), окна применяются в следующем параграфе.
-- ============================================================================
drop table if exists hh_evt;
create table hh_evt as
select c.grain, c.idx, s.path_s, s.paint, s.it, s.stream, s.spec, s.staff, s.hct, s.seniority, s.a_grade, s.a_exp, s.a_gender, s.a_age, s.a_office, s.a_work, s.a_head, s.a_legal, s.a_macro, s.a_city,
       1 as hc, coalesce(j.jun, 0) as jun, 0 as fire, 0 as rg, 0 as nrg, 0 as nr, 0 as hire, 0 as r3n, 0 as r3d, 0 as r6n, 0 as r6d, 0 as r3an, 0 as r3ad, 0 as r6an, 0 as r6ad
from hh_src s
join hh_calendar c on c.slot_end = s.business_dt
left join hh_seniority j on j.seniority = s.seniority
where s.is_slot_row = 1 and s.hc = 1 and s.path_s <> ''
union all
select c.grain, c.idx, f.path_s, f.paint, f.it, f.stream, f.spec, f.staff, f.hct, f.seniority, f.a_grade, f.a_exp, f.a_gender, f.a_age, f.a_office, f.a_work, f.a_head, f.a_legal, f.a_macro, f.a_city,
       0 as hc, 0 as jun, 1 as fire, f.rg as rg, f.nrg as nrg, f.nr as nr, 0 as hire, 0 as r3n, 0 as r3d, 0 as r6n, 0 as r6d, 0 as r3an, 0 as r3ad, 0 as r6an, 0 as r6ad
from hh_fire f
join hh_calendar c on f.fire_dt between c.slot_start and c.slot_end
union all
select c.grain, c.idx, h.path_s, h.paint, h.it, h.stream, h.spec, h.staff, h.hct, h.seniority, h.a_grade, h.a_exp, h.a_gender, h.a_age, h.a_office, h.a_work, h.a_head, h.a_legal, h.a_macro, h.a_city,
       0 as hc, 0 as jun, 0 as fire, 0 as rg, 0 as nrg, 0 as nr, 1 as hire, 0 as r3n, 0 as r3d, 0 as r6n, 0 as r6d, 0 as r3an, 0 as r3ad, 0 as r6an, 0 as r6ad
from hh_cohort h
join hh_calendar c on h.hire_dt between c.slot_start and c.slot_end
where h.base = 'c'
union all
select c.grain, c.idx, h.path_s, h.paint, h.it, h.stream, h.spec, h.staff, h.hct, h.seniority, h.a_grade, h.a_exp, h.a_gender, h.a_age, h.a_office, h.a_work, h.a_head, h.a_legal, h.a_macro, h.a_city,
       0 as hc, 0 as jun, 0 as fire, 0 as rg, 0 as nrg, 0 as nr, 0 as hire, case when h.base = 'c' and h.hz = 3 and h.ret = 1 then 1 else 0 end as r3n, case when h.base = 'c' and h.hz = 3 then 1 else 0 end as r3d, case when h.base = 'c' and h.hz = 6 and h.ret = 1 then 1 else 0 end as r6n, case when h.base = 'c' and h.hz = 6 then 1 else 0 end as r6d, case when h.base = 'a' and h.hz = 3 and h.ret = 1 then 1 else 0 end as r3an, case when h.base = 'a' and h.hz = 3 then 1 else 0 end as r3ad, case when h.base = 'a' and h.hz = 6 and h.ret = 1 then 1 else 0 end as r6an, case when h.base = 'a' and h.hz = 6 then 1 else 0 end as r6ad
from (
    select q.*,
           case when q.fire_dt is null or q.fire_dt >= q.md then 1 else 0 end as ret
    from (
        select h.*, z.grain as zgrain, z.hz,
               (case when z.mons is not null then h.hire_dt + z.mons * interval '1 month'
                     else h.hire_dt + z.dys * interval '1 day' end)::date as md
        from hh_cohort h
        cross join (values ('m'::text, 3, 3, null::int), ('m'::text, 6, 6, null::int),
                           ('w'::text, 3, null::int, 91), ('w'::text, 6, null::int, 182)) z(grain, hz, mons, dys)
    ) q
) h
join hh_calendar c on c.grain = h.zgrain and h.md between c.slot_start and c.slot_end
cross join hh_param p
where h.md <= p.data_dt
distributed by (path_s);

analyze hh_evt;
