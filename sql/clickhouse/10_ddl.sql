/* ============================================================
   HRBP HUB · ClickHouse · схема приёмника
   ------------------------------------------------------------
   Четыре таблицы: факт, база сравнения, цели, справочник юнитов
   (последний — для выпадающих списков фильтров в Proteus).

   Почти все текстовые колонки — LowCardinality: у разрезов десятки
   значений, у метрик десять, у юнитов тысячи. Это словарное кодирование,
   и оно же ускоряет GROUP BY. Ориентир: до ~10 000 уникальных значений
   LowCardinality выигрывает, дальше — обычный String.
   ============================================================ */

create database if not exists hrbp;

/* ---------- Факт ----------
   Ключ сортировки повторяет форму запроса дашборда: юнит и метрика всегда
   зафиксированы, дальше идёт диапазон дат, и только потом разрезы.
   Первым — grain, чтобы месячные и недельные ряды не перемешивались
   в одних гранулах.
*/
create table if not exists hrbp.hub_fact
(
    grain                   LowCardinality(String),
    period_start            Date,

    scope_unit_id           LowCardinality(String),
    scope_unit_name         LowCardinality(String),
    scope_unit_level        UInt8,
    child_unit_id           LowCardinality(String),
    child_unit_name         LowCardinality(String),
    grandchild_unit_id      LowCardinality(String),
    grandchild_unit_name    LowCardinality(String),
    scope_hrbp_id           LowCardinality(String),
    scope_hrbp_zone_root_id LowCardinality(String),

    paint                   LowCardinality(String),
    it_segment              LowCardinality(String),
    stream                  LowCardinality(String),
    spec                    LowCardinality(String),
    staff_type              LowCardinality(String),
    hc_type                 LowCardinality(String),

    metric_id               LowCardinality(String),
    metric_name             LowCardinality(String),
    metric_short            LowCardinality(String),
    metric_block            LowCardinality(String),
    metric_better           LowCardinality(String),
    metric_fmt              LowCardinality(String),
    metric_unit             LowCardinality(String),
    is_ratio                UInt8,
    out_scale               Float32,

    value_num               Float64,
    value_den               Nullable(Float64)
)
engine = MergeTree
partition by (grain, toYear(period_start))
order by (grain, scope_unit_id, metric_id, period_start,
          child_unit_id, grandchild_unit_id,
          paint, it_segment, stream, spec, staff_type, hc_type)
settings index_granularity = 8192;

/* ---------- База сравнения ----------
   Вся компания под теми же разрезами. Отдельная таблица, потому что
   база не должна реагировать на фильтр юнита: в hub_fact строки уже
   ограничены юнитом, вычесть это ограничение из них нельзя.
   Размер — порядка сотен тысяч строк, джойн бесплатный.
*/
create table if not exists hrbp.hub_bench
(
    grain        LowCardinality(String),
    period_start Date,
    paint        LowCardinality(String),
    it_segment   LowCardinality(String),
    stream       LowCardinality(String),
    spec         LowCardinality(String),
    staff_type   LowCardinality(String),
    hc_type      LowCardinality(String),
    metric_id    LowCardinality(String),
    is_ratio     UInt8,
    out_scale    Float32,
    bench_num    Float64,
    bench_den    Nullable(Float64)
)
engine = MergeTree
partition by (grain, toYear(period_start))
order by (grain, metric_id, period_start, paint, it_segment, stream, spec, staff_type, hc_type);

/* ---------- Цели с разрешённым наследованием ----------
   На каждый узел дерева — правила, действующие на него: своё или
   ближайшее сверху, по одному на каждый набор разрезов.
   Выбор между наборами делает запрос, потому что он зависит от полки.
*/
create table if not exists hrbp.kpi_effective
(
    unit_id          LowCardinality(String),
    metric_id        LowCardinality(String),
    f_paint          LowCardinality(String),
    f_it_segment     LowCardinality(String),
    f_stream         LowCardinality(String),
    f_spec           LowCardinality(String),
    f_staff_type     LowCardinality(String),
    f_hc_type        LowCardinality(String),
    target           Float64,
    rule_id          String,
    hrbp_id          LowCardinality(String),
    owner_unit_id    LowCardinality(String),
    owner_unit_name  LowCardinality(String),
    owner_level      UInt8,
    is_inherited     UInt8,
    is_own           UInt8,
    specificity      UInt8
)
engine = MergeTree
order by (unit_id, metric_id, f_paint, f_it_segment, f_stream, f_spec, f_staff_type, f_hc_type);

/* ---------- Справочник метрик ----------
   В hub_fact паспорт метрики денормализован, но веткам «база» и «цель»
   в serving-вьюхе он нужен отдельно: там строки приходят не из факта. */
create table if not exists hrbp.dim_metric
(
    metric_id     LowCardinality(String),
    metric_name   String,
    metric_short  String,
    metric_block  LowCardinality(String),
    metric_better LowCardinality(String),
    metric_fmt    LowCardinality(String),
    metric_unit   LowCardinality(String),
    is_ratio      UInt8,
    out_scale     Float32,
    company_ref   Nullable(Float64),
    sort_order    UInt8
)
engine = MergeTree
order by (metric_id);

/* ---------- Справочники для выпадающих списков ---------- */
create table if not exists hrbp.dim_unit
(
    unit_id        LowCardinality(String),
    parent_unit_id LowCardinality(String),
    unit_name      String,
    unit_level     UInt8,
    unit_path      String,
    unit_path_name String,
    is_leaf        UInt8,
    has_own_target UInt8,
    /* подпись с отступом: список «Все юниты · вся глубина» на 12 уровней
       без отступа читается как плоский перечень */
    unit_label     String materialized concat(repeat('  ', toUInt8(unit_level - 1)), unit_name,
                                              if(has_own_target = 1, ' ●', ''))
)
engine = MergeTree
order by (unit_path);

create table if not exists hrbp.dim_hrbp_scope
(
    hrbp_id            LowCardinality(String),
    hrbp_login         LowCardinality(String),
    hrbp_name          String,
    hrbp_role          LowCardinality(String),
    unit_id            LowCardinality(String),
    zone_root_unit_id  LowCardinality(String)
)
engine = MergeTree
order by (hrbp_login, unit_id);

/* Список разрезов для переключателя оси на вкладке «Трансформеры».
   Отдельная таблица нужна затем, что нативному фильтру Superset нужен
   источник значений, а сам разрез — это имя колонки, а не данные. */
create table if not exists hrbp.dim_cut
(
    cut_key   LowCardinality(String),
    cut_name  String,
    sort_order UInt8
)
engine = TinyLog;

insert into hrbp.dim_cut values
  ('paint',      'Покраска',          1),
  ('it_segment', 'IT / nonIT',        2),
  ('stream',     'Стрим',             3),
  ('spec',       'Специализация',     4),
  ('staff_type', 'Штат / не штат',    5),
  ('hc_type',    'Тип численности',   6);
