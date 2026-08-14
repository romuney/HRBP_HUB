# HRBP HUB — словарь витрин

Полный перечень объектов с типами: что где лежит, из чего собирается,
какие значения допустимы. Это справочник — «почему так» лежит
в `dataset-spec.md`.

Читать так: § 0 — карта репозитория, § 1–2 — соглашения и допустимые
значения, § 3 — что мы ждём от источников, § 4–9 — таблицы по слоям,
§ 10 — что видит Proteus, § 11 — инварианты одним чек-листом,
§ 12 — сквозная трассировка «откуда взялось число».

---

## 0. Где что лежит

| Файл | Что внутри |
|---|---|
| `docs/dataset-spec.md` | архитектура и обоснования: гранул, развёртка дерева, массивы, объёмы |
| `docs/data-dictionary.md` | этот файл: все таблицы и колонки с типами |
| `sql/greenplum/00_dim_period.sql` | календарь слотов — первый шаг конвейера |
| `sql/greenplum/01_dim_unit.sql` | оргструктура: узлы, замыкание, зоны HRBP |
| `sql/greenplum/02_fact_employee_period.sql` | L1: сотрудник × период |
| `sql/greenplum/03_agg_unit_cut.sql` | L2: куб «лист × разрезы × метрика» |
| `sql/greenplum/04_mart_hub.sql` | L3: развёртка по дереву и свёртка времени в массивы |
| `sql/greenplum/05_kpi_effective.sql` | цели: наследование и ряд цели |
| `sql/clickhouse/10_ddl.sql` | схема приёмника |
| `sql/clickhouse/11_load.sql` | загрузка, проверки, атомарная публикация |
| `sql/proteus/20_dataset_hub.sql` | виртуальный датасет `hrbp_hub` |
| `sql/proteus/21_payload.md` | контракт payload и что делает фронт |

Порядок запуска в Greenplum — по номерам файлов. `00` первым не для
красоты: от календаря слотов зависят все массивы, и если факт
пересобрать с новым окном, а цели оставить со старым, линия цели уедет
на месяц молча.

Схемы: `hrbp_core` — внутренний слой (в BI не уходит), `hrbp_mart` —
витрины, `hrbp_src` — то, что приезжает извне (реестр целей),
`hrbp` — база в ClickHouse.

---

## 1. Соглашения

**Типы.** В Greenplum `text` для всех идентификаторов и кодов,
`numeric(18,2)` для мер, `date` для дат, `smallint` для флагов 0/1.
В ClickHouse строки с малым числом значений — `LowCardinality(String)`,
меры в массивах — `Float32`.

**Идентификаторы.** Ключ всегда `*_id`, имя всегда `*_name`. Имена —
атрибут, а не ключ: они меняются при реорганизациях.

**NULL.** В измерениях NULL не используется — вместо него пустая строка
или явное `'all'`. Причина прикладная: `NULL` в SQL-сравнении ведёт себя
не как значение, и правило «цель на всю численность» перестало бы
находиться. NULL допустим только там, где он означает «показателя нет»:
`company_ref`, `period_year`.

**Флаги** — `smallint` в GP и `UInt8` в CH, значения строго 0/1.

**Массивы** — `numeric[]` в GP, `Array(Float32)` в CH. Длина ровно 24,
порядок по `slot_idx`. Это инвариант, а не соглашение: массивы
позиционные, сдвиг на элемент молча переставит весь ряд.

**Порядок колонок значим.** Данные едут из GP в CH через parquet
и вставляются `select *`, поэтому порядок колонок в `mart_hub` и
`hub_fact` обязан совпадать. Расхождение проявится не ошибкой типа,
а перепутанными значениями.

---

## 2. Справочные значения

Один и тот же перечень работает в трёх местах: фильтр отчёта, атрибут
сотрудника и условие применения цели. Поэтому он один.

