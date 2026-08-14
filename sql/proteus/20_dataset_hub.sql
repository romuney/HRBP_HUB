/* ============================================================
   HRBP HUB · Proteus (Superset) · виртуальный датасет `hrbp_hub`
   ------------------------------------------------------------
   Один датасет на весь дашборд. Отрисовка своя (ECharts + HTML макета),
   поэтому датасет не подстраивается под чарт — он отдаёт контракт,
   а разбирает его фронт.

   ТРИ ВЕТКИ, ОДИН НАБОР КОЛОНОК
     row_kind = 'fact'    факт по юнитам: узел −1, узел −2, метрика, период
     row_kind = 'bench'   база сравнения: вся компания под теми же разрезами
     row_kind = 'target'  действующая цель: юнит + метрика (периода нет)

   Строками, а не колонками — потому что цель нужна каждому уровню таблицы
   (юнит отчёта, −1, −2). Джойн потребовал бы трёх колонок, которые нельзя
   суммировать; строки такой ловушки не создают.

   Цель адресуется СВОЕЙ колонкой target_unit_id, а не child_unit_id:
   иначе запрос One-Pager, который по юнитам не группируется, схлопнул бы
   все цели в одну сумму. У строк факта эта колонка пустая, поэтому
   добавление её в группировку ничего не дробит.

   ВРЕМЕННОЙ ФИЛЬТР НА ДАШБОРДЕ НЕ СТАВИТСЯ (Time range = «No filter»):
   окно задаёт сама витрина, а у строк цели периода нет — фильтр по
   диапазону дат их просто выкинул бы.

   ЗАЧЕМ JINJA
     1) ЦЕЛЬ применяется по правилу «разрез правила = 'all' ИЛИ = выбранному».
        Нативный фильтр так не умеет — он ставит равенство.
     2) БАЗА считается по разрезам, но БЕЗ ограничения по юниту: нативный
        фильтр юнита срезал бы и её тоже. Поэтому в ветках базы и цели
        мы сами проставляем выбранный scope_unit_id — чтобы фильтр
        Superset их пропустил, а считались они по своей популяции.

   ВАЖНО: список разрезов ниже обязан совпадать с набором фильтров полки.
   Забытый здесь разрез не сломает факт (его отфильтрует Superset), но
   база посчитается по более широкой популяции, чем показано в отчёте,
   и расхождение будет тихим.
   ============================================================ */

{% set paint      = filter_values('paint')          | first | default('all', true) %}
{% set it_segment = filter_values('it_segment')     | first | default('all', true) %}
{% set stream     = filter_values('stream')         | first | default('all', true) %}
{% set spec       = filter_values('spec')           | first | default('all', true) %}
{% set staff_type = filter_values('staff_type')     | first | default('all', true) %}
{% set hc_type    = filter_values('hc_type')        | first | default('all', true) %}
{% set scope      = filter_values('scope_unit_id')  | first | default('T', true) %}
{% set cut        = filter_values('cut_key')        | first | default('it_segment', true) %}

/* ---------- 1 · факт ---------- */
select
    'fact'                      as row_kind,
    f.grain,
    f.period_start,

    f.scope_unit_id, f.scope_unit_name, f.scope_unit_level,
    f.child_unit_id, f.child_unit_name,
    f.grandchild_unit_id, f.grandchild_unit_name,
    f.scope_hrbp_id, f.scope_hrbp_zone_root_id,

    f.paint, f.it_segment, f.stream, f.spec, f.staff_type, f.hc_type,

    /* ось разбивки для вкладки «Трансформеры»: колонка выбирается
       переключателем, а не переписыванием чарта */
    multiIf('{{ cut }}' = 'paint',      f.paint,
            '{{ cut }}' = 'it_segment', f.it_segment,
            '{{ cut }}' = 'stream',     f.stream,
            '{{ cut }}' = 'spec',       f.spec,
            '{{ cut }}' = 'staff_type', f.staff_type,
            '{{ cut }}' = 'hc_type',    f.hc_type,
            'все')                                      as cut_value,

    f.metric_id, f.metric_name, f.metric_short, f.metric_block,
    f.metric_better, f.metric_fmt, f.metric_unit,
    f.is_ratio, f.out_scale,

    f.value_num,
    f.value_den,

    /* поля целей — пустые в этой ветке, контракт колонок общий */
    ''                          as target_unit_id,
    ''                          as target_owner_name,
    toUInt8(0)                  as target_inherited,
    toUInt8(0)                  as target_is_own
from hrbp.hub_fact f

union all

/* ---------- 2 · база сравнения ----------
   Вся компания под теми же разрезами. scope_unit_id проставляем
   выбранный — иначе нативный фильтр юнита выкинет эти строки,
   а популяция у них своя, компанейская. */
