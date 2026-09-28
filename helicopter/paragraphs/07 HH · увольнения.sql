-- ============================================================================
-- HH · увольнения → hh_fire. Событие = строка дня увольнения из компании
-- (business_dt = company_fire_dt); юнит и разрезы — на эту дату.
--   rg / nrg — regrettable / non-regrettable: джойн вспомогательной витрины
--              usr_cross_data.regrettable_n_non_regrettable_base по сотруднику и
--              дате (как в ультраширокой); в базе этих флагов нет;
--   nr       — причина НЕ заполнена: legal_fire_dt не пустая, в
--              legal_position_dismissal_reason (legal_position_rk + fire_dt =
--              legal_fire_dt) нет причины — и с увольнения прошло nr_grace_days.
--              coalesce(dismissal_reason_desc, 'Причина отсутствует') = отсутствует.
-- Дни увольнения берутся с запасом в 7 месяцев до окна: по ним когорты найма
-- узнают, дожил ли новичок до 3 и 6 месяцев.
-- ============================================================================
drop table if exists hh_fire;
create table hh_fire as
select s.mdm_employee_rk, s.company_hire_dt, s.business_dt as fire_dt,
       s.path_s, s.paint, s.it, s.stream, s.spec, s.staff, s.hct,
       s.seniority, s.a_grade, s.a_exp, s.a_gender, s.a_age, s.a_office, s.a_work, s.a_head,
       s.a_legal, s.a_macro, s.a_city,
       coalesce(rt.rg, 0)  as rg,
       coalesce(rt.nrg, 0) as nrg,
       case when s.legal_fire_dt is not null
             and coalesce(fr.has_reason, 0) = 0
             and s.business_dt <= p.data_dt - p.nr_grace_days
            then 1 else 0 end as nr
from hh_src s
cross join hh_param p
left join (
    select mdm_employee_rk, business_dt::date as business_dt,
           max(case when regrettable_fire_flg = 1 then 1 else 0 end)     as rg,
           max(case when non_regrettable_fire_flg = 1 then 1 else 0 end) as nrg
    from usr_cross_data.regrettable_n_non_regrettable_base
    where business_dt >= (select min(slot_start) - interval '7 month' from hh_calendar)
    group by 1, 2
) rt on rt.mdm_employee_rk = s.mdm_employee_rk and rt.business_dt = s.business_dt
left join (
    select legal_position_rk::text as legal_position_rk, fire_dt::date as fire_dt,
           max(case when nullif(trim(dismissal_reason_desc::text), '') is not null
                     and dismissal_reason_desc <> 'Причина отсутствует' then 1 else 0 end) as has_reason
    from prod_v_hrmart.legal_position_dismissal_reason
    group by 1, 2
) fr on fr.legal_position_rk = s.legal_position_rk and fr.fire_dt = s.legal_fire_dt
where s.is_fire_row = 1
  and s.path_s <> ''
distributed by (mdm_employee_rk);
