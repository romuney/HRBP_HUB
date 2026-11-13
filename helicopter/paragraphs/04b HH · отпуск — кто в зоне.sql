-- ============================================================================
-- HH · отпуск — кто в зоне → hrbp_hub_vac_people (поставка 68, владелец 13.11: «просмотр детальных списков, кто эти
-- люди с большим количеством накопленных дней»). Строка — штатный сотрудник в численности на дату данных (текущий
-- месяц отчёта), у кого накоплено 28 дней и больше по основной позиции (жёлтая / красная зона метрик «Накопленный
-- отпуск») ИЛИ в сумме по неосновным позициям (совместительство — пометка у метрик). Те же люди и те же суммы, что в
-- hh_vac на data_dt: числа списка сходятся с метрикой (стоп-проверка 4е в «HH · проверки»).
-- Колонки (владелец 13.11): ФИО и логин (last_nm, first_nm, ad_login витрины структуры на дату данных), rk, дата
-- найма, дни по основной позиции (days) и по совместительству (xdays), разбивка основной позиции по типам отпуска
-- одной строкой (types: «код:дни|код:дни», крупные первыми, коды — как в источнике), path_s и шесть разрезов — чтобы
-- датасет отдавал людей только из юнитов зоны логина и под фильтрами отчёта, как саму метрику. Названия юнитов
-- отчёт берёт из справочника по последнему юниту пути.
-- Метрика ещё не началась (дата данных раньше vac_start_dt) — таблица пустая.
-- ============================================================================
drop table if exists hrbp_hub_vac_people;
create table hrbp_hub_vac_people as
select s.mdm_employee_rk,
       coalesce(n.fio, '')                                        as fio,
       coalesce(n.login, '')                                      as login,
       s.company_hire_dt                                          as hire_dt,
       round(v.days, 2)                                           as days,
       round(v.xdays, 2)                                          as xdays,
       coalesce(t.types, '')                                      as types,
       s.path_s, s.paint, s.it, s.stream, s.spec, s.staff, s.hct
from hh_vac v
cross join hh_param p
cross join hh_vac_start vs
join hh_src s
    on s.mdm_employee_rk = v.mdm_employee_rk and s.business_dt = v.business_dt
   and s.is_slot_row = 1 and s.hc = 1 and s.staff = 'Штат' and s.path_s <> ''
left join (
    -- ФИО и логин на дату данных; в источнике бывают дубли строк (сотрудник, день) — берём одну
    select e.mdm_employee_rk,
           max(trim(coalesce(trim(e.last_nm::text), '') || ' ' || coalesce(trim(e.first_nm::text), ''))) as fio,
           max(lower(trim(e.ad_login::text)))                                                         as login
    from prod_v_emart.mdm_employee_structure_d e
    cross join hh_param pp
    where e.business_dt = pp.data_dt
    group by 1
) n on n.mdm_employee_rk = s.mdm_employee_rk
left join (
    -- остаток основной позиции по типам отпуска на конец дня данных — тот же срез версий, что у days в «HH · отпуска»
    select q.mdm_employee_rk,
           string_agg(q.code || ':' || q.d::text, '|' order by q.d desc, q.code) as types
    from (select z.mdm_employee_rk, coalesce(nullif(trim(x.vacation_type_code::text), ''), '-') as code,
                 round(sum(x.accum_vacation_day)::numeric, 2) as d
          from (select distinct h.mdm_employee_rk, h.legal_position_rk
                from hh_src h
                cross join hh_param ph
                where h.business_dt = ph.data_dt and h.is_slot_row = 1 and h.hc = 1 and h.staff = 'Штат'
                  and h.legal_position_rk is not null) z
          cross join hh_param pz
          join prod_v_sse_crossdata.legal_position_vacation x
              on x.legal_position_rk::text = z.legal_position_rk
             and x.valid_from_dttm <= pz.data_dt + interval '1 day' - interval '1 second'
             and x.valid_to_dttm   >= pz.data_dt + interval '1 day' - interval '1 second'
          where x.deleted_flg = 0
          group by 1, 2) q
    group by 1
) t on t.mdm_employee_rk = s.mdm_employee_rk
where v.business_dt = p.data_dt
  and p.data_dt >= vs.vac_start_dt
  and (v.days >= 28 or v.xdays >= 28)
distributed by (path_s);

-- Справочно: сколько людей в списке — по зонам основной позиции и по совместительству.
select count(*)                                                 as people,
       sum(case when days >= 28 and days < 56 then 1 else 0 end) as yellow,
       sum(case when days >= 56 then 1 else 0 end)               as red,
       sum(case when xdays >= 28 then 1 else 0 end)              as sec_28plus,
       sum(case when coalesce(days, 0) < 28 then 1 else 0 end)   as sec_only,
       sum(case when fio = '' then 1 else 0 end)                 as no_fio,
       max(days)                                                 as max_days
from hrbp_hub_vac_people;
