-- ============================================================================
-- HH · уволенные без причины → hrbp_hub_nr_people (поставка 56, владелец 02.11: «возможность смотреть тех, у кого не
-- заполнена причина, — выгрузить детальные данные»). Строка — увольнение из компании с 1 января года data_dt по
-- data_dt без причины: то же, что числитель метрики «Незаполненные причины» (nra из «HH · увольнения»: legal_fire_dt не
-- пустая, причины нет), — и свежие, у кого с увольнения не прошло nr_grace_days (ripe = 0: в отчёте «дозревает», в
-- значение метрики пока не входят).
-- Колонки (владелец 02.11): mdm_employee_rk, дата найма, дата увольнения, уровни управленческой структуры 3–6 на день
-- увольнения (mapped-цепочка, как путь отчёта); ФИО и логинов нет. path_s и шесть разрезов — чтобы датасет отдавал
-- людей только из юнитов зоны логина и под фильтрами отчёта, как саму метрику.
-- Сверка с метрикой — «HH · проверки», 4г: строк с ripe = 1 столько же, сколько m_nr базы в последнем месяце, всех —
-- сколько w_nr.
-- ============================================================================
drop table if exists hrbp_hub_nr_people;
create table hrbp_hub_nr_people as
select f.mdm_employee_rk,
       f.company_hire_dt                                                       as hire_dt,
       f.fire_dt,
       case when f.fire_dt <= p.data_dt - p.nr_grace_days then 1 else 0 end    as ripe,
       coalesce(n.lvl3_nm, '-')                                                as lvl3_nm,
       coalesce(n.lvl4_nm, '-')                                                as lvl4_nm,
       coalesce(n.lvl5_nm, '-')                                                as lvl5_nm,
       coalesce(n.lvl6_nm, '-')                                                as lvl6_nm,
       f.path_s, f.paint, f.it, f.stream, f.spec, f.staff, f.hct
from hh_fire f
cross join hh_param p
left join (
    -- названия уровней на день увольнения; в источнике бывают дубли строк (сотрудник, день) — берём одну
    select e.mdm_employee_rk, e.business_dt::date as business_dt,
           max(nullif(nullif(trim(e.lvl3_mapped_management_unit_nm::text), ''), '-')) as lvl3_nm,
           max(nullif(nullif(trim(e.lvl4_mapped_management_unit_nm::text), ''), '-')) as lvl4_nm,
           max(nullif(nullif(trim(e.lvl5_mapped_management_unit_nm::text), ''), '-')) as lvl5_nm,
           max(nullif(nullif(trim(e.lvl6_mapped_management_unit_nm::text), ''), '-')) as lvl6_nm
    from prod_v_emart.mdm_employee_structure_d e
    cross join hh_param pp
    where e.business_dt >= date_trunc('year', pp.data_dt)
      and coalesce(e.company_fire_flg, 0) = 1
    group by 1, 2
) n on n.mdm_employee_rk = f.mdm_employee_rk and n.business_dt = f.fire_dt
where f.nra = 1
  and f.fire_dt >= date_trunc('year', p.data_dt)::date
  and f.fire_dt <= p.data_dt
distributed by (path_s);
