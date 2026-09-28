-- ============================================================================
-- KPI · реестр целей (ПРАВИТСЯ РУКАМИ). Одна строка INSERT = одна цель.
-- Пока инструмента настройки KPI нет, источник целей — этот параграф: поправили
-- строки → запустили ноут → цель в отчёте. Контракт тот же, что ждёт будущий
-- инструмент (docs/dataset-spec.md, «Цели»), поэтому потом меняется только источник.
--
--   rule_id    уникальный код правила (любой текст)
--   unit_rk    mapped rk юнита (mapped_management_unit_rk / lvlN_mapped_…_rk);
--              в отчёте: выбор юнита → «ID для цели» у выбранного юнита
--   metric_id  retention_new_3 | retention_new_6 | regret | exit_reasons | jun_team
--              (nonregret и headcount целей не имеют: «больше» у них не значит «лучше»)
--   target     целевое значение в единицах метрики: проценты — числом (3.5 = 3,5 %)
--   f_paint … f_hct  разрезы численности, при которых цель действует; 'all' — при
--              любых. Значения — как в отчёте (HQ, IT, «Штат», «Активная» …). Цель с
--              разрезом видна, только когда в отчёте выбран ровно этот разрез.
--   valid_from / valid_to  действие цели (valid_to пусто — бессрочно)
--   author, note           кто поставил и зачем
-- Наследование: цель юнита действует на всю его ветку вниз, пока ниже не встретится
-- своя; на одном юните более узкое правило (больше разрезов) бьёт более широкое.
-- ============================================================================
drop table if exists hh_kpi_src;
create table hh_kpi_src (
    rule_id    text,
    unit_rk    text,
    metric_id  text,
    target     numeric,
    f_paint    text,
    f_it       text,
    f_stream   text,
    f_spec     text,
    f_staff    text,
    f_hct      text,
    valid_from date,
    valid_to   date,
    author     text,
    note       text
) distributed randomly;

-- Пример (раскомментировать и подставить rk юнита):
-- insert into hh_kpi_src values
--   ('R-001', '<rk юнита>', 'regret',          3.5, 'all', 'all', 'all', 'all', 'all', 'all', '2026-01-01', null, 'r.kazantsev', 'Цель блока по regret'),
--   ('R-002', '<rk юнита>', 'retention_new_3', 90,  'HQ',  'all', 'all', 'all', 'all', 'all', '2026-01-01', null, 'r.kazantsev', 'Закрепляемость HQ');
