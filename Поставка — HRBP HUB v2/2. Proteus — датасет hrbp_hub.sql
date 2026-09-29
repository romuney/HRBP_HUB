{#- ============================================================================
    hrbp_hub — датасет ЕДИНСТВЕННОГО чарта отчёта HRBP HUB (Proteus, база CROSS).

    Один ответ везёт всё, что экрану может понадобиться до следующей смены юнита
    или разрезов: сводку, команды на 3 уровня вниз (или все уровни — depth_f), базу
    сравнения, цели, фасеты фильтров, справочник юнитов и HRBP для выбора и календарь.
    Всё остальное — вкладки, раскрытие строк «Команд», «год / 12 недель», клик по
    команде, наследование целей, светофор — считает чарт без запроса.

    Строки различаются колонкой role:
      meta   1 строка — эхо применённых условий, доступ, календарь слотов (j = JSON)
      dict   1 строка — юниты пакетом: id, родитель, уровень, численность сейчас,
             текущий ли, rk, имя, число детей (j: поля через \t, строки через \n).
             Зона до DICT_FULL_MAX юнитов — целиком; больше (супер-HRBP, админ на
             100 тыс. сотрудников) — путь до юнита с соседями, вся выбранная область, если
             она не больше DICT_FULL_MAX (иначе — дерево «Команд»: 3 уровня или все), корни
             с детьми, корни зон HRBP, найденное поиском q_f (сначала — внутри области)
      hrbps  1 строка — HRBP, чьи зоны внутри моей: логин, имя, корни, численность,
             пути корней (по ним чарт строит дерево «кто под кем»)
      base   вся компания под выбранными разрезами — база сравнения (hrbp_hub_base)
      scope  выбранный юнит (или объединение корней зоны)
      c      узлы на уровень ниже (строки «Команд»); '·' — сотрудники прямо в юните
      g      на два уровня ниже, pid = узел −1; '·' — прямо в узле −1
      x      третий уровень вниз и глубже: pid = путь родителя от узла −1 через '/'; '·' — прямо в нём
      f      фасеты фильтров: id = значение, pid = разрез, n = численность на конец
             последнего закрытого месяца при ОСТАЛЬНЫХ разрезах
      tr     разбивка по оси трансформеров (только когда tr_f задан), только месяцы
      kpi    правила целей: id = rule_id, pid = юнит, j = поля через \t
    Массивы m_* — 24 месяца, w_* — 24 недели (позиция = idx календаря), строкой
    через запятую. Проценты не храним: чарт делит числитель на знаменатель.

    Кросс-фильтры (эмитит сам чарт, самовлияние ВКЛЮЧЕНО): unit_f — id юнитов;
    paint_f / it_f / stream_f / spec_f / staff_f / hct_f — значения разрезов;
    tr_f — ось трансформеров; depth_f — глубина «Команд» ('all' — все уровни); q_f —
    поиск юнита по имени (большие зоны). Колонки-носители в SELECT не выводятся
    (иначе Superset повесит авто-IN на внешний запрос). Доступ — current_username():
    юниты вне зоны пользователя не приезжают ни в каком виде.

    Масштаб: куб читается только в поддереве выбранного юнита (ORDER BY path_s —
    ветка лежит подряд, условие по пути уходит в PREWHERE), база — из крошечной
    hrbp_hub_base, а не суммой всего куба.
============================================================================ -#}
{% set CUTS = [['paint', 'paint_f'], ['it', 'it_f'], ['stream', 'stream_f'], ['spec', 'spec_f'], ['staff', 'staff_f'], ['hct', 'hct_f']] %}
{% set CUT_COLS = ['paint', 'it', 'stream', 'spec', 'staff', 'hct'] %}
{% set ATTRS = ['grade', 'seniority', 'exp', 'gender', 'age', 'office', 'work', 'head', 'legal', 'macro', 'city'] %}
{% set COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire'] %}
{#- Зона до стольких юнитов уходит в справочник целиком (поиск — в чарте, мгновенно). -#}
{% set DICT_FULL_MAX = 1500 %}
{#- Строковый литерал ClickHouse: обратный слэш и кавычка экранируются. -#}
{% macro qs(v) -%}'{{ v|string|replace('\\', '\\\\')|replace("'", "\\'") }}'{%- endmacro %}
{#- Список для IN по ключу таблицы (id): индекс ClickHouse берёт его сразу. -#}
{% macro qt(values) -%}({% for v in values %}{{ qs(v) }}{% if not loop.last %}, {% endif %}{% endfor %}){%- endmacro %}
{#- Массив строк: для has()/hasAny(); пустой — типизированный. -#}
{% macro qa(values) -%}
{%- if values|length == 0 -%}CAST([], 'Array(String)'){%- else -%}[{% for v in values %}{{ qs(v) }}{% if not loop.last %}, {% endif %}{% endfor %}]{%- endif -%}
{%- endmacro %}
{#- Значения фильтров: список собирается циклом — при сохранении датасета Proteus
    отдаёт вместо списка AlwaysTrueObject, у него нет длины и «+» не определён. -#}
{% set me = (current_username() or '')|string|trim|lower %}
{% set unit_req = [] %}{% for v in (filter_values('unit_f') or []) %}{% if v|string|trim != '' and unit_req|length < 50 %}{% set _ = unit_req.append(v|string|trim) %}{% endif %}{% endfor %}
{#- Глубина «Команд»: 3 уровня вниз; 'all' — до 12-го уровня, если в ветке юнита не больше
    ALL_MAX юнитов (иначе ответ — мегабайты: у каждой строки 24 ряда по 24 точки). -#}
{% set ALL_MAX = 1000 %}
{% set DEEP = 10 %}
{% set depth_req = 'all' if (filter_values('depth_f')|first|default('', true))|string == 'all' else '3' %}
{% set D = DEEP if depth_req == 'all' else 3 %}
{% set q_req = [] %}{% for v in (filter_values('q_f') or []) %}{% if v|string|trim != '' and q_req|length < 1 %}{% set _ = q_req.append((v|string|trim)[:60]) %}{% endif %}{% endfor %}
{% set q = q_req|first|default('', true) %}
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
    and CTE»). CTE инлайнится в каждое плечо, но таблицы здесь маленькие. #}
{#- Контекст запроса. Каждое плечо ниже подставляет CTE заново (ClickHouse их не
    материализует), поэтому цепочка короткая: доступ → юниты по ключу → область. #}
WITH
  acc AS (
    SELECT arrayDistinct(if(notEmpty(r_all), r_all, r_zone)) AS roots,
           multiIf(has(rl, 'super'), 'super', has(rl, 'admin'), 'admin', notEmpty(r_zone), 'hrbp', 'none') AS my_role
    FROM (
      SELECT groupArrayIf(ifNull(root_id, ''), ifNull(role, '') IN ('super', 'admin')) AS r_all,
             groupArrayIf(ifNull(root_id, ''), ifNull(role, '') = 'hrbp') AS r_zone,
             groupArray(ifNull(role, '')) AS rl
      FROM prod_proteus.hrbp_hub_access
      WHERE login = {{ qs(me) }}
    )
  ),
  {#- Запрошенные юниты (только из моей зоны), предки корней (путь в шапке, цели
      сверху) и размер зоны в юнитах (sub_n корней) — одним проходом по ключу id. -#}
  un AS (
    SELECT groupArrayIf(uid, has({{ qa(unit_req) }}, uid) AND hasAny(p, acc.roots)) AS req_ok,
           groupUniqArrayArrayIf(p, has(acc.roots, uid)) AS anc,
           toInt64(sumIf(ifNull(sub_n, 1), has(acc.roots, uid))) AS zone_n
    FROM (
      SELECT ifNull(id, '') AS uid, arrayMap(x -> ifNull(x, ''), path) AS p, sub_n
      FROM prod_proteus.hrbp_hub_unit
      WHERE {% if unit_req %}id IN {{ qt(unit_req) }} OR {% endif %}id IN (SELECT arrayJoin(roots) FROM acc)
    ) AS uu
    CROSS JOIN acc
  ),
  lm AS (
    SELECT toInt64(max(ifNull(idx, 0))) AS last_m
    FROM prod_proteus.hrbp_hub_calendar
    WHERE ifNull(grain, '') = 'm' AND ifNull(is_closed, 0) = 1
  ),
  ctx AS (
    SELECT acc.roots AS roots, acc.my_role AS my_role,
           if(empty(un.req_ok), acc.roots, arraySort(un.req_ok)) AS scope,
           length(scope) = 1 AS single,
           un.anc AS anc, un.zone_n AS zone_n, lm.last_m AS last_m
    FROM acc CROSS JOIN un CROSS JOIN lm
  ),
  {#- Пути до выбранного юнита — для справочника; lo / hi — диапазон ключа куба (path_s),
      в котором лежит ветка юнита: куб читается только в нём. scope_n — юнитов в ветке;
      depth — сколько уровней «Команд» реально отдаём (3 или DEEP). -#}
  ex AS (
    SELECT groupUniqArrayArrayIf(p, has(ctx.scope, uid)) AS sanc,
           minIf(arrayStringConcat(p, '/'), has(ctx.scope, uid)) AS lo,
           maxIf(concat(arrayStringConcat(p, '/'), '0'), has(ctx.scope, uid)) AS hi,
           toInt64(sumIf(ifNull(sub_n, 1), has(ctx.scope, uid))) AS scope_n,
           toUInt32(if({{ '1' if depth_req == 'all' else '0' }} = 1 AND scope_n <= {{ ALL_MAX }}, {{ DEEP }}, 3)) AS depth
    FROM (
      SELECT ifNull(id, '') AS uid, arrayMap(x -> ifNull(x, ''), path) AS p, sub_n
      FROM prod_proteus.hrbp_hub_unit
      WHERE id IN (SELECT arrayJoin(scope) FROM ctx)
    ) AS ue
    CROSS JOIN ctx
  )
SELECT role, id, pid, n, j,
  {% for c in COMP %}m_{{ c }}, {% endfor %}{% for c in COMP %}w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
FROM (

  {#- ---------- куб, дерево «Команд»: юнит и D уровней вниз одним проходом (ROLLUP) ----------
      k1…kD — узлы пути ниже выбранного юнита (у зоны из нескольких корней k1 — сам корень);
      где путь кончился — '·' (сотрудники прямо в узле). Свёрнутые ROLLUP ключи пустые, поэтому
      уровень строки lv = число непустых ключей: 0 — юнит, 1 — c, 2 — g, 3 и глубже — x.
      pid — путь родителя от −1 через '/' (у g это просто узел −1): после реорганизации один
      юнит бывает под двумя родителями, и его дети считаются отдельно в каждом месте дерева.
      '·' после '·' — повтор и отбрасывается; '·' у узла
      без других детей — тоже: «Напрямую в …» нужна только рядом с подразделениями. ifNull —
      на случай group_by_use_nulls = 1. D = 3; при depth_f = 'all' — DEEP (до 12-го уровня),
      но ключи глубже 3 оживают, только если ex.depth это разрешил (ветка ≤ ALL_MAX юнитов). #}
  SELECT multiIf(lv = 0, 'scope', lv = 1, 'c', lv = 2, 'g', 'x') AS role, id, pid,
    toInt64(0) AS n, '' AS j,
    {% for c in COMP %}{{ out('s_m_' ~ c) }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}{{ out('s_w_' ~ c) }} AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT lv, id, pid, count() OVER (PARTITION BY lv, pid) AS sib,
      {% for c in COMP %}s_m_{{ c }}, {% endfor %}{% for c in COMP %}s_w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
    FROM (
      SELECT toUInt32(length(arrayFilter(x -> x != '', ks))) AS lv,
        arrayElement(ks, lv) AS id,
        if(lv <= 1, '', arrayStringConcat(arraySlice(ks, 1, lv - 1), '/')) AS pid,
        {% for c in COMP %}s_m_{{ c }}, {% endfor %}{% for c in COMP %}s_w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
      FROM (
        SELECT [{% for i in range(D) %}ifNull(k{{ i + 1 }}, ''){% if not loop.last %}, {% endif %}{% endfor %}] AS ks,
          {% for c in COMP %}sumForEach(mv_{{ c }}) AS s_m_{{ c }},
          {% endfor %}
          {% for c in COMP %}sumForEach(wv_{{ c }}) AS s_w_{{ c }}{% if not loop.last %},{% endif %}
          {% endfor %}
        FROM (
          SELECT
            arrayMap(x -> ifNull(x, ''), cb.path) AS p,
            {% for c in COMP %}{{ arr('m_' ~ src(c)) }} AS mv_{{ c }},
            {% endfor %}
            {% for c in COMP %}{{ arr('w_' ~ src(c)) }} AS wv_{{ c }},
            {% endfor %}
            arrayFirstIndex(x -> has(ctx.scope, x), p) AS pos,
            arraySlice(p, if(ctx.single, pos + 1, pos)) AS rel,
            {% for i in range(D) %}if(length(rel) > {{ i }}{% if i >= 3 %} AND ex.depth > {{ i }}{% endif %}, arrayElement(rel, {{ i + 1 }}), '·') AS k{{ i + 1 }}{% if not loop.last %},
            {% endif %}{% endfor %}
          FROM (
            SELECT *
            FROM prod_proteus.hrbp_hub_cube
            WHERE path_s >= tupleElement((SELECT (lo, hi) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi) FROM ex), 2)
          ) AS cb
          CROSS JOIN ctx{% if D > 3 %}
          CROSS JOIN ex{% endif %}
          WHERE notEmpty(ctx.roots)
            AND hasAny(arrayMap(x -> ifNull(x, ''), cb.path), ctx.scope)
            AND ({{ cond('') }})
        )
        GROUP BY {% for i in range(D) %}k{{ i + 1 }}{% if not loop.last %}, {% endif %}{% endfor %} WITH ROLLUP
      )
      WHERE (lv <= 1 OR arrayElement(ks, lv - 1) != '·'){% if D > 3 %}
        AND lv <= (SELECT depth FROM ex){% endif %}
    )
  )
  WHERE NOT (id = '·' AND sib = 1)

  UNION ALL
  {#- ---------- фасеты фильтров: численность значений при ОСТАЛЬНЫХ разрезах, без массивов ---------- #}
  SELECT 'f' AS role, fv.2 AS id, fv.1 AS pid, sum(hn) AS n, '' AS j, {{ empty_cols() }}
  FROM (
    SELECT toInt64(ifNull(arrayElement(cb.m_hc, ctx.last_m + 1), 0)) AS hn,
      arrayJoin(arrayConcat(
        {% for c in CUT_COLS %}if({{ cond(c) }}, [('{{ c }}', ifNull(cb.{{ c }}, '-'))], []){% if not loop.last %},
        {% endif %}{% endfor %}
      )) AS fv
    FROM (
      SELECT path, m_hc, {{ CUT_COLS|join(', ') }}
      FROM prod_proteus.hrbp_hub_cube
      WHERE path_s >= tupleElement((SELECT (lo, hi) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi) FROM ex), 2)
    ) AS cb
    CROSS JOIN ctx
    WHERE notEmpty(ctx.roots)
      AND hasAny(arrayMap(x -> ifNull(x, ''), cb.path), ctx.scope)
  )
  GROUP BY fv
{%- if axis in CUT_COLS %}

  UNION ALL
  {#- ---------- трансформер по разрезу численности ---------- #}
  SELECT 'tr' AS role, v AS id, '' AS pid, toInt64(0) AS n, '' AS j,
    {% for c in COMP %}{{ out('s_m_' ~ c) }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}'' AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT ifNull(cb.{{ axis }}, '-') AS v,
      {% for c in COMP %}sumForEach({{ arr('cb.m_' ~ src(c)) }}) AS s_m_{{ c }}{% if not loop.last %},{% endif %}
      {% endfor %}
    FROM (
      SELECT *
      FROM prod_proteus.hrbp_hub_cube
      WHERE path_s >= tupleElement((SELECT (lo, hi) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi) FROM ex), 2)
    ) AS cb
    CROSS JOIN ctx
    WHERE notEmpty(ctx.roots)
      AND hasAny(arrayMap(x -> ifNull(x, ''), cb.path), ctx.scope)
      AND ({{ cond('') }})
    GROUP BY v
  )
{%- endif %}

  UNION ALL
  {#- ---------- база сравнения: вся компания под теми же разрезами, без пути ---------- #}
  SELECT 'base' AS role, '' AS id, '' AS pid, toInt64(0) AS n, '' AS j,
    {% for c in COMP %}{{ out('b_m_' ~ c) }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}{{ out('b_w_' ~ c) }} AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT
      {% for c in COMP %}sumForEach({{ arr('m_' ~ src(c)) }}) AS b_m_{{ c }},
      {% endfor %}
      {% for c in COMP %}sumForEach({{ arr('w_' ~ src(c)) }}) AS b_w_{{ c }}{% if not loop.last %},{% endif %}
      {% endfor %}
    FROM prod_proteus.hrbp_hub_base
    CROSS JOIN ctx
    WHERE notEmpty(ctx.roots) AND ({{ cond('') }})
    HAVING count() > 0
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
    FROM (
      SELECT *
      FROM prod_proteus.hrbp_hub_attr
      WHERE attr_k = '{{ axis }}'
        AND path_s >= tupleElement((SELECT (lo, hi) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi) FROM ex), 2)
    ) AS ab
    CROSS JOIN ctx
    WHERE hasAny(arrayMap(x -> ifNull(x, ''), ab.path), ctx.scope)
      AND ({{ cond('') }})
      AND notEmpty(ctx.roots)
    GROUP BY v
  )
{%- endif %}

  UNION ALL
  {#- ---------- справочник юнитов: зона целиком или путь + окрестность юнита ---------- #}
  SELECT 'dict' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, {{ empty_cols() }}
  FROM (
    SELECT concat(ifNull(u.id, ''), '\t', ifNull(u.pid, ''), '\t', toString(ifNull(u.lvl, 0)), '\t',
                  toString(ifNull(u.hc_now, 0)), '\t', toString(ifNull(u.is_current, 0)), '\t', ifNull(u.rk, ''), '\t',
                  replaceRegexpAll(ifNull(u.nm, ''), '[\\t\\n\\r]', ' '), '\t', toString(ifNull(u.kids_n, 0))) AS line
    FROM prod_proteus.hrbp_hub_unit u
    CROSS JOIN ctx
    CROSS JOIN ex
    WHERE notEmpty(ctx.roots)
      AND (has(ctx.anc, ifNull(u.id, ''))
           OR (hasAny(arrayMap(x -> ifNull(x, ''), u.path), ctx.roots)
               AND (ctx.zone_n <= {{ DICT_FULL_MAX }}
                    {# выбранная область (юнит или зона HRBP) не больше DICT_FULL_MAX — целиком:
                       дерево выбора юнита в ней полное, поиск по ней — в чарте, без запроса #}
                    OR (ex.scope_n <= {{ DICT_FULL_MAX }} AND hasAny(arrayMap(x -> ifNull(x, ''), u.path), ctx.scope))
                    OR has(ex.sanc, ifNull(u.id, ''))
                    OR has(ex.sanc, ifNull(u.pid, ''))
                    OR has(ctx.roots, ifNull(u.pid, ''))
                    {#- всё дерево «Команд»: юнит встречается в пути не дальше depth шагов вверх -#}
                    OR hasAny(arraySlice(arrayMap(x -> ifNull(x, ''), u.path),
                                         greatest(toInt64(length(u.path)) - ex.depth, 1),
                                         least(toInt64(ex.depth), toInt64(length(u.path)) - 1)), ctx.scope)
                    OR ifNull(u.id, '') IN (SELECT ifNull(unit_id, '') FROM prod_proteus.hrbp_hub_kpi)
                    OR ifNull(u.id, '') IN (SELECT ifNull(root_id, '') FROM prod_proteus.hrbp_hub_access
                                            WHERE ifNull(role, '') = 'hrbp')
                    {%- if q %}
                    OR has((SELECT groupUniqArrayArray(pp) FROM (
                              SELECT arrayMap(x -> ifNull(x, ''), h.path) AS pp
                              FROM prod_proteus.hrbp_hub_unit h CROSS JOIN ctx
                              WHERE positionCaseInsensitiveUTF8(ifNull(h.nm, ''), {{ qs(q) }}) > 0
                                AND hasAny(arrayMap(x -> ifNull(x, ''), h.path), ctx.roots)
                              {# сначала найденное внутри выбранной области (зоны HRBP), потом остальное #}
                              ORDER BY hasAny(arrayMap(x -> ifNull(x, ''), h.path), ctx.scope) DESC, ifNull(h.lvl, 0), ifNull(h.nm, '')
                              LIMIT 60)), ifNull(u.id, ''))
                    {%- endif %})))
  )
  HAVING count() > 0

  UNION ALL
  {#- ---------- HRBP, чьи зоны целиком внутри моей: выбор зоны; пути корней — для дерева «кто под кем» ---------- #}
  SELECT 'hrbps' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, {{ empty_cols() }}
  FROM (
    SELECT concat(lg, '\t', nm, '\t', arrayStringConcat(rs, ','), '\t', toString(hc), '\t',
                  arrayStringConcat(arrayMap(pp -> arrayStringConcat(pp, '/'), ps), ',')) AS line
    FROM (
      SELECT ifNull(x.login, '') AS lg, any(ifNull(x.hrbp_nm, '')) AS nm,
             groupArray(ifNull(x.root_id, '')) AS rs, toInt64(sum(ifNull(u.hc_now, 0))) AS hc,
             groupArray(arrayMap(y -> ifNull(y, ''), u.path)) AS ps,
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
    {#- Юнит цели в зоне — по пути из справочника, а не по unit_path цели: реестр целей
        выгружается без array_type_cast, и unit_path в ClickHouse — строка, не массив. #}
    AND (has(ctx.anc, ifNull(unit_id, ''))
         OR ifNull(unit_id, '') IN (SELECT ifNull(z.id, '') FROM prod_proteus.hrbp_hub_unit z CROSS JOIN ctx
                                    WHERE hasAny(arrayMap(x -> ifNull(x, ''), z.path), ctx.roots)))

  UNION ALL
  {#- ---------- эхо и календарь: по нему чарт понимает, что именно применилось ---------- #}
  SELECT 'meta' AS role, '' AS id, '' AS pid, toInt64(0) AS n,
    concat('{',
      '"me":', toJSONString({{ qs(me) }}),
      ',"role":', toJSONString(ctx.my_role),
      ',"roots":', toJSONString(ctx.roots),
      ',"scope":', toJSONString(ctx.scope),
      ',"req_unit":', toJSONString({{ qa(unit_req) }}),
      ',"depth_req":', toJSONString('{{ depth_req }}'),
      ',"depth":', toJSONString(if(ex.depth > 3, 'all', '3')),
      ',"scope_n":', toString(ex.scope_n),
      ',"all_max":', toString({{ ALL_MAX }}),
      ',"q":', toJSONString({{ qs(q) }}),
      ',"zone_n":', toString(ctx.zone_n),
      ',"dict_mode":', toJSONString(if(ctx.zone_n <= {{ DICT_FULL_MAX }}, 'full', 'part')),
      ',"scope_full":', toString(if(ctx.zone_n <= {{ DICT_FULL_MAX }} OR ex.scope_n <= {{ DICT_FULL_MAX }}, 1, 0)),
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
  FROM ctx CROSS JOIN ex
)