| Поле | Допустимые значения | В правиле KPI |
|---|---|---|
| `paint` | `HQ`, `Line`, `Support` | + `all` |
| `it_segment` | `IT`, `nonIT` | + `all` |
| `stream` | `Платформа`, `Продукт`, `Данные`, `Операции`, `Сопровождение` | + `all` |
| `spec` | `Разработка`, `Аналитика`, `Тестирование`, `Инфраструктура`, `Продукт`, `Поддержка` | + `all` |
| `staff_type` | `staff`, `nonstaff` | + `all` |
| `hc_type` | `core`, `part`, `project`, `intern` | + `all` |
| `grain` | `month`, `week` | — |
| `row_kind` | `fact`, `bench`, `target` | — |
| `metric_better` | `higher`, `lower`, `flat` | — |
| `metric_fmt` | `pct`, `days`, `int` | — |

`all` в фильтре отчёта означает «предиката нет»: суммируем всё.
`all` в правиле KPI означает «цель применяется к любой численности».
Это разные вещи, и в витрине они лежат в разных колонках (`paint`
против `f_paint`).

### Метрики (`dim_metric`)

| `metric_id` | Название | `better` | `fmt` | `is_ratio` | `out_scale` | Числитель / знаменатель |
|---|---|---|---|---|---|---|
| `retention_new` | Закрепляемость новичков | higher | pct | 1 | 100 | прошли ИС и остались / у кого ИС закрылся (3 мес) |
| `regret` | Regrettable текучесть | lower | pct | 1 | 100 | regrettable-увольнения / средняя численность (12 мес) |
| `nonregret` | Non regrettable текучесть | flat | pct | 1 | 100 | то же по non-regrettable |
| `exit_reasons` | Заполнение причин увольнений | higher | pct | 1 | 100 | увольнения с причиной / все увольнения (3 мес) |
| `headcount` | Численность | flat | int | 0 | 1 | списочная численность / — |
| `jun_team` | % джунов в команде | higher | pct | 1 | 100 | джуны / численность |
| `jun_hire` | % джунов в найме | higher | pct | 1 | 100 | принятые джуны / все принятые (3 мес) |
| `region_hire` | % найма в регионах | higher | pct | 1 | 100 | принятые вне МСК и СПб / все принятые (3 мес) |
| `absentees` | Прогульщики | lower | pct | 1 | 100 | сотрудники с прогулами / численность |
| `unused_vac` | Неотгуленные отпуска | lower | days | 1 | 1 | накопленные дни / численность |

Для недельного гранула окна пересчитываются в недели: 3 мес → 13 недель,
12 мес → 52 недели.

---

## 3. Контракт источников

Что мы ждём от хранилища. Имена таблиц условные — подставляются свои,
важен состав полей.

### `hr_dwh.org_unit` — оргструктура

| Поле | Тип | Комментарий |
|---|---|---|
| `unit_id` | text | ключ узла |
| `parent_unit_id` | text | NULL только у корня |
| `unit_name` | text | |
| `is_current` | boolean | берём действующий срез |

### `hr_dwh.headcount_snapshot` — численность на конец периода

| Поле | Тип | Комментарий |
|---|---|---|
| `snapshot_date` | date | конец месяца / недели |
| `employee_id` | bigint | |
| `unit_id` | text | лист оргструктуры |
| `paint`, `it_segment`, `stream`, `spec`, `staff_type`, `hc_type` | text | шесть разрезов на дату среза |

### `hr_dwh.employee_movement` — движение

| Поле | Тип | Комментарий |
|---|---|---|
| `employee_id` | bigint | |
| `event_type` | text | `hire` / `exit` |
| `event_date` | date | |
| `unit_id`, шесть разрезов | text | атрибуты **на дату события** |
| `grade_group` | text | грейд на дату приёма |
| `work_city` | text | для регионализации найма |
| `is_regrettable` | boolean | ключевое поле для `regret` / `nonregret` |
| `exit_reason_id` | text | NULL = причина не заполнена |
| `probation_end_date` | date | конец испытательного срока |
| `probation_result` | text | `passed` / прочее |

### `hr_dwh.grade`, `hr_dwh.vacation_balance`, `hr_dwh.absence`

Грейд на дату (`valid_from` / `valid_to`), остаток неотгуленных дней
на дату, факты неоправданных отсутствий по дням.

### `hrbp_src.kpi_rule` — реестр целей из инструмента настройки

