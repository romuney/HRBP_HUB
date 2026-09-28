-- ============================================================================
-- HH · когорты найма → hh_cohort. Закрепляемость новичков (business-context § 2.7):
-- сколько новичков продолжает работать в компании через 3 и 6 месяцев от найма.
--   база 'c' — от company_hire_dt (по умолчанию);
--   база 'a' — от active_hire_dt: отчёт берёт её, когда в фильтре «Тип численности»
--             выбрана ровно «Активная» (hh_param.active_type_value).
-- Новичок — одно трудоустройство (повторный найм — новая когорта). Юнит и разрезы —
-- на дату найма. fire_dt — увольнение ЭТОГО трудоустройства (по company_hire_dt
-- из hh_fire); пусто = работает. Созревание и «дожил ли» — в «HH · события по слотам».
-- ============================================================================
drop table if exists hh_cohort;
create table hh_cohort as
select 'c'::text as base, s.mdm_employee_rk, s.company_hire_dt as hire_dt, f.fire_dt,
       s.path_s, s.paint, s.it, s.stream, s.spec, s.staff, s.hct,
       s.seniority, s.a_grade, s.a_exp, s.a_gender, s.a_age, s.a_office, s.a_work, s.a_head,
       s.a_legal, s.a_macro, s.a_city
from hh_src s
left join (select mdm_employee_rk, company_hire_dt, min(fire_dt) as fire_dt
           from hh_fire group by 1, 2) f
    on f.mdm_employee_rk = s.mdm_employee_rk and f.company_hire_dt = s.company_hire_dt
where s.is_hire_row = 1 and s.path_s <> ''
union all
select 'a'::text, s.mdm_employee_rk, s.active_hire_dt, f.fire_dt,
       s.path_s, s.paint, s.it, s.stream, s.spec, s.staff, s.hct,
       s.seniority, s.a_grade, s.a_exp, s.a_gender, s.a_age, s.a_office, s.a_work, s.a_head,
       s.a_legal, s.a_macro, s.a_city
from hh_src s
left join (select mdm_employee_rk, company_hire_dt, min(fire_dt) as fire_dt
           from hh_fire group by 1, 2) f
    on f.mdm_employee_rk = s.mdm_employee_rk and f.company_hire_dt = s.company_hire_dt
where s.is_ahire_row = 1 and s.path_s <> ''
distributed by (mdm_employee_rk);
