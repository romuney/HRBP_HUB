-- ============================================================================
-- HH · строки источника. Один проход по mdm_employee_structure_d — дальше всё
-- считается отсюда.
--   is_slot_row  строка на конец слота (месяц / неделя, вкл. историю окон) или на
--                срез data_dt: запасы (численность, джуны), справочник, зоны HRBP;
--   is_fire_row  строка увольнения из компании — company_fire_flg = 1 (HRBP 13.10: отток всегда по нему);
--   is_hire_row  строка найма в компанию — company_hire_flg = 1;
--   is_ahire_row строка прихода в активную численность (HRBP 13.10, Дьяченко): найм в компанию с типом
--                «Активная» + переход кандидата (candidate_transfer_flg) + внутренний перевод
--                (internal_transfer_flg) — найм и когорта закрепляемости при фильтре «Активная».
--   hct          тип численности; у строк вне юридической численности (legal_employee_flg <> 1) —
--                значение hh_param.nonlegal_type: без выбранного типа отчёт их не берёт (HRBP 13.10).
--   hc           в списочной численности на эту дату — ЛЮБОГО типа (active_type_nm):
--                нанят (company_hire_dt <= дата) и не уволен раньше (company_fire_dt пусто
--                или >= дата). Активная численность — фильтр «Тип численности» = «Активная»
--                (владелец 12.10: все метрики — и по активной, и по всем типам; до 12.10
--                hc = active_employee_flg, и у прочих типов численность была 0).
--   hc_act       active_employee_flg — для «Диагностики источников» (сверка с hct).
-- Атрибуты строки — на ЕЁ дату: запасы берут разрезы на конец периода, события —
-- на дату события. Путь юнита — mapped-цепочка, как в ультраширокой: lvl1
-- (компания) и lvl3…lvl12. lvl2 (группировка юрлиц над блоками) пропускается —
-- блоки встают прямо под компанию; глубже lvl12 отчёт не спускается: сотрудник
-- lvl13 считается прямо в своём юните 12-го уровня, сотрудник lvl1/lvl2 — прямо
-- в компании. id узла = первые 12 знаков md5(rk): короткий, стабильный между
-- пересборками.
-- Руководитель юнита (13.10, логин под именем юнита в фильтре): is_head — management_head_flg, login —
-- ad_login, head_login — management_head_ad_login (руководитель юнита сотрудника, как head_login
-- ультраширокой), deep13 — сотрудник глубже 12-го уровня (его руководитель — не руководитель юнита отчёта).
-- Разрезы численности (как в filter-fields.md):
--   paint  = emp_specialization_oper_code      it    = emp_specialization_it_code
--   stream = emp_stream_desc                   spec  = emp_specialization_desc
--   staff  = «Штат» для employment_relation_type_desc = 'Штатный сотрудник', иначе «Не штат»
--   hct    = active_type_nm как есть
-- Пустое значение разреза = '-'. Атрибуты a_* — оси трансформеров.
-- ============================================================================
drop table if exists hh_src_raw;
create table hh_src_raw as
select
    e.business_dt::date                                                        as business_dt,
    e.mdm_employee_rk,
    case when sd.d is not null then 1 else 0 end                                as is_slot_row,
    case when coalesce(e.company_fire_flg, 0) = 1 then 1 else 0 end            as is_fire_row,
    case when coalesce(e.company_hire_flg, 0) = 1 then 1 else 0 end            as is_hire_row,
    case when (coalesce(e.company_hire_flg, 0) = 1 and lower(trim(e.active_type_nm)) = lower(trim(pa.active_type_value)))
           or coalesce(e.candidate_transfer_flg, 0) = 1
           or coalesce(e.internal_transfer_flg, 0) = 1 then 1 else 0 end      as is_ahire_row,
    case when coalesce(e.company_hire_dt, e.business_dt) <= e.business_dt
          and (e.company_fire_dt is null or e.company_fire_dt >= e.business_dt)
         then 1 else 0 end                                                     as hc,
    coalesce(e.active_employee_flg, 0)::int                                    as hc_act,
    e.company_hire_dt::date                                                    as company_hire_dt,
    e.active_hire_dt::date                                                     as active_hire_dt,
    e.legal_fire_dt::date                                                      as legal_fire_dt,
    e.legal_position_rk::text                                                  as legal_position_rk,
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
    )                                                                          as path_s,
    coalesce(nullif(trim(e.emp_specialization_oper_code::text), ''), '-')      as paint,
    coalesce(nullif(trim(e.emp_specialization_it_code::text), ''), '-')        as it,
    coalesce(nullif(trim(e.emp_stream_desc::text), ''), '-')                   as stream,
    coalesce(nullif(trim(e.emp_specialization_desc::text), ''), '-')           as spec,
    case when e.employment_relation_type_desc = 'Штатный сотрудник'
         then 'Штат' else 'Не штат' end                                        as staff,
    case when coalesce(e.legal_employee_flg, 0) <> 1 then pa.nonlegal_type
         else coalesce(nullif(trim(e.active_type_nm::text), ''), '-') end      as hct,
    coalesce(nullif(trim(e.seniority::text), ''), '-')                         as seniority,
    coalesce(nullif(trim(e.grade::text), ''), '-')                             as a_grade,
    coalesce(nullif(trim(e.experience_group_nm::text), ''), '-')               as a_exp,
    coalesce(nullif(trim(e.gender_desc::text), ''), '-')                       as a_gender,
    case when e.birth_dt is null then '-'
         when extract(year from age(e.business_dt::date, e.birth_dt::date)) < 25 then 'до 25'
         when extract(year from age(e.business_dt::date, e.birth_dt::date)) < 35 then '25–34'
         when extract(year from age(e.business_dt::date, e.birth_dt::date)) < 45 then '35–44'
         else '45 и старше' end                                                as a_age,
    coalesce(nullif(trim(e.office_desc::text), ''), '-')                       as a_office,
    coalesce(nullif(trim(e.employee_contract_type_desc::text), ''), '-')       as a_work,
    case when coalesce(e.management_head_flg, 0) = 1
         then 'Руководитель' else 'Не руководитель' end                        as a_head,
    coalesce(nullif(trim(e.lvl1_legal_unit_nm::text), ''), '-')                as a_legal,
    coalesce(nullif(trim(r.macroregion_nm::text), ''), '-')                    as a_macro,
    coalesce(nullif(trim(r.city_nm::text), ''), '-')                           as a_city,
    r.valid_from_dttm                                                          as res_from,
    e.hrbp_mdm_employee_rk                                                     as hrbp_rk,
    lower(trim(e.hrbp_ad_login::text))                                         as hrbp_login,
    trim(coalesce(e.hrbp_last_nm::text, '') || ' ' || coalesce(e.hrbp_first_nm::text, '')) as hrbp_nm,
    coalesce(e.management_head_flg, 0)::int                                    as is_head,
    nullif(lower(trim(e.ad_login::text)), '')                                  as login,
    nullif(lower(trim(e.management_head_ad_login::text)), '')                  as head_login,
    case when nullif(nullif(trim(e.lvl13_mapped_management_unit_rk::text), ''), '-') is not null
         then 1 else 0 end                                                     as deep13