| Поле | Тип | Комментарий |
|---|---|---|
| `rule_id` | text | ключ правила |
| `hrbp_id` | text | кто поставил |
| `unit_id` | text | **тот же справочник**, что в оргструктуре |
| `metric_id` | text | из `dim_metric`, не свободный текст |
| `target` | numeric | в единицах метрики |
| `f_paint`, `f_it_segment`, `f_stream`, `f_spec`, `f_staff_type`, `f_hc_type` | text | `all` или значение, **не NULL** |
| `valid_from` | date | с какой даты цель действует |
| `valid_to` | date | NULL = бессрочно |
| `is_active` | boolean | |
| `updated_at` | timestamp | тай-брейк при конфликте |
| `note` | text | |

---

## 4. Greenplum: справочники

### `hrbp_mart.dim_period` — календарь слотов

Гранул: гранул × слот. Строк: 48. Распределение: replicated.

| Поле | Тип | Комментарий |
|---|---|---|
| `grain` | text | `month` / `week` |
| `slot_idx` | int | 0…23, позиция в массиве |
| `period_start` | date | первое число месяца / понедельник |
| `period_end` | date | последний день месяца / воскресенье |
| `is_closed` | boolean | закрыт ли период |
| `period_year` | int | год, только для месяцев; NULL для недель |

Раскладка слотов: месяцы `0…11` — прошлый календарный год, `12…23` —
текущий; недели `0…11` — предыдущие двенадцать, `12…23` — последние
двенадцать закрытых.

### `hrbp_mart.dim_unit` — узлы оргструктуры

Гранул: узел. Строк: по числу подразделений (порядок тысяч).

| Поле | Тип | Комментарий |
|---|---|---|
| `unit_id` | text | ключ |
| `parent_unit_id` | text | NULL у корня |
| `unit_name` | text | |
| `unit_level` | int | 1 — компания, дальше вниз |
| `unit_path` | text | путь из `unit_id` через `/`: `T/01/02` |
| `unit_path_name` | text | путь из имён через ` › ` — для шапки отчёта |
| `is_leaf` | boolean | нет действующих детей |

### `hrbp_mart.dim_unit_closure` — замыкание дерева

Гранул: пара «предок → потомок», включая пару узла с самим собой.
Строк: узлы × средняя глубина.

| Поле | Тип | Комментарий |
|---|---|---|
| `scope_unit_id` | text | предок = юнит отчёта |
| `scope_unit_name` | text | |
| `scope_unit_level` | int | |
| `unit_id` | text | потомок |
| `unit_level` | int | |
| `unit_is_leaf` | boolean | для джойна с фактом берём только листья |
| `rel_depth` | int | `unit_level − scope_unit_level` |
| `child_unit_id` | text | узел −1 от предка по пути потомка |
| `grandchild_unit_id` | text | узел −2; если потомок выше — он сам |

### `hrbp_mart.dim_hrbp_scope` — зоны HRBP

Гранул: HRBP × узел. Включает зоны подчинённых (Senior видит юниоров).

| Поле | Тип | Комментарий |
|---|---|---|
| `hrbp_id` | text | |
| `hrbp_login` | text | для RLS по текущему пользователю |
| `unit_id` | text | узел, попадающий в зону |
| `zone_root_unit_id` | text | корень зоны, накрывшей узел |

### `hrbp_mart.dim_unit_owner` — ответственный за узел

Гранул: узел. Самая глубокая зона, накрывающая путь.

| Поле | Тип |
|---|---|
| `unit_id` | text |
| `owner_hrbp_id` | text |
| `owner_zone_root_unit_id` | text |

### `hrbp_mart.dim_metric` — паспорт метрик

Гранул: метрика. Строк: 10. Распределение: replicated.
Состав — таблица в § 2, плюс `metric_short`, `metric_block`,
`metric_unit`, `company_ref` (numeric, NULL у нейтральных),
`sort_order` (int).

---

## 5. Greenplum: L1 — сотрудник × период

### `hrbp_core.fact_employee_period`

