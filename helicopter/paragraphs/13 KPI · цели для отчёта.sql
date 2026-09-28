-- ============================================================================
-- KPI · цели для отчёта → hrbp_hub_kpi. rk юнита → id узла отчёта; пустые разрезы →
-- 'all' (NULL в сравнении ведёт себя иначе, и правило «на всю численность»
-- перестало бы находиться). Наследование и выбор победителя — в чарте: они
-- зависят от выбранных сейчас разрезов. Правила с неизвестным rk или метрикой
-- сюда не попадают — их список печатает «HH · проверки».
-- ============================================================================
drop table if exists hrbp_hub_kpi;
create table hrbp_hub_kpi as
select trim(r.rule_id)                                   as rule_id,
       u.id                                              as unit_id,
       trim(r.unit_rk)                                   as unit_rk,
       trim(r.metric_id)                                 as metric_id,
       r.target::float8                                  as target,
       coalesce(nullif(trim(r.f_paint), ''), 'all')      as f_paint,
       coalesce(nullif(trim(r.f_it), ''), 'all')         as f_it,
       coalesce(nullif(trim(r.f_stream), ''), 'all')     as f_stream,
       coalesce(nullif(trim(r.f_spec), ''), 'all')       as f_spec,
       coalesce(nullif(trim(r.f_staff), ''), 'all')      as f_staff,
       coalesce(nullif(trim(r.f_hct), ''), 'all')        as f_hct,
       coalesce(r.valid_from, date '2000-01-01')         as valid_from,
       coalesce(r.valid_to, date '2099-12-31')           as valid_to,
       coalesce(r.author, '')                            as author,
       coalesce(r.note, '')                              as note,
       u.path                                            as unit_path
from hh_kpi_src r
join hrbp_hub_unit u on u.rk = trim(r.unit_rk)
where trim(r.metric_id) in ('retention_new_3', 'retention_new_6', 'regret', 'exit_reasons', 'jun_team')
  and r.target is not null
distributed randomly;
