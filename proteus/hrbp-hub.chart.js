// ============================================================================
// hrbp-hub.chart.js — единственный чарт отчёта HRBP HUB
// ============================================================================
// КОНТРАКТ PROTEUS:
//   ECharts = только холст. Вся визуализация - HTML/CSS/SVG в overlay.
//   Хост = ПОСЛЕДНИЙ [_echarts_instance_]. Canvas прячем. Overlay - appendChild.
//   В САМОМ КОНЦЕ ФАЙЛА, ГЛОБАЛЬНО: option = {...} с пустым scatter.
//
// ЗАПРЕЩЕНО: backticks/template-literals, стрелочные функции, let/const,
//   document.getElementById (только overlay.querySelector), console.log в итоге,
//   addEventListener внутри тела render(), обращение к option из catch,
//   мутация option после присваивания, var P = '.' + CFG.ns в buildHTML
//   (точка только в buildCSS).
// ОБЯЗАТЕЛЬНО: все 7 блоков ниже, в таком порядке, без перенумерации.
// ОБЯЗАТЕЛЬНО: вызов render(); в теле mount() — без него overlay пустой.
//
// ВЫЧИСЛЕНИЯ ЖИВУТ ЗДЕСЬ, А НЕ В SQL. Проценты, дельты, ранги, накопительные
//   итоги, сортировка и форматирование считаются в buildModel() (БЛОК 3).
//   SQL отдаёт сырые строки — базу не нагружаем.
// ============================================================================

// ---------- БЛОК 1: CFG ----------
// Единственный чарт отчёта HRBP HUB: шапка с выбором юнита и разрезов, вкладки
// «Сводка · Команды · Трансформеры · Цели · Каталог метрик». Данные — датасет
// hrbp_hub (proteus/hrbp-hub.data.sql): строки разных ролей (role), массивы по 24
// слота строкой через запятую. Чарт эмитит кросс-фильтры САМ СЕБЕ (самовлияние
// включено): юнит, разрезы, ось трансформера. Всё остальное — без запроса.
var CFG = {
  ns: 'hh',
  mode: 'timeseries',          // ось времени есть: 24 месяца + 24 недели, период — позиция в массиве
  fields: {
    role: 'role', id: 'id', pid: 'pid', n: 'n', j: 'j',
    m: { hc: 'm_hc', jun: 'm_jun', rg: 'm_rg', nrg: 'm_nrg', hcw: 'm_hcw', nr: 'm_nr',
         r3n: 'm_r3n', r3d: 'm_r3d', r6n: 'm_r6n', r6d: 'm_r6d', hire: 'm_hire', fire: 'm_fire', rgs: 'm_rgs', nrgs: 'm_nrgs' },
    w: { hc: 'w_hc', jun: 'w_jun', rg: 'w_rg', nrg: 'w_nrg', hcw: 'w_hcw', nr: 'w_nr',
         r3n: 'w_r3n', r3d: 'w_r3d', r6n: 'w_r6n', r6d: 'w_r6d', hire: 'w_hire', fire: 'w_fire', rgs: 'w_rgs', nrgs: 'w_nrgs' }
  },
  carriers: { unit: 'unit_f', axis: 'tr_f', depth: 'depth_f' },
  // Разрезы численности: ключ колонки куба → носитель кросс-фильтра. Один перечень
  // и для фильтра отчёта, и для условий целей KPI (f_*), иначе разъедутся.
  cuts: [
    { key: 'paint',  carrier: 'paint_f',  label: 'Покраска',        all: 'Все покраски' },
    { key: 'it',     carrier: 'it_f',     label: 'IT / nonIT',      all: 'IT и nonIT' },
    { key: 'stream', carrier: 'stream_f', label: 'Стрим',           all: 'Все стримы' },
    { key: 'spec',   carrier: 'spec_f',   label: 'Специализация',   all: 'Все специализации' },
    { key: 'staff',  carrier: 'staff_f',  label: 'Штат / не штат',  all: 'Штат и не штат' },
    { key: 'hct',    carrier: 'hct_f',    label: 'Тип численности', all: 'Вся численность' }
  ],
  // Оси трансформеров: 6 разрезов (из куба) + атрибуты сотрудника (куб атрибутов).
  axes: [
    { key: 'paint', label: 'Покраска' }, { key: 'it', label: 'IT / nonIT' },
    { key: 'stream', label: 'Стрим' }, { key: 'spec', label: 'Специализация' },
    { key: 'staff', label: 'Штат / не штат' }, { key: 'hct', label: 'Тип численности' },
    { key: 'grade', label: 'Грейд' }, { key: 'seniority', label: 'Сеньорность' },
    { key: 'exp', label: 'Стаж в компании' }, { key: 'age', label: 'Возраст' },
    { key: 'gender', label: 'Пол' }, { key: 'head', label: 'Руководители' },
    { key: 'work', label: 'Формат работы' }, { key: 'office', label: 'Офис' },
    { key: 'city', label: 'Город' }, { key: 'macro', label: 'Макрорегион' },
    { key: 'legal', label: 'Юрлицо' }
  ],
  defaultAxis: 'spec',
  // Готовые срезы «Трансформеров» (владелец 13.10: «сразу предложить пресеты, в которых логично смотреть»):
  // вопрос HRBP → метрика × разбивка. Показываются те, чья метрика включена в «Что показывать».
  trPresets: [
    { m: 'regret', a: 'grade', t: 'Ценные уходы по грейдам', q: 'На каких грейдах уходят люди, которых жаль потерять.' },
    { m: 'regret', a: 'exp', t: 'Ценные уходы по стажу', q: 'Уходят ли ценные люди в первый год или после многих лет в компании.' },
    { m: 'regret', a: 'head', t: 'Теряем ли руководителей', q: 'Regrettable текучесть руководителей и остальных сотрудников.' },
    { m: 'retention_new_3', a: 'spec', t: 'Где не задерживаются новички', q: 'Закрепляемость новичков через 3 месяца по специализациям.' },
    { m: 'retention_new_6', a: 'work', t: 'Новички и формат работы', q: 'Закрепляемость новичков через 6 месяцев по формату работы.' },
    { m: 'exit_reasons', a: 'legal', t: 'Где не указывают причины', q: 'Увольнения без причины по юрлицам: кому напомнить заполнить.' },
    { m: 'jun_team', a: 'spec', t: 'Где растим джунов', q: 'Доля джунов и стажёров по специализациям.' },
    { m: 'headcount', a: 'city', t: 'Где работают люди', q: 'Численность по городам.' }
  ],
  trTop: 30,                 // трансформеры: у оси показываем столько крупных значений, остальные — «Остальные»
  // Порядок значений там, где он смысловой, а не по численности.
  order: {
    age: ['до 25', '25–34', '35–44', '45 и старше'],
    exp: ['до 1 года', '1–3 года', '3–5 лет', 'более 5 лет'],
    head: ['Руководитель', 'Не руководитель'],
    staff: ['Штат', 'Не штат'],
    seniority: ['Intern', 'Junior', 'Junior+', 'Middle', 'Middle+', 'Senior', 'Senior+', 'Lead']
  },
  // Группы метрик: панели «Сводки», вкладки «Команд» (плюс «Все метрики»), список «Метрики».
  blocks: [
    { key: 'retention', name: 'Удержание', tab: 'Удержание', hint: 'Сколько новичков остаются в компании через 3 и 6 месяцев.' },
    { key: 'turnover', name: 'Текучесть', tab: 'Текучесть', hint: 'Уходы, о которых жалеем и не жалеем, и заполнение причин.' },
    { key: 'structure', name: 'Структура команды', tab: 'Структура', hint: 'Размер команды и доля джунов.' }
  ],
  // num / den — компоненты куба; denDiv — знаменатель-сумма за окно → средняя.
  // better: higher | lower | flat (у flat цвета и целей нет — «больше» не значит «лучше»).
  metrics: [
    // Тексты (13.10, редактура): hint — одна фраза «что это» (ⓘ, шапки таблиц, список метрик); frac — формула
    // словами: числитель / знаменатель (fracY — с начала года); notes — что важно знать. Без названий полей и таблиц.
    { key: 'retention_new_3', block: 'retention', name: 'Закрепляемость новичков · 3 мес', short: 'Закрепл. 3 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r3n', den: 'r3d',
      hint: 'Какая доля новичков работает в компании через 3 месяца после найма.',
      frac: ['работают через 3 месяца', 'новички за 12 месяцев, у кого прошло 3 месяца'],
      notes: ['Новичок, у которого 3 месяца ещё не прошло, в расчёт пока не входит.'],
      numL: 'работают через 3 мес', denL: 'новичков (найм за 12 мес, прошло 3 мес)', cnt: { of: ['новичка', 'новичков', 'новичков'] }, exL: 'новичков ушло сверх ориентира', exA: 'сверх ориентира ушли' },
    { key: 'retention_new_6', block: 'retention', name: 'Закрепляемость новичков · 6 мес', short: 'Закрепл. 6 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r6n', den: 'r6d',
      hint: 'Какая доля новичков работает в компании через 6 месяцев после найма.',
      frac: ['работают через 6 месяцев', 'новички за 12 месяцев, у кого прошло 6 месяцев'],
      notes: ['Новичок, у которого 6 месяцев ещё не прошло, в расчёт пока не входит.'],
      numL: 'работают через 6 мес', denL: 'новичков (найм за 12 мес, прошло 6 мес)', cnt: { of: ['новичка', 'новичков', 'новичков'] }, exL: 'новичков ушло сверх ориентира', exA: 'сверх ориентира ушли' },
    { key: 'regret', block: 'turnover', name: 'Regrettable текучесть', short: 'Regret',
      fmt: 'pct', better: 'lower', num: 'rg', den: 'hcw', denDiv: { m: 12, w: 52 }, ytd: 'rgs', minHc: 50, hq: true,
      hint: 'Уходы сотрудников, которых жаль потерять.',
      frac: ['regrettable-уходы за 12 месяцев', 'средняя активная численность HQ за 12 месяцев'],
      fracY: ['regrettable-уходы месяца', 'средняя активная численность HQ за месяц', 'сумма по месяцам с января'],
      notes: ['Цель годовая: к каждому месяцу она набирается по частям — к сентябрю 9/12 цели.'],
      numL: 'regrettable-уходов за 12 мес', denL: 'средняя численность за 12 мес', cnt: { n: ['уход', 'ухода', 'уходов'], tail: 'за год' },
      numLy: 'regrettable-уходов с начала года', denLy: 'средняя активная численность HQ', tailY: 'с начала года',
      exL: 'уходов сверх ориентира', exA: 'сверх ориентира' },
    { key: 'nonregret', block: 'turnover', name: 'Non regrettable текучесть', short: 'Non-reg.',
      fmt: 'pct', better: 'flat', num: 'nrg', den: 'hcw', denDiv: { m: 12, w: 52 }, ytd: 'nrgs', minHc: 100, hq: true,
      hint: 'Уходы, о которых не жалеем: управляемая текучесть.',
      frac: ['non-regrettable-уходы за 12 месяцев', 'средняя активная численность HQ за 12 месяцев'],
      fracY: ['non-regrettable-уходы месяца', 'средняя активная численность HQ за месяц', 'сумма по месяцам с января'],
      notes: ['Больше — не значит хуже, поэтому цветом не оцениваем.'],
      numL: 'non-regrettable-уходов за 12 мес', denL: 'средняя численность за 12 мес', cnt: { n: ['уход', 'ухода', 'уходов'], tail: 'за год' },
      numLy: 'non-regrettable-уходов с начала года', denLy: 'средняя активная численность HQ', tailY: 'с начала года' },
    { key: 'exit_reasons', block: 'turnover', name: 'Незаполненные причины увольнений', short: 'Без причины',
      fmt: 'pct', better: 'lower', num: 'nr', den: 'hc', cum: true,
      hint: 'Уволенные с начала года, у кого так и не указана причина увольнения, — от численности юнита.',
      frac: ['уволены с начала года без причины', 'численность на конец месяца'],
      notes: ['Считаем увольнения, после которых прошло 30 и больше дней: на причину есть месяц.', 'С начала года — значение копится до декабря.', 'Кто именно — в отчёте «Детальные списки».'],
      numL: 'увольнений без причины с начала года', denL: 'численность на конец месяца', cnt: { n: ['увольнение', 'увольнения', 'увольнений'], tail: 'с начала года' },
      exL: 'увольнений без причины сверх ориентира', exA: 'сверх ориентира' },
    { key: 'headcount', block: 'structure', name: 'Численность', short: 'Числ.',
      fmt: 'int', better: 'flat', num: 'hc',
      hint: 'Сколько людей в юните на конец месяца.',
      notes: ['Все типы численности. Только активная — фильтр «Тип численности».', 'С базой не сравниваем: это размер команды, а не оценка.'] },
    { key: 'jun_team', block: 'structure', name: '% джунов в команде', short: 'Джуны',
      fmt: 'pct', better: 'higher', share: true, num: 'jun', den: 'hc',
      hint: 'Доля джунов и стажёров в команде.',
      frac: ['джуны и стажёры', 'численность на конец месяца'],
      notes: ['Джуны — уровни Intern, Junior и Junior+.'],
      numL: 'джунов', denL: 'численность', cnt: { of: ['чел.', 'чел.', 'чел.'] }, exL: 'джунов не хватает до ориентира', exA: 'до ориентира не хватает' }
  ],
  catalog: {
    postponed: [
      { name: 'Неотгуленные отпуска', note: 'Появится, когда доработаем расчёт накопленных отпусков.' },
      { name: 'Прогульщики', note: 'Появится, когда подключим источник данных.' },
      { name: '% джунов в найме', note: 'Нужны данные по найму — подключим отдельно.' },
      { name: '% найма в регионах', note: 'Нужны данные по найму — подключим отдельно.' }
    ],
    dev: [
      { name: 'Эффективность работы с лоу-перформерами', note: 'Доля закрытых планов улучшения (PIP) с положительным результатом. Привязана к КП.' },
      { name: '% укомплектованности штата', note: 'Фактическая численность к плановой.' },
      { name: 'Вовлечённость', note: 'eNPS или индекс вовлечённости по опросам.' },
      { name: '% достижения people OKR', note: 'Достижение people-целей команды. Привязаны к КП.' }
    ],
    wanted: [
      { name: 'Покрытие преемниками', note: 'Доля ключевых ролей с готовым преемником.' },
      { name: 'Cost of hiring', note: 'Стоимость найма на одного сотрудника.' },
      { name: 'Проплаченность', note: 'Compa-ratio: факт ФОТ к рыночной вилке.' },
      { name: 'Охваты обучения менеджерскими программами', note: 'Доля релевантных руководителей в программах развития.' },
      { name: 'Наличие задач в ревью по eligible', note: 'Доля eligible-сотрудников с заведённой задачей в ревью.' }
    ]
  },
  deadZone: 0.05,
  // Маленькие команды (владелец, 06.10: «не смотреть закрепляемость и текучесть в командах
  // меньше чем 30 чел»): у юнита с численностью меньше min на последний закрытый месяц метрики
  // этих блоков не оцениваются — ни процента, ни цвета, ни графиков, ни фактов в «Что видно в данных».
  // Подсказка о популяции (владелец 12.10, пример Дарьи: у HRBP 70 % людей — HQ, а база — вся компания):
  // разрезы не выбраны, одно значение «популяционного» разреза — share и больше людей области → предложить
  // сравнить с ним. Тип численности и штат — не популяции: «Активная» и «Штат» почти везде большинство.
  pop: { share: 0.6, cuts: ['paint', 'it', 'stream', 'spec'] },
  // min — порог численности по умолчанию; у метрики свой minHc (HRBP 13.10: regrettable 50, non-regrettable 100).
  small: { min: 30, blocks: ['retention', 'turnover'] },
  // Норматив текучести — активная численность HQ (HRBP 13.10): кнопка на «Сводке» ставит оба разреза.
  hq: { hct: 'Активная', paint: 'HQ' },
  // «Что видно в данных» на «Сводке» (как Proteus Adoption, ДС §4.10) — факты по порогам, не шаблон:
  // dev — отклонение от ориентира (доля ориентира); minPeople — «сверх ориентира» у юнита в людях,
  // teamMin — у команды; conc — доля «лишних» людей в одной команде («больше половины — там»);
  // trend — месяцев ухудшения подряд; всплеск уходов — последний месяц против среднего за 11 до него
  // (не меньше spikeMin человек и в spikeX раза больше); hc — изменение численности с начала года; max — фактов.
  obs: { dev: 0.10, yoyPp: 3, minPeople: 0.5, teamMin: 1, conc: 0.5, trend: 3, spikeMin: 3, spikeX: 2, hc: 0.10, max: 8 },
  // Ответ на кросс-фильтр не пришёл за столько мс — жёлтая плашка «самовлияние?». В бою ответ на всю
  // компанию идёт дольше 9 с (07.10: плашка висела ~5 с при верных JSON-метаданных) — до плашки ждём
  // 45 с, а строка загрузки считает секунды и показывает прошлое время ответа.
  pendingWarnMs: 45000,
  // Лимит строк чарта в Proteus (инструкция, п. 4.2). Обёртка Superset 2.1 — GROUP BY … LIMIT N: обрезка режет
  // случайные строки (не хвост), поэтому data.length ≥ лимита — признак обрезки, даже если end на месте (09.10).
  rowLimit: 50000,
  // Уровни — номера mapped-структуры, как в ультраширокой: 1 — компания, дальше 3…12
  // (lvl2 отчёт пропускает). Подпись — по номеру, у юнитов одного уровня разные слова
  // в названиях («Департамент …», «Отдел …»), поэтому слово не выдумываем.
  levels: { 1: 'Компания' },
  tabs: [
    { key: 'onepager', label: 'Сводка' }, { key: 'teams', label: 'Команды' },
    { key: 'transform', label: 'Трансформеры' },
    // KPI (13.10): HRBP ставит, меняет и удаляет цели через форму n8n — чарт собирает ссылку с заполненными полями.
    { key: 'goals', label: 'KPI' },
    { key: 'catalog', label: 'Каталог метрик' }
  ],
  // Форма KPI в n8n (ИНСТРУКЦИЯ-KPI-ФОРМА.md; поставка — «7. KPI — форма n8n и переливка»). Песочница чарта не пускает
  // ни сеть, ни попапы: чарт только собирает prefill-ссылку, HRBP копирует её и открывает в новой вкладке. Ключи
  // prefill = ТОЧНЫЕ подписи полей формы; значения дропдаунов («Действие», «Метрика») — точные опции. Меняются
  // только вместе с build_kpi_flow.py. Разрезы — по полю на разрез, подпись = CFG.cuts[].label, 'all' — все.
  kpiForm: {
    // Ссылка для пользователя, не загрузка ресурса: чарт ничего с неё не тянет (схема отдельно — правило D1c скилла про CDN).
    url: 'https:' + '//n8n.t-tech.team/form/hrbp-kpi',
    op: 'Действие', id: 'ID цели', unit: 'ID юнита', unitNm: 'Юнит', metric: 'Метрика', target: 'Целевое значение',
    from: 'Действует с (ГГГГ-ММ-ДД)', to: 'Действует по (ГГГГ-ММ-ДД)', login: 'Ваш логин (например r.ivanov)', note: 'Комментарий',
    ops: { add: 'Добавить', update: 'Изменить', del: 'Удалить' },
    all: 'все',   // разрез не задан (форма пишет all)
    lag: 30   // минут: переливка DLH → ClickHouse
  },
  text: {
    noData: 'Нет данных',
    title: 'HRBP HUB',
    loading: 'Обновляю данные…',
    // Для владельца отчёта (настройка борда): технические имена — только в инструкции поставки, здесь — пункт.
    notApplied: 'Ответа нет уже {s} с. Если отчёт просто долго считает — ответ ещё придёт. Если так при каждом «Применить», сообщите владельцу отчёта: не настроены кросс-фильтры (инструкция, п. 4.5).',
    noAccess: 'Для вашего логина нет зоны HRBP в отчёте.',
    outOfZone: 'Запрошенный юнит вне вашей зоны — показана ваша зона.',
    // Обрезка (09.10): строк не меньше лимита чарта (rowLimit) или нет строки end — Proteus обрезал ответ.
    truncated: 'Часть отчёта не загрузилась: пришло {n} строк — это предел чарта. Сообщите владельцу отчёта: нужен «Лимит строк» 50 000 (инструкция, п. 4.2).'
  },
  // Токены: текст — как в Proteus Adoption, акцент #2b6cff — синий шапки отчёта. Холст bg = фон борда
  // Proteus (#f6f6f6, ДС §16.8): иначе чарт на борде — серый прямоугольник-заплатка.
  // Светофор подобран под акцент: у каждого сигнала фон пилюли, текст пилюли и
  // марка графика (столбик спарклайна, точка легенды) — один тон. Марка (green / red /
  // neutral) — посередине между фоном пилюли и насыщенным сигналом: насыщенные столбики
  // были самым ярким пятном «Сводки», тон фона пилюли — слишком бледным. Не ярче синей
  // линии. Жёлтого в светофоре нет.
  colors: {
    bg: '#f6f6f6', card: '#ffffff', line: '#e7e9ee', line2: '#eef0f3',
    ink: '#23272e', ink2: '#454b55', muted: '#6b7280', muted2: '#aab0bb',
    green: '#7fd2a5', greenBg: '#dbf5e6', greenTx: '#11804a',
    red: '#f59e9e', redBg: '#fde2e2', redTx: '#cb2e2e',
    neutral: '#d8dde4', neutralBg: '#eff1f5', neutralTx: '#5d6574',
    warn: '#f59300', warnBg: '#ffe6a0', warnTx: '#9a6500',
    blue: '#3b6fe0', blueBg: '#eef3fe', act: '#2b6cff', actInk: '#1f55d6',
    surface2: '#f3f4f6', hover: '#fafbfc',
    // Линии «период к периоду»: текущий — акцент, прошлый — светлый сине-серый,
    // база — серый пунктир, цель — тёмный пунктир; заливка под текущим — 8 % акцента.
    cur: '#2b6cff', curArea: 'rgba(43,108,255,.08)', prev: '#b4bdcc', bench: '#98a1b1', kpi: '#4b5262',
    label: '#2f3440', axis: '#6b7280', axisLine: '#9ba4b5', axisStrong: '#3a3f4a', grid: '#e9ecf1', xh: '#b9c6de',
    series: ['#5f86c2', '#97dece', '#ac87c5', '#cdbf97', '#85cdfd', '#9fae6a', '#c98aa6', '#686d76']
  },
  // Типографика — профиль виджетов Proteus Adoption (DESIGN_SYSTEM.md §16): один стек
  // на виджет и тултип, кегли только по ролям (новых «на глаз» не заводить), веса
  // 400 / 500 / 600. micro — ⓘ и вторые подписи шапки, cap — капитель шапок и вторые
  // строки ячеек, note — подписи, вкладки, пилюли, control — кнопки и выпадашки,
  // body — таблицы и текст, title — заголовок панели, hero — число KPI; в SVG — ось,
  // подписи значений (dense — плотная сетка), заголовок графика и легенда.
  fonts: {
    family: 'Inter,-apple-system,"Segoe UI",Roboto,Arial,sans-serif',
    micro: 9.5, cap: 10.5, note: 11.5, control: 12, body: 12.5, title: 14.5, hero: 24,
    axis: 10.5, val: 11, dense: 10, chart: 13, legend: 12
  },
  // Отступы — шкала 2…16 профиля; thH — высота строки шапки таблицы (под неё липнет «Итого»),
  // thG — строка групп метрик над ней («Все метрики» в «Командах»).
  spacing: { gutter: 16, gap: 12, thH: 30, thG: 22 },
  // Графики (Adoption, ДС 6.3): воздух над марками под подписи 26, ось X 30, отрисовка линии 760 мс.
  chart: { h: 236, hSmall: 176, story: 280, bars: 300, top: 26, axis: 30, drawMs: 760 },
  // «Команды»: доля таблицы в раскладке «таблица | динамика» (перетаскивается разделителем).
  // minH — нижний предел высоты двух колонок (таблица и «Динамика» прокручиваются внутри).
  split: { def: 0.6, min: 0.3, max: 0.8, minH: 420 },
  // Окно «Фильтры и настройки»: ширина и высота не больше w × h (меньше — по видимой части экрана);
  // от three — три колонки во всю высоту окна без прокрутки (владелец 07.10: «настройки должны
  // вмещаться в экран по высоте»), от two — две, уже — одна; разрез до inline значений (без
  // «не указано») — пилюли в строку; поиск метрик — от msearch.
  modal: { w: 1320, h: 820, two: 720, three: 900, inline: 3, msearch: 8 },
  // Видимая часть чарта на экране (iframe Proteus выше экрана): cover — сколько сверху закрывает
  // липкая шапка дашборда, когда верх ячейки уже уехал за край экрана.
  vis: { cover: 64 }
};

// ---------- БЛОК 2: ВХОД + СОСТОЯНИЕ + ХЕЛПЕРЫ ----------
// ВСЕ строки data, не data[0].
var rawData = (typeof data !== 'undefined' && Array.isArray(data)) ? data : [];

// Состояние переживает перерисовку Proteus.
// Для таблиц с поиском/сортировкой/пагинацией имена ключей бери из TABLES.md,
// чтобы правки разных сессий не расходились.
if (!window.__pvtState) window.__pvtState = {};
var __S = window.__pvtState;
var STATE0 = {
  tip: null,
  view: '',              // вкладка (data-view): '' = «Сводка»
  drawer: false,         // открыто окно «Фильтры и настройки» (по центру)
  open: '',              // раскрытый раздел окна: 'hrbp' | 'cut:<разрез>' | '' (юнит открыт всегда)
  qk: {},                // поиск в списках окна: 'unit' | 'hrbp' | 'cut:<разрез>' | 'metric' → строка
  stage: null,           // набранные, но не применённые фильтры: {unit: [...], cuts: {разрез: [...]}}
  stageV: null,          // набранный, но не применённый показ: {off: {метрика: true}, focus: bool}
  mdm: 2,                // колонок в окне фильтров: 3 | 2 | 1 (по ширине окна — placeDrawer)
  treeOpen: {},          // раскрытые узлы дерева в выборе юнита
  hOpen: {},             // раскрытые узлы дерева HRBP
  openM: {},             // раскрытые строки сводки: ключ метрики → true (можно несколько)
  metricOff: {},         // метрики, снятые с показа
  focusOnly: false,      // «Только фокусные»
  block: 'all',          // подвкладка «Команд»: 'all' — все метрики, иначе группа
  split: 0,              // доля таблицы «Команд», выставленная руками (0 — по числу метрик, splitAuto)
  splitW: 0,             // ширина сетки «таблица | динамика», px (fitSplit)
  splitMode: 'both',     // 'both' | 'table' (таблица во всю ширину) | 'charts' (динамика во всю ширину)
  cmp: 'prev',           // вторая линия графиков: prev — прошлый год, ref — ориентир (цель или база), HRBP 13.10
  ytd: true,             // текучесть в «Динамике» — с начала года (false — скользящие 12 мес)
  popOff: '',            // подпись области, для которой подсказку о популяции скрыли («Скрыть»)
  drawn: {},             // графики, уже нарисованные с анимацией: ключ → подпись данных
  hz: '',                // HRBP, чья зона выбрана (логин): выбор юнита сужается до неё
  unitAll: false,        // выбор юнита при выбранном HRBP: показать всю зону видимости
  selTeam: '',           // выбранная строка «Команд» ('' — ИТОГО)
  scrollSel: false,      // после перерисовки прокрутить к выбранной строке «Команд» (команда из «Что видно в данных»)
  paneSig: '',           // данные и вкладка последней перерисовки: прокрутку панелей «Команд» храним, пока они те же
  obsOpen: false,        // «Что видно в данных»: список фактов раскрыт вниз
  tq: '',                // поиск по таблице «Команд» (по загруженным уровням)
  tsort: { key: '', dir: '' }, // сортировка таблицы «Команд»: '' — по численности, 'name' или ключ метрики
  unitBack: [],          // «← Назад»: юниты отчёта до переходов (стек, до 10)
  openRows: {},          // раскрытые узлы «Команд»: ключ — путь узла от −1 через '/'
  tfMetric: 'regret', tfAxis: '',
  trPick: '',            // «Трансформеры»: выбранное значение разбивки (линия на графике, доля на кольце)
  trPie: 'hc',           // кольцо «Трансформеров»: доли в людях (hc) или в числителе метрики (num)
  dsel: '',              // открытый выпадающий список (hSel)
  axisTried: {},         // оси трансформеров, которые уже запрашивались
  kd: null,              // черновик формы KPI (вкладка «KPI»): add | update | del
  kdOpen: false,         // форма KPI открыта над списком
  copied: '',
  dynH: 0,               // высота графиков «Динамики» «Команд» по панели (fitDyn, БЛОК 6)
  cw: {},                // измеренные ширины графиков по видам: half | side | wide
  narrow: false,         // ячейка уже 1100 px
  pend: null,            // {sig, at} — эмит ушёл, ждём ответ с тем же эхом
  pendT: null, lastSig: '',
  vis: null,             // видимая на экране часть окна iframe {t, b} (линейка IntersectionObserver, БЛОК 6)
  vpH: 0,                // сколько экрана досталось чарту — наибольшая видимая высота (высота «Команд»)
  warn: '',              // предупреждение (не применился фильтр и т. п.)
  tour: null             // идущий тур «Как работать»: {view, i, dir, shown, key, was, busy}
};
if (!__S[CFG.ns]) __S[CFG.ns] = {};
// Ключи, которых нет в состоянии прошлой версии скрипта (страницу не перезагружали), — по умолчанию.
for (var k0 in STATE0) if (STATE0.hasOwnProperty(k0) && !__S[CFG.ns].hasOwnProperty(k0)) __S[CFG.ns][k0] = STATE0[k0];
var state = __S[CFG.ns];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
// Числа из BI приходят и числом, и строкой с пробелами-разрядами или запятой.
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = String(v).replace(/[\s ]/g, '');
  // '1,5' -> дробная запятая; '1,234.5' -> запятая это разряды.
  if (s.indexOf(',') > -1 && s.indexOf('.') === -1) s = s.replace(/,/g, '.');
  else s = s.replace(/,/g, '');
  var n = Number(s);
  return isNaN(n) ? null : n;
}
// Универсальный парсер даты: epoch-ms, epoch-s, 'YYYY-MM-DD', 'YYYY-MM'.
// Нужен всегда: DATETIME из Proteus приходит числом, а не строкой из UI.
function toDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  var s = String(raw).trim(), d = null;
  if (/^\d{11,}$/.test(s)) { var ms = Number(s); d = new Date(ms > 1e12 ? ms : ms * 1000); }
  else if (/^\d{10}$/.test(s)) d = new Date(Number(s) * 1000);
  else {
    var m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s);
    if (m) return { y: +m[1], m: +m[2] - 1, d: m[3] ? +m[3] : 1 };
    d = new Date(s);
  }
  if (!d || isNaN(d.getTime())) return null;
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

// Массив слотов приходит строкой «1,2,3»: так он переживает любую сериализацию
// Proteus (массивы строк у него приезжают в Python-виде). Пусто — ряда нет.
// Массив слотов: датасет не везёт нули по краям — «0» — все нули, «12@5,0,7» — слоты 0…11 нули,
// дальше 5, 0, 7; хвост — нули до 24 слотов (месяцы и недели календаря). Полный массив без «@»
// (датасет до 07.10) читается так же. Пустая строка — массива нет (null).
var SLOTS = 24;
function parseArr(s) {
  if (s === null || s === undefined || s === '') return null;
  if (Object.prototype.toString.call(s) === '[object Array]') return s;
  var str = String(s), out = [], at = str.indexOf('@');
  if (at > 0) {
    var off = parseInt(str.slice(0, at), 10) || 0;
    for (var z = 0; z < off; z++) out.push(0);
    out.from = off;  // трансформер: слоты до off не приехали (не нули) — текучесть с начала года их не берёт
    str = str.slice(at + 1);
  }
  var parts = str.split(',');
  for (var i = 0; i < parts.length; i++) { var v = num(parts[i]); out.push(v === null ? 0 : v); }
  while (out.length < SLOTS) out.push(0);
  return out;
}
// Пакет строк: записи через \n, поля через \t.
function splitRecords(s) {
  var out = [];
  if (!s) return out;
  var lines = String(s).split('\n');
  for (var i = 0; i < lines.length; i++) if (lines[i] !== '') out.push(lines[i].split('\t'));
  return out;
}

// ---------- БЛОК 3: ТРАНСФОРМАЦИЯ ДАННЫХ ----------
// rawData → MODEL. SQL отдаёт числители и знаменатели по слотам; проценты, окна
// в знаменателе, дельты, наследование целей и светофор считаются здесь.
var COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire', 'rgs', 'nrgs'];
// Необязательные колонки: датасет до 12.10 их не везёт — тогда «с начала года» в «Динамике» нет.
var COMP_OPT = { rgs: 1, nrgs: 1 };
// Разрезы распределения численности в справочнике — в порядке CUT_COLS датасета (в нём записан код
// сочетания); FDC — кэш чисел окна фильтров по набранному выбору (fdCalc). Объявлены до buildModel.
var FD_KEYS = ['paint', 'it', 'stream', 'spec', 'staff', 'hct'];
// Тип численности строк вне юридической численности (hh_param.nonlegal_type): без выбранного типа их нет (HRBP 13.10).
var NONLEGAL = 'Вне юр. численности';
var FDC = { m: null, key: '', val: null };
var METRIC = {};
for (var mi0 = 0; mi0 < CFG.metrics.length; mi0++) METRIC[CFG.metrics[mi0].key] = CFG.metrics[mi0];
var CUT = {};
for (var ci0 = 0; ci0 < CFG.cuts.length; ci0++) CUT[CFG.cuts[ci0].key] = CFG.cuts[ci0];

function serOf(r) {
  var s = { m: {}, w: {} };
  for (var i = 0; i < COMP.length; i++) {
    var c = COMP[i];
    s.m[c] = parseArr(r[CFG.fields.m[c]]);
    s.w[c] = parseArr(r[CFG.fields.w[c]]);
  }
  return s;
}

function buildModel() {
  var F = CFG.fields;
  var M = { ok: false, missing: [], meta: null, cal: { m: [], w: [] }, L: -1, dataDt: '',
            units: {}, kids: {}, hrbps: [], base: null, scope: null, c: [], g: {}, x: {}, facets: {},
            trBy: {}, trAll: false, rules: [], role: 'none', scopeIds: [], roots: [], single: false,
            sel: {}, axis: '', reqUnit: [], scopeRk: '', complete: false, cut: false, rows: rawData.length,
            depth: '3', depthReq: '3', scopeN: 0, allMax: 0, hKids: {}, hTop: [], hBy: {} };
  if (!rawData.length) return M;
  var need = [F.role, F.id, F.pid, F.n, F.j];
  for (var ci = 0; ci < COMP.length; ci++) if (!COMP_OPT[COMP[ci]]) { need.push(F.m[COMP[ci]]); need.push(F.w[COMP[ci]]); }
  M.ytdOk = (F.m.rgs in rawData[0]) && (F.m.nrgs in rawData[0]);
  for (var ni = 0; ni < need.length; ni++) if (!(need[ni] in rawData[0])) M.missing.push(need[ni]);
  if (M.missing.length) return M;
  for (var i = 0; i < rawData.length; i++) {
    var r = rawData[i], role = String(r[F.role] || ''), id = String(r[F.id] == null ? '' : r[F.id]);
    var pid = String(r[F.pid] == null ? '' : r[F.pid]);
    if (role === 'meta') {
      try { M.meta = JSON.parse(r[F.j]); } catch (e) { M.meta = null; }
    } else if (role === 'dict') {
      var recs = splitRecords(r[F.j]);
      for (var k = 0; k < recs.length; k++) {
        var f = recs[k];
        // rk (6-е поле) датасет оставляет пустым: выбранному юниту он приезжает в meta.rk
        // 9-е поле — распределение численности по разрезам (люди прямо в юните): разбор — fdParse;
        // 10-е — логин руководителя юнита (13.10: под именем в дереве и в поиске; старый датасет — без него)
        var u = { id: f[0], pid: f[1] || '', lvl: num(f[2]) || 0, hc: num(f[3]) || 0, cur: f[4] === '1', rk: f[5] || '', nm: f[6] || '—',
                  nk: f.length > 7 ? (num(f[7]) || 0) : -1, fds: f.length > 8 ? f[8] : '', head: f.length > 9 ? f[9] : '' };
        if (f.length > 8) M.fdLines = true;
        u.lc = u.nm.toLowerCase();
        u.lh = u.head.toLowerCase();
        M.units[u.id] = u;
      }
    } else if (role === 'hrbps') {
      var hr = splitRecords(r[F.j]);
      for (var h = 0; h < hr.length; h++) {
        // пути корней (5-е поле): у каждого корня — путь от компании, по ним дерево «кто под кем»
        var hp = hr[h][4] ? String(hr[h][4]).split(',') : [], anc = [];
        for (var hq = 0; hq < hp.length; hq++) if (hp[hq]) anc.push(hp[hq].split('/'));
        M.hrbps.push({ login: hr[h][0], nm: hr[h][1] || hr[h][0], roots: (hr[h][2] || '').split(',').sort(), hc: num(hr[h][3]) || 0, anc: anc });
      }
    } else if (role === 'base') M.base = serOf(r);
    else if (role === 'scope') M.scope = serOf(r);
    else if (role === 'c') M.c.push({ id: id, ser: serOf(r) });
    else if (role === 'g') { if (!M.g[pid]) M.g[pid] = []; M.g[pid].push({ id: id, pid: pid, ser: serOf(r) }); }
    else if (role === 'x') { if (!M.x[pid]) M.x[pid] = []; M.x[pid].push({ id: id, pid: pid, ser: serOf(r) }); }
    else if (role === 'f') { if (!M.facets[pid]) M.facets[pid] = []; M.facets[pid].push({ v: id, n: num(r[F.n]) || 0 }); }
    else if (role === 'tr') { if (!M.trBy[pid]) M.trBy[pid] = []; M.trBy[pid].push({ v: id, n: num(r[F.n]) || 1, ser: serOf(r) }); }
    else if (role === 'end') M.complete = true;
    else if (role === 'kpi') {
      var kf = String(r[F.j] || '').split('\t');
      // metric_id формы — ключ метрики; старые коды компонентов и подписи метрик тоже понимаем (kpiMetricKey).
      // Комментарий — последним полем: табуляция в нём склеивается обратно.
      M.rules.push({ id: id, unit: pid, metric: kpiMetricKey(kf[0]), target: num(kf[1]),
        f: { paint: kpiCut(kf[2]), it: kpiCut(kf[3]), stream: kpiCut(kf[4]), spec: kpiCut(kf[5]), staff: kpiCut(kf[6]), hct: kpiCut(kf[7]) },
        from: kf[8] || '2000-01-01', to: kpiOpenTo(kf[9]) ? '' : kf[9], open: kpiOpenTo(kf[9]), author: kf[10] || '', note: kf.slice(11).join(' ') });
    }
  }
  // Обрезка: строк не меньше лимита чарта или (датасет с маркером end) строки end нет. Под GROUP BY обёртки
  // порядок не держится — пропасть может любая строка, в том числе meta (09.10).
  M.cut = rawData.length >= CFG.rowLimit || (!!M.meta && num(M.meta.end) === 1 && !M.complete);
  if (!M.meta) return M;
  // Колонки есть, но в таблицах ClickHouse их ещё нет (ноут не перезапущен) — датасет шлёт пустые и meta.ytd = 0:
  // текучесть тогда за скользящие 12 мес, а не «с начала года» из нулей.
  if (M.meta.ytd === 0) M.ytdOk = false;
  // Знаменатель текучести — активная HQ (13.10): есть в таблицах, если ноут выгрузил колонку hirea.
  M.hqOk = M.meta.hq === 1;
  var meta = M.meta;
  M.role = meta.role || 'none';
  M.scopeIds = (meta.scope || []).slice().sort();
  M.roots = (meta.roots || []).slice().sort();
  M.single = M.scopeIds.length === 1;
  M.axis = meta.axis || '';
  // Трансформеры: все 17 осей приезжают с каждым ответом (tr_all = 1). Запасной режим
  // датасета (TR_ALL_MAX): у большой ветки с разрезами — только атрибут, запрошенный по tr_f.
  M.trAll = num(meta.tr_all) === 1;
  M.reqUnit = meta.req_unit || [];
  M.depth = meta.depth === 'all' ? 'all' : '3';
  M.depthReq = meta.depth_req === 'all' ? 'all' : '3';
  M.scopeN = num(meta.scope_n) || 0;
  M.allMax = num(meta.all_max) || 0;
  M.scopeRk = meta.rk || '';
  for (var cc = 0; cc < CFG.cuts.length; cc++) M.sel[CFG.cuts[cc].key] = (meta['f_' + CFG.cuts[cc].key] || []).slice();
  // Числа окна фильтров — без запроса (fdCalc): словари значений разрезов — meta.fdv, распределение —
  // 9-е поле справочника. Нет их (датасет до 07.10) — числа из фасетов ответа (строки f), как раньше.
  M.fdv = fdvOk(meta.fdv) ? meta.fdv : null;
  M.fdOk = !!M.fdv && !!M.fdLines;
  var cal = meta.cal || [];
  for (var q = 0; q < cal.length; q++) {
    var p = String(cal[q]).split('|');
    var slot = { s: p[2], e: p[3], closed: p[4] === '1' };
    M.cal[p[0]][+p[1]] = slot;
    M.dataDt = p[5] || M.dataDt;
  }
  M.L = typeof meta.last_m === 'number' ? meta.last_m : -1;
  // «Действует по» не заполнено — цель действует по последний период датасета (конец последнего закрытого
  // месяца): с новым месяцем данных срок сдвигается сам (13.10).
  var lastDay = M.cal.m[M.L] ? M.cal.m[M.L].e : (M.dataDt || '2099-12-31');
  for (var rq = 0; rq < M.rules.length; rq++) if (M.rules[rq].open) M.rules[rq].to = lastDay;
  for (var pk in M.units) {
    if (!M.units.hasOwnProperty(pk)) continue;
    var pu = M.units[pk].pid;
    if (!M.kids[pu]) M.kids[pu] = [];
    M.kids[pu].push(pk);
  }
  for (var kk in M.kids) if (M.kids.hasOwnProperty(kk)) M.kids[kk].sort(function (a, b) { return unitName(M, a) < unitName(M, b) ? -1 : 1; });
  hrbpTree(M);
  M.ok = true;
  return M;
}
// Дерево HRBP «кто под кем»: зона B целиком внутри зоны A (каждый корень B лежит под
// каким-то корнем A) и не совпадает с ней → B ниже A. Родитель — самая узкая такая A
// (меньше численность). Совпадающие зоны (два HRBP на одной ветке) — соседи.
function hrbpTree(M) {
  var hs = M.hrbps, i, j;
  function covers(A, B) {
    if (!B.anc.length) return false;
    for (var r = 0; r < B.anc.length; r++) {
      var hit = false;
      for (var q = 0; q < B.anc[r].length && !hit; q++) if (A.roots.indexOf(B.anc[r][q]) > -1) hit = true;
      if (!hit) return false;
    }
    return true;
  }
  M.hKids = {};
  M.hTop = [];
  M.hBy = {};
  for (i = 0; i < hs.length; i++) M.hBy[hs[i].login] = hs[i];
  for (i = 0; i < hs.length; i++) {
    var best = null;
    for (j = 0; j < hs.length; j++) {
      if (i === j || !covers(hs[j], hs[i]) || covers(hs[i], hs[j])) continue;
      if (!best || hs[j].hc < best.hc || (hs[j].hc === best.hc && hs[j].nm < best.nm)) best = hs[j];
    }
    hs[i].parent = best ? best.login : '';
    if (best) (M.hKids[best.login] = M.hKids[best.login] || []).push(hs[i].login);
    else M.hTop.push(hs[i].login);
  }
  var byNm = function (a, b) { return M.hBy[a].nm < M.hBy[b].nm ? -1 : (M.hBy[a].nm > M.hBy[b].nm ? 1 : 0); };
  M.hTop.sort(byNm);
  for (var k in M.hKids) if (M.hKids.hasOwnProperty(k)) M.hKids[k].sort(byNm);
}
function unitName(M, id) {
  var u = M.units[id];
  return u ? u.nm : (id === '·' ? '—' : id);
}
var MODEL = buildModel();

// ---- юниты и путь ----
function pathTo(id) {
  var out = [], guard = 0, cur = id;
  while (cur && MODEL.units[cur] && guard++ < 30) { out.unshift(cur); cur = MODEL.units[cur].pid; }
  return out;
}
function levelLabel(lvl) { return CFG.levels[lvl] || (lvl ? 'Уровень ' + lvl : '—'); }
function levelShort(lvl) { return CFG.levels[lvl] || (lvl ? 'ур. ' + lvl : ''); }
function sameSet(a, b) {
  if (a.length !== b.length) return false;
  var x = a.slice().sort(), y = b.slice().sort();
  for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
function zoneOwner(ids) {
  for (var i = 0; i < MODEL.hrbps.length; i++) if (sameSet(MODEL.hrbps[i].roots, ids)) return MODEL.hrbps[i];
  return null;
}
function scopeLabel() {
  var ids = MODEL.scopeIds;
  if (ids.length === 1) return unitName(MODEL, ids[0]);
  var z = zoneOwner(ids);
  if (sameSet(ids, MODEL.roots)) return z && MODEL.role === 'hrbp' ? 'Моя зона' : 'Моя зона';
  return z ? 'Зона ' + z.nm : ids.length + ' юнита';
}
// Общий предок набора юнитов: с него наследуются цели объединённой зоны.
function commonAncestor(ids) {
  if (!ids.length) return '';
  var base = pathTo(ids[0]);
  for (var i = 1; i < ids.length; i++) {
    var p = pathTo(ids[i]), k = 0;
    while (k < base.length && k < p.length && base[k] === p[k]) k++;
    base = base.slice(0, k);
  }
  return base.length ? base[base.length - 1] : '';
}

// ---- календарь ----
function slotClosed(g, i) { var s = MODEL.cal[g][i]; return !!(s && s.closed); }

// ---- значения метрик ----
function parts(ser, g, m, i) {
  if (!ser || !ser[g]) return null;
  var a = ser[g];
  var nm = a[m.num] ? a[m.num][i] : null;
  if (nm === null || nm === undefined) return null;
  var dn = m.den ? (a[m.den] ? a[m.den][i] : null) : null;
  return { num: nm, den: dn };
}
function mval(ser, g, m, i) {
  if (i < 0 || i > 23 || !slotClosed(g, i)) return null;
  if (g === 'm' && m.ytd && ytdOn(m)) return ytdVal(ser, m, i);
  var p = parts(ser, g, m, i);
  if (!p) return null;
  if (m.fmt === 'int') return p.num;
  if (!p.den) return null;
  var den = m.denDiv ? p.den / m.denDiv[g] : p.den;
  return 100 * p.num / den;
}
// Текучесть нарастающим итогом с начала года (владелец 12.10): Σ увольнений без окна с января по месяц i /
// средняя численность за те же месяцы, без пересчёта в годовой темп — к декабрю это годовая текучесть.
// Переключателя «С начала года / 12 мес» нет (HRBP 13.10, Дьяченко: «12 мес выводит странную историю»): без колонок
// rgs / nrgs (ноут не перезапущен) — скользящие 12 мес как запасной вариант.
function ytdOn(m) { return !!(m && m.ytd && MODEL.ytdOk); }
// Значение копится в течение года — текучесть с начала года (ytd) и незаполненные причины (cum: датасет уже
// везёт сумму с января, HRBP 13.10): сравнение с прошлым месяцем и «рост подряд» для них не показательны.
function isCum(m) { return !!m && (!!(m.ytd && ytdOn(m)) || !!m.cum); }
// Знаменатель текучести — активная численность HQ (HRBP 13.10): с колонкой hirea в таблицах (meta.hq) hcw месяца —
// численность активной HQ на конец месяца; до перезапуска ноута — вся численность, как раньше.
function hqDen(ser) { return MODEL.hqOk ? ser.m.hcw : ser.m.hc; }
// HRBP 13.10: «считаем накопительным итогом в рамках года, т. е. суммируем помесячные значения» — Σ по месяцам
// с января: увольнения месяца / средняя численность месяца (на начало и конец). Действует ВЕЗДЕ (mval): «Сводка»,
// «Команды», «Трансформеры», «Динамика».
function ytdParts(ser, m, i) {
  if (!ser || !ser.m || i < 0 || i > 23 || !slotClosed('m', i)) return null;
  var a = ser.m[m.ytd], h = hqDen(ser), y0 = i < 12 ? 0 : 12, r = 0, num = 0, hs = 0, n = 0;
  if (!a || !h) return null;
  if (Math.max(a.from || 0, h.from || 0) > Math.max(y0 - 1, 0)) return null;  // январь (и декабрь до него) не приехал
  for (var j = y0; j <= i; j++) {
    var hm = ((j > 0 ? h[j - 1] : h[j]) + h[j]) / 2;
    num += a[j] || 0;
    if (hm > 0) { r += (a[j] || 0) / hm; hs += hm; n++; }
  }
  return n ? { v: 100 * r, num: num, avg: hs / n } : null;
}
function ytdVal(ser, m, i) { var q = ytdParts(ser, m, i); return q ? q.v : null; }
function comparable(m) { return m.fmt !== 'int' && m.better !== 'flat'; }
function targetable(m) { return m.better !== 'flat' && m.fmt !== 'int'; }

// ---- цели KPI: наследование вниз по дереву, разрезы — точным совпадением ----
function ruleMatches(r) {
  for (var i = 0; i < CFG.cuts.length; i++) {
    var k = CFG.cuts[i].key, want = r.f[k];
    if (want === 'all') continue;
    var sel = MODEL.sel[k] || [];
    if (sel.length !== 1 || sel[0] !== want) return false;
  }
  return true;
}
function ruleSpec(r) {
  var n = 0;
  for (var i = 0; i < CFG.cuts.length; i++) if (r.f[CFG.cuts[i].key] !== 'all') n++;
  return n;
}
function ruleActive(r, day) { return (!day) || (r.from <= day && day <= r.to); }
// → {rule, owner, inherited} | null. unitId '' → цели нет.
function resolveKpi(unitId, mk, day) {
  var m = METRIC[mk];
  if (!unitId || !m || !targetable(m)) return null;
  var chain = pathTo(unitId);
  for (var i = chain.length - 1; i >= 0; i--) {
    var best = null;
    for (var j = 0; j < MODEL.rules.length; j++) {
      var r = MODEL.rules[j];
      if (r.unit !== chain[i] || r.metric !== mk || r.target === null || !ruleMatches(r) || !ruleActive(r, day)) continue;
      if (!best || ruleSpec(r) > ruleSpec(best) || (ruleSpec(r) === ruleSpec(best) && (r.from > best.from || (r.from === best.from && r.id > best.id)))) best = r;
    }
    if (best) return { rule: best, owner: chain[i], inherited: chain[i] !== unitId };
  }
  return null;
}
// Юнит, от которого наследуются цели области: сам юнит или общий предок зоны.
function scopeUnit() { return MODEL.single ? MODEL.scopeIds[0] : commonAncestor(MODEL.scopeIds); }
function targetSeries(unitId, mk, g) {
  var out = [];
  for (var i = 0; i < 24; i++) {
    var s = MODEL.cal[g][i];
    var k = s ? resolveKpi(unitId, mk, s.e) : null;
    out.push(k ? k.rule.target : null);
  }
  return out;
}
// Цели юнита, закрытые текущими разрезами: чтобы сказать, КАКИЕ разрезы выбрать.
function hiddenRules(unitId, mk) {
  var out = [];
  for (var j = 0; j < MODEL.rules.length; j++) {
    var r = MODEL.rules[j];
    if (r.unit === unitId && (!mk || r.metric === mk) && !ruleMatches(r)) out.push(r);
  }
  return out;
}
function ownRules(unitId, mk) {
  var out = [];
  for (var j = 0; j < MODEL.rules.length; j++) {
    var r = MODEL.rules[j];
    if (r.unit === unitId && (!mk || r.metric === mk)) out.push(r);
  }
  return out;
}

// ---- оценка: мёртвая зона ±5%, два сигнала ----
// Маленький юнит (HRBP 13.10: «ограничений по численности для показа нет, меньше порога — без цвета»): пока
// рисуется его метрика, NOCOL = true — оценки нейтральные, пилюли и точки серые, значения и графики на месте.
var NOCOL = false;
function stateForKpi(m, v, t) {
  if (NOCOL) return 'neutral';
  if (v === null || t === null || m.better === 'flat') return 'neutral';
  if (m.better === 'higher') return v >= t ? 'good' : (v >= t * (1 - CFG.deadZone) ? 'warn' : 'bad');
  return v <= t ? 'good' : (v <= t * (1 + CFG.deadZone) ? 'warn' : 'bad');
}
function compareState(m, v, b) {
  if (NOCOL) return 'neutral';
  if (v === null || b === null || m.better === 'flat') return 'neutral';
  var d = v - b;
  if (Math.abs(d) <= Math.abs(b) * CFG.deadZone) return 'neutral';
  var better = (m.better === 'higher' && d > 0) || (m.better === 'lower' && d < 0);
  return better ? 'good' : 'bad';
}
// Ориентир: цель, если есть; иначе база (вся компания под теми же разрезами).
function baseline(unitId, m, v, g, i) {
  var day = MODEL.cal[g][i] ? MODEL.cal[g][i].e : '';
  var k = resolveKpi(unitId, m.key, day);
  // Текучесть с начала года сравнивается с долей годовой цели: к марту — 3/12 (HRBP 13.10).
  if (k) { var tg = g === 'm' && m.ytd && ytdOn(m) ? k.rule.target * ((i % 12) + 1) / 12 : k.rule.target;
           return { kind: 'kpi', ref: tg, rule: k.rule, owner: k.owner, inherited: k.inherited, state: stateForKpi(m, v, tg) }; }
  if (comparable(m)) {
    var b = mval(MODEL.base, g, m, i);
    if (b !== null) return { kind: 'bench', ref: b, state: compareState(m, v, b) };
  }
  return { kind: 'none', ref: null, state: 'neutral' };
}
function statesOver(unitId, ser, g, m, idxs) {
  var out = [];
  for (var q = 0; q < idxs.length; q++) {
    var i = idxs[q], v = mval(ser, g, m, i);
    out.push(v === null ? 'neutral' : baseline(unitId, m, v, g, i).state);
  }
  return out;
}
// ---- маленькие команды и числа людей ----
// Команда меньше CFG.small.min человек на последний закрытый месяц: закрепляемость и текучесть
// по ней не оцениваются — на такой команде один человек сдвигает процент на несколько пунктов.
function smallGate(m) { return CFG.small.blocks.indexOf(m.block) > -1; }
function isSmall(ser) { return hcOf(ser) < CFG.small.min; }
function smallMin(m) { return m && m.minHc ? m.minHc : CFG.small.min; }
// Порог — по численности, от которой метрика считается: у текучести — активная HQ (её знаменатель, 13.10), иначе — вся.
function popOf(ser, m) { var L = MODEL.L; return m && m.hq && MODEL.hqOk && ser && ser.m && ser.m.hcw ? (ser.m.hcw[L] || 0) : hcOf(ser); }
function smallHide(ser, m) { return smallGate(m) && popOf(ser, m) < smallMin(m); }
// Числитель и знаменатель метрики в людях (знаменатель-окно → средняя численность).
function absParts(m, ser, i) {
  if (m.fmt === 'int') return null;
  if (m.ytd && ytdOn(m)) {  // с начала года: уходы с января, знаменатель — тот, что даёт значение метрики
    var q = ytdParts(ser, m, i);
    return q ? { num: q.num, den: q.v > 0 ? 100 * q.num / q.v : q.avg } : null;
  }
  var p = parts(ser, 'm', m, i);
  if (!p || p.den === null || p.den === undefined) return null;
  return { num: p.num, den: m.denDiv ? p.den / m.denDiv.m : p.den };
}
function absRows(m, ser, i) {
  var a = absParts(m, ser, i);
  if (!a || !m.numL) return [];
  var y = m.ytd && ytdOn(m);
  return [{ label: y ? m.numLy : m.numL, value: fmtInt(a.num) }, { label: y ? m.denLy : m.denL, value: fmtInt(a.den) }];
}
// Коротко под значением: «16 из 17 новичков», «9 уходов за год».
function absText(m, ser, i) {
  var a = absParts(m, ser, i), c = m.cnt;
  if (!a || !c) return '';
  if (c.of) { var d = Math.round(a.den); return fmtInt(a.num) + ' из ' + fmtInt(d) + ' ' + plural(d, c.of[0], c.of[1], c.of[2]); }
  var tail = m.ytd && ytdOn(m) ? m.tailY : c.tail;
  return fmtInt(a.num) + ' ' + plural(a.num, c.n[0], c.n[1], c.n[2]) + (tail ? ' ' + tail : '');
}
// Сколько людей «сверх ориентира» (уходов, ушедших новичков, увольнений без причины):
// > 0 — хуже ориентира; у метрик без направления — 0.
function excessPeople(m, ser, i, ref) {
  var a = absParts(m, ser, i);
  if (!a || !a.den || ref === null || ref === undefined || m.better === 'flat') return 0;
  var v = 100 * a.num / a.den;
  return (m.better === 'higher' ? ref - v : v - ref) / 100 * a.den;
}
// «≈ 0,9» / «≈ 12»: дробь — пока меньше 10 человек.
function benchLabel() {
  var parts0 = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var s = MODEL.sel[CFG.cuts[i].key] || [];
    if (s.length) parts0.push(s.length > 2 ? CFG.cuts[i].label.toLowerCase() + ': ' + s.length : s.join(', '));
  }
  return parts0.length ? 'вся компания · ' + parts0.join(' + ') : 'вся компания';
}
// Разрезы не выбраны: база — просто вся компания (без «под теми же разрезами: вся компания»).
function benchSelfAll() { for (var i = 0; i < CFG.cuts.length; i++) if ((MODEL.sel[CFG.cuts[i].key] || []).length) return false; return true; }
function selMetrics(block) {
  var out = [];
  for (var i = 0; i < CFG.metrics.length; i++) {
    var m = CFG.metrics[i];
    if (state.metricOff[m.key]) continue;
    if (block && m.block !== block) continue;
    out.push(m);
  }
  return out;
}

// ---- кросс-фильтр: маска целиком и её подпись (чистые функции) ----
// Маска задаётся ЦЕЛИКОМ каждым вызовом: юнит, разрезы, ось трансформеров.
// Носитель с value = [] не шлём никогда (ронял запрос); пустая маска —
// applyCrossFilter([]) — полный сброс. Что применилось, говорит эхо в meta.
// Применённое сейчас: что вернул датасет (unit — пусто, если это вся зона).
function reqNow() {
  var cuts = {};
  for (var i = 0; i < CFG.cuts.length; i++) cuts[CFG.cuts[i].key] = (MODEL.sel[CFG.cuts[i].key] || []).slice();
  // Глубина «Команд» — всегда 3 уровня (depth_f не шлётся): глубже — «Открыть юнит».
  return { unit: sameSet(MODEL.scopeIds, MODEL.roots) ? [] : MODEL.scopeIds.slice(), cuts: cuts, axis: MODEL.axis || '',
           depth: '3' };
}
// Эхо запроса: что датасет получил (req_unit — как пришло, до проверки доступа).
function reqEcho() {
  var r = reqNow(), u = [];
  for (var i = 0; i < MODEL.reqUnit.length; i++) if (MODEL.reqUnit[i]) u.push(MODEL.reqUnit[i]);
  r.unit = u;
  return r;
}
function sigOf(o) {
  var s = 'u:' + (o.unit || []).slice().sort().join(',');
  for (var i = 0; i < CFG.cuts.length; i++) s += '|' + CFG.cuts[i].key + ':' + ((o.cuts && o.cuts[CFG.cuts[i].key]) || []).slice().sort().join('\u0001');
  return s + '|a:' + (o.axis || '') + '|d:' + (o.depth === 'all' ? 'all' : '3');
}
// Панель «Фильтры и настройки» копит выбор (юнит, HRBP, разрезы) и отправляет его одной кнопкой
// «Применить»: staged() — применённое плюс набранное, stageDiff() — сколько фильтров изменено.
// hz — HRBP, чья зона выбрана: в датасет не уходит (там только юниты), но сужает выбор
// юнита до его зоны. Юнит и HRBP — один фильтр «чья зона и что в ней»: одно изменение.
function staged() {
  var a = reqNow();
  a.hz = hzNow();
  if (!state.stage) return a;
  a.unit = state.stage.unit.slice();
  a.hz = state.stage.hz || '';
  for (var k in state.stage.cuts) if (state.stage.cuts.hasOwnProperty(k)) a.cuts[k] = state.stage.cuts[k].slice();
  return a;
}
function stageDiff() {
  if (!state.stage) return 0;
  var a = reqNow(), b = staged(), n = sameSet(a.unit, b.unit) && hzNow() === b.hz ? 0 : 1;
  for (var i = 0; i < CFG.cuts.length; i++) if (!sameSet(a.cuts[CFG.cuts[i].key] || [], b.cuts[CFG.cuts[i].key] || [])) n++;
  return n;
}
function stageEdit(fn) {
  if (!state.stage) { var a = reqNow(); state.stage = { unit: a.unit, cuts: a.cuts, hz: hzNow() }; }
  fn(state.stage);
  if (!stageDiff()) state.stage = null;
}
// ---- числа окна фильтров по набранному выбору, без запроса (владелец 07.10: «цифры должны
// пересчитываться сразу, а не после „Применить“») ----
// Датасет кладёт в справочник распределение численности последнего закрытого месяца по 6 разрезам
// среди людей прямо в юните: пары «код:n», код — номера значений в словарях meta.fdv смешанной
// системой счисления (порядок разрезов — FD_KEYS, как CUT_COLS датасета).
function fdvOk(v) {
  if (!v || typeof v !== 'object') return false;
  for (var i = 0; i < FD_KEYS.length; i++) if (!v[FD_KEYS[i]] || !v[FD_KEYS[i]].length) return false;
  return true;
}
// Разбор — при первом обращении (на супер-HRBP это десятки тысяч пар): у юнита fd — плоский массив
// [номер значения × 6, численность]; fdIdx — значение → номер; fdZone / fdZoneN — какие значения
// встречаются в зоне и сколько в них людей (порядок и состав пилюль не прыгают при наборе).
function fdParse() {
  var M = MODEL, k, i;
  if (!M.fdOk) return false;
  if (M.fdIdx) return true;
  var sz = [], idx = [], W = FD_KEYS.length;
  M.fdZone = []; M.fdZoneN = [];
  for (k = 0; k < W; k++) {
    var d = M.fdv[FD_KEYS[k]], mp = {};
    for (i = 0; i < d.length; i++) mp[d[i]] = i;
    idx.push(mp); sz.push(d.length); M.fdZone.push({}); M.fdZoneN.push({});
  }
  for (var id in M.units) {
    if (!M.units.hasOwnProperty(id)) continue;
    var u = M.units[id], out = [], prs = u.fds ? String(u.fds).split(' ') : [];
    for (var p = 0; p < prs.length; p++) {
      var at = prs[p].indexOf(':'), code = at > 0 ? parseInt(prs[p].slice(0, at), 16) : NaN, n = at > 0 ? (parseInt(prs[p].slice(at + 1), 10) || 0) : 0, dig = [];
      if (isNaN(code)) continue;
      for (k = W - 1; k >= 0; k--) { dig[k] = code % sz[k]; code = Math.floor(code / sz[k]); }
      for (k = 0; k < W; k++) { out.push(dig[k]); M.fdZone[k][dig[k]] = 1; M.fdZoneN[k][dig[k]] = (M.fdZoneN[k][dig[k]] || 0) + n; }
      out.push(n);
    }
    u.fd = out;
  }
  M.fdIdx = idx;
  return true;
}
// Числа по набранному выбору (staged): фасет разреза K — люди области (набранный юнит, зона HRBP или
// вся зона) при ОСТАЛЬНЫХ набранных разрезах, ровно как строки f датасета после «Применить» (стенд
// сверяет число в число); marg — та же область без разрезов (порядок длинных списков); direct — люди
// прямо в юните при ВСЕХ набранных разрезах (поддеревья — fdSub по запросу). Кэш — по набранному.
function fdCalc() {
  if (!fdParse()) return null;
  var M = MODEL, st = staged(), scope = st.unit.length ? st.unit : M.roots, W = FD_KEYS.length, k, i;
  var key = scope.join(',');
  for (k = 0; k < W; k++) key += '|' + (st.cuts[FD_KEYS[k]] || []).join('\u0001');
  if (FDC.m === M && FDC.key === key) return FDC.val;
  var act = [], sets = [];
  for (k = 0; k < W; k++) {
    var sv = st.cuts[FD_KEYS[k]] || [];
    // Тип численности не выбран — только юридическая численность (13.10), как условие датасета: все значения, кроме NONLEGAL.
    if (!sv.length && FD_KEYS[k] === 'hct' && M.fdIdx[k].hasOwnProperty(NONLEGAL)) {
      var lg = {}, nl = M.fdIdx[k][NONLEGAL];
      for (var vk in M.fdIdx[k]) if (M.fdIdx[k].hasOwnProperty(vk) && M.fdIdx[k][vk] !== nl) lg[M.fdIdx[k][vk]] = 1;
      act.push(k); sets[k] = lg;
      continue;
    }
    if (!sv.length) continue;
    var set = {};
    for (i = 0; i < sv.length; i++) if (M.fdIdx[k].hasOwnProperty(sv[i])) set[M.fdIdx[k][sv[i]]] = 1;
    act.push(k); sets[k] = set;
  }
  var direct = {}, fac = [], pres = [], marg = [];
  for (var id in M.units) {
    if (!M.units.hasOwnProperty(id)) continue;
    var fd = M.units[id].fd, sum = 0;
    if (!fd || !fd.length) continue;
    for (var p = 0; p < fd.length; p += W + 1) {
      var pass = true;
      for (var a = 0; a < act.length; a++) if (!sets[act[a]][fd[p + act[a]]]) { pass = false; break; }
      if (pass) sum += fd[p + W];
    }
    direct[id] = sum;
  }
  for (k = 0; k < W; k++) { fac.push({}); pres.push({}); marg.push({}); }
  var seen = {}, stack = scope.slice();
  while (stack.length) {
    var x = stack.pop();
    if (seen[x]) continue;
    seen[x] = 1;
    var ks = M.kids[x] || [], fx = M.units[x] ? M.units[x].fd : null;
    for (i = 0; i < ks.length; i++) stack.push(ks[i]);
    if (!fx) continue;
    for (var q = 0; q < fx.length; q += W + 1) {
      var nf = 0, fail = -1, n = fx[q + W];
      for (var b = 0; b < act.length && nf < 2; b++) if (!sets[act[b]][fx[q + act[b]]]) { nf++; fail = act[b]; }
      for (k = 0; k < W; k++) {
        var vi = fx[q + k];
        marg[k][vi] = (marg[k][vi] || 0) + n;
        if (nf === 0 || (nf === 1 && fail === k)) { fac[k][vi] = (fac[k][vi] || 0) + n; pres[k][vi] = 1; }
      }
    }
  }
  FDC.m = M; FDC.key = key;
  FDC.val = { direct: direct, tree: {}, fac: fac, pres: pres, marg: marg };
  return FDC.val;
}
// Численность поддерева при набранных разрезах (последний закрытый месяц); без распределения —
// численность из справочника (на дату данных, без разрезов).
function fdSub(c, id, depth) {
  if (c.tree.hasOwnProperty(id)) return c.tree[id];
  c.tree[id] = 0;
  var s = c.direct[id] || 0, ks = MODEL.kids[id] || [];
  if (depth < 40) for (var i = 0; i < ks.length; i++) s += fdSub(c, ks[i], depth + 1);
  c.tree[id] = s;
  return s;
}
function unitN(id) {
  var c = fdCalc(), u = MODEL.units[id];
  return c ? fdSub(c, id, 0) : (u ? u.hc : 0);
}
function zoneN(ids) {
  var c = fdCalc(), n = 0;
  if (!c) return zoneHc(ids);
  for (var i = 0; i < ids.length; i++) n += fdSub(c, ids[i], 0);
  return n;
}
// Показ (метрики, «Только фокусные») в окне копится вместе с фильтрами и применяется той же
// «Применить» (без запроса); stagedView() — что показать, viewDiff() — 1, если показ изменён.
function stagedView() { return state.stageV || { off: state.metricOff, focus: !!state.focusOnly }; }
function viewDiff() {
  var a = state.stageV;
  if (!a) return 0;
  if (!!a.focus !== !!state.focusOnly) return 1;
  for (var i = 0; i < CFG.metrics.length; i++) { var k = CFG.metrics[i].key; if (!!a.off[k] !== !!state.metricOff[k]) return 1; }
  return 0;
}
function viewEdit(fn) {
  if (!state.stageV) {
    var off = {};
    for (var k in state.metricOff) if (state.metricOff.hasOwnProperty(k)) off[k] = state.metricOff[k];
    state.stageV = { off: off, focus: !!state.focusOnly };
  }
  fn(state.stageV);
  if (!viewDiff()) state.stageV = null;
}
// Сколько изменений ждёт «Применить»: фильтры по одному, показ — одним.
function pendingN() { return stageDiff() + viewDiff(); }
// Применённый HRBP (логин): явный выбор, пока его зона содержит область отчёта; иначе —
// HRBP, чьи корни ровно совпадают с областью (так выбор переживает перезагрузку страницы).
function hzNow() {
  var M = MODEL, h = state.hz ? M.hBy[state.hz] : null;
  if (h && idsInside(M.scopeIds, h.roots)) return h.login;
  if (defaultScope()) return '';
  var z = zoneOwner(M.scopeIds);
  return z ? z.login : '';
}
// Все юниты набора лежат внутри корней (на их путях есть один из корней).
function idsInside(ids, roots) {
  if (!ids.length) return false;
  for (var i = 0; i < ids.length; i++) {
    var p = pathTo(ids[i]), ok = false;
    for (var j = 0; j < p.length && !ok; j++) if (roots.indexOf(p[j]) > -1) ok = true;
    if (!ok) return false;
  }
  return true;
}
function stagedHz() { var z = staged().hz; return z && MODEL.hBy[z] ? MODEL.hBy[z] : null; }
function maskOf(o) {
  var out = [];
  function add(col, vals) {
    var v = [];
    for (var i = 0; i < (vals || []).length; i++) if (vals[i] !== null && vals[i] !== undefined) v.push(String(vals[i]));
    v.sort(); // один набор — одна маска и один ключ кэша, в каком бы порядке ни кликали (09.10)
    if (v.length) out.push({ column: col, operator: 'IN', value: v });
  }
  add(CFG.carriers.unit, (o.unit || []).slice(0, 50));
  for (var c = 0; c < CFG.cuts.length; c++) add(CFG.cuts[c].carrier, o.cuts ? o.cuts[CFG.cuts[c].key] : []);
  if (o.axis) add(CFG.carriers.axis, [o.axis]);
  if (o.depth === 'all') add(CFG.carriers.depth, ['all']);
  return out;
}

// ---------- БЛОК 4: ФОРМАТИРОВАНИЕ И ЦВЕТ ----------
// Тонкий пробел в разрядах, запятая в дроби, типографский минус.
var THIN = ' ', MINUS = '−', NBSP = ' ';
var MONTH_ABBR = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];
var MONTH_FULL = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
var MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
var MONTH_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];

function fmtInt(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  var neg = v < 0;
  var s = Math.round(Math.abs(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
  return (neg ? MINUS : '') + s;
}
function fmtNum1(v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  var neg = v < -0.0000001;
  return (neg ? MINUS : '') + Math.abs(v).toFixed(1).replace('.', ',');
}
function fmtVal(m, v) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return m.fmt === 'int' ? fmtInt(v) : fmtNum1(v) + '%';
}
function round1(v) { return Math.round(v * 10) / 10; }
function deltaOf(m, a, b) {
  if (a === null || b === null) return null;
  return m.fmt === 'int' ? Math.round(a - b) : round1(a - b);
}
function fmtDelta(m, d) {
  if (d === null || d === undefined || !isFinite(d)) return '—';
  var a = Math.abs(d);
  var body = m.fmt === 'int' ? fmtInt(a) : a.toFixed(1).replace('.', ',');
  var suf = m.fmt === 'int' ? '' : THIN + 'п.п.';
  if (d === 0) return body + suf;
  return (d > 0 ? '+' : MINUS) + body + suf;
}
function deltaClass(m, d) {
  if (d === null || d === 0 || NOCOL) return 'flat';
  if (m.better === 'flat') return 'neu';
  var good = (m.better === 'lower' && d < 0) || (m.better === 'higher' && d > 0);
  return good ? 'up' : 'down';
}
function plural(n, one, few, many) {
  n = Math.abs(Math.round(n));
  var d10 = n % 10, d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}
var MONTH_PREP = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
function monthName(i) { var s = MODEL.cal.m[i]; return s ? MONTH_FULL[dparts(s.s).m] : ''; }
function monthPrep(i) { var s = MODEL.cal.m[i]; return s ? MONTH_PREP[dparts(s.s).m] : ''; }
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function dparts(iso) { var p = toDate(iso); return p || { y: 0, m: 0, d: 1 }; }
function fmtDay(iso) { var p = dparts(iso); return p.d + NBSP + MONTH_GEN[p.m] + ' ' + p.y; }
function monthLabel(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_ABBR[p.m] + ' ' + p.y; }
function monthFull(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return capFirst(MONTH_FULL[p.m]) + ' ' + p.y; }
function monthLow(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_FULL[p.m] + ' ' + p.y; }
function monthDat(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_DAT[p.m] + ' ' + p.y; }

// Подсказка — один конструктор на весь чарт: заголовок, текст, строки, сноска.
function tipHtml(o) {
  if (!o) return '';
  var P = CFG.ns;
  var s = '';
  if (o.title) s += '<span class="' + P + '-t-h">' + esc(o.title) + '</span>';
  if (o.text) s += '<span class="' + P + '-t-x">' + esc(o.text) + '</span>';
  var rows = o.rows || [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!r) continue;
    // Маркер серии повторяет легенду: у линии — штрих (пунктир у базы и цели), у столбика — плашка.
    var ln = r.dash || r.line;
    var mk = r.color ? '<i class="' + P + '-t-m' + (ln ? ' ' + P + '-dash' + (r.line ? ' ' + P + '-solid' : '') : '') + '" style="' + (ln ? 'border-top-color:' : 'background:') + r.color + '"></i>' : '';
    s += '<span class="' + P + '-t-r' + (r.dim ? ' ' + P + '-dim' : '') + '">' + mk + '<span class="' + P + '-t-l">' + esc(r.label) + '</span>'
      + (r.pill ? '<b class="' + P + '-pill ' + P + '-' + r.pill + ' ' + P + '-t-pill">' + esc(r.value) + '</b>' : '<b class="' + P + '-t-v">' + esc(r.value) + '</b>') + '</span>';
  }
  var notes = o.note ? (Object.prototype.toString.call(o.note) === '[object Array]' ? o.note : [o.note]) : [];
  for (var n = 0; n < notes.length; n++) if (notes[n]) s += '<span class="' + P + '-t-n">' + esc(notes[n]) + '</span>';
  return s;
}
function tip(o) { return ' data-tip="' + esc(tipHtml(o)) + '"'; }
var STATE_TXT = { good: 'лучше ориентира', bad: 'хуже ориентира', warn: 'в пределах ±5% от цели', neutral: 'в пределах ±5% или без оценки' };
function stTxt(st) { return NOCOL ? 'Без цвета: в юните мало людей, чтобы оценивать.' : STATE_TXT[st]; }

// ---- шкала для линий: подобрана по данным (у линии читают наклон), ось Y обязательна ----
function niceStep(raw) {
  var pow = Math.pow(10, Math.floor(Math.log(Math.max(raw, 1e-9)) / Math.LN10));
  var n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}
function axisFmt(m, v) {
  if (m.fmt === 'int') return fmtInt(v);
  var s = Math.abs(v % 1) < 1e-9 ? String(Math.round(v)) : v.toFixed(1).replace('.', ',');
  return s + '%';
}
function lineScale(m, vals) {
  var lo = Infinity, hi = -Infinity;
  for (var i = 0; i < vals.length; i++) { var v = vals[i]; if (v === null || !isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  var span = hi - lo;
  if (!(span > 0)) span = Math.max(Math.abs(hi) * 0.15, 1);
  var pad = span * 0.15;
  var zeroBased = lo <= span;
  var step = niceStep(((hi + pad) - (zeroBased ? 0 : lo - pad)) / 3);
  var min = zeroBased ? 0 : Math.max(0, Math.floor((lo - pad) / step) * step);
  var max = Math.ceil((hi + pad) / step) * step;
  if (m.share && max > 100) max = 100;
  if (max <= min) max = min + step;
  return { min: min, max: max };
}
function textW(s, px) { var w = 0; s = String(s); for (var i = 0; i < s.length; i++) { var c = s.charAt(i); w += (c === ',' || c === '.' || c === ' ' || c === THIN) ? 0.3 : (c === '%' ? 0.62 : 0.58); } return w * (px || 11); }

// ---- SVG: линия «период к периоду» в стиле Proteus Adoption (ДС 6.2–6.5) ----
// spec: {m, labels[12], cur[12], prev[12], ref[12]|null, refKind 'kpi'|'bench'|'', boldIdx,
//        heads[12] (заголовки подсказок), prevHeads[12]|null, curName, prevName, refName, tips{cur,prev,ref}}
// Текущий период — акцент с заливкой и подписью у каждой точки: подписи рисуются ПОСЛЕ всех
// линий на белой подложке, поэтому чужая линия их не перечёркивает. Прошлый период — светлая
// линия, ориентир — пунктир. Выключенная в легенде серия уходит из шкалы и из подсказки.
// Наведение — одна хит-зона на весь график (data-hz): колонка по X курсора, перекрестие и
// тултип со всеми сериями; соседние месяцы переключаются без мигания.
function smoothPath(pts) {
  // Сглаживание Adoption: касательная в каждой точке горизонтальна — кривая не выходит за значения.
  var d = 'M' + pts[0][0].toFixed(1) + ' ' + pts[0][1].toFixed(1);
  for (var i = 1; i < pts.length; i++) {
    var dx = (pts[i][0] - pts[i - 1][0]) / 2;
    d += 'C' + (pts[i - 1][0] + dx).toFixed(1) + ' ' + pts[i - 1][1].toFixed(1) + ' ' + (pts[i][0] - dx).toFixed(1) + ' ' + pts[i][1].toFixed(1)
      + ' ' + pts[i][0].toFixed(1) + ' ' + pts[i][1].toFixed(1);
  }
  return d;
}
// Непрерывные куски ряда (пропуски рвут линию): [[[x, y, i], …], …]
function runs(arr, X, Y) {
  var out = [], cur = null;
  for (var i = 0; i < arr.length; i++) {
    if (arr[i] === null || arr[i] === undefined) { cur = null; continue; }
    if (!cur) { cur = []; out.push(cur); }
    cur.push([X(i), Y(arr[i]), i]);
  }
  return out;
}
function svgLine(spec, W, H, ctx) {
  var nc0 = NOCOL;
  NOCOL = !!spec.nocol;
  try { return svgLine0(spec, W, H, ctx); } finally { NOCOL = nc0; }
}
function svgLine0(spec, W, H, ctx) {
  var P = CFG.ns, C = CFG.colors, G = CFG.chart, F = CFG.fonts, m = spec.m, n = spec.labels.length;
  var anim = !!(ctx && ctx.anim);
  var on = { cur: true, prev: !cmpRef(spec) && !spec.noPrev, ref: cmpRef(spec) };
  var refC = spec.refKind === 'kpi' ? C.kpi : C.bench;
  var all = [];
  for (var i = 0; i < n; i++) {
    if (on.cur) all.push(spec.cur[i]);
    if (on.prev) all.push(spec.prev[i]);
    if (on.ref) all.push(spec.ref[i]);
  }
  var sc = lineScale(m, all);
  var refNow = null;
  if (on.ref) for (var k = n - 1; k >= 0; k--) if (spec.ref[k] !== null && spec.ref[k] !== undefined) { refNow = spec.ref[k]; break; }
  var ticks = [sc.min, (sc.min + sc.max) / 2, sc.max], tw = 0;
  for (var t0 = 0; t0 < ticks.length; t0++) tw = Math.max(tw, textW(axisFmt(m, ticks[t0]), F.axis));
  if (refNow !== null) tw = Math.max(tw, textW(axisFmt(m, refNow), F.axis));
  var gl = Math.ceil(tw + 14), gr = 16, gt = G.top, gb = G.axis;
  var pw = Math.max(40, W - gl - gr), ph = Math.max(40, H - gt - gb);
  function X(i) { return gl + (n <= 1 ? pw / 2 : pw * i / (n - 1)); }
  function Y(v) { return gt + ph - (v - sc.min) / (sc.max - sc.min) * ph; }
  function dly(i) { return Math.round(150 + (G.drawMs - 160) * (n <= 1 ? 1 : i / (n - 1))); }
  var s = '<svg class="' + P + '-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  // сетка: три тонкие пунктирные линии с подписями слева; ориентир — подпись своим цветом
  var refY = refNow !== null ? Y(refNow) : null;
  for (var t = 0; t < ticks.length; t++) {
    var y = Y(ticks[t]);
    s += '<line x1="' + gl + '" x2="' + (gl + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.grid + '"' + (t ? ' stroke-dasharray="3 3"' : '') + '/>';
    if (refY === null || Math.abs(refY - y) > 12) s += '<text x="' + (gl - 8) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" class="' + P + '-ax">' + esc(axisFmt(m, ticks[t])) + '</text>';
  }
  if (refY !== null && refY >= gt - 2 && refY <= gt + ph + 2) {
    s += '<text x="' + (gl - 8) + '" y="' + (refY + 3.5).toFixed(1) + '" text-anchor="end" class="' + P + '-ax ' + P + '-axk" style="fill:' + refC + '" data-s="ref">' + esc(axisFmt(m, refNow)) + '</text>';
  }
  // ось X: линия по ширине области, месяцы; текущий — 600
  s += '<line x1="' + (gl - 4) + '" x2="' + (gl + pw + 4) + '" y1="' + (gt + ph + 0.5) + '" y2="' + (gt + ph + 0.5) + '" stroke="' + C.axisLine + '"/>';
  for (var xi = 0; xi < n; xi++) {
    s += '<text x="' + X(xi).toFixed(1) + '" y="' + (gt + ph + 15) + '" text-anchor="middle" class="' + P + '-ax' + (xi === spec.boldIdx ? ' ' + P + '-axb' : '') + '">' + esc(spec.labels[xi]) + '</text>';
  }
  var rCur = on.cur ? runs(spec.cur, X, Y) : [], rPrev = on.prev ? runs(spec.prev, X, Y) : [], rRef = on.ref ? runs(spec.ref, X, Y) : [];
  // заливка под текущим — открывается слева направо вместе с линией
  if (rCur.length) {
    var cid = P + '-clip' + (ctx ? ctx.ci : 0) + '-' + (++CLIP_N);
    s += '<defs><clipPath id="' + cid + '"><rect x="0" y="0" height="' + H + '" width="' + (anim ? 0 : W) + '">'
      + (anim ? '<animate attributeName="width" from="0" to="' + W + '" dur="' + (G.drawMs / 1000) + 's" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"/>' : '')
      + '</rect></clipPath></defs>';
    for (var ra = 0; ra < rCur.length; ra++) {
      var pa = rCur[ra];
      if (pa.length < 2) continue;
      s += '<path d="' + smoothPath(pa) + 'L' + pa[pa.length - 1][0].toFixed(1) + ' ' + (gt + ph) + 'L' + pa[0][0].toFixed(1) + ' ' + (gt + ph) + 'Z" fill="' + C.curArea
        + '" clip-path="url(#' + cid + ')" data-s="cur"/>';
    }
  }
  // прошлый период — светлая линия с точками
  for (var rp = 0; rp < rPrev.length; rp++) {
    var pp = rPrev[rp];
    if (pp.length > 1) s += '<path class="' + P + '-ln" pathLength="1" stroke-dasharray="1" d="' + smoothPath(pp) + '" fill="none" stroke="' + C.prev + '" stroke-width="1.8" stroke-linecap="round" data-s="prev"/>';
    for (var q = 0; q < pp.length; q++) s += '<circle class="' + P + '-fd" data-d="' + dly(pp[q][2]) + '" cx="' + pp[q][0].toFixed(1) + '" cy="' + pp[q][1].toFixed(1) + '" r="2.4" fill="' + C.prev + '" stroke="#fff" stroke-width="1.2" data-s="prev"/>';
  }
  // ориентир — пунктир; не рисуется, а проявляется (ДС 6.5)
  for (var rr = 0; rr < rRef.length; rr++) {
    var pr = rRef[rr], dr = '';
    for (var q2 = 0; q2 < pr.length; q2++) dr += (q2 ? 'L' : 'M') + pr[q2][0].toFixed(1) + ' ' + pr[q2][1].toFixed(1);
    if (pr.length === 1) dr += 'l0.1 0';
    s += '<path class="' + P + '-fd" data-d="120" d="' + dr + '" fill="none" stroke="' + refC + '" stroke-width="1.6" stroke-dasharray="' + (spec.refKind === 'kpi' ? '6 4' : '4 3') + '" data-s="ref"/>';
  }
  // текущий — акцентная линия с точками
  for (var rc = 0; rc < rCur.length; rc++) {
    var pc = rCur[rc];
    if (pc.length > 1) s += '<path class="' + P + '-ln" pathLength="1" stroke-dasharray="1" d="' + smoothPath(pc) + '" fill="none" stroke="' + C.cur + '" stroke-width="2" stroke-linecap="round" data-s="cur"/>';
    for (var q3 = 0; q3 < pc.length; q3++) s += '<circle class="' + P + '-fd" data-d="' + dly(pc[q3][2]) + '" cx="' + pc[q3][0].toFixed(1) + '" cy="' + pc[q3][1].toFixed(1) + '" r="3" fill="' + C.cur + '" stroke="#fff" stroke-width="1.6" data-s="cur"/>';
  }
  // подписи текущего — поверх всех линий, на белой подложке. Над точкой, если прошлый
  // период ниже (или выключен), иначе под ней; наезжающую на соседку — на другую сторону.
  var placed = [];
  function hits(bx) {
    for (var z = 0; z < placed.length; z++) {
      var o = placed[z];
      if (bx.x < o.x + o.w + 2 && o.x < bx.x + bx.w + 2 && bx.y < o.y + o.h && o.y < bx.y + bx.h) return true;
    }
    return false;
  }
  // Номерные отметки фактов «Что видно» (раскрытая строка «Сводки»): точка с номером вместо обычной;
  // подписи значений их обходят, у отмеченной точки подпись отодвинута от кружка.
  var marks = spec.marks || [], mAt = {}, mk = '', mkHz = [];
  for (var mi = 0; mi < marks.length; mi++) {
    var mm = marks[mi], ms = mm.s === 'prev' ? spec.prev : spec.cur;
    if (!on[mm.s] || mm.i < 0 || mm.i >= n || ms[mm.i] === null || ms[mm.i] === undefined) continue;
    var mx = X(mm.i), my = Y(ms[mm.i]);
    if (mm.s === 'cur') mAt[mm.i] = true;
    placed.push({ x: mx - 8, y: my - 8, w: 16, h: 16 });
    mkHz.push({ n: String(mm.n), x: mx, y: my });
    // Связь с фактом справа (13.10): при наведении на факт или на точку — ореол, акцент и пунктир до оси месяцев.
    mk += '<g class="' + P + '-fd ' + P + '-mk" data-d="' + dly(mm.i) + '" data-s="' + mm.s + '" data-mk="' + mm.n + '">'
      + '<line class="' + P + '-mkg" x1="' + mx.toFixed(1) + '" x2="' + mx.toFixed(1) + '" y1="' + (my + 9).toFixed(1) + '" y2="' + (gt + ph).toFixed(1) + '"/>'
      + '<circle class="' + P + '-mkh" cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="14"/>'
      + '<circle class="' + P + '-mkc" cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="8" fill="' + (mm.s === 'prev' ? C.neutralTx : C.ink) + '" stroke="#fff" stroke-width="1.6"/>'
      + '<text x="' + mx.toFixed(1) + '" y="' + (my + 3.6).toFixed(1) + '" text-anchor="middle" class="' + P + '-mkt">' + mm.n + '</text></g>';
  }
  var lbl = '', order = [];
  // Подпись текущего месяца ставится первой: соседние при столкновении уходят на другую
  // сторону точки или пропускаются (их значения — в тултипе), а она не пропадает никогда.
  if (spec.boldIdx >= 0 && spec.boldIdx < n) order.push(spec.boldIdx);
  for (var oi = 0; oi < n; oi++) if (oi !== spec.boldIdx) order.push(oi);
  if (on.cur) {
    for (var oj = 0; oj < order.length; oj++) {
      var ci = order[oj], v = spec.cur[ci];
      if (v === null || v === undefined) continue;
      var cx = X(ci), cy = Y(v), txt = fmtVal(m, v), lw = textW(txt, F.val) + 8;
      var pv = on.prev ? spec.prev[ci] : null;
      var up = pv === null || pv === undefined || v >= pv;
      if (cy + 22 > gt + ph) up = true;
      if (cy - 22 < 2) up = false;
      var bx0 = Math.min(Math.max(cx - lw / 2, gl - 6), gl + pw + gr - lw - 1), off = mAt[ci] ? 4 : 0;
      var tries = [up, !up], box = null;
      for (var tr = 0; tr < 2 && !box; tr++) {
        var yb = tries[tr] ? cy - 9 - off : cy + 17 + off;
        if (!tries[tr] && yb + 4 > gt + ph) continue;
        var cand = { x: bx0, y: yb - 11, w: lw, h: 15 };
        if (!hits(cand) || (ci === spec.boldIdx && tr === 1)) box = cand;
      }
      if (!box) continue;
      placed.push(box);
      lbl += '<g class="' + P + '-fd" data-d="' + dly(ci) + '" data-s="cur"><rect x="' + box.x.toFixed(1) + '" y="' + box.y.toFixed(1) + '" width="' + box.w.toFixed(1) + '" height="' + box.h + '" rx="4" class="' + P + '-vlb"/>'
        + '<text x="' + (box.x + box.w / 2).toFixed(1) + '" y="' + (box.y + 11).toFixed(1) + '" text-anchor="middle" class="' + P + '-vl' + (ci === spec.boldIdx ? ' ' + P + '-vlc' : '') + '">' + esc(txt) + '</text></g>';
    }
  }
  s += lbl;
  // перекрестие: линия и маркеры серий на колонке под курсором (показывает БЛОК 6)
  s += '<g class="' + P + '-xhg" data-xh="1" style="display:none"><line x1="0" x2="0" y1="' + gt + '" y2="' + (gt + ph) + '" stroke="' + C.xh + '" stroke-width="1"/>'
    + (on.ref ? '<circle data-xs="ref" r="3.2" fill="#fff" stroke="' + refC + '" stroke-width="1.6"/>' : '')
    + (on.prev ? '<circle data-xs="prev" r="3.6" fill="' + C.prev + '" stroke="#fff" stroke-width="1.6"/>' : '')
    + (on.cur ? '<circle data-xs="cur" r="4.6" fill="' + C.cur + '" stroke="#fff" stroke-width="2"/>' : '') + '</g>';
  // Номерные точки — поверх перекрестия: его кружок не закрывает номер.
  s += mk;
  // данные колонок для следящего тултипа
  var xs = [], ys = { cur: [], prev: [], ref: [] }, tips = [];
  for (var hi = 0; hi < n; hi++) {
    xs.push(X(hi));
    ys.cur.push(on.cur && spec.cur[hi] !== null ? Y(spec.cur[hi]) : null);
    ys.prev.push(on.prev && spec.prev[hi] !== null ? Y(spec.prev[hi]) : null);
    ys.ref.push(on.ref && spec.ref[hi] !== null && spec.ref[hi] !== undefined ? Y(spec.ref[hi]) : null);
    var rows = [], st = null;
    if (spec.cur[hi] !== null && spec.ref && spec.ref[hi] !== null && spec.ref[hi] !== undefined) {
      st = spec.refKind === 'kpi' ? stateForKpi(m, spec.cur[hi], spec.ref[hi]) : compareState(m, spec.cur[hi], spec.ref[hi]);
    }
    if (on.cur && spec.cur[hi] !== null) rows.push({ label: spec.curName, value: fmtVal(m, spec.cur[hi]), color: C.cur, line: true, pill: st && st !== 'neutral' && st !== 'warn' ? st : null });
    if (on.prev && spec.prev[hi] !== null) rows.push({ label: spec.prevName + (spec.prevHeads ? ' · ' + spec.prevHeads[hi] : ''), value: fmtVal(m, spec.prev[hi]), color: C.prev, line: true, dim: true });
    if (on.ref && spec.ref[hi] !== null && spec.ref[hi] !== undefined) rows.push({ label: spec.refName, value: fmtVal(m, spec.ref[hi]), color: refC, dash: true, dim: true });
    if (!rows.length) rows.push({ label: 'нет данных', value: '—' });
    tips.push(tipHtml({ title: spec.heads[hi], rows: rows, note: st && on.cur && on.ref ? stTxt(st) : null }));
  }
  if (ctx && CHARTS[ctx.ci]) CHARTS[ctx.ci].hz = { xs: xs, ys: ys, tips: tips, mk: mkHz };
  s += '<rect class="' + P + '-hz" x="' + (gl - 8) + '" y="' + (gt - 6) + '" width="' + (pw + 16) + '" height="' + (ph + 6) + '" fill="transparent" data-hz="line" data-kind="pt" data-hc="' + (ctx ? ctx.ci : 0) + '"/>';
  return s + '</svg>';
}

// ---- спарклайн: линия за 12 месяцев (владелец, 06.10: «барчарты лучше линией») ----
// Точка — оценка КАЖДОГО месяца к его ориентиру (цвет светофора), пунктир — сам ориентир
// (цель или база месяца), последняя точка крупнее. Шкала — по значениям и ориентиру, но не
// уже 8 % от величины: удержание 91–92 % не раздувается на всю высоту. Колонка месяца —
// группа с полосой на всю высоту (без щелей): тултип едет по месяцам не мигая.
function svgSpark(vals, states, tips, refs) {
  var P = CFG.ns, w = 240, h = 48, n = vals.length, px = 6, pt = 8, pb = 8, lo = null, hi = null, i;
  function take(v) { if (v === null || v === undefined || isNaN(v)) return; lo = lo === null ? v : Math.min(lo, v); hi = hi === null ? v : Math.max(hi, v); }
  for (i = 0; i < n; i++) { take(vals[i]); if (refs) take(refs[i]); }
  if (lo === null) { lo = 0; hi = 1; }
  var mag = Math.max(Math.abs(lo), Math.abs(hi)), need = mag * 0.08;
  if (hi - lo < need || hi - lo < 1e-9) {
    var mid = (hi + lo) / 2, half = Math.max(need, 1e-6) / 2;
    lo = mid - half; hi = mid + half;
    if (lo < 0 && mid >= 0) { hi -= lo; lo = 0; }
    if (mag === 0) { lo = 0; hi = 1; }
  } else { var padv = (hi - lo) * 0.1; lo -= padv; hi += padv; if (lo < 0 && mag > 0) lo = Math.min(0, lo + padv); }
  var step = (w - px * 2) / Math.max(1, n - 1);
  function X(k) { return px + k * step; }
  function Y(v) { return pt + (1 - (v - lo) / (hi - lo)) * (h - pt - pb); }
  function path(arr) {
    var d = '', on = false;
    for (var k = 0; k < n; k++) {
      var v = arr[k];
      if (v === null || v === undefined || isNaN(v)) { on = false; continue; }
      d += (on ? 'L' : 'M') + X(k).toFixed(1) + ' ' + Y(v).toFixed(1);
      on = true;
    }
    return d;
  }
  var s = '';
  if (refs) { var rd = path(refs); if (rd) s += '<path d="' + rd + '" class="' + P + '-sref"/>'; }
  var vd = path(vals);
  if (vd) s += '<path d="' + vd + '" class="' + P + '-sline"/>';
  var last = -1;
  for (i = 0; i < n; i++) if (vals[i] !== null && vals[i] !== undefined && !isNaN(vals[i])) last = i;
  for (var j = 0; j < n; j++) {
    var v = vals[j], x0 = j === 0 ? 0 : X(j) - step / 2, x1 = j === n - 1 ? w : X(j) + step / 2;
    s += '<g class="' + P + '-sbg"' + (tips && tips[j] ? tip(tips[j]) : '') + '>'
      + '<rect class="' + P + '-hit" x="' + x0.toFixed(1) + '" y="0" width="' + (x1 - x0).toFixed(1) + '" height="' + h + '"/>';
    if (v !== null && v !== undefined && !isNaN(v)) {
      s += '<circle cx="' + X(j).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="' + (j === last ? 4 : 2.8) + '" class="' + P + '-sdot ' + P + '-' + (states[j] || 'neutral') + (j === last ? ' ' + P + '-slast' : '') + '"/>';
    }
    s += '</g>';
  }
  return '<svg class="' + P + '-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + s + '</svg>';
}

// ---------- БЛОК 5: РАЗМЕТКА (<style> + HTML) ----------
// КАЖДЫЙ селектор начинается с .<ns>- или с .<ns>-root - иначе стили
// протекут в интерфейс Proteus. НИКАКИХ голых div/table/th/button.
// Стили из макета переносятся СЮДА ЦЕЛИКОМ, а не выбрасываются.
// ЦЕЛИКОМ — кроме рамки самой демо-страницы: фон/отступы body, центрирование,
// фикс-ширина внешнего контейнера НЕ переносятся. Корень остаётся width:100% —
// виджет тянется за ячейкой дашборда (RETRO 48). Оконные @media и vw/vh
// в ячейке не работают: адаптив — от контейнера (RETRO 49, RECIPES.md
// «Рамка макета ≠ рамка виджета»).
// Макет HRBP HUB (styles.css, дизайн-система TeamPulse): полка фильтров слева
// в одном чарте стала кнопкой «Фильтры» с окном по центру (чипы применённого — под вкладками),
// окно KPI — вкладкой «Цели».
// Узкая ячейка (< 1100 px) — класс <ns>-narrow на корне вместо @media.
function buildCSS() {
  // Типографика, иконки и отступы — профиль виджетов Proteus Adoption
  // (DESIGN_SYSTEM.md §16 репозитория adoption, код pa-area / pa-strip): кегли —
  // только роли CFG.fonts, веса 400 / 500 / 600 (700+ нет нигде), контролы 34 px,
  // панель 14/16, KPI 12/14, таблица th 9/8 · td 6/8 · строка 44, тултип 7/10.
  var P = '.' + CFG.ns, C = CFG.colors, F = CFG.fonts;
  var SH = '0 1px 3px rgba(20,28,45,.06),0 4px 16px rgba(20,28,45,.04)';
  return [
    '<style>',
    P + '-root{width:100%;min-height:100%;box-sizing:border-box;'
            + 'font-family:' + CFG.fonts.family + ';'
            + 'font-size:' + F.body + 'px;color:' + C.ink + ';background:' + C.bg + ';}',
    P + '-root *{box-sizing:border-box;font-family:inherit;}',
    // Рамка фокуса — только при работе с клавиатуры (:focus-visible): мышью вид прежний (ревью 13.10).
    P + '-root :focus-visible{outline:2px solid ' + C.act + ';outline-offset:2px;}',
    P + '-root tr:focus-visible,' + P + '-root th:focus-visible,' + P + '-root ' + P + '-tr:focus-visible{outline-offset:-2px;}',
    // <b> по умолчанию 700 — в профиле потолок 600: выделение внутри текста — 500.
    P + '-root b,' + P + '-root strong{font-weight:500;}',
    // ТУЛТИП живёт В BODY, вне -root — шрифт ему НЕ наследуется.
    // Повторяем font-family и position:fixed явно, иначе будет другой шрифт.
    P + '-tip{position:fixed;z-index:99999;pointer-events:none;opacity:0;'
           + 'font-family:' + CFG.fonts.family + ';box-sizing:border-box;'
           + 'transition:opacity .08s;'
           + 'background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:9px;'
           + 'box-shadow:0 10px 30px rgba(24,33,50,.18),0 2px 6px rgba(24,33,50,.08);'
           + 'padding:7px 10px;font-size:' + F.note + 'px;line-height:1.4;color:' + C.ink2 + ';font-weight:400;'
           + 'max-width:260px;white-space:normal;}',
    P + '-tip b{font-weight:500;}',
    P + '-tip ' + P + '-t-h{display:block;font-size:' + F.cap + 'px;font-weight:500;letter-spacing:.3px;text-transform:uppercase;color:' + C.muted + ';margin-bottom:5px;}',
    P + '-tip ' + P + '-t-x{display:block;font-size:' + F.note + 'px;font-weight:400;color:' + C.ink2 + ';line-height:1.4;}',
    P + '-tip ' + P + '-t-r{display:flex;align-items:center;gap:6px;margin-top:3px;min-width:118px;}',
    P + '-tip ' + P + '-t-r:first-child{margin-top:0;}',
    P + '-tip ' + P + '-t-m{display:inline-block;flex:0 0 auto;width:10px;height:9px;border-radius:3px;}',
    P + '-tip ' + P + '-t-m' + P + '-dash{height:0;width:14px;border-radius:0;border-top:2px dashed;background:none;}',
    P + '-tip ' + P + '-t-m' + P + '-solid{border-top-style:solid;}',
    P + '-tip ' + P + '-t-l{font-size:' + F.val + 'px;font-weight:500;color:' + C.muted + ';min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-tip ' + P + '-t-v{display:inline;margin:0 0 0 auto;font-size:' + F.body + 'px;font-weight:500;color:' + C.ink + ';white-space:nowrap;font-variant-numeric:tabular-nums;}',
    P + '-tip ' + P + '-t-r' + P + '-dim ' + P + '-t-v{color:' + C.muted + ';}',
    P + '-tip ' + P + '-t-pill{margin:0 0 0 auto;}',
    P + '-tip ' + P + '-t-n{display:block;font-size:' + F.cap + 'px;line-height:1.35;font-weight:400;color:' + C.muted + ';margin-top:4px;}',
    P + '-tip ' + P + '-t-r+' + P + '-t-n{margin-top:6px;padding-top:5px;border-top:1px solid ' + C.line2 + ';}',

    // ---- шапка: имя, выбор юнита, свежесть, вкладки ----
    // шапка — карточка на холсте (как шапка листа Adoption): радиус 12, без тени и без полосы во всю ширину
    // Шапка, строка контекста и плашки — липкий верх (владелец 12.10): вкладки, фильтры и база видны при
    // любой прокрутке отчёта. Поля по бокам даёт борд (CSS файла 4, 24 px) — у чарта своих нет.
    P + '-stick{position:sticky;top:0;z-index:40;background:' + C.bg + ';padding:0 0 10px;transition:box-shadow .15s;}',
    // под липким верхом прокручено содержимое — тонкая тень снизу: видно, что отчёт листается под шапкой
    P + '-stick' + P + '-shd{box-shadow:0 6px 8px -6px rgba(20,28,45,.18);}',
    P + '-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0;padding:8px 12px 8px 8px;background:' + C.card + ';border-radius:12px;}',
    P + '-logo{font-weight:600;font-size:' + F.title + 'px;white-space:nowrap;color:' + C.ink + ';padding-left:8px;}',
    P + '-logo small{color:' + C.muted + ';font-weight:400;font-size:' + F.note + 'px;margin-left:6px;}',
    P + '-sp{flex:1;}',
    // Свежесть и роль — строкой, как «данные за вчера» в шапке Adoption: не контрол.
    P + '-badge{display:inline-flex;align-items:center;gap:6px;color:' + C.muted + ';font-weight:400;font-size:' + F.note + 'px;white-space:nowrap;cursor:help;}',
    P + '-badge b{color:' + C.ink2 + ';font-weight:500;}',
    P + '-badge+' + P + '-badge{padding-left:10px;border-left:1px solid ' + C.line + ';}',
    // вкладки отчёта — пилюли групп «Команд» (-subs ниже), кегль контрола
    P + '-tabbar ' + P + '-sub{font-size:' + F.control + 'px;}',
    P + '-sub ' + P + '-cnt{margin-left:0;}',
    P + '-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;margin-left:5px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;font-size:' + F.micro + 'px;font-weight:500;}',

    // ---- строка фильтров: контролы 34 px ----
    P + '-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 0;min-height:44px;}',
    P + '-ctx{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;margin-right:6px;font-size:' + F.body + 'px;color:' + C.ink2 + ';}',
    P + '-ddb{display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;max-width:340px;}',
    P + '-ddb:hover{border-color:#d8dce4;}',
    P + '-ddb' + P + '-set{background:' + C.blueBg + ';color:#2b5fd0;border-color:#dbe6fd;}',
    P + '-ddb' + P + '-on{border-color:' + C.act + ';}',
    // выбрано, но не применено: пунктир акцентом — видно, что ждёт «Применить»
    P + '-ddb' + P + '-chg{border-style:dashed;border-color:' + C.act + ';}',
    P + '-ddl{color:' + C.muted + ';font-weight:400;}',
    P + '-ddb' + P + '-set ' + P + '-ddl{color:#5b83dc;}',
    P + '-ddv{overflow:hidden;text-overflow:ellipsis;min-width:0;}',
    P + '-ddc{color:' + C.muted + ';font-size:' + F.cap + 'px;}',
    P + '-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(43,95,208,.14);color:#2b5fd0;font-size:' + F.val + 'px;line-height:1;cursor:pointer;flex:0 0 auto;}',
    P + '-x:hover{background:rgba(43,95,208,.3);}',
    P + '-bench{display:inline-flex;align-items:center;gap:6px;height:34px;border-radius:9px;padding:0 12px;font-size:' + F.control + 'px;font-weight:400;background:' + C.bg + ';color:' + C.muted + ';border:1px solid ' + C.line + ';cursor:help;white-space:nowrap;}',
    P + '-bench b{color:' + C.ink2 + ';font-weight:500;}',
    // «Только фокусные» — переключатель шапки Adoption: 34 px, ползунок 26 × 15
    P + '-ft{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 11px 0 8px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.card + ';cursor:pointer;user-select:none;white-space:nowrap;}',
    P + '-ft:hover{border-color:#d3d8e0;}',
    P + '-ft-tr{position:relative;flex:0 0 auto;width:26px;height:15px;border-radius:999px;background:#dfe3ea;transition:background .15s;}',
    P + '-ft-kn{position:absolute;top:2px;left:2px;width:11px;height:11px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(20,28,45,.2);transition:left .15s;}',
    P + '-ft' + P + '-on ' + P + '-ft-tr{background:' + C.blue + ';}',
    P + '-ft' + P + '-on ' + P + '-ft-kn{left:13px;}',
    P + '-ft-tx{font-size:' + F.control + 'px;font-weight:400;color:' + C.ink2 + ';}',
    P + '-ft' + P + '-on ' + P + '-ft-tx{color:' + C.blue + ';}',
    // ---- кнопка «Фильтры» и чипы применённого (окно «Фильтры и настройки» — ниже) ----
    P + '-fbtn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 10px;border:1px solid ' + C.line + ';border-radius:9px;background:' + C.card + ';font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;}',
    P + '-fbtn:hover{border-color:#d3d8e0;}',
    P + '-fbtn svg{color:' + C.muted + ';flex:0 0 auto;}',
    P + '-fbtn' + P + '-on{border-color:' + C.act + ';}',
    P + '-fbtn ' + P + '-cnt{margin-left:0;}',
    P + '-chip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px 0 11px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;font-size:' + F.control + 'px;font-weight:500;white-space:nowrap;max-width:340px;}',
    P + '-chip ' + P + '-ddl{color:#5b83dc;font-weight:400;}',
    // набрано в окне, но не применено: пунктир акцентом, как у изменённого раздела
    P + '-unap{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 4px 0 12px;border:1px dashed ' + C.act + ';border-radius:9px;font-size:' + F.note + 'px;color:' + C.ink2 + ';white-space:nowrap;}',
    P + '-unap ' + P + '-btn{height:26px;padding:0 10px;}',
    // ---- окно «Фильтры и настройки» по центру (модалка Adoption, ДС §4.11): подложка, шапка в одну строку,
    // тело — зоны «Фильтры» и «Показ». Широкое окно (-md3) — три колонки во всю высоту: «Чья зона и юнит» |
    // «Разрезы» | «Показ», без прокрутки — дерево юнитов, список метрик и раскрытый разрез тянутся на остаток
    // высоты и прокручиваются внутри (владелец 07.10: «настройки должны вмещаться в экран по высоте»).
    // Среднее — две колонки, каждая прокручивается сама; узкое (-md1) — одна, прокручивается тело.
    // Подвал с «Применить» не прокручивается никогда ----
    P + '-mdb{position:fixed;z-index:60;background:rgba(20,28,45,.42);}',
    P + '-mdl{position:fixed;z-index:61;display:flex;flex-direction:column;background:' + C.card + ';border-radius:16px;box-shadow:0 8px 28px rgba(20,28,45,.16);outline:none;overflow:hidden;color:' + C.ink + ';font-size:' + F.body + 'px;}',
    P + '-mdh{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:10px 12px 10px 20px;border-bottom:1px solid ' + C.line2 + ';}',
    P + '-mdhx{flex:1;min-width:0;display:flex;align-items:baseline;flex-wrap:wrap;gap:2px 12px;}',
    P + '-mdt{display:block;font-size:' + F.title + 'px;font-weight:600;color:' + C.ink + ';white-space:nowrap;}',
    P + '-mdd{display:block;font-size:' + F.note + 'px;color:' + C.muted + ';line-height:1.4;}',
    P + '-mdbd{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);}',
    P + '-mdc{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 20px 18px;}',
    P + '-mdc+' + P + '-mdc{border-left:1px solid ' + C.line2 + ';background:' + C.hover + ';}',
    P + '-md1 ' + P + '-mdbd{display:block;overflow-y:auto;overscroll-behavior:contain;}',
    P + '-md1 ' + P + '-mdc{overflow:visible;}',
    P + '-md1 ' + P + '-mdc+' + P + '-mdc{border-left:0;border-top:1px solid ' + C.line2 + ';}',
    // три колонки: «Фильтры» — сетка из двух подколонок (зона и юнит | разрезы), каждая — колонка во всю
    // высоту; тянутся дерево юнитов, раскрытый список HRBP и список метрик (длинный разрез — выпадающим
    // списком, ниже). Зона и юнит — самая широкая (длинные имена структуры и HRBP, владелец 07.10),
    // «Показ» — по «Только фокусные» в строку, но не уже 320 px: имена метрик под отступом группы —
    // целиком и в окне 900–1100 px
    P + '-md3 ' + P + '-mdbd{grid-template-columns:minmax(0,2.5fr) minmax(320px,1fr);}',
    P + '-md3 ' + P + '-mdcf{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0;}',
    P + '-md3 ' + P + '-mdff{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr);}',
    P + '-md3 ' + P + '-mdsc{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:0 20px 16px 0;}',
    P + '-md3 ' + P + '-mdsc+' + P + '-mdsc{padding:0 0 16px 20px;border-left:1px solid ' + C.line2 + ';}',
    P + '-md3 ' + P + '-mdsc>' + P + '-mdg:first-child{margin-top:10px;}',
    // Тянущиеся блоки — flex 1 1 0 с явным минимумом (столько, сколько нужно шапке, поиску, списку от
    // 60–80 px и подвалу): минимум по содержимому дал бы полную высоту списка, а без минимума блок
    // налез бы на соседа. Ниже минимумов прокручивается подколонка.
    P + '-md3 [data-tz="unit"],' + P + '-md3 [data-tz="view"],' + P + '-md3 ' + P + '-zopen{flex:1 1 0;display:flex;flex-direction:column;margin-bottom:0;}',
    P + '-md3 [data-tz="unit"]{min-height:220px;}',
    P + '-md3 [data-tz="view"]{min-height:200px;}',
    P + '-md3 ' + P + '-zopen{min-height:216px;}',
    // дерево юнитов свёрнуто, пока раскрыт выбор HRBP: строка по содержимому, высота — списку HRBP
    P + '-md3 ' + P + '-mdzc{flex:0 0 auto;min-height:0;}',
    P + '-md3 [data-tz="cuts"]{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin-bottom:0;}',
    P + '-md3 ' + P + '-ulist{flex:1 1 0;min-height:72px;max-height:none;}',
    P + '-md3 ' + P + '-zopen ' + P + '-crow' + P + '-open{flex:1 1 0;min-height:212px;}',
    P + '-md3 ' + P + '-zopen ' + P + '-crow' + P + '-open>' + P + '-cra{flex:1 1 0;display:flex;flex-direction:column;min-height:0;}',
    P + '-md3 ' + P + '-zopen ' + P + '-crow' + P + '-open ' + P + '-accb{flex:1 1 0;min-height:0;display:flex;flex-direction:column;}',
    P + '-md3 ' + P + '-zopen ' + P + '-crow' + P + '-open ' + P + '-accb>' + P + '-list{flex:1 1 0;min-height:60px;max-height:none;}',
    // длинный разрез в трёх колонках — выпадающий список поверх разрезов ниже (или выше, если снизу мало
    // места): колонка не растёт и не прокручивается, у списка — вся свободная высота (placeCutPop, БЛОК 6)
    P + '-md3 [data-tz="cuts"] ' + P + '-acc{position:relative;}',
    P + '-md3 [data-tz="cuts"] ' + P + '-accb{position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:6;display:flex;flex-direction:column;padding:8px 8px 6px;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:10px;box-shadow:0 10px 28px rgba(16,24,40,.16);}',
    P + '-md3 [data-tz="cuts"] ' + P + '-accb' + P + '-up{top:auto;bottom:calc(100% + 4px);}',
    P + '-md3 [data-tz="cuts"] ' + P + '-accb>' + P + '-list{flex:1 1 auto;min-height:0;max-height:none;}',
    P + '-md3 [data-mdcol="v"]{display:flex;flex-direction:column;}',
    P + '-md3 ' + P + '-mlist{flex:1 1 0;min-height:80px;overflow-y:auto;}',
    P + '-md3 [data-mdcol="v"]>' + P + '-drn{flex:0 0 auto;margin-top:10px;}',
    P + '-mdct{display:flex;align-items:baseline;gap:8px;font-size:' + F.body + 'px;font-weight:600;color:' + C.ink + ';}',
    P + '-mdct span{font-size:' + F.note + 'px;font-weight:400;color:' + C.muted + ';}',
    P + '-mdg{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.4px;color:' + C.muted + ';font-weight:500;margin:14px 0 8px;}',
    P + '-mdz{margin:0 0 10px;}',
    P + '-mdzh{display:flex;align-items:center;gap:8px;min-height:28px;margin:0 0 6px;}',
    P + '-mdzt{font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';white-space:nowrap;}',
    P + '-mdzv{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:' + F.control + 'px;font-weight:500;color:#2b5fd0;}',
    P + '-mdl ' + P + '-accb ' + P + '-list{max-height:260px;}',
    P + '-ulist{max-height:300px;}',
    P + '-mlist{max-height:none;overflow:visible;}',
    P + '-mg{margin:0 0 10px;}',
    P + '-mg:last-child{margin-bottom:0;}',
    P + '-mgh{font-size:' + F.cap + 'px;font-weight:600;text-transform:uppercase;letter-spacing:.4px;color:' + C.ink + ';}',
    P + '-mgh ' + P + '-optn{text-transform:none;letter-spacing:0;font-weight:400;}',
    P + '-mgl{margin:0 0 0 15px;padding-left:9px;border-left:1px solid ' + C.line + ';}',
    P + '-mopt{padding-top:5px;padding-bottom:5px;}',
    P + '-mdf{flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 20px;border-top:1px solid ' + C.line2 + ';background:' + C.hover + ';}',
    P + '-mdfs{flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:' + F.note + 'px;color:' + C.muted + ';}',
    // узкое окно: что изменено — своей строкой сверху, кнопки — строкой ниже, «Применить» справа
    P + '-md1 ' + P + '-mdfs{order:-1;flex-basis:100%;}',
    P + '-md1 ' + P + '-mdf [data-action="reset"]{margin-right:auto;}',
    P + '-btn' + P + '-sm{height:28px;padding:0 10px;}',
    // разрез до трёх значений — флажки-чипы в строку: 30 в строке 34, как сегмент периода Adoption
    // строка окна: подпись (и «не применено») — над выбором, выбор — во всю ширину колонки: пилюли
    // влезают в одну строку, у HRBP и разделов — место под длинные имена (владелец 07.10)
    P + '-crow{display:flex;flex-direction:column;align-items:stretch;gap:5px;margin:0 0 10px;}',
    P + '-crl{display:flex;align-items:baseline;gap:8px;font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';}',
    P + '-crc{display:flex;flex-wrap:wrap;gap:6px;}',
    P + '-cra{min-width:0;}',
    // пилюля значения: 30 px; отмеченная — фон акцента и галочка; «—» — не указано
    P + '-cchip{display:inline-flex;align-items:center;gap:5px;height:30px;padding:0 11px;border:1px solid ' + C.line + ';border-radius:999px;background:' + C.card + ';font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;}',
    P + '-cchip:hover{border-color:#d3d8e0;}',
    P + '-cchip' + P + '-on{background:' + C.blueBg + ';border-color:#cfdcfb;color:#2b5fd0;}',
    P + '-cchip ' + P + '-optn{margin-left:2px;}',
    P + '-cchip' + P + '-on ' + P + '-optn{color:#5b83dc;}',
    // число окна, равное нулю (в области с набранным выбором таких людей нет) — бледнее
    P + '-zero{color:' + C.muted + ';}',
    P + '-crn{align-self:center;font-size:' + F.note + 'px;color:' + C.muted + ';}',
    // разделы окна (HRBP, разрез с длинным списком): заголовок-кнопка во всю ширину и тело под ним
    P + '-acc>' + P + '-ddb{display:flex;width:100%;max-width:none;}',
    P + '-acc ' + P + '-ddv{flex:1;text-align:left;}',
    P + '-utb{display:flex;width:100%;max-width:none;}',
    P + '-utb ' + P + '-ddv{flex:1;text-align:left;}',
    P + '-utb ' + P + '-ddl{font-size:' + F.note + 'px;}',
    P + '-acc ' + P + '-ddl{font-size:' + F.note + 'px;}',
    P + '-ddn{font-size:' + F.cap + 'px;font-weight:500;color:' + C.act + ';white-space:nowrap;}',
    P + '-accb{padding:8px 2px 4px;}',
    P + '-acch{display:flex;align-items:center;gap:8px;font-size:' + F.note + 'px;color:' + C.muted + ';margin:0 2px 8px;}',
    P + '-acch span:first-child{flex:1;}',
    P + '-ft' + P + '-ftw{display:flex;width:100%;margin:0 0 12px;height:auto;min-height:34px;padding-top:6px;padding-bottom:6px;white-space:normal;}',
    P + '-ftw ' + P + '-ft-tx{flex:1;min-width:0;text-align:left;line-height:1.35;}',
    P + '-drn{margin-top:14px;font-size:' + F.note + 'px;color:' + C.muted + ';line-height:1.45;}',

    // ---- поповеры: разрезы, метрики, выбор юнита ----
    // Поиск — пилюля с лупой 13 px, как поиск каталога Adoption (в поповере 30 px).
    P + '-psearch{position:relative;margin:0 0 8px;color:' + C.muted + ';}',
    P + '-psearch svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;}',
    P + '-srch{display:block;width:100%;height:30px;border:1px solid ' + C.line + ';border-radius:999px;padding:0 12px 0 30px;font-size:' + F.chart + 'px;font-weight:400;color:' + C.ink + ';margin:0;background:' + C.card + ';}',
    P + '-srch:focus{outline:none;border-color:' + C.act + ';}',
    P + '-list{max-height:320px;overflow:auto;margin:0 -4px;padding:0 4px;}',
    P + '-opt{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:' + F.control + 'px;font-weight:400;color:' + C.ink2 + ';}',
    P + '-opt:hover{background:#f4f6f9;color:' + C.ink + ';}',
    P + '-opt input{accent-color:' + C.blue + ';flex:0 0 auto;margin:0;cursor:pointer;}',
    P + '-optn{margin-left:auto;color:' + C.muted + ';font-size:' + F.note + 'px;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    P + '-optt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-popf{display:flex;gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid ' + C.line2 + ';}',
    P + '-popf span{flex:1;font-size:' + F.val + 'px;color:' + C.muted + ';font-weight:400;line-height:1.35;}',
    P + '-nores{padding:14px 8px;color:' + C.muted + ';font-size:' + F.note + 'px;font-weight:400;text-align:center;}',
    // дерево юнитов: строка как пункт выпадашки Adoption (12 px, поля 6/9)
    P + '-tr{display:flex;align-items:center;gap:4px;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:' + F.control + 'px;font-weight:400;color:' + C.ink2 + ';}',
    P + '-tr:hover{background:#f4f6f9;color:' + C.ink + ';}',
    P + '-tr' + P + '-cur{background:' + C.blueBg + ';color:#2b5fd0;font-weight:500;}',
    P + '-tw{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-2px 0;border:0;background:transparent;color:' + C.muted + ';cursor:pointer;border-radius:6px;flex:0 0 auto;font-size:' + F.cap + 'px;line-height:1;padding:0;}',
    P + '-tw:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-tsp{display:inline-block;width:20px;flex:0 0 auto;}',
    P + '-tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-tl{color:' + C.muted + ';font-size:' + F.cap + 'px;font-weight:400;white-space:nowrap;}',
    P + '-hzc{flex:0 1 auto !important;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;letter-spacing:0;font-size:' + F.note + 'px;font-weight:500;color:#2b5fd0;background:' + C.blueBg + ';border-radius:999px;padding:2px 8px;}',
    P + '-hzt{display:inline-block;font-size:' + F.micro + 'px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.blueBg + ';color:#2b5fd0;margin-left:6px;vertical-align:1px;white-space:nowrap;}',
    P + '-tpath{display:block;color:' + C.muted + ';font-size:' + F.cap + 'px;font-weight:400;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-thd{display:block;color:' + C.muted + ';font-size:' + F.cap + 'px;font-weight:400;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-gone{display:inline-block;font-size:' + F.micro + 'px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.surface2 + ';color:' + C.muted + ';margin-left:5px;vertical-align:1px;white-space:nowrap;}',
    // мини-вкладки внутри поповера (tiny: 22 в подложке 26)
    P + '-seg{display:inline-flex;align-items:center;gap:2px;background:' + C.line2 + ';border-radius:9px;padding:2px;}',
    P + '-segb{display:inline-flex;align-items:center;height:22px;border:0;background:transparent;padding:0 8px;border-radius:6px;font-weight:500;font-size:' + F.note + 'px;color:' + C.muted + ';cursor:pointer;text-transform:none;letter-spacing:0;white-space:nowrap;}',
    P + '-segb:hover{color:' + C.ink2 + ';}',
    P + '-segb' + P + '-on{background:' + C.card + ';color:' + C.ink + ';}',

    // ---- кнопки: 34 px, поля 0 12, радиус 9 ----
    P + '-btn{display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;font-size:' + F.control + 'px;white-space:nowrap;}',
    P + '-btn:hover{background:' + C.hover + ';border-color:#d8dce4;}',
    P + '-btn' + P + '-pri{background:' + C.act + ';border-color:' + C.act + ';color:#fff;}',
    P + '-btn' + P + '-pri:hover{background:#1b5cf0;}',
    P + '-btn' + P + '-ghost{border-color:transparent;color:' + C.blue + ';background:transparent;}',
    P + '-btn' + P + '-ghost:hover{background:' + C.blueBg + ';}',
    P + '-popf ' + P + '-btn{height:28px;padding:0 10px;}',
    P + '-btn[disabled]{opacity:.45;cursor:default;}',
    P + '-btn' + P + '-pri[disabled]:hover{background:' + C.act + ';}',
    P + '-lnk{color:' + C.act + ';cursor:pointer;font-weight:500;border:0;background:transparent;padding:0;font-size:inherit;}',
    P + '-lnk:hover{text-decoration:underline;}',

    // ---- уведомления и загрузка ----
    P + '-notes{padding:8px 0 0;}',
    P + '-note{font-size:' + F.note + 'px;color:' + C.ink2 + ';background:' + C.card + ';border:1px dashed ' + C.line + ';border-radius:9px;padding:10px 14px;margin-top:12px;line-height:1.5;}',
    P + '-note b{color:' + C.ink + ';}',
    P + '-note' + P + '-warn{border-style:solid;border-color:#f3d58f;background:#fff8e6;color:' + C.warnTx + ';}',
    P + '-note' + P + '-warn b{color:' + C.warnTx + ';}',
    // Синяя плашка — -ninfo, не -info: -info — значок ⓘ (круг 14 px), он сжимал плашку в точку.
    P + '-note' + P + '-ninfo{border-style:solid;border-color:#dbe6fd;background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-load{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:' + F.note + 'px;font-weight:500;color:' + C.act + ';}',
    P + '-load i{flex:1;height:3px;border-radius:2px;background:linear-gradient(90deg,' + C.act + ',#9dbbff,' + C.act + ');opacity:.7;}',
    P + '-busy ' + P + '-content{opacity:.5;pointer-events:none;transition:opacity .2s;}',

    // ---- контент вкладки: шкала отступов 2…16 ----
    P + '-content{padding:2px 0 16px;min-width:0;}',
    P + '-pageh{margin:0 0 12px;}',
    P + '-lede{margin:0;color:' + C.muted + ';font-size:' + F.note + 'px;line-height:1.9;}',
    P + '-lede b{color:' + C.ink2 + ';}',
    P + '-gap{margin-bottom:12px;}',
    P + '-gap:last-child{margin-bottom:0;}',
    // KPI: сетка gap 10, снизу 12; карточка 12/14; подпись → число 4, число → строка 6
    P + '-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:12px;}',
    P + '-narrow ' + P + '-kpis{grid-template-columns:repeat(2,minmax(0,1fr));}',
    P + '-kpi{background:' + C.card + ';border-radius:12px;box-shadow:' + SH + ';padding:12px 14px;min-width:0;}',
    P + '-kl{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:500;display:flex;align-items:center;gap:6px;white-space:nowrap;}',
    P + '-kl ' + P + '-info{margin-left:0;}',
    P + '-kv{font-size:' + F.hero + 'px;font-weight:600;letter-spacing:-.4px;line-height:1.15;color:' + C.ink + ';margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}',
    // Текстовое значение (имя юнита) — кегль заголовка, но в строку той же высоты: полосы карточек на одной линии.
    P + '-kv' + P + '-sm{font-size:' + F.title + 'px;line-height:' + (F.hero * 1.15).toFixed(1) + 'px;letter-spacing:0;}',
    P + '-kr{display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;min-height:20px;}',
    P + '-ks{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;}',
    P + '-ks b{color:' + C.ink2 + ';}',
    // панель: заголовок 14/16 (14,5 / 600), тело 14/16; у таблиц — без верха и низа
    P + '-panel{background:' + C.card + ';border-radius:12px;box-shadow:' + SH + ';overflow:hidden;min-width:0;}',
    P + '-ph{padding:14px 16px;font-weight:600;font-size:' + F.title + 'px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;color:' + C.ink + ';}',
    P + '-pht{display:flex;flex-direction:column;gap:2px;min-width:0;}',
    P + '-phs{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;}',
    // «Динамика»: длинное имя юнита — одной строкой с «…», кнопки шапки не переносятся под него.
    P + '-dpan ' + P + '-ph{flex-wrap:nowrap;}',
    P + '-dpan ' + P + '-pht{flex:1 1 auto;flex-direction:row;align-items:baseline;gap:8px;}',
    P + '-fit>' + P + '-panel>' + P + '-ph{padding:10px 16px;}',
    P + '-fit>' + P + '-dpan>' + P + '-pb{padding-top:6px;}',
    P + '-dpan ' + P + '-pht>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-dpan ' + P + '-pbtn{flex:0 0 auto;}',
    P + '-pb{padding:14px 16px;}',
    P + '-pb' + P + '-tbl{padding:0 16px 4px;overflow:auto;}',
    // вкладки панели: 28 в подложке 34 (подложка 3, gap 3, радиус 12/9)
    P + '-subs{display:inline-flex;gap:3px;background:' + C.line2 + ';border-radius:12px;padding:3px;flex-wrap:wrap;}',
    P + '-sub{display:inline-flex;align-items:center;gap:6px;height:28px;border:0;background:transparent;padding:0 12px;border-radius:9px;font-weight:500;font-size:' + F.note + 'px;line-height:1;color:' + C.muted + ';cursor:pointer;white-space:nowrap;}',
    P + '-sub:hover{color:' + C.ink2 + ';}',
    P + '-sub' + P + '-on{background:' + C.card + ';color:' + C.ink + ';}',
    P + '-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;}',
    P + '-tools>' + P + '-legend,' + P + '-pbtn>' + P + '-legend{margin:0;}',
    P + '-tools ' + P + '-lh{align-self:center;}',
    P + '-below{color:' + C.muted + ';cursor:help;border-bottom:1px dotted ' + C.muted2 + ';}',
    P + '-ctl{display:flex;flex-direction:column;gap:4px;}',
    P + '-ctll{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.4px;color:' + C.muted + ';font-weight:500;}',
    P + '-dsel{position:relative;display:inline-block;max-width:100%;}',
    P + '-dsel>' + P + '-ddb{min-width:200px;max-width:100%;width:100%;}',
    P + '-dsel ' + P + '-ddv{flex:1;text-align:left;}',
    P + '-dsp{position:fixed;z-index:60;display:flex;flex-direction:column;gap:6px;padding:6px;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:10px;box-shadow:0 10px 28px rgba(16,24,40,.16);min-width:200px;}',
    P + '-dsli{overflow-y:auto;overscroll-behavior:contain;min-height:0;}',
    P + '-dsp ' + P + '-opt' + P + '-on{color:#2b5fd0;background:' + C.blueBg + ';font-weight:500;}',
    P + '-inp{height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-size:' + F.chart + 'px;font-weight:400;color:' + C.ink + ';width:100%;}',
    P + '-inp:focus{outline:none;border-color:' + C.act + ';}',
    P + '-sp2{flex:1;}',

    // ---- таблицы: th 9/8 (капитель 10,5 / 500), td 6/8, строка 44, первая колонка 12 / 500 ----
    P + '-t{width:100%;border-collapse:collapse;font-size:' + F.body + 'px;font-variant-numeric:tabular-nums;}',
    P + '-t' + P + '-fix{table-layout:fixed;}',
    P + '-t th{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.3px;color:' + C.muted + ';font-weight:500;line-height:12px;text-align:right;padding:9px 8px;border-bottom:1px solid ' + C.line + ';white-space:nowrap;position:sticky;top:0;z-index:3;background:' + C.card + ';}',
    P + '-t th' + P + '-l{text-align:left;padding-left:12px;}',
    P + '-t th' + P + '-c{text-align:center;}',
    P + '-hc{display:block;font-size:' + F.micro + 'px;text-transform:none;letter-spacing:0;color:' + C.muted + ';font-weight:400;margin-top:2px;}',
    P + '-t td{text-align:right;padding:6px 8px;height:44px;font-weight:400;color:' + C.ink2 + ';border-bottom:1px solid ' + C.line2 + ';white-space:nowrap;vertical-align:middle;}',
    P + '-t td' + P + '-l{text-align:left;font-weight:500;color:' + C.ink + ';padding-left:12px;white-space:normal;}',
    // Второй и следующие текстовые столбцы — 400 и ink2, даже если это имена (профиль §16.3).
    P + '-t td' + P + '-l:not(:first-child){font-weight:400;color:' + C.ink2 + ';padding-left:8px;}',
    P + '-t td' + P + '-lead{font-weight:500;color:' + C.ink + ';padding-right:10px;}',
    P + '-t td' + P + '-vs,' + P + '-t th' + P + '-vs{border-left:1px solid ' + C.line2 + ';}',
    P + '-t td' + P + '-now{background:#f5f8ff;font-weight:500;color:' + C.ink + ';}',
    P + '-t tr' + P + '-row{cursor:pointer;}',
    P + '-t tr' + P + '-row:hover td{background:' + C.hover + ';}',
    P + '-t tr' + P + '-lv2 td{background:#fcfcfd;}',
    P + '-t tr' + P + '-sel td{background:#f5f8ff;}',
    P + '-t tr' + P + '-sel td:first-child{box-shadow:inset 3px 0 0 ' + C.act + ';}',
    // Итог липнет под шапкой: top = высота строки th (9 + 9 + строка 12; на полпикселя под шапку — без щели).
    P + '-t tr' + P + '-tot td{position:sticky;top:' + CFG.spacing.thH + 'px;z-index:2;border-bottom:2px solid ' + C.line + ';background:' + C.hover + ';font-weight:500;color:' + C.ink + ';}',
    P + '-t tr' + P + '-tot' + P + '-sel td{background:#f5f8ff;}',
    P + '-t tbody tr:last-child td{border-bottom:0;}',
    P + '-t' + P + '-op tbody tr' + P + '-row td{height:66px;}',
    P + '-t tr' + P + '-det td{padding:0 0 16px;background:' + C.hover + ';cursor:default;height:auto;}',
    P + '-t tr' + P + '-det:hover td{background:' + C.hover + ';}',
    P + '-t td' + P + '-spk{padding:8px 16px;text-align:center;}',
    P + '-rl{display:flex;align-items:flex-start;}',
    // Имя юнита — одной строкой с «…»: предел — от ширины панели (--hh-nmw, measureNames),
    // целиком — у выбранной строки и в подсказке. Метки (★ Фокус, +N) не обрезаются.
    P + '-rb{min-width:0;}',
    P + '-tpan ' + P + '-rb{flex:0 1 auto;margin-right:6px;max-width:var(--' + CFG.ns + '-nmw,260px);}',
    P + '-nml{display:flex;align-items:baseline;min-width:0;}',
    P + '-nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-nml>' + P + '-tag,' + P + '-nml>' + P + '-more,' + P + '-nml>' + P + '-gone{flex:0 0 auto;}',
    // «ИТОГО» выбрана по умолчанию и остаётся в одну строку: её имя целиком — в строке над таблицей.
    // Находки поиска (-fnd) — тоже целиком: совпадение не прячется за «…».
    P + '-t' + P + '-wrapok tr' + P + '-sel:not(' + P + '-tot) ' + P + '-nm,' + P + '-t' + P + '-wrapok tr' + P + '-fnd ' + P + '-nm{white-space:normal;overflow:visible;}',
    P + '-ind{display:inline-block;flex:0 0 auto;align-self:stretch;position:relative;}',
    P + '-t tr' + P + '-lv2 ' + P + '-ind::after{content:"";position:absolute;right:7px;top:3px;width:8px;height:8px;border-left:1px solid ' + C.line + ';border-bottom:1px solid ' + C.line + ';border-bottom-left-radius:3px;}',
    P + '-us{display:block;font-size:' + F.cap + 'px;color:' + C.muted + ';font-weight:400;margin-top:2px;}',
    P + '-muted{color:' + C.muted + ';font-weight:400;}',
    // Каретка — отдельная кнопка 28 × 28 с подложкой при наведении: промах не уходит в клик по строке.
    P + '-car{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-6px 4px -6px -6px;border:0;background:transparent;border-radius:7px;color:' + C.muted + ';font-size:' + F.control + 'px;line-height:1;cursor:pointer;flex:0 0 auto;padding:0;}',
    P + '-car:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-car' + P + '-open{color:' + C.act + ';}',
    P + '-cars{display:inline-block;width:26px;flex:0 0 auto;}',
    // «Открыть юнит» — иконка 28 × 28 только у выбранной строки, место под неё (-dsl) есть в каждой
    // строке: иконка всегда у правого края колонки имён, клик по строке её выбирает и никуда не уводит.
    P + '-dsl{display:inline-block;width:28px;height:28px;flex:0 0 auto;}',
    P + '-rl>' + P + '-drill,' + P + '-rl>' + P + '-dsl{margin:-4px -4px -4px auto;align-self:center;}',
    P + '-ib' + P + '-drill{color:' + C.act + ';}',
    P + '-ib' + P + '-drill:hover,' + P + '-ib' + P + '-drill:focus-visible{background:' + C.blueBg + ';color:' + C.actInk + ';outline:none;}',
    // Подсказка о глубине в строке инструментов: 3 уровня, глубже — иконкой.
    P + '-dhint{display:inline-flex;align-items:center;gap:6px;align-self:center;font-size:' + F.note + 'px;color:' + C.muted + ';cursor:help;white-space:nowrap;}',
    P + '-dhint svg{color:' + C.act + ';flex:0 0 auto;}',
    // Путь юнита отчёта и навигация над таблицей.
    P + '-navs{display:inline-flex;gap:6px;margin-right:10px;vertical-align:middle;}',
    P + '-nb{display:inline-flex;align-items:center;height:22px;padding:0 9px;border:1px solid ' + C.line + ';border-radius:999px;background:' + C.card + ';color:' + C.ink2 + ';font-size:' + F.note + 'px;font-weight:500;cursor:pointer;white-space:nowrap;}',
    P + '-nb:hover{border-color:#cfdcfb;color:' + C.act + ';background:' + C.blueBg + ';}',
    P + '-crumbs{display:inline;}',
    // Звено пути — одной строкой с «…» (имя целиком — в подсказке); текущий юнит — целиком.
    P + '-crb{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:bottom;border:0;background:transparent;padding:0;font:inherit;color:' + C.ink2 + ';cursor:pointer;}',
    P + '-crb:hover,' + P + '-crb:focus-visible{color:' + C.act + ';text-decoration:underline;outline:none;}',
    P + '-csep{color:' + C.muted2 + ';margin:0 6px;}',
    P + '-lede ' + P + '-crumbs b{color:' + C.ink + ';font-weight:500;}',
    P + '-ctx ' + P + '-crumbs b{color:' + C.ink + ';font-weight:600;font-size:' + F.title + 'px;}',
    // Поиск по таблице «Команд» в шапке панели; совпадение подсвечено тоном акцента.
    P + '-tsw{position:relative;display:inline-block;width:220px;color:' + C.muted + ';}',
    P + '-tsw svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);pointer-events:none;}',
    P + '-tsw ' + P + '-srch{font-size:' + F.control + 'px;}',
    P + '-narrow ' + P + '-tsw{width:190px;}',
    P + '-hl{background:#dfe8ff;color:' + C.actInk + ';border-radius:3px;padding:0 1px;}',
    P + '-t tr' + P + '-anc td' + P + '-l{color:' + C.muted + ';}',
    // «Остальные» в трансформерах — хвост мелких значений одной строкой, приглушённо.
    P + '-t tr' + P + '-rest td' + P + '-l{color:' + C.muted + ';font-weight:400;}',
    // Сортировка по колонке: стрелка только у активной (профиль Adoption).
    P + '-t th' + P + '-sth{cursor:pointer;user-select:none;}',
    P + '-t th' + P + '-sth:hover{color:' + C.ink2 + ';}',
    P + '-t th' + P + '-son{color:' + C.ink2 + ';}',
    P + '-sa{color:' + C.act + ';margin-left:4px;font-size:' + F.val + 'px;}',

    // ---- пилюля — одна на отчёт: 11,5 / 500, высота 22, поля 0 8, радиус 999 ----
    // Изменение, отклонение от ориентира, значение юнита в «Командах», пилюля в подсказке.
    P + '-pill{display:inline-flex;align-items:center;justify-content:center;height:22px;padding:0 8px;border-radius:999px;font-size:' + F.note + 'px;font-weight:500;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;vertical-align:middle;}',
    P + '-pill' + P + '-good{background:' + C.greenBg + ';color:' + C.greenTx + ';}',
    P + '-pill' + P + '-bad{background:' + C.redBg + ';color:' + C.redTx + ';}',
    P + '-pill' + P + '-warn,' + P + '-pill' + P + '-neutral,' + P + '-pill' + P + '-neu{background:' + C.neutralBg + ';color:' + C.neutralTx + ';}',
    P + '-pill' + P + '-flat{background:' + C.neutralBg + ';color:' + C.muted + ';}',
    P + '-cref{display:block;font-size:' + F.cap + 'px;color:' + C.muted + ';font-weight:400;margin-top:3px;font-variant-numeric:tabular-nums;}',
    // Ориентир: «Цель ≤ 2,0%» / «База 92,0%» одной строкой, под ней пилюля отклонения.
    P + '-tgt{font-size:' + F.body + 'px;color:' + C.ink2 + ';font-weight:500;line-height:1.3;white-space:nowrap;text-align:right;margin-bottom:4px;font-variant-numeric:tabular-nums;}',
    P + '-tgl{color:' + C.muted + ';font-weight:400;font-size:' + F.note + 'px;margin-right:5px;}',
    P + '-same{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;white-space:nowrap;}',
    // Метка строки (флаг): 9 / 500, радиус 4, поля 1/5
    P + '-tag{display:inline-block;font-size:' + F.micro + 'px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.surface2 + ';color:' + C.ink2 + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    P + '-tag' + P + '-own{background:' + C.warnBg + ';color:' + C.warnTx + ';}',
    P + '-more{display:inline-block;font-size:' + F.micro + 'px;font-weight:500;letter-spacing:.3px;padding:0 5px;border-radius:4px;border:1px dashed ' + C.line + ';color:' + C.muted + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    // Без ориентира — словами в пунктирной рамке, а не прочерком (ДС 4.8).
    P + '-nocmp{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px dashed ' + C.line + ';border-radius:999px;font-size:' + F.note + 'px;font-weight:400;color:' + C.muted + ';white-space:nowrap;}',
    // Значок справки ⓘ: 14 px, глиф 9 / 600, рамка muted2
    P + '-info{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid ' + C.muted2 + ';color:' + C.muted + ';font-size:' + F.micro + 'px;font-weight:600;font-style:normal;line-height:1;cursor:help;flex:0 0 auto;margin-left:6px;vertical-align:-2px;user-select:none;}',
    P + '-info:hover{border-color:' + C.act + ';color:' + C.act + ';}',
    // Сигнальный чип: 11 / 500, радиус 999, поля 2/9
    P + '-st{display:inline-block;font-size:' + F.val + 'px;font-weight:500;padding:2px 9px;border-radius:999px;white-space:nowrap;cursor:help;}',
    P + '-st' + P + '-good{background:' + C.greenBg + ';color:' + C.greenTx + ';}',
    P + '-st' + P + '-neutral{background:' + C.surface2 + ';color:' + C.muted + ';}',
    P + '-st' + P + '-wait{background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-fchip{display:inline-block;font-size:' + F.val + 'px;font-weight:500;padding:2px 9px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;margin:1px 4px 1px 0;white-space:nowrap;}',

    // ---- легенда, пусто, сноски ----
    P + '-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:0 0 12px;font-size:' + F.note + 'px;color:' + C.ink2 + ';}',
    P + '-legend' + P + '-r{justify-content:flex-end;text-align:right;}',
    P + '-lh{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;}',
    P + '-sw{display:inline-flex;align-items:center;gap:6px;font-weight:500;cursor:help;}',
    P + '-sw:hover{color:' + C.ink + ';}',
    P + '-dot{width:10px;height:9px;border-radius:3px;display:inline-block;box-shadow:inset 0 0 0 1px rgba(31,31,31,.10);}',
    P + '-dot0{background:#fff;box-shadow:inset 0 0 0 1px ' + C.muted2 + ';}',
    P + '-empty{background:' + C.card + ';border-radius:12px;box-shadow:' + SH + ';padding:28px;text-align:center;color:' + C.muted + ';font-size:' + F.body + 'px;line-height:1.5;}',
    P + '-empty b{display:block;color:' + C.ink + ';font-size:' + F.title + 'px;font-weight:600;margin-bottom:8px;}',
    P + '-tnote{margin-top:8px;font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;line-height:1.5;}',

    // ---- графики (Proteus Adoption, ДС 6): ось 10,5, подписи 11 на белой подложке ----
    P + '-spark{display:block;width:100%;max-width:240px;height:auto;margin:0 auto;overflow:visible;}',
    // Линия спарклайна — акцент текущего периода, как «2026» в «Динамике»; ориентир — пунктир.
    P + '-sline{fill:none;stroke:' + C.cur + ';stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;opacity:.85;}',
    P + '-sref{fill:none;stroke:' + C.prev + ';stroke-width:1;stroke-dasharray:3 3;}',
    // Точки светофора — тон того же сигнала, что у пилюли (тот, что был у столбиков), с белой обводкой.
    P + '-sdot{stroke:#fff;stroke-width:1.2;transform-box:fill-box;transform-origin:center;transition:transform .12s;}',
    // «Лучше» — кольцо, «хуже» — сплошная тёмная точка: различаются формой, не только цветом (дальтонизм, ч/б; ревью 13.10).
    P + '-sdot' + P + '-good{fill:#fff;stroke:' + C.greenTx + ';stroke-width:1.4;}',
    P + '-sdot' + P + '-bad{fill:' + C.redTx + ';stroke:#fff;}',
    P + '-sdot' + P + '-warn,' + P + '-sdot' + P + '-neutral{fill:' + C.neutral + ';}',
    P + '-sdot' + P + '-slast' + P + '-good{fill:#fff;stroke:' + C.greenTx + ';stroke-width:2;}',
    P + '-sdot' + P + '-slast' + P + '-bad{fill:' + C.redTx + ';}',
    P + '-sdot' + P + '-slast' + P + '-warn,' + P + '-sdot' + P + '-slast' + P + '-neutral{fill:' + C.neutralTx + ';}',
    // Прозрачная полоса колонки: попасть в неё легко, между колонками нет щелей (ДС 6.4).
    P + '-hit{fill:' + C.act + ';fill-opacity:0;transition:fill-opacity .12s;}',
    P + '-sbg:hover ' + P + '-hit{fill-opacity:.06;}',
    P + '-sbg:hover ' + P + '-sdot{transform:scale(1.45);}',
    P + '-chart{width:100%;overflow:hidden;}',
    P + '-svg{display:block;overflow:visible;}',
    P + '-ax{font-size:' + F.axis + 'px;fill:' + C.axis + ';font-weight:400;}',
    P + '-axb{fill:' + C.axisStrong + ';font-weight:600;}',
    P + '-axk{font-weight:500;}',
    P + '-vlb{fill:#fff;fill-opacity:.94;}',
    P + '-vl{font-size:' + F.val + 'px;fill:' + C.label + ';font-weight:400;font-variant-numeric:tabular-nums;}',
    P + '-vlc{font-weight:600;fill:' + C.ink + ';}',
    P + '-tfps{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 12px;}',
    P + '-tfps ' + P + '-ctll{margin-right:4px;}',
    P + '-tfp{border:1px solid ' + C.line + ';background:' + C.card + ';color:' + C.ink2 + ';border-radius:999px;padding:5px 11px;font:inherit;font-size:' + F.note + 'px;font-weight:500;cursor:pointer;line-height:1.2;}',
    P + '-tfp:hover{border-color:' + C.muted2 + ';color:' + C.ink + ';}',
    P + '-tfp' + P + '-on{background:' + C.blueBg + ';border-color:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-sm1{color:' + C.ink2 + ';}',
    P + '-hqa{margin:0 0 8px;}',
    P + '-poph{display:inline-flex;align-items:center;gap:6px;font-size:' + F.control + 'px;white-space:nowrap;}',
    P + '-root ' + P + '-popx{color:' + C.muted + ';font-weight:400;font-size:' + F.title + 'px;line-height:1;padding:0 2px;}',
    P + '-mkt{font-size:' + F.dense + 'px;font-weight:600;fill:#fff;font-variant-numeric:tabular-nums;pointer-events:none;}',
    // Раскрытая строка «Сводки» (13.10): график ≈ 64 % слева, справа «Что видно» (номера = точки на графике) и «О метрике».
    P + '-story{display:grid;grid-template-columns:minmax(0,1.8fr) minmax(250px,1fr);padding:14px 0 6px;}',
    P + '-stc{padding:0 20px 0 16px;min-width:0;}',
    P + '-sts{padding:2px 18px 4px 20px;border-left:1px solid ' + C.line + ';min-width:0;white-space:normal;text-align:left;}',
    P + '-narrow ' + P + '-story{grid-template-columns:minmax(0,1fr);padding:12px 12px 0;}',
    P + '-narrow ' + P + '-stc{padding:0 0 12px;}',
    P + '-narrow ' + P + '-sts{border-left:0;border-top:1px solid ' + C.line + ';padding:12px 0 6px;}',
    P + '-sth{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;margin:0 0 8px;}',
    P + '-sta{margin-top:16px;padding-top:14px;border-top:1px solid ' + C.line2 + ';}',
    P + '-stp{margin:0 0 10px;font-size:' + F.body + 'px;line-height:1.45;color:' + C.ink2 + ';font-weight:400;}',
    // формула дробью: числитель над чертой, знаменатель под ней
    P + '-frac{display:inline-flex;flex-direction:column;align-items:center;text-align:center;gap:0;padding:8px 12px;border-radius:8px;background:' + C.surface2 + ';font-size:' + F.note + 'px;line-height:1.35;color:' + C.ink + ';max-width:100%;}',
    P + '-frn{padding:0 4px 4px;}',
    P + '-fracs{margin-top:8px;align-self:flex-start;}',
    P + '-cd{display:block;margin-top:6px;font-size:' + F.note + 'px;line-height:1.45;color:' + C.ink2 + ';}',
    P + '-frd{padding:4px 4px 0;border-top:1.5px solid ' + C.ink2 + ';align-self:stretch;}',
    P + '-frs{margin-top:5px;font-size:' + F.note + 'px;color:' + C.muted + ';}',
    P + '-stu{margin:10px 0 0;padding:0 0 0 16px;font-size:' + F.note + 'px;line-height:1.45;color:' + C.muted + ';}',
    P + '-stu li{margin:0 0 4px;}',
    P + '-ins{list-style:none;margin:0;padding:0;}',
    P + '-ins li{display:flex;align-items:flex-start;gap:9px;margin:0 0 9px;font-size:' + F.body + 'px;line-height:1.45;color:' + C.ink2 + ';font-weight:400;}',
    P + '-ins li b{font-weight:600;color:' + C.ink + ';}',
    P + '-insn{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-top:1px;border-radius:50%;background:' + C.ink + ';color:#fff;font-style:normal;font-size:' + F.dense + 'px;font-weight:600;font-variant-numeric:tabular-nums;}',
    P + '-insp{background:' + C.neutralTx + ';}',
    // Факт ↔ точка (13.10): наведение на факт с номером или на его точку — пара подсвечивается, остальные точки
    // графика бледнеют; линии и подписи не трогаем, текст фактов не гасим. Только при наведении на номерной факт
    // или точку — не на весь график.
    P + '-insn{transition:background-color .15s;}',
    P + '-ins li[data-mk]{padding:3px 6px;margin:0 -6px 3px;border-radius:8px;transition:background-color .15s;}',
    P + '-ins li' + P + '-mkon{background:' + C.blueBg + ';}',
    P + '-ins li' + P + '-mkon ' + P + '-insn{background:' + C.act + ';}',
    P + '-mk{transition:opacity .15s;}',
    // «Трансформеры» (13.10): сверху график и кольцо, ниже хитмап; строка ↔ доля подсвечиваются вместе.
    P + '-trtop{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(300px,1fr);gap:12px;align-items:stretch;}',
    P + '-narrow ' + P + '-trtop{grid-template-columns:minmax(0,1fr);}',
    P + '-trtop>' + P + '-panel{min-width:0;}',
    P + '-piew{display:flex;align-items:center;gap:16px;flex-wrap:wrap;}',
    P + '-pie{flex:0 0 auto;}',
    P + '-pseg{stroke:#fff;stroke-width:2;cursor:pointer;transition:opacity .15s;}',
    P + '-pct{font-size:' + F.title + 'px;font-weight:600;fill:' + C.ink + ';font-variant-numeric:tabular-nums;}',
    P + '-plgs{flex:1 1 140px;min-width:0;display:flex;flex-direction:column;gap:2px;}',
    P + '-plg{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:7px;font-size:' + F.note + 'px;color:' + C.ink2 + ';cursor:default;transition:background-color .15s;}',
    P + '-plg[data-trv]{cursor:pointer;}',
    P + '-plg i{flex:0 0 auto;width:10px;height:10px;border-radius:3px;}',
    P + '-plg b{margin-left:auto;font-weight:500;color:' + C.ink + ';font-variant-numeric:tabular-nums;}',
    P + '-plg ' + P + '-us{min-width:40px;text-align:right;}',
    P + '-trbox[data-trh] ' + P + '-pseg:not(' + P + '-trh){opacity:.35;}',
    P + '-plg' + P + '-trh,' + P + '-plg' + P + '-on{background:' + C.blueBg + ';}',
    P + '-pseg' + P + '-on{stroke:' + C.ink + ';}',
    P + '-heat td{transition:box-shadow .15s;}',
    P + '-heat tr' + P + '-trr{cursor:pointer;}',
    P + '-heat tr' + P + '-trh td{box-shadow:inset 0 1px 0 ' + C.act + ',inset 0 -1px 0 ' + C.act + ';}',
    P + '-heat tr' + P + '-sel td' + P + '-l{box-shadow:inset 3px 0 0 ' + C.act + ';font-weight:500;}',
    P + '-hleg{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 16px 12px;font-size:' + F.note + 'px;color:' + C.muted + ';border-top:1px solid ' + C.line2 + ';}',
    P + '-hleg span{display:inline-flex;align-items:center;gap:6px;}',
    P + '-hleg i{width:14px;height:10px;border-radius:3px;box-shadow:inset 0 0 0 1px ' + C.line + ';}',
    P + '-mkc{transition:fill .15s;}',
    P + '-mkh{fill:' + C.act + ';opacity:0;transition:opacity .15s;pointer-events:none;}',
    P + '-mkg{stroke:' + C.act + ';stroke-width:1.2;stroke-dasharray:2 3;opacity:0;transition:opacity .15s;pointer-events:none;}',
    P + '-story[data-mkon] ' + P + '-mk{opacity:.35;}',
    P + '-story[data-mkon] ' + P + '-mk' + P + '-mkon{opacity:1;}',
    P + '-mk' + P + '-mkon ' + P + '-mkc{fill:' + C.act + ';}',
    P + '-mk' + P + '-mkon ' + P + '-mkh{opacity:.16;}',
    P + '-mk' + P + '-mkon ' + P + '-mkg{opacity:.75;}',
    P + '-insb{flex:0 0 auto;width:18px;height:18px;position:relative;}',
    P + '-insb::after{content:"";position:absolute;left:7px;top:8px;width:5px;height:5px;border-radius:50%;background:' + C.muted2 + ';}',
    P + '-hz{cursor:crosshair;}',
    // Заголовок графика — капитель серым (ПОЛЬЗОВАТЕЛИ ПО ПЕРИОДАМ в Adoption), легенда справа кнопками.
    P + '-chb{min-width:0;}',
    P + '-chh{display:flex;align-items:center;gap:12px;min-height:24px;margin:0 0 4px;flex-wrap:wrap;row-gap:4px;}',
    P + '-cap{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;}',
    P + '-cht{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;}',
    P + '-chl{display:flex;gap:12px;flex-wrap:wrap;font-size:' + F.note + 'px;color:' + C.ink2 + ';font-weight:400;margin-left:auto;}',
    P + '-lgd{display:inline-flex;gap:4px;margin-left:auto;flex-wrap:wrap;}',
    P + '-lg{display:inline-flex;align-items:center;gap:6px;height:22px;border:1px solid ' + C.line2 + ';background:' + C.card + ';border-radius:999px;padding:0 10px 0 8px;font-size:' + F.note + 'px;color:' + C.ink2 + ';cursor:pointer;font-weight:500;white-space:nowrap;}',
    P + '-lgs{cursor:default;}',
    P + '-segb ' + P + '-lgk{margin-right:5px;vertical-align:middle;}',
    P + '-lg:hover{border-color:#d8dce4;background:#fafbfc;}',
    P + '-lg:focus:not(:focus-visible){outline:none;}',
    P + '-lg:focus-visible{border-color:' + C.act + ';}',
    P + '-lgk{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;}',
    P + '-lgk' + P + '-dash{border-top-style:dashed;}',
    // Наведение на пункт легенды гасит чужие серии (ДС 6.4).
    P + '-chb [data-s]{transition:opacity .14s ease-out;}',
    P + '-chb[data-hi] [data-s]{opacity:.16;}',
    P + '-chb[data-hi="cur"] [data-s="cur"],' + P + '-chb[data-hi="prev"] [data-s="prev"],' + P + '-chb[data-hi="ref"] [data-s="ref"]{opacity:1;}',
    // Раскрытая строка «Сводки»: два графика рядом, воздух 16 со всех сторон.
    P + '-t tr' + P + '-opn td{background:#f7f9fd;}',
    // «Команды»: таблица | разделитель 12 | динамика. Доля — стилем сетки (тянется мышью).
    P + '-split{display:grid;gap:0;align-items:start;}',
    P + '-split' + P + '-sp1{grid-template-columns:minmax(0,1fr) 40px;column-gap:12px;}',
    P + '-split' + P + '-sp2c{grid-template-columns:40px minmax(0,1fr);column-gap:12px;}',
    P + '-narrow ' + P + '-split{grid-template-columns:minmax(0,1fr) !important;row-gap:12px;}',
    P + '-narrow ' + P + '-split ' + P + '-pb' + P + '-tbl{max-height:680px;}',
    // Две колонки одной высоты (fitSplit): верх «Динамики» вровень с таблицей, прокрутка — внутри
    // каждой панели, ячейка борда не уезжает. scrollbar-gutter — ширина графиков не прыгает от полосы.
    P + '-split' + P + '-fit{align-items:stretch;}',
    P + '-fit>' + P + '-panel{display:flex;flex-direction:column;min-height:0;}',
    P + '-fit>' + P + '-panel>' + P + '-ph{flex:0 0 auto;}',
    P + '-fit>' + P + '-panel>' + P + '-pb{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;overscroll-behavior:contain;}',
    P + '-fit>' + P + '-dpan>' + P + '-pb{overflow-x:hidden;scrollbar-gutter:stable;}',
    // Таблица едет рядом с графиками при прокрутке — выбранная строка остаётся перед глазами.
    P + '-gut{position:relative;align-self:stretch;cursor:col-resize;display:flex;justify-content:center;outline:none;}',
    P + '-gut i{position:sticky;top:40%;display:block;width:4px;height:44px;margin-top:120px;border-radius:999px;background:' + C.line + ';transition:background .12s,height .12s;}',
    P + '-gut:hover i,' + P + '-gut:focus-visible i,' + P + '-drag ' + P + '-gut i{background:' + C.act + ';height:64px;}',
    P + '-narrow ' + P + '-gut{display:none;}',
    P + '-drag,' + P + '-drag *{cursor:col-resize !important;user-select:none !important;}',
    P + '-rail{display:flex;flex-direction:column;align-items:center;gap:8px;width:40px;min-height:220px;padding:12px 0;border:1px solid ' + C.line + ';border-radius:12px;background:' + C.card + ';color:' + C.muted + ';cursor:pointer;font-size:' + F.note + 'px;font-weight:500;}',
    P + '-rail:hover{color:' + C.act + ';border-color:#cfdcfb;background:' + C.blueBg + ';}',
    P + '-rail span{writing-mode:vertical-rl;transform:rotate(180deg);letter-spacing:.3px;}',
    P + '-rail i{font-style:normal;font-size:' + F.val + 'px;}',
    P + '-ib{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;background:transparent;border-radius:7px;color:' + C.muted + ';cursor:pointer;padding:0;flex:0 0 auto;}',
    P + '-ib:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-ib' + P + '-on{color:' + C.act + ';}',
    P + '-pbtn{display:inline-flex;align-items:center;gap:6px;}',
    // Группы метрик над колонками («Все метрики»): строка 22 над шапкой, линия между группами.
    P + '-t tr' + P + '-thg th{height:' + CFG.spacing.thG + 'px;padding:6px 8px 0;border-bottom:0;text-align:center;color:' + C.muted + ';letter-spacing:.5px;}',
    P + '-t tr' + P + '-thg th' + P + '-l{vertical-align:bottom;text-align:left;padding:0 8px 9px 12px;color:' + C.muted + ';letter-spacing:.3px;border-bottom:1px solid ' + C.line + ';}',
    // Узкая таблица не сжимает имена в столбик — прокручивается внутри панели.
    // Колонка имён не уже, чем при всех именах в одну строку (--hh-ncol, measureNames): выбранная
    // строка, развернув имя, колонку не сужает — остальные колонки при выборе не прыгают.
    P + '-tpan ' + P + '-t td' + P + '-l:first-child,' + P + '-tpan ' + P + '-t th' + P + '-l{min-width:var(--' + CFG.ns + '-ncol,210px);}',
    P + '-t' + P + '-g2 thead tr+tr th{top:' + CFG.spacing.thG + 'px;}',
    P + '-t' + P + '-g2 tr' + P + '-tot td{top:' + (CFG.spacing.thG + CFG.spacing.thH) + 'px;}',
    P + '-t th' + P + '-gs,' + P + '-t td' + P + '-gs{border-left:1px solid ' + C.line2 + ';}',
    // стопка графиков: зазор 26 (chart-gap профиля)
    P + '-dyn{display:flex;flex-direction:column;gap:14px;}',

    // ---- числа людей, маленькие команды ----
    P + '-t td ' + P + '-abs{white-space:normal;line-height:1.25;}',
    P + '-t td' + P + '-sm0{cursor:help;}',
    P + '-snote{font-size:' + F.note + 'px;line-height:1.45;color:' + C.ink2 + ';background:' + C.surface2 + ';border-radius:9px;padding:10px 12px;}',
    P + '-mvn{font-weight:600;color:' + C.ink + ';}',
    // ---- «Что видно в данных» — как Proteus Adoption (pa-area -obs): одна строка 42 px, мягкая заливка
    // по важности (жёлтый здесь разрешён — это не светофор метрики, ДС §3.3), список растёт вниз ----
    P + '-obs{border-radius:12px;background:' + C.card + ';box-shadow:' + SH + ';margin-bottom:12px;min-width:0;}',
    P + '-obs' + P + '-sevh{background:linear-gradient(100deg,#fff0f1 0%,#fdf6f8 45%,#fff 100%);}',
    P + '-obs' + P + '-sevm{background:linear-gradient(100deg,#fff6e6 0%,#fdf9f2 45%,#fff 100%);}',
    P + '-obs' + P + '-sevg{background:linear-gradient(100deg,#eaf8ef 0%,#f5faf7 45%,#fff 100%);}',
    P + '-obs-h{display:flex;align-items:center;gap:10px;height:42px;padding:0 8px 0 14px;min-width:0;}',
    P + '-obs-ico{width:20px;height:20px;border-radius:6px;background:rgba(255,255,255,.8);display:inline-flex;align-items:center;justify-content:center;'
      + 'font-size:' + F.control + 'px;font-weight:600;color:' + C.greenTx + ';flex:0 0 auto;box-shadow:inset 0 0 0 1px rgba(31,31,31,.06);}',
    P + '-sevh ' + P + '-obs-ico{color:' + C.redTx + ';}',
    P + '-sevm ' + P + '-obs-ico{color:' + C.warnTx + ';}',
    P + '-obs-t{font-size:' + F.body + 'px;font-weight:500;color:' + C.ink2 + ';flex:0 0 auto;display:inline-flex;align-items:center;}',
    P + '-obs-h ' + P + '-info{margin-left:-4px;}',
    P + '-obs-lead{font-size:' + F.body + 'px;color:' + C.ink2 + ';flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:help;}',
    P + '-obs-tog{border:0;background:rgba(255,255,255,.75);height:26px;padding:0 10px;border-radius:8px;cursor:pointer;color:' + C.act + ';font:inherit;'
      + 'font-size:' + F.note + 'px;font-weight:500;flex:0 0 auto;margin-left:auto;}',
    P + '-obs-tog:hover{background:#fff;}',
    P + '-obs-list{list-style:none;margin:0;padding:0 14px 12px 44px;display:flex;flex-direction:column;gap:8px;}',
    P + '-obs-li{display:flex;gap:8px;align-items:baseline;font-size:' + F.body + 'px;color:' + C.ink2 + ';line-height:1.45;}',
    P + '-obs-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;transform:translateY(-1px);background:' + C.greenTx + ';cursor:help;}',
    P + '-obs-dot' + P + '-sevh{background:' + C.redTx + ';}',
    P + '-obs-dot' + P + '-sevm{background:' + C.warn + ';}',
    P + '-obs-li b{font-weight:500;color:' + C.ink + ';}',
    P + '-obs-li span{color:' + C.muted + ';}',
    // Команда в факте — ссылка в «Команды»: цвет текста и пунктир (список читается спокойно), синий — при наведении.
    P + '-obs-a{border:0;background:transparent;padding:0;font:inherit;color:' + C.ink2 + ';cursor:pointer;text-decoration:underline dotted ' + C.muted2 + ';text-underline-offset:3px;}',
    P + '-obs-a:hover{color:' + C.act + ';text-decoration-color:' + C.act + ';}',
    P + '-cpok{font-size:' + F.note + 'px;font-weight:500;color:' + C.greenTx + ';white-space:nowrap;margin-right:4px;align-self:center;}',

    // ---- каталог и цели ----
    P + '-cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;align-items:start;}',
    P + '-catp ' + P + '-pb{padding:0;}',
    P + '-clist{list-style:none;margin:0;padding:0;}',
    P + '-clist li{display:flex;flex-direction:column;gap:2px;padding:10px 16px;border-top:1px solid ' + C.line2 + ';}',
    P + '-cn{font-weight:500;font-size:' + F.body + 'px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:' + C.ink + ';}',
    P + '-cn ' + P + '-info{margin-left:0;}',
    P + '-cm{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;line-height:1.4;}',
    P + '-cb{font-size:' + F.val + 'px;font-weight:500;padding:1px 8px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-root ' + P + '-code{display:block;width:100%;min-height:58px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:' + F.control + 'px;line-height:1.5;border:1px solid ' + C.line + ';border-radius:9px;padding:10px 12px;background:' + C.hover + ';color:' + C.ink + ';resize:vertical;white-space:pre-wrap;}',
    P + '-steps{margin:0;padding-left:18px;color:' + C.ink2 + ';font-size:' + F.body + 'px;line-height:1.6;}',
    // Форма KPI (вкладка «KPI»): поля сеткой, юнит / разрезы / комментарий — во всю ширину; ссылка прячется,
    // пока в полях ошибка (style.display: .hidden ненадёжен, RETRO 8 скилла).
    P + '-kform{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:14px;}',
    P + '-kwide{grid-column:1/-1;}',
    P + '-kval{min-height:34px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:' + F.body + 'px;color:' + C.ink + ';}',
    P + '-kval b{font-weight:500;}',
    P + '-kcut{display:flex;flex-direction:column;gap:6px;}',
    P + '-kcuts{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;}',
    P + '-kerr{font-size:' + F.note + 'px;color:' + C.redTx + ';margin:6px 0;}',
    P + '-kerr:empty{display:none;}',
    P + '-know{font-size:' + F.note + 'px;color:' + C.muted + ';}',
    P + '-know:empty{display:none;}',
    P + '-root ' + P + '-code+' + P + '-steps,' + P + '-kerr+' + P + '-code{margin-top:10px;}',
    P + '-steps{margin-top:10px;}',
    P + '-kact{white-space:nowrap;text-align:right;}',
    P + '-root a' + P + '-btn{text-decoration:none;}',
    P + '-khint{margin-top:10px;}',
    P + '-kmsg{font-size:' + F.note + 'px;font-weight:500;color:#2b5fd0;white-space:nowrap;margin-right:4px;align-self:center;}',
    P + '-khint b{font-weight:500;}',
    // Обычный клик по «Открыть форму» — подсказка вспыхивает: куда нажать.
    P + '-khint{transition:box-shadow .3s;}',
    P + '-khint' + P + '-kflash{box-shadow:0 0 0 4px rgba(43,108,255,.35);}',
    P + '-kact ' + P + '-lnk+' + P + '-lnk{margin-left:14px;}',
    P + '-root ' + P + '-kdel{color:' + C.redTx + ';}',

    // ---- тур «Как работать»: кнопка в шапке, слой тура ----
    P + '-help{color:' + C.act + ';}',
    P + '-help:hover{background:' + C.blueBg + ';border-color:#cfdcfb;}',
    // Слой тура живёт В BODY, как тултип: шрифт и position:fixed — явно. Затемнение — четыре
    // шторки вокруг цели (клик мимо цели не проходит), пятая — поверх цели, если она «только смотреть».
    P + '-tour{font-family:' + CFG.fonts.family + ';display:none;}',
    P + '-tour *{box-sizing:border-box;font-family:inherit;}',
    P + '-tb{position:fixed;left:0;top:0;width:0;height:0;z-index:99990;background:rgba(17,24,39,.55);transition:left .2s,top .2s,width .2s,height .2s;}',
    P + '-tb[data-tb="h"]{background:transparent;cursor:default;}',
    P + '-tring{position:fixed;z-index:99991;border-radius:10px;box-shadow:0 0 0 2px ' + C.act + ',0 0 0 6px rgba(43,108,255,.22);pointer-events:none;transition:left .2s,top .2s,width .2s,height .2s;}',
    P + '-tcard{position:fixed;z-index:99992;width:340px;max-width:calc(100vw - 24px);background:' + C.card + ';border-radius:12px;'
      + 'box-shadow:0 18px 50px rgba(15,23,42,.28),0 2px 8px rgba(15,23,42,.12);padding:12px 16px 14px;color:' + C.ink2 + ';font-size:' + F.body + 'px;line-height:1.5;font-weight:400;}',
    P + '-tarr{position:absolute;display:none;width:10px;height:10px;background:' + C.card + ';transform:rotate(45deg);}',
    P + '-tarr' + P + '-ta-bottom{display:block;top:-5px;}',
    P + '-tarr' + P + '-ta-top{display:block;bottom:-5px;}',
    P + '-tarr' + P + '-ta-right{display:block;left:-5px;}',
    P + '-tarr' + P + '-ta-left{display:block;right:-5px;}',
    P + '-tch{display:flex;align-items:center;gap:8px;margin:0 -6px 4px 0;}',
    P + '-tcs{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.4px;color:' + C.muted + ';font-weight:500;}',
    P + '-tx{margin-left:auto;font-size:' + F.control + 'px;}',
    P + '-tct{font-size:' + F.title + 'px;font-weight:600;color:' + C.ink + ';margin:0 0 4px;}',
    P + '-tcx b{font-weight:500;color:' + C.ink + ';}',
    P + '-tul{margin:6px 0 0;padding-left:18px;}',
    P + '-tul li{margin:0 0 6px;}',
    P + '-tpl{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;}',
    P + '-tchint{margin-top:8px;font-size:' + F.note + 'px;color:' + C.act + ';font-weight:500;}',
    P + '-tnx{display:block;margin-top:10px;font-size:' + F.note + 'px;}',
    P + '-tcf{display:flex;justify-content:flex-end;gap:8px;margin-top:12px;}',
    P + '-tcf ' + P + '-btn{height:30px;padding:0 12px;}',
    P + '-tcf ' + P + '-btn:first-child{margin-right:auto;}',
    // Показ «нажми — будет»: курсор едет к цели и «нажимает» (кольцо), затем клик по-настоящему.
    P + '-tcur{position:fixed;z-index:99993;display:none;left:0;top:0;pointer-events:none;transition:left .65s cubic-bezier(.3,.7,.2,1),top .65s cubic-bezier(.3,.7,.2,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.3));}',
    P + '-tclk{position:fixed;z-index:99993;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid ' + C.act + ';pointer-events:none;opacity:0;}',
    '</style>'
  ].join('');
}

// ---- общие элементы (ui.js макета): одна разметка на все вкладки ----
function hEmpty(title, text) {
  var P = CFG.ns;
  return '<div class="' + P + '-empty"><b>' + esc(title) + '</b>' + esc(text) + '</div>';
}
function hPanel(o) {
  var P = CFG.ns;
  return '<div class="' + P + '-panel' + (o.cls ? ' ' + o.cls : '') + '">'
    + '<div class="' + P + '-ph"><div class="' + P + '-pht"><span>' + esc(o.title) + (o.info || '') + '</span>'
    + (o.subHtml ? '<span class="' + P + '-phs">' + o.subHtml + '</span>' : (o.sub ? '<span class="' + P + '-phs">' + esc(o.sub) + '</span>' : '')) + '</div>' + (o.tabs || '') + '</div>'
    + '<div class="' + P + '-pb' + (o.tbl ? ' ' + P + '-tbl' : '') + '">' + o.body + '</div></div>';
}
// Группа переключателей: role=tab + aria-selected + data-action — по ним дым видит группу.
function hSubs(list, active, action) {
  var P = CFG.ns, s = '<div class="' + P + '-subs" role="tablist">';
  for (var i = 0; i < list.length; i++) {
    var on = list[i][0] === active;
    s += '<button class="' + P + '-sub' + (on ? ' ' + P + '-on' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false')
      + '" data-action="' + action + '" data-key="' + esc(list[i][0]) + '">' + esc(list[i][1]) + '</button>';
  }
  return s + '</div>';
}
function hSeg(list, active, action) {
  var P = CFG.ns, s = '<span class="' + P + '-seg" role="tablist">';
  for (var i = 0; i < list.length; i++) {
    var on = list[i][0] === active;
    s += '<button class="' + P + '-segb' + (on ? ' ' + P + '-on' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false')
      + '" data-action="' + action + '" data-key="' + esc(list[i][0]) + '">' + esc(list[i][1]) + '</button>';
  }
  return s + '</span>';
}
function hCaret(open, action, key, label, tipObj) {
  var P = CFG.ns;
  return '<button class="' + P + '-car' + (open ? ' ' + P + '-open' : '') + '" data-action="' + action + '" data-key="' + esc(key) + '"'
    + ' aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + esc(label) + '"' + (tipObj ? tip(tipObj) : '') + '>'
    + (open ? '▾' : '▸') + '</button>';
}
// ⓘ фокусируется с клавиатуры: подсказка показывается и по фокусу (onFocusIn, БЛОК 6).
function hInfo(o) { return '<span class="' + CFG.ns + '-info" tabindex="0" role="note" aria-label="Справка: ' + esc(o && o.title || '') + '"' + tip(o) + '>i</span>'; }
// Поиск в поповере: пилюля с лупой 13 px (как поиск каталога Proteus Adoption).
var SEARCH_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">'
  + '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
function qv(kind) { return String((state.qk && state.qk[kind]) || ''); }
function hSearch(kind, placeholder) {
  var P = CFG.ns;
  return '<div class="' + P + '-psearch">' + SEARCH_SVG + '<input class="' + P + '-srch" type="text" data-psearch="' + esc(kind) + '" placeholder="'
    + esc(placeholder) + '" value="' + esc(qv(kind)) + '"></div>';
}
// Выпадающий список — один на весь отчёт, как разрез в «Фильтрах» (13.10): кнопка -ddb и всплывающая карточка
// со строками -opt (выбранная — фоном, без галочки, как пилюли разрезов); открыт один (state.dsel), закрывают выбор, клик мимо, Esc и прокрутка. Карточка — fixed по
// кнопке (placeDsel): панели режут overflow. Длинный список — с поиском (dsq, фильтр без перерисовки).
function hSel(name, options, value, cls) {
  var P = CFG.ns, open = state.dsel === name, cur = options.length ? options[0][1] : '', i;
  for (i = 0; i < options.length; i++) if (options[i][0] === value) cur = options[i][1];
  var s = '<span class="' + P + '-dsel' + (cls ? ' ' + cls : '') + '" data-dsel="' + esc(name) + '">'
    + '<button type="button" class="' + P + '-ddb' + (open ? ' ' + P + '-on' : '') + '" data-action="dsel" data-key="' + esc(name) + '" aria-haspopup="listbox" aria-expanded="' + (open ? 'true' : 'false') + '">'
    + '<span class="' + P + '-ddv">' + esc(cur) + '</span><span class="' + P + '-ddc" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>';
  if (open) {
    s += '<div class="' + P + '-dsp" role="listbox">' + (options.length > 10 ? '<input class="' + P + '-inp ' + P + '-dsq" type="text" data-dsq="1" placeholder="Поиск">' : '') + '<div class="' + P + '-dsli">';
    for (i = 0; i < options.length; i++) {
      var on = options[i][0] === value;
      s += '<div class="' + P + '-opt' + (on ? ' ' + P + '-on' : '') + '" role="option" tabindex="0" aria-selected="' + (on ? 'true' : 'false') + '" data-action="dselv" data-key="' + esc(name) + '" data-id="' + esc(options[i][0]) + '">'
        + '<span class="' + P + '-optt">' + esc(options[i][1]) + '</span></div>';
    }
    s += '</div></div>';
  }
  return s + '</span>';
}
// Пилюля — ОДНА на отчёт: изменение, отклонение от ориентира, значение в «Командах», пилюля
// в подсказке. Размер у всех один (11,5 / 500, высота 22), различается только цвет.
var PILL_OF = { up: 'good', down: 'bad', flat: 'flat', neu: 'neu' };
function hPill(st, text) { return '<span class="' + CFG.ns + '-pill ' + CFG.ns + '-' + st + '">' + esc(text) + '</span>'; }
// Ячейка изменения: подсказка на всей ячейке — между соседними ячейками тултип не мигает.
function deltaTd(m, d, text, cls, base) {
  var c = cls ? ' class="' + cls + '"' : '';
  if (d === null || d === undefined) return '<td' + c + tip({ title: 'Изменение', text: 'Нет значения за один из периодов.' }) + '>' + hPill('flat', '—') + '</td>';
  return '<td' + c + tip({ title: 'Изменение', text: text, rows: [{ label: 'значение', value: fmtDelta(m, d) }],
                       note: m.better === 'flat' ? 'Нейтральная метрика: цвет не ставится.' : null }) + '>'
    + hPill(base !== undefined && base !== null && d !== 0 && Math.abs(d) <= Math.abs(base) * CFG.deadZone ? 'flat' : (PILL_OF[deltaClass(m, d)] || 'flat'), fmtDelta(m, d)) + '</td>';
}
function dirText(m) { return m.better === 'flat' ? 'больше не значит лучше' : (m.better === 'higher' ? 'выше — лучше' : 'ниже — лучше'); }
function pageHead(title, ledeHtml) {
  var P = CFG.ns;
  return '<div class="' + P + '-pageh" data-title="' + esc(title) + '"><p class="' + P + '-lede">' + ledeHtml + '</p></div>';
}

// ---- разрезы: подписи для чипов, цели и базы ----
function selLabel() {
  var out = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var s = MODEL.sel[CFG.cuts[i].key] || [];
    if (s.length) out.push(CFG.cuts[i].label + ': ' + (s.length > 2 ? s.length + ' знач.' : s.join(', ')));
  }
  return out.length ? out.join('; ') : 'вся юридическая численность';
}
function ruleCuts(r) {
  var out = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var v = r.f[CFG.cuts[i].key];
    if (v && v !== 'all') out.push(CFG.cuts[i].label + ': ' + v);
  }
  return out;
}
function focusTag(m, bl) {
  var P = CFG.ns;
  if (!bl || bl.kind !== 'kpi') return '';
  if (!bl.inherited) {
    return ' <span class="' + P + '-tag ' + P + '-own"' + tip({ title: 'Фокус юнита',
      text: 'Цель поставлена на этот юнит и действует на все его подразделения.',
      rows: [{ label: 'цель', value: fmtVal(m, bl.ref) }, { label: 'правило', value: bl.rule.id }],
      note: ruleCuts(bl.rule).length ? 'Действует при разрезах: ' + ruleCuts(bl.rule).join('; ') : null }) + '>★ Фокус</span>';
  }
  return ' <span class="' + P + '-tag"' + tip({ title: 'Фокус через родителя',
    text: 'Своей цели у юнита нет — действует цель юнита выше.',
    rows: [{ label: 'цель с уровня', value: unitName(MODEL, bl.owner) }, { label: 'цель', value: fmtVal(m, bl.ref) }] }) + '>Фокус через родителя</span>';
}
// Цели, закрытые текущими разрезами: называем поимённо, КАКИЕ разрезы выбрать.
function moreFocus(rules, withMetric) {
  var P = CFG.ns;
  if (!rules || !rules.length) return '';
  var rows = [];
  for (var i = 0; i < rules.length && i < 3; i++) {
    var r = rules[i], m = METRIC[r.metric];
    rows.push({ label: (withMetric && m ? m.short + ' · ' : '') + (ruleCuts(r).join('; ') || 'вся численность'), value: m ? fmtVal(m, r.target) : String(r.target) });
  }
  var notes = ['Цель заработает, когда в «Фильтрах» выбраны эти разрезы.'];
  if (rules.length > 3) notes.unshift('Показаны 3 из ' + rules.length + '.');
  return ' <span class="' + P + '-more"' + tip({ title: 'Ещё ' + rules.length + ' ' + plural(rules.length, 'цель', 'цели', 'целей') + ' по разрезам численности',
    rows: rows, note: notes }) + '>+' + rules.length + ' по разрезам</span>';
}
// Легенда светофора — одна на отчёт, над таблицами и справа, на вертикали цвета.
// short — в строке инструментов «Команд»: без заголовка, подписи короче (целиком — в подсказках).
function legendHTML(right, small, short) {
  var P = CFG.ns, C = CFG.colors;
  var dz = 'Отклонение до 5% от ориентира не считаем значимым. Например, при цели 4,0% серым будет всё от 3,8 до 4,2%.';
  return '<div class="' + P + '-legend' + (right ? ' ' + P + '-r' : '') + '">' + (short ? '' : '<span class="' + P + '-lh">Цвет значения</span>')
    + '<span class="' + P + '-sw"' + tip({ title: 'Лучше ориентира', text: 'Лучше цели или базы больше чем на 5%.' })
    + '><span class="' + P + '-dot" style="background:' + C.green + '"></span> ' + (short ? 'лучше' : 'лучше ориентира') + '</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Хуже ориентира', text: 'Хуже цели или базы больше чем на 5%.', note: '«Лучше» у каждой метрики своё: у текучести — меньше, у закрепляемости — больше.' })
    + '><span class="' + P + '-dot" style="background:' + C.red + '"></span> ' + (short ? 'хуже' : 'хуже ориентира') + '</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'В пределах ±5%', text: dz, note: 'Серые и метрики без оценки — например, численность.' })
    + '><span class="' + P + '-dot" style="background:' + C.neutral + '"></span> ' + (short ? '±5% или без ориентира' : 'в пределах ±5% или без ориентира') + '</span>'
    + (small ? '<span class="' + P + '-sw"' + tip({ title: 'Мало людей',
        text: 'Значение и график есть, цвета нет, если людей меньше порога: ' + smallRule() + '. Один человек сдвигает процент на несколько пунктов.' }) + '><span class="' + P + '-dot ' + P + '-dot0"></span> ' + (short ? 'мало людей' : 'мало людей: без цвета') + '</span>' : '')
    + '</div>';
}
// Ячейка ориентира: подпись и значение одной строкой («Цель ≤ 2,0%», «База 92,0%»), под ней —
// пилюля отклонения. Без ориентира — «не сравнивается» словами, а не прочерком (прочерк
// читается как «не загрузилось»). Подсказка — на всей ячейке.
function cmpTd(m, v, bl) {
  var P = CFG.ns;
  if (bl.kind === 'kpi') {
    var dk = deltaOf(m, v, bl.ref);
    return '<td class="' + P + '-vs"' + tip({ title: 'Сравнение с целью',
        text: 'У метрики есть цель — сравниваем с ней.',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: 'цель', value: fmtVal(m, bl.ref), color: CFG.colors.kpi, dash: true },
               { label: 'отклонение', value: fmtDelta(m, dk) }],
        note: [(bl.inherited ? 'Цель унаследована с уровня «' : 'Цель стоит на юните «') + unitName(MODEL, bl.owner) + '».',
               m.ytd && ytdOn(m) && bl.rule ? 'Годовая цель — ' + fmtVal(m, bl.rule.target) + '; к ' + monthDat(MODEL.L) + ' — ' + ((MODEL.L % 12) + 1) + '/12 от неё.' : null,
               stTxt(bl.state)] }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">Цель ' + (m.better === 'higher' ? '≥' : '≤') + '</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + hPill(bl.state, fmtDelta(m, dk)) + '</td>';
  }
  if (bl.kind === 'bench' && benchSelf()) {
    return '<td class="' + P + '-vs"' + tip({ title: 'Юнит и есть база', text: 'Выбрана вся компания — сравнивать не с чем. Отклонения видны на юнитах ниже.' }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">База</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + '<span class="' + P + '-same">юнит = база</span></td>';
  }
  if (bl.kind === 'bench') {
    var db = deltaOf(m, v, bl.ref);
    return '<td class="' + P + '-vs"' + tip({ title: 'Сравнение с базой',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: benchLabel(), value: fmtVal(m, bl.ref), color: CFG.colors.bench, dash: true },
               { label: 'отклонение', value: fmtDelta(m, db) }],
        note: 'База — вся компания под теми же фильтрами. Отклонение до 5% — серое.' }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">База</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + hPill(bl.state, fmtDelta(m, db)) + '</td>';
  }
  var why = m.better === 'flat' ? 'Больше — не значит лучше, поэтому не оцениваем.' : 'Это размер команды, а не оценка.';
  return '<td class="' + P + '-vs"' + tip({ title: 'Без сравнения', text: why }) + '><span class="' + P + '-nocmp">не сравнивается</span></td>';
}

// ---- юнит отчёта и доступ ----
function inZone(id) {
  var p = pathTo(id);
  for (var i = 0; i < p.length; i++) if (MODEL.roots.indexOf(p[i]) > -1) return true;
  return false;
}
// Юнит отчёта — вся компания: база совпадает с ним, сравнивать не с чем.
function benchSelf() { var u = MODEL.single ? MODEL.units[MODEL.scopeIds[0]] : null; return !!(u && u.lvl === 1); }
function defaultScope() { return sameSet(MODEL.scopeIds, MODEL.roots); }
function zoneHc(ids) {
  var n = 0;
  for (var i = 0; i < ids.length; i++) if (MODEL.units[ids[i]]) n += MODEL.units[ids[i]].hc;
  return n;
}
function outOfZone() {
  var r = [];
  for (var i = 0; i < MODEL.reqUnit.length; i++) if (MODEL.reqUnit[i]) r.push(MODEL.reqUnit[i]);
  return r.length > 0 && !sameSet(r, MODEL.scopeIds);
}
function roleName(r) { return r === 'super' ? 'супер-HRBP' : (r === 'admin' ? 'админ отчёта' : (r === 'hrbp' ? 'HRBP' : 'нет роли')); }

// ---- шапка: вкладки, «Как работать», свежесть, роль ----
// Одна строка-карточка на холсте, как шапка листа Proteus Adoption (ДС §16.5): вкладки — пилюли
// (28 в подложке 34, как группы «Команд»), справа — тур, период и роль. Названия отчёта в шапке
// нет: его показывает заголовок дашборда Proteus над чартом (владелец 07.10: «шапка отличается
// по стилю от общего»); без доступа вкладок нет — тогда в шапке название.
function headHTML() {
  var P = CFG.ns, M = MODEL, ok = M.ok && M.role !== 'none';
  var s = '<div class="' + P + '-head">';
  if (ok) {
    s += '<div class="' + P + '-tabbar ' + P + '-subs" role="tablist" aria-label="Разделы отчёта">';
    var cur = state.view || 'onepager';
    for (var i = 0; i < CFG.tabs.length; i++) {
      var t = CFG.tabs[i], on = t.key === cur;
      var badge = t.key === 'goals' && M.rules.length ? '<span class="' + P + '-cnt">' + M.rules.length + '</span>' : '';
      s += '<button type="button" class="' + P + '-sub' + (on ? ' ' + P + '-on' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '" data-view="' + t.key + '">'
        + esc(t.label) + badge + '</button>';
    }
    s += '</div>';
  } else {
    s += '<span class="' + P + '-logo">' + esc(CFG.text.title) + '<small>метрики команд</small></span>';
  }
  s += '<span class="' + P + '-sp"></span>';
  if (ok) s += filterBtnHTML();
  // Тур «Как работать» — по той вкладке, на которой нажали (ДС §10: справка доступна кнопкой).
  if (ok && M.L >= 12) {
    s += '<button type="button" class="' + P + '-btn ' + P + '-help" data-tact="tour" data-tour="help"'
      + tip({ title: 'Как работать с отчётом', text: 'Короткий тур по этой вкладке.' })
      + '>' + HELP_SVG + 'Как работать</button>';
  }
  if (M.ok && M.L >= 0) {
    s += '<span class="' + P + '-badge"' + tip({ title: 'Период отчёта',
      rows: [{ label: 'данные на', value: M.dataDt ? fmtDay(M.dataDt) : '—' }, { label: 'последний полный месяц', value: monthFull(M.L) }],
      note: 'В отчёт попадают только закончившиеся месяцы: ' + monthFull(M.L + 1 < 24 ? M.L + 1 : M.L) + ' появится, когда закончится.' })
      + '>Период: <b>' + esc(monthFull(M.L)) + '</b></span>';
  }
  if (M.meta) {
    s += '<span class="' + P + '-badge"' + tip({ title: 'Доступ', rows: [{ label: 'логин', value: M.meta.me || '—' }, { label: 'роль', value: roleName(M.role) },
      { label: 'верхних юнитов зоны', value: String(M.roots.length) }], note: 'Зону видимости выдаёт владелец отчёта. Юниты вне зоны в отчёт не попадают.' })
      + '>' + esc(roleName(M.role)) + '</span>';
  }
  return s + '</div>';
}
// ---- строка фильтров: юнит и HRBP (выбор копится до «Применить») ----
// Подпись набора юнитов: вся зона, один юнит, зона HRBP или «N юнитов».
function unitsLabel(ids, hz) {
  var M = MODEL, h = hz ? M.hBy[hz] : null;
  if (h && (sameSet(ids, h.roots) || (!ids.length && sameSet(h.roots, M.roots)))) return 'Вся зона HRBP';
  if (!ids.length || sameSet(ids, M.roots)) return M.role === 'hrbp' ? 'Моя зона' : 'Вся зона';
  if (ids.length === 1) return unitName(M, ids[0]);
  var z = zoneOwner(ids);
  return z ? 'Зона ' + z.nm : ids.length + ' ' + plural(ids.length, 'юнит', 'юнита', 'юнитов');
}
function stagedUnit() { return staged().unit; }
function unitChanged() { return !sameSet(stagedUnit(), reqNow().unit); }
// Строка окна «Фильтры и настройки»: подпись слева (и «не применено» под ней), выбор справа.
// Раздел (HRBP, разрез с длинным списком) — кнопка с выбранным и, если раскрыт, тело под ней:
// раскрыт один (state.open); поиск — свой у списка (qv), список пересобирается точечно.
function rowHTML(id, label, chg, ctl, open) {
  var P = CFG.ns;
  return '<div class="' + P + '-crow' + (open ? ' ' + P + '-open' : '') + '" data-frow="' + esc(id) + '"><span class="' + P + '-crl">' + esc(label)
    + (chg ? '<span class="' + P + '-ddn">не применено</span>' : '') + '</span>' + ctl + '</div>';
}
function rowAccHTML(key, label, value, extra, set, chg, body) {
  var P = CFG.ns, open = state.open === key;
  return rowHTML(key, label, chg, '<div class="' + P + '-cra ' + P + '-acc" data-scope="' + esc(key) + '">'
    + '<button type="button" class="' + P + '-ddb' + (set ? ' ' + P + '-set' : '') + (chg ? ' ' + P + '-chg' : '') + (open ? ' ' + P + '-on' : '')
    + '" data-action="open" data-pop="' + esc(key) + '" aria-expanded="' + (open ? 'true' : 'false') + '" aria-label="' + esc(label) + ': ' + esc(value) + '">'
    + '<span class="' + P + '-ddv">' + esc(value) + '</span>' + (extra ? '<span class="' + P + '-ddl">' + esc(extra) + '</span>' : '')
    + '<span class="' + P + '-ddc" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>'
    + (open ? '<div class="' + P + '-accb">' + body() + '</div>' : '') + '</div>', open);
}
// Заголовок блока окна: что это, что выбрано, «не применено», справа — свои кнопки.
function zoneHead(label, value, chg, right) {
  var P = CFG.ns;
  return '<div class="' + P + '-mdzh"><span class="' + P + '-mdzt">' + esc(label) + '</span>'
    + (value ? '<span class="' + P + '-mdzv">' + esc(value) + '</span>' : '')
    + (chg ? '<span class="' + P + '-ddn">не применено</span>' : '') + '<span class="' + P + '-sp"></span>' + (right || '') + '</div>';
}
// Что за цифры в окне: с распределением — люди последнего закрытого месяца по набранному выбору
// (пересчёт сразу), без него — численность справочника на дату данных.
function fdNote() {
  return MODEL.fdOk ? 'Цифры — сколько людей попадёт в выбор (' + monthLow(MODEL.L) + ').' : 'Цифра справа — численность сейчас.';
}
// Юнит — главный фильтр: дерево зоны с поиском открыто всегда (не раздел-аккордеон). Пока раскрыт
// выбор HRBP, дерево свёрнуто в строку: списку HRBP — вся высота колонки (владелец 07.10: «по HRBP мало
// места»); выбор HRBP сворачивает раздел и раскрывает дерево его зоны.
function unitBlockHTML() {
  var P = CFG.ns, st = staged(), h = stagedHz(), inHz = h && !state.unitAll;
  if (state.open === 'hrbp') {
    return '<div class="' + P + '-mdz ' + P + '-mdzc" data-tz="unit">' + zoneHead('Юнит отчёта', unitsLabel(st.unit, st.hz), unitChanged())
      + '<button type="button" class="' + P + '-ddb ' + P + '-utb" data-action="utree" aria-expanded="false">'
      + '<span class="' + P + '-ddv">Дерево юнитов</span><span class="' + P + '-ddl">свёрнуто, пока открыт выбор HRBP</span>'
      + '<span class="' + P + '-ddc" aria-hidden="true">▾</span></button></div>';
  }
  return '<div class="' + P + '-mdz" data-tz="unit">' + zoneHead('Юнит отчёта', unitsLabel(st.unit, st.hz), unitChanged())
    + (h ? '<div class="' + P + '-acch"><span>' + (inHz ? 'Юниты в зоне HRBP' : 'Вся зона видимости, зона HRBP отмечена') + '</span><span class="' + P + '-hzc">' + esc(h.nm) + '</span></div>' : '')
    + hSearch('unit', inHz ? 'Юнит или логин руководителя в зоне ' + h.nm : 'Юнит или логин руководителя')
    + '<div class="' + P + '-list ' + P + '-ulist" data-plist="unit">' + unitListHTML() + '</div>'
    + '<div class="' + P + '-popf"><span>' + (h
        ? (inHz ? 'Показана только зона HRBP. ' : 'Показана вся зона видимости. ')
          + '<button class="' + P + '-lnk" data-action="unitall">' + (inHz ? 'Вся зона видимости' : 'Только зона HRBP') + '</button>'
        : fdNote()) + '</span></div></div>';
}
function kidsOf(id) {
  var k = (MODEL.kids[id] || []).slice();
  k.sort(function (a, b) {
    var ua = MODEL.units[a], ub = MODEL.units[b];
    if (ua.cur !== ub.cur) return ua.cur ? -1 : 1;
    return ua.nm < ub.nm ? -1 : (ua.nm > ub.nm ? 1 : 0);
  });
  return k;
}
// По умолчанию дерево раскрыто только до 3-го уровня: компания раскрыта, юниты 3-го уровня и ниже —
// свёрнуты; корни зоны HRBP — тоже свёрнуты, на своих верхних уровнях (владелец 07.10: «дерево по
// умолчанию только 3 уровень, ниже не раскрываем»). Раскрытое руками — state.treeOpen.
function treeOpen(id, depth) {
  if (state.treeOpen.hasOwnProperty(id)) return !!state.treeOpen[id];
  var u = MODEL.units[id];
  return !!u && u.lvl < 3;
}
function treeRows(id, depth, cur, out) {
  var P = CFG.ns, u = MODEL.units[id];
  if (!u || out.n > 600) return;
  out.n++;
  // Справочник — вся зона на всю глубину: дети каждого узла уже здесь.
  var kids = kidsOf(id), open = treeOpen(id, depth);
  // Корень компактного дерева зоны HRBP — с путём сверху (где эта зона в компании);
  // во всей зоне видимости корни зоны выбранного HRBP помечены.
  var path = '';
  if (out.withPath && depth === 0) {
    var ch = pathTo(id), nm = [];
    for (var c = Math.max(0, ch.length - 4); c < ch.length - 1; c++) nm.push(unitName(MODEL, ch[c]));
    if (nm.length) path = '<span class="' + P + '-tpath">' + esc(nm.join(' › ')) + '</span>';
  }
  var mark = out.hzRoots && out.hzRoots.indexOf(id) > -1 ? '<span class="' + P + '-hzt">зона HRBP</span>' : '';
  out.s += '<div class="' + P + '-tr' + (id === cur ? ' ' + P + '-cur' : '') + (mark ? ' ' + P + '-hzr' : '') + '" data-action="pick" data-id="' + esc(id) + '" tabindex="0" role="option" aria-selected="' + (id === cur ? 'true' : 'false') + '" style="padding-left:' + (9 + depth * 16) + 'px">'
    + (kids.length ? '<button class="' + P + '-tw" data-action="tree" data-id="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="' + P + '-tsp"></span>')
    + '<span class="' + P + '-tn">' + esc(u.nm) + (u.cur ? '' : '<span class="' + P + '-gone">нет в структуре</span>') + mark + path + headLine(u, '') + '</span>'
    + '<span class="' + P + '-tl">' + esc(levelShort(u.lvl)) + '</span>' + cntHTML('th', unitN(id)) + '</div>';
  if (!open) return;
  for (var i = 0; i < kids.length; i++) treeRows(kids[i], depth + 1, cur, out);
}
// Логин руководителя под именем юнита (13.10); q — найденная подстрока, подсвечивается.
function headLine(u, q) {
  var P = CFG.ns;
  if (!u.head) return '';
  var at = q ? u.lh.indexOf(q) : -1;
  var t = at < 0 ? esc(u.head) : esc(u.head.slice(0, at)) + '<mark class="' + P + '-hl">' + esc(u.head.slice(at, at + q.length)) + '</mark>' + esc(u.head.slice(at + q.length));
  return '<span class="' + P + '-thd" title="Руководитель юнита">' + t + '</span>';
}
// Юнит внутри зоны HRBP (на пути юнита есть один из её корней).
function inHzZone(id, h) { return !h || idsInside([id], h.roots); }
function unitListHTML() {
  var P = CFG.ns, M = MODEL, q = qv('unit').replace(/^\s+|\s+$/g, '').toLowerCase();
  var ids = stagedUnit(), cur = ids.length === 1 ? ids[0] : '', h = stagedHz(), inHz = h && !state.unitAll;
  if (!q) {
    // Выбран HRBP — компактное дерево его зоны (как видит её сам HRBP); иначе — вся зона видимости.
    var top = inHz ? h.roots : M.roots;
    var all = inHz ? (sameSet(ids, h.roots) || (!ids.length && sameSet(h.roots, M.roots))) : (!ids.length || sameSet(ids, M.roots));
    var s = '<div class="' + P + '-tr' + (all ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="" tabindex="0" role="option" aria-selected="' + (all ? 'true' : 'false') + '">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + (inHz ? 'Вся зона HRBP' : (M.role === 'hrbp' ? 'Вся моя зона' : 'Вся зона видимости')) + '</span>'
      + '<span class="' + P + '-tl">' + top.length + ' ' + plural(top.length, 'корень', 'корня', 'корней') + '</span>'
      + cntHTML('th', zoneN(top)) + '</div>';
    var out = { s: '', n: 0, withPath: inHz, hzRoots: h && !inHz ? h.roots : null };
    var roots = top.slice().sort(function (a, b) { return unitName(M, a) < unitName(M, b) ? -1 : 1; });
    for (var i = 0; i < roots.length; i++) treeRows(roots[i], 0, cur, out);
    return s + out.s;
  }
  var hits = [];
  for (var id in M.units) {
    if (!M.units.hasOwnProperty(id)) continue;
    // ищет и по названию, и по логину руководителя (13.10)
    var u = M.units[id], at = u.lc.indexOf(q), ah = u.lh ? u.lh.indexOf(q) : -1;
    if ((at < 0 && ah < 0) || !inZone(id) || (inHz && !inHzZone(id, h))) continue;
    hits.push({ id: id, u: u, byHead: at < 0, rank: (at === 0 || (at < 0 && ah === 0) ? 0 : 1) * 100 + u.lvl });
  }
  // Справочник — вся зона логина на всю глубину: поиск идёт здесь же, без запроса.
  var r = '';
  if (!hits.length) return '<div class="' + P + '-nores">Ничего не найдено</div>';
  hits.sort(function (a, b) { return a.rank - b.rank || (a.u.nm < b.u.nm ? -1 : 1); });
  for (var k = 0; k < hits.length && k < 80; k++) {
    var h = hits[k], chain = pathTo(h.id), names = [];
    for (var c = Math.max(0, chain.length - 4); c < chain.length - 1; c++) names.push(unitName(M, chain[c]));
    r += '<div class="' + P + '-tr' + (h.id === cur ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="' + esc(h.id) + '" tabindex="0" role="option" aria-selected="' + (h.id === cur ? 'true' : 'false') + '">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + esc(h.u.nm) + (h.u.cur ? '' : '<span class="' + P + '-gone">нет в структуре</span>')
      + '<span class="' + P + '-tpath">' + esc(names.join(' › ') || levelLabel(h.u.lvl)) + '</span>' + headLine(h.u, h.byHead ? q : '') + '</span>'
      + '<span class="' + P + '-tl">' + esc(levelShort(h.u.lvl)) + '</span>' + cntHTML('th', unitN(h.id)) + '</div>';
  }
  if (hits.length > 80) r += '<div class="' + P + '-nores">Показаны 80 из ' + hits.length + ' — уточните запрос</div>';
  return r;
}
// ---- HRBP: дерево «кто под кем» (по вложенности зон) с поиском ----
function hrbpVisible() { var M = MODEL; return M.hrbps.length > 1 || (M.hrbps.length === 1 && M.role !== 'hrbp'); }
function hrbpOpen(login, depth) {
  if (state.hOpen.hasOwnProperty(login)) return !!state.hOpen[login];
  // По умолчанию раскрыт верх небольшого дерева и путь до выбранного HRBP.
  var h = stagedHz(), up = h ? h.parent : '';
  while (up) { if (up === login) return true; up = MODEL.hBy[up] ? MODEL.hBy[up].parent : ''; }
  return depth === 0 && MODEL.hrbps.length <= 40;
}
function hrbpRootsText(h) {
  var names = [];
  for (var i = 0; i < h.roots.length && i < 2; i++) names.push(unitName(MODEL, h.roots[i]));
  return names.join(', ') + (h.roots.length > 2 ? ' +' + (h.roots.length - 2) : '');
}
function hrbpRow(h, depth, cur, withPath) {
  var P = CFG.ns, M = MODEL, kids = M.hKids[h.login] || [], open = hrbpOpen(h.login, depth), chain = [], up = h.parent;
  while (up && M.hBy[up] && chain.length < 6) { chain.unshift(M.hBy[up].nm); up = M.hBy[up].parent; }
  return '<div class="' + P + '-tr' + (h.login === cur ? ' ' + P + '-cur' : '') + '" data-action="hpick" data-id="' + esc(h.login) + '" tabindex="0" role="option" aria-selected="' + (h.login === cur ? 'true' : 'false') + '"'
    + (withPath ? '' : ' style="padding-left:' + (9 + depth * 16) + 'px"') + '>'
    + (!withPath && kids.length ? '<button class="' + P + '-tw" data-action="htree" data-id="' + esc(h.login) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="' + P + '-tsp"></span>')
    + '<span class="' + P + '-tn">' + esc(h.nm) + (h.login === (M.meta && M.meta.me) ? ' · я' : '')
    + '<span class="' + P + '-tpath">' + esc(withPath && chain.length ? chain.join(' › ') : hrbpRootsText(h)) + '</span></span>'
    + (kids.length ? '<span class="' + P + '-tl">' + kids.length + ' ' + plural(kids.length, 'HRBP', 'HRBP', 'HRBP') + ' ниже</span>' : '')
    + cntHTML('th', MODEL.fdOk ? zoneN(h.roots) : h.hc) + '</div>';
}
function hrbpTreeRows(login, depth, cur, out) {
  var h = MODEL.hBy[login];
  if (!h || out.n > 600) return;
  out.n++;
  out.s += hrbpRow(h, depth, cur, false);
  if (!hrbpOpen(login, depth)) return;
  var kids = MODEL.hKids[login] || [];
  for (var i = 0; i < kids.length; i++) hrbpTreeRows(kids[i], depth + 1, cur, out);
}
function hrbpListHTML() {
  var P = CFG.ns, M = MODEL, q = qv('hrbp').replace(/^\s+|\s+$/g, '').toLowerCase();
  var owner = stagedHz(), cur = owner ? owner.login : '';
  if (!M.hrbps.length) return '<div class="' + P + '-nores">Других зон внутри вашей нет</div>';
  if (!q) {
    var out = { s: '', n: 0 };
    for (var i = 0; i < M.hTop.length; i++) hrbpTreeRows(M.hTop[i], 0, cur, out);
    return '<div class="' + P + '-tr' + (!cur ? ' ' + P + '-cur' : '') + '" data-action="hpick" data-id="" tabindex="0" role="option" aria-selected="' + (!cur ? 'true' : 'false') + '">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">Все HRBP<span class="' + P + '-tpath">без выбора — ' + (M.role === 'hrbp' ? 'вся моя зона' : 'вся зона видимости') + '</span></span>'
      + cntHTML('th', zoneN(M.roots)) + '</div>' + out.s;
  }
  var hits = [];
  for (var j = 0; j < M.hrbps.length; j++) {
    var h = M.hrbps[j], hay = (h.nm + ' ' + h.login + ' ' + hrbpRootsText(h)).toLowerCase(), at = hay.indexOf(q);
    if (at > -1) hits.push({ h: h, rank: at === 0 ? 0 : 1 });
  }
  if (!hits.length) return '<div class="' + P + '-nores">Ничего не найдено</div>';
  hits.sort(function (a, b) { return a.rank - b.rank || (a.h.nm < b.h.nm ? -1 : 1); });
  var s = '';
  for (var k = 0; k < hits.length && k < 80; k++) s += hrbpRow(hits[k].h, 0, cur, true);
  return s;
}
function hrbpBodyHTML() {
  var P = CFG.ns;
  return hSearch('hrbp', 'Поиск HRBP: фамилия, логин или юнит')
    + '<div class="' + P + '-list" data-plist="hrbp">' + hrbpListHTML() + '</div>'
    + '<div class="' + P + '-popf"><span>Вложенность — чья зона внутри чьей. Цифра справа — люди в зоне.</span></div>';
}
function hrbpBlockHTML() {
  var owner = stagedHz(), chg = (owner ? owner.login : '') !== hzNow(), n = MODEL.hrbps.length;
  return '<div class="' + CFG.ns + '-mdz' + (state.open === 'hrbp' ? ' ' + CFG.ns + '-zopen' : '') + '" data-tz="hrbp">' + rowAccHTML('hrbp', 'HRBP', owner ? owner.nm : 'Все HRBP', n + ' ' + plural(n, 'зона', 'зоны', 'зон'), !!owner, chg, hrbpBodyHTML) + '</div>';
}

// ---- разрезы, метрики, окно «Фильтры и настройки», строка применённого ----
// Значения разреза: численность при ОСТАЛЬНЫХ разрезах в области — по НАБРАННОМУ выбору, сразу
// (fdCalc: юнит, HRBP и другие разрезы окна пересчитывают числа без «Применить»), + набранные
// значения, которых в области нет (n = 0: их видно и можно снять). zone = true — все значения
// зоны (пилюли: состав и порядок не прыгают при наборе); иначе — те, что есть в области. Порядок —
// смысловой (CFG.order), иначе по людям: пилюли — в зоне, список — в области без разрезов.
// Без распределения (старый датасет) — фасеты ответа, т. е. по применённому выбору.
function cutValues(key, zone) {
  var c = fdCalc(), k = FD_KEYS.indexOf(key), out = [], seen = {}, i;
  if (c && k > -1) {
    var d = MODEL.fdv[key], from = zone ? MODEL.fdZone[k] : c.pres[k];
    for (i in from) if (from.hasOwnProperty(i)) {
      out.push({ v: d[i], n: c.fac[k][i] || 0, o: zone ? (MODEL.fdZoneN[k][i] || 0) : (c.marg[k][i] || 0) });
      seen[d[i]] = 1;
    }
  } else {
    var f = MODEL.facets[key] || [];
    for (i = 0; i < f.length; i++) { out.push({ v: f[i].v, n: f[i].n, o: f[i].n }); seen[f[i].v] = 1; }
  }
  var sel = (c ? staged().cuts[key] : MODEL.sel[key]) || [];
  for (var j = 0; j < sel.length; j++) if (!seen[sel[j]]) out.push({ v: sel[j], n: 0, o: -1 });
  var ord = CFG.order[key];
  out.sort(function (a, b) {
    if (ord) {
      var ia = ord.indexOf(a.v), ib = ord.indexOf(b.v);
      if (ia > -1 || ib > -1) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    }
    return b.o - a.o || (a.v < b.v ? -1 : 1);
  });
  return out;
}
// Число в окне: ноль — бледнее (в области с набранным выбором таких людей нет).
function cntHTML(cls, n) { return '<span class="' + CFG.ns + '-' + cls + (n ? '' : ' ' + CFG.ns + '-zero') + '">' + fmtInt(n) + '</span>'; }
// Разрез с длинным списком — раздел с поиском (поиск — от 8 значений).
function cutBodyHTML(cut) {
  var P = CFG.ns, vals = cutValues(cut.key), d = staged().cuts[cut.key] || [], kind = 'cut:' + cut.key;
  return (vals.length > 7 ? hSearch(kind, 'Поиск значения') : '')
    + '<div class="' + P + '-list" data-plist="' + esc(kind) + '">' + cutListHTML(cut) + '</div>'
    + '<div class="' + P + '-popf"><span>' + (d.length ? 'выбрано: ' + d.length : 'все значения') + '</span>'
    + '<button class="' + P + '-btn ' + P + '-ghost" data-action="cutnone" data-key="' + cut.key + '">Очистить</button></div>';
}
function cutListHTML(cut) {
  var P = CFG.ns, vals = cutValues(cut.key), q = qv('cut:' + cut.key).replace(/^\s+|\s+$/g, '').toLowerCase();
  var d = staged().cuts[cut.key] || [];
  var s = '', n = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i].v;
    if (q && cutName(v).toLowerCase().indexOf(q) < 0) continue;
    n++;
    s += '<label class="' + P + '-opt"><input type="checkbox" data-cutkey="' + cut.key + '" data-cutval="' + esc(v) + '"' + (d.indexOf(v) > -1 ? ' checked' : '') + '>'
      + '<span class="' + P + '-optt">' + esc(cutName(v)) + '</span>' + cntHTML('optn', vals[i].n) + '</label>';
  }
  if (!vals.length) return '<div class="' + P + '-nores">В выбранном юните при этих разрезах значений нет</div>';
  return n ? s : '<div class="' + P + '-nores">Ничего не найдено</div>';
}
// Пустое значение разреза («не указано»): в пилюлях — прочерком, смысл — в подсказке (владелец 07.10).
function isNoVal(v) { return v === '' || v === '-' || v === '·' || v == null || String(v).replace(/^\s+|\s+$/g, '').toLowerCase() === 'не указано'; }
// Разрез до CFG.modal.inline значений без «не указано» (покраска, IT / nonIT, штат / не штат…) —
// пилюли в строку: «Все» — без фильтра, значения отмечаются по одному (можно несколько; отмеченное —
// фоном, без галочки: она удлиняла пилюлю и переносила ряд, владелец 07.10), «не указано» — «—» в
// конце. Цифра — численность по набранному выбору.
function cutChipsHTML(cut, vals) {
  var P = CFG.ns, d = staged().cuts[cut.key] || [], chg = !sameSet(d, MODEL.sel[cut.key] || []), list = [], none = [];
  for (var k = 0; k < vals.length; k++) (isNoVal(vals[k].v) ? none : list).push(vals[k]);
  list = list.concat(none);
  var s = '<span class="' + P + '-crc" role="group" aria-label="' + esc(cut.label) + '">'
    + '<button type="button" class="' + P + '-cchip' + (d.length ? '' : ' ' + P + '-on') + '" data-action="cutnone" data-key="' + cut.key + '" aria-pressed="' + (d.length ? 'false' : 'true') + '">Все</button>';
  for (var i = 0; i < list.length; i++) {
    var v = list[i].v, on = d.indexOf(v) > -1, nv = isNoVal(v);
    s += '<button type="button" class="' + P + '-cchip' + (on ? ' ' + P + '-on' : '') + '" data-action="cutv" data-key="' + cut.key + '" data-val="' + esc(v) + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
      + (nv ? ' aria-label="не указано"' + tip({ title: cut.label, text: 'Не указано: ' + fmtInt(list[i].n) + ' чел.' }) : '') + '>'
      + esc(nv ? '—' : cutName(v)) + cntHTML('optn', list[i].n) + '</button>';
  }
  if (!vals.length) s += '<span class="' + P + '-crn">в выбранном юните значений нет</span>';
  return rowHTML(cut.key, cut.label, chg, s + '</span>');
}
function cutRowHTML(cut) {
  var zv = cutValues(cut.key, true), real = 0;
  for (var i = 0; i < zv.length; i++) if (!isNoVal(zv[i].v)) real++;
  if (real <= CFG.modal.inline) return cutChipsHTML(cut, zv);
  var vals = cutValues(cut.key);
  var sel = staged().cuts[cut.key] || [], chg = !sameSet(sel, MODEL.sel[cut.key] || []);
  var val = !sel.length ? 'Все' : (sel.length === 1 ? cutName(sel[0]) : cutName(sel[0]) + ' +' + (sel.length - 1));
  return rowAccHTML('cut:' + cut.key, cut.label, val, vals.length + ' ' + plural(vals.length, 'значение', 'значения', 'значений'), sel.length > 0, chg, function () { return cutBodyHTML(cut); });
}
// Метрики — по группам «Сводки»: категория — заголовок прописными с флажком группы (снять / вернуть
// всю группу) и счётчиком, метрики — под ней с отступом и линией (владелец 07.10: «не понятно, где
// категория, а где метрика»); поиск — когда метрик больше CFG.modal.msearch. Флажки — набранный
// показ (stagedView), не применённый.
function metricListHTML() {
  var P = CFG.ns, sv = stagedView(), q = qv('metric').replace(/^\s+|\s+$/g, '').toLowerCase(), s = '';
  for (var b = 0; b < CFG.blocks.length; b++) {
    var bl = CFG.blocks[b], all = 0, on = 0, rows = '', hitB = !q || bl.name.toLowerCase().indexOf(q) > -1;
    for (var i = 0; i < CFG.metrics.length; i++) {
      var m = CFG.metrics[i];
      if (m.block !== bl.key) continue;
      all++;
      if (!sv.off[m.key]) on++;
      if (!hitB && (m.name + ' ' + (m.short || '')).toLowerCase().indexOf(q) < 0) continue;
      rows += '<label class="' + P + '-opt ' + P + '-mopt"' + tip({ title: m.name, text: m.hint || '' }) + '><input type="checkbox" data-metric="' + m.key + '"' + (sv.off[m.key] ? '' : ' checked') + '>'
        + '<span class="' + P + '-optt">' + esc(m.name) + '</span></label>';
    }
    if (!rows) continue;
    s += '<div class="' + P + '-mg"><label class="' + P + '-opt ' + P + '-mgh"><input type="checkbox" data-mgroup="' + bl.key + '"' + (on === all ? ' checked' : '') + (on > 0 && on < all ? ' data-ind="1"' : '') + '>'
      + '<span class="' + P + '-optt">' + esc(bl.name) + '</span><span class="' + P + '-optn">' + on + ' из ' + all + '</span></label>'
      + '<div class="' + P + '-mgl">' + rows + '</div></div>';
  }
  return s || '<div class="' + P + '-nores">Ничего не найдено</div>';
}
function viewZoneHTML() {
  var P = CFG.ns, sv = stagedView(), fo = !!sv.focus, on = 0, all = CFG.metrics.length;
  for (var i = 0; i < all; i++) if (!sv.off[CFG.metrics[i].key]) on++;
  return '<div class="' + P + '-mdz" data-tz="view">'
    + '<button type="button" class="' + P + '-ft ' + P + '-ftw' + (fo ? ' ' + P + '-on' : '') + '" data-action="focus" aria-pressed="' + (fo ? 'true' : 'false') + '">'
    + '<span class="' + P + '-ft-tr"><span class="' + P + '-ft-kn"></span></span><span class="' + P + '-ft-tx">Только фокусные — метрики и юниты с целью</span></button>'
    + zoneHead('Метрики', on + ' из ' + all, false,
        '<button class="' + P + '-btn ' + P + '-ghost ' + P + '-sm" data-action="mall"' + (on === all ? ' disabled' : '') + '>Все</button>'
        + '<button class="' + P + '-btn ' + P + '-ghost ' + P + '-sm" data-action="mnone"' + (on ? '' : ' disabled') + '>Снять все</button>')
    + (all > CFG.modal.msearch ? hSearch('metric', 'Поиск метрики') : '')
    + '<div class="' + P + '-list ' + P + '-mlist" data-plist="metric">' + metricListHTML() + '</div></div>';
}
// Что ждёт «Применить» — словами для подвала окна.
function pendingList() {
  var out = [];
  if (state.stage) {
    var a = reqNow(), b = staged();
    if (hzNow() !== b.hz) out.push('HRBP');
    if (!sameSet(a.unit, b.unit)) out.push('юнит');
    for (var i = 0; i < CFG.cuts.length; i++) if (!sameSet(a.cuts[CFG.cuts[i].key] || [], b.cuts[CFG.cuts[i].key] || [])) out.push(CFG.cuts[i].label);
  }
  if (viewDiff()) out.push('показ метрик');
  return out;
}
var FILTER_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 5h18M6 12h12M10 19h4"/></svg>';
var CLOSE_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
// Окно «Фильтры и настройки» по центру (модалка Proteus Adoption, ДС §4.11): слева «Фильтры» —
// пересчитывают отчёт (1 · чья зона и юнит, 2 · разрезы), справа «Показ» — без пересчёта
// (3 · что показывать). Всё набранное уходит одной «Применить» в подвале: подвал не прокручивается,
// кнопка видна при любом раскрытом разделе и на маленьком экране. Габариты — placeDrawer (БЛОК 6).
function filtersModalHTML() {
  var P = CFG.ns, n = pendingN(), busy = !!state.pend, pl = pendingList(), s = '';
  s += '<div class="' + P + '-mdb" data-action="dclose"></div>'
    + '<div class="' + P + '-mdl' + (state.mdm === 1 ? ' ' + P + '-md1' : (state.mdm === 3 ? ' ' + P + '-md3' : '')) + '" role="dialog" aria-modal="true" aria-label="Фильтры и настройки" tabindex="-1" data-drawer="1">'
    + '<div class="' + P + '-mdh"><div class="' + P + '-mdhx"><span class="' + P + '-mdt">Фильтры и настройки</span>'
    + '<span class="' + P + '-mdd">Изменения применятся кнопкой «Применить» внизу.</span></div>'
    + '<button type="button" class="' + P + '-ib" data-action="dclose" aria-label="Закрыть окно">' + CLOSE_SVG + '</button></div>'
    + '<div class="' + P + '-mdbd" data-mdbody="1">'
    + '<div class="' + P + '-mdc ' + P + '-mdcf" data-mdcol="f"><div class="' + P + '-mdct">Фильтры<span>пересчитывают отчёт</span></div>'
    + '<div class="' + P + '-mdff"><div class="' + P + '-mdsc" data-mdsub="z">'
    + '<div class="' + P + '-mdg">1 · Чья зона и юнит</div>' + (hrbpVisible() ? hrbpBlockHTML() : '') + unitBlockHTML() + '</div>'
    + '<div class="' + P + '-mdsc" data-mdsub="c"><div class="' + P + '-mdg">2 · Разрезы численности</div><div class="' + P + '-mdz" data-tz="cuts">';
  for (var i = 0; i < CFG.cuts.length; i++) s += cutRowHTML(CFG.cuts[i]);
  s += '</div></div></div></div>'
    + '<div class="' + P + '-mdc" data-mdcol="v"><div class="' + P + '-mdct">Показ<span>без пересчёта данных</span></div>'
    + '<div class="' + P + '-mdg">3 · Что показывать</div>' + viewZoneHTML()
    + '<div class="' + P + '-drn">' + (benchSelfAll() ? 'База сравнения — вся компания.' : 'База сравнения — вся компания под теми же разрезами: ' + esc(benchLabel()) + '.') + '</div>'
    + '</div></div>'
    + '<div class="' + P + '-mdf">'
    + '<button class="' + P + '-btn ' + P + '-ghost" data-action="reset">Сбросить всё</button>'
    + '<span class="' + P + '-mdfs"' + (pl.length > 1 ? tip({ title: 'Не применено', text: pl.join(', ') }) : '') + '>' + esc(pl.length ? 'Не применено: ' + pl.join(', ') : 'Изменений нет') + '</span>'
    + '<button class="' + P + '-btn" data-action="' + (n ? 'unstage' : 'dclose') + '">' + (n ? 'Отменить' : 'Закрыть') + '</button>'
    + '<button class="' + P + '-btn ' + P + '-pri" data-action="apply"' + (n && !busy ? '' : ' disabled') + '>'
    + (busy && state.stage ? 'Применяю…' : 'Применить' + (n ? ' · ' + n : '')) + '</button>'
    + '</div></div>';
  return s;
}
// Применённое сейчас (не по умолчанию) — чипами над отчётом; × снимает сразу.
function filterChips() {
  var M = MODEL, out = [], hz = hzNow(), h = hz ? M.hBy[hz] : null;
  if (h) out.push({ key: 'hz', label: 'HRBP', value: h.nm, list: [] });
  if (!defaultScope() && !(h && sameSet(M.scopeIds, h.roots))) out.push({ key: 'unit', label: 'Юнит', value: unitsLabel(M.scopeIds, hz), list: [] });
  for (var i = 0; i < CFG.cuts.length; i++) {
    var c = CFG.cuts[i], sel = M.sel[c.key] || [], names = [];
    for (var j = 0; j < sel.length; j++) names.push(cutName(sel[j]));
    if (sel.length) out.push({ key: 'cut:' + c.key, label: c.label, value: names.length === 1 ? names[0] : names[0] + ' +' + (names.length - 1), list: names });
  }
  var on = selMetrics('').length;
  if (on < CFG.metrics.length) out.push({ key: 'metrics', label: 'Метрики', value: on + ' из ' + CFG.metrics.length, list: [] });
  if (state.focusOnly) out.push({ key: 'focus', label: '', value: 'Только фокусные', list: [] });
  return out;
}
// Кнопка «Фильтры» — в шапке справа, рядом с «Как работать» (владелец 12.10: «как настроить свой дашборд»).
function filterBtnHTML() {
  var P = CFG.ns, n = filterChips().length, on = !!state.drawer;
  return '<button type="button" class="' + P + '-fbtn' + (on ? ' ' + P + '-on' : '') + '" data-action="drawer" aria-haspopup="true" aria-expanded="' + (on ? 'true' : 'false') + '"'
    + tip({ title: 'Фильтры и настройки', text: 'Юнит, HRBP, разрезы и метрики.' })
    + '>' + FILTER_SVG + 'Фильтры' + (n ? '<span class="' + P + '-cnt">' + n + '</span>' : '') + '</button>';
}
// Строка контекста под шапкой — вместо заголовка вкладки (владелец 12.10): путь юнита, применённые
// фильтры чипами, справа база. Вместе с шапкой прилипает к верху при прокрутке (-stick).
function filterBarHTML() {
  var P = CFG.ns, chips = filterChips(), n = pendingN(), on = !!state.drawer, v = state.view || 'onepager';
  var s = '<div class="' + P + '-fbar"><span class="' + P + '-ctx">' + crumbsHTML() + (v === 'onepager' ? sumInfo() : '') + '</span>';
  for (var i = 0; i < chips.length; i++) {
    var c = chips[i];
    s += '<span class="' + P + '-chip"' + (c.list.length > 1 ? tip({ title: c.label, text: c.list.join(', ') }) : '') + '>'
      + (c.label ? '<span class="' + P + '-ddl">' + esc(c.label) + ':</span>' : '') + '<span class="' + P + '-ddv">' + esc(c.value) + '</span>'
      + '<span class="' + P + '-x" role="button" tabindex="0" aria-label="Снять фильтр «' + esc(c.label || c.value) + '»" data-action="chipx" data-key="' + esc(c.key) + '">×</span></span>';
  }
  // Набрано в окне, но не применено (окно закрыли) — напоминание с той же «Применить». Набранное уже
  // ушло запросом и ждёт ответа — не «не применено»: идёт строка «Обновляю данные…» (бой отвечает
  // долго, и плашка с серой «Применить» выглядела как непринятый фильтр).
  var inflight = !!(state.pend && state.stage && !viewDiff() && sigOf(staged()) === state.pend.sig);
  if (n && !on && !inflight) {
    s += '<span class="' + P + '-unap">Выбрано, не применено: ' + n
      + '<button class="' + P + '-btn ' + P + '-pri" data-action="apply"' + (state.pend ? ' disabled' : '') + '>Применить</button>'
      + '<button class="' + P + '-btn ' + P + '-ghost" data-action="unstage">Отменить</button></span>';
  }
  if (chips.length > 1) s += '<button class="' + P + '-lnk" data-action="reset">Сбросить всё</button>';
  s += '<span class="' + P + '-sp"></span>' + (state.view === 'onepager' || !state.view ? popHintBtn() : '');
  s += '<span class="' + P + '-bench"' + tip({ title: 'База сравнения',
    text: 'Вся компания под теми же разрезами. С ней сравниваем метрики, у которых нет цели.' }) + '>База: <b>' + esc(benchLabel()) + '</b></span>';
  return s + '</div>';
}
// Сколько ждём ответ: «12 с» (секундомер — БЛОК 6, раз в секунду), только про текущий запрос.
function pendText() {
  if (!state.pend) return '';
  var sec = Math.floor((Date.now() - state.pend.at) / 1000);
  return sec >= 2 ? sec + ' с' : '';
}
function noticesHTML() {
  var P = CFG.ns, M = MODEL, s = '';
  if (state.pend) s += '<div class="' + P + '-load"><span>' + esc(CFG.text.loading) + ' <span data-pendt="1">' + esc(pendText()) + '</span></span><i></i></div>';
  if (state.warn) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(state.warn.replace('{s}', String(Math.round(CFG.pendingWarnMs / 1000)))) + '</div>';
  if (outOfZone()) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(CFG.text.outOfZone) + '</div>';
  if (M.cut) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(CFG.text.truncated.replace('{n}', fmtInt(M.rows))) + '</div>';
  return s ? '<div class="' + P + '-notes">' + s + '</div>' : '';
}

// ---- графики: спецификации линий и блок с заголовком ----
// Графики последней сборки: плейсхолдер [data-ci] + функция рисования от ширины.
// Смена ширины ячейки перерисовывает ТОЛЬКО их (repaint в БЛОКЕ 6), без render().
// Реестр графиков экрана: relayout перерисует их по месту, БЛОК 6 — анимирует и ведёт
// следящий тултип (hz — колонки линии). key — устойчивое имя графика: с анимацией график
// рисуется, когда впервые показан с этими данными (раскрыли строку, выбрали команду, пришёл
// ответ), а не на каждый клик и не при ресайзе (ДС 6.5).
var CHARTS = [], CLIP_N = 0;
function dataSig() { return MODEL.__dsig || (MODEL.__dsig = sigOf(reqEcho()) + '|' + rawData.length + '|' + MODEL.L); }
function canAnim() {
  if (typeof Element === 'undefined' || !Element.prototype.animate) return false;
  return !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function chartSlot(kind, key, draw) {
  if (state.drawnSig !== dataSig()) { state.drawn = {}; state.drawnSig = dataSig(); }
  var ci = CHARTS.length, anim = !!key && !state.drawn[key] && canAnim();
  if (key) state.drawn[key] = true;
  CHARTS.push({ kind: kind, key: key, draw: draw, anim: anim, hz: null });
  return '<div class="' + CFG.ns + '-chart" data-cw="' + kind + '" data-ci="' + ci + '">' + draw(cwOf(kind), { ci: ci, anim: anim }) + '</div>';
}
function cwOf(kind) {
  var d = { half: 460, side: 480, wide: 960, story: 620 };
  return Math.max(260, state.cw[kind] || d[kind] || 480);
}
// Ориентир графика: цель, если она действует на последнем слоте; иначе база.
function refKind(unitId, m, g, i) {
  var s = MODEL.cal[g][i];
  if (resolveKpi(unitId, m.key, s ? s.e : '')) return 'kpi';
  return comparable(m) ? 'bench' : '';
}
function yoySpec(unitId, ser, m) {
  var M = MODEL, L = M.L, cur = [], prev = [], labels = [], heads = [], ref = null, ytd = ytdOn(m);
  var val = ytd ? function (s, i) { return ytdVal(s, m, i); } : function (s, i) { return mval(s, 'm', m, i); };
  for (var k = 0; k < 12; k++) {
    cur.push(12 + k <= L ? val(ser, 12 + k) : null);
    prev.push(val(ser, k));
    labels.push(MONTH_ABBR[dparts(M.cal.m[12 + k] ? M.cal.m[12 + k].s : '').m]);
    heads.push(monthFull(12 + k) + ' · к ' + monthDat(k));
  }
  var rk = refKind(unitId, m, 'm', L);
  if (rk === 'kpi') {
    ref = targetSeries(unitId, m.key, 'm').slice(12, 24);
    // годовая цель на нарастающем итоге — доля года: к марту — 3/12 цели
    if (ytd) for (var t = 0; t < 12; t++) ref[t] = ref[t] === null ? null : ref[t] * (t + 1) / 12;
  } else if (rk === 'bench') { ref = []; for (var b = 0; b < 12; b++) ref.push(12 + b <= L ? val(M.base, 12 + b) : null); }
  var y = dparts(M.cal.m[L].s).y;
  return { m: m, nocol: NOCOL, ytd: ytd, cum: isCum(m), labels: labels, cur: cur, prev: prev, ref: ref, refKind: rk, boldIdx: L - 12, heads: heads, prevHeads: null,
           curName: String(y), prevName: String(y - 1), refName: rk === 'kpi' ? 'цель' : 'база · ' + benchLabel(),
           tips: { cur: ytd ? y + ' год, с начала года: значение копится с января.' : y + ' год по месяцам.',
                   prev: (y - 1) + ' год — те же месяцы.',
                   ref: rk === 'kpi' ? 'Цель юнита на каждый месяц.' : 'Вся компания под теми же фильтрами.' } };
}
// Заголовок графика — капитель серым (как «ПОЛЬЗОВАТЕЛИ ПО ПЕРИОДАМ» в Proteus Adoption),
// справа легенда-кнопки: клик выключает линию на всех графиках, наведение подсвечивает её.
// Две линии на графике (HRBP 13.10, Дьяченко): этот год и выбранная вторая — прошлый год или ориентир. Справа —
// переключатель «2025 | база» (у метрик без ориентира — только прошлый год, без переключателя).
function cmpRef(spec) { return !!spec.ref && state.cmp === 'ref'; }
function chartBlock(kind, key, title, spec, H) {
  var P = CFG.ns, C = CFG.colors, useRef = cmpRef(spec);
  var refL = spec.refKind === 'kpi' ? 'цель' : 'база', refC = spec.refKind === 'kpi' ? C.kpi : C.bench;
  var cur = '<span class="' + P + '-lg ' + P + '-lgs"' + tip({ title: spec.curName, text: spec.tips ? spec.tips.cur : '' }) + '>'
    + '<i class="' + P + '-lgk" style="border-top-color:' + C.cur + '"></i>' + esc(spec.curName) + '</span>';
  var sw = '';
  if (spec.noPrev) sw = '';
  else if (spec.ref) {
    var opts = [['prev', spec.prevName, C.prev, false], ['ref', refL, refC, true]];
    sw = '<span class="' + P + '-seg" role="group" aria-label="С чем сравнить">';
    for (var i = 0; i < opts.length; i++) {
      var on = (opts[i][0] === 'ref') === useRef;
      sw += '<button type="button" class="' + P + '-segb' + (on ? ' ' + P + '-on' : '') + '" data-action="cmp" data-key="' + opts[i][0] + '" aria-pressed="' + (on ? 'true' : 'false') + '"'
        + tip({ title: 'Сравнить с: ' + opts[i][1], text: spec.tips ? spec.tips[opts[i][0]] : '', note: 'Действует на все графики отчёта.' }) + '>'
        + '<i class="' + P + '-lgk' + (opts[i][3] ? ' ' + P + '-dash' : '') + '" style="border-top-color:' + opts[i][2] + '"></i>' + esc(opts[i][1]) + '</button>';
    }
    sw += '</span>';
  } else {
    sw = '<span class="' + P + '-lg ' + P + '-lgs"' + tip({ title: spec.prevName, text: spec.tips ? spec.tips.prev : '' }) + '>'
      + '<i class="' + P + '-lgk" style="border-top-color:' + C.prev + '"></i>' + esc(spec.prevName) + '</span>';
  }
  // H < 0 — высота по панели «Динамики» (state.dynH, fitDyn в БЛОКЕ 6): две метрики целиком на любом экране.
  return '<div class="' + P + '-chb" data-chb="1"><div class="' + P + '-chh"><span class="' + P + '-cap">' + esc(title) + '</span>'
    + '<span class="' + P + '-lgd" role="group" aria-label="Линии графика">' + cur + sw + '</span></div>'
    + chartSlot(kind, key, function (w, ctx) { return svgLine(spec, w, H < 0 ? (state.dynH || CFG.chart.hSmall) : H, ctx); }) + '</div>';
}
// Спарклайн строки: 12 закрытых месяцев, цвет — оценка каждого месяца.
function sparkHTML(unitId, ser, m) {
  var L = MODEL.L, vals = [], idx = [], tips = [], refs = [];
  for (var i = L - 11; i <= L; i++) { idx.push(i); vals.push(mval(ser, 'm', m, i)); }
  var states = statesOver(unitId, ser, 'm', m, idx);
  for (var k = 0; k < idx.length; k++) {
    var v = vals[k], b = v === null ? { kind: 'none', ref: null } : baseline(unitId, m, v, 'm', idx[k]);
    refs.push(b.ref === null || b.ref === undefined ? null : b.ref);
    var rows = [{ label: 'факт', value: fmtVal(m, v) }].concat(v === null ? [] : absRows(m, ser, idx[k]));
    if (b.ref !== null && b.ref !== undefined) {
      rows.push({ label: b.kind === 'kpi' ? 'цель' : 'база', value: fmtVal(m, b.ref), dash: true, color: b.kind === 'kpi' ? CFG.colors.kpi : CFG.colors.bench });
      rows.push({ label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, b.ref)) });
    }
    tips.push({ title: monthFull(idx[k]), rows: rows, note: b.ref === null || b.ref === undefined ? 'Без ориентира — без цвета.' : stTxt(states[k] || 'neutral') });
  }
  return svgSpark(vals, states, tips, refs);
}

// ---- вкладка «Сводка» ----
function kpiCard(o) {
  var P = CFG.ns;
  return '<div class="' + P + '-kpi"><div class="' + P + '-kl">' + esc(o.label) + (o.q || '') + '</div>'
    + '<div class="' + P + '-kv' + (o.small ? ' ' + P + '-sm' : '') + '">' + esc(o.value) + '</div>'
    + '<div class="' + P + '-kr">' + (o.row1 || '') + '</div><div class="' + P + '-kr">' + (o.row2 || '') + '</div></div>';
}
function kpiCardsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, u = scopeUnit(), day = M.cal.m[L] ? M.cal.m[L].e : '';
  var hc = M.scope.m.hc ? M.scope.m.hc[L] : null;
  var hire = M.scope.m.hire ? M.scope.m.hire[L] : 0, fire = M.scope.m.fire ? M.scope.m.fire[L] : 0;
  var nC = 0;
  for (var i = 0; i < M.c.length; i++) if (M.c[i].id !== '·') nC++;
  var own = [];
  for (var r = 0; r < M.rules.length; r++) {
    var ru = M.rules[r];
    if (M.single ? ru.unit === M.scopeIds[0] : (ru.unit !== u && inScope(ru.unit))) own.push(ru);
  }
  var live = 0;
  for (var o = 0; o < own.length; o++) if (ruleMatches(own[o]) && ruleActive(own[o], day)) live++;
  var inh = 0, from = [];
  var mets = selMetrics('');
  for (var k = 0; k < mets.length; k++) {
    var b = baseline(u, mets[k], mval(M.scope, 'm', mets[k], L), 'm', L);
    if (b.kind === 'kpi' && (b.inherited || !M.single)) { inh++; var nm = unitName(M, b.owner); if (from.indexOf(nm) < 0) from.push(nm); }
  }
  var lvl = M.single && M.units[M.scopeIds[0]] ? levelLabel(M.units[M.scopeIds[0]].lvl) : 'зона: ' + M.scopeIds.length + ' ' + plural(M.scopeIds.length, 'юнит', 'юнита', 'юнитов');
  var mv = moveOf(M.scope);
  return '<div class="' + P + '-kpis">'
    + kpiCard({ label: 'Юнит отчёта', value: scopeLabel(), small: true,
        q: hInfo({ title: 'Юнит отчёта', text: 'Выбирается в «Фильтрах». Все метрики отчёта — по нему и его подразделениям.' }),
        row1: '<span class="' + P + '-ks">' + esc(lvl) + '</span>',
        row2: '<span class="' + P + '-ks">' + nC + ' ' + plural(nC, 'подразделение', 'подразделения', 'подразделений') + (M.single ? ' уровнем ниже' : ' в корнях зоны') + '</span>' })
    + kpiCard({ label: 'Сотрудников', value: fmtInt(hc), q: hInfo(moveTip(mv, hire, fire)),
        row1: '<span class="' + P + '-ks">на ' + esc(fmtDay(day)) + '</span>'
          + (mv ? '<span class="' + P + '-ks">с начала года <b class="' + P + '-mvn">' + esc(signed(mv.to - mv.from)) + '</b></span>' : ''),
        row2: mv ? '<span class="' + P + '-ks">найм ' + fmtInt(mv.hire) + ' · уходы ' + fmtInt(mv.fire) + ' · переводы ' + esc(signed(mv.other)) + '</span>'
          : '<span class="' + P + '-ks">разрез: ' + esc(selLabel()) + '</span>' })
    + kpiCard({ label: M.single ? 'Целей на юните' : 'Целей внутри зоны', value: String(own.length),
        q: hInfo({ title: 'Свои цели', text: 'Цели, поставленные на этот юнит. Цель с разрезом работает, когда этот разрез выбран в «Фильтрах».' }),
        row1: live ? '<span class="' + P + '-tag ' + P + '-own">' + live + ' в фокусе сейчас</span>' : '<span class="' + P + '-ks">' + (own.length ? 'ни одна не подходит под разрезы' : 'своих целей нет') + '</span>',
        row2: '<button type="button" class="' + P + '-lnk" data-view="goals">задать во вкладке «KPI»</button>' })
    + kpiCard({ label: 'Наследуемых целей', value: String(inh),
        q: hInfo({ title: 'Наследуемые цели', text: 'Цели юнитов выше: они действуют, пока у юнита нет своей.' }),
        row1: inh ? '<span class="' + P + '-tag">Фокус через родителя</span>' : '<span class="' + P + '-ks">—</span>',
        row2: '<span class="' + P + '-ks">' + esc(from.length ? (from.length === 1 ? 'с уровня «' + from[0] + '»' : 'с уровней: ' + from.slice(0, 2).join(', ') + (from.length > 2 ? ' и ещё ' + (from.length - 2) : '')) : 'наследовать не от кого') + '</span>' })
    + '</div>';
}
function inScope(id) {
  var p = pathTo(id);
  for (var i = 0; i < p.length; i++) if (MODEL.scopeIds.indexOf(p[i]) > -1) return true;
  return false;
}
// ---- движение численности за 12 месяцев: было → найм, увольнения, переводы → стало ----
// hire / fire — найм в компанию и увольнения из неё (поток слота); остаток — переводы между
// подразделениями, смена разреза (покраски, штата…) и правки структуры.
function signed(x) { return x > 0 ? '+' + fmtInt(x) : (x < 0 ? fmtInt(x) : '0'); }
// Прирост — от численности на конец прошлого года (HRBP 13.10, Дьяченко): декабрь прошлого года → последний месяц;
// найм и увольнения — с января. При «Активной» найм — приход в активную (датасет подменяет hire).
function moveOf(ser) {
  var L = MODEL.L, a = ser && ser.m;
  if (!a || !a.hc || L < 12) return null;
  var from = a.hc[11] || 0, to = a.hc[L] || 0, hire = 0, fire = 0, months = [];
  for (var i = 12; i <= L; i++) {
    var h = a.hire ? (a.hire[i] || 0) : 0, f = a.fire ? (a.fire[i] || 0) : 0;
    hire += h; fire += f; months.push({ i: i, h: h, f: f });
  }
  return { from: from, to: to, hire: hire, fire: fire, other: to - from - hire + fire, months: months };
}
function moveTip(mv, hire, fire) {
  var t = { title: 'Численность и движение', text: 'Сколько людей на конец месяца и что изменило численность с начала года.' };
  if (!mv) { t.rows = [{ label: 'найм за месяц', value: '+' + fmtInt(hire) }, { label: 'уходы за месяц', value: MINUS + fmtInt(fire) }]; return t; }
  var day0 = MODEL.cal.m[11] ? MODEL.cal.m[11].e : '';
  var act = !!MODEL.meta && MODEL.meta.ret_base === 'active';
  t.rows = [{ label: 'было' + (day0 ? ' на ' + fmtDay(day0) : ''), value: fmtInt(mv.from) }, { label: act ? 'приход в активную (найм и переводы)' : 'найм в компанию', value: '+' + fmtInt(mv.hire) },
    { label: 'уходы из компании', value: MINUS + fmtInt(mv.fire) }, { label: 'переводы и прочее', value: signed(mv.other) },
    { label: 'стало', value: fmtInt(mv.to) }];
  for (var k = Math.max(0, mv.months.length - 6); k < mv.months.length; k++) {
    var x = mv.months[k];
    t.rows.push({ label: monthLabel(x.i), value: '+' + fmtInt(x.h) + ' / ' + MINUS + fmtInt(x.f), dim: true });
  }
  t.note = ['«Переводы и прочее» — переходы между подразделениями, смена покраски или штата, изменения структуры.', 'По месяцам: найм / уходы.'];
  return t;
}

// ---- «Что видно в данных» (как Proteus Adoption, ДС §4.10): пороговый отбор фактов ----
// Факт — то, что прошло порог CFG.obs, а не текстовый шаблон: метрика юнита хуже (лучше) цели
// или базы на dev и больше — в людях сверх ориентира (excessPeople); «больше половины — в одной
// команде» (conc); команды хуже своего ориентира (от teamMin человек сверх); ухудшение trend месяцев
// подряд; всплеск уходов; незаполненные причины; численность ±hc за год. По одному факту на метрику,
// порядок — важность (high · mid · good), затем люди. Команды — три загруженных уровня «Команд» от
// CFG.small.min человек; юнит меньше порога закрепляемость и текучесть не оценивает.
function rowPpfx(r) { return r.key.slice(r.key.indexOf(':') + 1, r.key.lastIndexOf(':')); }
// d лежит внутри a («Напрямую в …» — внутри своего узла).
function rowUnder(d, a) {
  if (a.id === '·' || !a.pfx) return false;
  if (d.id !== '·') return d.pfx.indexOf(a.pfx + '/') === 0;
  var dp = rowPpfx(d);
  return dp === a.pfx || dp.indexOf(a.pfx + '/') === 0;
}
// Ориентир факта: у метрик структуры (и при «Только фокусные») — только цель; база для них — масштаб.
function obsBase(unitId, m, v) {
  if (v === null || v === undefined) return null;
  var bl = baseline(unitId, m, v, 'm', MODEL.L);
  if (bl.kind === 'none' || ((state.focusOnly || !smallGate(m)) && bl.kind !== 'kpi')) return null;
  return bl;
}
function relDev(v, ref) { return ref ? Math.abs(v - ref) / Math.abs(ref) : (v ? 1 : 0); }
function refWord(bl) { return bl.kind === 'kpi' ? 'цели' : 'базы'; }
// Имя команды в тексте: «Напрямую в «…»» уже в кавычках.
function qName(r) { return r.id === '·' ? rowName(r) : '«' + rowName(r) + '»'; }
// Текст факта — сегменты: строка или команда {r, mk} (в списке — ссылка в «Команды», в подсказке — имя).
function segsHTML(segs) {
  var P = CFG.ns, s = '';
  for (var i = 0; i < segs.length; i++) {
    var g = segs[i];
    if (typeof g === 'string') { s += esc(g); continue; }
    s += '<button type="button" class="' + P + '-obs-a" data-action="goteam" data-key="' + esc(g.r.key) + '" data-id="' + esc(g.mk || '') + '"'
      + tip({ title: rowName(g.r), text: 'Показать в «Командах».' }) + '>' + esc(g.t || qName(g.r)) + '</button>';
  }
  return s;
}
function segsText(segs) {
  var s = '';
  for (var i = 0; i < segs.length; i++) s += typeof segs[i] === 'string' ? segs[i] : (segs[i].t ? '' : qName(segs[i].r));
  return s;
}
// Команды хуже своего ориентира — от teamMin человек сверх; проблема, которая «сидит» в
// подразделении (не меньше conc «лишних» людей родителя), показана у подразделения.
function badTeams(m, teams) {
  var L = MODEL.L, O = CFG.obs, all = [], out = [];
  for (var i = 0; i < teams.length; i++) {
    var t = teams[i], v = mval(t.ser, 'm', m, L), bl = obsBase(rowUnit(t), m, v);
    if (!bl || bl.state !== 'bad') continue;
    var ex = excessPeople(m, t.ser, L, bl.ref);
    if (ex >= O.teamMin) all.push({ r: t, v: v, bl: bl, ex: ex });
  }
  for (var a = 0; a < all.length; a++) {
    var inner = false;
    for (var b = 0; b < all.length && !inner; b++) if (a !== b && rowUnder(all[b].r, all[a].r) && all[b].ex >= O.conc * all[a].ex) inner = true;
    if (!inner) out.push(all[a]);
  }
  out.sort(function (x, y) { return y.ex - x.ex; });
  return out;
}
// Ухудшение trend месяцев подряд и на dev за них: {a, b} — значение в начале и сейчас, иначе null.
function worsening(m, ser) {
  if (isCum(m)) return null;  // значение копится с начала года — «рост подряд» ничего не значит
  var L = MODEL.L, n = CFG.obs.trend, v0 = mval(ser, 'm', m, L - n), prev = v0;
  if (v0 === null) return null;
  for (var i = L - n + 1; i <= L; i++) {
    var v = mval(ser, 'm', m, i);
    if (v === null || (m.better === 'higher' ? v >= prev : v <= prev)) return null;
    prev = v;
  }
  return relDev(prev, v0) >= CFG.obs.dev ? { a: v0, b: prev } : null;
}
// «снижение 3 месяца подряд» — существительным: имена метрик бывают и в единственном, и во множественном.
function trendWord(m) { var n = CFG.obs.trend; return (m.better === 'higher' ? 'снижение ' : 'рост ') + n + ' ' + plural(n, 'месяц', 'месяца', 'месяцев') + ' подряд'; }
function trendText(m, tr) { var L = MODEL.L, n = CFG.obs.trend; return monthLabel(L - n) + ' ' + fmtVal(m, tr.a) + ' → ' + monthLabel(L) + ' ' + fmtVal(m, tr.b); }
function endDot(t) { return /[.!?]$/.test(t) ? t : t + '.'; }
// Один факт на метрику и по области целиком (владелец 13.10: «верхнеуровневые инсайты, не мешанина юнитов»):
// область хуже ориентира → иначе заметно изменилась к прошлому году → иначе ухудшение подряд → иначе команды
// хуже своего ориентира → иначе область заметно лучше ориентира.
// Команда называется одна и только если на неё приходится больше половины отклонения; иначе — сколько их.
function teamTail(m, bt, ex) {
  if (!bt.length) return [];
  if (bt[0].ex >= CFG.obs.conc * ex) return [' Больше половины — в ', { r: bt[0].r, mk: m.key }, '.'];
  return [' Хуже ориентира ' + bt.length + ' ' + plural(bt.length, 'команда', 'команды', 'команд') + ' — ', { r: bt[0].r, mk: m.key, t: 'смотреть в «Командах»' }, '.'];
}
function metricFact(m, teams) {
  var M = MODEL, L = M.L, O = CFG.obs, small = smallHide(M.scope, m);
  var v = small ? null : mval(M.scope, 'm', m, L), bl = obsBase(scopeUnit(), m, v);
  var bt = badTeams(m, teams), tr = small ? null : worsening(m, M.scope), ab = small ? '' : absText(m, M.scope, L);
  var ex = bl ? excessPeople(m, M.scope, L, bl.ref) : 0;
  if (bl && bl.state === 'bad' && relDev(v, bl.ref) >= O.dev && ex >= O.minPeople) {
    var gt = gapText(m, ex, bl), body = [capFirst(ab ? endDot(ab) : '') + (gt ? ' ' + gt : '')].concat(teamTail(m, bt, ex));
    if (tr) body.push(' ' + capFirst(trendWord(m)) + '.');
    return { sev: bl.kind === 'kpi' ? 'high' : 'mid', pri: 1, w: ex, body: body, rule: 'хуже ' + refWord(bl) + ' на ' + Math.round(O.dev * 100) + '% и больше',
      lead: m.name + ' ' + fmtVal(m, v) + ' — ' + cmpWords(m, bl) };
  }
  // Год к году по области (верхний уровень: компания — сама себе база, сравнивать её не с чем).
  var pv = v === null ? null : mval(M.scope, 'm', m, L - 12);
  // Порог: 10 % от прошлого значения или 3 п.п. (у закрепляемости ~90 % десятая доля — это 9 п.п., слишком грубо).
  if (pv !== null && m.better !== 'flat' && Math.abs(v - pv) >= (m.fmt === 'pct' ? 0.5 : 1) && (relDev(v, pv) >= O.dev || (m.fmt === 'pct' && Math.abs(v - pv) >= O.yoyPp))) {
    var worse = m.better === 'lower' ? v > pv : v < pv;
    return { sev: worse ? 'mid' : 'good', pri: 2, w: 0, rule: 'изменение к тому же месяцу прошлого года на ' + Math.round(O.dev * 100) + '% или ' + O.yoyPp + ' п.п. и больше',
      lead: m.name + ' ' + fmtVal(m, v) + ' — ' + (worse ? 'хуже' : 'лучше') + ', чем год назад (' + fmtVal(m, pv) + ')',
      body: [ab ? capFirst(endDot(ab)) : ''].concat(teamTail(m, bt, Infinity)) };
  }
  if (tr) {
    return { sev: 'mid', pri: 3, w: 0, rule: 'ухудшение ' + O.trend + ' месяца подряд, за них — на ' + Math.round(O.dev * 100) + '% и больше',
      body: [capFirst(trendText(m, tr)) + (bl ? ', ' + (bl.kind === 'kpi' ? 'цель ' : 'база ') + fmtVal(m, bl.ref) : '') + '.'],
      lead: m.name + ': ' + trendWord(m) };
  }
  if (bt.length) {
    var t0 = bt[0], g0 = gapText(m, t0.ex, t0.bl);
    return { sev: 'mid', pri: 4, w: t0.ex, rule: 'команда от ' + CFG.small.min + ' человек хуже своего ориентира',
      lead: m.name + ': ' + (bt.length === 1 ? 'одна команда' : bt.length + ' ' + plural(bt.length, 'команда', 'команды', 'команд')) + ' хуже ориентира',
      body: [bt.length === 1 ? '' : 'Больше всего — ', { r: t0.r, mk: m.key }, ': ' + fmtVal(m, t0.v) + ', ' + cmpWords(m, t0.bl) + '.' + (g0 ? ' ' + g0 : '')] };
  }
  // Хороший факт по причинам увольнений не ставим, пока есть что заполнять (задача — отдельным фактом).
  var todo = m.num === 'nr' && M.scope.m.nr && (M.scope.m.nr[L] || 0) > 0;
  if (bl && bl.state === 'good' && relDev(v, bl.ref) >= O.dev && !todo) {
    return { sev: 'good', pri: 1, w: -ex, body: [ab ? capFirst(endDot(ab)) : ''], rule: 'лучше ' + refWord(bl) + ' на ' + Math.round(O.dev * 100) + '% и больше',
      lead: m.name + ' ' + fmtVal(m, v) + ' — ' + cmpWords(m, bl) };
  }
  return null;
}
// Всплеск уходов (13.10 — помесячно, недель в отчёте нет): увольнения последнего закрытого месяца против
// среднего за 11 месяцев до него; не меньше spikeMin человек и в spikeX раза больше обычного.
function monthFire(ser, i) { return ser && ser.m && ser.m.fire ? (ser.m.fire[i] || 0) : 0; }
function exitSpike(ser) {
  var L = MODEL.L, O = CFG.obs;
  if (L < 12) return null;
  var last = monthFire(ser, L), usual = 0;
  for (var i = L - 11; i < L; i++) usual += monthFire(ser, i);
  usual /= 11;
  if (last < O.spikeMin || last < O.spikeX * usual) return null;
  return { last: last, usual: usual };
}
function obsFacts() {
  var M = MODEL, L = M.L, O = CFG.obs, all = teamRows(true), teams = [], leaves = [], out = [], i;
  for (i = 0; i < all.length; i++) {
    if (!isSmall(all[i].ser)) teams.push(all[i]);  // порог метрики (50 / 100 у текучести) — ниже, в metricFact
    if (all[i].id === '·' || !rowCanExp(all[i])) leaves.push(all[i]);
  }
  var mets = selMetrics('');
  for (i = 0; i < mets.length; i++) if (mets[i].exL) {
    var mi = mets[i], tm = teams.filter(function (t) { return !smallHide(t.ser, mi); }), f = metricFact(mi, tm);
    if (f) out.push(f);
  }
  // Команда, где сидит больше половины (get) — одна, иначе никого: имена — только по делу.
  function topHalf(get, total) {
    var best = null;
    for (var j = 0; j < leaves.length; j++) { var c = get(leaves[j]); if (c > 0 && (!best || c > best.n)) best = { r: leaves[j], n: c }; }
    return best && best.n > total / 2 ? [' Больше половины — в ', { r: best.r, mk: '' }, ' (' + fmtInt(best.n) + ').'] : [];
  }
  var sp = exitSpike(M.scope);
  if (sp) {
    out.push({ sev: sp.last >= 3 * sp.usual ? 'high' : 'mid', pri: 0, w: sp.last - sp.usual,
      lead: 'Всплеск уходов в ' + monthPrep(L) + ': ' + fmtInt(sp.last) + ' — обычно ' + (sp.usual < 1 ? 'меньше одного' : 'около ' + fmtInt(sp.usual)) + ' в месяц',
      body: ['Уходы из компании за месяц, все причины.'].concat(topHalf(function (r) { return monthFire(r.ser, L); }, sp.last)),
      rule: 'уходов за месяц в ' + O.spikeX + ' раза больше среднего за год и не меньше ' + O.spikeMin });
  }
  var nr = !state.metricOff.exit_reasons && M.scope.m.nr ? (M.scope.m.nr[L] || 0) : 0;
  if (nr) {
    out.push({ sev: 'mid', pri: 4, w: nr,
      lead: fmtInt(nr) + ' ' + plural(nr, 'увольнение', 'увольнения', 'увольнений') + ' за 3 месяца без причины',
      body: ['Нужно указать причину в кадровой системе; кто именно — в отчёте «Детальные списки».'].concat(topHalf(function (r) { return r.ser.m.nr ? (r.ser.m.nr[L] || 0) : 0; }, nr)),
      rule: 'причина не указана через 30 дней после увольнения' });
  }
  var mv = moveOf(M.scope);
  if (mv && mv.from && Math.abs(mv.to - mv.from) / mv.from >= O.hc) {
    var dp = Math.round(Math.abs(mv.to - mv.from) / mv.from * 100);
    out.push({ sev: 'mid', pri: 5, w: 0,
      lead: 'Численность ' + (mv.to > mv.from ? '+' : MINUS) + dp + '% с начала года: ' + fmtInt(mv.from) + ' → ' + fmtInt(mv.to),
      body: ['Найм ' + fmtInt(mv.hire) + ', уходы ' + fmtInt(mv.fire) + ', переводы и прочее ' + signed(mv.other) + '.'],
      rule: 'изменение численности с начала года на ' + Math.round(O.hc * 100) + '% и больше' });
  }
  // Важность, затем тип факта (pri: всплеск · область к ориентиру · год к году · тренд · команды · причины · численность), затем люди.
  var rank = { high: 0, mid: 1, good: 2 };
  out.sort(function (a, b) { return rank[a.sev] - rank[b.sev] || a.pri - b.pri || b.w - a.w; });
  return out.slice(0, O.max);
}
// Одна строка: важность, главный факт, «Ещё N ▾» (или «Подробнее ▾»); список растёт вниз.
var SEV_CLS = { high: '-sevh', mid: '-sevm', good: '-sevg' };
function obsHTML() {
  var P = CFG.ns, O = CFG.obs, list = obsFacts();
  var info = hInfo({ title: 'Что видно в данных', text: 'Главное по юниту отчёта целиком: где метрика заметно хуже или лучше ориентира, всплески уходов, незаполненные причины.',
    note: ['В список попадает отклонение от ' + Math.round(O.dev * 100) + '% ориентира. Команду называем, только если на неё приходится больше половины отклонения.',
           'Метрики команд меньше порога — без цвета.'] });
  if (!list.length) {
    return '<div class="' + P + '-obs"><div class="' + P + '-obs-h"><span class="' + P + '-obs-ico" aria-hidden="true">✓</span>'
      + '<span class="' + P + '-obs-t">Что видно в данных</span>' + info
      + '<span class="' + P + '-obs-lead">Заметных отклонений нет.</span></div></div>';
  }
  var o = list[0], open = !!state.obsOpen;
  var h = '<div class="' + P + '-obs ' + P + SEV_CLS[o.sev] + '"><div class="' + P + '-obs-h">'
    + '<span class="' + P + '-obs-ico" aria-hidden="true">' + (o.sev === 'good' ? '✓' : '!') + '</span>'
    + '<span class="' + P + '-obs-t">Что видно в данных</span>' + info
    + (open ? '<span class="' + P + '-obs-lead"></span>' : '<span class="' + P + '-obs-lead"' + tip({ title: o.lead, text: segsText(o.body) }) + '>' + esc(o.lead) + '</span>')
    + '<button type="button" class="' + P + '-obs-tog" data-action="obs" aria-expanded="' + open + '">'
    + (open ? 'Свернуть ▴' : (list.length > 1 ? 'Ещё ' + (list.length - 1) + ' ▾' : 'Подробнее ▾')) + '</button></div>';
  if (open) {
    h += '<ul class="' + P + '-obs-list">';
    for (var i = 0; i < list.length; i++) {
      h += '<li class="' + P + '-obs-li"><i class="' + P + '-obs-dot ' + P + SEV_CLS[list[i].sev] + '"' + tip({ title: list[i].lead, text: 'Почему здесь: ' + list[i].rule + '.' }) + '></i>'
        + '<div><b>' + esc(list[i].lead) + '.</b> <span>' + segsHTML(list[i].body) + '</span></div></li>';
    }
    h += '</ul>';
  }
  return h + '</div>';
}
// Метрики, строки которых раскрыты на «Сводке» (раскрыть можно несколько сразу).
function opOpen(mk) { return !!state.openM[mk]; }
// Доминирующее значение популяционного разреза в области без выбранных разрезов: {key, v, share} | null.
function popHint() {
  var M = MODEL, best = null;
  for (var i = 0; i < CFG.cuts.length; i++) if ((M.sel[CFG.cuts[i].key] || []).length) return null;
  for (var c = 0; c < CFG.pop.cuts.length; c++) {
    var key = CFG.pop.cuts[c], f = M.facets[key] || [], tot = 0, top = null;
    for (var j = 0; j < f.length; j++) { tot += f[j].n; if (!isNoVal(f[j].v) && (!top || f[j].n > top.n)) top = f[j]; }
    if (!top || tot <= 0 || f.length < 2) continue;
    var sh = top.n / tot;
    if (sh >= CFG.pop.share && sh < 0.999 && (!best || sh > best.share)) best = { key: key, v: top.v, share: sh };
  }
  return best;
}
// Текучесть нормативна только для активной численности HQ (HRBP 13.10): пометка над таблицей «Текучести» и кнопка,
// которая ставит оба разреза. Уже выбраны ровно они — пометки нет. Значений нет в зоне — без кнопки.
function hqOn() {
  var s = MODEL.sel || {}, h = CFG.hq;
  return (s.hct || []).length === 1 && s.hct[0] === h.hct && (s.paint || []).length === 1 && s.paint[0] === h.paint;
}
function hasVal(key, v) { var f = MODEL.facets[key] || []; for (var i = 0; i < f.length; i++) if (f[i].v === v) return true; return false; }
// Алерт перед блоком «Текучесть» (HRBP 13.10, Дьяченко: «если настройки отличаются — явно подсвечивать перед
// блоком»): знаменатель regrettable и non-regrettable — всегда активная HQ. Фильтры исключают её — жёлтый,
// иначе — синий; выбраны ровно «Активная» и «HQ» — алерта нет.
function hqAlertHTML() {
  var P = CFG.ns, h = CFG.hq, sel = MODEL.sel || {};
  if (hqOn()) return '';
  var ps = sel.paint || [], ts = sel.hct || [];
  var none = (ps.length && ps.indexOf(h.paint) < 0) || (ts.length && ts.indexOf(h.hct) < 0);
  var can = hasVal('hct', h.hct) && hasVal('paint', h.paint);
  var btn = can ? ' <button type="button" class="' + P + '-lnk" data-action="hqact">Показать по активной HQ</button>' : '';
  if (none) {
    return '<div class="' + P + '-note ' + P + '-warn ' + P + '-hqa" data-hqnote="1"><b>Regrettable и non-regrettable не считаются:</b> их знаменатель — активная численность HQ, '
      + 'а выбранные фильтры (' + esc(selLabel()) + ') её исключают.' + btn + '</div>';
  }
  return '';
}
// Подзаголовок «Текучести»: норматив HQ одной фразой и ссылка «показать по активной HQ», если фильтры не ровно она.
function hqSub() {
  var P = CFG.ns, h = CFG.hq, can = hasVal('hct', h.hct) && hasVal('paint', h.paint);
  return ' · <span' + tip({ title: 'Regrettable и non-regrettable', text: 'Знаменатель — всегда активная численность HQ, какие бы фильтры ни были выбраны. Остальные метрики — по выбранной численности: ' + selLabel() + '.' }) + '>regrettable — по активной HQ</span>'
    + (!hqOn() && can ? ' · <button type="button" class="' + P + '-lnk" data-action="hqact">показать всё по активной HQ</button>' : '');
}
// Сравнение с популяцией — кнопкой рядом с «Базой» (не плашкой): подробности — в подсказке, × — скрыть.
function popHintBtn() {
  var P = CFG.ns, h = popHint(), sig = sigOf(reqNow());
  if (!h || state.popOff === sig) return '';
  var lab = CUT[h.key] ? CUT[h.key].label : h.key, pc = Math.round(h.share * 100), nm = cutName(h.v);
  return '<span class="' + P + '-poph" data-pophint="1"><button type="button" class="' + P + '-lnk" data-action="pophint" data-key="' + esc(h.key) + '" data-val="' + esc(h.v) + '"'
    + tip({ title: 'Сравнить честнее', text: pc + ' % людей юнита — «' + nm + '» (' + lab.toLowerCase() + '), а база — вся компания. Клик сравнит с «' + nm + '» по компании.' }) + '>Сравнить с «' + esc(nm) + '»</button>'
    + '<button type="button" class="' + P + '-lnk ' + P + '-popx" data-action="pophint" data-key="" aria-label="Скрыть"' + tip({ title: 'Скрыть', text: 'Подсказка вернётся при другом выборе юнита или фильтров.' }) + '>×</button></span>';
}
function sumInfo() {
  return hInfo({ title: 'Как читать сводку', text: 'Значения за ' + monthLow(MODEL.L) + ' сравниваем с целью юнита, а если цели нет — с базой.',
    rows: [{ label: 'база', value: benchLabel() }],
    note: 'Нажмите на строку метрики — откроется график и пояснения.' });
}
// ---- «Сводка»: раскрытая строка — график слева, «О метрике» и «Что видно» справа (владелец 13.10) ----
// Формула словами: [числитель, знаменатель, (как складываем)]; с начала года — своя.
function metricFrac(m) { return m.fracY && ytdOn(m) ? m.fracY : (m.frac || null); }
function fracText(f) { return f ? f[0] + ' ÷ ' + f[1] + (f[2] ? ', ' + f[2] : '') : ''; }
// Примечания по месту: норматив, порог численности, «Активная» у закрепляемости — у своей метрики, не общей плашкой.
function retActive(m) { return (m.num === 'r3n' || m.num === 'r6n') && !!MODEL.meta && MODEL.meta.ret_base === 'active'; }
function metricNotes(m) {
  var out = [];
  if (m.hq) out.push('Знаменатель — всегда активная численность HQ, какие бы фильтры ни были выбраны.');
  if (smallGate(m)) out.push('Если в юните меньше ' + smallMin(m) + ' человек, значение без цвета: один уход сдвигает процент на несколько пунктов.');
  if (retActive(m)) out.push('Выбран тип «Активная»: новички — пришедшие в активную численность (найм, переход кандидата, внутренний перевод), срок — от прихода.');
  return out.concat(m.notes || []);
}
// ⓘ метрики — коротко: что это и как считаем.
function metricTip(m) {
  var f = metricFrac(m), note = [];
  if (f) note.push('Считаем: ' + fracText(f) + '.');
  if (retActive(m)) note.push('Новички — пришедшие в активную численность: найм, переход кандидата, внутренний перевод.');
  return { title: m.name, text: m.hint, note: note };
}
// Вторая строка под именем метрики: направление и пометка этой метрики (норматив HQ, «Активная»).
function rowNote(m) {
  var P = CFG.ns, s = esc(dirText(m));
  if (m.hq) s += ' · по активной HQ';
  if (retActive(m)) s += ' · новички — приход в активную';
  return '<span class="' + P + '-us">' + s + '</span>';
}
function aboutHTML(m) {
  var P = CFG.ns, f = metricFrac(m), notes = metricNotes(m), s = '<div class="' + P + '-sth">О метрике</div><p class="' + P + '-stp">' + esc(m.hint) + '</p>';
  if (f) s += '<div class="' + P + '-frac" aria-label="' + esc(fracText(f)) + '"><span class="' + P + '-frn">' + esc(f[0]) + '</span><span class="' + P + '-frd">' + esc(f[1]) + '</span></div>'
    + (f[2] ? '<div class="' + P + '-frs">' + esc(capFirst(f[2])) + '</div>' : '');
  if (notes.length) { s += '<ul class="' + P + '-stu">'; for (var i = 0; i < notes.length; i++) s += '<li>' + esc(notes[i]) + '</li>'; s += '</ul>'; }
  return s;
}
// «Сколько это людей» до ориентира — по-русски для каждой метрики (null — меньше одного человека).
function gapText(m, ex, bl) {
  var n = Math.round(ex), w = bl.kind === 'kpi' ? 'цели' : 'базы';
  if (n < 1) return null;
  if (m.num === 'r3n' || m.num === 'r6n') return 'Чтобы выйти на уровень ' + w + ', нужно было удержать ещё ≈' + NBSP + n + ' ' + plural(n, 'новичка', 'новичков', 'новичков') + '.';
  if (m.num === 'nr') return '≈' + NBSP + n + ' ' + plural(n, 'увольнение', 'увольнения', 'увольнений') + ' без причины сверх ' + w + '.';
  if (m.num === 'jun') return 'До ' + w + ' не хватает ≈' + NBSP + n + ' ' + plural(n, 'джуна', 'джунов', 'джунов') + '.';
  return '≈' + NBSP + n + ' ' + plural(n, 'уход', 'ухода', 'уходов') + ' сверх ' + w + '.';
}
// Сравнение словами: «лучше цели 5,0 %», «хуже базы 92,0 %», «на уровне цели» (мёртвая зона ±5 %).
function cmpWords(m, bl) {
  var w = bl.kind === 'kpi' ? 'цели' : 'базы', r = fmtVal(m, bl.ref);
  if (bl.state === 'good') return 'лучше ' + w + ' ' + r;
  if (bl.state === 'bad') return 'хуже ' + w + ' ' + r;
  return 'на уровне ' + w + ' ' + r;
}
// Факты истории метрики (до 5): с номером — у точки на графике (i — месяц 0…11 текущего года, s — линия),
// без номера — вывод без точки (темп к декабрю, сколько месяцев хуже ориентира).
function storyItems(u, ser, m, spec) {
  var M = MODEL, L = M.L, b = L - 12, cur = spec.cur, out = [], O = CFG.obs;
  if (b < 0 || cur[b] === null || cur[b] === undefined) return out;
  var v = cur[b], bl = baseline(u, m, v, 'm', L), ab = absText(m, ser, L), flat = m.better === 'flat';
  // 1. Сейчас и ориентир
  var t1 = '<b>' + esc(capFirst(monthName(L))) + ' — ' + esc(fmtVal(m, v)) + '</b>' + (ab ? ' (' + esc(ab) + ')' : '');
  if (bl.kind !== 'none' && !flat) {
    t1 += ', ' + esc(cmpWords(m, bl)) + '.';
    var ex = bl.state === 'bad' ? excessPeople(m, ser, L, bl.ref) : 0, gt = ex ? gapText(m, ex, bl) : null;
    if (gt) t1 += ' ' + esc(gt);
  } else t1 += '.';
  out.push({ i: b, s: 'cur', html: t1 });
  // 2. Год назад — тот же месяц
  var pv = spec.prev[b];
  if (pv !== null && pv !== undefined) {
    var d = deltaOf(m, v, pv), up = d > 0, word;
    if (!d) word = 'столько же';
    else if (flat) word = (up ? 'больше на ' : 'меньше на ') + fmtDelta(m, Math.abs(d)).replace('+', '');
    else word = ((m.better === 'lower') === up ? 'хуже' : 'лучше') + ' на ' + fmtDelta(m, Math.abs(d)).replace('+', '');
    out.push({ i: cmpRef(spec) ? -1 : b, s: 'prev', html: '<b>Год назад — ' + esc(fmtVal(m, pv)) + '</b>: сейчас ' + esc(endDot(word)) });
  }
  // 3. Экстремум года: с начала года — месяц, добавивший больше всего; иначе — худший месяц (у нейтральных — максимум)
  if (spec.cum) {
    var best = -1, inc = 0;
    for (var j = 0; j <= b; j++) {
      var a0 = j ? cur[j - 1] : 0, a1 = cur[j];
      if (a1 === null || a0 === null) continue;
      if (a1 - a0 > inc) { inc = a1 - a0; best = j; }
    }
    // людей за месяц: у текучести — увольнения месяца (rgs / nrgs), у причин — прирост суммы с начала года
    var arr = m.ytd ? ser.m[m.ytd] : ser.m[m.num], nm = 0;
    if (best >= 0 && b > 0) {
      if (arr) nm = m.ytd ? (arr[12 + best] || 0) : (arr[12 + best] || 0) - (best ? (arr[11 + best] || 0) : 0);
      var w3 = m.ytd ? ['уход', 'ухода', 'уходов'] : ['увольнение', 'увольнения', 'увольнений'];
      out.push({ i: best, s: 'cur', html: '<b>Больше всего ' + (m.ytd ? 'ушло' : 'добавилось') + ' в ' + esc(monthPrep(12 + best)) + '</b>: +' + esc(fmtVal(m, inc).replace(/^\+/, '')) + ' за месяц'
        + (nm > 0 ? ' (' + fmtInt(nm) + ' ' + plural(nm, w3[0], w3[1], w3[2]) + ')' : '') + '.' });
    }
  } else if (b > 0) {
    var wi = -1;
    for (var k = 0; k <= b; k++) {
      if (cur[k] === null || cur[k] === undefined) continue;
      if (wi < 0 || (m.better === 'higher' ? cur[k] < cur[wi] : cur[k] > cur[wi])) wi = k;
    }
    if (wi >= 0 && wi !== b && relDev(cur[wi], v) >= 0.05) {
      var lab = flat ? 'Максимум года' : (m.better === 'higher' ? 'Худший месяц' : 'Пик года');
      out.push({ i: wi, s: 'cur', html: '<b>' + lab + ' — ' + esc(monthName(12 + wi)) + '</b>: ' + esc(fmtVal(m, cur[wi])) + '.' });
    }
  }
  // 4. Ухудшение подряд (не для «с начала года»: там значение растёт каждый месяц)
  var tr = worsening(m, ser);
  if (tr && !flat) {
    var n0 = O.trend;
    out.push({ i: b - n0 >= 0 ? b - n0 : -1, s: 'cur', html: '<b>' + capFirst(trendWord(m)) + '</b>: ' + esc(monthName(L - n0)) + ' ' + esc(fmtVal(m, tr.a)) + ' → ' + esc(monthName(L)) + ' ' + esc(fmtVal(m, tr.b)) + '.' });
  }
  // 5. С начала года — темп к декабрю; иначе — сколько месяцев года хуже ориентира
  if (spec.cum && b < 11 && v > 0) {
    var pace = v * 12 / (b + 1), tail = '';
    if (bl.kind === 'kpi') tail = (m.ytd ? ' Годовая цель — ' + esc(fmtVal(m, bl.ref * 12 / (b + 1))) : ' Цель — ' + esc(fmtVal(m, bl.ref))) + '.';
    else if (bl.kind === 'bench' && bl.ref) tail = ' У базы темп ≈' + NBSP + esc(fmtVal(m, bl.ref * 12 / (b + 1))) + '.';
    out.push({ i: -1, html: '<b>К декабрю при таком темпе — ≈' + NBSP + esc(fmtVal(m, pace)) + '</b>.' + tail });
  } else if (!spec.cum && !flat && bl.kind !== 'none' && b >= 2) {
    var idx = [];
    for (var q = 12; q <= L; q++) idx.push(q);
    var st = statesOver(u, ser, 'm', m, idx), bad = 0;
    for (var z = 0; z < st.length; z++) if (st[z] === 'bad') bad++;
    if (bad) out.push({ i: -1, html: 'Хуже ориентира — ' + bad + ' ' + plural(bad, 'месяц', 'месяца', 'месяцев') + ' из ' + idx.length + ' в этом году.' });
  }
  // Номера — слева направо по графику: читается «пункт → точка».
  var nums = [];
  for (var y = 0; y < out.length; y++) if (out[y].i >= 0) nums.push(out[y]);
  nums.sort(function (x1, x2) { return x1.i - x2.i || (x1.s === 'cur' ? -1 : 1); });
  for (var e = 0; e < nums.length; e++) nums[e].n = e + 1;
  out.sort(function (x1, x2) { return (x1.n || 99) - (x2.n || 99); });
  return out;
}
function storyHTML(items) {
  var P = CFG.ns;
  if (!items.length) return '';
  var s = '<div class="' + P + '-sth">Что видно</div><ol class="' + P + '-ins">';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    s += '<li' + (it.n ? ' data-mk="' + it.n + '"' : '') + '>' + (it.n ? '<i class="' + P + '-insn' + (it.s === 'prev' ? ' ' + P + '-insp' : '') + '">' + it.n + '</i>' : '<i class="' + P + '-insb"></i>')
      + '<span>' + it.html + '</span></li>';
  }
  return s + '</ol>';
}
function storyRow(u, ser, m) {
  // Факты — словами как есть («хуже базы»), даже у маленького юнита: без цвета только график (spec.nocol).
  var P = CFG.ns, spec = yoySpec(u, ser, m), nc = NOCOL;
  NOCOL = false;
  var items = storyItems(u, ser, m, spec);
  NOCOL = nc;
  spec.marks = [];
  for (var i = 0; i < items.length; i++) if (items[i].n) spec.marks.push({ i: items[i].i, s: items[i].s, n: items[i].n });
  return '<tr class="' + P + '-det"><td colspan="6"><div class="' + P + '-story" data-story="1">'
    + '<div class="' + P + '-stc">' + chartBlock('story', 'op:' + m.key + ':yoy:' + u, cmpRef(spec) ? 'Помесячно: этот год и ' + (spec.refKind === 'kpi' ? 'цель' : 'база') : 'Помесячно: этот год и прошлый', spec, CFG.chart.story) + '</div>'
    + '<div class="' + P + '-sts">' + storyHTML(items) + '<div class="' + P + '-sta">' + aboutHTML(m) + '</div></div>'
    + '</div></td></tr>';
}
function onepagerHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, u = scopeUnit();
  var s = '';
  if (!M.scope) return s + hEmpty('Нет людей под этими фильтрами', 'Снимите один из фильтров: × у его чипа над отчётом.');
  if (!selMetrics('').length) return s + hEmpty('Метрики не выбраны', 'Включите их в «Фильтрах», раздел «Что показывать».');
  var smallScope = false, gatedOn = false, sm0 = selMetrics('');
  for (var s0 = 0; s0 < sm0.length; s0++) if (smallHide(M.scope, sm0[s0])) smallScope = true;
  for (var g0 = 0; g0 < CFG.small.blocks.length; g0++) if (selMetrics(CFG.small.blocks[g0]).length) gatedOn = true;
  // Над таблицами — одна строка «Что видно в данных» (владелец 14.10: «слишком много подсказок, глаза разбегаются»):
  // сравнение с популяцией — кнопкой у «Базы» (popHintBtn), «мало людей» — подписью в строке метрики и в легенде,
  // легенда цвета — в шапке первого блока, норматив HQ — в подзаголовке «Текучести».
  s += kpiCardsHTML() + obsHTML();
  var any = false, legOn = false;
  for (var b = 0; b < CFG.blocks.length; b++) {
    var blk = CFG.blocks[b], mets = selMetrics(blk.key), items = [];
    for (var i = 0; i < mets.length; i++) {
      NOCOL = smallHide(M.scope, mets[i]);
      var m = mets[i], v = mval(M.scope, 'm', m, L), bl = baseline(u, m, v, 'm', L);
      NOCOL = false;
      // Зона из нескольких корней: цель общего предка для неё всегда унаследована.
      if (bl.kind === 'kpi' && !M.single) bl.inherited = true;
      if (state.focusOnly && bl.kind !== 'kpi') continue;
      items.push({ m: m, v: v, bl: bl });
    }
    if (!items.length) continue;
    any = true;
    items.sort(function (a, c) { return (a.bl.kind === 'kpi' ? 0 : 1) - (c.bl.kind === 'kpi' ? 0 : 1); });
    var rows = '', nOpen = 0, nExp = 0;
    for (var k = 0; k < items.length; k++) {
      var it = items[k], mk = it.m.key, sm = smallHide(M.scope, it.m), open = opOpen(mk);
      if (open) nOpen++;
      nExp++;
      NOCOL = sm;
      var hid = hiddenRules(u, mk);
      if (it.bl.kind === 'kpi' && it.bl.inherited) {
        var more = hiddenRules(it.bl.owner, mk);
        for (var h = 0; h < more.length; h++) if (hid.indexOf(more[h]) < 0) hid.push(more[h]);
      }
      var name = '<span class="' + P + '-rb">' + esc(it.m.name) + hInfo(metricTip(it.m))
        + focusTag(it.m, it.bl) + moreFocus(hid, false) + rowNote(it.m) + '</span>';
      var ab = absText(it.m, M.scope, L), abH = ab ? '<span class="' + P + '-us ' + P + '-abs">' + esc(ab) + '</span>' : '';
      // Юнит меньше порога (HRBP 13.10): значение, динамика и график — как у всех, только без цвета.
      if (sm) abH += '<span class="' + P + '-us ' + P + '-abs"' + tip({ title: it.m.name, text: smallWhy(M.scope, it.m), rows: absRows(it.m, M.scope, L) }) + '>без цвета: мало людей</span>';
      rows += '<tr class="' + P + '-row' + (open ? ' ' + P + '-opn' : '') + '" data-action="openm" data-key="' + mk + '" aria-expanded="' + (open ? 'true' : 'false') + '">'
        + '<td class="' + P + '-l"><span class="' + P + '-rl">' + hCaret(open, 'openm', mk, open ? 'Скрыть динамику' : 'Показать динамику')
        + name + '</span></td>'
        + '<td class="' + P + '-lead">' + esc(fmtVal(it.m, it.v)) + abH + '</td>'
        + cmpTd(it.m, it.v, it.bl)
        + (isCum(it.m) ? '<td' + tip({ title: 'Изменение', text: 'С начала года значение копится, поэтому сравнивать с прошлым месяцем не имеет смысла. Смотрите «Год к году».' }) + '>' + hPill('flat', '—') + '</td>'
          : deltaTd(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 1)), 'Сравнение с предыдущим месяцем (' + monthLow(L - 1) + ').', null, mval(M.scope, 'm', it.m, L - 1)))
        + deltaTd(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 12)), 'Сравнение с тем же месяцем прошлого года (' + monthLow(L - 12) + ').', null, mval(M.scope, 'm', it.m, L - 12))
        + '<td class="' + P + '-spk">' + sparkHTML(u, M.scope, it.m) + '</td></tr>';
      if (open) rows += storyRow(u, M.scope, it.m);
      NOCOL = false;
    }
    var allOpen = nExp > 0 && nOpen === nExp;
    var tbl = '<table class="' + P + '-t ' + P + '-fix ' + P + '-op"><colgroup><col style="width:30%"><col style="width:10%"><col style="width:15%">'
      + '<col style="width:11%"><col style="width:11%"><col style="width:23%"></colgroup>'
      + '<thead><tr><th class="' + P + '-l"><span class="' + P + '-rl">'
      + (nExp ? hCaret(allOpen, 'openall', blk.key, allOpen ? 'Свернуть все' : 'Раскрыть все', { title: allOpen ? 'Свернуть все' : 'Раскрыть все', text: 'График и пояснения по всем метрикам группы.' }) : '<span class="' + P + '-cars"></span>')
      + '<span class="' + P + '-rb">Метрика</span></span></th><th>Значение<span class="' + P + '-hc">' + esc(monthFull(L)) + '</span></th>'
      + '<th class="' + P + '-vs">Ориентир<span class="' + P + '-hc">цель или база</span></th>'
      + '<th>Изменение<span class="' + P + '-hc">к ' + esc(monthDat(L - 1)) + '</span></th>'
      + '<th>Год к году<span class="' + P + '-hc">к ' + esc(monthDat(L - 12)) + '</span></th>'
      + '<th class="' + P + '-c">12 мес<span class="' + P + '-hc">точка — к ориентиру месяца</span></th></tr></thead><tbody>' + rows + '</tbody></table>';
    var hqs = blk.key === 'turnover' ? hqSub() : '';
    s += '<div class="' + P + '-gap">' + (blk.key === 'turnover' ? hqAlertHTML() : '') + hPanel({ title: blk.name, subHtml: esc(blk.hint) + hqs, body: tbl, tbl: true,
      tabs: legOn ? '' : '<span class="' + P + '-pbtn">' + legendHTML(false, smallScope && gatedOn, true) + '</span>' }) + '</div>';
    legOn = true;
  }
  if (!any) s += hEmpty('С «Только фокусные» метрик не осталось', 'Целей по выбранным метрикам здесь нет. Выключите «Только фокусные» в «Фильтрах».');
  return s;
}

// ---- вкладка «Команды» ----
function hcOf(ser) { var L = MODEL.L; return ser && ser.m && ser.m.hc ? (ser.m.hc[L] || 0) : 0; }
function byHc(a, b) {
  if (a.id === '·' || b.id === '·') return a.id === '·' ? 1 : -1;
  return hcOf(b.ser) - hcOf(a.ser) || (unitName(MODEL, a.id) < unitName(MODEL, b.id) ? -1 : 1);
}
// Дерево «Команд»: датасет отдаёт юнит и 3 уровня вниз (depth_f = all — до 12-го, чарт его не шлёт):
// −1 — c, −2 — g (pid — узел −1), глубже — x (pid — путь родителя от −1 через '/').
// Узел дерева — путь от −1 (pfx): после реорганизации один юнит стоит под двумя
// родителями, и его подразделения в каждом месте свои. Догрузки при раскрытии нет.
function kidsAt(r) {
  if (!r.id || r.id === '·') return null;
  return r.lvl === 1 ? (MODEL.g[r.id] || null) : (MODEL.x[r.pfx] || null);
}
function realKids(list) {
  if (!list) return false;
  for (var i = 0; i < list.length; i++) if (list[i].id !== '·') return true;
  return false;
}
function rowCanExp(r) { return realKids(kidsAt(r)); }
// Сортировка таблицы «Команд»: клик по заголовку колонки. Сортируются соседи внутри
// каждого узла — дерево не рассыпается; «Напрямую в …» всегда в конце своей группы,
// пустые значения — в конце в любом направлении. По умолчанию — численность по убыванию.
function teamCmp() {
  var ts = state.tsort || {}, k = ts.key || '', asc = ts.dir === 'asc', m = k && k !== 'name' ? METRIC[k] : null, L = MODEL.L;
  return function (a, b) {
    if (a.id === '·' || b.id === '·') return a.id === b.id ? 0 : (a.id === '·' ? 1 : -1);
    if (k === 'name') {
      var na = unitName(MODEL, a.id).toLowerCase(), nb = unitName(MODEL, b.id).toLowerCase();
      var c = na < nb ? -1 : (na > nb ? 1 : 0);
      return asc ? c : -c;
    }
    if (m) {
      var va = mval(a.ser, 'm', m, L), vb = mval(b.ser, 'm', m, L);
      if (va === null || vb === null) return va === null && vb === null ? byHc(a, b) : (va === null ? 1 : -1);
      return (asc ? va - vb : vb - va) || byHc(a, b);
    }
    return byHc(a, b);
  };
}
// all — обойти всё дерево (для «Развернуть всё» и поиска), иначе — только раскрытые узлы;
// force — узлы, раскрытые поиском (предки найденных).
function teamRows(all, force) {
  var out = [], cmp = teamCmp();
  function walk(list, lvl, ppfx) {
    var ls = list.slice().sort(cmp);
    for (var i = 0; i < ls.length; i++) {
      var id = ls[i].id, pfx = id === '·' ? '' : (ppfx ? ppfx + '/' : '') + id;
      var r = { lvl: lvl, id: id, pid: ppfx ? ppfx.slice(ppfx.lastIndexOf('/') + 1) : '', pfx: pfx, ser: ls[i].ser,
                key: lvl + ':' + ppfx + ':' + id };
      out.push(r);
      if (id === '·' || !(all || state.openRows[pfx] || (force && force[pfx])) || !rowCanExp(r)) continue;
      walk(kidsAt(r), lvl + 1, pfx);
    }
  }
  walk(MODEL.c, 1, '');
  return out;
}
// Поиск по таблице «Команд»: юниты, чьё имя содержит строку, и их предки (раскрыты) —
// ищет по загруженным уровням (3 или все), без запроса.
function teamSearch(q) {
  var all = teamRows(true), show = {}, open = {}, n = 0;
  for (var i = 0; i < all.length; i++) {
    var r = all[i];
    if (r.id === '·' || unitName(MODEL, r.id).toLowerCase().indexOf(q) < 0) continue;
    n++;
    show[r.key] = true;
    var parts = r.pfx.split('/');
    for (var j = 1; j < parts.length; j++) open[parts.slice(0, j).join('/')] = true;
  }
  return { show: show, open: open, hits: n, total: all.length };
}
function hlText(name, q) {
  var at = q ? name.toLowerCase().indexOf(q) : -1;
  if (at < 0) return esc(name);
  return esc(name.slice(0, at)) + '<mark class="' + CFG.ns + '-hl">' + esc(name.slice(at, at + q.length)) + '</mark>' + esc(name.slice(at + q.length));
}
// Юнит, чьи цели действуют на строку: «·» — сотрудники прямо в родителе.
function rowUnit(r) { return r.id !== '·' ? r.id : (r.lvl === 1 ? scopeUnit() : r.pid); }
function rowName(r) {
  if (r.id !== '·') return unitName(MODEL, r.id);
  return 'Напрямую в «' + (r.lvl === 1 ? scopeLabel() : unitName(MODEL, r.pid)) + '»';
}
// Значение юнита в «Командах»: пилюля светофора (та же, что на «Сводке»), подсказка — на всей
// ячейке, поэтому тултип переходит от значения к значению без мигания.
function unitCell(unitId, ser, m, selected, cls) {
  var P = CFG.ns, L = MODEL.L, v = mval(ser, 'm', m, L), txt = fmtVal(m, v), c = cls ? ' class="' + cls + '"' : '';
  // «Команды» (HRBP 13.10, Дьяченко): значения — у всех команд, у маленьких — без цвета.
  if (smallHide(ser, m)) return v === null ? smallTd(m, ser, cls)
    : '<td class="' + P + '-sm1' + (cls ? ' ' + cls : '') + '"' + tip({ title: m.name, text: smallWhy(ser, m), rows: [{ label: 'факт', value: txt }].concat(absRows(m, ser, L)) }) + '>' + esc(txt) + '</td>';
  if (v === null) return '<td class="' + P + '-muted' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</td>';
  var bl = baseline(unitId, m, v, 'm', L), fact = [{ label: 'факт', value: txt }].concat(absRows(m, ser, L));
  if (bl.kind === 'none') return '<td' + c + tip({ title: m.name, text: 'Ориентира у метрики нет: ' + (m.better === 'flat' ? '«больше» не значит «лучше».' : 'абсолютная величина.'), rows: fact }) + '>' + esc(txt) + '</td>';
  var t = bl.kind === 'kpi'
    ? { title: m.name, text: bl.inherited ? 'Цель унаследована с уровня «' + unitName(MODEL, bl.owner) + '».' : 'Цель стоит на этом юните.',
        rows: fact.concat([{ label: 'цель', value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.kpi }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }]),
        note: stTxt(bl.state) }
    : { title: m.name, text: 'Утверждённой цели нет — сравнение с базой.',
        rows: fact.concat([{ label: benchLabel(), value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.bench }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }]),
        note: stTxt(bl.state) };
  return '<td' + c + tip(t) + '>' + hPill(bl.state, txt)
    + (selected ? '<span class="' + P + '-cref">' + (bl.kind === 'kpi' ? 'цель ' : 'база ') + esc(fmtVal(m, bl.ref)) + '</span>' : '') + '</td>';
}
// Маленькая команда: значение без цвета, в подсказке — почему и сколько это людей.
function smallWhy(ser, m) {
  var n = popOf(ser, m), hq = m.hq && MODEL.hqOk;
  return 'Без цвета: в команде ' + fmtInt(n) + ' ' + plural(n, 'человек', 'человека', 'человек') + (hq ? ' активной HQ' : '') + ', нужно от ' + smallMin(m)
    + '. Один человек здесь сдвигает процент на несколько пунктов.';
}
function smallRule() { return 'закрепляемость и причины — от ' + CFG.small.min + ' человек, regrettable — от 50, non-regrettable — от 100'; }
function smallTd(m, ser, cls) {
  var P = CFG.ns;
  return '<td class="' + P + '-muted ' + P + '-sm0' + (cls ? ' ' + cls : '') + '"' + tip({ title: m.name, text: smallWhy(ser, m), rows: absRows(m, ser, MODEL.L) }) + '>—</td>';
}
function ownLive(unitId, keys) {
  var n = 0;
  for (var i = 0; i < MODEL.rules.length; i++) {
    var r = MODEL.rules[i];
    if (r.unit === unitId && keys.indexOf(r.metric) > -1 && ruleMatches(r)) n++;
  }
  return n;
}
// «Открыть юнит» — иконка (вход в юнит), а не текст: у выбранной строки — у правого края
// колонки имён (одно место во всех строках), и в шапке «Динамики» рядом с «Год / 12 недель».
var OPEN_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/><path d="M9 16l4-4-4-4"/><path d="M13 12H3"/></svg>';
function drillBtn(id) {
  var P = CFG.ns, nm = unitName(MODEL, id);
  return '<button type="button" class="' + P + '-ib ' + P + '-drill" data-action="unit" data-id="' + esc(id) + '" aria-label="Открыть юнит ' + esc(nm) + '"'
    + tip({ title: 'Открыть юнит', text: 'Сделать «' + nm + '» юнитом отчёта.', note: 'Вернуться — «← Назад».' }) + '>' + OPEN_SVG + '</button>';
}
// Кнопка раскладки «таблица | динамика» в шапке панели: во всю ширину / вернуть обе.
var EXPAND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
var SHRINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>';
function splitBtn(side) {
  var P = CFG.ns, mode = state.splitMode || 'both';
  if (state.narrow) return '';
  var wide = mode === side, lbl = wide ? 'Вернуть ' + (side === 'table' ? 'динамику' : 'таблицу') + ' рядом' : (side === 'table' ? 'Таблица' : 'Динамика') + ' во всю ширину';
  return '<button type="button" class="' + P + '-ib' + (wide ? ' ' + P + '-on' : '') + '" data-action="split" data-key="' + (wide ? 'both' : side) + '" aria-label="' + esc(lbl) + '"'
    + tip({ title: lbl, text: wide ? 'Таблица слева, графики справа.' : 'Ширину можно менять, потянув разделитель.' }) + '>'
    + (wide ? SHRINK_SVG : EXPAND_SVG) + '</button>';
}
// Свёрнутая колонка — узкая полоса с подписью: клик возвращает обе колонки.
function splitRail(label, arrow) {
  var P = CFG.ns;
  return '<button type="button" class="' + P + '-rail" data-action="split" data-key="both" aria-label="Показать: ' + esc(label) + '"'
    + tip({ title: label, text: 'Вернуть таблицу и графики рядом.' }) + '><i>' + arrow + '</i><span>' + esc(label) + '</span></button>';
}
// Путь юнита отчёта над таблицей: предки внутри зоны кликабельны — переход сразу, как
// по кнопке «Открыть юнит»; «↑» — уровнем выше, «← Назад» — к юниту до последнего перехода.
function crumbsHTML() {
  var P = CFG.ns, M = MODEL, parts = [], hz = hzNow(), h = hz ? M.hBy[hz] : null;
  function cb(key, id, name, tipText) {
    return '<button type="button" class="' + P + '-crb" data-action="crumb" data-key="' + key + '" data-id="' + esc(id) + '"'
      + tip({ title: 'Перейти: ' + name, text: tipText || 'Сделать юнитом отчёта.' }) + '>' + esc(name) + '</button>';
  }
  var nav = '', up = null;
  if (state.unitBack && state.unitBack.length) {
    var prev = state.unitBack[state.unitBack.length - 1];
    nav += '<button type="button" class="' + P + '-nb" data-action="back"' + tip({ title: 'Назад', text: 'Вернуться к «' + unitsLabel(prev, '') + '».' }) + '>← Назад</button>';
  }
  if (!M.single) {
    if (h && !defaultScope() && !sameSet(h.roots, M.scopeIds)) parts.push(cb('hz', '', 'Зона ' + h.nm));
    else if (!defaultScope()) parts.push(cb('zone', '', M.role === 'hrbp' ? 'Моя зона' : 'Вся зона', 'Вся ваша зона видимости.'));
    parts.push('<b>' + esc(scopeLabel()) + '</b>');
  } else {
    var id = M.scopeIds[0], chain = pathTo(id), start = -1;
    for (var i = 0; i < chain.length; i++) if (M.roots.indexOf(chain[i]) > -1) { start = i; break; }
    if (M.roots.length > 1) parts.push(cb('zone', '', M.role === 'hrbp' ? 'Моя зона' : 'Вся зона', 'Вся ваша зона видимости.'));
    if (h && h.roots.length > 1) parts.push(cb('hz', '', 'Зона ' + h.nm, 'Вся зона HRBP «' + h.nm + '».'));
    for (var j = Math.max(start, 0); j < chain.length - 1; j++) parts.push(cb('unit', chain[j], unitName(M, chain[j])));
    parts.push('<b>' + esc(unitName(M, id)) + '</b>');
    if (start > -1 && start < chain.length - 1) up = { key: 'unit', id: chain[chain.length - 2], nm: unitName(M, chain[chain.length - 2]) };
    else if (M.roots.length > 1) up = { key: 'zone', id: '', nm: M.role === 'hrbp' ? 'моя зона' : 'вся зона' };
  }
  if (up) nav += '<button type="button" class="' + P + '-nb" data-action="crumb" data-key="' + up.key + '" data-id="' + esc(up.id) + '"'
    + tip({ title: 'Уровнем выше', text: 'Перейти к «' + up.nm + '».' }) + '>↑ Уровнем выше</button>';
  return (nav ? '<span class="' + P + '-navs">' + nav + '</span>' : '') + '<span class="' + P + '-crumbs">' + parts.join('<span class="' + P + '-csep">›</span>') + '</span>';
}
// Всё, что нужно таблице «Команд»: колонки, строки (с поиском и сортировкой), выбранная строка.
// Таблица перерисовывается отдельно от страницы, когда набирают поиск (поле не теряет фокус).
function teamsCtx() {
  var live = [['all', 'Все метрики']];
  for (var b = 0; b < CFG.blocks.length; b++) if (selMetrics(CFG.blocks[b].key).length) live.push([CFG.blocks[b].key, CFG.blocks[b].tab || CFG.blocks[b].name]);
  var blk = 'all';
  for (var q = 0; q < live.length; q++) if (live[q][0] === state.block) blk = state.block;
  var mets = selMetrics(blk === 'all' ? '' : blk), keys = [];
  for (var mk = 0; mk < mets.length; mk++) keys.push(mets[mk].key);
  var tq = String(state.tq || '').replace(/^\s+|\s+$/g, '').toLowerCase(), sr = tq ? teamSearch(tq) : null;
  var rows = teamRows(false, sr ? sr.open : null);
  if (sr) {
    var shown = [];
    for (var s0 = 0; s0 < rows.length; s0++) if (sr.show[rows[s0].key] || sr.open[rows[s0].pfx]) shown.push(rows[s0]);
    rows = shown;
  }
  if (state.focusOnly) {
    var kept = [];
    for (var f = 0; f < rows.length; f++) if (rows[f].id && rows[f].id !== '·' && ownLive(rows[f].id, keys)) kept.push(rows[f]);
    rows = kept;
  }
  // Выбранная строка ищется во всём дереве: свёрнутый родитель или поиск её не сбрасывают.
  var every = teamRows(true), sel = null, expandable = [];
  for (var r0 = 0; r0 < every.length; r0++) {
    if (every[r0].key === state.selTeam) sel = every[r0];
    if (rowCanExp(every[r0])) expandable.push(every[r0].pfx);
  }
  var allOpen = expandable.length > 0;
  for (var e2 = 0; e2 < expandable.length; e2++) if (!state.openRows[expandable[e2]]) allOpen = false;
  return { live: live, blk: blk, mets: mets, keys: keys, rows: rows, sel: sel, sr: sr, tq: tq, expandable: expandable, allOpen: allOpen };
}
// Заголовок колонки с сортировкой: стрелка — только у активной колонки (профиль Adoption).
function sortTh(key, label, cls, tipObj, extra) {
  var P = CFG.ns, ts = state.tsort || {}, on = ts.key === key;
  var t = tipObj || {};
  var note = on ? (ts.dir === 'asc' ? 'Сейчас по возрастанию. Клик — ' + (key === 'name' ? 'по убыванию.' : 'как было (по численности).') : 'Сейчас по убыванию. Клик — ' + (key === 'name' ? 'как было (по численности).' : 'по возрастанию.'))
    : 'Клик — сортировка ' + (key === 'name' ? 'по алфавиту' : 'по этой колонке') + ' внутри каждого уровня.';
  return '<th class="' + P + '-sth' + (cls ? ' ' + cls : '') + (on ? ' ' + P + '-son' : '') + '"' + (extra || '') + ' data-action="tsort" data-key="' + key + '" tabindex="0" aria-sort="'
    + (on ? (ts.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' + tip({ title: t.title || label, text: t.text || '', note: note }) + '>'
    + esc(label) + (on ? '<span class="' + P + '-sa">' + (ts.dir === 'asc' ? '↑' : '↓') + '</span>' : '') + '</th>';
}
function teamsTableHTML(tc) {
  var P = CFG.ns, M = MODEL, mets = tc.mets, keys = tc.keys, rows = tc.rows, sel = tc.sel;
  // «Все метрики»: над колонками — строка групп, между группами — вертикальная линия.
  var grouped = tc.blk === 'all', gcls = {}, head2 = '';
  if (grouped) {
    head2 = '<tr class="' + P + '-thg">' + sortTh('name', 'Юнит', P + '-l', { title: 'Юнит', text: 'Юниты на 3 уровня вниз от юнита отчёта. Глубже — выберите строку и откройте её юнит иконкой у правого края.' }, ' rowspan="2"');
    var prevB = '';
    for (var gb = 0; gb < CFG.blocks.length; gb++) {
      var gm = selMetrics(CFG.blocks[gb].key);
      if (!gm.length) continue;
      head2 += '<th colspan="' + gm.length + '" class="' + P + '-grp' + (prevB ? ' ' + P + '-gs' : '') + '">' + esc(CFG.blocks[gb].tab || CFG.blocks[gb].name) + '</th>';
      if (prevB) gcls[gm[0].key] = P + '-gs';
      prevB = CFG.blocks[gb].key;
    }
    head2 += '</tr><tr>';
  }
  var t = '<table class="' + P + '-t' + (grouped ? ' ' + P + '-g2' : '') + '"><thead>'
    + (grouped ? head2 : '<tr>' + sortTh('name', 'Юнит', P + '-l', { title: 'Юнит', text: 'Юниты на 3 уровня вниз от юнита отчёта. Глубже — выберите строку и откройте её юнит иконкой у правого края.' }));
  for (var h = 0; h < mets.length; h++) t += sortTh(mets[h].key, mets[h].short, gcls[mets[h].key] || '', metricTip(mets[h]));
  t += '</tr></thead><tbody>';
  t += '<tr class="' + P + '-row ' + P + '-tot' + (!sel ? ' ' + P + '-sel' : '') + '" data-action="team" data-key="" tabindex="0" aria-selected="' + (!sel ? 'true' : 'false') + '">'
    + '<td class="' + P + '-l"><span class="' + P + '-rl">'
    + (tc.expandable.length && !tc.tq ? hCaret(tc.allOpen, 'expall', tc.allOpen ? '0' : '1', tc.allOpen ? 'Свернуть всё' : 'Развернуть всё', { title: tc.allOpen ? 'Свернуть всё' : 'Развернуть всё', text: 'Все три уровня — сразу.' }) : '<span class="' + P + '-cars"></span>')
    + '<span class="' + P + '-rb"><span class="' + P + '-nml"><span class="' + P + '-nm"' + tip({ title: 'ИТОГО · ' + scopeLabel(), text: 'Юнит отчёта целиком.' }) + '>ИТОГО · ' + esc(scopeLabel()) + '</span></span><span class="' + P + '-us">' + fmtInt(hcOf(M.scope)) + ' чел</span></span></span></td>';
  for (var tm = 0; tm < mets.length; tm++) t += unitCell(scopeUnit(), M.scope, mets[tm], !sel, gcls[mets[tm].key]);
  t += '</tr>';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    // Отступ дерева: 12 px на уровень, но не больше 8 ступеней — на 12 уровнях имя не сжимается в столбик,
    // а глубину договаривает подпись «ур. N».
    var ind = '<span class="' + P + '-ind" style="width:' + (Math.min(row.lvl - 1, 8) * 12) + 'px"></span>';
    var isSel = sel && sel.key === row.key, uid = rowUnit(row), unit = M.units[row.id];
    var canExp = rowCanExp(row), open = !!state.openRows[row.pfx] || !!(tc.sr && tc.sr.open[row.pfx]);
    var hit = tc.sr && tc.sr.show[row.key];
    // На границе глубины подразделения ниже не приехали — говорим, сколько их и как увидеть.
    var below = M.depth === '3' && row.lvl >= 3 && !canExp && unit && unit.nk > 0 ? unit.nk : 0;
    var nOwn = row.id !== '·' ? ownLive(row.id, keys) : 0;
    var hidOwn = [];
    if (row.id !== '·') { var allOwn = ownRules(row.id, ''); for (var ho = 0; ho < allOwn.length; ho++) if (keys.indexOf(allOwn[ho].metric) > -1 && !ruleMatches(allOwn[ho])) hidOwn.push(allOwn[ho]); }
    // Переход в юнит — только у выбранной строки и иконкой у правого края колонки имён:
    // клик по строке выбирает её для графиков справа и никуда не уводит.
    var drill = isSel && row.id !== '·' ? drillBtn(row.id) : '<span class="' + P + '-dsl"></span>';
    // Длинное имя — в одну строку с «…» (целиком — в подсказке и у выбранной строки).
    var chain = row.id !== '·' ? pathTo(row.id) : [], up = [];
    for (var ci0 = Math.max(0, chain.length - 4); ci0 < chain.length - 1; ci0++) up.push(unitName(M, chain[ci0]));
    var nmTip = tip({ title: rowName(row), text: up.length ? up.join(' › ') : '' });
    t += '<tr class="' + P + '-row' + (row.lvl >= 2 ? ' ' + P + '-lv2' : '') + (isSel ? ' ' + P + '-sel' : '') + (tc.sr ? ' ' + P + (hit ? '-fnd' : '-anc') : '') + '" data-action="team" tabindex="0" aria-selected="' + (isSel ? 'true' : 'false') + '" data-key="' + esc(row.key) + '">'
      + '<td class="' + P + '-l"><span class="' + P + '-rl">' + ind
      + (canExp && !tc.sr ? hCaret(open, 'exp', row.pfx, 'Раскрыть детализацию', { title: 'Детализация', text: 'Подразделения «' + unitName(M, row.id) + '».' }) : '<span class="' + P + '-cars"></span>')
      + '<span class="' + P + '-rb"><span class="' + P + '-nml"><span class="' + P + '-nm"' + nmTip + '>' + (row.id !== '·' && tc.tq ? hlText(rowName(row), tc.tq) : esc(rowName(row))) + '</span>'
      + (nOwn ? '<span class="' + P + '-tag ' + P + '-own"' + tip({ title: 'Фокус юнита', text: 'На юнит поставлены цели — они действуют и на его подразделения.', rows: [{ label: 'целей в фокусе', value: String(nOwn) }] }) + '>★ Фокус</span>' : '')
      + moreFocus(hidOwn, true)
      + (unit && !unit.cur ? '<span class="' + P + '-gone">нет в структуре</span>' : '') + '</span>'
      + '<span class="' + P + '-us">' + (unit ? esc(levelShort(unit.lvl)) + ' · ' : '') + fmtInt(hcOf(row.ser)) + ' чел'
      + (below ? ' · <span class="' + P + '-below"' + tip({ title: 'Ниже ещё ' + below + ' ' + plural(below, 'подразделение', 'подразделения', 'подразделений'),
          text: 'Чтобы увидеть их, откройте юнит строки иконкой справа.' }) + '>ниже ещё ' + below + '</span>' : '')
      + '</span></span>' + drill + '</span></td>';
    for (var mm = 0; mm < mets.length; mm++) t += unitCell(uid, row.ser, mets[mm], isSel, gcls[mets[mm].key]);
    t += '</tr>';
  }
  if (!rows.length) {
    t += '<tr><td class="' + P + '-l" colspan="' + (mets.length + 1) + '"><span class="' + P + '-muted">'
      + (tc.tq ? 'В таблице нет юнитов с «' + esc(state.tq) + '». Поиск по всей зоне — в «Фильтрах».'
        : (state.focusOnly ? 'С «Только фокусные» юнитов не осталось: своих целей здесь нет.' : 'У юнита нет подразделений с людьми под текущими фильтрами.'))
      + '</span></td></tr>';
  }
  return t + '</tbody></table>';
}
function teamsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L;
  // Без заголовка вкладки: юнит и фильтры — в липкой строке контекста; группы, легенда и глубина — одной
  // строкой над таблицей (владелец 12.10: «мало информации на экране»).
  var s = '', tc = teamsCtx();
  if (tc.live.length === 1) return s + hEmpty('Метрики не выбраны', 'Включите их в «Фильтрах», раздел «Что показывать».');
  s += '<div class="' + P + '-tools">' + hSubs(tc.live, tc.blk, 'block') + '<span class="' + P + '-sp2"></span>' + legendHTML(false, true, true)
    + '<span class="' + P + '-dhint"' + tip({ title: '3 уровня вниз', text: 'Чтобы пойти глубже, выберите строку и откройте её юнит иконкой справа.' })
    + '>' + (M.depth === 'all' ? 'Все уровни' : '3 уровня вниз') + ' ' + OPEN_SVG + '</span></div>';
  if (!M.scope) return s + hEmpty('Нет людей под этими фильтрами', 'Снимите один из фильтров: × у его чипа над отчётом.');
  var sel = tc.sel, mets = tc.mets;
  var cur = sel || { lvl: 0, id: '', ser: M.scope, key: '' };
  // Только помесячно (13.10: недели убраны — такой гранулярностью HRBP не работают).
  var cu = sel ? rowUnit(sel) : scopeUnit(), charts = '', gated = 0;
  for (var cm = 0; cm < mets.length; cm++) {
    NOCOL = smallHide(cur.ser, mets[cm]);
    if (NOCOL) gated++;
    var ysp = yoySpec(cu, cur.ser, mets[cm]);
    NOCOL = false;
    charts += chartBlock('side', 'tm:' + mets[cm].key + ':yoy:' + cu + ':' + cur.key, mets[cm].name, ysp, -1);
  }
  var right = '<div class="' + P + '-dyn">'
    + (gated ? '<div class="' + P + '-snote">' + 'В строке ' + fmtInt(hcOf(cur.ser)) + ' чел.: ' + gated + ' ' + plural(gated, 'метрика', 'метрики', 'метрик') + ' без цвета (' + esc(smallRule()) + ').</div>' : '') + charts + '</div>';
  var info = hInfo({ title: 'Как читать таблицу', text: 'Значения за ' + monthLow(L) + '. Цвет — сравнение с целью юнита, а без цели — с базой.',
    note: ['Клик по строке — её графики справа.', '«Напрямую в …» — люди самого юнита, без подразделений.'] });
  var mode = state.narrow ? 'both' : (state.splitMode || 'both');
  var search = '<span class="' + P + '-tsw">' + SEARCH_SVG + '<input class="' + P + '-srch" type="text" data-tsearch="1" placeholder="Поиск юнита в таблице" value="' + esc(state.tq || '') + '"></span>';
  var left = hPanel({ cls: P + '-tpan', title: 'Юниты', info: info,
    body: '<div data-tbox="1">' + teamsTableHTML(tc) + '</div>', tbl: true, tabs: '<span class="' + P + '-pbtn">' + search + copyBtn('teams') + splitBtn('table') + '</span>' });
  var subTxt = sel ? rowName(sel) : 'ИТОГО · ' + scopeLabel();
  var subHtml = '<span' + tip({ title: subTxt, text: 'Графики по этой строке.' }) + '>' + esc(subTxt) + '</span>';
  var rightP = hPanel({ cls: P + '-dpan', title: 'Динамика', subHtml: subHtml, body: right,
    tabs: '<span class="' + P + '-pbtn">' + (sel && sel.id !== '·' ? drillBtn(sel.id) : '') + splitBtn('charts') + '</span>' });
  var sh = state.split || splitAuto(mets.length);
  if (mode === 'table') s += '<div class="' + P + '-split ' + P + '-sp1">' + left + splitRail('Динамика', '◂') + '</div>';
  else if (mode === 'charts') s += '<div class="' + P + '-split ' + P + '-sp2c">' + splitRail('Юниты', '▸') + rightP + '</div>';
  else {
    s += '<div class="' + P + '-split" data-split-box="1" data-mets="' + mets.length + '" style="grid-template-columns:' + splitCols(sh) + '">' + left
      + '<div class="' + P + '-gut" data-split="1" role="separator" aria-orientation="vertical" aria-label="Ширина таблицы" aria-valuemin="' + Math.round(CFG.split.min * 100)
      + '" aria-valuemax="' + Math.round(CFG.split.max * 100) + '" aria-valuenow="' + Math.round(sh * 100) + '" tabindex="0"'
      + tip({ title: 'Ширина колонок', text: 'Потяните, чтобы дать место таблице или графикам. Двойной клик — как было.' }) + '><i></i></div>'
      + rightP + '</div>';
  }
  return s;
}
// Доля таблицы по умолчанию — по числу колонок метрик (владелец 12.10): «Удержание» (2) и «Текучесть» (3) —
// уже, «Все метрики» — CFG.split.def. Имя ≈ 300 px + 104 px на метрику, в пределах min…def. Подвинули
// разделитель руками — доля держится между группами и вкладками; двойной клик — снова по умолчанию.
function splitAuto(n) {
  var C = CFG.split, W = state.splitW || 0;
  var sh = W > 300 ? (300 + 104 * n) / (W - 12) : 0.24 + 0.06 * n;
  return Math.max(C.min, Math.min(C.def, sh));
}
function splitCols(sh) {
  return state.narrow ? 'minmax(0,1fr)' : 'minmax(0,' + (sh * 100).toFixed(2) + 'fr) 12px minmax(0,' + ((1 - sh) * 100).toFixed(2) + 'fr)';
}

// ---- копирование таблиц «Команд» и «Трансформеров» в буфер (TSV — вставляется в Excel) ----
// Числа — без «%», с запятой; у маленьких команд — тоже значения (HRBP 13.10).
var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
function copyBtn(kind) {
  var P = CFG.ns;
  return '<button type="button" class="' + P + '-ib" data-action="copy" data-key="' + kind + '" aria-label="Копировать таблицу"'
    + tip({ title: 'Копировать таблицу', text: kind === 'teams' ? 'Все три уровня — в буфер обмена: вставьте в Excel или письмо.' : 'Сводная по оси — в буфер обмена: вставьте в Excel или письмо.',
            note: 'Числа — без «%», с запятой.' }) + '>' + COPY_SVG + '</button>';
}
function tsvCell(v) { return String(v === null || v === undefined ? '' : v).replace(/[\t\r\n]+/g, ' '); }
function tsvNum(m, v) {
  if (v === null || v === undefined || !isFinite(v)) return '';
  return m.fmt === 'int' ? String(Math.round(v)) : round1(v).toFixed(1).replace('.', ',');
}
function teamsTSV() {
  // Колонка численности — если метрики «Численность» среди показанных нет (иначе она дублируется).
  var M = MODEL, L = M.L, mets = teamsCtx().mets, rows = teamRows(true), out = [], hcCol = mets.indexOf(METRIC.headcount) < 0;
  var head = ['Юнит', 'Уровень вниз', 'Уровень структуры'].concat(hcCol ? ['Численность'] : []);
  for (var h = 0; h < mets.length; h++) head.push(mets[h].name + (mets[h].fmt === 'int' ? '' : ', %'));
  out.push(head.join('\t'));
  function line(name, lv, unit, ser) {
    var a = [tsvCell(name), lv, unit ? tsvCell(levelShort(unit.lvl)) : ''].concat(hcCol ? [String(hcOf(ser))] : []);
    for (var k = 0; k < mets.length; k++) a.push(tsvNum(mets[k], mval(ser, 'm', mets[k], L)));
    out.push(a.join('\t'));
  }
  line('ИТОГО · ' + scopeLabel(), '0', null, M.scope);
  for (var i = 0; i < rows.length; i++) line(rowName(rows[i]), String(rows[i].lvl), M.units[rows[i].id], rows[i].ser);
  return { text: out.join('\n'), n: rows.length + 1 };
}
function trTSV() {
  var M = MODEL, L = M.L, avail = selMetrics(''), out = [];
  if (!avail.length || !M.scope) return { text: '', n: 0 };
  var m = avail[0];
  for (var a = 0; a < avail.length; a++) if (avail[a].key === state.tfMetric) m = avail[a];
  var axis = wantAxis(), list = trSorted(axis), head = [axisLabel(axis), 'Численность'];
  for (var k = L - 11; k <= L; k++) head.push(monthLabel(k));
  head.push('За 12 мес, ' + (m.fmt === 'int' ? 'чел.' : 'п.п.'));
  out.push(tsvCell(m.name + (m.fmt === 'int' ? '' : ', %') + ' · ' + scopeLabel() + ' · ' + selLabel()));
  out.push(head.join('\t'));
  function line(name, ser) {
    var row = [tsvCell(name), String(hcOf(ser))];
    for (var c = L - 11; c <= L; c++) row.push(tsvNum(m, mval(ser, 'm', m, c)));
    row.push(tsvNum(m, deltaOf(m, mval(ser, 'm', m, L), mval(ser, 'm', m, L - 11))));
    out.push(row.join('\t'));
  }
  line('ИТОГО · ' + scopeLabel(), M.scope);
  for (var i = 0; i < list.length; i++) line(trName(list[i]), list[i].ser);
  return { text: out.join('\n'), n: list.length + 1 };
}

// ---- вкладка «Трансформеры» ----
function axisLabel(k) { for (var i = 0; i < CFG.axes.length; i++) if (CFG.axes[i].key === k) return CFG.axes[i].label; return k; }
function wantAxis() { return state.tfAxis || MODEL.axis || CFG.defaultAxis; }
function isCutAxis(k) { for (var i = 0; i < CFG.cuts.length; i++) if (CFG.cuts[i].key === k) return true; return false; }
// Ось уже в ответе — переключение без запроса.
function axisReady(k) { return isCutAxis(k) || MODEL.trAll || MODEL.axis === k; }
// Сумма рядов значений (для строки «Остальные»): только месяцы — недель у трансформера нет.
function sumTr(list) {
  var out = { m: {}, w: {} };
  for (var c = 0; c < COMP.length; c++) {
    var k = COMP[c], acc = null;
    for (var i = 0; i < list.length; i++) {
      var a = list[i].ser.m[k];
      if (!a) continue;
      if (!acc) { acc = []; for (var z = 0; z < a.length; z++) acc.push(0); }
      for (var j = 0; j < a.length; j++) acc[j] += a[j] || 0;
    }
    out.m[k] = acc;
    out.w[k] = null;
  }
  return out;
}
// Число значений оси (с учётом свёрнутых датасетом в '…').
function trCount(axis) { var t = MODEL.trBy[axis] || [], n = 0; for (var i = 0; i < t.length; i++) n += t[i].v === '…' ? t[i].n : 1; return n; }
function trSorted(axis) {
  var all = MODEL.trBy[axis] || [], list = [], rest = [], restN = 0, ord = CFG.order[axis];
  // Хвост мелких значений (город, офис) датасет уже свернул в '…' (n — сколько их); если значений
  // всё равно больше CFG.trTop — крупнейшие остаются, прочие уходят туда же, в «Остальные».
  for (var r0 = 0; r0 < all.length; r0++) { if (all[r0].v === '…') { rest.push(all[r0]); restN += all[r0].n; } else list.push(all[r0]); }
  if (list.length > CFG.trTop) {
    list.sort(function (a, b) { return hcOf(b.ser) - hcOf(a.ser) || (a.v < b.v ? -1 : 1); });
    rest = rest.concat(list.slice(CFG.trTop));
    restN += list.length - CFG.trTop;
    list = list.slice(0, CFG.trTop);
  }
  var numeric = list.length > 0;
  // Числовая ось (грейд): по возрастанию, а не по численности.
  for (var i = 0; i < list.length; i++) if (!/^\d+(?:[.,]\d+)?$/.test(String(list[i].v))) numeric = false;
  list.sort(function (a, b) {
    if (numeric) return num(a.v) - num(b.v);
    if (ord) {
      var ia = ord.indexOf(a.v), ib = ord.indexOf(b.v);
      if (ia > -1 || ib > -1) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    }
    return hcOf(b.ser) - hcOf(a.ser) || (a.v < b.v ? -1 : 1);
  });
  if (rest.length) list.push({ v: '…', rest: restN, ser: rest.length === 1 ? rest[0].ser : sumTr(rest) });
  return list;
}
// Пустое значение разреза / атрибута в кубе — '-' (ноут), в подписи — «не указано».
// Имя значения разреза или атрибута — СТРОКА (фильтры, чипы); строка трансформера — trName.
// 29.09 trName стал принимать строку трансформера, а фильтры разрезов продолжали звать его
// со строкой — значения в фильтрах рисовались без имён. Не сливать обратно.
function cutName(v) { return v === '' || v === '-' || v === '·' || v == null ? 'не указано' : String(v); }
function trName(r) {
  if (r.rest) return 'Остальные · ' + r.rest + ' ' + plural(r.rest, 'значение', 'значения', 'значений');
  return cutName(r.v);
}
// Готовые срезы: одна строка пилюль-вопросов; выбранный — фоном. Клик ставит метрику и разбивку разом.
function presetsHTML(avail, mk, axis) {
  var P = CFG.ns, on = {}, s = '';
  for (var i = 0; i < avail.length; i++) on[avail[i].key] = true;
  for (var k = 0; k < CFG.trPresets.length; k++) {
    var pr = CFG.trPresets[k], cur = pr.m === mk && pr.a === axis;
    if (!on[pr.m]) continue;
    s += '<button type="button" class="' + P + '-tfp' + (cur ? ' ' + P + '-on' : '') + '" data-action="tfp" data-key="' + k + '" aria-pressed="' + (cur ? 'true' : 'false') + '"'
      + tip({ title: pr.t, text: pr.q, rows: [{ label: 'метрика', value: METRIC[pr.m] ? METRIC[pr.m].name : pr.m }, { label: 'разбивка', value: axisLabel(pr.a) }] }) + '>' + esc(pr.t) + '</button>';
  }
  return s ? '<div class="' + P + '-tfps" data-tfps="1"><span class="' + P + '-ctll">Готовые срезы</span>' + s + '</div>' : '';
}
function transformHTML() {
  var P = CFG.ns, M = MODEL, L = M.L;
  var s = pageHead('Трансформеры', 'Метрика в разбивке по грейду, стажу, городу и другим признакам за 12 месяцев.');
  var avail = selMetrics('');
  if (!avail.length) return s + hEmpty('Метрики не выбраны', 'Включите их в «Фильтрах», раздел «Что показывать».');
  var m = avail[0];
  for (var a = 0; a < avail.length; a++) if (avail[a].key === state.tfMetric) m = avail[a];
  var axis = wantAxis(), mOpts = [], aOpts = [];
  for (var i = 0; i < avail.length; i++) mOpts.push([avail[i].key, avail[i].name]);
  for (var j = 0; j < CFG.axes.length; j++) aOpts.push([CFG.axes[j].key, CFG.axes[j].label]);
  s += '<div class="' + P + '-tools">'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('tfm', mOpts, m.key) + '</div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Разбивка</span>' + hSel('tfa', aOpts, axis) + '</div>'
    + '</div>' + presetsHTML(avail, m.key, axis);
  // Все 17 осей приезжают с каждым ответом — смена оси мгновенная. Запасной режим датасета
  // (TR_ALL_MAX): у большой ветки с разрезами атрибут догружается один раз по запросу.
  if (!axisReady(axis)) {
    if (state.pend) return s + hEmpty('Загружаю разбивку «' + axisLabel(axis) + '»', 'Для большой ветки с фильтрами разбивка считается отдельно — это один раз.');
    return s + hEmpty('Разбивка «' + axisLabel(axis) + '» ещё не загружена', 'Для большой ветки с фильтрами разбивка считается отдельно. Нажмите «Загрузить».')
      + '<div class="' + P + '-tnote"><button class="' + P + '-btn ' + P + '-pri" data-action="axis" data-key="' + esc(axis) + '">Загрузить</button></div>';
  }
  var list = trSorted(axis), months = [];
  if (!list.length || !M.scope) return s + hEmpty('Нет данных для разбивки', 'В юните нет людей под текущими фильтрами.');
  for (var k = L - 11; k <= L; k++) months.push(k);
  // Хитмап (13.10): ячейка — значение месяца, фон — насколько оно лучше или хуже «Всего» юнита в том же месяце
  // (зелёный / красный, сильнее — дальше; ±5 % и маленькие строки — без цвета); у метрик без «лучше» (численность,
  // non-regrettable) — один синий по величине. Строка — клик выбирает значение: его линия на графике «Всего»,
  // его доля на кольце; наведение подсвечивает строку и долю (trLink).
  var yt = m.ytd && ytdOn(m), flat = m.better === 'flat' || m.fmt === 'int', mx = 0, pick = -1;
  function cv(ser, k) { return yt && k < 12 ? null : mval(ser, 'm', m, k); }
  for (var q = 0; q < list.length; q++) {
    if (list[q].v === state.trPick) pick = q;
    for (var q2 = 0; q2 < months.length; q2++) mx = Math.max(mx, Math.abs(cv(list[q].ser, months[q2]) || 0));
  }
  var th = '<table class="' + P + '-t ' + P + '-heat"><thead><tr><th class="' + P + '-l">' + esc(axisLabel(axis)) + '</th>';
  for (var hm = 0; hm < months.length; hm++) {
    var pp = dparts(M.cal.m[months[hm]].s);
    th += '<th>' + esc(MONTH_ABBR[pp.m] + (hm === 0 || pp.m === 0 ? ' ' + String(pp.y).slice(2) : '')) + '</th>';
  }
  th += '<th class="' + P + '-vs">За 12 мес<span class="' + P + '-hc">к ' + esc(monthDat(L - 11)) + '</span></th></tr></thead><tbody>';
  function prow(name, ser, cls, idx) {
    NOCOL = smallHide(ser, m);
    var tot = idx < 0, r = '<tr class="' + cls + (idx === pick && !tot ? ' ' + P + '-sel' : '') + '"'
      + (tot || list[idx].rest ? '' : ' data-trv="' + idx + '" data-action="trpick" data-key="' + idx + '" tabindex="0" aria-pressed="' + (idx === pick ? 'true' : 'false') + '"')
      + '><td class="' + P + '-l"' + (NOCOL ? tip({ title: m.name, text: smallWhy(ser, m) }) : '') + '>' + esc(name) + '<span class="' + P + '-us">' + fmtInt(hcOf(ser)) + ' чел' + (NOCOL ? ' · без цвета' : '') + '</span></td>';
    for (var c = 0; c < months.length; c++) {
      var k = months[c], v = cv(ser, k), t = cv(M.scope, k), bg = '';
      if (v !== null && !tot && !NOCOL) bg = flat ? heatSeq(v, mx) : heatDiv(m, v, t);
      var rows = [{ label: name.length > 28 ? name.slice(0, 27) + '…' : name, value: fmtVal(m, v), color: C0.cur, line: true }].concat(v === null ? [] : absRows(m, ser, k));
      if (!tot && t !== null) rows.push({ label: 'Всего', value: fmtVal(m, t), color: C0.prev, line: true, dim: true });
      r += '<td class="' + (c === months.length - 1 ? P + '-now' : '') + '"' + (bg ? ' style="background:' + bg + '"' : '')
        + tip({ title: monthFull(k), rows: rows, note: tot ? null : (NOCOL ? 'Без цвета: мало людей.' : (v !== null && t !== null && !flat ? heatTxt(m, v, t) : null)) }) + '>' + esc(fmtVal(m, v)) + '</td>';
    }
    if (isCum(m)) r += '<td class="' + P + '-vs"' + tip({ title: 'За 12 мес', text: 'С начала года значение копится, поэтому сравнивать с ' + monthDat(L - 11) + ' не имеет смысла.' }) + '>' + hPill('flat', '—') + '</td></tr>';
    else r += deltaTd(m, deltaOf(m, mval(ser, 'm', m, L), mval(ser, 'm', m, L - 11)), 'Изменение за 12 месяцев: ' + monthLow(L) + ' к ' + monthDat(L - 11) + '.', P + '-vs', mval(ser, 'm', m, L - 11)) + '</tr>';
    NOCOL = false;
    return r;
  }
  var C0 = CFG.colors;
  th += prow('ИТОГО · ' + scopeLabel(), M.scope, P + '-tot', -1);
  for (var rr = 0; rr < list.length; rr++) th += prow(trName(list[rr]), list[rr].ser, list[rr].rest ? P + '-rest' : P + '-trr', rr);
  th += '</tbody></table>';
  var leg = '<div class="' + P + '-hleg">' + (flat ? '<span><i style="background:' + heatSeq(1, 1) + '"></i>больше — темнее</span>'
    : '<span><i style="background:' + heatDiv(m, m.better === 'higher' ? 1.3 : 0.7, 1) + '"></i>лучше, чем «Всего»</span><span><i style="background:' + heatDiv(m, m.better === 'higher' ? 0.7 : 1.3, 1) + '"></i>хуже</span><span><i></i>±5% или мало людей</span>')
    + '<span class="' + P + '-us">Клик по строке — её линия на графике и доля на кольце.</span></div>';
  var nv = trCount(axis), sel = pick > -1 ? list[pick] : null;
  return s + '<div class="' + P + '-trbox" data-trbox="1"><div class="' + P + '-trtop">'
    + hPanel({ cls: P + '-trln', title: 'Динамика · ' + (sel ? trName(sel) + ' и всего' : 'всего по юниту'), sub: sel ? 'серая — всего по юниту' : 'выберите строку таблицы, чтобы сравнить',
        body: trLineBlock(m, sel, months), tabs: sel ? '<span class="' + P + '-pbtn"><button type="button" class="' + P + '-btn ' + P + '-ghost" data-action="trpick" data-key="-1">Сбросить</button></span>' : '' })
    + hPanel({ cls: P + '-trpie', title: 'Структура · ' + axisLabel(axis), sub: monthFull(L), body: trPieHTML(m, list, pick), tabs: trPieSw(m) })
    + '</div><div class="' + P + '-gap">' + hPanel({ title: m.name + ' · ' + axisLabel(axis),
    sub: 'последний месяц выделен · ' + nv + ' ' + plural(nv, 'значение', 'значения', 'значений'),
    body: th + leg, tbl: true, tabs: '<span class="' + P + '-pbtn">' + copyBtn('tr') + '</span>' }) + '</div></div>';
}
// Цвет ячейки хитмапа: два полюса (лучше — зелёный, хуже — красный) от «Всего» того же месяца, серая середина ±5 %;
// насыщенность — по отклонению до 30 %. Текст ячейки — всегда чернилами (цвет — только фон).
function heatDiv(m, v, t) {
  if (v === null || t === null || !t) return '';
  var d = (v - t) / Math.abs(t);
  if (Math.abs(d) <= CFG.deadZone) return '';
  var good = (m.better === 'higher') === (d > 0), a = 0.08 + 0.26 * Math.min(1, (Math.abs(d) - CFG.deadZone) / 0.25);
  return (good ? 'rgba(17,128,74,' : 'rgba(203,46,46,') + a.toFixed(2) + ')';
}
function heatSeq(v, mx) { return mx > 0 ? 'rgba(43,108,255,' + (0.05 + 0.25 * Math.min(1, Math.abs(v) / mx)).toFixed(2) + ')' : ''; }
function heatTxt(m, v, t) {
  var d = (v - t) / Math.abs(t || 1);
  if (Math.abs(d) <= CFG.deadZone) return 'Как «Всего» (±5%).';
  return ((m.better === 'higher') === (d > 0) ? 'Лучше' : 'Хуже') + ', чем «Всего»: ' + fmtDelta(m, deltaOf(m, v, t)) + '.';
}
// График над таблицей: «Всего» по юниту за 12 месяцев; выбрана строка — её линия акцентом, «Всего» — серая.
function trLineBlock(m, sel, months) {
  var M = MODEL, yt = m.ytd && ytdOn(m), cur = [], prev = [], labels = [], heads = [];
  function cv(ser, k) { return yt && k < 12 ? null : mval(ser, 'm', m, k); }
  for (var i = 0; i < months.length; i++) {
    var k = months[i];
    cur.push(cv(sel ? sel.ser : M.scope, k));
    prev.push(sel ? cv(M.scope, k) : null);
    labels.push(MONTH_ABBR[dparts(M.cal.m[k].s).m]);
    heads.push(monthFull(k));
  }
  var nm = sel ? trName(sel) : 'Всего';
  var spec = { m: m, ytd: yt, cum: isCum(m), labels: labels, cur: cur, prev: prev, ref: null, refKind: 'none', boldIdx: months.length - 1, heads: heads, prevHeads: null,
               curName: nm.length > 24 ? nm.slice(0, 23) + '…' : nm, prevName: 'Всего', noPrev: !sel, tips: { cur: sel ? 'Значение «' + nm + '» по месяцам.' : 'Весь юнит по месяцам.', prev: 'Весь юнит по месяцам.' } };
  return chartBlock('story', 'tr:' + m.key + ':' + wantAxis() + ':' + (sel ? sel.v : ''), 'Помесячно, 12 месяцев', spec, CFG.chart.story - 40);
}
// Кольцо: доли значений в людях (или в числителе метрики: уходы, новички, джуны…) на последний месяц — пять
// крупнейших и «Остальные» серым (не больше 6 сегментов). Цвета — категориальные по порядку, рядом список
// с числами (три светлых цвета ниже 3:1 к фону — подписи обязательны).
var PIE_C = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
function fmtPct1(x) { return fmtNum1(x) + '%'; }
function trPieOf(m, ser) {
  if (state.trPie !== 'num' || m.fmt === 'int') return hcOf(ser);
  var a = absParts(m, ser, MODEL.L);
  return a ? Math.round(a.num) : 0;
}
function trPieSw(m) {
  var f = metricFrac(m);
  if (m.fmt === 'int' || !f) return '';
  return '<span class="' + CFG.ns + '-pbtn">' + hSeg([['hc', 'Люди'], ['num', capFirst(f[0]).replace(/\s*\(.*\)$/, '')]], state.trPie === 'num' ? 'num' : 'hc', 'trpie') + '</span>';
}
function trPieHTML(m, list, pick) {
  var P = CFG.ns, seg = [], other = 0, tot = 0, i;
  for (i = 0; i < list.length; i++) {
    var n = trPieOf(m, list[i].ser);
    tot += n;
    if (list[i].rest) other += n; else seg.push({ i: i, n: n, nm: trName(list[i]) });
  }
  seg.sort(function (a, b) { return b.n - a.n; });
  for (i = 5; i < seg.length; i++) other += seg[i].n;
  seg = seg.slice(0, 5);
  if (other > 0) seg.push({ i: -2, n: other, nm: 'Остальные' });
  if (!tot) return '<div class="' + P + '-nores">Нет людей за ' + esc(monthLow(MODEL.L)) + '</div>';
  var R = 62, w = 20, cx = 72, cy = 72, a0 = -Math.PI / 2, svg = '<svg class="' + P + '-pie" width="144" height="144" viewBox="0 0 144 144">', lg = '';
  for (i = 0; i < seg.length; i++) {
    var g = seg[i], sh = g.n / tot, a1 = a0 + sh * 2 * Math.PI, col = g.i === -2 ? CFG.colors.neutral : PIE_C[i], on = g.i === pick;
    var tipH = tip({ title: g.nm, rows: [{ label: state.trPie === 'num' && m.fmt !== 'int' ? 'в числителе' : 'людей', value: fmtInt(g.n) }, { label: 'доля', value: fmtPct1(100 * sh) }] });
    var at = g.i >= 0 ? ' data-trv="' + g.i + '" data-action="trpick" data-key="' + g.i + '"' : '';
    if (sh >= 0.999) svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R - w / 2) + '" fill="none" stroke="' + col + '" stroke-width="' + w + '"' + at + tipH + '/>';
    else if (sh > 0) {
      var la = a1 - a0 > Math.PI ? 1 : 0, r1 = R - w;
      var d = 'M' + (cx + R * Math.cos(a0)).toFixed(2) + ' ' + (cy + R * Math.sin(a0)).toFixed(2) + 'A' + R + ' ' + R + ' 0 ' + la + ' 1 ' + (cx + R * Math.cos(a1)).toFixed(2) + ' ' + (cy + R * Math.sin(a1)).toFixed(2)
        + 'L' + (cx + r1 * Math.cos(a1)).toFixed(2) + ' ' + (cy + r1 * Math.sin(a1)).toFixed(2) + 'A' + r1 + ' ' + r1 + ' 0 ' + la + ' 0 ' + (cx + r1 * Math.cos(a0)).toFixed(2) + ' ' + (cy + r1 * Math.sin(a0)).toFixed(2) + 'Z';
      svg += '<path class="' + P + '-pseg' + (on ? ' ' + P + '-on' : '') + '" d="' + d + '" fill="' + col + '"' + at + tipH + '/>';
    }
    a0 = a1;
    lg += '<div class="' + P + '-plg' + (on ? ' ' + P + '-on' : '') + '"' + at + (g.i >= 0 ? ' tabindex="0"' : '') + tipH + '><i style="background:' + col + '"></i><span class="' + P + '-optt">' + esc(g.nm) + '</span>'
      + '<b>' + fmtPct1(100 * sh) + '</b><span class="' + P + '-us">' + fmtInt(g.n) + '</span></div>';
  }
  svg += '<text x="' + cx + '" y="' + (cy - 2) + '" text-anchor="middle" class="' + P + '-pct">' + esc(fmtInt(tot)) + '</text>'
    + '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" class="' + P + '-ax">' + (state.trPie === 'num' && m.fmt !== 'int' ? 'в числителе' : 'человек') + '</text></svg>';
  return '<div class="' + P + '-piew">' + svg + '<div class="' + P + '-plgs">' + lg + '</div></div>';
}

// ---- вкладка «KPI»: цели через форму n8n (13.10) ----
// Код метрики из таблицы целей: ключ метрики; старые коды компонентов формы (rg, r3n…) и подписи — тоже.
var KPI_ALIAS = { rg: 'regret', rgs: 'regret', nrg: 'nonregret', nr: 'exit_reasons', jun: 'jun_team', r3n: 'retention_new_3', r6n: 'retention_new_6', hc: 'headcount' };
function kpiMetricKey(v) {
  v = String(v || '').replace(/^\s+|\s+$/g, '');
  if (METRIC[v]) return v;
  if (KPI_ALIAS[v]) return KPI_ALIAS[v];
  for (var i = 0; i < CFG.metrics.length; i++) if (CFG.metrics[i].name === v) return CFG.metrics[i].key;
  return v;
}
// «Действует по» пусто (или старое «бессрочно» 2099-12-31) — по актуальную дату: последний период датасета.
function kpiOpenTo(v) { v = String(v || ''); return !/^\d{4}-\d{2}-\d{2}$/.test(v) || v >= '2099-12-31'; }
// Разрез цели: пусто, «все» (подпись формы) и all — без разреза.
function kpiCut(v) { v = String(v || '').replace(/^\s+|\s+$/g, ''); return !v || v === 'all' || v.toLowerCase() === CFG.kpiForm.all ? 'all' : v; }
// Финансовый год по умолчанию (инструкция формы): с 1 октября по 30 сентября — тот, что идёт сейчас, то есть
// на месяц после последнего закрытого (данные за сентябрь — уже новый год с 1 октября).
function kpiFY() {
  var p = dparts(MODEL.cal.m[MODEL.L] ? MODEL.cal.m[MODEL.L].e : '2026-09-30'), mo = p.m + 1, yy = p.y;
  if (mo > 11) { mo = 0; yy++; }
  var y = mo >= 9 ? yy : yy - 1;
  return [y + '-10-01', (y + 1) + '-09-30'];
}
// Черновик формы (state.kd): mode add | update | del; юнит — выбранный в отчёте (или юнит правила).
function kdDraft() {
  var d = state.kd || {};
  // Новый KPI — на юнит, выбранный в отчёте сейчас (выбрали в «Фильтрах» после открытия формы — подхватится).
  if (d.mode === 'add') d.unit = MODEL.single ? MODEL.scopeIds[0] : '';
  return d;
}
function kdNew() {
  var M = MODEL, fy = kpiFY(), cuts = {};
  for (var i = 0; i < CFG.cuts.length; i++) { var sv = M.sel[CFG.cuts[i].key] || []; cuts[CFG.cuts[i].key] = sv.length === 1 ? sv[0] : 'all'; }
  return { mode: 'add', id: '', unit: M.single ? M.scopeIds[0] : '', metric: 'regret', target: '', from: fy[0], to: fy[1], cuts: cuts, note: '' };
}
function kdFromRule(r, mode) {
  var cuts = {};
  for (var i = 0; i < CFG.cuts.length; i++) cuts[CFG.cuts[i].key] = r.f[CFG.cuts[i].key] || 'all';
  return { mode: mode, id: r.id, unit: r.unit, metric: r.metric, target: String(r.target).replace('.', ','), from: r.from > '2000-01-01' ? r.from : kpiFY()[0],
           to: r.open ? '' : r.to, cuts: cuts, note: r.note || '' };
}
function kdNum(v) { var t = String(v === undefined || v === null ? '' : v).replace(',', '.').replace(/\s/g, ''); return t !== '' && !isNaN(Number(t)) ? Number(t) : null; }
function isoOk(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }
// Что мешает отправить: пустой юнит, цель не число, даты.
function kdErrors(d) {
  var e = [];
  if (!d.unit) e.push('выберите юнит');
  if (d.mode !== 'del') {
    if (kdNum(d.target) === null) e.push('цель — число');
    if (!isoOk(d.from)) e.push('«действует с» — дата ГГГГ-ММ-ДД');
    if (d.to && !isoOk(d.to)) e.push('«действует по» — дата ГГГГ-ММ-ДД');
    if (isoOk(d.from) && isoOk(d.to) && d.to < d.from) e.push('«по» раньше, чем «с»');
  }
  return e;
}
// Prefill-ссылка: ключ — точная подпись поля, значение — точная опция (метрика — названием, действие — словом).
function kdLink(d) {
  var K = CFG.kpiForm, m = METRIC[d.metric], q = [];
  function put(k, v) { if (v !== undefined && v !== null && v !== '') q.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }
  put(K.op, K.ops[d.mode] || K.ops.add);
  if (d.mode !== 'add') put(K.id, d.id);
  put(K.unit, d.unit);
  put(K.unitNm, d.unit ? unitName(MODEL, d.unit) : '');
  put(K.metric, m ? m.name : d.metric);
  if (d.mode !== 'del') {
    var n = kdNum(d.target);
    put(K.target, n === null ? '' : String(n));
    put(K.from, d.from);
    put(K.to, d.to);
    for (var i = 0; i < CFG.cuts.length; i++) { var cv = (d.cuts || {})[CFG.cuts[i].key]; put(CFG.cuts[i].label, cv && cv !== 'all' ? cv : K.all); }
    put(K.note, d.note);
  }
  put(K.login, MODEL.meta && MODEL.meta.me || '');
  return K.url + '?' + q.join('&');
}
function ruleStatus(r, day) {
  if (!ruleActive(r, day)) return r.from > day ? ['neutral', 'с ' + fmtDay(r.from)] : ['neutral', 'истекла'];
  if (!ruleMatches(r)) return ['wait', 'ждёт разреза'];
  return ['good', 'в фокусе'];
}
function ruleSpan(r) {
  var a = r.from > '2000-01-01' ? 'с ' + fmtDay(r.from) : '';
  var b = r.open ? 'по актуальную дату (' + fmtDay(r.to) + ')' : 'по ' + fmtDay(r.to);
  return a ? a + ' ' + b : b;
}
// Значения разреза для формы — словари всей компании (meta.fdv), иначе фасеты ответа.
function kdCutValues(key) {
  var out = [], d = MODEL.fdv && MODEL.fdv[key] ? MODEL.fdv[key] : null, i;
  if (d) for (i = 0; i < d.length; i++) out.push(d[i]);
  else { var f = MODEL.facets[key] || []; for (i = 0; i < f.length; i++) out.push(f[i].v); }
  return out;
}
// Сейчас у юнита и база — чтобы цель ставили с оглядкой на факт (только для юнита отчёта: его ряд есть в ответе).
function kdNow(d) {
  var M = MODEL, m = METRIC[d.metric];
  if (!m || !M.scope || !(M.single && M.scopeIds[0] === d.unit)) return '';
  var v = mval(M.scope, 'm', m, M.L), b = comparable(m) ? mval(M.base, 'm', m, M.L) : null;
  return 'Сейчас у юнита — ' + fmtVal(m, v) + (b !== null ? ', база — ' + fmtVal(m, b) : '') + (m.ytd ? ' (с начала года; цель — годовая)' : '') + '.';
}
function kdEditorHTML() {
  var P = CFG.ns, M = MODEL, d = kdDraft(), K = CFG.kpiForm, m = METRIC[d.metric], err = kdErrors(d), del = d.mode === 'del';
  var mOpts = [];
  for (var k = 0; k < CFG.metrics.length; k++) if (targetable(CFG.metrics[k])) mOpts.push([CFG.metrics[k].key, CFG.metrics[k].name]);
  var unitH = d.unit ? '<b>' + esc(unitName(M, d.unit)) + '</b>' + (M.units[d.unit] ? '<span class="' + P + '-us">' + esc(levelLabel(M.units[d.unit].lvl)) + ' · цель действует на юнит и его подразделения</span>' : '')
    : '<span class="' + P + '-kerr">Выберите один юнит в «Фильтрах»</span> <button type="button" class="' + P + '-lnk" data-action="drawer">Открыть фильтры</button>';
  var title = del ? 'Удалить KPI' : (d.mode === 'update' ? 'Изменить KPI' : 'Новый KPI');
  var body = '<div class="' + P + '-kform">'
    + '<div class="' + P + '-ctl ' + P + '-kwide"><span class="' + P + '-ctll">Юнит</span><span class="' + P + '-kval">' + unitH + '</span></div>';
  if (del) {
    body += '<div class="' + P + '-ctl ' + P + '-kwide"><span class="' + P + '-ctll">Цель</span><span class="' + P + '-kval">' + esc((m ? m.name : d.metric) + ': ' + (m ? (m.better === 'higher' ? '≥ ' : '≤ ') + fmtVal(m, kdNum(d.target)) : d.target)) + '</span></div>'
      + '<div class="' + P + '-note ' + P + '-warn ' + P + '-kwide">Цель перестанет действовать на юнит и его подразделения.</div>';
  } else {
    var cutsH = '';
    for (var c = 0; c < CFG.cuts.length; c++) {
      var ck = CFG.cuts[c].key, vals = kdCutValues(ck), opts = [['all', 'все']];
      for (var v = 0; v < vals.length; v++) opts.push([vals[v], cutName(vals[v])]);
      cutsH += '<div class="' + P + '-ctl"><span class="' + P + '-ctll">' + esc(CFG.cuts[c].label) + '</span>' + hSel('kdc:' + ck, opts, (d.cuts || {})[ck] || 'all') + '</div>';
    }
    body += '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('kdm', mOpts, d.metric) + '</div>'
      + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Цель' + (m && m.fmt === 'pct' ? ', %' : '') + (m ? ' · ' + (m.better === 'higher' ? 'не ниже' : 'не выше') : '') + '</span>'
      + '<input class="' + P + '-inp" type="text" inputmode="decimal" data-kd="target" placeholder="например, 3,5" value="' + esc(d.target) + '"></div>'
      + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Действует с</span><input class="' + P + '-inp" type="text" data-kd="from" placeholder="ГГГГ-ММ-ДД" value="' + esc(d.from) + '"></div>'
      + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Действует по</span><input class="' + P + '-inp" type="text" data-kd="to" placeholder="ГГГГ-ММ-ДД, пусто — по актуальную дату" value="' + esc(d.to) + '"></div>'
      + '<div class="' + P + '-know ' + P + '-kwide" data-kd-now="1">' + esc(kdNow(d)) + '</div>'
      + '<div class="' + P + '-kcut ' + P + '-kwide"><span class="' + P + '-ctll">Для кого — разрезы численности</span><div class="' + P + '-kcuts">' + cutsH + '</div>'
      + '<span class="' + P + '-us">«все» — вся численность юнита. Цель с разрезом работает в отчёте, когда выбран ровно этот разрез.</span></div>'
      + '<div class="' + P + '-ctl ' + P + '-kwide"><span class="' + P + '-ctll">Комментарий</span><input class="' + P + '-inp" type="text" data-kd="note" placeholder="зачем цель" value="' + esc(d.note) + '"></div>';
  }
  body += '</div>'
    + '<div class="' + P + '-chh"><span class="' + P + '-cht">Форма KPI</span><span class="' + P + '-chl"><span class="' + P + '-kmsg" data-kd-msg="1">' + esc(state.copied || '') + '</span>'
    // Ссылка — настоящая <a>: обычный клик песочница Proteus не пустит (нет allow-popups), а пункт контекстного меню
    // «Открыть ссылку в новой вкладке» — действие браузера, не скрипта. Обычный клик перехватываем (иначе форма
    // открылась бы ВМЕСТО отчёта в его iframe) и показываем, как открыть.
    + '<a class="' + P + '-btn ' + P + '-pri ' + P + '-klink" data-kd-link="1" target="_blank" rel="noopener noreferrer" href="' + esc(err.length ? '#' : kdLink(d)) + '"' + (err.length ? ' style="display:none"' : '') + '>Открыть форму ↗</a>'
    + '<button type="button" class="' + P + '-btn" data-action="kcopy"' + (err.length ? ' disabled' : '') + '>Скопировать ссылку</button></span></div>'
    + '<div class="' + P + '-kerr" data-kd-err="1">' + (err.length ? 'Чтобы открыть форму: ' + esc(err.join(', ')) + '.' : '') + '</div>'
    + '<div class="' + P + '-note ' + P + '-ninfo ' + P + '-khint" data-kd-hint="1"' + (err.length ? ' style="display:none"' : '') + '><b>Правой кнопкой мыши по «Открыть форму» → «Открыть ссылку в новой вкладке»</b>'
    + ' (на Mac — клик двумя пальцами или с Ctrl). Обычным кликом форма не откроется: Proteus не даёт отчёту открывать вкладки. Не выходит — «Скопировать ссылку» и вставьте её в адресную строку новой вкладки.</div>'
    + '<textarea class="' + P + '-code" readonly data-kd-out="1" style="display:none">' + esc(err.length ? '' : kdLink(d)) + '</textarea>'
    + '<ol class="' + P + '-steps"><li>Откройте форму в новой вкладке (правой кнопкой) — все поля уже заполнены.</li>'
    + '<li>Проверьте и нажмите «Отправить».</li><li>' + (del ? 'Цель исчезнет' : 'Цель появится') + ' в отчёте в течение ' + K.lag + ' минут — обновите борд.</li></ol>';
  return hPanel({ title: title, sub: 'отчёт заполнит форму за вас — останется открыть её и отправить', body: body,
    tabs: '<span class="' + P + '-pbtn"><button type="button" class="' + P + '-btn ' + P + '-ghost" data-action="kclose">Закрыть</button></span>' });
}
function goalsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, day = M.cal.m[L] ? M.cal.m[L].e : '';
  var s = pageHead('KPI', 'Цели на юниты: цель действует на юнит и все его подразделения, пока ниже нет своей. Добавить, изменить и удалить — здесь.');
  s += '<div class="' + P + '-tools"><button type="button" class="' + P + '-btn ' + P + '-pri" data-action="kadd" data-tour="kadd">+ Новый KPI</button>'
    + '<span class="' + P + '-us">' + (M.single ? 'для юнита «' + esc(unitName(M, M.scopeIds[0])) + '»' : 'юнит выбирается в «Фильтрах»') + '</span></div>';
  if (state.kdOpen) s += '<div class="' + P + '-gap" data-kd-ed="1">' + kdEditorHTML() + '</div>';
  var rules = M.rules.slice();
  rules.sort(function (a, b) {
    var da = pathTo(a.unit).length, db = pathTo(b.unit).length;
    return da - db || (unitName(M, a.unit) < unitName(M, b.unit) ? -1 : (unitName(M, a.unit) > unitName(M, b.unit) ? 1 : (a.metric < b.metric ? -1 : 1)));
  });
  var t = '<table class="' + P + '-t"><thead><tr><th class="' + P + '-l">Юнит</th><th class="' + P + '-l">Метрика</th><th>Цель</th>'
    + '<th class="' + P + '-l">Для кого</th><th class="' + P + '-l">Действует</th><th class="' + P + '-l">Статус</th><th class="' + P + '-l">Автор · комментарий</th><th></th></tr></thead><tbody>';
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i], m = METRIC[r.metric], st = ruleStatus(r, day), cuts = ruleCuts(r), unit = M.units[r.unit];
    var chips = '';
    for (var c = 0; c < cuts.length; c++) chips += '<span class="' + P + '-fchip">' + esc(cuts[c]) + '</span>';
    var above = !inZone(r.unit);
    t += '<tr><td class="' + P + '-l">' + esc(unitName(M, r.unit)) + '<span class="' + P + '-us">' + esc(unit ? levelLabel(unit.lvl) : '') + (above ? ' · выше вашей зоны, действует на неё' : '') + '</span></td>'
      + '<td class="' + P + '-l">' + esc(m ? m.name : r.metric) + '</td>'
      + '<td>' + esc(m ? (m.better === 'higher' ? '≥ ' : '≤ ') + fmtVal(m, r.target) : String(r.target)) + '</td>'
      + '<td class="' + P + '-l">' + (chips || '<span class="' + P + '-muted">вся численность</span>') + '</td>'
      + '<td class="' + P + '-l"><span class="' + P + '-muted">' + esc(ruleSpan(r)) + '</span></td>'
      + '<td class="' + P + '-l"><span class="' + P + '-st ' + P + '-' + st[0] + '"' + tip({ title: st[1], text: st[0] === 'wait' ? 'Цель задана для разреза — выберите его в «Фильтрах» или нажмите «Показать».' : (st[0] === 'good' ? 'Цель действует при текущих фильтрах.' : 'Цель не действует на дату данных.'), note: cuts.length ? cuts.join('; ') : null }) + '>' + esc(st[1]) + '</span></td>'
      + '<td class="' + P + '-l"><span class="' + P + '-muted">' + esc((r.author || '—') + (r.note ? ' · ' + r.note : '')) + '</span></td>'
      + '<td class="' + P + '-kact">' + (above ? '' : '<button class="' + P + '-lnk" data-action="gorule" data-key="' + esc(r.id) + '"' + tip({ title: 'Показать в отчёте', text: 'Открыть юнит цели с её разрезами.' }) + '>Показать</button>'
        + '<button class="' + P + '-lnk" data-action="kedit" data-key="' + esc(r.id) + '">Изменить</button>'
        + '<button class="' + P + '-lnk ' + P + '-kdel" data-action="kdel" data-key="' + esc(r.id) + '">Удалить</button>') + '</td></tr>';
  }
  if (!rules.length) t += '<tr><td class="' + P + '-l" colspan="8"><span class="' + P + '-muted">В вашей зоне целей пока нет. Нажмите «+ Новый KPI».</span></td></tr>';
  t += '</tbody></table>';
  s += '<div class="' + P + '-gap">' + hPanel({ title: 'Все KPI', sub: 'на юнитах вашей зоны и выше по дереву · статус на ' + fmtDay(day), body: t, tbl: true }) + '</div>';
  return s;
}

// ---- вкладка «Каталог метрик» ----
// Формула в каталоге — той же дробью, что в «О метрике» (13.10).
function catFrac(m) {
  var P = CFG.ns, f = metricFrac(m);
  return f ? '<span class="' + P + '-frac ' + P + '-fracs"><span class="' + P + '-frn">' + esc(f[0]) + '</span><span class="' + P + '-frd">' + esc(f[1]) + '</span></span>'
    + (f[2] ? '<span class="' + P + '-frs">' + esc(capFirst(f[2])) + '</span>' : '') : '';
}
function catalogHTML() {
  var P = CFG.ns, s = pageHead('Каталог метрик', 'Что значит каждая метрика и как её считаем. «Показывается» — метрика включена в «Фильтрах».');
  s += '<div class="' + P + '-cgrid">';
  for (var b = 0; b < CFG.blocks.length; b++) {
    var list = '<ul class="' + P + '-clist">';
    for (var i = 0; i < CFG.metrics.length; i++) {
      var m = CFG.metrics[i];
      if (m.block !== CFG.blocks[b].key) continue;
      var n = 0;
      for (var r = 0; r < MODEL.rules.length; r++) if (MODEL.rules[r].metric === m.key) n++;
      list += '<li><span class="' + P + '-cn">' + esc(m.name) + hInfo(metricTip(m))
        + (state.metricOff[m.key] ? '' : '<span class="' + P + '-cb">показывается</span>') + '</span>'
        + '<span class="' + P + '-cm">' + esc(dirText(m) + (targetable(m) ? ' · цели ставятся' : ' · без целей и цвета') + (n ? ' · целей в зоне: ' + n : '')) + '</span>'
        + '<span class="' + P + '-cd">' + esc(m.hint) + '</span>' + catFrac(m) + '</li>';
    }
    s += hPanel({ cls: P + '-catp', title: CFG.blocks[b].name, sub: 'действующие', body: list + '</ul>' });
  }
  var groups = [['postponed', 'Отложены'], ['dev', 'В разработке'], ['wanted', 'Хотим разработать']];
  for (var g = 0; g < groups.length; g++) {
    var items = CFG.catalog[groups[g][0]] || [], l2 = '<ul class="' + P + '-clist">';
    for (var k = 0; k < items.length; k++) l2 += '<li><span class="' + P + '-cn">' + esc(items[k].name) + '</span><span class="' + P + '-cm">' + esc(items[k].note) + '</span></li>';
    s += hPanel({ cls: P + '-catp', title: 'Прочие', sub: groups[g][1].toLowerCase(), body: l2 + '</ul>' });
  }
  return s + '</div>';
}

// ---- тур «Как работать»: справка — кнопкой в шапке (ДС §10). Показа «при первом входе» нет:
// Proteus не помнит, заходил ли человек раньше, и приглашение висело бы при каждом входе. ----
// Шаги по вкладкам. sel — что подсветить: селектор внутри overlay или функция root → элемент
// или список; all — подсветить все найденные разом (rings — рамкой вокруг каждого: строка
// фильтров переносится, и общая рамка захватила бы соседей); lock — подсвеченное не кликается (там
// запрос или переход); demo — шаг «нажми — будет»: «Показать» кликает цель сам, done(key) —
// что считается сделанным (key — data-key цели), hint — подсказка «попробуйте сами»;
// need — показывать ли шаг. Цель не нашлась (нет строк, нет данных) — шаг пропускается.
var HELP_SVG = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<circle cx="12" cy="12" r="9.5"/><path d="M9.3 9.2a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.6-2.7 2.6"/><path d="M12 16.6h.01"/></svg>';
var TOUR_NEXT = { onepager: 'teams', teams: 'transform', transform: 'goals', goals: 'catalog' };
function tabLabel(v) { for (var i = 0; i < CFG.tabs.length; i++) if (CFG.tabs[i].key === v) return CFG.tabs[i].label; return v; }
// Первый шаг полного тура: как читать отчёт — четыре правила (ДС §10).
function tourIntroHTML() {
  return '<ul class="' + CFG.ns + '-tul">'
    + '<li>Цифры — за последний полный месяц: <b>' + esc(monthLow(MODEL.L)) + '</b>.</li>'
    + '<li>Цвет — сравнение с ориентиром: с целью юнита, а если цели нет — со всей компанией.'
    + '<span class="' + CFG.ns + '-tpl">' + hPill('good', 'лучше') + hPill('bad', 'хуже') + hPill('neu', 'в пределах ±5 %') + '</span></li>'
    + '<li>Юнит, разрезы и метрики — в окне «Фильтры». Изменения применяются кнопкой «Применить».</li>'
    + '<li>Наведите на число или ⓘ — подсказка объяснит, что это и как посчитано.</li></ul>';
}
function tourSteps(view) {
  var P = '.' + CFG.ns, out = [];
  function add(o) { if (o.need === undefined || o.need) out.push(o); }
  function firstOp(R) { return R.querySelector(P + '-op'); }
  function slice(x) { return Array.prototype.slice.call(x || []); }
  if (view === 'onepager') {
    add({ intro: true, title: 'HRBP HUB за минуту', html: tourIntroHTML() });
    add({ sel: P + '-tabbar', lock: true, title: 'Вкладки',
      html: '<b>Сводка</b> — метрики юнита. <b>Команды</b> — сравнение подразделений. <b>Трансформеры</b> — метрика в разбивке по грейду, стажу, городу. <b>Каталог метрик</b> — что и как считаем.' });
    add({ sel: '[data-action="drawer"]', demo: true, done: function () { return !!state.drawer; }, title: 'Фильтры и настройки',
      html: 'Юнит, HRBP, разрезы и метрики — в одном окне.',
      hint: 'Нажмите на подсвеченную кнопку или «Показать».' });
    add({ sel: P + '-mdl [data-tz="unit"]', drawer: true, lock: true, title: 'Юнит отчёта',
      html: 'Дерево вашей зоны. Под названием — логин руководителя; искать можно и по названию, и по логину. Глубже — по стрелке ▸.' });
    add({ sel: P + '-mdl [data-tz="hrbp"]', drawer: true, lock: true, need: hrbpVisible(), title: 'HRBP',
      html: 'Выберите HRBP — дерево юнитов покажет только его зону.' });
    add({ sel: P + '-mdl [data-tz="cuts"]', drawer: true, lock: true, title: 'Разрезы',
      html: 'Покраска, IT / nonIT, стрим, специализация, штат, тип численности. Можно отметить несколько значений — метрики пересчитаются только по этим людям. Цифры рядом — сколько людей попадёт в выбор.' });
    add({ sel: P + '-mdl [data-tz="view"]', drawer: true, lock: true, title: 'Что показывать',
      html: 'Какие метрики показывать: флажок группы включает или выключает её целиком. <b>Только фокусные</b> — метрики с целью.' });
    add({ sel: P + '-mdf', drawer: true, lock: true, title: 'Применить',
      html: '«Применить» пересчитывает отчёт, «Отменить» возвращает как было. Закрыли окно, не применив, — над отчётом останется напоминание.' });
    add({ sel: P + '-fbar', lock: true, title: 'Юнит, фильтры и база',
      html: 'Юнит отчёта и путь к нему, применённые фильтры (× снимает фильтр) и база сравнения — вся компания под теми же разрезами.' });
    add({ sel: function (R) { var k = R.querySelectorAll(P + '-kpis>' + P + '-kpi'); return k.length > 1 ? k[1] : null; }, title: 'Сотрудники и движение',
      html: 'Численность на конец месяца и что изменило её за год: найм, уходы, переводы. Помесячно — в ⓘ.' });
    add({ sel: '[data-pophint]', lock: true, pad: 4, title: 'С кем сравнивать',
      html: 'Почти все люди юнита — одна популяция (например, HQ), а база — вся компания. «Сравнить с …» поставит этот разрез — база станет той же популяцией.' });
    add({ sel: function (R) { return R.querySelector('[data-hqnote]') || R.querySelector('[data-action="hqact"]'); }, lock: true, pad: 4, title: 'Текучесть — по активной HQ',
      html: 'Знаменатель regrettable и non-regrettable — всегда активная численность HQ. «Показать всё по активной HQ» поставит оба фильтра.' });
    add({ sel: P + '-obs', title: 'Что видно в данных',
      html: 'Главное по юниту: где метрика заметно хуже или лучше ориентира и прошлого года, всплески уходов, незаполненные причины. <b>«Ещё N»</b> раскрывает список.' });
    add({ sel: function (R) { var t = firstOp(R); return t ? t.querySelectorAll(P + '-row>' + P + '-lead') : null; }, all: true, title: 'Значение',
      html: 'Значение за последний полный месяц, под ним — сколько это людей: «9 уходов с начала года», «16 из 17 новичков».' });
    add({ sel: function (R) { var t = firstOp(R); return t ? [t.querySelector(P + '-vs')].concat(slice(t.querySelectorAll(P + '-row>' + P + '-vs'))) : null; },
      all: true, title: 'Ориентир',
      html: 'С чем сравниваем: «Цель» — утверждённая цель юнита, «База» — вся компания. Пилюля — насколько лучше или хуже.' });
    add({ sel: function (R) { var t = firstOp(R); return t ? t.querySelectorAll(P + '-spk') : null; }, all: true, title: '12 месяцев',
      html: '12 месяцев. Пунктир — ориентир, цвет точки — лучше или хуже ориентира в этом месяце.' });
    add({ sel: 'tr[data-action="openm"]', demo: true, at: 'left', done: function (k) { return opOpen(k); }, title: 'Динамика метрики',
      html: 'Нажмите на строку — откроется график по месяцам и пояснения к метрике.',
      hint: 'Нажмите на подсвеченную строку или «Показать».' });
    add({ sel: 'tr' + P + '-det ' + P + '-stc', title: 'График',
      html: 'Синяя линия — этот год, серая — прошлый, пунктир — ориентир. Цифры в кружках — точки из «Что видно» справа: наведите на цифру или на факт — пара подсветится.' });
    add({ sel: 'tr' + P + '-det ' + P + '-sts', title: 'Что видно и о метрике',
      html: 'Главное по метрике: сейчас против ориентира, год назад, пиковый месяц. Ниже — что это за метрика и как её считаем.' });
  } else if (view === 'teams') {
    add({ sel: function (R) { var b = R.querySelector('[data-action="block"]'); return b ? b.parentNode : null; }, title: 'Группы метрик',
      html: 'Все метрики сразу или одна группа: удержание, текучесть, структура.' });
    add({ sel: P + '-tpan', title: 'Подразделения',
      html: 'Юнит отчёта («ИТОГО») и три уровня под ним, ▸ раскрывает строку. Без цвета — в команде слишком мало людей, чтобы оценивать.' });
    add({ sel: P + '-tpan tr' + P + '-row:not(' + P + '-tot)', demo: true, at: 'left', done: function (k) { return state.selTeam === k; }, title: 'Выбрать строку',
      html: 'Нажмите на строку — справа появятся её графики.',
      hint: 'Нажмите на подсвеченную строку или «Показать».' });
    add({ sel: P + '-tpan tr' + P + '-sel ' + P + '-drill', lock: true, pad: 4, title: 'Открыть юнит',
      html: 'Иконка у выбранной строки делает её юнитом отчёта. Вернуться — «← Назад» или путь над таблицей.' });
    add({ sel: P + '-dpan', title: 'Динамика строки',
      html: 'Помесячно: синяя линия — этот год, серая — прошлый, пунктир — ориентир. Наведите на график, чтобы увидеть значения месяца.' });
    add({ sel: function (R) { var b = R.querySelector(P + '-dpan [data-action="cmp"]'); return b ? b.parentNode : null; }, title: 'С чем сравнить',
      html: 'На графике две линии: этот год и прошлый — или этот год и база. Переключатель действует на все графики.' });
    add({ sel: P + '-tsw', title: 'Поиск в таблице',
      html: 'Ищет по трём уровням таблицы. По всей зоне — поиск в «Фильтрах».' });
    add({ sel: P + '-tpan [data-action="copy"]', pad: 4, title: 'Копировать таблицу',
      html: 'Все три уровня — в буфер обмена: вставьте в Excel или письмо.' });
    add({ sel: P + '-tpan th' + P + '-sth:not(' + P + '-l)', pad: 2, title: 'Сортировка',
      html: 'Клик по заголовку — сортировка, повторный — в обратную сторону, третий — как было.' });
    add({ sel: '[data-split]', need: !state.narrow && (state.splitMode || 'both') === 'both', pad: 2, title: 'Ширина колонок',
      html: 'Потяните разделитель, чтобы дать место таблице или графикам. Двойной клик — как было.' });
    add({ sel: P + '-dhint', title: 'Глубже трёх уровней',
      html: 'Откройте юнит строки иконкой — таблица покажет следующие три уровня.' });
  } else if (view === 'transform') {
    add({ sel: function (R) { var x = R.querySelector('[data-dsel="tfm"]'); return x ? x.parentNode : null; }, title: 'Метрика',
      html: 'Какую метрику раскладывать по оси.' });
    add({ sel: function (R) { var x = R.querySelector('[data-dsel="tfa"]'); return x ? x.parentNode : null; }, lock: true, title: 'Разбивка',
      html: 'По чему разбить: грейд, стаж, возраст, город и другие.' });
    add({ sel: '[data-tfps]', title: 'Готовые срезы',
      html: 'Частые вопросы одним кликом: на каких грейдах уходят ценные, где не задерживаются новички, где не указывают причины. Клик ставит метрику и разбивку.' });
    add({ sel: P + '-trln', title: 'Динамика',
      html: 'Метрика всего юнита за 12 месяцев. Выберите строку таблицы — рядом появится её линия, «Всего» станет серой.' });
    add({ sel: P + '-trpie', title: 'Структура',
      html: 'Доли значений: в людях или в числителе метрики (уходы, новички, джуны). Наведите на долю — подсветится её строка в таблице, клик — её линия на графике.' });
    add({ sel: P + '-heat', title: 'Таблица-хитмап',
      html: 'Строки — значения разбивки, колонки — 12 месяцев. Зелёный — лучше, чем «Всего» в том же месяце, красный — хуже; чем ярче, тем дальше. Клик по строке выбирает её.' });
    add({ sel: P + '-trbox [data-action="copy"]', pad: 4, title: 'Копировать',
      html: 'Сводная — в буфер обмена: вставьте в Excel или письмо.' });
  } else if (view === 'goals') {
    add({ sel: function (R) { var ps = R.querySelectorAll(P + '-content ' + P + '-panel'); return ps.length ? ps[ps.length - 1] : null; }, title: 'Все KPI',
      html: 'KPI на юнитах вашей зоны и выше по дереву. KPI действует на юнит и все его подразделения, пока ниже нет своего. Статус: «в фокусе», «ждёт разреза» или вне срока.' });
    add({ sel: '[data-tour="kadd"]', pad: 4, title: 'Новый KPI',
      html: 'Откроет форму для юнита, выбранного в «Фильтрах»: метрика, цель, срок, для кого (разрезы). Отчёт заполнит форму n8n за вас: правой кнопкой по «Открыть форму» → «Открыть ссылку в новой вкладке», проверить и нажать «Отправить».' });
    add({ sel: '[data-action="kedit"]', lock: true, pad: 4, title: 'Изменить и удалить',
      html: 'У каждого KPI — «Изменить» и «Удалить»: та же форма, ссылка сразу с нужным действием. Изменения появятся в отчёте в течение ' + CFG.kpiForm.lag + ' минут.' });
    add({ sel: '[data-action="gorule"]', lock: true, pad: 4, title: 'Показать в отчёте',
      html: 'Откроет юнит KPI и выставит его разрезы в фильтрах.' });
  } else if (view === 'catalog') {
    add({ sel: P + '-cgrid ' + P + '-panel', title: 'Метрики по группам',
      html: 'Что значит метрика, в какую сторону лучше и ставятся ли на неё цели. Как считаем — в ⓘ.' });
  }
  add({ sel: '[data-tour="help"]', pad: 4, last: true, title: 'Тур всегда под рукой',
    html: 'Кнопка «Как работать» покажет такой тур по вкладке, на которой вы сейчас.' });
  return out;
}
// Карточка шага: вкладка и номер, заголовок, текст, подсказка «попробуйте сами», кнопки.
function tourCardHTML(view, list, i, step, done) {
  var P = CFG.ns, nx = step.last ? TOUR_NEXT[view] : '';
  var b = i > 0 ? '<button type="button" class="' + P + '-btn ' + P + '-ghost" data-tact="back">Назад</button>'
    : '<button type="button" class="' + P + '-btn ' + P + '-ghost" data-tact="close">Закрыть</button>';
  if (step.demo && !done) b += '<button type="button" class="' + P + '-btn ' + P + '-ghost" data-tact="next">Далее</button>'
    + '<button type="button" class="' + P + '-btn ' + P + '-pri" data-tact="demo">Показать</button>';
  else if (step.last) b += '<button type="button" class="' + P + '-btn ' + P + '-pri" data-tact="close">Готово</button>';
  else b += '<button type="button" class="' + P + '-btn ' + P + '-pri" data-tact="next">' + (step.intro ? 'Начать' : 'Далее') + '</button>';
  return '<span class="' + P + '-tarr"></span>'
    + '<div class="' + P + '-tch"><span class="' + P + '-tcs">' + esc(tabLabel(view)) + ' · ' + (i + 1) + ' из ' + list.length + '</span>'
    + '<button type="button" class="' + P + '-ib ' + P + '-tx" data-tact="close" aria-label="Закрыть тур">✕</button></div>'
    + '<div class="' + P + '-tct">' + esc(step.title) + '</div><div class="' + P + '-tcx">' + step.html + '</div>'
    + (step.demo && !done && step.hint ? '<div class="' + P + '-tchint">' + esc(step.hint) + '</div>' : '')
    + (nx ? '<button type="button" class="' + P + '-lnk ' + P + '-tnx" data-tact="nexttab">Дальше — тур по вкладке «' + esc(tabLabel(nx)) + '» →</button>' : '')
    + '<div class="' + P + '-tcf">' + b + '</div>';
}

// ---- сборка экрана ----
function accessHTML() {
  var M = MODEL;
  if (M.missing.length) {
    return hEmpty('В данных чарта нет колонок: ' + M.missing.join(', '),
      'Добавьте их в «Измерения» чарта Proteus (список — FIELDS.md): без них отчёт не соберётся.');
  }
  if (!M.meta) return hEmpty('Нет служебной строки meta', M.cut ? CFG.text.truncated.replace('{n}', fmtInt(M.rows))
    : 'Проверьте лимит строк чарта: строка role = meta должна приезжать всегда (FIELDS.md).');
  if (M.role !== 'none' && M.L < 12) return hEmpty('Календарь отчёта пуст', 'В hrbp_hub_calendar нет закрытого месяца текущего года — перезапустите ноут HRBP HUB.');
  return hEmpty(CFG.text.noAccess, 'Логин: ' + (M.meta.me || '—') + '. Доступ выдаёт владелец отчёта — напишите ему.');
}
function tabHTML(v) {
  if (v === 'teams') return teamsHTML();
  if (v === 'transform') return transformHTML();
  if (v === 'goals') return goalsHTML();
  if (v === 'catalog') return catalogHTML();
  return onepagerHTML();
}
// Только конкатенация строк. Все данные через esc().
// ВНИМАНИЕ: здесь префикс БЕЗ точки. var P = '.' + CFG.ns дал бы class=".pvt-root".
function buildHTML() {
  var P = CFG.ns;
  if (!rawData.length) {
    return buildCSS() + '<div class="' + P + '-root"><div class="' + P + '-content">' + hEmpty(CFG.text.noData, 'Датасет не вернул строк. Проверьте, что чарт смотрит на датасет hrbp_hub и лимит строк не нулевой.') + '</div></div>';
  }
  var h = [], ok = MODEL.ok && MODEL.role !== 'none' && MODEL.L >= 12, v = state.view || 'onepager';
  CHARTS = [];
  h.push('<div class="' + P + '-root' + (state.narrow ? ' ' + P + '-narrow' : '') + (state.pend ? ' ' + P + '-busy' : '') + '">');
  if (!ok) {
    h.push(headHTML() + '<div class="' + P + '-content">' + accessHTML() + '</div></div>');
    return buildCSS() + h.join('');
  }
  h.push('<div class="' + P + '-stick">' + headHTML() + filterBarHTML() + noticesHTML() + '</div>');
  h.push('<div class="' + P + '-content" role="tabpanel">' + tabHTML(v) + '</div>');
  if (state.drawer) h.push(filtersModalHTML());
  h.push('</div>');
  return buildCSS() + h.join('');
}

// ---------- БЛОК 6: МОНТАЖ + ИНТЕРАКТИВ ----------
(function mount() {
  try {
    var hosts = document.querySelectorAll('[_echarts_instance_]');
    if (!hosts || hosts.length === 0) return;
    var host = hosts[hosts.length - 1];
    // Песочница Proteus гасит чарт на ЛЮБУЮ ошибку окна (window.onerror → clear + dispose), в том числе на
    // безвредное «ResizeObserver loop…»: его даёт корневой div echarts, на миг шире окна при сужении iframe,
    // когда у документа появляется полоса прокрутки (Windows). Поэтому документ и хост — overflow:hidden (своя
    // прокрутка — в overlay), а обёртка onerror пропускает мимо песочницы только это событие (09.10, как в DL).
    host.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    if (document.body) document.body.style.overflow = 'hidden';
    var onErr0 = window.onerror;
    if (!(onErr0 && onErr0.__roSkip)) {
      var onErr = function (msg) {
        if (/ResizeObserver loop/i.test(String(msg))) return true;
        return typeof onErr0 === 'function' ? onErr0.apply(this, arguments) : false;
      };
      onErr.__roSkip = true;
      window.onerror = onErr;
    }
    var cvs = host.querySelectorAll('canvas');
    for (var i = 0; i < cvs.length; i++) cvs[i].style.display = 'none';
    var prev = host.querySelector('.' + CFG.ns + '-overlay');
    if (prev) prev.parentNode.removeChild(prev);

    var overlay = document.createElement('div');
    overlay.className = CFG.ns + '-overlay';
    overlay.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;'
      + 'z-index:10;overflow:auto;scrollbar-gutter:stable;box-sizing:border-box;background:' + CFG.colors.bg + ';';
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(overlay);

    // ── ТУЛТИП ──
    // Создаётся РОВНО ОДИН РАЗ и кэшируется в tipEl.
    // НИКОГДА не создавай его внутри render() и НИКОГДА не клади
    // его разметку в buildHTML(): innerHTML убьёт узел, и тултип перестанет
    // работать после первого же перерисовывания.
    var tipEl = null;
    function getTip() {
      if (tipEl && tipEl.parentNode) return tipEl;
      var old = document.querySelector('body > .' + CFG.ns + '-tip');
      if (old) old.parentNode.removeChild(old);
      tipEl = document.createElement('div');
      tipEl.className = CFG.ns + '-tip';
      document.body.appendChild(tipEl);
      return tipEl;
    }
    getTip();

    // ── ВИДИМАЯ НА ЭКРАНЕ ЧАСТЬ ЧАРТА ──
    // В Proteus чарт живёт в iframe-sandbox высотой с ячейку борда (1 100–1 400 px), а прокручивается
    // страница борда снаружи: window.innerHeight — высота ячейки, не экрана, и до родителя не достучаться.
    // Окно фильтров, поставленное по центру iframe, уезжало низом с «Применить» за край экрана (07.10).
    // IntersectionObserver без root меряет пересечение с окном браузера ВЕРХНЕГО уровня и из такого
    // iframe, видимый прямоугольник отдаёт в координатах iframe. Одна высокая цель не годится: пока
    // ячейка выше экрана, её видимая доля при прокрутке не меняется и колбэк молчит. Поэтому линейка:
    // прозрачные полосы по VIS_STEP px во всю высоту окна iframe, у каждой свои пороги. Итог —
    // state.vis {t, b} (видно сейчас) и state.vpH (сколько экрана досталось чарту — наибольшее видимое).
    // Без iframe полосы видны всегда целиком: vis = всё окно, как раньше.
    var VIS_STEP = 24, visParts = [], visH = 0;
    function visBuild() {
      if (state.visIO && state.visIO.disconnect) state.visIO.disconnect();
      state.visIO = null;
      var old = document.querySelector('body > .' + CFG.ns + '-vis');
      if (old) old.parentNode.removeChild(old);
      visParts = [];
      if (typeof IntersectionObserver === 'undefined') return;
      var H = window.innerHeight || 0, n = Math.max(1, Math.ceil(H / VIS_STEP)), box = document.createElement('div');
      visH = H;
      box.className = CFG.ns + '-vis';
      box.setAttribute('aria-hidden', 'true');
      box.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:' + H + 'px;pointer-events:none;opacity:0;z-index:-1;';
      for (var i = 0; i < n; i++) {
        var el = document.createElement('div');
        el.style.cssText = 'position:absolute;left:0;width:1px;top:' + (i * VIS_STEP) + 'px;height:' + Math.min(VIS_STEP, H - i * VIS_STEP) + 'px;';
        el.setAttribute('data-vi', String(i));
        box.appendChild(el);
        visParts.push(null);
      }
      document.body.appendChild(box);
      var io = new IntersectionObserver(visTick, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      for (var k = 0; k < box.children.length; k++) io.observe(box.children[k]);
      state.visIO = io;
    }
    function visTick(entries) {
      for (var i = 0; i < entries.length; i++) {
        var en = entries[i], k = +en.target.getAttribute('data-vi'), r = en.intersectionRect;
        visParts[k] = en.isIntersecting && r && r.height > 0 ? { t: r.top, b: r.bottom } : null;
      }
      var t = Infinity, b = -Infinity;
      for (var j = 0; j < visParts.length; j++) if (visParts[j]) { t = Math.min(t, visParts[j].t); b = Math.max(b, visParts[j].b); }
      var v = b > t ? { t: Math.round(t), b: Math.round(b) } : { t: 0, b: 0, none: true }, o = state.vis;
      if (o && o.t === v.t && o.b === v.b && !!o.none === !!v.none) return;
      state.vis = v;
      var e = visV(), hv = v.none || v.b - v.t < 120 ? 0 : e.b - e.t, grew = hv > (state.vpH || 0) + 8;
      if (hv > (state.vpH || 0)) state.vpH = hv;
      if (grew) fitSplit();
      if (state.drawer) placeDrawer();
      if (state.tour) tourPos();
    }
    // Видимая полоса окна iframe по вертикали; нет данных или видно меньше 120 px — всё окно. Верх ячейки
    // уехал за край экрана — сверху минус CFG.vis.cover: там липкая шапка дашборда Proteus.
    function visV() {
      var H = window.innerHeight || 0, v = state.vis;
      if (!v || v.none || v.b - v.t < 120) return { t: 0, b: H };
      var t = v.t > 1 ? Math.min(v.t + CFG.vis.cover, v.b - 120) : v.t;
      return { t: Math.max(0, t), b: Math.min(H, v.b) };
    }
    // state.vis / state.vpH переживают перезапуск скрипта (новые данные — тот же iframe): линейка
    // заново, прошлые значения действуют до её первого колбэка — высота «Команд» не прыгает.
    visBuild();

    // showTip/hideTip — СЛУЖЕБНЫЕ. Не переписывать, не переименовывать, не
    // копировать их логику в свой код. Здесь заперты два правила, на которых
    // ломались все предыдущие версии:
    //   1) тултип спрятан ДВУМЯ свойствами (display + opacity) — показ обязан
    //      снять ОБА. Снял одно — узел построится и останется невидимым,
    //      без ошибок и без единого следа в отладке (RETRO 44);
    //   2) тултип лежит в body с position:fixed, поэтому координаты
    //      getBoundingClientRect() берутся КАК ЕСТЬ, а клампинг идёт по
    //      window.innerWidth/innerHeight — не по размерам контейнера (RETRO 26).
    // Твоё дело — только содержимое и якорь. Видимость и позицию считает showTip.
    function showTip(html, rect) {
      var tip = getTip();
      // За курсором showTip зовётся на каждом mousemove — HTML меняем, только если он другой.
      if (tip.__h !== html) { tip.innerHTML = html; tip.__h = html; }
      tip.style.display = 'block';
      tip.style.left = '0px';
      tip.style.top = '0px';
      var t = tip.getBoundingClientRect();
      // Низ и верх — видимой на экране части окна (visV): в iframe Proteus окно = ячейка борда,
      // которая выше экрана, и подсказка у нижнего края экрана уходила бы под него.
      var pad = 6, gap = 8, left, top, vv = visV(), vt = vv.t, vb = vv.b;
      if (rect.pt) {
        // Якорь — курсор (как в Proteus Adoption): справа-снизу, у края окна — зеркально.
        left = rect.left + 14; top = rect.top + 18;
        if (left + t.width > window.innerWidth - pad) left = rect.left - t.width - 14;
        if (top + t.height > vb - pad) top = rect.top - t.height - 14;
      } else {
        left = rect.left + rect.width / 2 - t.width / 2;
        top = rect.top + rect.height + gap;
        if (top + t.height > vb - pad) top = rect.top - t.height - gap;
      }
      left = Math.max(pad, Math.min(left, window.innerWidth - t.width - pad));
      top = Math.max(vt + pad, Math.min(top, vb - t.height - pad));
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top) + 'px';
      tip.style.opacity = '1';
    }
    function hideTip() {
      var tip = getTip();
      tip.style.opacity = '0';
      tip.style.display = 'none';
      tip.__h = null;
    }

    // Показ/скрытие тултипа НЕ требует полного render(): hover меняет только
    // содержимое и позицию, полный render() — только на клик (RETRO 20).
    // Якорь (rect) клади в state.tip при наведении: getBoundingClientRect()
    // цели КАК ЕСТЬ, без вычитания rect корня.
    function renderTip() {
      if (!state.tip) { hideTip(); return; }
      // data-tip несёт ГОТОВЫЙ html плашки (tipHtml при сборке разметки).
      showTip(state.tip.key || '', state.tip.rect);
    }
    // ── ТУР «КАК РАБОТАТЬ» ──
    // Слой тура — в body, как тултип (render() его не стирает): четыре шторки вокруг цели
    // затемняют всё, кроме неё, и не пропускают клики мимо; пятая ложится на цель, если та
    // «только смотреть» (lock); рамка вокруг цели; карточка со стрелкой; курсор для показа.
    // Шаги — tourSteps(view) в БЛОКЕ 5; состояние — state.tour, переживает перезапуск скрипта.
    var tourNode = null;
    var CURSOR_SVG = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v16.2l4.3-4.1 2.9 6.6 2.6-1.1-2.9-6.5h6z" fill="#1f2530" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    function tourLayer() {
      if (tourNode && tourNode.parentNode) return tourNode;
      var old = document.querySelector('body > .' + CFG.ns + '-tour');
      if (old) old.parentNode.removeChild(old);
      var P = CFG.ns, sides = ['t', 'b', 'l', 'r', 'h'], h = '';
      for (var i = 0; i < sides.length; i++) h += '<div class="' + P + '-tb" data-tb="' + sides[i] + '"></div>';
      h += '<div class="' + P + '-trings"></div><div class="' + P + '-tcard" role="dialog" aria-modal="true" aria-label="Как работать с отчётом"></div>'
        + '<span class="' + P + '-tclk"></span><span class="' + P + '-tcur">' + CURSOR_SVG + '</span>';
      tourNode = document.createElement('div');
      tourNode.className = P + '-tour';
      tourNode.innerHTML = h;
      document.body.appendChild(tourNode);
      // Слушатели — на новый узел, один раз: узел пересоздаётся только вместе с запуском скрипта.
      tourNode.addEventListener('click', function (e) {
        var n = e.target;
        while (n && n !== tourNode && !(n.getAttribute && n.getAttribute('data-tact'))) n = n.parentNode;
        if (n && n !== tourNode) tourAct(n.getAttribute('data-tact'));
      });
      // Колесо над затемнением листает отчёт (подсветка едет вместе с целью); отчёт уже у края —
      // колесо уходит странице борда, видимая часть меняется, карточка — за ней (visTick).
      tourNode.addEventListener('wheel', function (e) {
        var was = overlay.scrollTop;
        overlay.scrollTop += e.deltaY;
        if (overlay.scrollTop !== was) { e.preventDefault(); tourPos(); }
      }, { passive: false });
      return tourNode;
    }
    function tourQ(cls) { return tourNode ? tourNode.querySelector('.' + CFG.ns + '-' + cls) : null; }
    function tourEls(step) {
      if (!step || !step.sel) return [];
      var raw = typeof step.sel === 'function' ? step.sel(overlay) : overlay.querySelectorAll(step.sel), out = [];
      if (!raw) return out;
      if (raw.nodeType === 1) raw = [raw];
      for (var i = 0; i < raw.length; i++) {
        var el = raw[i], r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
        if (r && r.width > 0 && r.height > 0) { out.push(el); if (!step.all) break; }
      }
      return out;
    }
    function tourRect(els) {
      var l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var q = els[i].getBoundingClientRect();
        l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
      }
      return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
    }
    // Цель вне видимой части — прокручиваем overlay (скролл-контейнер отчёта): цель — по центру,
    // высокая — верхом под край, чтобы рядом поместилась карточка.
    function tourScroll(els) {
      if (!els.length) return;
      // Цель в окне «Фильтры и настройки» — прокручиваем его колонку (тело), отчёт под окном не трогаем.
      var sc = els[0];
      while (sc && sc !== overlay && !(sc.getAttribute && (sc.getAttribute('data-mdsub') !== null || sc.getAttribute('data-mdcol') !== null || sc.getAttribute('data-mdbody') !== null) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentNode;
      if (sc && sc !== overlay) {
        var ur = tourRect(els), sr = sc.getBoundingClientRect();
        if (ur.top < sr.top + 8 || ur.bottom > sr.bottom - 8) sc.scrollTop += ur.top - sr.top - Math.max(8, (sr.height - ur.height) / 2);
        return;
      }
      if (trigger(els[0], 'data-drawer')) return;
      var u = tourRect(els), o = overlay.getBoundingClientRect(), vv = visV(), top = Math.max(o.top, vv.t);
      var vh = Math.min(o.bottom, vv.b) - top;
      if (u.top >= top + 8 && u.bottom <= top + vh - 8) return;
      overlay.scrollTop += (u.top - top) - (u.height > vh - 160 ? 72 : (vh - u.height) / 2);
    }
    function tourBox(el, l, t, w, h) {
      el.style.left = Math.round(l) + 'px'; el.style.top = Math.round(t) + 'px';
      el.style.width = Math.max(0, Math.round(w)) + 'px'; el.style.height = Math.max(0, Math.round(h)) + 'px';
    }
    // Карточка — со стороны, где помещается (снизу, сверху, справа, слева); цель во весь экран —
    // карточка в нижнем углу поверх неё. Стрелка смотрит в центр цели. По вертикали — в видимой
    // на экране части окна (visV): в iframe Proteus окно выше экрана.
    function tourPlace(r) {
      var card = tourQ('tcard'), arr = card ? card.querySelector('.' + CFG.ns + '-tarr') : null;
      if (!card || !arr) return;
      var vv = visV(), W = window.innerWidth, vt = vv.t, H = vv.b, m = 12, g = 14, side = '', left, top;
      var cw = card.offsetWidth, ch = card.offsetHeight;
      if (!r) { left = (W - cw) / 2; top = vt + Math.max(m, Math.min(96, (H - vt - ch) / 2)); }
      else {
        var cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
        var fits = { bottom: r.b + g + ch <= H - m, top: r.t - g - ch >= vt + m, right: r.r + g + cw <= W - m, left: r.l - g - cw >= m };
        var order = ['bottom', 'top', 'right', 'left'];
        for (var i = 0; i < order.length && !side; i++) if (fits[order[i]]) side = order[i];
        if (side === 'bottom') { top = r.b + g; left = cx - cw / 2; }
        else if (side === 'top') { top = r.t - g - ch; left = cx - cw / 2; }
        else if (side === 'right') { left = r.r + g; top = cy - ch / 2; }
        else if (side === 'left') { left = r.l - g - cw; top = cy - ch / 2; }
        else { left = W - cw - m; top = H - ch - m; }
      }
      left = Math.max(m, Math.min(left, W - cw - m));
      top = Math.max(vt + m, Math.min(top, H - ch - m));
      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';
      arr.className = CFG.ns + '-tarr' + (side ? ' ' + CFG.ns + '-ta-' + side : '');
      if (side === 'bottom' || side === 'top') { arr.style.left = Math.round(Math.max(14, Math.min(cw - 24, (r.l + r.r) / 2 - left - 5))) + 'px'; arr.style.top = ''; }
      else if (side) { arr.style.top = Math.round(Math.max(14, Math.min(ch - 24, (r.t + r.b) / 2 - top - 5))) + 'px'; arr.style.left = ''; }
    }
    // Только габариты: шторки, рамка, карточка — по текущему месту цели (прокрутка, ресайз, перерисовка).
    function tourPos() {
      var t = state.tour;
      if (!t || !tourNode || tourNode.style.display !== 'block') return;
      var step = tourSteps(t.view)[t.i];
      if (!step) return;
      var els = tourEls(step), W = window.innerWidth, H = window.innerHeight, r = null;
      if (els.length) {
        var u = tourRect(els), pd = step.pad === undefined ? 6 : step.pad;
        r = { l: Math.max(0, u.left - pd), t: Math.max(0, u.top - pd), r: Math.min(W, u.right + pd), b: Math.min(H, u.bottom + pd) };
        if (r.r - r.l < 4 || r.b - r.t < 4) r = null;
      }
      var Q = function (k) { return tourNode.querySelector('[data-tb="' + k + '"]'); }, rs = [];
      if (r) {
        tourBox(Q('t'), 0, 0, W, r.t);
        tourBox(Q('b'), 0, r.b, W, H - r.b);
        tourBox(Q('l'), 0, r.t, r.l, r.b - r.t);
        tourBox(Q('r'), r.r, r.t, W - r.r, r.b - r.t);
        tourBox(Q('h'), r.l, r.t, step.lock ? r.r - r.l : 0, step.lock ? r.b - r.t : 0);
        if (step.rings) {
          for (var e = 0; e < els.length; e++) { var q = els[e].getBoundingClientRect(); rs.push([q.left - 3, q.top - 3, q.width + 6, q.height + 6]); }
        } else rs.push([r.l, r.t, r.r - r.l, r.b - r.t]);
      } else {
        tourBox(Q('t'), 0, 0, W, H);
        tourBox(Q('b'), 0, 0, 0, 0); tourBox(Q('l'), 0, 0, 0, 0); tourBox(Q('r'), 0, 0, 0, 0); tourBox(Q('h'), 0, 0, 0, 0);
      }
      // Рамки — из пула: сколько целей, столько рамок, лишние спрятаны.
      var pool = tourQ('trings');
      while (pool.children.length < rs.length) { var nr = document.createElement('div'); nr.className = CFG.ns + '-tring'; pool.appendChild(nr); }
      for (var k = 0; k < pool.children.length; k++) {
        var rg = pool.children[k];
        rg.style.display = k < rs.length ? 'block' : 'none';
        if (k < rs.length) tourBox(rg, rs[k][0], rs[k][1], rs[k][2], rs[k][3]);
      }
      tourPlace(r);
    }
    function tourShow() {
      var t = state.tour, list = tourSteps(t.view), step = list[t.i];
      if (!step) { tourEnd(); return; }
      // Шаги про окно «Фильтры и настройки» — с открытым окном, остальные — с закрытым.
      if (!!state.drawer !== !!step.drawer) {
        state.drawer = !!step.drawer;
        state.open = '';
        state.qk = {};
        render();
        return;
      }
      var els = tourEls(step);
      // Цели нет (пустая таблица, нет строк, узкая ячейка) — шаг пропускаем в ту же сторону.
      if (step.sel && !els.length) { tourGo(t.i + (t.dir || 1), t.dir || 1); return; }
      t.shown = t.i;
      t.key = step.demo ? (els[0].getAttribute('data-key') || '') : '';
      t.was = step.demo ? !!step.done(t.key) : false;
      t.busy = false;
      state.tip = null;
      hideTip();
      var L = tourLayer();
      L.style.display = 'block';
      tourQ('tcur').style.display = 'none';
      tourScroll(els);
      tourQ('tcard').innerHTML = tourCardHTML(t.view, list, t.i, step, t.was);
      tourPos();
      var pb = L.querySelector('.' + CFG.ns + '-tcf .' + CFG.ns + '-pri');
      if (pb && pb.focus) pb.focus();
    }
    function tourGo(i, dir) {
      var t = state.tour;
      if (!t) return;
      if (i >= tourSteps(t.view).length) { tourEnd(); return; }
      if (i < 0) { i = 0; dir = 1; }
      t.i = i; t.dir = dir; t.shown = -1;
      tourShow();
    }
    function tourStart(view) {
      state.open = ''; state.qk = {}; state.tip = null;
      hideTip();
      state.view = view;
      state.tour = { view: view, i: 0, dir: 1, shown: -1, key: '', was: false, busy: false };
      overlay.scrollTop = 0;
      render();
      ensureAxis();
    }
    function tourEnd() {
      state.tour = null;
      if (tourNode) tourNode.style.display = 'none';
      // Окно, открытое туром, закрываем вместе с ним.
      if (state.drawer) { state.drawer = false; state.open = ''; state.qk = {}; render(); }
    }
    // После каждой перерисовки: вкладку сменили — тур окончен; шаг «нажми — будет» сделан
    // (пользователем или показом) — следующий шаг; иначе подсветка — по новому месту цели.
    function tourSync() {
      var t = state.tour;
      if (!t) {
        if (tourNode) tourNode.style.display = 'none';
        else { var old = document.querySelector('body > .' + CFG.ns + '-tour'); if (old) old.parentNode.removeChild(old); }
        return;
      }
      if ((state.view || 'onepager') !== t.view || !(MODEL.ok && MODEL.role !== 'none' && MODEL.L >= 12)) { tourEnd(); return; }
      if (!tourNode || !tourNode.parentNode || t.shown !== t.i) { tourShow(); return; }
      var step = tourSteps(t.view)[t.i];
      if (step && step.demo && !t.was && !t.busy && step.done(t.key)) { tourGo(t.i + 1, 1); return; }
      tourPos();
    }
    // Показ «нажми — будет»: курсор едет от кнопки к цели, «нажимает» — и клик идёт по-настоящему,
    // тем же обработчиком, что и клик мышью. Без анимации (prefers-reduced-motion) — сразу клик.
    function tourDemo() {
      var t = state.tour;
      if (!t || t.busy) return;
      var step = tourSteps(t.view)[t.i], els = tourEls(step);
      if (!els.length) return;
      var r = els[0].getBoundingClientRect(), cur = tourQ('tcur'), clk = tourQ('tclk');
      var x = step.at === 'left' ? r.left + Math.min(140, r.width / 3) : r.left + r.width / 2, y = r.top + r.height / 2;
      var fire = function () {
        if (state.tour !== t) { cur.style.display = 'none'; return; }
        t.busy = false;
        var now = tourEls(step);
        if (now.length && !step.done(t.key)) onClick({ target: now[0] });
        else tourSync();
      };
      if (!canAnim()) { fire(); return; }
      t.busy = true;
      var btn = tourNode.querySelector('[data-tact="demo"]'), br = btn ? btn.getBoundingClientRect() : { left: x, top: y + 90, width: 0, height: 0 };
      cur.style.transition = 'none';
      cur.style.left = Math.round(br.left + br.width / 2) + 'px';
      cur.style.top = Math.round(br.top + br.height / 2) + 'px';
      cur.style.display = 'block';
      cur.getBoundingClientRect();
      cur.style.transition = '';
      cur.style.left = Math.round(x - 5) + 'px';
      cur.style.top = Math.round(y - 2.5) + 'px';
      setTimeout(function () {
        clk.style.left = Math.round(x) + 'px';
        clk.style.top = Math.round(y) + 'px';
        clk.animate([{ opacity: 0.9, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.5)' }], { duration: 450, easing: 'ease-out' });
        cur.animate([{ transform: 'scale(1)' }, { transform: 'scale(.82)' }, { transform: 'scale(1)' }], { duration: 240 });
        setTimeout(function () { fire(); setTimeout(function () { cur.style.display = 'none'; }, 420); }, 200);
      }, 700);
    }
    function tourAct(a) {
      if (a === 'tour') { tourStart(state.view || 'onepager'); return; }
      if (!state.tour) return;
      if (a === 'next') tourGo(state.tour.i + 1, 1);
      else if (a === 'back') tourGo(state.tour.i - 1, -1);
      else if (a === 'demo') tourDemo();
      else if (a === 'close') tourEnd();
      else if (a === 'nexttab') { if (TOUR_NEXT[state.tour.view]) tourStart(TOUR_NEXT[state.tour.view]); else tourEnd(); }
    }

    // Анимация появления (ДС 6.5): только у графиков, впервые показанных с этими данными
    // (CHARTS[i].anim), — не на ресайз и не на наведение. Web Animations, fill 'backwards':
    // после конца анимации элемент живёт по своему CSS (подсветка легенды работает).
    function animateCharts() {
      var boxes = overlay.querySelectorAll('[data-ci]');
      for (var b = 0; b < boxes.length; b++) {
        var ch = CHARTS[+boxes[b].getAttribute('data-ci')];
        if (!ch || !ch.anim) continue;
        ch.anim = false;
        var run = function (sel, frames, o) {
          var els = boxes[b].querySelectorAll(sel);
          for (var i = 0; i < els.length; i++) {
            var d = +(els[i].getAttribute('data-d') || 0);
            try { els[i].animate(frames, { duration: o.dur, easing: o.ease, delay: (o.delay || 0) + d, fill: 'backwards' }); } catch (er) { /* без анимации */ }
          }
        };
        run('.' + CFG.ns + '-ln', [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { dur: CFG.chart.drawMs, ease: 'cubic-bezier(.4,0,.2,1)' });
        run('.' + CFG.ns + '-fd', [{ opacity: 0 }, { opacity: 1 }], { dur: 320, ease: 'ease-out' });
      }
    }

    // Ширины графиков меряются по плейсхолдерам [data-cw] после вставки
    // разметки: SVG рисуется в пикселях ячейки, а не растягивается (у линий
    // иначе плывут подписи). Узкая ячейка — класс <ns>-narrow вместо @media.
    // relayout() правит ТОЛЬКО габариты: класс корня и SVG графиков по месту.
    function measureNarrow() {
      var w = overlay.clientWidth || 0, narrow = w > 0 && w < 1100;
      if (narrow === !!state.narrow) return false;
      state.narrow = narrow;
      var root = overlay.querySelector('.' + CFG.ns + '-root');
      if (root) {
        if (narrow) root.classList.add(CFG.ns + '-narrow');
        else root.classList.remove(CFG.ns + '-narrow');
      }
      return true;
    }
    function measureCharts() {
      var changed = false, els = overlay.querySelectorAll('[data-cw]'), seen = {};
      for (var k = 0; k < els.length; k++) {
        var key = els[k].getAttribute('data-cw');
        if (seen[key]) continue;
        seen[key] = 1;
        var cw = els[k].clientWidth || 0;
        if (cw && Math.abs(cw - (state.cw[key] || 0)) > 2) { state.cw[key] = cw; changed = true; }
      }
      return changed;
    }
    // Имена «Команд» — одной строкой: предел ширины имени — 36 % панели таблицы (160…420 px).
    // Панель — ячейка сетки (её ширину задаёт доля, а не таблица): петли нет, тянется с разделителем.
    function measureNames() {
      var el = overlay.querySelector('.' + CFG.ns + '-tpan'), w = el ? el.clientWidth : 0;
      if (!w) return;
      el.style.setProperty('--' + CFG.ns + '-nmw', Math.max(160, Math.min(420, Math.round(w * 0.36))) + 'px');
      // Ширину колонки имён меряем, пока все имена в одну строку, и держим её минимумом (--hh-ncol);
      // только потом разрешаем выбранной строке и находкам поиска развернуть имя (-wrapok).
      var t = el.querySelector('table'), th = t ? t.querySelector('th.' + CFG.ns + '-l') : null;
      if (!th) return;
      t.classList.remove(CFG.ns + '-wrapok');
      el.style.removeProperty('--' + CFG.ns + '-ncol');
      el.style.setProperty('--' + CFG.ns + '-ncol', th.offsetWidth + 'px');
      t.classList.add(CFG.ns + '-wrapok');
    }
    // «Команды» в две колонки: таблица и «Динамика» одной высоты — не выше экрана, доставшегося чарту
    // (state.vpH: в iframe Proteus ячейка выше экрана, а прокручивается страница борда), каждая
    // прокручивается внутри. Узкая ячейка — одна колонка, высота по содержимому.
    function fitSplit() {
      // липкий верх: переход к строке (scrollIntoView) не прячет её под шапкой
      var stk = overlay.querySelector('.' + CFG.ns + '-stick');
      overlay.style.scrollPaddingTop = stk ? stk.offsetHeight + 'px' : '';
      if (stk) stk.classList.toggle(CFG.ns + '-shd', overlay.scrollTop > 2);
      var sp = overlay.querySelector('.' + CFG.ns + '-split');
      if (!sp) return;
      if (state.narrow) { sp.classList.remove(CFG.ns + '-fit'); sp.style.height = ''; return; }
      // Видимое ещё не измерено (первый кадр) — оценка по экрану монитора, а не по высоте ячейки.
      var scrH = window.screen && window.screen.availHeight ? window.screen.availHeight - 140 : 99999;
      var or = overlay.getBoundingClientRect(), r = sp.getBoundingClientRect(), scr = state.vpH > 0 ? state.vpH : Math.min(window.innerHeight || overlay.clientHeight, scrH);
      var top = r.top - or.top + overlay.scrollTop, vis = Math.min(overlay.clientHeight, scr);
      var h = Math.max(CFG.split.minH, Math.min(overlay.clientHeight - top - CFG.spacing.gutter, vis - 2 * CFG.spacing.gap));
      if (sp.getAttribute('data-split-box') && sp.clientWidth) {
        state.splitW = sp.clientWidth;
        if (!state.split) sp.style.gridTemplateColumns = splitCols(splitAuto(+sp.getAttribute('data-mets') || 0));
      }
      sp.classList.add(CFG.ns + '-fit');
      sp.style.height = Math.round(h) + 'px';
    }
    // Высота графиков «Динамики» — по высоте её панели: два графика с заголовками целиком (владелец 12.10:
    // «две метрики точно должны поместиться»), 150…236 px; узкая ячейка (одна колонка) — CFG.chart.hSmall.
    function fitDyn() {
      var pb = overlay.querySelector('.' + CFG.ns + '-fit>.' + CFG.ns + '-dpan>.' + CFG.ns + '-pb'), h = 0;
      if (pb && !state.narrow) {
        var cs = window.getComputedStyle(pb), hh = pb.querySelector('.' + CFG.ns + '-chh');
        var inner = pb.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
        var head = hh ? hh.offsetHeight + 4 : 32;
        h = Math.max(150, Math.min(CFG.chart.h, Math.floor((inner - 14 - 2 * head - 4) / 2)));
      }
      if (Math.abs(h - (state.dynH || 0)) <= 4) return false;
      state.dynH = h;
      return true;
    }
    function relayout() {
      var a = measureNarrow();
      fitSplit();
      a = fitDyn() || a;
      var b = measureCharts();
      measureNames();
      placeDrawer();
      if (!a && !b) { tourPos(); return false; }
      var els = overlay.querySelectorAll('[data-ci]');
      for (var k = 0; k < els.length; k++) {
        var ci = +els[k].getAttribute('data-ci'), ch = CHARTS[ci];
        if (ch) els[k].innerHTML = ch.draw(cwOf(ch.kind), { ci: ci, anim: ch.anim });
      }
      tourPos();
      return true;
    }

    // render ТОЛЬКО пересобирает разметку. Делегированные обработчики
    // навешиваются ОДИН РАЗ СНАРУЖИ render(): overlay не пересоздаётся.
    // Любой addEventListener внутри render() ЗАПРЕЩЁН — он создаёт дубли.
    // overlay — скролл-контейнер: позицию (и прокрутку колонок и списков окна фильтров) храним.
    // Ключ прокрутки — атрибут и его значение: список «юнит», колонка «Показ», тело окна.
    var SCROLL_KEYS = ['data-plist', 'data-mdsub', 'data-mdcol', 'data-mdbody'];
    function scrollsOf() {
      var out = {};
      for (var a = 0; a < SCROLL_KEYS.length; a++) {
        var els = overlay.querySelectorAll('[' + SCROLL_KEYS[a] + ']');
        for (var i = 0; i < els.length; i++) if (els[i].scrollTop) out[SCROLL_KEYS[a] + '=' + els[i].getAttribute(SCROLL_KEYS[a])] = els[i].scrollTop;
      }
      return out;
    }
    function restoreScrolls(m) {
      for (var a = 0; a < SCROLL_KEYS.length; a++) {
        var els = overlay.querySelectorAll('[' + SCROLL_KEYS[a] + ']');
        for (var i = 0; i < els.length; i++) {
          var k = SCROLL_KEYS[a] + '=' + els[i].getAttribute(SCROLL_KEYS[a]);
          if (m[k]) els[i].scrollTop = m[k];
        }
      }
    }
    // Фокус внутри окна фильтров переживает перерисовку: тот же контрол ищем по его data-атрибутам
    // (флажок значения, кнопка раздела, поиск); не нашёлся — фокус на самом окне (Esc и Tab работают).
    var FOCUS_KEYS = ['data-view', 'data-tour', 'data-psearch', 'data-cutkey', 'data-cutval', 'data-metric', 'data-mgroup', 'data-action', 'data-key', 'data-val', 'data-id', 'data-pop'];
    function cssq(v) { return String(v).replace(/["\\]/g, '\\$&'); }
    function focusSel(el) {
      var sel = '';
      for (var i = 0; i < FOCUS_KEYS.length; i++) {
        var v = el.getAttribute ? el.getAttribute(FOCUS_KEYS[i]) : null;
        if (v !== null) sel += '[' + FOCUS_KEYS[i] + '="' + cssq(v) + '"]';
      }
      return sel;
    }
    function focusQuiet(el) { try { el.focus({ preventScroll: true }); } catch (erf) { el.focus(); } }
    // Флажок группы метрик «часть выбрана» — свойство, не атрибут: ставим после каждой сборки.
    function markInd(box) {
      var els = (box || overlay).querySelectorAll('input[data-ind]');
      for (var i = 0; i < els.length; i++) els[i].indeterminate = true;
    }
    function render() {
      var st = overlay.scrollTop, sl = overlay.scrollLeft, keep = scrollsOf();
      // Прокрутка внутри панелей «Команд» (таблица, «Динамика») — та же, пока данные и вкладка те же.
      var tpb = overlay.querySelector('.' + CFG.ns + '-tpan>.' + CFG.ns + '-pb'), dpb = overlay.querySelector('.' + CFG.ns + '-dpan>.' + CFG.ns + '-pb');
      var pane = { t: tpb ? tpb.scrollTop : 0, d: dpb ? dpb.scrollTop : 0, sig: state.paneSig };
      // Фокус был в окне (флажок, кнопка раздела) — перерисовка его роняет на body, и Esc
      // перестаёт доходить до чарта: возвращаем его тому же контролу или окну.
      var ae = document.activeElement, fany = !!(ae && ae !== overlay && overlay.contains(ae)), fin = !!(state.drawer && fany), fsel = fany ? focusSel(ae) : '';
      overlay.innerHTML = buildHTML();
      // Открыто окно фильтров — отчёт под ним не прокручивается: колесо над затемнением уходит странице
      // борда (окно едет за видимой частью, visTick), колонки окна листаются сами.
      overlay.style.overflow = state.drawer ? 'hidden' : 'auto';
      relayout();
      animateCharts();
      markInd();
      state.hzCur = null;
      overlay.scrollTop = st;
      overlay.scrollLeft = sl;
      state.paneSig = dataSig() + '|' + (state.view || 'onepager');
      if (pane.sig === state.paneSig) {
        var tpb2 = overlay.querySelector('.' + CFG.ns + '-tpan>.' + CFG.ns + '-pb'), dpb2 = overlay.querySelector('.' + CFG.ns + '-dpan>.' + CFG.ns + '-pb');
        if (tpb2) tpb2.scrollTop = pane.t;
        if (dpb2) dpb2.scrollTop = pane.d;
      }
      if (state.scrollSel) {
        state.scrollSel = false;
        var srow = overlay.querySelector('.' + CFG.ns + '-tpan tr.' + CFG.ns + '-sel');
        if (srow && srow.scrollIntoView) { try { srow.scrollIntoView({ block: 'center' }); } catch (ers) { srow.scrollIntoView(); } }
      }
      placeDrawer();
      placeDsel();
      // Колонки и списки окна — после placeDrawer: одна колонка или две решает ширина окна.
      restoreScrolls(keep);
      if (fin && !overlay.contains(document.activeElement)) {
        var fe = fsel ? overlay.querySelector('.' + CFG.ns + '-mdl ' + fsel) : null;
        if (!fe) fe = overlay.querySelector('.' + CFG.ns + '-mdl');
        if (fe) focusQuiet(fe);
      } else if (fany && !state.drawer && fsel && !overlay.contains(document.activeElement)) {
        // Вкладка, сортировка, строка «Команд», переключатель — тот же контрол после перерисовки (иначе фокус в начало).
        var fo = overlay.querySelector(fsel);
        if (fo) focusQuiet(fo);
      }
      renderTip();
      tourSync();
    }
    state.rerender = render;

    // Имена атрибутов — ЧАСТЬ КОНТРАКТА, а не стиль: `data-tip`, `data-kind`,
    // `data-action`, `data-view` — ровно эти, ЦЕЛИКОМ. По ним smoke.mjs ищет,
    // что наводить и на что кликать. Своё имя (`data-tip-kind`) он не найдёт,
    // а склейка с префиксом (`CFG.ns + '-data-tip'`) в DOM даёт `pvt-data-tip`:
    // виджет при этом работает — свой же обработчик читает то же имя, — но
    // ВЕСЬ тултиповый слой уходит в N/A, и экрана не видит никто (RETRO 56, 59).
    // Префикс CFG.ns нужен КЛАССАМ, data-атрибутам — нет.
    function trigger(node, attr) {
      while (node && node !== overlay) {
        if (node.getAttribute && node.getAttribute(attr) !== null) return node;
        node = node.parentNode;
      }
      return null;
    }

    // ── НАВЕДЕНИЕ: тултип едет за курсором и не мигает ──
    // Цель — ближайший [data-tip] (подсказка у всей ячейки таблицы, у колонки спарклайна)
    // или хит-зона линии [data-hz] (колонка — по X курсора, перекрестие и все серии сразу).
    // Между соседними целями тултип НЕ гаснет — меняется только содержимое; ушёл в пустоту —
    // гаснет через TIP_HIDE мс (щели между ячейками и столбиками не мигают).
    var TIP_HIDE = 110, tipHideT = null;
    function curPt(e) { return { left: e.clientX, top: e.clientY, width: 0, height: 0, pt: true }; }
    function cancelHide() { if (tipHideT) { clearTimeout(tipHideT); tipHideT = null; } }
    function dropTip() { cancelHide(); state.tip = null; clearXh(); hideTip(); }
    function scheduleHide() {
      if (tipHideT || (!state.tip && !state.hzCur)) return;
      tipHideT = setTimeout(function () { tipHideT = null; state.tip = null; clearXh(); hideTip(); }, TIP_HIDE);
    }
    function clearXh() {
      var c = state.hzCur;
      state.hzCur = null;
      if (c && c.g) c.g.style.display = 'none';
    }
    // Колонка линии под курсором: перекрестие, маркеры серий, содержимое — только при смене колонки.
    function hzMove(hz, e) {
      var ch = CHARTS[+hz.getAttribute('data-hc')], svg = hz.ownerSVGElement;
      if (!ch || !ch.hz || !svg) return;
      var r = svg.getBoundingClientRect(), x = e.clientX - r.left, xs = ch.hz.xs, i = 0;
      for (var k = 1; k < xs.length; k++) if (Math.abs(xs[k] - x) < Math.abs(xs[i] - x)) i = k;
      var c = state.hzCur;
      if (!c || c.hz !== hz || c.i !== i) {
        if (c && c.hz !== hz) clearXh();
        var g = svg.querySelector('[data-xh]');
        if (g) {
          var ln = g.querySelector('line');
          if (ln) { ln.setAttribute('x1', xs[i].toFixed(1)); ln.setAttribute('x2', xs[i].toFixed(1)); }
          var dots = g.querySelectorAll('[data-xs]');
          for (var d = 0; d < dots.length; d++) {
            var yv = ch.hz.ys[dots[d].getAttribute('data-xs')][i];
            if (yv === null || yv === undefined) { dots[d].style.display = 'none'; continue; }
            dots[d].style.display = '';
            dots[d].setAttribute('cx', xs[i].toFixed(1));
            dots[d].setAttribute('cy', yv.toFixed(1));
          }
          g.style.display = '';
        }
        state.hzCur = { hz: hz, i: i, g: g };
      }
      state.tip = { rect: curPt(e), key: ch.hz.tips[i], kind: 'pt', hz: true };
      showTip(state.tip.key, state.tip.rect);
      // Курсор на номерной точке (до 13 px от центра) — подсветить её факт справа.
      var mks = ch.hz.mk || [], y = e.clientY - r.top, near = '';
      for (var q = 0; q < mks.length; q++) {
        var dx = mks[q].x - x, dy = mks[q].y - y;
        if (dx * dx + dy * dy <= 169) near = mks[q].n;
      }
      mkLink(near ? trigger(svg, 'data-story') : null, near);
    }
    // Факт «Что видно» ↔ его точка на графике (data-mk внутри [data-story]): пара — класс -mkon, у блока —
    // data-mkon (остальные точки бледнее). Меняется только при смене пары; render() пересоздаёт DOM — старая
    // пара просто отпадает.
    function mkLink(box, n) {
      var c = state.mkOn, on = CFG.ns + '-mkon', i;
      if (c && c.box === box && c.n === n) return;
      if (c) {
        c.box.removeAttribute('data-mkon');
        var old = c.box.querySelectorAll('.' + on);
        for (i = 0; i < old.length; i++) old[i].classList.remove(on);
      }
      state.mkOn = null;
      if (!box || !n) return;
      box.setAttribute('data-mkon', n);
      var els = box.querySelectorAll('[data-mk="' + n + '"]');
      for (i = 0; i < els.length; i++) els[i].classList.add(on);
      state.mkOn = { box: box, n: n };
    }
    // «Трансформеры»: строка таблицы ↔ доля на кольце и в списке (data-trv): наведение подсвечивает пару, прочие доли
    // бледнеют. Как mkLink — только классы, без перерисовки.
    function trLink(box, n) {
      var c = state.trOn, on = CFG.ns + '-trh', i;
      if (c && c.box === box && c.n === n) return;
      if (c) {
        c.box.removeAttribute('data-trh');
        var old = c.box.querySelectorAll('.' + on);
        for (i = 0; i < old.length; i++) old[i].classList.remove(on);
      }
      state.trOn = null;
      if (!box || !n) return;
      box.setAttribute('data-trh', n);
      var els = box.querySelectorAll('[data-trv="' + n + '"]');
      for (i = 0; i < els.length; i++) els[i].classList.add(on);
      state.trOn = { box: box, n: n };
    }
    // Наведение на пункт легенды гасит чужие серии своего графика.
    function legendHi(el) {
      var box = el ? trigger(el, 'data-chb') : null, cur = state.hiBox;
      if (cur && cur !== box) cur.removeAttribute('data-hi');
      state.hiBox = box;
      if (box) box.setAttribute('data-hi', el.getAttribute('data-lgs'));
    }
    function onMove(e) {
      if (state.dragging) return;
      var lg = trigger(e.target, 'data-lgs');
      if (lg || state.hiBox) legendHi(lg);
      var hz = trigger(e.target, 'data-hz');
      if (hz) { cancelHide(); hzMove(hz, e); return; }
      var mkEl = trigger(e.target, 'data-mk');
      mkLink(mkEl ? trigger(mkEl, 'data-story') : null, mkEl ? mkEl.getAttribute('data-mk') : '');
      var trEl = trigger(e.target, 'data-trv');
      trLink(trEl ? trigger(trEl, 'data-trbox') : null, trEl ? trEl.getAttribute('data-trv') : '');
      var el = trigger(e.target, 'data-tip');
      // Кнопка с раскрытым поповером подсказку не показывает: меню и так перед глазами.
      if (el && el.getAttribute('aria-expanded') === 'true' && el.getAttribute('data-pop')) el = null;
      if (!el) { scheduleHide(); return; }
      cancelHide();
      if (state.hzCur) clearXh();
      var html = el.getAttribute('data-tip') || '';
      if (!html) { scheduleHide(); return; }
      state.tip = { rect: curPt(e), key: html, kind: el.getAttribute('data-kind') || '' };
      showTip(html, state.tip.rect);
    }
    function onLeave() { legendHi(null); mkLink(null, ''); trLink(null, ''); dropTip(); }
    // Подсказки и ⓘ — и с клавиатуры: фокус (Tab) показывает подсказку у элемента, уход фокуса — прячет.
    function onFocusIn(e) {
      var el = trigger(e.target, 'data-tip');
      var kb = false;
      try { kb = e.target.matches(':focus-visible'); } catch (erv) { kb = false; }
      if (!el || !kb || state.dragging) return;
      var html = el.getAttribute('data-tip') || '';
      if (!html) return;
      cancelHide();
      state.tip = { rect: el.getBoundingClientRect(), key: html, kind: el.getAttribute('data-kind') || '' };
      showTip(html, state.tip.rect);
    }
    function onFocusOut() { if (state.tip && !state.tip.rect.pt) dropTip(); }

    // ── ЭМИССИЯ КРОСС-ФИЛЬТРА ──
    // Чарт фильтрует САМ СЕБЯ (самовлияние включено в дашборде). Эмит ставит
    // «ожидание» с подписью запроса; снимает его новый ответ с тем же эхом.
    // Эха нет за pendingWarnMs — самовлияние не настроено: говорим об этом.
    function armPend() {
      if (state.pendT) clearTimeout(state.pendT);
      state.pendT = null;
      if (!state.pend) return;
      var left = Math.max(200, CFG.pendingWarnMs - (Date.now() - state.pend.at));
      state.pendT = setTimeout(function () {
        state.pendT = null;
        if (!state.pend) return;
        state.pend = null;
        state.warn = CFG.text.notApplied;
        if (state.rerender) state.rerender();
      }, left);
    }
    function emit(next, keepPop) {
      if (!keepPop) {
        state.open = '';
        state.qk = {};
      }
      var sig = sigOf(next);
      if (sig === sigOf(reqEcho())) { state.pend = null; armPend(); render(); return; }
      if (typeof applyCrossFilter !== 'function') {
        state.warn = 'Фильтры не применились: в этом окружении нет applyCrossFilter (откройте чарт на дашборде).';
        render();
        return;
      }
      state.warn = '';
      state.lastSig = sig;
      state.pend = { sig: sig, at: Date.now() };
      state.tip = null;
      armPend();
      render();
      applyCrossFilter(maskOf(next));
    }
    // Переход к юниту действием («Открыть юнит», путь, «Показать» у цели): сразу, мимо «Применить»;
    // новое дерево «Команд» — раскрытия и набранные фильтры не переносятся.
    function withUnit(ids) {
      var n = reqNow();
      n.unit = sameSet(ids, MODEL.roots) ? [] : ids.slice();
      state.openRows = {};
      state.selTeam = '';
      state.stage = null;
      state.tq = '';
      return n;
    }
    // Переход к юниту (кнопка «Открыть юнит», путь, «↑», «Показать» у цели, «Применить»):
    // юнит до перехода — в стек «← Назад».
    function pushBack() {
      var cur = reqNow().unit;
      state.unitBack = state.unitBack || [];
      var last = state.unitBack[state.unitBack.length - 1];
      if (last && sameSet(last, cur)) return;
      state.unitBack.push(cur.slice());
      if (state.unitBack.length > 10) state.unitBack.shift();
    }
    function goUnit(ids) {
      var nu = sameSet(ids, MODEL.roots) ? [] : ids;
      if (sameSet(nu, reqNow().unit)) return;
      pushBack();
      emit(withUnit(ids));
    }
    function forgetDrawn(prefix) {
      for (var k in state.drawn) if (state.drawn.hasOwnProperty(k) && k.indexOf(prefix) === 0) delete state.drawn[k];
    }
    // ── РАЗДЕЛИТЕЛЬ «таблица | динамика» («Команды») ──
    // Тянется мышью: доля пишется в стиль сетки на лету (без render), графики справа
    // перерисовываются по новой ширине через relayout раз в кадр. Двойной клик — как было.
    function setSplit(box, sh) {
      sh = Math.max(CFG.split.min, Math.min(CFG.split.max, sh));
      state.split = sh;
      if (box) {
        box.style.gridTemplateColumns = splitCols(sh);
        var g = box.querySelector('[data-split]');
        if (g) g.setAttribute('aria-valuenow', String(Math.round(sh * 100)));
      }
    }
    function onDown(e) {
      var g = trigger(e.target, 'data-split');
      if (!g || (e.button !== undefined && e.button !== 0)) return;
      var box = g.parentNode, r = box.getBoundingClientRect();
      e.preventDefault();
      dropTip();
      state.dragging = true;
      overlay.classList.add(CFG.ns + '-drag');
      var raf = null;
      var move = function (ev) {
        setSplit(box, (ev.clientX - r.left - 6) / Math.max(1, r.width - 12));
        if (raf === null) raf = setTimeout(function () { raf = null; relayout(); }, 60);
      };
      var up = function () {
        document.removeEventListener('mousemove', move, true);
        document.removeEventListener('mouseup', up, true);
        state.dragging = false;
        overlay.classList.remove(CFG.ns + '-drag');
        relayout();
      };
      document.addEventListener('mousemove', move, true);
      document.addEventListener('mouseup', up, true);
    }
    function onDbl(e) {
      var g = trigger(e.target, 'data-split');
      if (!g) return;
      state.split = 0;
      render();
    }
    // Трансформеры: ось грузится лениво — один раз на ось, когда вкладку открыли.
    function ensureAxis() {
      if ((state.view || 'onepager') !== 'transform' || state.pend) return;
      var want = wantAxis();
      if (axisReady(want) || state.axisTried[want]) return;
      state.axisTried[want] = true;
      var n = reqNow();
      n.axis = want;
      emit(n);
    }
    // Фокус в окне фильтров: поле поиска списка kind ('unit', 'hrbp', 'cut:<разрез>'), иначе — само окно.
    function focusPop(kind) {
      var inp = overlay.querySelector('[data-psearch="' + cssq(kind || 'unit') + '"]');
      if (inp) {
        focusQuiet(inp);
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (er) { /* поле без выделения */ }
        return;
      }
      var pop = overlay.querySelector('.' + CFG.ns + '-mdl');
      if (pop) focusQuiet(pop);
    }
    // Окно «Фильтры и настройки» — position:fixed по центру ВИДИМОЙ НА ЭКРАНЕ части чарта (visV: в iframe
    // Proteus ячейка выше экрана, прокручивается страница борда — окно едет за видимой частью), не больше
    // CFG.modal.w × h, с полями от краёв; колонок — 3 от CFG.modal.three, 2 от two, иначе 1 (state.mdm).
    // Видимость ещё не измерена, а чарт в iframe — окно у верха ячейки и не выше экрана. Затемнение — на весь
    // чарт в окне. fixed считается от окна, но у предка с transform — от этого предка: ставим окно в 0,0,
    // меряем, где оно оказалось, и сдвигаем на разницу. Зовётся из render, relayout, ресайза, прокрутки
    // и колбэка видимости.
    function placeDrawer() {
      var d = overlay.querySelector('.' + CFG.ns + '-mdl'), b = overlay.querySelector('.' + CFG.ns + '-mdb');
      if (!d) return;
      var r = overlay.getBoundingClientRect(), C = CFG.modal, vv = visV();
      var bt = Math.max(r.top, 0), bb = Math.min(r.bottom, window.innerHeight);
      var left = Math.max(r.left, 0), right = Math.min(r.right, window.innerWidth);
      var top = Math.max(bt, vv.t), bottom = Math.min(bb, vv.b), inFrame = true;
      try { inFrame = window.self !== window.top; } catch (erf) { inFrame = true; }
      if (inFrame && (!state.vis || state.vis.none)) bottom = Math.min(bb, top + Math.max(320, ((window.screen && window.screen.availHeight) || 900) - 260));
      if (bottom - top < 120) { top = bt; bottom = bb; }
      var vw = Math.max(0, right - left), vh = Math.max(0, bottom - top);
      var mx = vw < 640 ? 8 : 24, my = vh < 640 ? 8 : 24;
      var w = Math.min(C.w, Math.max(Math.min(vw, 300), vw - 2 * mx)), h = Math.min(C.h, Math.max(Math.min(bb - bt, 320), vh - 2 * my));
      var y = Math.max(bt, Math.min(top + Math.max(0, (vh - h) / 2), bb - h));
      var m = w >= C.three ? 3 : (w >= C.two ? 2 : 1);
      if (m !== state.mdm) {
        state.mdm = m;
        d.classList.remove(CFG.ns + '-md1');
        d.classList.remove(CFG.ns + '-md3');
        if (m !== 2) d.classList.add(CFG.ns + '-md' + m);
      }
      d.style.top = '0px'; d.style.left = '0px';
      var o = d.getBoundingClientRect();
      d.style.width = Math.round(w) + 'px'; d.style.height = Math.round(h) + 'px';
      d.style.left = Math.round(left + (vw - w) / 2 - o.left) + 'px';
      d.style.top = Math.round(y - o.top) + 'px';
      if (b) { b.style.top = (bt - o.top) + 'px'; b.style.left = (left - o.left) + 'px'; b.style.width = vw + 'px'; b.style.height = Math.max(0, bb - bt) + 'px'; }
      placeCutPop(d);
    }
    // Выпадающий список длинного разреза (три колонки): вниз от кнопки, если список там помещается или
    // снизу места больше, иначе — вверх; высота — до края колонки разрезов (не ниже 140 px).
    function placeCutPop(d) {
      var P = CFG.ns, pop = d.querySelector('[data-tz="cuts"] .' + P + '-accb');
      if (!pop) return;
      pop.classList.remove(P + '-up');
      pop.style.maxHeight = '';
      if (state.mdm !== 3) return;
      var col = d.querySelector('[data-mdsub="c"]'), btn = pop.parentNode ? pop.parentNode.querySelector('.' + P + '-ddb') : null;
      if (!col || !btn) return;
      var cr = col.getBoundingClientRect(), br = btn.getBoundingClientRect(), need = pop.offsetHeight;
      var below = cr.bottom - br.bottom - 12, above = br.top - cr.top - 12, up = need > below && above > below;
      if (up) pop.classList.add(P + '-up');
      pop.style.maxHeight = Math.round(Math.max(140, up ? above : below)) + 'px';
    }
    // Открыт выпадающий список разреза (не раздел в потоке): закрывается кликом мимо и Esc, как выпадашка.
    function cutPopOpen() { return !!state.drawer && state.mdm === 3 && String(state.open || '').indexOf('cut:') === 0; }
    function inScope(el, key) {
      for (var n = el; n && n !== overlay; n = n.parentNode) if (n.getAttribute && n.getAttribute('data-scope') === key) return true;
      return false;
    }
    // Окно закрылось — фокус обратно на «Фильтры» (клавиатура продолжает с того же места).
    function focusOpener() {
      var fb = overlay.querySelector('[data-action="drawer"]');
      if (fb && !state.tour) focusQuiet(fb);
    }
    // Закрыть окно (×, Esc, клик по подложке): набранное остаётся — над отчётом плашка «Выбрано, не применено».
    function closeDrawer() {
      state.drawer = false;
      state.open = '';
      state.qk = {};
      render();
      focusOpener();
    }
    // «Применить»: показ (метрики, «Только фокусные») — сразу, без запроса; юнит, HRBP и разрезы —
    // одним запросом. Окно закрывается.
    function applyStaged() {
      if (state.pend) { render(); return; }
      if (state.stageV) {
        var off = {};
        for (var k in state.stageV.off) if (state.stageV.off.hasOwnProperty(k) && state.stageV.off[k]) off[k] = true;
        state.metricOff = off;
        state.focusOnly = !!state.stageV.focus;
        state.stageV = null;
      }
      var was = !!state.drawer;
      state.drawer = false;
      state.open = '';
      state.qk = {};
      if (!stageDiff()) { state.stage = null; render(); if (was) focusOpener(); return; }
      var na = staged();
      if (!sameSet(na.unit, reqNow().unit)) { pushBack(); state.openRows = {}; state.selTeam = ''; state.tq = ''; }
      state.hz = na.hz || '';
      if (!stageDiff()) state.stage = null;
      emit(na);
      if (was) focusOpener();
    }
    // Буфер обмена: выделенный текст из скрытого поля (работает и без прав на navigator.clipboard),
    // иначе — navigator.clipboard. Подпись «Скопировано» — рядом с кнопкой, сама гаснет.
    function copyText(text) {
      var ta = document.createElement('textarea'), ok = false;
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      overlay.appendChild(ta);
      try { ta.select(); ok = document.execCommand('copy'); } catch (er) { ok = false; }
      overlay.removeChild(ta);
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        try {
          var pr = navigator.clipboard.writeText(text);
          if (pr && pr['catch']) pr['catch'](function () { /* отказ — подпись уже сказала «скопировано» */ });
          ok = true;
        } catch (er2) { ok = false; }
      }
      return ok;
    }
    function copyNote(btn, msg) {
      var old = overlay.querySelector('.' + CFG.ns + '-cpok');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var n = document.createElement('span');
      n.className = CFG.ns + '-cpok';
      n.setAttribute('role', 'status');
      n.textContent = msg;
      if (btn.parentNode) btn.parentNode.insertBefore(n, btn);
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 2600);
      try { btn.focus(); } catch (er3) { /* без фокуса */ }
    }
    function showTeamRow(key, mk) {
      var all = teamRows(true), r = null;
      for (var i = 0; i < all.length; i++) if (all[i].key === key) r = all[i];
      if (!r) return;
      var path = r.id === '·' ? rowPpfx(r) : r.pfx, segs = path ? path.split('/') : [];
      for (var j = 1; j <= segs.length - (r.id === '·' ? 0 : 1); j++) state.openRows[segs.slice(0, j).join('/')] = true;
      var m = mk ? METRIC[mk] : null;
      state.block = m && selMetrics(m.block).length ? m.block : 'all';
      state.view = 'teams';
      state.selTeam = key;
      state.tq = '';
      state.tip = null;
      state.scrollSel = true;
      hideTip();
      render();
    }
    // Поиск в окне: пересобираем ТОЛЬКО свой список — поле ввода не трогаем (каретка жива, E23b).
    function refreshList(kind) {
      var box = overlay.querySelector('[data-plist="' + cssq(kind) + '"]');
      if (!box) return;
      if (kind === 'unit') box.innerHTML = unitListHTML();
      else if (kind === 'hrbp') box.innerHTML = hrbpListHTML();
      else if (kind === 'metric') { box.innerHTML = metricListHTML(); markInd(box); }
      else if (kind.indexOf('cut:') === 0 && CUT[kind.slice(4)]) box.innerHTML = cutListHTML(CUT[kind.slice(4)]);
      box.scrollTop = 0;
      tourPos();
    }
    function copyLine() {
      var ta = overlay.querySelector('[data-kd-out]'), ok = false, d = kdDraft();
      if (kdErrors(d).length) return;
      try { if (ta) { ta.style.display = ''; ta.focus(); ta.select(); ok = document.execCommand('copy'); } } catch (er) { ok = false; }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        try { navigator.clipboard.writeText(kdLink(d)); ok = true; } catch (er2) { ok = false; }
      }
      if (ok && ta) { ta.blur(); ta.style.display = 'none'; }
      state.copied = ok ? 'Скопировано — вставьте в адресную строку новой вкладки' : 'Выделите ссылку ниже и нажмите Ctrl+C';
      var msg = overlay.querySelector('[data-kd-msg]');
      if (msg) msg.textContent = state.copied;
    }
    // Обычный клик по «Открыть форму»: не уходим из отчёта, подсказываем правую кнопку.
    function kdLinkHint() {
      state.copied = 'Нажмите правой кнопкой → «Открыть ссылку в новой вкладке»';
      var msg = overlay.querySelector('[data-kd-msg]');
      if (msg) msg.textContent = state.copied;
      var h = overlay.querySelector('[data-kd-hint]');
      if (h && h.className.indexOf(CFG.ns + '-kflash') < 0) {
        h.className += ' ' + CFG.ns + '-kflash';
        setTimeout(function () { h.className = h.className.replace(' ' + CFG.ns + '-kflash', ''); }, 900);
      }
    }
    // Поля формы — без перерисовки (фокус и каретка на месте): ссылка, ошибки, «сейчас у юнита».
    function updateKd() {
      var d = kdDraft(), err = kdErrors(d);
      var out = overlay.querySelector('[data-kd-out]');
      if (out) { out.value = err.length ? '' : kdLink(d); out.style.display = 'none'; }
      var lk = overlay.querySelector('[data-kd-link]');
      if (lk) { lk.setAttribute('href', err.length ? '#' : kdLink(d)); lk.style.display = err.length ? 'none' : ''; }
      var hn = overlay.querySelector('[data-kd-hint]');
      if (hn) hn.style.display = err.length ? 'none' : '';
      var eb = overlay.querySelector('[data-kd-err]');
      if (eb) eb.textContent = err.length ? 'Чтобы открыть форму: ' + err.join(', ') + '.' : '';
      var cb = overlay.querySelector('[data-action="kcopy"]');
      if (cb) cb.disabled = !!err.length;
      var nw = overlay.querySelector('[data-kd-now]');
      if (nw) nw.textContent = kdNow(d);
      state.copied = '';
      var msg = overlay.querySelector('[data-kd-msg]');
      if (msg) msg.textContent = '';
    }

    // Редактор KPI — над списком: после открытия показываем его, а не оставляем внизу экрана.
    function scrollKd() {
      var ed = overlay.querySelector('[data-kd-ed]');
      if (ed && ed.scrollIntoView) { try { ed.scrollIntoView({ block: 'nearest' }); } catch (er) { ed.scrollIntoView(false); } }
    }
    // Выбор в выпадающем списке (hSel): что меняет каждый список.
    function selPick(sel, v) {
      if (sel === 'tfm') { state.tfMetric = v; render(); return; }
      if (sel === 'tfa') {
        state.tfAxis = v;
        state.trPick = '';
        // Ось уже в ответе (разрез или атрибуты небольшой ветки) — без запроса.
        if (axisReady(v)) { render(); return; }
        var n = reqNow();
        n.axis = v;
        emit(n);
        return;
      }
      if (sel === 'kdm' && state.kd) { state.kd.metric = v; render(); return; }
      if (sel && sel.indexOf('kdc:') === 0 && state.kd) { state.kd.cuts[sel.slice(4)] = v; render(); return; }
      render();
    }
    // Карточка открытого списка — под кнопкой (или над ней, если снизу в видимой части мало места), не уже кнопки.
    function placeDsel() {
      var P = CFG.ns, pop = state.dsel ? overlay.querySelector('.' + P + '-dsp') : null;
      if (!pop) return;
      var btn = pop.parentNode.querySelector('.' + P + '-ddb'), br = btn.getBoundingClientRect(), v = visV();
      var below = v.b - br.bottom - 8, above = br.top - v.t - 8, up = below < 220 && above > below;
      pop.style.left = Math.round(br.left) + 'px';
      pop.style.minWidth = Math.round(br.width) + 'px';
      pop.style.maxHeight = Math.round(Math.max(140, Math.min(340, up ? above : below))) + 'px';
      pop.style.top = up ? '' : Math.round(br.bottom + 4) + 'px';
      pop.style.bottom = up ? Math.round(window.innerHeight - br.top + 4) + 'px' : '';
      var q = pop.querySelector('[data-dsq]');
      focusQuiet(q || pop.querySelector('.' + P + '-on') || btn);
    }
    function closeDsel() {
      var k = state.dsel;
      if (!k) return;
      state.dsel = '';
      render();
      var b = overlay.querySelector('[data-action="dsel"][data-key="' + cssq(k) + '"]');
      if (b) focusQuiet(b);
    }
    function onClick(e) {
      // «Открыть форму» KPI: обычный клик не уводит отчёт на форму (см. kdEditorHTML).
      if (trigger(e.target, 'data-kd-link')) { e.preventDefault(); kdLinkHint(); return; }
      // Открытый выпадающий список закрывает клик мимо него (действие под курсором выполняется как обычно).
      if (state.dsel && !trigger(e.target, 'data-dsel')) {
        state.dsel = '';
        render();
        if (!trigger(e.target, 'data-action') && !trigger(e.target, 'data-view')) return;
      }
      // Тур «Как работать»: кнопка в шапке.
      var ta = trigger(e.target, 'data-tact');
      if (ta) { tourAct(ta.getAttribute('data-tact')); return; }
      // Разделы окна фильтров в потоке (HRBP, разрез в узком окне) сворачивает только их заголовок (клик по
      // пустому месту окна ничего не закрывает); выпадающий список разреза — ещё и клик мимо него. Окно
      // закрывают ×, Esc, подложка, «Отменить» и «Применить».
      if (cutPopOpen() && !inScope(e.target, state.open)) {
        state.open = '';
        if (!trigger(e.target, 'data-action')) { setTimeout(function () { if (!state.open) render(); }, 0); return; }
      }
      // Переключалка вкладок: кнопка помечена data-view и role=tab.
      var tab = trigger(e.target, 'data-view');
      if (tab) {
        state.view = tab.getAttribute('data-view');
        state.tip = null;
        render();
        ensureAxis();
        return;
      }
      var a = trigger(e.target, 'data-action');
      if (!a) return;
      var act = a.getAttribute('data-action'), key = a.getAttribute('data-key') || '', id = a.getAttribute('data-id');
      if (act === 'drawer') {
        if (state.drawer) { closeDrawer(); return; }
        state.drawer = true;
        state.open = '';
        state.qk = {};
        state.tip = null;
        hideTip();
        render();
        focusPop('unit');
        return;
      }
      if (act === 'dclose') { closeDrawer(); return; }
      // «Что видно в данных»: раскрыть / свернуть список; команда из факта — строка в «Командах»
      // (выбрана, предки раскрыты, группа метрики), без запроса.
      if (act === 'obs') { state.obsOpen = !state.obsOpen; render(); return; }
      if (act === 'goteam') { showTeamRow(key, id || ''); return; }
      if (act === 'copy') {
        var td0 = key === 'tr' ? trTSV() : teamsTSV(), okc = td0.n > 0 && copyText(td0.text);
        copyNote(a, okc ? 'Скопировано: ' + td0.n + ' ' + plural(td0.n, 'строка', 'строки', 'строк') : 'Не удалось: браузер закрыл буфер обмена');
        return;
      }
      // Чип применённого: × снимает фильтр сразу (вместе с набранным в окне, если оно есть).
      if (act === 'chipx') {
        if (key === 'metrics') { state.metricOff = {}; state.stageV = null; render(); return; }
        if (key === 'focus') { state.focusOnly = false; state.stageV = null; render(); return; }
        stageEdit(function (st) {
          var h = st.hz ? MODEL.hBy[st.hz] : null;
          if (key === 'hz') {
            if (h && (!st.unit.length || sameSet(st.unit, h.roots))) st.unit = [];
            st.hz = '';
          } else if (key === 'unit') {
            st.unit = h && !sameSet(h.roots, MODEL.roots) ? h.roots.slice() : [];
          } else if (key.indexOf('cut:') === 0) st.cuts[key.slice(4)] = [];
        });
        applyStaged();
        return;
      }
      if (act === 'open') {
        var pop = a.getAttribute('data-pop') || '';
        if (state.open === pop) { state.open = ''; render(); return; }
        state.open = pop;
        state.qk[pop] = '';
        state.tip = null;
        hideTip();
        render();
        focusPop(pop);
        return;
      }
      if (act === 'tree') { state.treeOpen[id] = !treeOpen(id, MODEL.roots.indexOf(id) > -1 ? 0 : 1); render(); return; }
      if (act === 'unit') { goUnit(id ? [id] : MODEL.roots); return; }
      if (act === 'crumb') {
        var hzc = hzNow() ? MODEL.hBy[hzNow()] : null;
        if (key === 'hz' && hzc) goUnit(hzc.roots);
        else if (key === 'zone' || !id) goUnit(MODEL.roots);
        else goUnit([id]);
        return;
      }
      if (act === 'back') {
        if (!state.unitBack || !state.unitBack.length) return;
        var pb = state.unitBack.pop();
        emit(withUnit(pb.length ? pb : MODEL.roots));
        return;
      }
      // Сортировка таблицы «Команд»: метрика — сначала по убыванию, имя — по алфавиту;
      // третий клик — как было (по численности).
      if (act === 'tsort') {
        var ts0 = state.tsort || {}, first = key === 'name' ? 'asc' : 'desc';
        if (ts0.key !== key) state.tsort = { key: key, dir: first };
        else if (ts0.dir === first) state.tsort = { key: key, dir: first === 'asc' ? 'desc' : 'asc' };
        else state.tsort = { key: '', dir: '' };
        render();
        return;
      }
      // Окно фильтров копит выбор: юнит, зона HRBP, разрезы — до «Применить».
      if (act === 'pick' || act === 'hpick') {
        stageEdit(function (st) {
          var h = st.hz ? MODEL.hBy[st.hz] : null;
          if (act === 'pick') {
            // «Вся зона HRBP» — корни выбранного HRBP; юнит — внутри его зоны, HRBP остаётся.
            st.unit = id ? [id] : (h && !sameSet(h.roots, MODEL.roots) ? h.roots.slice() : []);
            if (id && h && !inHzZone(id, h)) st.hz = '';
            return;
          }
          var nh = id ? MODEL.hBy[id] : null;
          if (nh) { st.hz = nh.login; st.unit = sameSet(nh.roots, MODEL.roots) ? [] : nh.roots.slice(); return; }
          // «Все HRBP»: зона снятого HRBP становится всей зоной; выбранный внутри неё юнит остаётся.
          if (h && (!st.unit.length || sameSet(st.unit, h.roots))) st.unit = [];
          st.hz = '';
        });
        // HRBP выбран — раздел сворачивается, дерево юнитов ниже — его зона, свёрнутая на корнях
        // (раскрытое руками сбрасывается); юнит выбран из поиска — находки остаются, выбранный подсвечен.
        if (act === 'hpick') { state.unitAll = false; state.open = ''; state.qk.hrbp = ''; state.qk.unit = ''; state.treeOpen = {}; }
        render();
        return;
      }
      if (act === 'unitall') { state.unitAll = !state.unitAll; state.qk.unit = ''; render(); focusPop('unit'); return; }
      if (act === 'utree') { state.open = ''; render(); focusPop('unit'); return; }
      if (act === 'htree') { state.hOpen[id] = !hrbpOpen(id, MODEL.hTop.indexOf(id) > -1 ? 0 : 1); render(); return; }
      if (act === 'clearcut' || act === 'cutnone') {
        stageEdit(function (st) { st.cuts[key] = []; });
        render();
        return;
      }
      // Флажок-чип значения короткого разреза: отметить / снять (можно несколько).
      if (act === 'cutv') {
        var cvv = a.getAttribute('data-val');
        stageEdit(function (st) {
          var list = (st.cuts[key] || []).slice(), at = list.indexOf(cvv);
          if (at > -1) list.splice(at, 1); else list.push(cvv);
          st.cuts[key] = list;
        });
        render();
        return;
      }
      if (act === 'apply') {
        if (!pendingN() || state.pend) return;
        applyStaged();
        return;
      }
      // «Отменить»: набранное (фильтры и показ) — как было; окно закрывается.
      if (act === 'unstage') {
        var wasOpen = !!state.drawer;
        state.stage = null; state.stageV = null; state.drawer = false; state.open = ''; state.qk = {};
        render();
        if (wasOpen) focusOpener();
        return;
      }
      // Показ в окне копится до «Применить», как и фильтры.
      if (act === 'mall' || act === 'mnone') {
        viewEdit(function (sv) { for (var mi = 0; mi < CFG.metrics.length; mi++) sv.off[CFG.metrics[mi].key] = act === 'mnone'; });
        render();
        return;
      }
      if (act === 'focus') { viewEdit(function (sv) { sv.focus = !sv.focus; }); render(); return; }
      if (act === 'reset') {
        state.drawer = false;
        state.open = '';
        state.qk = {};
        state.stageV = null;
        state.metricOff = {};
        state.focusOnly = false;
        state.openM = {};
        state.selTeam = '';
        state.openRows = {};
        state.stage = null;
        state.hz = '';
        emit({ unit: [], cuts: {}, axis: MODEL.axis || '', depth: '3' });
        return;
      }
      // Строки «Сводки» раскрываются независимо: можно смотреть несколько динамик сразу.
      // Свёрнутая строка при следующем раскрытии снова рисуется с анимацией.
      if (act === 'openm') {
        if (state.openM[key]) { delete state.openM[key]; forgetDrawn('op:' + key + ':'); } else state.openM[key] = true;
        render();
        return;
      }
      if (act === 'openall') {
        var bm = selMetrics(key), allOn = true;
        for (var bo = 0; bo < bm.length; bo++) if (!state.openM[bm[bo].key]) allOn = false;
        for (var bo2 = 0; bo2 < bm.length; bo2++) {
          if (allOn) { delete state.openM[bm[bo2].key]; forgetDrawn('op:' + bm[bo2].key + ':'); } else state.openM[bm[bo2].key] = true;
        }
        render();
        return;
      }
      if (act === 'pophint') {
        if (!key) { state.popOff = sigOf(reqNow()); render(); return; }
        var np = reqNow();
        np.cuts[key] = [a.getAttribute('data-val') || ''];
        emit(np);
        return;
      }
      if (act === 'hqact') {
        var nq = reqNow();
        nq.cuts.hct = [CFG.hq.hct];
        nq.cuts.paint = [CFG.hq.paint];
        emit(nq);
        return;
      }
      if (act === 'cmp') {
        state.cmp = key === 'ref' ? 'ref' : 'prev';
        state.drawn = {};
        render();
        var again = overlay.querySelector('[data-action="cmp"][data-key="' + key + '"]');
        if (again && again.focus) again.focus();
        return;
      }
      if (act === 'split') { state.splitMode = key === 'table' || key === 'charts' ? key : 'both'; state.tip = null; render(); return; }
      if (act === 'block') { state.block = key; render(); return; }
      if (act === 'team') { state.selTeam = key; render(); return; }
      // Раскрытие — только вид: все уровни глубины уже в ответе.
      if (act === 'exp') { state.openRows[key] = !state.openRows[key]; render(); return; }
      if (act === 'expall') {
        state.openRows = {};
        if (key === '1') {
          var all = teamRows(true);
          for (var ai = 0; ai < all.length; ai++) if (rowCanExp(all[ai])) state.openRows[all[ai].pfx] = true;
        }
        render();
        return;
      }
      if (act === 'axis') { var nx = reqNow(); nx.axis = key || wantAxis(); emit(nx); return; }
      if (act === 'trpick') {
        var tl = trSorted(wantAxis()), ti = +key, tv = ti >= 0 && tl[ti] ? tl[ti].v : '';
        state.trPick = tv === state.trPick ? '' : tv;
        render();
        return;
      }
      if (act === 'trpie') { state.trPie = key; render(); return; }
      if (act === 'tfp') {
        var pr = CFG.trPresets[+key];
        if (!pr) return;
        if (pr.a !== state.tfAxis) state.trPick = '';
        state.tfMetric = pr.m; state.tfAxis = pr.a;
        if (axisReady(pr.a)) { render(); return; }
        var np = reqNow(); np.axis = pr.a; emit(np); return;
      }
      if (act === 'gorule') {
        for (var r = 0; r < MODEL.rules.length; r++) {
          var rl = MODEL.rules[r];
          if (rl.id !== key) continue;
          pushBack();
          var ng = withUnit([rl.unit]);
          for (var gc = 0; gc < CFG.cuts.length; gc++) {
            var fv = rl.f[CFG.cuts[gc].key];
            ng.cuts[CFG.cuts[gc].key] = fv && fv !== 'all' ? [fv] : [];
          }
          state.view = 'onepager';
          emit(ng);
          return;
        }
        return;
      }
      if (act === 'kadd') { state.kd = kdNew(); state.kdOpen = true; state.copied = ''; render(); scrollKd(); return; }
      if (act === 'kedit' || act === 'kdel') {
        for (var kr = 0; kr < MODEL.rules.length; kr++) {
          if (MODEL.rules[kr].id !== key) continue;
          state.kd = kdFromRule(MODEL.rules[kr], act === 'kedit' ? 'update' : 'del');
          state.kdOpen = true; state.copied = ''; render(); scrollKd();
          return;
        }
        return;
      }
      if (act === 'kclose') { state.kdOpen = false; state.kd = null; state.copied = ''; render(); return; }
      if (act === 'kcopy') { copyLine(); return; }
      if (act === 'dsel') { state.dsel = state.dsel === key ? '' : key; render(); return; }
      if (act === 'dselv') {
        state.dsel = '';
        selPick(key, a.getAttribute('data-id'));
        var db = overlay.querySelector('[data-action="dsel"][data-key="' + cssq(key) + '"]');
        if (db) focusQuiet(db);
        return;
      }
    }

    // Чекбоксы и выпадашки: change, не click (label/input дают оба события).
    function onChange(e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var cv = t.getAttribute('data-cutval'), ck = t.getAttribute('data-cutkey');
      if (cv !== null && ck) {
        stageEdit(function (st) {
          var list = (st.cuts[ck] || []).slice(), at = list.indexOf(cv);
          if (t.checked && at < 0) list.push(cv);
          if (!t.checked && at > -1) list.splice(at, 1);
          st.cuts[ck] = list;
        });
        render();
        return;
      }
      var mk = t.getAttribute('data-metric');
      if (mk !== null && mk !== '') { viewEdit(function (sv) { sv.off[mk] = !t.checked; }); render(); return; }
      var mg = t.getAttribute('data-mgroup');
      if (mg !== null && mg !== '') {
        viewEdit(function (sv) { for (var i = 0; i < CFG.metrics.length; i++) if (CFG.metrics[i].block === mg) sv.off[CFG.metrics[i].key] = !t.checked; });
        render();
        return;
      }
    }

    // Поиск в окне фильтров: у каждого списка свой (state.qk), пересобираем ТОЛЬКО этот список —
    // поле ввода не трогаем, фокус и каретка остаются на месте (E23b). Поля новой цели — так же.
    function onInput(e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var ps = t.getAttribute('data-psearch');
      if (ps !== null) {
        state.qk[ps] = t.value;
        refreshList(ps);
        return;
      }
      if (t.getAttribute('data-tsearch') !== null) { state.tq = t.value; refreshTeams(); return; }
      if (t.getAttribute('data-dsq') !== null) {
        var q = t.value.replace(/^\s+|\s+$/g, '').toLowerCase(), os = t.parentNode.querySelectorAll('[data-action="dselv"]');
        for (var oi = 0; oi < os.length; oi++) os[oi].style.display = !q || os[oi].textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
        return;
      }
      var kd = t.getAttribute('data-kd');
      if (kd && state.kd) { state.kd[kd] = t.value; updateKd(); }
    }
    function refreshTeams() {
      var box = overlay.querySelector('[data-tbox]');
      if (box) box.innerHTML = teamsTableHTML(teamsCtx());
      measureNames();
      tourPos();
    }

    // Tab в окне фильтров ходит по кругу внутри окна (aria-modal): отчёт под подложкой недоступен.
    function trapTab(e) {
      var box = overlay.querySelector('.' + CFG.ns + '-mdl');
      if (!box) return;
      var all = box.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]'), f = [];
      for (var i = 0; i < all.length; i++) if (all[i].offsetWidth || all[i].offsetHeight) f.push(all[i]);
      if (!f.length) return;
      var cur = document.activeElement, at = -1;
      for (var j = 0; j < f.length; j++) if (f[j] === cur) at = j;
      var to = null;
      if (at < 0) to = e.shiftKey ? f[f.length - 1] : f[0];
      else if (e.shiftKey && at === 0) to = f[f.length - 1];
      else if (!e.shiftKey && at === f.length - 1) to = f[0];
      if (to) { e.preventDefault(); focusQuiet(to); }
    }
    // Escape закрывает окно фильтров (smoke E24); Enter в поиске окна ничего не отправляет:
    // поиск идёт по справочнику всей зоны прямо при наборе.
    function onKeydown(e) {
      var k = e.keyCode || e.which;
      if ((k === 37 || k === 39) && e.target && e.target.getAttribute && e.target.getAttribute('data-split')) {
        e.preventDefault();
        var bx = e.target.parentNode;
        setSplit(bx, (state.split || splitAuto(+bx.getAttribute('data-mets') || 0)) + (k === 39 ? 0.05 : -0.05));
        relayout();
        return;
      }
      if (k === 13 && e.target && e.target.getAttribute && e.target.getAttribute('data-psearch') !== null) {
        e.preventDefault();
        return;
      }
      if (k === 9 && state.drawer) { trapTab(e); return; }
      if (k === 27 && e.target && e.target.getAttribute && e.target.getAttribute('data-tsearch') !== null && state.tq) {
        e.target.value = '';
        state.tq = '';
        refreshTeams();
        return;
      }
      if (k === 27 && state.dsel) { closeDsel(); return; }
      if (k === 27 && cutPopOpen()) {
        var ck = state.open, cb;
        state.open = '';
        render();
        cb = overlay.querySelector('[data-pop="' + cssq(ck) + '"]');
        if (cb) focusQuiet(cb);
        return;
      }
      if (k === 27 && state.drawer) { closeDrawer(); return; }
      // Не-кнопки с data-action (строки дерева и «Команд», сортировка, «×» у разреза): Enter/пробел = клик.
      var tg = e.target, tn = tg && tg.tagName;
      if ((k === 13 || k === 32) && tg && tg.getAttribute && tg.getAttribute('data-action') && !/^(BUTTON|INPUT|SELECT|TEXTAREA|LABEL|A)$/.test(tn)) {
        e.preventDefault();
        onClick({ target: e.target });
      }
    }

    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseleave', onLeave);
    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('dblclick', onDbl);
    overlay.addEventListener('click', onClick);
    overlay.addEventListener('change', onChange);
    overlay.addEventListener('input', onInput);
    overlay.addEventListener('keydown', onKeydown);
    overlay.addEventListener('focusin', onFocusIn);
    overlay.addEventListener('focusout', onFocusOut);
    // Прокрутка отчёта во время тура — подсветка едет за целью.
    overlay.addEventListener('scroll', function () {
      if (state.tour) tourPos();
      if (state.dsel) closeDsel();
      var stk = overlay.querySelector('.' + CFG.ns + '-stick');
      if (stk) stk.classList.toggle(CFG.ns + '-shd', overlay.scrollTop > 2);
    });

    // Глобальные слушатели переживают перезапуск скрипта и накапливаются.
    // Старый снимаем ЯВНО, ссылку держим в state. Escape вешай здесь же,
    // тем же способом, и никогда не внутри render().
    if (state.onWinResize) window.removeEventListener('resize', state.onWinResize);
    state.onWinResize = function () {
      // Окно iframe поменяло высоту — линейка видимости заново (state.vis придёт колбэком).
      if (Math.abs((window.innerHeight || 0) - visH) > 1) { state.vpH = 0; visBuild(); }
      if (state.tip) renderTip(); if (state.tour) tourPos(); if (state.drawer) placeDrawer();
    };
    window.addEventListener('resize', state.onWinResize);
    // Прокрутка страницы борда (любого контейнера — поэтому capture) при открытом окне фильтров:
    // ячейка уезжает, окно — за ней. Прокрутка внутри отчёта и самого окна его не двигает.
    if (state.onAnyScroll) document.removeEventListener('scroll', state.onAnyScroll, true);
    state.onAnyScroll = function (ev) {
      if (state.drawer && !(ev && ev.target && ev.target.nodeType === 1 && overlay.contains(ev.target))) placeDrawer();
      if (state.tour) tourPos();
    };
    document.addEventListener('scroll', state.onAnyScroll, true);
    if (state.onDocDown) { document.removeEventListener('mousedown', state.onDocDown, true); state.onDocDown = null; }
    // Клавиши тура — на документе (фокус в карточке тура, она вне overlay): Esc закрывает,
    // стрелки листают. Старый слушатель снимаем — он держит прошлый запуск скрипта.
    if (state.onTourKey) document.removeEventListener('keydown', state.onTourKey, true);
    state.onTourKey = function (ev) {
      if (!state.tour) return;
      var k = ev.keyCode || ev.which, tag = ev.target && ev.target.tagName;
      if (k === 27) { ev.preventDefault(); ev.stopPropagation(); tourEnd(); return; }
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (k === 39) { ev.preventDefault(); tourAct('next'); }
      else if (k === 37) { ev.preventDefault(); tourAct('back'); }
    };
    document.addEventListener('keydown', state.onTourKey, true);

    // Ответ пришёл: эхо совпало с ожиданием — снимаем его; предупреждение
    // «самовлияние не настроено» гасит первый же ответ с тем же эхом.
    var echo = sigOf(reqEcho());
    if (state.pend && state.pend.sig === echo) state.pend = null;
    if (state.pend && Date.now() - state.pend.at > CFG.pendingWarnMs) { state.pend = null; state.warn = CFG.text.notApplied; }
    if (state.lastSig && state.lastSig === echo && state.warn === CFG.text.notApplied) state.warn = '';
    armPend();
    // Секундомер строки загрузки: правит только текст [data-pendt], без render().
    if (state.pendTick) clearInterval(state.pendTick);
    state.pendTick = setInterval(function () {
      if (!state.pend || !overlay.parentNode) return;
      var pt = overlay.querySelector('[data-pendt]');
      if (pt) pt.textContent = pendText();
    }, 1000);
    // HRBP держится, пока область внутри его зоны (переход в чужую зону его снимает).
    state.hz = hzNow();
    // Набранное применилось (ответ совпал с набором) — строка фильтров снова «чистая».
    if (state.stage && !stageDiff()) state.stage = null;

    render();
    // Перезапуск скрипта с открытым окном фильтров — курсор в поле поиска юнита.
    if (state.drawer) focusPop('unit');
    ensureAxis();

    // ResizeObserver только правит габариты. НЕ вызывать render() — зациклит.
    // Старый observer отключаем: иначе он держит удалённый overlay.
    // Ячейку растянули/сжали — relayout() с задержкой: класс узкой ячейки
    // и SVG графиков по месту; разметка, поповер и прокрутка не трогаются.
    if (typeof ResizeObserver !== 'undefined') {
      if (state.ro && state.ro.disconnect) state.ro.disconnect();
      var ro = new ResizeObserver(function() {
        overlay.style.width = '100%'; overlay.style.height = '100%';
        if (state.roT) clearTimeout(state.roT);
        state.roT = setTimeout(relayout, 150);
      });
      ro.observe(host);
      state.ro = ro;
    }
  } catch (e) {
    // option присваивается позже, в БЛОКЕ 7: из catch к нему не обращаться.
    // Ищем overlay внутри СВОЕГО хоста: на дашборде может быть второй виджет
    // с тем же ns, и сообщение об ошибке уедет не туда.
    var box = null;
    var hs = document.querySelectorAll('[_echarts_instance_]');
    if (hs && hs.length) box = hs[hs.length - 1].querySelector('.' + CFG.ns + '-overlay');
    if (!box) box = document.querySelector('.' + CFG.ns + '-overlay');
    if (box) {
      box.innerHTML = '<div style="padding:16px;font:13px -apple-system,Arial,sans-serif;color:#b00020;">'
        + 'Ошибка графика: ' + esc((e && e.message) || e) + '</div>';
    }
  }
})();

// ---------- БЛОК 7: ПУСТОЙ OPTION ----------
// ГЛОБАЛЬНО, В САМОМ КОНЦЕ, ВНЕ функций и IIFE.
// После этого присваивания option не трогать: любая мутация вернёт eCharts
// к отрисовке своего графика поверх overlay.
option = {
  animation: false,
  xAxis: { show: false, type: 'value' },
  yAxis: { show: false, type: 'value' },
  series: [{ type: 'scatter', data: [] }]
};
