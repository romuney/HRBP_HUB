-- ============================================================================
-- Диагностика источников (выключен, запускать руками после первого прогона).
-- Отвечает на открытые вопросы business-context.md и filter-fields.md: какие
-- значения у разрезов на самом деле, покрытие regrettable-разметки, есть ли у
-- всех увольнений строка в день увольнения. Результаты — владельцу отчёта.
-- ============================================================================

-- 1. Значения разрезов численности в срезе (сверить с подписями отчёта).
select 'paint' as cut, paint as value, count(*) as hc from hh_src s join hh_param p on s.business_dt = p.data_dt where s.hc = 1 group by 1, 2
union all select 'it', it, count(*) from hh_src s join hh_param p on s.business_dt = p.data_dt where s.hc = 1 group by 1, 2
union all select 'staff', staff, count(*) from hh_src s join hh_param p on s.business_dt = p.data_dt where s.hc = 1 group by 1, 2
union all select 'hct', hct, count(*) from hh_src s join hh_param p on s.business_dt = p.data_dt where s.hc = 1 group by 1, 2
union all select 'seniority', s.seniority || ' → джун ' || coalesce(j.jun, 0)::text, count(*)
          from hh_src s join hh_param p on s.business_dt = p.data_dt left join hh_seniority j on j.seniority = s.seniority
          where s.hc = 1 group by 1, 2
order by 1, 3 desc;

-- 1а. Тип численности против флага активной численности и статуса «в списочной» (hc) в
--     срезе: «Активная» должна совпасть с active_employee_flg = 1; строки с hc = 0 — уволенные
--     или ещё не нанятые, в численность не идут ни при каком типе.
select hct, hc_act as active_employee_flg, hc as in_list, count(*) as rows_n
from hh_src s join hh_param p on s.business_dt = p.data_dt
group by 1, 2, 3
order by 4 desc;

-- 1б. Юридическая численность против типа (HRBP 13.10): строки legal_employee_flg <> 1 отчёт кладёт в тип
--     «Вне юр. численности» (без выбранного типа их нет). Если у них встречается «Активная» — при выборе
--     «Активная» эти люди не попадут: сообщить, решим отдельно.
select coalesce(e.legal_employee_flg, 0) as legal_employee_flg, e.active_type_nm, count(*) as rows_n
from prod_v_emart.mdm_employee_structure_d e
join hh_param p on e.business_dt = p.data_dt
group by 1, 2
order by 1, 3 desc;

-- 1в. Приход в активную численность по месяцам (HRBP 13.10): найм в компанию с типом «Активная», переходы
--     кандидатов, внутренние переводы — сверить с ожиданием HRBP.
select date_trunc('month', e.business_dt)::date as month,
       sum(case when coalesce(e.company_hire_flg, 0) = 1 and e.active_type_nm = p.active_type_value then 1 else 0 end) as hire_active,
       sum(case when coalesce(e.candidate_transfer_flg, 0) = 1 then 1 else 0 end) as candidate_transfer,
       sum(case when coalesce(e.internal_transfer_flg, 0) = 1 then 1 else 0 end)  as internal_transfer,
       sum(case when coalesce(e.company_hire_flg, 0) = 1 then 1 else 0 end)       as hire_company
from prod_v_emart.mdm_employee_structure_d e
cross join hh_param p
where e.business_dt >= date_trunc('year', p.data_dt) - interval '1 year'
group by 1
order by 1;

-- 2. Регrettable-разметка по месяцам увольнения: доля размеченных.
select date_trunc('month', fire_dt)::date as fire_month,
       count(*)                                    as fires,
       sum(rg)                                     as regrettable,
       sum(nrg)                                    as non_regrettable,
       sum(case when rg = 0 and nrg = 0 then 1 else 0 end) as not_marked,
       sum(nr)                                     as reason_missing
from hh_fire
group by 1
order by 1;

-- 3. Увольнения без строки в день увольнения: company_fire_dt есть в более ранней
--    строке, а строки на сам день нет. Должно быть 0 — иначе событие теряется.
select count(*) as fires_without_fire_day_row
from (
    select distinct e.mdm_employee_rk, e.company_fire_dt
    from prod_v_emart.mdm_employee_structure_d e
    join hh_param p on e.business_dt = p.last_month_end
    where e.company_fire_dt between (select min(slot_start) from hh_calendar) and p.data_dt
) f
left join hh_fire h on h.mdm_employee_rk = f.mdm_employee_rk and h.fire_dt = f.company_fire_dt
where h.mdm_employee_rk is null;

-- 4. Флаг regrettable вне дня увольнения (если много — разметка не «на день увольнения»,
--    и джойн по дате её теряет).
select count(*) as regret_flags_total,
       sum(case when h.mdm_employee_rk is null then 1 else 0 end) as regret_flags_not_on_fire_day
from usr_cross_data.regrettable_n_non_regrettable_base r
left join hh_fire h on h.mdm_employee_rk = r.mdm_employee_rk and h.fire_dt = r.business_dt
where r.regrettable_fire_flg = 1
  and r.business_dt >= (select min(slot_start) from hh_calendar);