Гранул: гранул × период × сотрудник × юнит × шесть разрезов.
В BI **не уходит**. Партиционирована по месяцам.

Ключ включает разрезы, а не только сотрудника: если разрез сменился
внутри периода и человек в том же периоде уволился, он даёт две строки —
запас считается по одной атрибутике, поток по другой, и аддитивность
не ломается.

| Поле | Тип | Комментарий |
|---|---|---|
| `grain` | text | `month` / `week` |
| `period_start`, `period_end` | date | границы периода |
| `employee_id` | bigint | |
| `unit_id` | text | лист оргструктуры |
| `paint`, `it_segment`, `stream`, `spec`, `staff_type`, `hc_type` | text | шесть разрезов |
| `is_headcount` | smallint | в списочной численности на конец периода |
| `is_junior` | smallint | грейд Junior / Junior+ |
| `is_absentee` | smallint | были неоправданные отсутствия |
| `unused_vac_days` | numeric(6,1) | накоплено неотгуленных дней |
| `is_hire` | smallint | принят в этом периоде |
| `is_hire_junior` | smallint | принят джуном |
| `is_hire_region` | smallint | принят вне МСК и СПб |
| `is_exit` | smallint | уволен в этом периоде |
| `is_exit_regret` | smallint | увольнение regrettable |
| `is_exit_nonregret` | smallint | увольнение non-regrettable |
| `is_exit_reason_filled` | smallint | причина увольнения заполнена |
| `is_probation_due` | smallint | ИС закрылся в этом периоде |
| `is_probation_passed` | smallint | и закрылся успешно |

Правило атрибутов: **запасы** (`is_headcount`, `is_junior`,
`unused_vac_days`) берут разрезы на конец периода, **потоки**
(`is_hire*`, `is_exit*`, `is_probation*`) — на дату события.

---

## 6. Greenplum: L2 — куб по разрезам

Три таблицы одного шага. Первые две промежуточные, но живут как таблицы:
на них удобно смотреть при разборе расхождений.

### `hrbp_mart.agg_unit_cut_raw`

Гранул: гранул × период × лист × шесть разрезов. Сотрудник исчез.

Счётчики: `hc`, `jun`, `vac_days`, `absentees`, `hires`, `hires_jun`,
`hires_region`, `exits`, `exits_regret`, `exits_nonregret`,
`exits_reason`, `prob_due`, `prob_passed` — все `numeric`.

### `hrbp_mart.agg_unit_cut_rolled`

То же плюс скользящие окна. Ряд предварительно **уплотняется**
календарём: оконный кадр в GP отсчитывается в строках, а не в датах,
и по дырявому ряду `11 preceding` соберёт окно не той длины.

| Поле | Тип | Окно |
|---|---|---|
| `exits_regret_long`, `exits_nonregret_long` | numeric | 12 мес / 52 нед |
| `hc_avg_long` | numeric | средняя численность за длинное окно |
| `exits_short`, `exits_reason_short` | numeric | 3 мес / 13 нед |
| `hires_short`, `hires_jun_short`, `hires_region_short` | numeric | 3 мес / 13 нед |
| `prob_due_short`, `prob_passed_short` | numeric | 3 мес / 13 нед |

### `hrbp_mart.agg_unit_cut_metric`

Длинный формат: метрика стала значением, а не колонкой. Здесь же ряд
обрезается до окна отчёта — за его пределами он был нужен только
скользящим окнам.

| Поле | Тип | Комментарий |
|---|---|---|
| `grain` | text | |
| `period_start` | date | |
| `slot_idx` | int | позиция в будущем массиве |
| `unit_id` | text | лист |
| шесть разрезов | text | |
| `metric_id` | text | |
| `value_num` | numeric(18,2) | числитель |
| `value_den` | numeric(18,2) | знаменатель; у абсолютных метрик 1 — он работает маской присутствия, а не делителем |

---

## 7. Greenplum: L3 — витрина

### `hrbp_mart.mart_hub_slot`

Промежуточная: развёртка по дереву уже сделана, время ещё строками.
Гранул: гранул × слот × `scope` × узел −1 × узел −2 × разрезы × метрика.

