-- ============================================================================
-- HRBP HUB — проверки в SQL Lab (база CROSS, ClickHouse) после прогона ноута.
-- Запросы независимые: выделить один и выполнить. Зелёное — можно заводить
-- датасет и чарт; «ждали / пришло» расходятся — смотреть параграф «HH · проверки».
-- ============================================================================

-- 1. Все восемь таблиц на месте и свежие: строки и дата данных.
--    Ждали: calendar 48 строк; unit, access, cube, base, attr, attr_top — не пусто; kpi —
--    сколько целей в реестре. base — тысячи строк (комбинации разрезов), cube — десятки
--    тысяч, attr_top — около десятой части attr.
SELECT 'hrbp_hub_calendar' AS t, count() AS rows, toString(max(ifNull(data_dt, toDate('1970-01-01')))) AS data_dt FROM prod_proteus.hrbp_hub_calendar
UNION ALL SELECT 'hrbp_hub_unit', count(), toString(max(ifNull(last_dt, toDate('1970-01-01')))) FROM prod_proteus.hrbp_hub_unit
UNION ALL SELECT 'hrbp_hub_access', count(), '' FROM prod_proteus.hrbp_hub_access
UNION ALL SELECT 'hrbp_hub_kpi', count(), '' FROM prod_proteus.hrbp_hub_kpi
UNION ALL SELECT 'hrbp_hub_cube', count(), '' FROM prod_proteus.hrbp_hub_cube
UNION ALL SELECT 'hrbp_hub_base', count(), '' FROM prod_proteus.hrbp_hub_base
UNION ALL SELECT 'hrbp_hub_attr', count(), '' FROM prod_proteus.hrbp_hub_attr
UNION ALL SELECT 'hrbp_hub_attr_top', count(), '' FROM prod_proteus.hrbp_hub_attr_top;

-- 2. Календарь: какие месяцы и недели лежат в позициях массивов, последний закрытый.
--    Ждали: m 0–23 = январь прошлого года … декабрь текущего, closed = 1 до последнего
--    закрытого месяца включительно; w 0–23 = 24 недели пн–вс, все закрыты.
SELECT grain, idx, slot_start, slot_end, is_closed
FROM prod_proteus.hrbp_hub_calendar
ORDER BY grain, idx;

-- 3. Численность компании по месяцам (куб целиком) — должна совпасть с тем, что
--    HR-отчёты дают на конец месяца (active_employee_flg = 1). Пустые будущие месяцы — 0.
SELECT arrayJoin(arrayEnumerate(s)) - 1 AS idx, s[idx + 1] AS headcount
FROM (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_hc)) AS s FROM prod_proteus.hrbp_hub_cube);

-- 4. База сравнения («вся компания» без пути) сходится с кубом: численность и
--    знаменатель текучести по месяцам, численность по неделям.
--    Ждали: во всех 24 строках diff_* = 0.
SELECT arrayJoin(arrayEnumerate(bh)) - 1 AS idx,
       bh[idx + 1] - ch[idx + 1] AS diff_m_hc,
       bw[idx + 1] - cw[idx + 1] AS diff_m_hcw,
       bk[idx + 1] - ck[idx + 1] AS diff_w_hc
FROM (
  SELECT (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_hc)) FROM prod_proteus.hrbp_hub_base) AS bh,
         (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_hc)) FROM prod_proteus.hrbp_hub_cube) AS ch,
         (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_hcw)) FROM prod_proteus.hrbp_hub_base) AS bw,
         (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_hcw)) FROM prod_proteus.hrbp_hub_cube) AS cw,
         (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), w_hc)) FROM prod_proteus.hrbp_hub_base) AS bk,
         (SELECT sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), w_hc)) FROM prod_proteus.hrbp_hub_cube) AS ck
);

-- 5. Куб атрибутов сходится с кубом: по каждому атрибуту численность последнего
--    закрытого месяца одна и та же. Ждали: во всех 11 строках одно число = п. 3.
SELECT ifNull(attr_k, '') AS attr,
       sum(toInt64(ifNull(arrayElement(m_hc, (SELECT toUInt32(max(idx) + 1) FROM prod_proteus.hrbp_hub_calendar WHERE grain = 'm' AND is_closed = 1)), 0))) AS headcount_last_month
FROM prod_proteus.hrbp_hub_attr
GROUP BY attr
ORDER BY attr;

-- 5б. Свёртка атрибутов сходится с кубом атрибутов: свёртки верхних узлов дерева
--     (компания) — это весь куб. Ждали: в каждой из 11 строк diff = 0; units_with_top —
--     сколько юнитов со свёрткой (корни зон HRBP, компания, блоки, ветки от 300 юнитов).
SELECT t.attr, t.hc AS top_hc, l.hc AS leaf_hc, t.hc - l.hc AS diff,
       (SELECT countIf(ifNull(attr_top, 0) = 1) FROM prod_proteus.hrbp_hub_unit) AS units_with_top
