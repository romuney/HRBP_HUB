{#- ============================================================================
    hrbp_hub — датасет ЕДИНСТВЕННОГО чарта отчёта HRBP HUB (Proteus, база CROSS).

    Один ответ везёт всё, что экрану может понадобиться до следующей смены юнита
    или разрезов: сводку, команды (−1 и −2), базу сравнения, цели, фасеты фильтров,
    справочник юнитов для выбора и календарь. Всё остальное — вкладки, раскрытие
    строк, «год / 12 недель», клик по команде, наследование целей, светофор —
    считает чарт по уже приехавшим строкам, без запроса.

    Строки различаются колонкой role:
      meta   1 строка — эхо применённых условий, доступ, календарь слотов (j = JSON)
      dict   1 строка — юниты зоны пакетом: id, родитель, уровень, численность сейчас,
             текущий ли, rk, имя (j: поля через \t, строки через \n)
      hrbps  1 строка — HRBP, чьи зоны внутри моей: логин, имя, корни, численность
      base   вся компания под выбранными разрезами — база сравнения
      scope  выбранный юнит (или объединение корней зоны)
      c      узлы на уровень ниже (строки «Команд»); '·' — сотрудники прямо в юните
      g      на два уровня ниже, pid = узел −1; '·' — прямо в узле −1
      f      фасеты фильтров: id = значение, pid = разрез, n = численность на конец
             последнего закрытого месяца при ОСТАЛЬНЫХ разрезах
      tr     разбивка по оси трансформеров (только когда tr_f задан), только месяцы
      kpi    правила целей: id = rule_id, pid = юнит, j = поля через \t
    Массивы m_* — 24 месяца, w_* — 24 недели (позиция = idx календаря), строкой
    через запятую. Проценты не храним: чарт делит числитель на знаменатель.

    Кросс-фильтры (эмитит сам чарт, самовлияние ВКЛЮЧЕНО): unit_f — id юнитов;
    paint_f / it_f / stream_f / spec_f / staff_f / hct_f — значения разрезов;
    tr_f — ось трансформеров. Колонки-носители в SELECT не выводятся (иначе
    Superset повесит авто-IN на внешний запрос). Доступ — current_username():
    юниты вне зоны пользователя не приезжают ни в каком виде.
============================================================================ -#}
{% set CUTS = [['paint', 'paint_f'], ['it', 'it_f'], ['stream', 'stream_f'], ['spec', 'spec_f'], ['staff', 'staff_f'], ['hct', 'hct_f']] %}
{% set CUT_COLS = ['paint', 'it', 'stream', 'spec', 'staff', 'hct'] %}
{% set ATTRS = ['grade', 'seniority', 'exp', 'gender', 'age', 'office', 'work', 'head', 'legal', 'macro', 'city'] %}
{% set COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire'] %}
{#- Строковый литерал ClickHouse: обратный слэш и кавычка экранируются. -#}
{% macro qs(v) -%}'{{ v|string|replace('\\', '\\\\')|replace("'", "\\'") }}'{%- endmacro %}
{#- Массив строк: для has()/hasAny(); пустой — типизированный. -#}
{% macro qa(values) -%}
{%- if values|length == 0 -%}CAST([], 'Array(String)'){%- else -%}[{% for v in values %}{{ qs(v) }}{% if not loop.last %}, {% endif %}{% endfor %}]{%- endif -%}
{%- endmacro %}
{#- Значения фильтров: список собирается циклом — при сохранении датасета Proteus
    отдаёт вместо списка AlwaysTrueObject, у него нет длины и «+» не определён. -#}
{% set me = (current_username() or '')|string|trim|lower %}
{% set unit_req = [] %}{% for v in (filter_values('unit_f') or []) %}{% if v|string|trim != '' and unit_req|length < 50 %}{% set _ = unit_req.append(v|string|trim) %}{% endif %}{% endfor %}
{% set F = {} %}
{% for c in CUTS %}{% set vals = [] %}{% for v in (filter_values(c[1]) or []) %}{% if v|string != '' and vals|length < 200 %}{% set _ = vals.append(v|string) %}{% endif %}{% endfor %}{% set _ = F.update({c[0]: vals}) %}{% endfor %}
{% set axis = filter_values('tr_f')|first|default('', true) %}
{% set axis = axis|string if (axis|string in CUT_COLS or axis|string in ATTRS) else '' %}
{#- Закрепляемость от active_hire_dt — только когда «Тип численности» = ровно «Активная». -#}
{% set RA = 'a' if (F['hct']|length == 1 and F['hct'][0] == 'Активная') else '' %}
{#- Условие «строка проходит разрезы», кроме разреза skip (для фасетов). -#}
{% macro cond(skip) -%}
{%- set parts = [] -%}
{%- for c in CUT_COLS -%}{%- if c != skip and F[c]|length > 0 -%}{%- set _ = parts.append('has(' ~ qa(F[c]) ~ ', ifNull(' ~ c ~ ", '-'))") -%}{%- endif -%}{%- endfor -%}
{{- parts|join(' AND ') if parts else '1' -}}
{%- endmacro %}
{% macro src(c) -%}{%- if c in ['r3n', 'r3d', 'r6n', 'r6d'] -%}{{ c[:2] ~ RA ~ c[2:] }}{%- else -%}{{ c }}{%- endif -%}{%- endmacro %}
{% macro arr(a) -%}arrayMap(x -> toInt64(ifNull(x, 0)), {{ a }}){%- endmacro %}
{% macro out(a) -%}arrayStringConcat(arrayMap(x -> toString(x), {{ a }}), ','){%- endmacro %}
{% macro empty_cols() -%}{% for c in COMP %}'' AS m_{{ c }}, {% endfor %}{% for c in COMP %}'' AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}{%- endmacro %}
{#- Контекст запроса — цепочкой CTE, а не WITH-выражениями: новый анализатор CH 24
    не пускает вычисляемые алиасы WITH в подзапросы («only supported for constants
    and CTE»). CTE инлайнится в каждое плечо, но таблицы здесь крошечные. #}
WITH
  a0 AS (
    SELECT groupArray(tuple(ifNull(role, ''), ifNull(root_id, ''))) AS acc
    FROM prod_proteus.hrbp_hub_access
    WHERE ifNull(login, '') = {{ qs(me) }}
  ),
  a1 AS (
    SELECT arrayMap(t -> t.2, arrayFilter(t -> t.1 IN ('super', 'admin'), acc)) AS r_all,
           arrayMap(t -> t.2, arrayFilter(t -> t.1 = 'hrbp', acc)) AS r_zone,
           arrayDistinct(if(notEmpty(r_all), r_all, r_zone)) AS roots,
           multiIf(has(arrayMap(t -> t.1, acc), 'super'), 'super',
                   has(arrayMap(t -> t.1, acc), 'admin'), 'admin',
                   notEmpty(r_zone), 'hrbp', 'none') AS my_role
    FROM a0
  ),
  {#- Запрошенные юниты — только из моей зоны; нет таких — открываемся на корнях зоны. -#}
  s0 AS (
    SELECT groupArray(ifNull(u.id, '')) AS req_ok
    FROM prod_proteus.hrbp_hub_unit u
    CROSS JOIN a1
    WHERE has({{ qa(unit_req) }}, ifNull(u.id, ''))
      AND hasAny(arrayMap(x -> ifNull(x, ''), u.path), a1.roots)
  ),
  {#- Предки корней зоны: для пути в шапке и для целей, наследуемых сверху. -#}
  an AS (
    SELECT groupUniqArrayArray(arrayMap(x -> ifNull(x, ''), u.path)) AS anc
    FROM prod_proteus.hrbp_hub_unit u
    CROSS JOIN a1
    WHERE has(a1.roots, ifNull(u.id, ''))
  ),
  lm AS (
    SELECT toInt64(max(ifNull(idx, 0))) AS last_m
    FROM prod_proteus.hrbp_hub_calendar
    WHERE ifNull(grain, '') = 'm' AND ifNull(is_closed, 0) = 1
  ),
  ctx AS (
    SELECT a1.roots AS roots, a1.my_role AS my_role,
           if(empty(s0.req_ok), a1.roots, arraySort(s0.req_ok)) AS scope,
           length(scope) = 1 AS single,
           an.anc AS anc, lm.last_m AS last_m
    FROM a1 CROSS JOIN s0 CROSS JOIN an CROSS JOIN lm
  )
SELECT role, id, pid, n, j,
  {% for c in COMP %}m_{{ c }}, {% endfor %}{% for c in COMP %}w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
FROM (

  {#- ---------- куб: база, юнит, команды −1/−2, фасеты, трансформер по разрезу ---------- #}
  SELECT k.1 AS role, k.2 AS id, k.3 AS pid,
    toInt64(if(k.1 = 'f', hc_last, 0)) AS n, '' AS j,
    {% for c in COMP %}{{ out('s_m_' ~ c) }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}{{ out('s_w_' ~ c) }} AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT k,
      {% for c in COMP %}sumForEach(if(k.1 IN ('base', 'scope', 'c', 'g', 'tr'), mv_{{ c }}, emptyArrayInt64())) AS s_m_{{ c }},
      {% endfor %}
      {% for c in COMP %}sumForEach(if(k.1 IN ('base', 'scope', 'c', 'g'), wv_{{ c }}, emptyArrayInt64())) AS s_w_{{ c }},
      {% endfor %}
      sum(hc_now_row) AS hc_last
    FROM (
      SELECT
        arrayMap(x -> ifNull(x, ''), path) AS p,
        {% for c in COMP %}{{ arr('m_' ~ src(c)) }} AS mv_{{ c }},
        {% endfor %}
        {% for c in COMP %}{{ arr('w_' ~ src(c)) }} AS wv_{{ c }},
        {% endfor %}
        toInt64(ifNull(arrayElement(m_hc, ctx.last_m + 1), 0)) AS hc_now_row,
        ({{ cond('') }}) AS ok_all,
        hasAny(p, ctx.scope) AS in_scope,
        arrayFirstIndex(x -> has(ctx.scope, x), p) AS pos,
        toUInt32(if(ctx.single, pos + 1, pos)) AS cpos,
        arrayElement(p, cpos) AS child,
        arrayElement(p, cpos + 1) AS gchild,
        arrayJoin(arrayConcat(
          if(ok_all, [('base', '', '')], [])
          , if(ok_all AND in_scope, [('scope', '', ''), ('c', if(child = '', '·', child), '')], [])
          , if(ok_all AND in_scope AND child != '', [('g', if(gchild = '', '·', gchild), child)], [])
          {% for c in CUT_COLS %}, if(in_scope AND ({{ cond(c) }}), [('f', ifNull({{ c }}, '-'), '{{ c }}')], [])
          {% endfor %}
          {%- if axis in CUT_COLS %}, if(ok_all AND in_scope, [('tr', ifNull({{ axis }}, '-'), '')], []){% endif %}
        )) AS k
      FROM prod_proteus.hrbp_hub_cube
      CROSS JOIN ctx
      WHERE notEmpty(ctx.roots)
    )
    GROUP BY k
  )
{%- if axis in ATTRS %}

  UNION ALL
  {#- ---------- трансформер по атрибуту сотрудника (грейд, стаж, город…) ---------- #}
  SELECT 'tr' AS role, v AS id, '' AS pid, toInt64(0) AS n, '' AS j,
    {% for c in COMP %}{{ out('s_m_' ~ c) }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}'' AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT ifNull(attr_v, '-') AS v,
      {% for c in COMP %}sumForEach({{ arr('m_' ~ src(c)) }}) AS s_m_{{ c }}{% if not loop.last %},{% endif %}
      {% endfor %}
    FROM prod_proteus.hrbp_hub_attr
    CROSS JOIN ctx
    WHERE ifNull(attr_k, '') = '{{ axis }}'
      AND hasAny(arrayMap(x -> ifNull(x, ''), path), ctx.scope)
      AND ({{ cond('') }})
      AND notEmpty(ctx.roots)
    GROUP BY v
  )
{%- endif %}

  UNION ALL
  {#- ---------- справочник юнитов зоны (и предков корней — для пути в шапке) ---------- #}
  SELECT 'dict' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, {{ empty_cols() }}
  FROM (
    SELECT concat(ifNull(id, ''), '\t', ifNull(pid, ''), '\t', toString(ifNull(lvl, 0)), '\t',
                  toString(ifNull(hc_now, 0)), '\t', toString(ifNull(is_current, 0)), '\t', ifNull(rk, ''), '\t',
                  replaceRegexpAll(ifNull(nm, ''), '[\\t\\n\\r]', ' ')) AS line
    FROM prod_proteus.hrbp_hub_unit
    CROSS JOIN ctx
    WHERE notEmpty(ctx.roots)
      AND (hasAny(arrayMap(x -> ifNull(x, ''), path), ctx.roots) OR has(ctx.anc, ifNull(id, '')))
  )
  HAVING count() > 0

  UNION ALL
  {#- ---------- HRBP, чьи зоны целиком внутри моей: быстрый выбор зоны ---------- #}
  SELECT 'hrbps' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, {{ empty_cols() }}
  FROM (
    SELECT concat(lg, '\t', nm, '\t', arrayStringConcat(rs, ','), '\t', toString(hc)) AS line
    FROM (
      SELECT ifNull(x.login, '') AS lg, any(ifNull(x.hrbp_nm, '')) AS nm,
             groupArray(ifNull(x.root_id, '')) AS rs, toInt64(sum(ifNull(u.hc_now, 0))) AS hc,
             min(toUInt8(hasAny(arrayMap(y -> ifNull(y, ''), u.path), ctx.roots))) AS vis
      FROM prod_proteus.hrbp_hub_access x
      INNER JOIN prod_proteus.hrbp_hub_unit u ON ifNull(u.id, '') = ifNull(x.root_id, '')
      CROSS JOIN ctx
      WHERE ifNull(x.role, '') = 'hrbp' AND notEmpty(ctx.roots)
      GROUP BY lg
    )
    WHERE vis = 1
  )
  HAVING count() > 0

  UNION ALL
  {#- ---------- цели: на юнитах зоны и на предках её корней (наследуются вниз) ---------- #}
  SELECT 'kpi' AS role, ifNull(rule_id, '') AS id, ifNull(unit_id, '') AS pid, toInt64(0) AS n,
    concat(ifNull(metric_id, ''), '\t', toString(ifNull(target, 0)), '\t',
           ifNull(f_paint, 'all'), '\t', ifNull(f_it, 'all'), '\t', ifNull(f_stream, 'all'), '\t',
           ifNull(f_spec, 'all'), '\t', ifNull(f_staff, 'all'), '\t', ifNull(f_hct, 'all'), '\t',
           ifNull(toString(valid_from), ''), '\t', ifNull(toString(valid_to), ''), '\t',
           replaceRegexpAll(ifNull(author, ''), '[\\t\\n\\r]', ' '), '\t',
           replaceRegexpAll(ifNull(note, ''), '[\\t\\n\\r]', ' '), '\t', ifNull(unit_rk, '')) AS j,
    {{ empty_cols() }}
  FROM prod_proteus.hrbp_hub_kpi
  CROSS JOIN ctx
  WHERE notEmpty(ctx.roots)
    AND (hasAny(arrayMap(x -> ifNull(x, ''), unit_path), ctx.roots) OR has(ctx.anc, ifNull(unit_id, '')))

  UNION ALL
  {#- ---------- эхо и календарь: по нему чарт понимает, что именно применилось ---------- #}
  SELECT 'meta' AS role, '' AS id, '' AS pid, toInt64(0) AS n,
    concat('{',
      '"me":', toJSONString({{ qs(me) }}),
      ',"role":', toJSONString(ctx.my_role),
      ',"roots":', toJSONString(ctx.roots),
      ',"scope":', toJSONString(ctx.scope),
      ',"req_unit":', toJSONString({{ qa(unit_req) }}),
      {% for c in CUT_COLS %}',"f_{{ c }}":', toJSONString({{ qa(F[c]) }}),
      {% endfor %}
      ',"axis":', toJSONString('{{ axis }}'),
      ',"ret_base":', toJSONString('{{ 'active' if RA else 'company' }}'),
      ',"last_m":', toString(ctx.last_m),
      ',"cal":', (SELECT toJSONString(arrayMap(t -> t.3, arraySort(groupArray(tuple(
                        ifNull(grain, '') = 'w', ifNull(idx, 0),
                        concat(ifNull(grain, ''), '|', toString(ifNull(idx, 0)), '|',
                               ifNull(toString(slot_start), ''), '|', ifNull(toString(slot_end), ''), '|',
                               toString(ifNull(is_closed, 0)), '|', ifNull(toString(data_dt), '')))))))
                  FROM prod_proteus.hrbp_hub_calendar),
    '}') AS j,
    {{ empty_cols() }}
  FROM ctx
)