Колонки: `grain`, `slot_idx`, `scope_unit_id`, `scope_unit_name`,
`scope_unit_level`, `child_unit_id`, `grandchild_unit_id`,
`scope_hrbp_id`, `scope_hrbp_zone_root_id`, шесть разрезов, `metric_id`,
`value_num`, `value_den`.

Из неё же собирается база сравнения — срезом `scope_unit_level = 1`.

### `hrbp_mart.mart_hub` → `hrbp.hub_fact`

**Главная витрина.** Гранул: `scope` × узел −1 × узел −2 × шесть
разрезов × метрика. Периода в ключе нет — он внутри массивов.

| # | Поле | Тип GP | Тип CH | Комментарий |
|---|---|---|---|---|
| 1 | `scope_unit_id` | text | LowCardinality(String) | юнит отчёта; в запросе всегда зафиксирован ровно один |
| 2 | `scope_unit_name` | text | LowCardinality(String) | |
| 3 | `scope_unit_level` | int | UInt8 | 1 — компания |
| 4 | `child_unit_id` | text | LowCardinality(String) | узел −1: строки таблицы «Команды» |
| 5 | `child_unit_name` | text | LowCardinality(String) | |
| 6 | `grandchild_unit_id` | text | LowCardinality(String) | узел −2: раскрытая строка |
| 7 | `grandchild_unit_name` | text | LowCardinality(String) | |
| 8 | `scope_hrbp_id` | text | LowCardinality(String) | фильтр «HRBP» |
| 9 | `scope_hrbp_zone_root_id` | text | LowCardinality(String) | корень зоны |
| 10 | `paint` | text | LowCardinality(String) | |
| 11 | `it_segment` | text | LowCardinality(String) | |
| 12 | `stream` | text | LowCardinality(String) | |
| 13 | `spec` | text | LowCardinality(String) | |
| 14 | `staff_type` | text | LowCardinality(String) | |
| 15 | `hc_type` | text | LowCardinality(String) | |
| 16 | `metric_id` | text | LowCardinality(String) | |
| 17 | `metric_name` | text | LowCardinality(String) | денормализован из `dim_metric` |
| 18 | `metric_short` | text | LowCardinality(String) | подпись колонки в сводной |
| 19 | `metric_block` | text | LowCardinality(String) | блок One-Pager |
| 20 | `metric_better` | text | LowCardinality(String) | `higher` / `lower` / `flat` |
| 21 | `metric_fmt` | text | LowCardinality(String) | `pct` / `days` / `int` |
| 22 | `metric_unit` | text | LowCardinality(String) | `%`, `дн`, `чел` |
| 23 | `is_ratio` | smallint | UInt8 | 1 — делить числитель на знаменатель |
| 24 | `out_scale` | numeric(6,2) | Float32 | 100 у процентов |
| 25 | `num_m` | numeric[24] | Array(Float32) | числитель, месячные слоты |
| 26 | `den_m` | numeric[24] | Array(Float32) | знаменатель и маска присутствия |
| 27 | `num_w` | numeric[24] | Array(Float32) | числитель, недельные слоты |
| 28 | `den_w` | numeric[24] | Array(Float32) | то же |

Ключ сортировки в ClickHouse:
`(scope_unit_id, metric_id, child_unit_id, grandchild_unit_id, paint, it_segment, stream, spec, staff_type, hc_type)`.
Партиционирования нет — таблица перекладывается целиком.

Объём для организации в 30 000 человек: ~1,3 млн строк.

### `hrbp_mart.mart_hub_bench` → `hrbp.hub_bench`

База сравнения: вся компания под теми же разрезами. Гранул: шесть
разрезов × метрика. Строк: ~14 тысяч.

Колонки: `paint`, `it_segment`, `stream`, `spec`, `staff_type`,
`hc_type`, `metric_id`, `is_ratio`, `out_scale`, `num_m`, `den_m`,
`num_w`, `den_w` — типы те же, что в `hub_fact`.

Отдельной таблицей потому, что база зависит от разрезов и **не зависит
от выбранного юнита**: из строк факта её не получить, они уже ограничены
юнитом.

---

## 8. Greenplum: цели

