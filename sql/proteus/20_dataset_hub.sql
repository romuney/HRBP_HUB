/* ============================================================
   HRBP HUB · Proteus (Superset) · виртуальный датасет `hrbp_hub`
   ------------------------------------------------------------
   Один датасет на весь дашборд. Разница между блоками макета — не в
   датасете, а в том, какие колонки чарт берёт в группировку.

   Зачем Jinja, если фильтры и так нативные:
     1) ЦЕЛЬ применяется по правилу «разрез правила = 'all' ИЛИ = выбранному».
        Нативный фильтр так не умеет — он ставит равенство.
     2) БАЗА сравнения считается по разрезам, но БЕЗ ограничения по юниту.
        Нативный фильтр юнита срезал бы и её тоже.
   Всё остальное — обычные нативные фильтры по колонкам результата.

   ВАЖНО: список разрезов ниже должен совпадать с набором фильтров на
   полке. Забытый здесь разрез не сломает факт (его отфильтрует Superset),
   но база сравнения посчитается по более широкой популяции, чем показано
   в отчёте, и расхождение будет тихим.
   ============================================================ */

{% set paint      = filter_values('paint')      | first | default('all', true) %}
{% set it_segment = filter_values('it_segment') | first | default('all', true) %}
{% set stream     = filter_values('stream')     | first | default('all', true) %}
{% set spec       = filter_values('spec')       | first | default('all', true) %}
{% set staff_type = filter_values('staff_type') | first | default('all', true) %}
{% set hc_type    = filter_values('hc_type')    | first | default('all', true) %}
{% set cut        = filter_values('cut_key')    | first | default('it_segment', true) %}

with
/* ---------- База сравнения ----------
   «Вся компания под теми же разрезами». Разрезы применяем здесь руками,
   фильтр юнита сюда не долетает — в этом весь смысл отдельной ветки.
*/
bench as (
    select period_start,
           metric_id,
           grain,
           sum(bench_num) as bench_num,
           sum(bench_den) as bench_den
    from hrbp.hub_bench
    where 1 = 1
      {% if paint      != 'all' %}and paint      = '{{ paint }}'      {% endif %}
      {% if it_segment != 'all' %}and it_segment = '{{ it_segment }}' {% endif %}
      {% if stream     != 'all' %}and stream     = '{{ stream }}'     {% endif %}
      {% if spec       != 'all' %}and spec       = '{{ spec }}'       {% endif %}
      {% if staff_type != 'all' %}and staff_type = '{{ staff_type }}' {% endif %}
      {% if hc_type    != 'all' %}and hc_type    = '{{ hc_type }}'    {% endif %}
    group by period_start, metric_id, grain
),
/* ---------- Действующая цель ----------
   Правило применимо, если каждый его разрез либо 'all', либо совпадает
   с выбранным на полке: цель «по HQ» нельзя мерить числом, посчитанным
   по всем покраскам.

   Победитель — argMax по паре (owner_level, specificity) именно в таком
   порядке: сначала выигрывает БЛИЖАЙШИЙ предок, и только внутри него —
   более узкое правило. Это ровно алгоритм resolveKpi() из макета.
*/
kpi as (
    select unit_id,
           metric_id,
           argMax(target,          (owner_level, specificity)) as target,
           argMax(owner_unit_name, (owner_level, specificity)) as target_owner,
           argMax(is_inherited,    (owner_level, specificity)) as target_inherited,
           max(is_own)                                         as has_own_target
    from hrbp.kpi_effective
    where (f_paint      = 'all' {% if paint      != 'all' %}or f_paint      = '{{ paint }}'      {% endif %})
      and (f_it_segment = 'all' {% if it_segment != 'all' %}or f_it_segment = '{{ it_segment }}' {% endif %})
      and (f_stream     = 'all' {% if stream     != 'all' %}or f_stream     = '{{ stream }}'     {% endif %})
      and (f_spec       = 'all' {% if spec       != 'all' %}or f_spec       = '{{ spec }}'       {% endif %})
      and (f_staff_type = 'all' {% if staff_type != 'all' %}or f_staff_type = '{{ staff_type }}' {% endif %})
      and (f_hc_type    = 'all' {% if hc_type    != 'all' %}or f_hc_type    = '{{ hc_type }}'    {% endif %})
    group by unit_id, metric_id
)
select
    f.grain,
    f.period_start,

    /* адреса в дереве */
    f.scope_unit_id, f.scope_unit_name, f.scope_unit_level,
    f.child_unit_id, f.child_unit_name,
    f.grandchild_unit_id, f.grandchild_unit_name,
    f.scope_hrbp_id, f.scope_hrbp_zone_root_id,

    /* разрезы — по ним работают нативные фильтры полки */
    f.paint, f.it_segment, f.stream, f.spec, f.staff_type, f.hc_type,

    /* ось разбивки для вкладки «Трансформеры»: колонка выбирается
       переключателем, а не переписыванием чарта */
    multiIf('{{ cut }}' = 'paint',      f.paint,
            '{{ cut }}' = 'it_segment', f.it_segment,
            '{{ cut }}' = 'stream',     f.stream,
            '{{ cut }}' = 'spec',       f.spec,
            '{{ cut }}' = 'staff_type', f.staff_type,
            '{{ cut }}' = 'hc_type',    f.hc_type,
            'все')                                        as cut_value,

    /* метрика и её паспорт */
    f.metric_id, f.metric_name, f.metric_short, f.metric_block,
    f.metric_better, f.metric_fmt, f.metric_unit,
    f.is_ratio, f.out_scale,

    /* измерения */
    f.value_num, f.value_den,
    f.num_prev_p, f.den_prev_p,
    f.num_prev_y, f.den_prev_y,

    /* база: одна на (период, метрику), поэтому размножена по строкам —
       агрегировать её можно ТОЛЬКО через max/any */
    b.bench_num, b.bench_den,

    /* цель на трёх уровнях: юнит отчёта (сводка), строка таблицы (−1)
       и раскрытая строка (−2). Ячейке нужна цель того юнита, который
       в этой строке, а не того, что выбран на полке */
    ks.target           as target_scope,
    ks.target_owner     as target_scope_owner,
    ks.target_inherited as target_scope_inherited,
    kc.target           as target_child,
    kc.target_owner     as target_child_owner,
    kc.target_inherited as target_child_inherited,
    kg.target           as target_grandchild,

    /* «Только фокусные»: у юнита строки есть СВОЯ цель. Унаследованная
       сюда не годится — цель блока есть у всей ветки, и фильтр не убрал
       бы ни одной строки */
    coalesce(kc.has_own_target, 0) as has_own_target,
    coalesce(ks.has_own_target, 0) as scope_has_own_target

from hrbp.hub_fact f
left join bench b
       on b.period_start = f.period_start
      and b.metric_id    = f.metric_id
      and b.grain        = f.grain
left join kpi ks on ks.unit_id = f.scope_unit_id      and ks.metric_id = f.metric_id
left join kpi kc on kc.unit_id = f.child_unit_id      and kc.metric_id = f.metric_id
left join kpi kg on kg.unit_id = f.grandchild_unit_id and kg.metric_id = f.metric_id
