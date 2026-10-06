{#- ============================================================================
    hrbp_hub — датасет ЕДИНСТВЕННОГО чарта отчёта HRBP HUB (Proteus, база CROSS).

    Один ответ везёт всё, что экрану может понадобиться до следующей смены юнита
    или разрезов: сводку, команды на 3 уровня вниз (или все уровни — depth_f), базу
    сравнения, цели, фасеты фильтров, трансформеры по всем осям, справочник юнитов и
    HRBP для выбора и календарь. Всё остальное — вкладки, раскрытие строк «Команд»,
    «год / 12 недель», клик по команде, ось и метрика трансформеров, наследование целей,
    светофор — считает чарт без запроса.

    Строки различаются колонкой role:
      meta   1 строка — эхо применённых условий, доступ, календарь слотов (j = JSON)
      dict   1 строка — юниты пакетом: id, родитель, уровень, численность сейчас,
             текущий ли, (пусто — rk приезжает в meta для выбранного юнита), имя, число
             детей (j: поля через \t, строки через \n). Вся зона логина на всю глубину и
             предки её корней — всегда: выбор и поиск юнита в чарте идут без запроса
      hrbps  1 строка — HRBP, чьи зоны внутри моей: логин, имя, корни, численность,
             пути корней (по ним чарт строит дерево «кто под кем»)
      base   вся компания под выбранными разрезами — база сравнения (hrbp_hub_base)
      scope  выбранный юнит (или объединение корней зоны)
      c      узлы на уровень ниже (строки «Команд»); '·' — сотрудники прямо в юните
      g      на два уровня ниже, pid = узел −1; '·' — прямо в узле −1
      x      третий уровень вниз и глубже: pid = путь родителя от узла −1 через '/'; '·' — прямо в нём
      f      фасеты фильтров: id = значение, pid = разрез, n = численность на конец
             последнего закрытого месяца при ОСТАЛЬНЫХ разрезах
      tr     трансформеры, все 17 осей разом: pid — ось, id — значение. 6 разрезов — из
             прохода фасетов; 11 атрибутов — из свёртки hrbp_hub_attr_top, когда разрезы не
             выбраны и у открытых юнитов она есть (корни зон, компания, блоки, большие ветки),
             иначе — из листового куба ветки. У атрибута — до TR_TOP значений, хвост —
             строкой '…' (n — сколько в ней значений). Массивы — 12 последних закрытых
             месяцев, прочие слоты — нули
      kpi    правила целей: id = rule_id, pid = юнит, j = поля через \t
      end    1 строка-маркер «ответ целиком»: всегда последняя
    Массивы m_* — 24 месяца, w_* — 24 недели (позиция = idx календаря), строкой
    через запятую. Проценты не храним: чарт делит числитель на знаменатель.

    Порядок строк задан (ORDER BY по роли): meta, f, scope, base, kpi, hrbps, dict, c, g,
    tr, x, end. Proteus оборачивает датасет в SELECT … LIMIT «лимит строк чарта» и молча
    отрезает хвост: так первыми уходят третий уровень «Команд», а не значения фильтров и
    служебные строки (06.10 в бою пропали значения фильтров: плечо фасетов досчитывается
    последним, и его строки шли в хвосте — на стенде воспроизведено). Нет строки end — ответ
    обрезан, чарт говорит об этом сам.

    Кросс-фильтры (эмитит сам чарт, самовлияние ВКЛЮЧЕНО): unit_f — id юнитов;
    paint_f / it_f / stream_f / spec_f / staff_f / hct_f — значения разрезов;
    tr_f — атрибут трансформеров (запасной режим TR_ALL_MAX: большая ветка с разрезами);
    depth_f — глубина «Команд» ('all' — все уровни, в запасе). Колонки-носители в SELECT не выводятся
    (иначе Superset повесит авто-IN на внешний запрос). Доступ — current_username():
    юниты вне зоны пользователя не приезжают ни в каком виде.

    Масштаб: куб читается только в поддереве выбранного юнита (ORDER BY path_s —
    ветка лежит подряд, условие по пути уходит в PREWHERE), база — из крошечной
    hrbp_hub_base, а не суммой всего куба, атрибуты открытого по умолчанию юнита — из
    готовой свёртки (сотни строк вместо сотен тысяч).
============================================================================ -#}
{% set CUTS = [['paint', 'paint_f'], ['it', 'it_f'], ['stream', 'stream_f'], ['spec', 'spec_f'], ['staff', 'staff_f'], ['hct', 'hct_f']] %}
{% set CUT_COLS = ['paint', 'it', 'stream', 'spec', 'staff', 'hct'] %}
{% set ATTRS = ['grade', 'seniority', 'exp', 'gender', 'age', 'office', 'work', 'head', 'legal', 'macro', 'city'] %}
{% set COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire'] %}
{#- Трансформеры: все 11 атрибутов в каждом ответе. Без разрезов — из свёртки (если она есть
    у открытых юнитов), с разрезами — из листового куба ветки, пока в ней не больше TR_ALL_MAX
    юнитов. По умолчанию предела нет; запасной режим — TR_ALL_MAX = 1500: большая ветка с
    разрезами получит атрибут по запросу (tr_f), чарт это понимает сам. -#}
{% set TR_ALL_MAX = 1000000 %}
{#- У атрибута — не больше TR_TOP значений по численности, остальные — одной строкой '…'
    (город, офис: сотни значений раздули бы ответ зоны в разы). -#}
{% set TR_TOP = 30 %}
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
{% set F = {} %}
{% for c in CUTS %}{% set vals = [] %}{% for v in (filter_values(c[1]) or []) %}{% if v|string != '' and vals|length < 200 %}{% set _ = vals.append(v|string) %}{% endif %}{% endfor %}{% set _ = F.update({c[0]: vals}) %}{% endfor %}
{#- Выбран ли хоть один разрез: без разрезов атрибуты берутся из свёртки. -#}
{% set ANYCUT = [] %}{% for c in CUT_COLS %}{% if F[c]|length > 0 %}{% set _ = ANYCUT.append(c) %}{% endif %}{% endfor %}
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
  {#- Область: lo / hi — диапазон ключа куба (path_s), в котором лежит её ветка (куб читается
      только в нём); scope_n — юнитов в ветке; depth — сколько уровней «Команд» отдаём (3 или
      DEEP). smin — юниты области без предка в ней же; если у всех есть свёртка атрибутов
      (attr_top) и разрезы не выбраны, tops = smin: атрибуты читаются из свёртки, а диапазон
      листового куба атрибутов (alo / ahi) пустой. rk1 — rk выбранного юнита (строка реестра целей). -#}
  ex AS (
    SELECT lo, hi, scope_n, depth, rk1,
           if({{ '0' if ANYCUT else '1' }} = 1 AND top_all = 1, smin, CAST([], 'Array(String)')) AS tops,
           if(notEmpty(tops) OR scope_n > {{ TR_ALL_MAX }}, '', lo) AS alo,
           if(notEmpty(tops) OR scope_n > {{ TR_ALL_MAX }}, '', hi) AS ahi
    FROM (
      SELECT minIf(arrayStringConcat(p, '/'), has(ctx.scope, uid)) AS lo,
             maxIf(concat(arrayStringConcat(p, '/'), '0'), has(ctx.scope, uid)) AS hi,
             toInt64(sumIf(ifNull(sub_n, 1), has(ctx.scope, uid))) AS scope_n,
             toUInt32(if({{ '1' if depth_req == 'all' else '0' }} = 1 AND scope_n <= {{ ALL_MAX }}, {{ DEEP }}, 3)) AS depth,
             groupArrayIf(uid, has(ctx.scope, uid) AND NOT hasAny(arrayPopBack(p), ctx.scope)) AS smin,
             minIf(toUInt8(ifNull(attr_top, 0) = 1), has(ctx.scope, uid) AND NOT hasAny(arrayPopBack(p), ctx.scope)) AS top_all,
             anyIf(urk, has(ctx.scope, uid)) AS rk1
      FROM (
        SELECT ifNull(id, '') AS uid, arrayMap(x -> ifNull(x, ''), path) AS p, sub_n, attr_top, ifNull(rk, '') AS urk
        FROM prod_proteus.hrbp_hub_unit
        WHERE id IN (SELECT arrayJoin(scope) FROM ctx)
      ) AS ue
      CROSS JOIN ctx
    )
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
            WHERE path_s >= tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 2)
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
  {#- ---------- фасеты фильтров и трансформер по разрезам — один проход по кубу ветки ----------
      Пара «разрез, значение» идёт в фасет, если строка куба проходит ОСТАЛЬНЫЕ разрезы (cond(c)),
      и в трансформер — если проходит ВСЕ (cond('')). Фасет (f): n — численность последнего месяца,
      без массивов. Трансформер (tr): pid — разрез, id — значение, массивы 12 последних закрытых
      месяцев (прочие слоты — нули: сводная их не смотрит), строка — только если в неё попала хоть одна
      строка куба. Отдельный проход ради трансформера стоил бы ещё одной подстановки контекста.
      Диапазон куба — общий скаляр (lo, hi, alo, ahi, tops) на все ветки: одинаковый скаляр
      ClickHouse считает один раз, разные — каждый заново вместе с цепочкой CTE. #}
  SELECT if(kk = 1, 'f', 'tr') AS role, fk.2 AS id, fk.1 AS pid, if(kk = 1, n_f, toInt64(1)) AS n, '' AS j,
    {% for c in COMP %}if(kk = 1, '', {{ out('arrayMap((x, i) -> if(i > lmv - 11 AND i <= lmv + 1, x, 0), a_m_' ~ c ~ ', arrayEnumerate(a_m_' ~ c ~ '))') }}) AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}'' AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT (fv.1, fv.2) AS fk, sum(hn) AS n_f, countIf(fv.3 = 1) AS n_tr, any(lm0) AS lmv,
      {% for c in COMP %}sumForEachIf(mv_{{ c }}, fv.3 = 1) AS a_m_{{ c }}{% if not loop.last %},{% endif %}
      {% endfor %}
    FROM (
      SELECT toInt64(ifNull(arrayElement(cb.m_hc, ctx.last_m + 1), 0)) AS hn, ctx.last_m AS lm0,
        arrayJoin(arrayConcat(
          {% for c in CUT_COLS %}if({{ cond(c) }}, [('{{ c }}', ifNull(cb.{{ c }}, '-'), toUInt8({{ cond('') }}))], []){% if not loop.last %},
          {% endif %}{% endfor %}
        )) AS fv,
        {% for c in COMP %}{{ arr('cb.m_' ~ src(c)) }} AS mv_{{ c }}{% if not loop.last %},{% endif %}
        {% endfor %}
      FROM (
        SELECT *
        FROM prod_proteus.hrbp_hub_cube
        WHERE path_s >= tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 2)
      ) AS cb
      CROSS JOIN ctx
      WHERE notEmpty(ctx.roots)
        AND hasAny(arrayMap(x -> ifNull(x, ''), cb.path), ctx.scope)
    )
    GROUP BY fk
  )
  ARRAY JOIN [1, 2] AS kk
  WHERE kk = 1 OR n_tr > 0

  UNION ALL
  {#- ---------- трансформер по атрибутам сотрудника (грейд, стаж, город…) ----------
      Все 11 атрибутов: без разрезов у юнитов со свёрткой — из hrbp_hub_attr_top (tops),
      иначе — из листового куба ветки (диапазон alo…ahi); запасной режим TR_ALL_MAX — только
      атрибут из tr_f во всей ветке (и только когда свёртки нет: иначе он посчитался бы дважды).
      Источники сходятся в один проход с одной подстановкой
      контекста. pid — атрибут, id — значение; у атрибута — не больше TR_TOP значений по
      численности последнего месяца, остальные — одной строкой '…' (n — сколько в ней
      значений). Массивы — 12 последних закрытых месяцев, прочие слоты — нули. #}
  SELECT 'tr' AS role, tv AS id, tk AS pid, nv AS n, '' AS j,
    {% for c in COMP %}{{ out('arrayMap((x, i) -> if(i > lmv - 11 AND i <= lmv + 1, x, 0), t_m_' ~ c ~ ', arrayEnumerate(t_m_' ~ c ~ '))') }} AS m_{{ c }}, {% endfor %}
    {% for c in COMP %}'' AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
  FROM (
    SELECT tk, if(rn <= {{ TR_TOP }}, tv0, '…') AS tv, toInt64(count()) AS nv, any(lm1) AS lmv,
      {% for c in COMP %}sumForEach(a_m_{{ c }}) AS t_m_{{ c }}{% if not loop.last %},{% endif %}
      {% endfor %}
    FROM (
      SELECT tk, tv0, lm1, row_number() OVER (PARTITION BY tk ORDER BY arrayElement(a_m_hc, lm1 + 1) DESC, tv0) AS rn,
        {% for c in COMP %}a_m_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
      FROM (
        SELECT ifNull(ab.attr_k, '') AS tk, ifNull(ab.attr_v, '-') AS tv0, any(ctx.last_m) AS lm1,
          {% for c in COMP %}sumForEach({{ arr('ab.m_' ~ src(c)) }}) AS a_m_{{ c }}{% if not loop.last %},{% endif %}
          {% endfor %}
        FROM (
          {%- if not ANYCUT %}
          SELECT CAST([], 'Array(Nullable(String))') AS path, attr_k, attr_v,
            {% for c in COMP %}m_{{ src(c) }}, {% endfor %}toUInt8(1) AS top
          FROM prod_proteus.hrbp_hub_attr_top
          WHERE has(tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 5), ifNull(unit_id, ''))
          UNION ALL
          {%- endif %}
          SELECT path, attr_k, attr_v,
            {% for c in COMP %}m_{{ src(c) }}, {% endfor %}toUInt8(0) AS top
          FROM prod_proteus.hrbp_hub_attr
          WHERE ({% if axis in ATTRS %}(attr_k = {{ qs(axis) }} AND empty(tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 5)) AND path_s >= tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 1) AND path_s < tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 2)) OR {% endif %}(path_s >= tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 3) AND path_s < tupleElement((SELECT (lo, hi, alo, ahi, tops) FROM ex), 4)))
            AND ({{ cond('') }})
        ) AS ab
        CROSS JOIN ctx
        WHERE notEmpty(ctx.roots)
          AND (ab.top = 1 OR hasAny(arrayMap(x -> ifNull(x, ''), ab.path), ctx.scope))
        GROUP BY tk, tv0
      )
    )
    GROUP BY tk, tv
  )

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


  UNION ALL
  {#- ---------- справочник юнитов: вся зона логина на всю глубину и предки её корней ----------
      Не зависит от выбранного юнита и разрезов: выбор и поиск юнита в чарте — без запроса.
      rk здесь пустой (на супер-HRBP это сотни КБ): выбранному юниту он приезжает в meta. #}
  SELECT 'dict' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, {{ empty_cols() }}
  FROM (
    SELECT concat(ifNull(u.id, ''), '\t', ifNull(u.pid, ''), '\t', toString(ifNull(u.lvl, 0)), '\t',
                  toString(ifNull(u.hc_now, 0)), '\t', toString(ifNull(u.is_current, 0)), '\t\t',
                  replaceRegexpAll(ifNull(u.nm, ''), '[\\t\\n\\r]', ' '), '\t', toString(ifNull(u.kids_n, 0))) AS line
    FROM prod_proteus.hrbp_hub_unit u
    CROSS JOIN ctx
    WHERE notEmpty(ctx.roots)
      AND (has(ctx.anc, ifNull(u.id, '')) OR hasAny(arrayMap(x -> ifNull(x, ''), u.path), ctx.roots))
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
      ',"zone_n":', toString(ctx.zone_n),
      {% for c in CUT_COLS %}',"f_{{ c }}":', toJSONString({{ qa(F[c]) }}),
      {% endfor %}
      ',"axis":', toJSONString('{{ axis }}'),
      ',"tr_all":', toString(if(notEmpty(ex.tops) OR ex.scope_n <= {{ TR_ALL_MAX }}, 1, 0)),
      ',"tr_top":', toString(notEmpty(ex.tops)),
      ',"rk":', toJSONString(if(length(ctx.scope) = 1, ex.rk1, '')),
      ',"ret_base":', toJSONString('{{ 'active' if RA else 'company' }}'),
      ',"last_m":', toString(ctx.last_m),
      ',"end":1',
      ',"cal":', (SELECT toJSONString(arrayMap(t -> t.3, arraySort(groupArray(tuple(
                        ifNull(grain, '') = 'w', ifNull(idx, 0),
                        concat(ifNull(grain, ''), '|', toString(ifNull(idx, 0)), '|',
                               ifNull(toString(slot_start), ''), '|', ifNull(toString(slot_end), ''), '|',
                               toString(ifNull(is_closed, 0)), '|', ifNull(toString(data_dt), '')))))))
                  FROM prod_proteus.hrbp_hub_calendar),
    '}') AS j,
    {{ empty_cols() }}
  FROM ctx CROSS JOIN ex

  UNION ALL
  {#- ---------- маркер «ответ целиком»: последняя строка; нет её — лимит строк чарта обрезал хвост ---------- #}
  SELECT 'end' AS role, '' AS id, '' AS pid, toInt64(0) AS n, '' AS j, {{ empty_cols() }}
)
{#- Порядок строк: под обёрткой Proteus (SELECT … FROM (датасет) LIMIT N) лимит режет хвост —
    там то, без чего отчёт живёт (третий уровень «Команд»), а служебное и фильтры — в начале. -#}
ORDER BY multiIf(role = 'meta', 0, role = 'f', 1, role = 'scope', 2, role = 'base', 3, role = 'kpi', 4,
                 role = 'hrbps', 5, role = 'dict', 6, role = 'c', 7, role = 'g', 8, role = 'tr', 9,
                 role = 'x', 10, 11)