### `hrbp_mart.kpi_effective`

Гранул: узел × метрика × набор разрезов правила. Для каждого узла —
правила всех его предков; внутри одинакового набора разрезов остаётся
правило самого глубокого предка.

| Поле | Тип | Комментарий |
|---|---|---|
| `unit_id` | text | узел, на который действует правило |
| `metric_id` | text | |
| `f_paint` … `f_hc_type` | text | `all` или значение |
| `target` | numeric | целевое значение |
| `rule_id`, `hrbp_id` | text | |
| `owner_unit_id`, `owner_unit_name` | text | на каком юните стоит цель |
| `owner_level` | int | глубина владельца: чем больше, тем ближе |
| `is_inherited` | smallint | владелец ≠ сам узел |
| `is_own` | smallint | цель стоит на самом узле |
| `specificity` | smallint | сколько разрезов зафиксировано, 0…6 |
| `valid_from`, `valid_to_eff` | date | история; `valid_to_eff` = 9999-12-31 если бессрочно |

### `hrbp_mart.kpi_effective_arr` → `hrbp.kpi_effective`

То же плюс цель как ряд. **В ClickHouse эта таблица называется
`kpi_effective`** — там промежуточная не нужна.

| Поле | Тип GP | Тип CH | Комментарий |
|---|---|---|---|
| `target_m` | numeric[24] | Array(Float32) | значение цели по месячным слотам |
| `tmask_m` | numeric[24] | Array(Float32) | 1 там, где цель действовала |
| `target_w`, `tmask_w` | numeric[24] | Array(Float32) | то же по неделям |

Колонок `valid_from` / `valid_to_eff` в CH нет: история уже развёрнута
в маску.

### `hrbp_mart.kpi_unit_flag`

Гранул: узел. Питает пометку «●» в списках юнитов.

| Поле | Тип | Комментарий |
|---|---|---|
| `unit_id` | text | |
| `has_own_target` | smallint | на юните есть своя цель |
| `own_target_cnt` | bigint | сколько своих |
| `effective_target_cnt` | bigint | сколько действует всего, включая унаследованные |

---

## 9. ClickHouse: справочники для фронта

### `hrbp.dim_period`

48 строк. `grain` LowCardinality(String), `slot_idx` UInt8,
`period_start` / `period_end` Date, `is_closed` UInt8,
`period_year` Nullable(UInt16).

Без него позиция в массиве ничего не значит. Отсюда же фронт берёт
индекс последнего закрытого месяца — не угадывая его по данным.

### `hrbp.dim_unit`

Дерево юнитов. К полям из GP добавлено:

| Поле | Тип | Комментарий |
|---|---|---|
| `has_own_target` | UInt8 | из `kpi_unit_flag` |
| `unit_label` | String MATERIALIZED | имя с отступом по уровню и меткой `●` |

### `hrbp.dim_metric`, `hrbp.dim_hrbp_scope`, `hrbp.dim_cut`

Паспорт метрик (нужен веткам «база» и «цель» в serving-вьюхе — там
строки приходят не из факта), зоны HRBP для RLS и список разрезов
для переключателя оси на вкладке «Трансформеры» (6 строк:
`cut_key`, `cut_name`, `sort_order`).

---

## 10. Датасет `hrbp_hub`: что видит Proteus

`UNION ALL` трёх веток с общим набором колонок. Ветка различается
колонкой `row_kind`.