select
    'bench'                     as row_kind,
    b.grain,
    b.period_start,

    '{{ scope }}'               as scope_unit_id,
    ''                          as scope_unit_name,
    toUInt8(0)                  as scope_unit_level,
    ''                          as child_unit_id,
    ''                          as child_unit_name,
    ''                          as grandchild_unit_id,
    ''                          as grandchild_unit_name,
    ''                          as scope_hrbp_id,
    ''                          as scope_hrbp_zone_root_id,

    b.paint, b.it_segment, b.stream, b.spec, b.staff_type, b.hc_type,
    'все'                       as cut_value,

    b.metric_id,
    m.metric_name, m.metric_short, m.metric_block,
    m.metric_better, m.metric_fmt, m.metric_unit,
    b.is_ratio, b.out_scale,

    b.bench_num                 as value_num,
    b.bench_den                 as value_den,

    ''                          as target_unit_id,
    ''                          as target_owner_name,
    toUInt8(0)                  as target_inherited,
    toUInt8(0)                  as target_is_own
from hrbp.hub_bench b
join hrbp.dim_metric m on m.metric_id = b.metric_id

union all

/* ---------- 3 · действующие цели ----------
   Правило применимо, только если каждый его разрез либо 'all', либо
   совпадает с выбранным на полке: цель «по HQ» нельзя мерить числом,
   посчитанным по всем покраскам.

   Победитель — argMax по паре (owner_level, specificity) именно в этом
   порядке: сначала выигрывает БЛИЖАЙШИЙ предок, и только внутри него —
   более узкое правило. Это ровно алгоритм resolveKpi() из макета.

   Цели отдаём для всех юнитов, попадающих в текущий отчёт: сам юнит,
   его дети и внуки. Разрезы у строки цели ставим выбранные — чтобы
   нативные фильтры полки её не отсекли.
*/
select
    'target'                    as row_kind,
    'month'                     as grain,
    toDate(null)                as period_start,

    '{{ scope }}'               as scope_unit_id,
    ''                          as scope_unit_name,
    toUInt8(0)                  as scope_unit_level,
    ''                          as child_unit_id,
    ''                          as child_unit_name,
    ''                          as grandchild_unit_id,
    ''                          as grandchild_unit_name,
    ''                          as scope_hrbp_id,
    ''                          as scope_hrbp_zone_root_id,

    '{{ paint }}'      as paint,
    '{{ it_segment }}' as it_segment,
    '{{ stream }}'     as stream,
    '{{ spec }}'       as spec,
    '{{ staff_type }}' as staff_type,
    '{{ hc_type }}'    as hc_type,
    'все'              as cut_value,

    k.metric_id,
    m.metric_name, m.metric_short, m.metric_block,
    m.metric_better, m.metric_fmt, m.metric_unit,
    toUInt8(0)                  as is_ratio,     -- цель уже в единицах метрики
    toFloat32(1)                as out_scale,

    k.target                    as value_num,
    toFloat64(1)                as value_den,

    k.unit_id                   as target_unit_id,
    k.target_owner_name,
    k.target_inherited,
    k.target_is_own
from (
    select unit_id,
           metric_id,
           argMax(target,          (owner_level, specificity)) as target,
           argMax(owner_unit_name, (owner_level, specificity)) as target_owner_name,
           argMax(is_inherited,    (owner_level, specificity)) as target_inherited,
           max(is_own)                                         as target_is_own
    from hrbp.kpi_effective
    where (f_paint      = 'all' {% if paint      != 'all' %}or f_paint      = '{{ paint }}'      {% endif %})
      and (f_it_segment = 'all' {% if it_segment != 'all' %}or f_it_segment = '{{ it_segment }}' {% endif %})
      and (f_stream     = 'all' {% if stream     != 'all' %}or f_stream     = '{{ stream }}'     {% endif %})
      and (f_spec       = 'all' {% if spec       != 'all' %}or f_spec       = '{{ spec }}'       {% endif %})
      and (f_staff_type = 'all' {% if staff_type != 'all' %}or f_staff_type = '{{ staff_type }}' {% endif %})
      and (f_hc_type    = 'all' {% if hc_type    != 'all' %}or f_hc_type    = '{{ hc_type }}'    {% endif %})
      /* только юниты текущего отчёта: сам, дети и внуки.
         Отбираем по справочнику, а не по факту: dim_unit — три тысячи
         строк в памяти, а скан hub_fact ради списка юнитов лишний. */
      and unit_id in (
            select unit_id
            from hrbp.dim_unit
            where unit_level <= (select unit_level from hrbp.dim_unit
                                  where unit_id = '{{ scope }}') + 2
              and (unit_id = '{{ scope }}'
                or startsWith(unit_path,
                              (select concat(unit_path, '/') from hrbp.dim_unit
                                where unit_id = '{{ scope }}'))))
    group by unit_id, metric_id
) k
join hrbp.dim_metric m on m.metric_id = k.metric_id
