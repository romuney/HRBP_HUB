-- ============================================================================
-- HH · отпуска (11.11, метрика «Накопленный отпуск»). Остаток накопленных дней отпуска сотрудника на конец
-- каждого слота — по ОСНОВНОЙ позиции (legal_position_rk строки витрины структуры), сумма по всем типам отпуска.
-- Только штатные (employment_relation_type_desc = 'Штатный сотрудник' — разрез staff = «Штат»): метрика считается
-- по штатным и в числителе, и в знаменателе, какой бы разрез ни выбрали (владелец 11.11).
--   Источник — prod_v_sse_crossdata.legal_position_vacation: бизнес-версии по (позиция, тип отпуска).
--   Версия на дату — состояние на КОНЕЦ дня: valid_from <= d 23:59:59 <= valid_to. valid_to включительный — следующая
--   версия начинается через 1 секунду (этап 0, запрос 2); срез «valid_from::date <= d < valid_to::date» терял бы
--   позицию в каждый день окончания версии (начисление 1-го числа — это каждый конец месяца). deleted_flg = 0.
--   Остаток — в сотых долях дня (целым: 7,33 → 733) — сумма по команде без потерь, чарт делит на 100. Зоны — по
--   точной сумме: жёлтая 28 ≤ дни < 56, красная ≥ 56.
-- Начало метрики (vac_start_dt) — первый месяц отчёта, где запись есть хотя бы у hh_param.vac_min_cov (85 %) штатных
-- всей компании; раньше — история отпусков не загружена, слоты пустые (не нули). Месяц после начала с покрытием
-- ниже порога не прячется — его печатает «HH · проверки».
--   hh_vac        сотрудник × дата слота (только штатные в численности, слоты отчёта idx >= 0): days — точная сумма,
--                 NULL — записи об отпуске нет (сотрудник в знаменателе и «не в зоне»); xdays — сумма по НЕОСНОВНЫМ
--                 позициям (12.11): позиции сотрудника на ту же дату из prod_v_emart.legal_position_d, кроме основной
--                 (legal_position_rk строки структуры; признак main_legal_position_flg с ней совпадает — этап 0б,
--                 запрос 3), NULL — неосновных позиций с записью об отпуске нет. Долю зон не меняет: штатные с xdays в
--                 зоне — отдельные компоненты vxy / vxr (пометка у метрики, владелец 11.11).
--   hh_vac_cov    покрытие по месяцам отчёта: штатных, из них с записью, доля
--   hh_vac_start  vac_start_dt — первый день месяца начала (5999-01-01 — порога не достиг ни один месяц)
-- ============================================================================
drop table if exists hh_vac;
create table hh_vac as
select s.mdm_employee_rk, s.business_dt, v.days, w.xdays
from hh_src s
left join (
    select q.mdm_employee_rk, q.business_dt, sum(x.accum_vacation_day)::numeric as days
    from (select distinct mdm_employee_rk, business_dt, legal_position_rk
          from hh_src
          where is_slot_row = 1 and hc = 1 and staff = 'Штат' and legal_position_rk is not null
            and business_dt in (select slot_end from hh_calendar where idx >= 0)) q
    join prod_v_sse_crossdata.legal_position_vacation x
        on x.legal_position_rk::text = q.legal_position_rk
       and x.valid_from_dttm <= q.business_dt + interval '1 day' - interval '1 second'
       and x.valid_to_dttm   >= q.business_dt + interval '1 day' - interval '1 second'
    where x.deleted_flg = 0
    group by 1, 2
) v
    on v.mdm_employee_rk = s.mdm_employee_rk and v.business_dt = s.business_dt
left join (
    select q.mdm_employee_rk, q.business_dt, sum(x.accum_vacation_day)::numeric as xdays
    from (select distinct s2.mdm_employee_rk, s2.business_dt, d.legal_position_rk::text as rk
          from hh_src s2
          join prod_v_emart.legal_position_d d
              on d.mdm_employee_rk = s2.mdm_employee_rk and d.business_dt = s2.business_dt
          where s2.is_slot_row = 1 and s2.hc = 1 and s2.staff = 'Штат'
            and s2.business_dt in (select slot_end from hh_calendar where idx >= 0)
            and d.legal_position_rk::text <> coalesce(s2.legal_position_rk, '')) q
    join prod_v_sse_crossdata.legal_position_vacation x
        on x.legal_position_rk::text = q.rk
       and x.valid_from_dttm <= q.business_dt + interval '1 day' - interval '1 second'
       and x.valid_to_dttm   >= q.business_dt + interval '1 day' - interval '1 second'
    where x.deleted_flg = 0
    group by 1, 2
) w
    on w.mdm_employee_rk = s.mdm_employee_rk and w.business_dt = s.business_dt
where s.is_slot_row = 1 and s.hc = 1 and s.staff = 'Штат' and s.path_s <> ''
  and s.business_dt in (select slot_end from hh_calendar where idx >= 0)
distributed by (mdm_employee_rk);

analyze hh_vac;

drop table if exists hh_vac_cov;
create table hh_vac_cov as
select c.idx, c.slot_start, c.slot_end,
       count(v.mdm_employee_rk)                                          as staff_hc,
       count(v.days)                                                     as with_vac,
       round(count(v.days)::numeric / nullif(count(v.mdm_employee_rk), 0), 4) as cov
from hh_calendar c
cross join hh_param p
left join hh_vac v on v.business_dt = c.slot_end
where c.grain = 'm' and c.idx >= 0 and c.slot_end <= p.data_dt
group by 1, 2, 3
distributed replicated;

drop table if exists hh_vac_start;
create table hh_vac_start as
select coalesce(min(c.slot_start), date '5999-01-01') as vac_start_dt
from hh_vac_cov c
cross join hh_param p
where c.cov >= p.vac_min_cov
distributed replicated;

-- Справочно: покрытие по месяцам, месяц начала метрики и штатные с неосновными позициями в зонах.
select c.slot_end, c.staff_hc, c.with_vac, c.cov,
       (select count(*) from hh_vac x where x.business_dt = c.slot_end and x.xdays >= 28 and x.xdays < 56) as sec_yellow,
       (select count(*) from hh_vac x where x.business_dt = c.slot_end and x.xdays >= 56)                    as sec_red,
       case when c.slot_start >= s.vac_start_dt then 'в отчёте' else 'нет данных' end as vac_in_report
from hh_vac_cov c
cross join hh_vac_start s
order by c.idx;