from prod_v_emart.mdm_employee_structure_d e
cross join (select min(slot_start) - interval '7 month' as d0 from hh_calendar) lim
cross join hh_param pa
left join (select c.slot_end as d from hh_calendar c cross join hh_param p where c.slot_end <= p.data_dt
           union
           select data_dt from hh_param) sd
    on sd.d = e.business_dt
left join prod_v_sse_crossdata.mdm_employee_residence r
    on r.mdm_employee_rk = e.mdm_employee_rk
   and e.business_dt between r.valid_from_dttm and r.valid_to_dttm
   and r.deleted_flg = 0
where e.business_dt >= lim.d0
  and (sd.d is not null
       or coalesce(e.company_fire_flg, 0) = 1
       or coalesce(e.company_hire_flg, 0) = 1
       or coalesce(e.candidate_transfer_flg, 0) = 1
       or coalesce(e.internal_transfer_flg, 0) = 1)
distributed by (mdm_employee_rk);

-- Одна строка на (сотрудник, день): пересечения периодов проживания дают дубли —
-- берём самый свежий. Дубли самого источника проверяет параграф «HH · проверки».
drop table if exists hh_src;
create table hh_src as
select distinct on (mdm_employee_rk, business_dt) *
from hh_src_raw
order by mdm_employee_rk, business_dt, res_from desc
distributed by (mdm_employee_rk);

-- Джун — по seniority и шаблонам из hh_param_junior (сопоставление по ILIKE, не точное).
drop table if exists hh_seniority;
create table hh_seniority as
select s.seniority,
       max(case when s.seniority ilike j.pattern then 1 else 0 end) as jun
from (select distinct seniority from hh_src) s
cross join hh_param_junior j
group by s.seniority
distributed replicated;

analyze hh_src;