| Поле | Тип | `fact` | `bench` | `target` |
|---|---|---|---|---|
| `row_kind` | String | `fact` | `bench` | `target` |
| `scope_unit_id` | String | из факта | подставлен выбранный | подставлен выбранный |
| `scope_unit_name`, `scope_unit_level` | String, UInt8 | из факта | пусто | пусто |
| `child_unit_id`, `child_unit_name` | String | узел −1 | пусто | пусто |
| `grandchild_unit_id`, `grandchild_unit_name` | String | узел −2 | пусто | пусто |
| `scope_hrbp_id`, `scope_hrbp_zone_root_id` | String | из факта | пусто | пусто |
| `paint` … `hc_type` | String | из факта | из базы | подставлены выбранные |
| `cut_value` | String | значение выбранного разреза | `все` | `все` |
| `metric_id` … `metric_unit` | String | паспорт метрики | | |
| `is_ratio` | UInt8 | из метрики | из метрики | 0 — цель уже в единицах метрики |
| `out_scale` | Float32 | из метрики | из метрики | 1 |
| `num_m`, `den_m`, `num_w`, `den_w` | Array(Float32) | числитель / знаменатель | то же по компании | цель / маска действия |
| `target_unit_id` | String | пусто | пусто | к какому юниту относится цель |
| `target_owner_name` | String | пусто | пусто | с какого уровня пришла |
| `target_inherited` | UInt8 | 0 | 0 | 1 если унаследована |
| `target_is_own` | UInt8 | 0 | 0 | 1 если стоит на самом юните |

Метрики датасета — только четыре:
`sumForEach(num_m)`, `sumForEach(den_m)`, `sumForEach(num_w)`,
`sumForEach(den_w)`. Всё остальное считает фронт.

Подстановка выбранных значений в ветках `bench` и `target` — не хитрость,
а необходимость: иначе нативный фильтр юнита выкинул бы эти строки,
хотя популяция у них своя.

---

## 11. Инварианты и проверки

Собраны в одном месте, чтобы их можно было проверить как чек-лист.

| Инвариант | Где проверяется | Что ловит |
|---|---|---|
| 24 слота на гранул, индексы без дыр | `00_dim_period.sql`, блок `do $$` | сдвиг окна |
| Длина всех массивов ровно 24 | `04_mart_hub.sql`, `CONSTRAINT` в CH, проверка при загрузке | недобор слотов → переставленный ряд |
| `value_num ≤ value_den` у долей | `11_load.sql` | ошибка в определении метрики |
| Сумма по уровню 1 = сумме по уровню 2 | `11_load.sql`, поэлементно | задвоение или потеря при развёртке |
| Строк не убыло больше чем на 10% | `11_load.sql` | неполный срез источника |
| В запросе зафиксирован один `scope_unit_id` | обязательный фильтр дашборда | задвоение по предкам |
| `metric_id` в группировке или фильтре | договорённость, § 8.3 спеки | сложение разных метрик |
| Разрезы в Jinja совпадают с фильтрами полки | ревью `20_dataset_hub.sql` | база считается по более широкой популяции — тихо |
| Порядок колонок `mart_hub` = `hub_fact` | ревью при изменении схемы | перепутанные значения при `select *` |

Последние три — единственные, что не закрыты автоматикой. Первые два
из них закрываются код-ревью, третий стоит закрыть тестом на сравнение
списков колонок, если схема начнёт меняться часто.

---

## 12. Что откуда берётся

Сквозная трассировка для колонок, по которым чаще всего возникает вопрос
«почему такое число».

| Колонка витрины | Путь |
|---|---|
| `num_m` метрики `regret` | `employee_movement.is_regrettable` → `is_exit_regret` (L1) → `exits_regret` (L2 raw) → `exits_regret_long`, окно 12 мес (L2 rolled) → `value_num` (L2 metric) → сумма по дереву (L3 slot) → элемент массива (L3) |
| `den_m` метрики `regret` | `headcount_snapshot` → `is_headcount` → `hc` → `hc_avg_long` = Σ hc / 12 → `value_den` → сумма → элемент массива |
| `den_m` = 0 | период не закрыт (`dim_period.is_closed = 0`) либо не было популяции |
| `child_unit_id` | `dim_unit.unit_path` → сегмент уровня `scope_level + 1` в `dim_unit_closure` |
| `scope_hrbp_id` | `hr_dwh.hrbp_scope` → `dim_unit_owner` (самая глубокая зона, накрывшая узел) |
| `target_m` | `kpi_rule` → наследование по closure (`kpi_effective`) → разворот по истории в ряд (`kpi_effective_arr`) → выбор победителя по `(owner_level, specificity)` в serving-вьюхе |
| `has_own_target` | `kpi_rule.unit_id` = сам узел → `is_own` → `kpi_unit_flag` |
