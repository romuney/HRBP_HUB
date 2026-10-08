{#- ============================================================================
    hrbp_hub — датасет ЕДИНСТВЕННОГО чарта отчёта HRBP HUB (Proteus, база CROSS).

    Один ответ везёт всё, что экрану может понадобиться до следующей смены юнита
    или разрезов: сводку, команды на 3 уровня вниз (или все уровни — depth_f), базу
    сравнения, цели, фасеты фильтров, трансформеры по всем осям, справочник юнитов и
    HRBP для выбора и календарь. Всё остальное — вкладки, раскрытие строк «Команд»,
    «год / 12 недель», клик по команде, ось и метрика трансформеров, наследование целей,
    светофор — считает чарт без запроса.

    Строки различаются колонкой role:
      meta   1 строка — эхо применённых условий, доступ, календарь слотов, словари значений
             6 разрезов (fdv) (j = JSON)
      dict   1 строка — юниты пакетом: id, родитель, уровень, численность сейчас,
             текущий ли, (пусто — rk приезжает в meta для выбранного юнита), имя, число
             детей, распределение численности последнего закрытого месяца по 6 разрезам
             среди людей прямо в юните («код:n» через пробел, код — по словарям meta.fdv)
             (j: поля через \t, строки через \n). Вся зона логина на всю глубину и
             предки её корней — всегда: выбор и поиск юнита в чарте идут без запроса, а
             числа окна фильтров (фасеты, дерево, зоны HRBP) — по набранному выбору, тоже без запроса
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
             строкой '…' (n — сколько в ней значений). Массивы — только 12 последних закрытых
             месяцев («N@…»: N первых слотов пропущено, чарт заполняет их нулями)
      kpi    правила целей: id = rule_id, pid = юнит, j = поля через \t
      end    1 строка-маркер «ответ целиком»: всегда последняя
    Массивы m_* — 24 месяца, w_* — 24 недели (позиция = idx календаря), строкой
    через запятую без хвостовых нулей («0» — все нули; у трансформеров «N@…» — первые N слотов
    пропущены; чарт дополняет до 24). Проценты не храним: чарт делит числитель на знаменатель.

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
    юниты вне зоны пользователя не приезжают ни в каком виде; логин — в ключе кеша Proteus
    (вызов внутри {{ }} в условии доступа, см. ниже у `me`).

    Масштаб: куб читается только в поддереве выбранного юнита (ORDER BY path_s —
    ветка лежит подряд, условие по пути уходит в PREWHERE), база — из крошечной
    hrbp_hub_base, а не суммой всего куба, атрибуты открытого по умолчанию юнита — из
    готовой свёртки (сотни строк вместо сотен тысяч).

    Текст SQL — короткий, и это не косметика. Superset 2 до запуска разбирает отрендеренный SQL
    библиотекой sqlparse: на ключ кеша (а он с логином — значит, на КАЖДЫЙ запрос, ответ из кеша и
    каждый забор результата qc-…), на проверку «только SELECT» и на reindent обёртки SELECT … FROM
    (датасет) LIMIT N. Время reindent растёт как число скобок × число токенов: на прежних 34 КБ это
    ~10 с плюс ~2 с на каждый разбор (08.10 «Применить» в бою — 20 с). Поэтому 12 компонентов × 2
    сетки едут по плечам ОДНИМ плоским массивом (24 массива по 24 слота подряд) и режутся на 24
    колонки один раз, в самом верху; повторять выражения по компонентам в плечах нельзя.
============================================================================ -#}
{% set CUTS = [['paint', 'paint_f'], ['it', 'it_f'], ['stream', 'stream_f'], ['spec', 'spec_f'], ['staff', 'staff_f'], ['hct', 'hct_f']] %}
{% set CUT_COLS = ['paint', 'it', 'stream', 'spec', 'staff', 'hct'] %}
{% set ATTRS = ['grade', 'seniority', 'exp', 'gender', 'age', 'office', 'work', 'head', 'legal', 'macro', 'city'] %}
{% set COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire'] %}
{% set ROLES = ['meta', 'f', 'scope', 'base', 'kpi', 'hrbps', 'dict', 'c', 'g', 'tr', 'x', 'end'] %}
{#- Трансформеры: все 11 атрибутов в каждом ответе. Без разрезов — из свёртки (если она есть
    у открытых юнитов), с разрезами — из листового куба ветки, пока в ней не больше TR_ALL_MAX
    юнитов. По умолчанию предела нет; запасной режим — TR_ALL_MAX = 1500: большая ветка с
    разрезами получит атрибут по запросу (tr_f), чарт это понимает сам. -#}
{% set TR_ALL_MAX = 1000000 %}
{#- У атрибута — не больше TR_TOP значений по численности, остальные — одной строкой '…'
    (город, офис: сотни значений раздули бы ответ зоны в разы). -#}
{% set TR_TOP = 30 %}
{#- Скаляры: одинаковый текст ClickHouse считает один раз, разные — каждый заново вместе с цепочкой
    CTE. EX — диапазоны куба области: 1 lo, 2 hi — ветка в кубе, 3 alo, 4 ahi — в листовом кубе
    атрибутов, 5 tops — юниты со свёрткой атрибутов. FZ — распределение для окна фильтров: 1 zlo,
    2 zhi — ветка всей зоны, 3 zlm — последний закрытый месяц, 4 zroots — корни зоны, 5…10 — словари
    значений 6 разрезов, 11 — множители смешанной системы счисления, 12 — словари JSON для meta. -#}
{% set EX = '(SELECT ext FROM ex0)' %}
{% set FZ = '(SELECT fzt FROM fz)' %}
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
{#- Логин. ВАЖНО для кеша Proteus (Superset 2): логин попадает в ключ кеша результата, только если
    Superset видит current_username() внутри {{ … }} — ищет регуляркой ExtraCache.regex по тексту SQL и
    лишь тогда рендерит шаблон ради ключа. В {% set %} он вызов не видит, и без строки ниже ответ одного
    пользователя кешировался бы общим для всех с теми же фильтрами (админ → HRBP: чужие юниты из кеша).
    Поэтому в условии доступа (acc) логин берётся прямо в {{ }} — не переносить в {% set %};
    stand/check.py сверяет текст шаблона с регуляркой Superset 2. -#}
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
{#- Колонки компонентов (закрепляемость — с подменой RA): MM — 12 месячных, MW — они же и 12 недельных. -#}
{% set MM = [] %}{% set WW = [] %}
{% for c in COMP %}{% set s = c[:2] ~ RA ~ c[2:] if c in ['r3n', 'r3d', 'r6n', 'r6d'] else c %}{% set _ = MM.append('m_' ~ s) %}{% set _ = WW.append('w_' ~ s) %}{% endfor %}
{% set MW = (MM + WW)|join(', ') %}
{#- Условие «строка проходит разрезы», кроме разреза skip (для фасетов). -#}
{% macro cond(skip) -%}
{%- set parts = [] -%}
{%- for c in CUT_COLS -%}{%- if c != skip and F[c]|length > 0 -%}{%- set _ = parts.append('has(' ~ qa(F[c]) ~ ', ifNull(' ~ c ~ ", '-'))") -%}{%- endif -%}{%- endfor -%}
{{- parts|join(' AND ') if parts else '1' -}}
{%- endmacro %}
{#- 12 последних закрытых месяцев (трансформеры): из массивов a2 (по одному на компонент) — окно
    W12, подряд одним плоским массивом; режется до свёртки (вдвое меньше данных в arrayJoin и
    sumForEach). -#}
{% macro win(a2, lm) -%}arrayFlatten(arrayMap(y -> arraySlice(y, greatest({{ lm }} - 10, 1), least({{ lm }} + 1, 12)), {{ a2 }})){%- endmacro %}
{#- Контекст запроса — цепочкой CTE, а не WITH-выражениями: новый анализатор CH 24
    не пускает вычисляемые алиасы WITH в подзапросы («only supported for constants
    and CTE»). CTE инлайнится в каждое плечо, но таблицы здесь маленькие. #}
{#- Контекст запроса. Каждое плечо ниже подставляет CTE заново (ClickHouse их не
    материализует), поэтому цепочка короткая: доступ → юниты по ключу → область. #}
{#- Отступы строк — не в SQL: sqlparse в Superset считает каждый пробел отдельным токеном (−25 % токенов,
    reindent на 20 % быстрее). Строковых литералов с переводом строки в датасете нет. -#}
{% filter replace('\n                ', '\n')|replace('\n        ', '\n')|replace('\n    ', '\n')|replace('\n  ', '\n') %}
WITH
  acc AS (
    SELECT arrayDistinct(if(notEmpty(r_all), r_all, r_zone)) AS roots,
           multiIf(has(rl, 'super'), 'super', has(rl, 'admin'), 'admin', notEmpty(r_zone), 'hrbp', 'none') AS my_role
    FROM (
      SELECT groupArrayIf(ifNull(root_id, ''), ifNull(role, '') IN ('super', 'admin')) AS r_all,
             groupArrayIf(ifNull(root_id, ''), ifNull(role, '') = 'hrbp') AS r_zone,
             groupArray(ifNull(role, '')) AS rl
      FROM prod_proteus.hrbp_hub_access
      WHERE login = {{ qs((current_username() or '')|string|trim|lower) }}
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
  {#- Контекст — ОДИН раз на запрос: цепочка доступ → юниты → месяц сворачивается в скаляр ctxt
      (одинаковый текст ClickHouse считает один раз), а ctx — его проекция. Плечи и ex берут ctx,
      и новому анализатору не нужно заново разбирать и подставлять цепочку в каждое из них: в бою
      ClickHouse 24.8.15.1 с новым анализатором (08.10), на масштабе это −1 с на планировании.
      Старый анализатор так медленнее (скаляр в каждой копии CTE) — в бою его нет. -#}
  ctx0 AS (
    SELECT (roots, my_role, scope, single, anc, zone_n, last_m) AS ctxt
    FROM (
      SELECT acc.roots AS roots, acc.my_role AS my_role,
             if(empty(un.req_ok), acc.roots, arraySort(un.req_ok)) AS scope,
             length(scope) = 1 AS single,
             un.anc AS anc, un.zone_n AS zone_n, lm.last_m AS last_m
      FROM acc CROSS JOIN un CROSS JOIN lm
    )
  ),
  ctx AS (
    SELECT c.1 AS roots, c.2 AS my_role, c.3 AS scope, c.4 AS single, c.5 AS anc, c.6 AS zone_n, c.7 AS last_m
    FROM (SELECT (SELECT ctxt FROM ctx0) AS c)
  ),
  {#- Область: lo / hi — диапазон ключа куба (path_s), в котором лежит её ветка (куб читается
      только в нём); scope_n — юнитов в ветке; depth — сколько уровней «Команд» отдаём (3 или
      DEEP). smin — юниты области без предка в ней же; если у всех есть свёртка атрибутов
      (attr_top) и разрезы не выбраны, tops = smin: атрибуты читаются из свёртки, а диапазон
      листового куба атрибутов (alo / ahi) пустой. rk1 — rk выбранного юнита (строка реестра целей).
      ext — скаляр EX для плеч, ex — его проекция (как ctx). -#}
  ex0 AS (
    SELECT lo, hi, scope_n, depth, rk1,
           if({{ '0' if ANYCUT else '1' }} = 1 AND top_all = 1, smin, CAST([], 'Array(String)')) AS tops,
           if(notEmpty(tops) OR scope_n > {{ TR_ALL_MAX }}, '', lo) AS alo,
           if(notEmpty(tops) OR scope_n > {{ TR_ALL_MAX }}, '', hi) AS ahi,
           (lo, hi, alo, ahi, tops, scope_n, depth, rk1) AS ext
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
  ),
  ex AS (
    SELECT e.1 AS lo, e.2 AS hi, e.3 AS alo, e.4 AS ahi, e.5 AS tops, e.6 AS scope_n, e.7 AS depth, e.8 AS rk1
    FROM (SELECT (SELECT ext FROM ex0) AS e)
  ),
  {#- Распределение численности для окна фильтров: диапазон ключа куба, в котором лежит вся зона
      (zlo / zhi), последний закрытый месяц (zlm), корни зоны (zroots) и словари значений 6 разрезов —
      вся компания, из крошечной hrbp_hub_base (в ней те же сочетания, что в кубе): по ним сочетание
      разрезов пишется одним числом (смешанная система счисления: mul — вес каждого разряда), чарт
      читает словари из meta.fdv. Всё — один короткий скаляр FZ (от ctx: корни и месяц): цепочку ex он
      не трогает, считается один раз, и плечу справочника не нужны соединения. -#}
  fz AS (
    SELECT (zlo, zhi, zlm, zroots, {% for c in CUT_COLS %}d_{{ c }}, {% endfor %}mul,
            if(empty(zroots), '{}', concat('{'{% for c in CUT_COLS %}, '{{ '' if loop.first else ',' }}"{{ c }}":', toJSONString(d_{{ c }}){% endfor %}, '}'))) AS fzt
    FROM (
      SELECT min(arrayStringConcat(p, '/')) AS zlo, max(concat(arrayStringConcat(p, '/'), '0')) AS zhi,
             any(ctx.last_m) AS zlm, any(ctx.roots) AS zroots
      FROM (
        SELECT arrayMap(x -> ifNull(x, ''), path) AS p
        FROM prod_proteus.hrbp_hub_unit
        WHERE id IN (SELECT arrayJoin(roots) FROM ctx)
      ) AS zu
      CROSS JOIN ctx
    ) AS zz
    CROSS JOIN (
      SELECT {% for c in CUT_COLS %}arraySort(groupUniqArray(ifNull({{ c }}, '-'))) AS d_{{ c }}, {% endfor %}
             [{% for i in range(1, 6) %}{% for c in CUT_COLS[i:] %}length(d_{{ c }}){% if not loop.last %} * {% endif %}{% endfor %}, {% endfor %}1] AS mul
      FROM prod_proteus.hrbp_hub_base
    ) AS fdv
  )
{#- Плечи ниже отдают компоненты одним плоским массивом a: lw < 0 — 24 массива по 24 слота
    (m_*, затем w_*), lw ≥ 0 — трансформер: только 12 месячных, окно W12 до месяца lw. Здесь a
    режется на 24 колонки: строкой через запятую без хвостовых нулей, у трансформеров слева —
    число пропущенных слотов («8@5,0,7»), чарт дополняет до 24 (parseArr); пустая строка — «массива
    нет». Обрезка — одним регулярным выражением, без лямбд поиска нулей: они замедляли запрос. -#}
SELECT role, id, pid, n, j,
  {% for c in COMP %}o[{{ loop.index }}] AS m_{{ c }}, {% endfor %}{% for c in COMP %}o[{{ loop.index + 12 }}] AS w_{{ c }}{% if not loop.last %}, {% endif %}{% endfor %}
FROM (
  SELECT role, id, pid, n, j, if(lw < 0, 24, least(lw + 1, 12)) AS wl,
    if(lw < 0, '', concat(toString(greatest(lw - 11, 0)), '@')) AS pf,
    arrayMap(i -> if(i * wl >= length(a), '', concat(pf, replaceRegexpOne(arrayStringConcat(arraySlice(a, i * wl + 1, wl), ','), '(,0)+$', ''))), range(24)) AS o
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
      но ключи глубже 3 оживают, только если ex.depth это разрешил (ветка ≤ ALL_MAX юнитов).
      NULL в массивах (выгрузка Nullable) — после свёртки: sum их пропускает. #}
  SELECT multiIf(lv = 0, 'scope', lv = 1, 'c', lv = 2, 'g', 'x') AS role, id, pid, toInt64(0) AS n, '' AS j, s AS a, -1 AS lw
  FROM (
    SELECT lv, id, pid, count() OVER (PARTITION BY lv, pid) AS sib, s
    FROM (
      SELECT toUInt32(length(arrayFilter(x -> x != '', ks))) AS lv, ks[lv] AS id,
        if(lv <= 1, '', arrayStringConcat(arraySlice(ks, 1, lv - 1), '/')) AS pid, s
      FROM (
        SELECT [{% for i in range(D) %}ifNull(k{{ i + 1 }}, ''){% if not loop.last %}, {% endif %}{% endfor %}] AS ks,
          arrayMap(x -> ifNull(x, 0), sumForEach(v)) AS s
        FROM (
          SELECT arrayConcat({{ MW }}) AS v,
            arrayMap(x -> ifNull(x, ''), cb.path) AS p,
            arrayFirstIndex(x -> has(ctx.scope, x), p) AS pos,
            arraySlice(p, if(ctx.single, pos + 1, pos)) AS rel,
            {% for i in range(D) %}if(length(rel) > {{ i }}{% if i >= 3 %} AND ex.depth > {{ i }}{% endif %}, rel[{{ i + 1 }}], '·') AS k{{ i + 1 }}{% if not loop.last %}, {% endif %}{% endfor %}
          FROM (
            SELECT * FROM prod_proteus.hrbp_hub_cube
            WHERE path_s >= tupleElement({{ EX }}, 1) AND path_s < tupleElement({{ EX }}, 2)
          ) AS cb
          CROSS JOIN ctx{% if D > 3 %} CROSS JOIN ex{% endif %}
          WHERE notEmpty(ctx.roots) AND hasAny(cb.path, ctx.scope) AND ({{ cond('') }})
        )
        GROUP BY {% for i in range(D) %}k{{ i + 1 }}{% if not loop.last %}, {% endif %}{% endfor %} WITH ROLLUP
      )
      WHERE (lv <= 1 OR ks[lv - 1] != '·'){% if D > 3 %} AND lv <= (SELECT depth FROM ex){% endif %}
    )
  )
  WHERE NOT (id = '·' AND sib = 1)

  UNION ALL
  {#- ---------- фасеты фильтров и трансформер по разрезам — один проход по кубу ветки ----------
      Пара «разрез, значение» идёт в фасет, если строка куба проходит ОСТАЛЬНЫЕ разрезы (cond(c)),
      и в трансформер — если проходит ВСЕ (cond('')). Фасет (f): n — численность последнего месяца,
      без массивов. Трансформер (tr): pid — разрез, id — значение, массивы — только 12 последних закрытых
      месяцев (окно W12 режется до arrayJoin: сводная прочих не смотрит), строка — только если в неё
      попала хоть одна строка куба. Отдельный проход ради трансформера стоил бы ещё одной подстановки
      контекста. Диапазон куба — общий скаляр EX на все ветки. #}
  SELECT if(kk = 1, 'f', 'tr') AS role, fk.2 AS id, fk.1 AS pid, if(kk = 1, n_f, toInt64(1)) AS n, '' AS j,
    if(kk = 1, [], s) AS a, lmv AS lw
  FROM (
    SELECT (fv.1, fv.2) AS fk, sum(hn) AS n_f, countIf(fv.3 = 1) AS n_tr, any(lm0) AS lmv,
      arrayMap(x -> ifNull(x, 0), sumForEachIf(v, fv.3 = 1)) AS s
    FROM (
      SELECT toInt64(ifNull(cb.m_hc[ctx.last_m + 1], 0)) AS hn, ctx.last_m AS lm0,
        arrayJoin(arrayConcat(
          {% for c in CUT_COLS %}if({{ cond(c) }}, [('{{ c }}', ifNull(cb.{{ c }}, '-'), toUInt8({{ cond('') }}))], []){% if not loop.last %},
          {% endif %}{% endfor %}
        )) AS fv,
        {{ win('[' ~ MM|join(', ') ~ ']', 'ctx.last_m') }} AS v
      FROM (
        SELECT * FROM prod_proteus.hrbp_hub_cube
        WHERE path_s >= tupleElement({{ EX }}, 1) AND path_s < tupleElement({{ EX }}, 2)
      ) AS cb
      CROSS JOIN ctx
      WHERE notEmpty(ctx.roots) AND hasAny(cb.path, ctx.scope)
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
      Источники сходятся в один проход с одной подстановкой контекста. pid — атрибут, id — значение;
      у атрибута — не больше TR_TOP значений по численности последнего месяца (последний слот окна
      численности), остальные — одной строкой '…' (n — сколько в ней значений). #}
  SELECT 'tr' AS role, tv AS id, tk AS pid, nv AS n, '' AS j, s AS a, lmv AS lw
  FROM (
    SELECT tk, if(rn <= {{ TR_TOP }}, tv0, '…') AS tv, toInt64(count()) AS nv, any(lm1) AS lmv, sumForEach(s0) AS s
    FROM (
      SELECT tk, tv0, lm1, s0, row_number() OVER (PARTITION BY tk ORDER BY s0[least(lm1 + 1, 12)] DESC, tv0) AS rn
      FROM (
        SELECT ifNull(ab.attr_k, '') AS tk, ifNull(ab.attr_v, '-') AS tv0, any(ctx.last_m) AS lm1,
          arrayMap(x -> ifNull(x, 0), sumForEach({{ win('ab.mm', 'ctx.last_m') }})) AS s0
        FROM (
          {%- if not ANYCUT %}
          SELECT CAST([], 'Array(Nullable(String))') AS path, attr_k, attr_v, [{{ MM|join(', ') }}] AS mm, toUInt8(1) AS top
          FROM prod_proteus.hrbp_hub_attr_top
          WHERE has(tupleElement({{ EX }}, 5), ifNull(unit_id, ''))
          UNION ALL
          {%- endif %}
          SELECT path, attr_k, attr_v, [{{ MM|join(', ') }}] AS mm, toUInt8(0) AS top
          FROM prod_proteus.hrbp_hub_attr
          WHERE ({% if axis in ATTRS %}(attr_k = {{ qs(axis) }} AND empty(tupleElement({{ EX }}, 5)) AND path_s >= tupleElement({{ EX }}, 1) AND path_s < tupleElement({{ EX }}, 2)) OR {% endif %}(path_s >= tupleElement({{ EX }}, 3) AND path_s < tupleElement({{ EX }}, 4)))
            AND ({{ cond('') }})
        ) AS ab
        CROSS JOIN ctx
        WHERE notEmpty(ctx.roots) AND (ab.top = 1 OR hasAny(ab.path, ctx.scope))
        GROUP BY tk, tv0
      )
    )
    GROUP BY tk, tv
  )

  UNION ALL
  {#- ---------- база сравнения: вся компания под теми же разрезами, без пути ---------- #}
  SELECT 'base' AS role, '' AS id, '' AS pid, toInt64(0) AS n, '' AS j,
    arrayMap(x -> ifNull(x, 0), sumForEach(arrayConcat({{ MW }}))) AS a, -1 AS lw
  FROM prod_proteus.hrbp_hub_base
  CROSS JOIN ctx
  WHERE notEmpty(ctx.roots) AND ({{ cond('') }})
  HAVING count() > 0

  UNION ALL
  {#- ---------- справочник юнитов: вся зона логина на всю глубину и предки её корней ----------
      Не зависит от выбранного юнита и разрезов: выбор и поиск юнита в чарте — без запроса.
      rk здесь пустой (на супер-HRBP это сотни КБ): выбранному юниту он приезжает в meta.
      9-е поле — распределение численности последнего закрытого месяца по 6 разрезам среди людей
      прямо в юните (не в поддереве): «код:n» через пробел, код — номера значений в словарях
      meta.fdv смешанной системой счисления, hex. Пары есть у всех сочетаний, что встречаются в
      кубе зоны (n бывает 0, как у фасетов). Из него чарт считает числа окна фильтров — фасеты,
      дерево юнитов, зоны HRBP — по набранному выбору, без запроса (владелец 07.10). zf — скаляр FZ
      (условие по пути с ним уходит в индекс). #}
  SELECT 'dict' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, emptyArrayInt64() AS a, -1 AS lw
  FROM (
    SELECT concat(ifNull(u.id, ''), '\t', ifNull(u.pid, ''), '\t', toString(ifNull(u.lvl, 0)), '\t',
                  toString(ifNull(u.hc_now, 0)), '\t', toString(ifNull(u.is_current, 0)), '\t\t',
                  replaceRegexpAll(ifNull(u.nm, ''), '[\\t\\n\\r]', ' '), '\t', toString(ifNull(u.kids_n, 0)), '\t',
                  ifNull(fd.d, '')) AS line
    FROM prod_proteus.hrbp_hub_unit u
    CROSS JOIN ctx
    LEFT JOIN (
      SELECT fu, arrayStringConcat(groupArray(concat(hex(fcode), ':', toString(fn))), ' ') AS d
      FROM (
        SELECT fu, fcode, sum(hn) AS fn
        FROM (
          SELECT {{ FZ }} AS zf, ifNull(cb.path[-1], '') AS fu,
            [{% for c in CUT_COLS %}indexOf(zf.{{ loop.index + 4 }}, ifNull(cb.{{ c }}, '-')){% if not loop.last %}, {% endif %}{% endfor %}] AS fi,
            toUInt64(arrayDotProduct(fi, zf.11) - arraySum(zf.11)) AS fcode,
            toInt64(ifNull(cb.m_hc[zf.3 + 1], 0)) AS hn
          FROM prod_proteus.hrbp_hub_cube AS cb
          WHERE path_s >= zf.1 AND path_s < zf.2
            {#- у зоны из одного корня диапазон и есть её ветка: проверка корней — только у нескольких #}
            AND (length(zf.4) = 1 OR hasAny(cb.path, zf.4))
            AND NOT has(fi, 0)
        )
        GROUP BY fu, fcode
      )
      GROUP BY fu
    ) AS fd ON fd.fu = ifNull(u.id, '')
    WHERE notEmpty(ctx.roots)
      AND (has(ctx.anc, ifNull(u.id, '')) OR hasAny(u.path, ctx.roots))
  )
  HAVING count() > 0

  UNION ALL
  {#- ---------- HRBP, чьи зоны целиком внутри моей: выбор зоны; пути корней — для дерева «кто под кем» ---------- #}
  SELECT 'hrbps' AS role, '' AS id, '' AS pid, toInt64(count()) AS n,
    arrayStringConcat(groupArray(line), '\n') AS j, emptyArrayInt64() AS a, -1 AS lw
  FROM (
    SELECT concat(lg, '\t', nm, '\t', arrayStringConcat(rs, ','), '\t', toString(hc), '\t',
                  arrayStringConcat(arrayMap(pp -> arrayStringConcat(pp, '/'), ps), ',')) AS line
    FROM (
      SELECT ifNull(x.login, '') AS lg, any(ifNull(x.hrbp_nm, '')) AS nm,
             groupArray(ifNull(x.root_id, '')) AS rs, toInt64(sum(ifNull(u.hc_now, 0))) AS hc,
             groupArray(arrayMap(y -> ifNull(y, ''), u.path)) AS ps,
             min(toUInt8(hasAny(u.path, ctx.roots))) AS vis
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
    emptyArrayInt64() AS a, -1 AS lw
  FROM prod_proteus.hrbp_hub_kpi
  CROSS JOIN ctx
  WHERE notEmpty(ctx.roots)
    {#- Юнит цели в зоне — по пути из справочника, а не по unit_path цели: реестр целей
        выгружается без array_type_cast, и unit_path в ClickHouse — строка, не массив. #}
    AND (has(ctx.anc, ifNull(unit_id, ''))
         OR ifNull(unit_id, '') IN (SELECT ifNull(z.id, '') FROM prod_proteus.hrbp_hub_unit z CROSS JOIN ctx
                                    WHERE hasAny(z.path, ctx.roots)))

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
      ',"fdv":', tupleElement({{ FZ }}, 12),
      ',"end":1',
      ',"cal":', (SELECT toJSONString(arrayMap(t -> t.3, arraySort(groupArray(tuple(
                        ifNull(grain, '') = 'w', ifNull(idx, 0),
                        concat(ifNull(grain, ''), '|', toString(ifNull(idx, 0)), '|',
                               ifNull(toString(slot_start), ''), '|', ifNull(toString(slot_end), ''), '|',
                               toString(ifNull(is_closed, 0)), '|', ifNull(toString(data_dt), '')))))))
                  FROM prod_proteus.hrbp_hub_calendar),
    '}') AS j,
    emptyArrayInt64() AS a, -1 AS lw
  FROM ctx CROSS JOIN ex

  UNION ALL
  {#- ---------- маркер «ответ целиком»: последняя строка; нет её — лимит строк чарта обрезал хвост ---------- #}
  SELECT 'end' AS role, '' AS id, '' AS pid, toInt64(0) AS n, '' AS j, emptyArrayInt64() AS a, -1 AS lw
  )
)
{#- Порядок строк: под обёрткой Proteus (SELECT … FROM (датасет) LIMIT N) лимит режет хвост —
    там то, без чего отчёт живёт (третий уровень «Команд»), а служебное и фильтры — в начале. -#}
ORDER BY indexOf([{% for r in ROLES %}'{{ r }}'{% if not loop.last %}, {% endif %}{% endfor %}], role)
{% endfilter %}
