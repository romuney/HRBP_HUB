# CLAUDE.md

Репозиторий отчёта **HRBP HUB**: макет (корень: `index.html`, `app.js`, `ui.js`,
`charts.js`, `data.js`, `styles.css` — публикуется GitHub Pages из `main`) и его
реализация в корпоративном BI **Proteus** (форк Superset, кастомные JS-чарты
`react_sanbbox`). Боевые системы (Greenplum, Helicopter, ClickHouse, Proteus)
отсюда недоступны: владелец вставляет файлы руками по инструкции из папки поставки.

Как устроено — **`docs/architecture.md`** (читать первым). Бизнес-смысл метрик —
`docs/business-context.md`, доступ — `docs/access-model.md`, поля фильтров —
`docs/filter-fields.md`. `docs/dataset-spec.md`, `docs/data-dictionary.md` и `sql/` —
первый проект, в реализации не используется.

## Куда идти

| Задача | Куда |
|---|---|
| Поменять расчёт / источник / окно метрики | `helicopter/paragraphs/NN …sql` → `python3 helicopter/build.py` → стенд |
| Поменять датасет | `proteus/hrbp-hub.data.sql` → `python3 stand/check.py` (оба движка) → `stand/scale.py` на 24.8 |
| Поменять чарт | `proteus/hrbp-hub.chart.js` по скиллу proteus-echarts-builder → `node --check` → `check.py` скилла → живой стенд |
| Отдать владельцу | `python3 stand/pack.py` → папка `Поставка — HRBP HUB v2/` («замени из файла N»), правка `0. Инструкция.md` (после первой установки у владельца — раздел «Что нового»: какие файлы заменить) |
| Цели KPI | параграф `12 KPI · реестр целей.sql` (правится руками), в отчёте — вкладка «Цели» |

## Стенд (без доступа к бою)

PostgreSQL 16 играет Greenplum (SQL держится в подмножестве GP6 ≈ PG 9.4: без
FILTER, GROUPING SETS, LATERAL), chdb — ClickHouse. Боевой ClickHouse — 24.8:
chdb 2.1.1 (= 24.8.4.1) ставится в отдельный venv, системный chdb 4.x — 26.9.

```
python3 stand/gen_sources.py              # синтетический мир (stand/world.py) → источники в БД gp
python3 stand/run_gp.py --seed-kpi        # ВСЕ gp-параграфы из YAML, в том числе стоп-проверки
python3 stand/ch.py load [nullable|plain] # hrbp_hub_* → prod_proteus.* в chdb (Nullable, как gp_to_click)
python3 stand/check.py                    # 171 проверка датасета против stand/expect.py (независимый расчёт)
<venv chdb 2.1.1>/bin/python stand/check.py   # то же на ClickHouse 24.8 — 173 (+ режим group_by_use_nulls)
<venv chdb 2.1.1>/bin/python stand/scale.py <каталог>  # 100 тыс. сотрудников: время, строки, JSON (HH_SCALE_COMBOS=4 — тяжёлый куб)
python3 stand/live.py                     # чарт в браузере поверх chdb: ?user=a.sergeeva|b.kotov|s.volkov|nobody, ?w=900, ?selfoff=1
HH_DICT_FULL_MAX=10 python3 stand/live.py # то же, но справочник «большой зоны» (окрестность + поиск по зоне)
python3 stand/mock.py                     # proteus/hrbp-hub.mock.json для smoke (live.py остановить: chdb держит каталог)
```

Логины мира: `a.sergeeva` — супер-HRBP, `r.kazantsev` — админ, `b.kotov` — HRBP
«Розничного бизнеса», `s.volkov` — две корневые ветки + младший HRBP внутри,
`e.lapin`, `nobody` — без роли. Глубокая ветка мира: «Отдел бэкенда» → … → «Ячейка A1-1»
(12-й уровень) → «Микроячейка A1-1-a» (13-й: юнита в отчёте нет, его люди — в «Ячейке»).
Скилл proteus-echarts-builder лежит в репозитории `romuney/adoption` (ветка `new`,
`skills/`): `python3 <скилл>/check.py proteus/hrbp-hub.chart.js` (для smoke —
`NODE_PATH=$(npm root -g)`).

## Инварианты — не ломать

- **Метрика = Σ числителя / Σ знаменателя.** В таблицах и датасете — только компоненты
  (`hc, jun, rg, nrg, hcw, nr, r3n, r3d, r6n, r6d, hire, fire`), проценты — в JS.
- **Время — позиция в массиве** (`hrbp_hub_calendar`): месяцы 0–11 прошлый год, 12–23 текущий;
  недели 0–23, 23 — последняя закрытая. Окна (12/52, 3/13) считаются в параграфе 10.
- **Датасет — один на отчёт**, строки ролей meta/dict/hrbps/base/scope/c/g/x/f/tr/kpi,
  29 колонок. Новая колонка = правка «Измерений» в Proteus владельцем (FIELDS.md).
- **Уровни** — как в ультраширокой: путь = `lvl1` + `lvl3…lvl12` (до 11 id), `lvl` в
  справочнике — номер уровня источника; `lvl2` и глубже 12-го в путь не берутся.
- **Масштаб ≈100 тыс.**: куб читается только диапазоном `path_s` области (и раскрытых
  узлов), база — из `hrbp_hub_base`, справочник зоны больше `DICT_FULL_MAX` (1 500) —
  окрестностью (`dict_mode = part`) + поиск `q_f`. Не возвращать чтение всего куба.
- **Кросс-фильтры**: носители `unit_f`, `paint_f…hct_f`, `tr_f`, `exp_f`, `q_f` не выводятся в SELECT;
  `value = []` не эмитится никогда; маска — целиком; самовлияние чарта включено.
- **ClickHouse 24.8**: без неконстантных WITH-алиасов в подзапросах (CTE + CROSS JOIN ctx),
  без SETTINGS в датасете, `ifNull` на каждой колонке (gp_to_click даёт Nullable),
  проверять и старым анализатором, и `prefer_column_name_to_alias = 1`, `join_use_nulls = 1`,
  `group_by_use_nulls = 1` (ключи ROLLUP — через `ifNull`).
- **Доступ** — только через `current_username()` и `hrbp_hub_access` внутри датасета;
  юниты вне зоны не приезжают ни в каком виде.
- **Чарт** — ES5 (без let/const, стрелок, шаблонных строк), БЛОКИ 1–7 шаблона скилла,
  состояние в `window.__pvtState.hh`, классы с префиксом `hh-`, графики — свой SVG
  по измеренной ширине (ResizeObserver правит только габариты через `relayout`).
- **Вид чарта — профиль Proteus Adoption** (adoption `DESIGN_SYSTEM.md` §16): кегли только
  ролями `CFG.fonts`, веса 400/500/600 (700+ нет), контролы 34 px, ⓘ 14 px, каретка 28×28,
  панель 14/16, KPI 12/14, таблица th 9/8 · td 6/8 · строка 44. Новых кеглей «на глаз» нет.
- Дата «бессрочно» в целях — `2099-12-31` (Date в ClickHouse кончается в 2149).

## Что не проверено стендом

Боевые значения разрезов и `experience_group_nm`, `super_hrbp_unit_rk`, покрытие
regrettable-разметки, настройки кластера Proteus, DOM борда для CSS (файл 4 поставки).
Их показывают параграф «Диагностика источников» и файл 5 поставки.