FROM (
  SELECT ifNull(a.attr_k, '') AS attr, sum(toInt64(ifNull(arrayElement(a.m_hc, (SELECT toUInt32(max(idx) + 1) FROM prod_proteus.hrbp_hub_calendar WHERE grain = 'm' AND is_closed = 1)), 0))) AS hc
  FROM prod_proteus.hrbp_hub_attr_top a
  WHERE ifNull(a.unit_id, '') IN (SELECT ifNull(id, '') FROM prod_proteus.hrbp_hub_unit WHERE ifNull(pid, '') = '')
  GROUP BY attr
) t
LEFT JOIN (
  SELECT ifNull(attr_k, '') AS attr, sum(toInt64(ifNull(arrayElement(m_hc, (SELECT toUInt32(max(idx) + 1) FROM prod_proteus.hrbp_hub_calendar WHERE grain = 'm' AND is_closed = 1)), 0))) AS hc
  FROM prod_proteus.hrbp_hub_attr
  GROUP BY attr
) l ON l.attr = t.attr
ORDER BY t.attr;

-- 6. Уровни оргструктуры — как в ультраширокой: 1 (компания) и 3…12.
--    Ждали: lvl 1 — одна строка; lvl 2 и больше 12 — нет; path_len = число уровней
--    от компании (1 → 1, 3 → 2 … 12 → 11); у 12-го уровня children = 0.
--    headcount_now — сотрудники, чей юнит на этом уровне последний в пути.
SELECT ifNull(u.lvl, 0) AS lvl, count() AS units, sum(ifNull(u.is_current, 0)) AS current_units,
       max(length(u.path)) AS path_len, sum(ifNull(u.kids_n, 0)) AS children,
       sum(ifNull(u.hc_now, 0) - ifNull(k.kids_hc, 0)) AS headcount_now
FROM prod_proteus.hrbp_hub_unit u
LEFT JOIN (SELECT ifNull(pid, '') AS id, sum(ifNull(hc_now, 0)) AS kids_hc
           FROM prod_proteus.hrbp_hub_unit GROUP BY id) k ON k.id = ifNull(u.id, '')
GROUP BY lvl
ORDER BY lvl;

-- 7. Доступ: кто что видит. role super / admin — вся компания, hrbp — корни зоны.
--    Впишите логин вместо 'ivanov.i' — пусто = у логина нет зоны, отчёт скажет «нет зоны HRBP».
--    units — юнитов в поддереве корня: справочник отчёта везёт всю зону, на всю глубину.
SELECT a.login, a.role, a.hrbp_nm, u.nm AS root_unit, u.lvl, u.hc_now, u.sub_n AS units
FROM prod_proteus.hrbp_hub_access a
LEFT JOIN prod_proteus.hrbp_hub_unit u ON u.id = a.root_id
WHERE a.login = lower('ivanov.i')
ORDER BY u.hc_now DESC;

-- 8. Сколько HRBP и корней в доступе (без логинов): бой — десятки HRBP, 1 супер, админы.
SELECT ifNull(role, '') AS role, uniqExact(login) AS logins, count() AS roots
FROM prod_proteus.hrbp_hub_access
GROUP BY role;

-- 9. Цели, которые дошли до отчёта (правила с неизвестным rk или метрикой отсеял ноут).
SELECT k.rule_id, u.nm AS unit, k.metric_id, k.target,
       k.f_paint, k.f_it, k.f_stream, k.f_spec, k.f_staff, k.f_hct,
       k.valid_from, k.valid_to, k.author
FROM prod_proteus.hrbp_hub_kpi k
LEFT JOIN prod_proteus.hrbp_hub_unit u ON u.id = k.unit_id
ORDER BY unit, k.metric_id;

-- 10. Значения разрезов в фильтрах отчёта и численность последнего закрытого месяца.
SELECT c.1 AS cut, c.2 AS value, sum(v) AS headcount
FROM (
  SELECT [('paint', ifNull(paint, '')), ('it', ifNull(it, '')), ('stream', ifNull(stream, '')),
          ('spec', ifNull(spec, '')), ('staff', ifNull(staff, '')), ('hct', ifNull(hct, ''))] AS cs,
         toInt64(ifNull(arrayElement(m_hc, (SELECT toUInt32(max(idx) + 1) FROM prod_proteus.hrbp_hub_calendar
                                            WHERE grain = 'm' AND is_closed = 1)), 0)) AS v
  FROM prod_proteus.hrbp_hub_cube
)
ARRAY JOIN cs AS c
GROUP BY cut, value
ORDER BY cut, headcount DESC;

-- 11. Датасет целиком: вставьте в SQL Lab текст файла 2 и выполните — Jinja отработает
--     с пустыми фильтрами и вашим логином. Ждали: строка role = meta (в j — ваша роль,
--     зона, zone_n — юнитов в зоне, tr_top = 1 — атрибуты трансформеров из свёртки), dict
--     (n = zone_n + предки корней), base, scope, c, g, f, tr (17 осей); время ответа — секунды.
