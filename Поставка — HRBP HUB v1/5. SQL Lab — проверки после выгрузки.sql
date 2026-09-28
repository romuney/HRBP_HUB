-- ============================================================================
-- HRBP HUB — проверки в SQL Lab (база CROSS, ClickHouse) после прогона ноута.
-- Запросы независимые: выделить один и выполнить. Зелёное — можно заводить
-- датасет и чарт; «ждали / пришло» расходятся — смотреть параграф «HH · проверки».
-- ============================================================================

-- 1. Все шесть таблиц на месте и свежие: строки и дата данных.
--    Ждали: calendar 48 строк; unit, access, cube, attr — не пусто; kpi — сколько целей в реестре.
SELECT 'hrbp_hub_calendar' AS t, count() AS rows, toString(max(ifNull(data_dt, toDate('1970-01-01')))) AS data_dt FROM prod_proteus.hrbp_hub_calendar
UNION ALL SELECT 'hrbp_hub_unit', count(), toString(max(ifNull(last_dt, toDate('1970-01-01')))) FROM prod_proteus.hrbp_hub_unit
UNION ALL SELECT 'hrbp_hub_access', count(), '' FROM prod_proteus.hrbp_hub_access
UNION ALL SELECT 'hrbp_hub_kpi', count(), '' FROM prod_proteus.hrbp_hub_kpi
UNION ALL SELECT 'hrbp_hub_cube', count(), '' FROM prod_proteus.hrbp_hub_cube
UNION ALL SELECT 'hrbp_hub_attr', count(), '' FROM prod_proteus.hrbp_hub_attr;

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

-- 4. Куб атрибутов сходится с кубом: по каждому атрибуту численность последнего
--    закрытого месяца одна и та же. Ждали: во всех 11 строках одно число = п. 3.
SELECT ifNull(attr_k, '') AS attr,
       sum(toInt64(ifNull(arrayElement(m_hc, (SELECT toUInt32(max(idx) + 1) FROM prod_proteus.hrbp_hub_calendar WHERE grain = 'm' AND is_closed = 1)), 0))) AS headcount_last_month
FROM prod_proteus.hrbp_hub_attr
GROUP BY attr
ORDER BY attr;

-- 5. Доступ: кто что видит. role super / admin — вся компания, hrbp — корни зоны.
--    Впишите логин вместо 'ivanov.i' — пусто = у логина нет зоны, отчёт скажет «нет зоны HRBP».
SELECT a.login, a.role, a.hrbp_nm, u.nm AS root_unit, u.lvl, u.hc_now
FROM prod_proteus.hrbp_hub_access a
LEFT JOIN prod_proteus.hrbp_hub_unit u ON u.id = a.root_id
WHERE a.login = lower('ivanov.i')
ORDER BY u.hc_now DESC;

-- 6. Сколько HRBP и корней в доступе (без логинов): бой — десятки HRBP, 1 супер, админы.
SELECT ifNull(role, '') AS role, uniqExact(login) AS logins, count() AS roots
FROM prod_proteus.hrbp_hub_access
GROUP BY role;

-- 7. Цели, которые дошли до отчёта (правила с неизвестным rk или метрикой отсеял ноут).
SELECT k.rule_id, u.nm AS unit, k.metric_id, k.target,
       k.f_paint, k.f_it, k.f_stream, k.f_spec, k.f_staff, k.f_hct,
       k.valid_from, k.valid_to, k.author
FROM prod_proteus.hrbp_hub_kpi k
LEFT JOIN prod_proteus.hrbp_hub_unit u ON u.id = k.unit_id
ORDER BY unit, k.metric_id;

-- 8. Значения разрезов в фильтрах отчёта и численность последнего закрытого месяца.
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

-- 9. Датасет целиком: вставьте в SQL Lab текст файла 2 и выполните — Jinja отработает
--    с пустыми фильтрами и вашим логином. Ждали: строка role = meta (в j — ваша роль
--    и зона), dict, base, scope, c, g, f; время ответа — единицы секунд.
