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
         r3n: 'm_r3n', r3d: 'm_r3d', r6n: 'm_r6n', r6d: 'm_r6d', hire: 'm_hire', fire: 'm_fire' },
    w: { hc: 'w_hc', jun: 'w_jun', rg: 'w_rg', nrg: 'w_nrg', hcw: 'w_hcw', nr: 'w_nr',
         r3n: 'w_r3n', r3d: 'w_r3d', r6n: 'w_r6n', r6d: 'w_r6d', hire: 'w_hire', fire: 'w_fire' }
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
    { key: 'retention', name: 'Удержание', tab: 'Удержание', hint: 'Закрепляемость новичков через 3 и 6 месяцев.' },
    { key: 'turnover', name: 'Текучесть', tab: 'Текучесть', hint: 'Нежелательные и управляемые уходы, причины увольнений.' },
    { key: 'structure', name: 'Структура команды', tab: 'Структура', hint: 'Численность и доля джунов.' }
  ],
  // num / den — компоненты куба; denDiv — знаменатель-сумма за окно → средняя.
  // better: higher | lower | flat (у flat цвета и целей нет — «больше» не значит «лучше»).
  metrics: [
    { key: 'retention_new_3', block: 'retention', name: 'Закрепляемость новичков · 3 мес', short: 'Закрепл. 3 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r3n', den: 'r3d',
      hint: 'Доля новичков, которые работают в компании через 3 месяца после найма.',
      calc: 'Когорта — новички, у кого 3 месяца от найма исполнились в окне; дожившие / когорта. Окно созревания 3 мес (13 нед). База отсчёта — company_hire_dt, при типе численности «Активная» — active_hire_dt.',
      numL: 'продолжают работать', denL: 'новичков в когорте', cnt: { of: ['новичка', 'новичков', 'новичков'] }, exL: 'новичков ушло сверх ориентира', exA: 'сверх ориентира ушли' },
    { key: 'retention_new_6', block: 'retention', name: 'Закрепляемость новичков · 6 мес', short: 'Закрепл. 6 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r6n', den: 'r6d',
      hint: 'Доля новичков, которые работают в компании через 6 месяцев после найма.',
      calc: 'Как на 3 месяцах, горизонт 6 мес (26 нед).',
      numL: 'продолжают работать', denL: 'новичков в когорте', cnt: { of: ['новичка', 'новичков', 'новичков'] }, exL: 'новичков ушло сверх ориентира', exA: 'сверх ориентира ушли' },
    { key: 'regret', block: 'turnover', name: 'Regrettable текучесть', short: 'Regret',
      fmt: 'pct', better: 'lower', num: 'rg', den: 'hcw', denDiv: { m: 12, w: 52 },
      hint: 'Годовой темп уходов ценных сотрудников (нежелательные увольнения).',
      calc: 'Regrettable-увольнения за 12 мес (52 нед) / средняя списочная численность за то же окно. Разметка — usr_cross_data.regrettable_n_non_regrettable_base.',
      numL: 'regrettable-уходов за 12 мес', denL: 'средняя численность за 12 мес', cnt: { n: ['уход', 'ухода', 'уходов'], tail: 'за год' },
      exL: 'уходов сверх ориентира', exA: 'сверх ориентира' },
    { key: 'nonregret', block: 'turnover', name: 'Non regrettable текучесть', short: 'Non-reg.',
      fmt: 'pct', better: 'flat', num: 'nrg', den: 'hcw', denDiv: { m: 12, w: 52 },
      hint: 'Текучесть без сожаления (управляемые уходы). Нейтральная: больше не значит лучше.',
      calc: 'Non-regrettable-увольнения за 12 мес (52 нед) / средняя численность за окно.',
      numL: 'non-regrettable-уходов за 12 мес', denL: 'средняя численность за 12 мес', cnt: { n: ['уход', 'ухода', 'уходов'], tail: 'за год' } },
    { key: 'exit_reasons', block: 'turnover', name: 'Незаполненные причины увольнений', short: 'Без причины',
      fmt: 'pct', better: 'lower', num: 'nr', den: 'hc',
      hint: 'Уволенные без проставленной причины (30+ дней после увольнения) от численности юнита. В бизнес-контексте — «Заполнение причин увольнений».',
      calc: 'Увольнения за 3 мес (13 нед) без причины в legal_position_dismissal_reason, с непустой датой и старше 30 дней / численность на конец периода.',
      numL: 'увольнений без причины за 3 мес', denL: 'численность на конец месяца', cnt: { n: ['увольнение', 'увольнения', 'увольнений'], tail: 'за 3 мес' },
      exL: 'увольнений без причины сверх ориентира', exA: 'сверх ориентира' },
    { key: 'headcount', block: 'structure', name: 'Численность', short: 'Числ.',
      fmt: 'int', better: 'flat', num: 'hc',
      hint: 'Списочная численность на конец периода (active_employee_flg = 1). Абсолютная величина — с базой не сравнивается.',
      calc: 'Сотрудники в списочной численности на последний день периода.' },
    { key: 'jun_team', block: 'structure', name: '% джунов в команде', short: 'Джуны',
      fmt: 'pct', better: 'higher', share: true, num: 'jun', den: 'hc',
      hint: 'Доля сотрудников с seniority intern / jun / jun+ в списочной численности.',
      calc: 'Джуны (seniority ILIKE intern% или jun%) / численность на конец периода.',
      numL: 'джунов', denL: 'численность', cnt: { of: ['чел.', 'чел.', 'чел.'] }, exL: 'джунов не хватает до ориентира', exA: 'до ориентира не хватает' }
  ],
  catalog: {
    postponed: [
      { name: 'Неотгуленные отпуска', note: 'Отложена до докрутки логики источника «Накопленные дни отпуска».' },
      { name: 'Прогульщики', note: 'Источник дополним позже (absentees).' },
      { name: '% джунов в найме', note: 'Считается по другому источнику (jun_hire).' },
      { name: '% найма в регионах', note: 'Считается по другому источнику (region_hire).' }
    ],
    dev: [
      { name: 'Эффективность работы с лоу-перформерами', note: 'Доля закрытых PIP с положительным результатом. Привязана к КП.' },
      { name: '% укомплектованности штата', note: 'Факт численности к плановой (по ресурсной структуре).' },
      { name: 'Вовлечённость', note: 'eNPS / индекс вовлечённости по опросам.' },
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
  small: { min: 30, blocks: ['retention', 'turnover'] },
  // «Что видно в данных» на «Сводке» (как Proteus Adoption, ДС §4.10) — факты по порогам, не шаблон:
  // dev — отклонение от ориентира (доля ориентира); minPeople — «сверх ориентира» у юнита в людях,
  // teamMin — у команды; conc — доля «лишних» людей в одной команде («больше половины — там»);
  // trend — месяцев ухудшения подряд; всплеск уходов — последние spikeWeeks недель против обычного
  // темпа (не меньше spikeMin человек и в spikeX раза больше); hc — изменение численности за год; max — фактов.
  obs: { dev: 0.10, minPeople: 0.5, teamMin: 1, conc: 0.5, trend: 3, spikeWeeks: 4, spikeMin: 3, spikeX: 2, hc: 0.10, max: 8 },
  // Ответ на кросс-фильтр не пришёл за столько мс — жёлтая плашка «самовлияние?». В бою ответ на всю
  // компанию идёт дольше 9 с (07.10: плашка висела ~5 с при верных JSON-метаданных) — до плашки ждём
  // 45 с, а строка загрузки считает секунды и показывает прошлое время ответа.
  pendingWarnMs: 45000,
  // Уровни — номера mapped-структуры, как в ультраширокой: 1 — компания, дальше 3…12
  // (lvl2 отчёт пропускает). Подпись — по номеру, у юнитов одного уровня разные слова
  // в названиях («Департамент …», «Отдел …»), поэтому слово не выдумываем.
  levels: { 1: 'Компания' },
  tabs: [
    { key: 'onepager', label: 'Сводка' }, { key: 'teams', label: 'Команды' },
    { key: 'transform', label: 'Трансформеры' }, { key: 'goals', label: 'Цели' },
    { key: 'catalog', label: 'Каталог метрик' }
  ],
  text: {
    noData: 'Нет данных',
    title: 'HRBP HUB',
    loading: 'Обновляю данные…',
    notApplied: 'Ответа на фильтр нет уже {s} с. Если так при каждом «Применить» — чарт не фильтрует сам себя: в JSON-метаданных дашборда нужны cross_filters_enabled: true и у этого чарта crossFilters.scope.excluded: [] (инструкция поставки, п. 4.5). Если отчёт просто долго считает — ответ ещё придёт, плашка уйдёт сама.',
    noAccess: 'Для вашего логина нет зоны HRBP в отчёте.',
    outOfZone: 'Запрошенный юнит вне вашей зоны — показана ваша зона.',
    // Датасет кладёт последней строку end; её нет — Proteus обрезал ответ лимитом строк чарта.
    truncated: 'Ответ датасета обрезан лимитом строк чарта: пришло {n} строк, часть «Команд» и «Трансформеров» не видна. В настройках чарта поставьте «Лимит строк» 50 000 — инструкция поставки, п. 4.2.'
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
    ink: '#23272e', ink2: '#454b55', muted: '#8a909c', muted2: '#aab0bb',
    green: '#7fd2a5', greenBg: '#dbf5e6', greenTx: '#11804a',
    red: '#f59e9e', redBg: '#fde2e2', redTx: '#cb2e2e',
    neutral: '#d8dde4', neutralBg: '#eff1f5', neutralTx: '#5d6574',
    warn: '#f59300', warnBg: '#ffe6a0', warnTx: '#9a6500',
    blue: '#3b6fe0', blueBg: '#eef3fe', act: '#2b6cff', actInk: '#1f55d6',
    surface2: '#f3f4f6', hover: '#fafbfc',
    // Линии «период к периоду»: текущий — акцент, прошлый — светлый сине-серый,
    // база — серый пунктир, цель — тёмный пунктир; заливка под текущим — 8 % акцента.
    cur: '#2b6cff', curArea: 'rgba(43,108,255,.08)', prev: '#b4bdcc', bench: '#98a1b1', kpi: '#4b5262',
    label: '#2f3440', axis: '#8a909c', axisLine: '#9ba4b5', axisStrong: '#3a3f4a', grid: '#e9ecf1', xh: '#b9c6de',
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
  chart: { h: 236, hSmall: 212, bars: 300, top: 26, axis: 30, drawMs: 760 },
  // «Команды»: доля таблицы в раскладке «таблица | динамика» (перетаскивается разделителем).
  // minH — нижний предел высоты двух колонок (таблица и «Динамика» прокручиваются внутри).
  split: { def: 0.6, min: 0.3, max: 0.8, minH: 420 },
  // Окно «Фильтры и настройки»: ширина и высота не больше w × h (меньше — по видимой части экрана);
  // от three — три колонки во всю высоту окна без прокрутки (владелец 07.10: «настройки должны
  // вмещаться в экран по высоте»), от two — две, уже — одна; разрез до inline значений — флажки
  // в строку; поиск метрик — от msearch.
  modal: { w: 1100, h: 820, two: 720, three: 900, inline: 3, msearch: 8 },
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
  split: 0,              // доля таблицы «Команд» (0 — по умолчанию CFG.split.def)
  splitMode: 'both',     // 'both' | 'table' (таблица во всю ширину) | 'charts' (динамика во всю ширину)
  lineOff: {},           // серии линий, выключенные в легенде: cur | prev | ref
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
  dyn: 'yoy',            // «Год» | «12 недель» в «Командах»
  tfMetric: 'regret', tfAxis: '',
  axisTried: {},         // оси трансформеров, которые уже запрашивались
  kd: {},                // черновик новой цели (вкладка «Цели»)
  copied: '',
  cw: {},                // измеренные ширины графиков по видам: half | side | wide
  narrow: false,         // ячейка уже 1100 px
  pend: null,            // {sig, at} — эмит ушёл, ждём ответ с тем же эхом
  pendT: null, lastSig: '',
  lastResp: 0,           // сколько мс шёл последний ответ на кросс-фильтр (строка загрузки)
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
function parseArr(s) {
  if (s === null || s === undefined || s === '') return null;
  if (Object.prototype.toString.call(s) === '[object Array]') return s;
  var parts = String(s).split(','), out = [];
  for (var i = 0; i < parts.length; i++) { var v = num(parts[i]); out.push(v === null ? 0 : v); }
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
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoOf(p) { return p ? p.y + '-' + pad2(p.m + 1) + '-' + pad2(p.d) : ''; }

// ---------- БЛОК 3: ТРАНСФОРМАЦИЯ ДАННЫХ ----------
// rawData → MODEL. SQL отдаёт числители и знаменатели по слотам; проценты, окна
// в знаменателе, дельты, наследование целей и светофор считаются здесь.
var COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire'];
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
  for (var ci = 0; ci < COMP.length; ci++) { need.push(F.m[COMP[ci]]); need.push(F.w[COMP[ci]]); }
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
        var u = { id: f[0], pid: f[1] || '', lvl: num(f[2]) || 0, hc: num(f[3]) || 0, cur: f[4] === '1', rk: f[5] || '', nm: f[6] || '—',
                  nk: f.length > 7 ? (num(f[7]) || 0) : -1 };
        u.lc = u.nm.toLowerCase();
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
      M.rules.push({ id: id, unit: pid, metric: kf[0], target: num(kf[1]),
        f: { paint: kf[2] || 'all', it: kf[3] || 'all', stream: kf[4] || 'all', spec: kf[5] || 'all', staff: kf[6] || 'all', hct: kf[7] || 'all' },
        from: kf[8] || '2000-01-01', to: kf[9] || '2099-12-31', author: kf[10] || '', note: kf[11] || '', rk: kf[12] || '' });
    }
  }
  if (!M.meta) return M;
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
  // Датасет шлёт строку end последней (meta.end = 1): её нет — хвост ответа отрезал лимит строк.
  M.cut = num(meta.end) === 1 && !M.complete;
  for (var cc = 0; cc < CFG.cuts.length; cc++) M.sel[CFG.cuts[cc].key] = (meta['f_' + CFG.cuts[cc].key] || []).slice();
  var cal = meta.cal || [];
  for (var q = 0; q < cal.length; q++) {
    var p = String(cal[q]).split('|');
    var slot = { s: p[2], e: p[3], closed: p[4] === '1' };
    M.cal[p[0]][+p[1]] = slot;
    M.dataDt = p[5] || M.dataDt;
  }
  M.L = typeof meta.last_m === 'number' ? meta.last_m : -1;
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
function lastIdx(g) {
  if (g === 'm') return MODEL.L;
  var L = -1;
  for (var i = 0; i < 24; i++) if (slotClosed('w', i)) L = i;
  return L;
}

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
  var p = parts(ser, g, m, i);
  if (!p) return null;
  if (m.fmt === 'int') return p.num;
  if (!p.den) return null;
  var den = m.denDiv ? p.den / m.denDiv[g] : p.den;
  return 100 * p.num / den;
}
function mseries(ser, g, m) {
  var out = [];
  for (var i = 0; i < 24; i++) out.push(mval(ser, g, m, i));
  return out;
}
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
function stateForKpi(m, v, t) {
  if (v === null || t === null || m.better === 'flat') return 'neutral';
  if (m.better === 'higher') return v >= t ? 'good' : (v >= t * (1 - CFG.deadZone) ? 'warn' : 'bad');
  return v <= t ? 'good' : (v <= t * (1 + CFG.deadZone) ? 'warn' : 'bad');
}
function compareState(m, v, b) {
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
  if (k) return { kind: 'kpi', ref: k.rule.target, rule: k.rule, owner: k.owner, inherited: k.inherited, state: stateForKpi(m, v, k.rule.target) };
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
function smallHide(ser, m) { return smallGate(m) && isSmall(ser); }
// Числитель и знаменатель метрики в людях (знаменатель-окно → средняя численность).
function absParts(m, ser, i) {
  if (m.fmt === 'int') return null;
  var p = parts(ser, 'm', m, i);
  if (!p || p.den === null || p.den === undefined) return null;
  return { num: p.num, den: m.denDiv ? p.den / m.denDiv.m : p.den };
}
function absRows(m, ser, i) {
  var a = absParts(m, ser, i);
  if (!a || !m.numL) return [];
  return [{ label: m.numL, value: fmtInt(a.num) }, { label: m.denL, value: fmtInt(a.den) }];
}
// Коротко под значением: «16 из 17 новичков», «9 уходов за год».
function absText(m, ser, i) {
  var a = absParts(m, ser, i), c = m.cnt;
  if (!a || !c) return '';
  if (c.of) { var d = Math.round(a.den); return fmtInt(a.num) + ' из ' + fmtInt(d) + ' ' + plural(d, c.of[0], c.of[1], c.of[2]); }
  return fmtInt(a.num) + ' ' + plural(a.num, c.n[0], c.n[1], c.n[2]) + (c.tail ? ' ' + c.tail : '');
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
function fmtPeople(x) { return '≈' + NBSP + (Math.abs(x) < 10 ? fmtNum1(x) : fmtInt(x)); }
function benchLabel() {
  var parts0 = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var s = MODEL.sel[CFG.cuts[i].key] || [];
    if (s.length) parts0.push(s.length > 2 ? CFG.cuts[i].label.toLowerCase() + ': ' + s.length : s.join(', '));
  }
  return parts0.length ? 'вся компания · ' + parts0.join(' + ') : 'вся компания';
}
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
  if (d === null || d === 0) return 'flat';
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
function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function dparts(iso) { var p = toDate(iso); return p || { y: 0, m: 0, d: 1 }; }
function fmtDay(iso) { var p = dparts(iso); return p.d + NBSP + MONTH_GEN[p.m] + ' ' + p.y; }
function monthLabel(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_ABBR[p.m] + ' ' + p.y; }
function monthFull(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return capFirst(MONTH_FULL[p.m]) + ' ' + p.y; }
function monthLow(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_FULL[p.m] + ' ' + p.y; }
function monthDat(i) { var s = MODEL.cal.m[i]; if (!s) return ''; var p = dparts(s.s); return MONTH_DAT[p.m] + ' ' + p.y; }
function weekRange(i) {
  var s = MODEL.cal.w[i];
  if (!s) return '';
  var a = dparts(s.s), b = dparts(s.e);
  return a.m === b.m ? a.d + '–' + b.d + NBSP + MONTH_GEN[b.m] : a.d + NBSP + MONTH_GEN[a.m] + ' – ' + b.d + NBSP + MONTH_GEN[b.m];
}
function weekTick(i) { var s = MODEL.cal.w[i]; if (!s) return ''; var b = dparts(s.e); return String(b.d) + (b.d <= 7 ? NBSP + MONTH_ABBR[b.m] : ''); }

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
function cssColor(c) {
  if (!c) return '#000';
  if (typeof c === 'string') return c;
  var a = (c.length >= 4) ? c[3] : 1;
  return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
}
var STATE_TXT = { good: 'лучше ориентира', bad: 'хуже ориентира', warn: 'в пределах ±5% от цели', neutral: 'в пределах ±5% или без оценки' };

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
function lineOn(k) { return !state.lineOff[k]; }
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
  var P = CFG.ns, C = CFG.colors, G = CFG.chart, F = CFG.fonts, m = spec.m, n = spec.labels.length;
  var anim = !!(ctx && ctx.anim);
  var on = { cur: lineOn('cur'), prev: lineOn('prev'), ref: !!spec.ref && lineOn('ref') };
  if (!on.cur && !on.prev && !on.ref) on.cur = true;
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
      var bx0 = Math.min(Math.max(cx - lw / 2, gl - 6), gl + pw + gr - lw - 1);
      var tries = [up, !up], box = null;
      for (var tr = 0; tr < 2 && !box; tr++) {
        var yb = tries[tr] ? cy - 9 : cy + 17;
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
    tips.push(tipHtml({ title: spec.heads[hi], rows: rows, note: st && on.cur && on.ref ? STATE_TXT[st] : null }));
  }
  if (ctx && CHARTS[ctx.ci]) CHARTS[ctx.ci].hz = { xs: xs, ys: ys, tips: tips };
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
    P + '-root{width:100%;height:100%;box-sizing:border-box;'
            + 'font-family:' + CFG.fonts.family + ';'
            + 'font-size:' + F.body + 'px;color:' + C.ink + ';background:' + C.bg + ';}',
    P + '-root *{box-sizing:border-box;font-family:inherit;}',
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
    P + '-tip ' + P + '-t-h{display:block;font-size:10px;font-weight:500;letter-spacing:.3px;text-transform:uppercase;color:' + C.muted + ';margin-bottom:5px;}',
    P + '-tip ' + P + '-t-x{display:block;font-size:' + F.note + 'px;font-weight:400;color:' + C.ink2 + ';line-height:1.4;}',
    P + '-tip ' + P + '-t-r{display:flex;align-items:center;gap:6px;margin-top:3px;min-width:118px;}',
    P + '-tip ' + P + '-t-r:first-child{margin-top:0;}',
    P + '-tip ' + P + '-t-m{display:inline-block;flex:0 0 auto;width:10px;height:9px;border-radius:3px;}',
    P + '-tip ' + P + '-t-m' + P + '-dash{height:0;width:14px;border-radius:0;border-top:2px dashed;background:none;}',
    P + '-tip ' + P + '-t-m' + P + '-solid{border-top-style:solid;}',
    P + '-tip ' + P + '-t-l{font-size:11px;font-weight:500;color:' + C.muted + ';min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-tip ' + P + '-t-v{display:inline;margin:0 0 0 auto;font-size:' + F.body + 'px;font-weight:500;color:' + C.ink + ';white-space:nowrap;font-variant-numeric:tabular-nums;}',
    P + '-tip ' + P + '-t-r' + P + '-dim ' + P + '-t-v{color:' + C.muted + ';}',
    P + '-tip ' + P + '-t-pill{margin:0 0 0 auto;}',
    P + '-tip ' + P + '-t-n{display:block;font-size:' + F.cap + 'px;line-height:1.35;font-weight:400;color:' + C.muted + ';margin-top:4px;}',
    P + '-tip ' + P + '-t-r+' + P + '-t-n{margin-top:6px;padding-top:5px;border-top:1px solid ' + C.line2 + ';}',

    // ---- шапка: имя, выбор юнита, свежесть, вкладки ----
    // шапка — карточка на холсте (как шапка листа Adoption): радиус 12, без тени и без полосы во всю ширину
    P + '-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:12px 16px 0;padding:8px 12px 8px 8px;background:' + C.card + ';border-radius:12px;}',
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
    P + '-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;margin-left:5px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;font-size:9px;font-weight:500;}',

    // ---- строка фильтров: контролы 34 px ----
    P + '-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px 0;}',
    P + '-dd{position:relative;display:inline-block;}',
    P + '-ddb{display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;max-width:340px;}',
    P + '-ddb:hover{border-color:#d8dce4;}',
    P + '-ddb' + P + '-set{background:' + C.blueBg + ';color:#2b5fd0;border-color:#dbe6fd;}',
    P + '-ddb' + P + '-on{border-color:' + C.act + ';}',
    // выбрано, но не применено: пунктир акцентом — видно, что ждёт «Применить»
    P + '-ddb' + P + '-chg{border-style:dashed;border-color:' + C.act + ';}',
    P + '-ddl{color:' + C.muted + ';font-weight:400;}',
    P + '-ddb' + P + '-set ' + P + '-ddl{color:#5b83dc;}',
    P + '-ddv{overflow:hidden;text-overflow:ellipsis;min-width:0;}',
    P + '-ddc{color:' + C.muted2 + ';font-size:10px;}',
    P + '-x{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:rgba(43,95,208,.14);color:#2b5fd0;font-size:11px;line-height:1;cursor:pointer;flex:0 0 auto;}',
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
    // высоту; тянутся дерево юнитов, раскрытый раздел (HRBP, длинный разрез) и список метрик
    P + '-md3 ' + P + '-mdbd{grid-template-columns:minmax(0,2.25fr) minmax(0,1fr);}',
    P + '-md3 ' + P + '-mdcf{display:flex;flex-direction:column;overflow:hidden;padding-bottom:0;}',
    P + '-md3 ' + P + '-mdff{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);}',
    P + '-md3 ' + P + '-mdsc{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;padding:0 20px 16px 0;}',
    P + '-md3 ' + P + '-mdsc+' + P + '-mdsc{padding:0 0 16px 20px;border-left:1px solid ' + C.line2 + ';}',
    P + '-md3 ' + P + '-mdsc>' + P + '-mdg:first-child{margin-top:10px;}',
    // Тянущиеся блоки — flex 1 1 0 с явным минимумом (столько, сколько нужно шапке, поиску, списку от
    // 60–80 px и подвалу): минимум по содержимому дал бы полную высоту списка, а без минимума блок
    // налез бы на соседа. Ниже минимумов прокручивается подколонка.
    P + '-md3 [data-tz="unit"],' + P + '-md3 [data-tz="view"],' + P + '-md3 ' + P + '-zopen{flex:1 1 0;display:flex;flex-direction:column;margin-bottom:0;}',
    P + '-md3 [data-tz="unit"]{min-height:220px;}',
    P + '-md3 [data-tz="view"],' + P + '-md3 ' + P + '-zopen{min-height:200px;}',
    P + '-md3 [data-tz="cuts"]{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;margin-bottom:0;}',
    P + '-md3 ' + P + '-ulist{flex:1 1 0;min-height:72px;max-height:none;}',
    P + '-md3 ' + P + '-crow{flex-wrap:nowrap;}',
    P + '-md3 ' + P + '-crl{flex-basis:96px;}',
    P + '-md3 ' + P + '-crc,' + P + '-md3 ' + P + '-cra{flex:1 1 0;}',
    P + '-md3 ' + P + '-crow' + P + '-open{flex:1 1 0;min-height:192px;align-items:stretch;}',
    P + '-md3 ' + P + '-crow' + P + '-open>' + P + '-cra{display:flex;flex-direction:column;min-height:0;}',
    P + '-md3 ' + P + '-crow' + P + '-open ' + P + '-accb{flex:1 1 0;min-height:0;display:flex;flex-direction:column;}',
    P + '-md3 ' + P + '-crow' + P + '-open ' + P + '-accb>' + P + '-list{flex:1 1 0;min-height:60px;max-height:none;}',
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
    P + '-mgh{margin-top:6px;font-weight:500;color:' + C.ink + ';}',
    P + '-mgh:first-child{margin-top:0;}',
    P + '-mopt{padding-left:30px;}',
    P + '-mdf{flex:0 0 auto;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px 20px;border-top:1px solid ' + C.line2 + ';background:' + C.hover + ';}',
    P + '-mdfs{flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:' + F.note + 'px;color:' + C.muted + ';}',
    // узкое окно: что изменено — своей строкой сверху, кнопки — строкой ниже, «Применить» справа
    P + '-md1 ' + P + '-mdfs{order:-1;flex-basis:100%;}',
    P + '-md1 ' + P + '-mdf [data-action="reset"]{margin-right:auto;}',
    P + '-btn' + P + '-sm{height:28px;padding:0 10px;}',
    // разрез до трёх значений — флажки-чипы в строку: 30 в строке 34, как сегмент периода Adoption
    // строка окна: подпись 116 | выбор; подпись — по первой строке выбора (чипы переносятся, раздел раскрывается)
    P + '-crow{display:flex;align-items:flex-start;flex-wrap:wrap;gap:6px 10px;margin:0 0 8px;}',
    P + '-crl{flex:0 0 116px;display:flex;flex-direction:column;gap:1px;padding-top:9px;font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';}',
    P + '-crc{flex:1 1 240px;min-width:0;display:flex;flex-wrap:wrap;gap:6px;padding:2px 0;}',
    P + '-cra{flex:1 1 240px;min-width:0;}',
    P + '-cchip{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid ' + C.line + ';border-radius:999px;background:' + C.card + ';font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;}',
    P + '-cchip:hover{border-color:#d3d8e0;}',
    P + '-cchip' + P + '-on{background:' + C.blueBg + ';border-color:#cfdcfb;color:#2b5fd0;}',
    P + '-cchip ' + P + '-optn{margin-left:0;}',
    P + '-cck{position:relative;flex:0 0 auto;width:13px;height:13px;border:1.5px solid #c3c9d4;border-radius:4px;background:' + C.card + ';}',
    P + '-cchip' + P + '-on ' + P + '-cck{background:' + C.blue + ';border-color:' + C.blue + ';}',
    P + '-cchip' + P + '-on ' + P + '-cck:after{content:"";position:absolute;left:3px;top:0;width:3px;height:7px;border:solid #fff;border-width:0 1.5px 1.5px 0;transform:rotate(45deg);}',
    P + '-crn{align-self:center;font-size:' + F.note + 'px;color:' + C.muted + ';}',
    // разделы окна (HRBP, разрез с длинным списком): заголовок-кнопка во всю ширину и тело под ним
    P + '-acc>' + P + '-ddb{display:flex;width:100%;max-width:none;}',
    P + '-acc ' + P + '-ddv{flex:1;text-align:left;}',
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
    P + '-srch{display:block;width:100%;height:30px;border:1px solid ' + C.line + ';border-radius:999px;padding:0 12px 0 30px;font-size:13px;font-weight:400;color:' + C.ink + ';margin:0;background:' + C.card + ';}',
    P + '-srch:focus{outline:none;border-color:' + C.act + ';}',
    P + '-list{max-height:320px;overflow:auto;margin:0 -4px;padding:0 4px;}',
    P + '-opt{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:' + F.control + 'px;font-weight:400;color:' + C.ink2 + ';}',
    P + '-opt:hover{background:#f4f6f9;color:' + C.ink + ';}',
    P + '-opt input{accent-color:' + C.blue + ';flex:0 0 auto;margin:0;cursor:pointer;}',
    P + '-optn{margin-left:auto;color:' + C.muted + ';font-size:' + F.note + 'px;font-variant-numeric:tabular-nums;white-space:nowrap;}',
    P + '-optt{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-blk{font-size:' + F.cap + 'px;font-weight:500;color:' + C.muted + ';text-transform:uppercase;letter-spacing:.3px;margin:10px 9px 2px;}',
    P + '-blk:first-child{margin-top:2px;}',
    P + '-popf{display:flex;gap:8px;align-items:center;margin-top:8px;padding-top:8px;border-top:1px solid ' + C.line2 + ';}',
    P + '-popf span{flex:1;font-size:11px;color:' + C.muted + ';font-weight:400;line-height:1.35;}',
    P + '-nores{padding:14px 8px;color:' + C.muted + ';font-size:' + F.note + 'px;font-weight:400;text-align:center;}',
    // дерево юнитов: строка как пункт выпадашки Adoption (12 px, поля 6/9)
    P + '-tr{display:flex;align-items:center;gap:4px;padding:6px 9px;border-radius:7px;cursor:pointer;font-size:' + F.control + 'px;font-weight:400;color:' + C.ink2 + ';}',
    P + '-tr:hover{background:#f4f6f9;color:' + C.ink + ';}',
    P + '-tr' + P + '-cur{background:' + C.blueBg + ';color:#2b5fd0;font-weight:500;}',
    P + '-tw{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin:-2px 0;border:0;background:transparent;color:' + C.muted + ';cursor:pointer;border-radius:6px;flex:0 0 auto;font-size:10px;line-height:1;padding:0;}',
    P + '-tw:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-tsp{display:inline-block;width:20px;flex:0 0 auto;}',
    P + '-tn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-tl{color:' + C.muted2 + ';font-size:' + F.cap + 'px;font-weight:400;white-space:nowrap;}',
    P + '-th{color:' + C.muted + ';font-size:' + F.note + 'px;font-variant-numeric:tabular-nums;white-space:nowrap;min-width:44px;text-align:right;}',
    P + '-hzc{flex:0 1 auto !important;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;letter-spacing:0;font-size:' + F.note + 'px;font-weight:500;color:#2b5fd0;background:' + C.blueBg + ';border-radius:999px;padding:2px 8px;}',
    P + '-hzt{display:inline-block;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.blueBg + ';color:#2b5fd0;margin-left:6px;vertical-align:1px;white-space:nowrap;}',
    P + '-tpath{display:block;color:' + C.muted + ';font-size:' + F.cap + 'px;font-weight:400;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-gone{display:inline-block;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.surface2 + ';color:' + C.muted + ';margin-left:5px;vertical-align:1px;white-space:nowrap;}',
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
    P + '-notes{padding:0 16px;}',
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
    P + '-content{padding:14px 16px 16px;min-width:0;}',
    P + '-pageh{margin:0 0 12px;}',
    P + '-h2{font-size:' + F.title + 'px;margin:0 0 4px;font-weight:600;color:' + C.ink + ';}',
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
    P + '-dpan ' + P + '-pht{flex:1 1 auto;}',
    P + '-dpan ' + P + '-pht>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    P + '-dpan ' + P + '-pbtn{flex:0 0 auto;}',
    P + '-pb{padding:14px 16px;}',
    P + '-pb' + P + '-tbl{padding:0 16px 4px;overflow:auto;}',
    // вкладки панели: 28 в подложке 34 (подложка 3, gap 3, радиус 12/9)
    P + '-subs{display:inline-flex;gap:3px;background:' + C.line2 + ';border-radius:12px;padding:3px;flex-wrap:wrap;}',
    P + '-sub{display:inline-flex;align-items:center;gap:6px;height:28px;border:0;background:transparent;padding:0 12px;border-radius:9px;font-weight:500;font-size:' + F.note + 'px;line-height:1;color:' + C.muted + ';cursor:pointer;white-space:nowrap;}',
    P + '-sub:hover{color:' + C.ink2 + ';}',
    P + '-sub' + P + '-on{background:' + C.card + ';color:' + C.ink + ';}',
    P + '-tools{display:flex;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:12px;}',
    P + '-tools ' + P + '-lh{align-self:center;}',
    P + '-dnote{font-size:' + F.note + 'px;color:' + C.muted + ';max-width:380px;line-height:1.4;}',
    P + '-below{color:' + C.muted2 + ';cursor:help;border-bottom:1px dotted ' + C.muted2 + ';}',
    P + '-ctl{display:flex;flex-direction:column;gap:4px;}',
    P + '-ctll{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.4px;color:' + C.muted + ';font-weight:500;}',
    P + '-selw{position:relative;display:inline-block;max-width:100%;}',
    P + '-selw select{appearance:none;-webkit-appearance:none;height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 30px 0 12px;font-size:' + F.control + 'px;color:' + C.ink2 + ';font-weight:500;cursor:pointer;min-width:200px;max-width:100%;}',
    P + '-selw select:focus{outline:none;border-color:' + C.act + ';}',
    P + '-selc{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-style:normal;color:' + C.muted2 + ';font-size:10px;pointer-events:none;}',
    P + '-inp{height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-size:13px;font-weight:400;color:' + C.ink + ';width:100%;}',
    P + '-inp:focus{outline:none;border-color:' + C.act + ';}',
    P + '-sp2{flex:1;}',

    // ---- таблицы: th 9/8 (капитель 10,5 / 500), td 6/8, строка 44, первая колонка 12 / 500 ----
    P + '-t{width:100%;border-collapse:collapse;font-size:' + F.body + 'px;font-variant-numeric:tabular-nums;}',
    P + '-t' + P + '-fix{table-layout:fixed;}',
    P + '-t th{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.3px;color:' + C.muted + ';font-weight:500;line-height:12px;text-align:right;padding:9px 8px;border-bottom:1px solid ' + C.line + ';white-space:nowrap;position:sticky;top:0;z-index:3;background:' + C.card + ';}',
    P + '-t th' + P + '-l{text-align:left;padding-left:12px;}',
    P + '-t th' + P + '-c{text-align:center;}',
    P + '-hc{display:block;font-size:' + F.micro + 'px;text-transform:none;letter-spacing:0;color:' + C.muted2 + ';font-weight:400;margin-top:2px;}',
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
    P + '-car{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-6px 4px -6px -6px;border:0;background:transparent;border-radius:7px;color:' + C.muted + ';font-size:12px;line-height:1;cursor:pointer;flex:0 0 auto;padding:0;}',
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
    P + '-sa{color:' + C.act + ';margin-left:4px;font-size:11px;}',
    P + '-nw{white-space:nowrap;}',

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
    P + '-tag{display:inline-block;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.surface2 + ';color:' + C.ink2 + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    P + '-tag' + P + '-own{background:' + C.warnBg + ';color:' + C.warnTx + ';}',
    P + '-more{display:inline-block;font-size:9px;font-weight:500;letter-spacing:.3px;padding:0 5px;border-radius:4px;border:1px dashed ' + C.line + ';color:' + C.muted + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    // Без ориентира — словами в пунктирной рамке, а не прочерком (ДС 4.8).
    P + '-nocmp{display:inline-flex;align-items:center;height:22px;padding:0 8px;border:1px dashed ' + C.line + ';border-radius:999px;font-size:' + F.note + 'px;font-weight:400;color:' + C.muted + ';white-space:nowrap;}',
    // Значок справки ⓘ: 14 px, глиф 9 / 600, рамка muted2
    P + '-info{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid ' + C.muted2 + ';color:' + C.muted + ';font-size:9px;font-weight:600;font-style:normal;line-height:1;cursor:help;flex:0 0 auto;margin-left:6px;vertical-align:-2px;user-select:none;}',
    P + '-info:hover{border-color:' + C.act + ';color:' + C.act + ';}',
    // Сигнальный чип: 11 / 500, радиус 999, поля 2/9
    P + '-st{display:inline-block;font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;white-space:nowrap;cursor:help;}',
    P + '-st' + P + '-good{background:' + C.greenBg + ';color:' + C.greenTx + ';}',
    P + '-st' + P + '-neutral{background:' + C.surface2 + ';color:' + C.muted + ';}',
    P + '-st' + P + '-wait{background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-fchip{display:inline-block;font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;margin:1px 4px 1px 0;white-space:nowrap;}',

    // ---- легенда, пусто, сноски ----
    P + '-legend{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin:0 0 12px;font-size:' + F.note + 'px;color:' + C.ink2 + ';}',
    P + '-legend' + P + '-r{justify-content:flex-end;text-align:right;}',
    P + '-lh{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted2 + ';font-weight:500;}',
    P + '-sw{display:inline-flex;align-items:center;gap:6px;font-weight:500;cursor:help;}',
    P + '-sw:hover{color:' + C.ink + ';}',
    P + '-dot{width:10px;height:9px;border-radius:3px;display:inline-block;box-shadow:inset 0 0 0 1px rgba(31,31,31,.10);}',
    P + '-empty{background:' + C.card + ';border-radius:12px;box-shadow:' + SH + ';padding:28px;text-align:center;color:' + C.muted + ';font-size:' + F.body + 'px;line-height:1.5;}',
    P + '-empty b{display:block;color:' + C.ink + ';font-size:15px;font-weight:600;margin-bottom:8px;}',
    P + '-tnote{margin-top:8px;font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;line-height:1.5;}',

    // ---- графики (Proteus Adoption, ДС 6): ось 10,5, подписи 11 на белой подложке ----
    P + '-spark{display:block;width:100%;max-width:240px;height:auto;margin:0 auto;overflow:visible;}',
    // Линия спарклайна — акцент текущего периода, как «2026» в «Динамике»; ориентир — пунктир.
    P + '-sline{fill:none;stroke:' + C.cur + ';stroke-width:1.6;stroke-linejoin:round;stroke-linecap:round;opacity:.85;}',
    P + '-sref{fill:none;stroke:' + C.prev + ';stroke-width:1;stroke-dasharray:3 3;}',
    // Точки светофора — тон того же сигнала, что у пилюли (тот, что был у столбиков), с белой обводкой.
    P + '-sdot{stroke:#fff;stroke-width:1.2;transform-box:fill-box;transform-origin:center;transition:transform .12s;}',
    P + '-sdot' + P + '-good{fill:' + C.green + ';}',
    P + '-sdot' + P + '-bad{fill:' + C.red + ';}',
    P + '-sdot' + P + '-warn,' + P + '-sdot' + P + '-neutral{fill:' + C.neutral + ';}',
    P + '-sdot' + P + '-slast' + P + '-good{fill:' + C.greenTx + ';}',
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
    P + '-hz{cursor:crosshair;}',
    // Заголовок графика — капитель серым (ПОЛЬЗОВАТЕЛИ ПО ПЕРИОДАМ в Adoption), легенда справа кнопками.
    P + '-chb{min-width:0;}',
    P + '-chh{display:flex;align-items:center;gap:12px;min-height:24px;margin:0 0 4px;flex-wrap:wrap;row-gap:4px;}',
    P + '-cap{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;}',
    P + '-cht{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.5px;color:' + C.muted + ';font-weight:500;}',
    P + '-chl{display:flex;gap:12px;flex-wrap:wrap;font-size:' + F.note + 'px;color:' + C.ink2 + ';font-weight:400;margin-left:auto;}',
    P + '-lgd{display:inline-flex;gap:4px;margin-left:auto;flex-wrap:wrap;}',
    P + '-lg{display:inline-flex;align-items:center;gap:6px;height:22px;border:1px solid ' + C.line2 + ';background:' + C.card + ';border-radius:999px;padding:0 10px 0 8px;font-size:' + F.note + 'px;color:' + C.ink2 + ';cursor:pointer;font-weight:500;white-space:nowrap;}',
    P + '-lg:hover{border-color:#d8dce4;background:#fafbfc;}',
    P + '-lg:focus{outline:none;}',
    P + '-lg:focus-visible{border-color:' + C.act + ';}',
    P + '-lg' + P + '-off{opacity:.45;}',
    P + '-lg' + P + '-off ' + P + '-lgk{border-top-color:#c7c8cc !important;}',
    P + '-lgk{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;}',
    P + '-lgk' + P + '-dash{border-top-style:dashed;}',
    P + '-lgm{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;margin-right:5px;}',
    P + '-lgm' + P + '-dash{border-top-style:dashed;}',
    P + '-lgb{display:inline-block;width:10px;height:9px;border-radius:3px;vertical-align:middle;margin-right:5px;}',
    // Наведение на пункт легенды гасит чужие серии (ДС 6.4).
    P + '-chb [data-s]{transition:opacity .14s ease-out;}',
    P + '-chb[data-hi] [data-s]{opacity:.16;}',
    P + '-chb[data-hi="cur"] [data-s="cur"],' + P + '-chb[data-hi="prev"] [data-s="prev"],' + P + '-chb[data-hi="ref"] [data-s="ref"]{opacity:1;}',
    // Раскрытая строка «Сводки»: два графика рядом, воздух 16 со всех сторон.
    P + '-t tr' + P + '-opn td{background:#f7f9fd;}',
    P + '-dsplit{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding:14px 0 2px;}',
    P + '-dsplit::before{content:"";position:absolute;left:50%;top:14px;bottom:0;width:1px;background:' + C.line + ';}',
    P + '-dsplit ' + P + '-dcol:first-child{padding:0 20px 0 16px;}',
    P + '-dsplit ' + P + '-dcol+' + P + '-dcol{padding:0 16px 0 20px;}',
    P + '-narrow ' + P + '-dsplit{grid-template-columns:minmax(0,1fr);padding:12px 12px 0;}',
    P + '-narrow ' + P + '-dsplit::before{display:none;}',
    P + '-narrow ' + P + '-dsplit ' + P + '-dcol:first-child{padding:0 0 14px;}',
    P + '-narrow ' + P + '-dsplit ' + P + '-dcol+' + P + '-dcol{padding:14px 0 0;border-top:1px solid ' + C.line + ';}',
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
    P + '-fit>' + P + '-panel>' + P + '-pb{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:auto;}',
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
    P + '-rail i{font-style:normal;font-size:11px;}',
    P + '-ib{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;background:transparent;border-radius:7px;color:' + C.muted + ';cursor:pointer;padding:0;flex:0 0 auto;}',
    P + '-ib:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-ib' + P + '-on{color:' + C.act + ';}',
    P + '-pbtn{display:inline-flex;align-items:center;gap:6px;}',
    // Группы метрик над колонками («Все метрики»): строка 22 над шапкой, линия между группами.
    P + '-t tr' + P + '-thg th{height:' + CFG.spacing.thG + 'px;padding:6px 8px 0;border-bottom:0;text-align:center;color:' + C.muted2 + ';letter-spacing:.5px;}',
    P + '-t tr' + P + '-thg th' + P + '-l{vertical-align:bottom;text-align:left;padding:0 8px 9px 12px;color:' + C.muted + ';letter-spacing:.3px;border-bottom:1px solid ' + C.line + ';}',
    // Узкая таблица не сжимает имена в столбик — прокручивается внутри панели.
    // Колонка имён не уже, чем при всех именах в одну строку (--hh-ncol, measureNames): выбранная
    // строка, развернув имя, колонку не сужает — остальные колонки при выборе не прыгают.
    P + '-tpan ' + P + '-t td' + P + '-l:first-child,' + P + '-tpan ' + P + '-t th' + P + '-l{min-width:var(--' + CFG.ns + '-ncol,210px);}',
    P + '-t' + P + '-g2 thead tr+tr th{top:' + CFG.spacing.thG + 'px;}',
    P + '-t' + P + '-g2 tr' + P + '-tot td{top:' + (CFG.spacing.thG + CFG.spacing.thH) + 'px;}',
    P + '-t th' + P + '-gs,' + P + '-t td' + P + '-gs{border-left:1px solid ' + C.line2 + ';}',
    // стопка графиков: зазор 26 (chart-gap профиля)
    P + '-dyn{display:flex;flex-direction:column;gap:26px;}',

    // ---- числа людей, маленькие команды ----
    P + '-t td ' + P + '-abs{white-space:normal;line-height:1.25;}',
    P + '-t td' + P + '-sm0{cursor:help;}',
    P + '-t tr' + P + '-smr{cursor:default;}',
    P + '-t tr' + P + '-smr:hover td{background:transparent;}',
    P + '-snote{font-size:' + F.note + 'px;line-height:1.45;color:' + C.ink2 + ';background:' + C.surface2 + ';border-radius:9px;padding:10px 12px;}',
    P + '-dash0{display:inline-block;width:10px;text-align:center;font-weight:600;color:' + C.muted + ';}',
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
    P + '-pull{display:inline-block;margin-left:6px;padding:1px 6px;border-radius:4px;background:' + C.redBg + ';color:' + C.redTx + ';font-size:' + F.micro + 'px;font-weight:500;letter-spacing:.2px;vertical-align:1px;white-space:nowrap;cursor:help;}',
    P + '-cpok{font-size:' + F.note + 'px;font-weight:500;color:' + C.greenTx + ';white-space:nowrap;margin-right:4px;align-self:center;}',

    // ---- каталог и цели ----
    P + '-cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:12px;align-items:start;}',
    P + '-catp ' + P + '-pb{padding:0;}',
    P + '-clist{list-style:none;margin:0;padding:0;}',
    P + '-clist li{display:flex;flex-direction:column;gap:2px;padding:10px 16px;border-top:1px solid ' + C.line2 + ';}',
    P + '-cn{font-weight:500;font-size:' + F.body + 'px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;color:' + C.ink + ';}',
    P + '-cn ' + P + '-info{margin-left:0;}',
    P + '-cm{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;line-height:1.4;}',
    P + '-cb{font-size:11px;font-weight:500;padding:1px 8px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:12px;}',
    P + '-root ' + P + '-code{display:block;width:100%;min-height:58px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;border:1px solid ' + C.line + ';border-radius:9px;padding:10px 12px;background:' + C.hover + ';color:' + C.ink + ';resize:vertical;white-space:pre-wrap;}',
    P + '-root ' + P + '-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:' + C.muted + ';font-weight:400;}',
    P + '-steps{margin:0;padding-left:18px;color:' + C.ink2 + ';font-size:' + F.body + 'px;line-height:1.6;}',

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
    P + '-tx{margin-left:auto;font-size:12px;}',
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
function hInfo(o) { return '<span class="' + CFG.ns + '-info"' + tip(o) + '>i</span>'; }
// Поиск в поповере: пилюля с лупой 13 px (как поиск каталога Proteus Adoption).
var SEARCH_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">'
  + '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
function qv(kind) { return String((state.qk && state.qk[kind]) || ''); }
function hSearch(kind, placeholder) {
  var P = CFG.ns;
  return '<div class="' + P + '-psearch">' + SEARCH_SVG + '<input class="' + P + '-srch" type="text" data-psearch="' + esc(kind) + '" placeholder="'
    + esc(placeholder) + '" value="' + esc(qv(kind)) + '"></div>';
}
function hSel(name, options, value, cls) {
  var P = CFG.ns, s = '<span class="' + P + '-selw' + (cls ? ' ' + cls : '') + '"><select data-sel="' + name + '">';
  for (var i = 0; i < options.length; i++) {
    s += '<option value="' + esc(options[i][0]) + '"' + (options[i][0] === value ? ' selected' : '') + '>' + esc(options[i][1]) + '</option>';
  }
  return s + '</select><i class="' + P + '-selc">▾</i></span>';
}
// Пилюля — ОДНА на отчёт: изменение, отклонение от ориентира, значение в «Командах», пилюля
// в подсказке. Размер у всех один (11,5 / 500, высота 22), различается только цвет.
var PILL_OF = { up: 'good', down: 'bad', flat: 'flat', neu: 'neu' };
function hPill(st, text) { return '<span class="' + CFG.ns + '-pill ' + CFG.ns + '-' + st + '">' + esc(text) + '</span>'; }
// Ячейка изменения: подсказка на всей ячейке — между соседними ячейками тултип не мигает.
function deltaTd(m, d, text, cls) {
  var c = cls ? ' class="' + cls + '"' : '';
  if (d === null || d === undefined) return '<td' + c + tip({ title: 'Изменение', text: 'Нет значения за один из периодов.' }) + '>' + hPill('flat', '—') + '</td>';
  return '<td' + c + tip({ title: 'Изменение', text: text, rows: [{ label: 'значение', value: fmtDelta(m, d) }],
                       note: m.better === 'flat' ? 'Нейтральная метрика: цвет не ставится.' : null }) + '>'
    + hPill(PILL_OF[deltaClass(m, d)] || 'flat', fmtDelta(m, d)) + '</td>';
}
function dirText(m) { return m.better === 'flat' ? 'больше не значит лучше' : (m.better === 'higher' ? 'выше — лучше' : 'ниже — лучше'); }
function pageHead(title, ledeHtml) {
  var P = CFG.ns;
  return '<div class="' + P + '-pageh"><h2 class="' + P + '-h2">' + esc(title) + '</h2><p class="' + P + '-lede">' + ledeHtml + '</p></div>';
}

// ---- разрезы: подписи для чипов, цели и базы ----
function selLabel() {
  var out = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var s = MODEL.sel[CFG.cuts[i].key] || [];
    if (s.length) out.push(CFG.cuts[i].label + ': ' + (s.length > 2 ? s.length + ' знач.' : s.join(', ')));
  }
  return out.length ? out.join('; ') : 'вся численность';
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
      text: 'Цель установлена на этом юните и уходит вниз по всей его ветке.',
      rows: [{ label: 'цель', value: fmtVal(m, bl.ref) }, { label: 'правило', value: bl.rule.id }],
      note: ruleCuts(bl.rule).length ? 'Действует при разрезах: ' + ruleCuts(bl.rule).join('; ') : null }) + '>★ Фокус</span>';
  }
  return ' <span class="' + P + '-tag"' + tip({ title: 'Фокус через родителя',
    text: 'Своей цели у юнита нет — он наследует её сверху. Появится своя — начнёт работать она.',
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
  var notes = ['Выберите эти разрезы в «Фильтрах» — тогда цель станет фокусом отчёта.'];
  if (rules.length > 3) notes.unshift('Показаны 3 из ' + rules.length + '.');
  return ' <span class="' + P + '-more"' + tip({ title: 'Ещё ' + rules.length + ' ' + plural(rules.length, 'цель', 'цели', 'целей') + ' по разрезам численности',
    rows: rows, note: notes }) + '>+' + rules.length + ' по разрезам</span>';
}
// Легенда светофора — одна на отчёт, над таблицами и справа, на вертикали цвета.
function legendHTML(right, small) {
  var P = CFG.ns, C = CFG.colors;
  var dz = 'Отклонение до 5% от ориентира не считается значимым — ни в плюс, ни в минус. Для цели 4,0% это коридор 3,8–4,2%, для 80% — 76–84%.';
  return '<div class="' + P + '-legend' + (right ? ' ' + P + '-r' : '') + '"><span class="' + P + '-lh">Цвет значения</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Зелёный', text: 'Метрика лучше ориентира больше чем на 5%.', note: 'Ориентир — цель, если она есть, иначе база сравнения.' })
    + '><span class="' + P + '-dot" style="background:' + C.green + '"></span> лучше ориентира</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Красный', text: 'Метрика хуже ориентира больше чем на 5%.', note: '«Лучше» у каждой метрики своё: у текучести — меньше, у закрепляемости — больше.' })
    + '><span class="' + P + '-dot" style="background:' + C.red + '"></span> хуже ориентира</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Серый — мёртвая зона ±5%', text: dz, note: 'Серым красится и метрика без ориентира: у «больше не значит лучше» цвета быть не может.' })
    + '><span class="' + P + '-dot" style="background:' + C.neutral + '"></span> в пределах ±5% или без ориентира</span>'
    + (small ? '<span class="' + P + '-sw"' + tip({ title: 'Прочерк — меньше ' + CFG.small.min + ' человек',
        text: 'Закрепляемость и текучесть команды меньше ' + CFG.small.min + ' человек не оцениваются: один человек сдвигает процент на несколько пунктов.',
        note: 'Сколько это людей — в подсказке ячейки.' }) + '><b class="' + P + '-dash0">—</b> меньше ' + CFG.small.min + ' чел.: без оценки</span>' : '')
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
        text: 'У метрики есть утверждённая цель — сравнение идёт с ней, а не с базой.',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: 'цель', value: fmtVal(m, bl.ref), color: CFG.colors.kpi, dash: true },
               { label: 'отклонение', value: fmtDelta(m, dk) }],
        note: [(bl.inherited ? 'Цель унаследована с уровня «' : 'Цель стоит на юните «') + unitName(MODEL, bl.owner) + '».', STATE_TXT[bl.state]] }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">Цель ' + (m.better === 'higher' ? '≥' : '≤') + '</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + hPill(bl.state, fmtDelta(m, dk)) + '</td>';
  }
  if (bl.kind === 'bench' && benchSelf()) {
    return '<td class="' + P + '-vs"' + tip({ title: 'Юнит совпадает с базой', text: 'Выбрана вся компания: база сравнения — это она же под теми же разрезами. Отклонение появится на юнитах ниже.' }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">База</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + '<span class="' + P + '-same">юнит = база</span></td>';
  }
  if (bl.kind === 'bench') {
    var db = deltaOf(m, v, bl.ref);
    return '<td class="' + P + '-vs"' + tip({ title: 'Сравнение с базой',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: benchLabel(), value: fmtVal(m, bl.ref), color: CFG.colors.bench, dash: true },
               { label: 'отклонение', value: fmtDelta(m, db) }],
        note: 'База — вся компания под теми же разрезами численности. Мёртвая зона ±5%: внутри неё отклонение серое.' }) + '>'
      + '<div class="' + P + '-tgt"><span class="' + P + '-tgl">База</span>' + esc(fmtVal(m, bl.ref)) + '</div>'
      + hPill(bl.state, fmtDelta(m, db)) + '</td>';
  }
  var why = m.better === 'flat' ? 'У этой метрики «больше» не значит «лучше»: оценивать её цветом было бы неправдой.'
    : 'Абсолютная величина: сравнение со средней по компании показывало бы масштаб, а не оценку.';
  return '<td class="' + P + '-vs"' + tip({ title: 'Сравнение отключено', text: why }) + '><span class="' + P + '-nocmp">не сравнивается</span></td>';
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
  // Тур «Как работать» — по той вкладке, на которой нажали (ДС §10: справка доступна кнопкой).
  if (ok && M.L >= 12) {
    s += '<button type="button" class="' + P + '-btn ' + P + '-help" data-tact="tour" data-tour="help"'
      + tip({ title: 'Как работать с отчётом', text: 'Тур по этой вкладке: по очереди подсветим элементы и расскажем, что будет по клику.' })
      + '>' + HELP_SVG + 'Как работать</button>';
  }
  if (M.ok && M.L >= 0) {
    var lw = lastIdx('w');
    s += '<span class="' + P + '-badge"' + tip({ title: 'Свежесть данных',
      rows: [{ label: 'данные на', value: M.dataDt ? fmtDay(M.dataDt) : '—' }, { label: 'последний месяц', value: monthFull(M.L) },
             { label: 'последняя неделя', value: lw >= 0 ? weekRange(lw) : '—' }],
      note: 'Метрики считаются по закрытым месяцам и неделям. Незакрытый месяц в отчёт не попадает.' })
      + '>Период: <b>' + esc(monthFull(M.L)) + '</b></span>';
  }
  if (M.meta) {
    s += '<span class="' + P + '-badge"' + tip({ title: 'Доступ', rows: [{ label: 'логин', value: M.meta.me || '—' }, { label: 'роль', value: roleName(M.role) },
      { label: 'корней зоны', value: String(M.roots.length) }], note: 'Зона видимости задаётся реестром доступа отчёта (hrbp_hub_access). Юниты вне зоны не приезжают в данные вовсе.' })
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
// Юнит — главный фильтр: дерево зоны с поиском открыто всегда (не раздел-аккордеон).
function unitBlockHTML() {
  var P = CFG.ns, st = staged(), h = stagedHz(), inHz = h && !state.unitAll;
  return '<div class="' + P + '-mdz" data-tz="unit">' + zoneHead('Юнит отчёта', unitsLabel(st.unit, st.hz), unitChanged())
    + (h ? '<div class="' + P + '-acch"><span>' + (inHz ? 'Юниты в зоне HRBP' : 'Вся зона видимости, зона HRBP отмечена') + '</span><span class="' + P + '-hzc">' + esc(h.nm) + '</span></div>' : '')
    + hSearch('unit', inHz ? 'Поиск юнита в зоне ' + h.nm : 'Поиск юнита по названию')
    + '<div class="' + P + '-list ' + P + '-ulist" data-plist="unit">' + unitListHTML() + '</div>'
    + '<div class="' + P + '-popf"><span>' + (h
        ? (inHz ? 'Показана только зона HRBP. ' : 'Показана вся зона видимости. ')
          + '<button class="' + P + '-lnk" data-action="unitall">' + (inHz ? 'Вся зона видимости' : 'Только зона HRBP') + '</button>'
        : 'Цифра справа — численность сейчас.') + '</span></div></div>';
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
// По умолчанию раскрыты корни и путь до юнита отчёта и до набранного в окне (выбран из поиска —
// после выбора дерево показывает его на месте).
function onScopePath(id) {
  var ids = MODEL.scopeIds.concat(state.stage ? state.stage.unit : []);
  for (var i = 0; i < ids.length; i++) if (pathTo(ids[i]).indexOf(id) > -1 && ids[i] !== id) return true;
  return false;
}
function treeOpen(id, depth) { return state.treeOpen.hasOwnProperty(id) ? !!state.treeOpen[id] : (depth === 0 || onScopePath(id)); }
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
  out.s += '<div class="' + P + '-tr' + (id === cur ? ' ' + P + '-cur' : '') + (mark ? ' ' + P + '-hzr' : '') + '" data-action="pick" data-id="' + esc(id) + '" style="padding-left:' + (9 + depth * 16) + 'px">'
    + (kids.length ? '<button class="' + P + '-tw" data-action="tree" data-id="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="' + P + '-tsp"></span>')
    + '<span class="' + P + '-tn">' + esc(u.nm) + (u.cur ? '' : '<span class="' + P + '-gone">нет в структуре</span>') + mark + path + '</span>'
    + '<span class="' + P + '-tl">' + esc(levelShort(u.lvl)) + '</span><span class="' + P + '-th">' + fmtInt(u.hc) + '</span></div>';
  if (!open) return;
  for (var i = 0; i < kids.length; i++) treeRows(kids[i], depth + 1, cur, out);
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
    var s = '<div class="' + P + '-tr' + (all ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + (inHz ? 'Вся зона HRBP' : (M.role === 'hrbp' ? 'Вся моя зона' : 'Вся зона видимости')) + '</span>'
      + '<span class="' + P + '-tl">' + top.length + ' ' + plural(top.length, 'корень', 'корня', 'корней') + '</span>'
      + '<span class="' + P + '-th">' + fmtInt(zoneHc(top)) + '</span></div>';
    var out = { s: '', n: 0, withPath: inHz, hzRoots: h && !inHz ? h.roots : null };
    var roots = top.slice().sort(function (a, b) { return unitName(M, a) < unitName(M, b) ? -1 : 1; });
    for (var i = 0; i < roots.length; i++) treeRows(roots[i], 0, cur, out);
    return s + out.s;
  }
  var hits = [];
  for (var id in M.units) {
    if (!M.units.hasOwnProperty(id)) continue;
    var u = M.units[id], at = u.lc.indexOf(q);
    if (at < 0 || !inZone(id) || (inHz && !inHzZone(id, h))) continue;
    hits.push({ id: id, u: u, rank: (at === 0 ? 0 : 1) * 100 + u.lvl });
  }
  // Справочник — вся зона логина на всю глубину: поиск идёт здесь же, без запроса.
  var r = '';
  if (!hits.length) return '<div class="' + P + '-nores">Ничего не найдено</div>';
  hits.sort(function (a, b) { return a.rank - b.rank || (a.u.nm < b.u.nm ? -1 : 1); });
  for (var k = 0; k < hits.length && k < 80; k++) {
    var h = hits[k], chain = pathTo(h.id), names = [];
    for (var c = Math.max(0, chain.length - 4); c < chain.length - 1; c++) names.push(unitName(M, chain[c]));
    r += '<div class="' + P + '-tr' + (h.id === cur ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="' + esc(h.id) + '">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + esc(h.u.nm) + (h.u.cur ? '' : '<span class="' + P + '-gone">нет в структуре</span>')
      + '<span class="' + P + '-tpath">' + esc(names.join(' › ') || levelLabel(h.u.lvl)) + '</span></span>'
      + '<span class="' + P + '-tl">' + esc(levelShort(h.u.lvl)) + '</span><span class="' + P + '-th">' + fmtInt(h.u.hc) + '</span></div>';
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
  return '<div class="' + P + '-tr' + (h.login === cur ? ' ' + P + '-cur' : '') + '" data-action="hpick" data-id="' + esc(h.login) + '"'
    + (withPath ? '' : ' style="padding-left:' + (9 + depth * 16) + 'px"') + '>'
    + (!withPath && kids.length ? '<button class="' + P + '-tw" data-action="htree" data-id="' + esc(h.login) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="' + P + '-tsp"></span>')
    + '<span class="' + P + '-tn">' + esc(h.nm) + (h.login === (M.meta && M.meta.me) ? ' · я' : '')
    + '<span class="' + P + '-tpath">' + esc(withPath && chain.length ? chain.join(' › ') : hrbpRootsText(h)) + '</span></span>'
    + (kids.length ? '<span class="' + P + '-tl">' + kids.length + ' ' + plural(kids.length, 'HRBP', 'HRBP', 'HRBP') + ' ниже</span>' : '')
    + '<span class="' + P + '-th">' + fmtInt(h.hc) + '</span></div>';
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
    return '<div class="' + P + '-tr' + (!cur ? ' ' + P + '-cur' : '') + '" data-action="hpick" data-id="">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">Все HRBP<span class="' + P + '-tpath">без выбора — ' + (M.role === 'hrbp' ? 'вся моя зона' : 'вся зона видимости') + '</span></span>'
      + '<span class="' + P + '-th">' + fmtInt(zoneHc(M.roots)) + '</span></div>' + out.s;
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
    + '<div class="' + P + '-popf"><span>Ниже — HRBP, чьи зоны внутри зоны выше. Цифра справа — численность зоны.</span></div>';
}
function hrbpBlockHTML() {
  var owner = stagedHz(), chg = (owner ? owner.login : '') !== hzNow(), n = MODEL.hrbps.length;
  return '<div class="' + CFG.ns + '-mdz' + (state.open === 'hrbp' ? ' ' + CFG.ns + '-zopen' : '') + '" data-tz="hrbp">' + rowAccHTML('hrbp', 'HRBP', owner ? owner.nm : 'Все HRBP', n + ' ' + plural(n, 'зона', 'зоны', 'зон'), !!owner, chg, hrbpBodyHTML) + '</div>';
}

// ---- разрезы, метрики, окно «Фильтры и настройки», строка применённого ----
// Значения разреза: фасеты ответа (численность при ОСТАЛЬНЫХ разрезах) + выбранные.
function cutValues(key) {
  var f = MODEL.facets[key] || [], out = [], seen = {};
  for (var i = 0; i < f.length; i++) { out.push({ v: f[i].v, n: f[i].n }); seen[f[i].v] = 1; }
  var sel = MODEL.sel[key] || [];
  for (var j = 0; j < sel.length; j++) if (!seen[sel[j]]) out.push({ v: sel[j], n: 0 });
  var ord = CFG.order[key];
  out.sort(function (a, b) {
    if (ord) {
      var ia = ord.indexOf(a.v), ib = ord.indexOf(b.v);
      if (ia > -1 || ib > -1) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    }
    return b.n - a.n || (a.v < b.v ? -1 : 1);
  });
  return out;
}
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
      + '<span class="' + P + '-optt">' + esc(cutName(v)) + '</span><span class="' + P + '-optn">' + fmtInt(vals[i].n) + '</span></label>';
  }
  if (!vals.length) return '<div class="' + P + '-nores">В выбранном юните значений нет</div>';
  return n ? s : '<div class="' + P + '-nores">Ничего не найдено</div>';
}
// Разрез до CFG.modal.inline значений (IT / nonIT, штат / не штат…) — флажки-чипы в строку:
// «Все» — без фильтра, значения отмечаются по одному (можно несколько). Цифра — численность.
function cutChipsHTML(cut, vals) {
  var P = CFG.ns, d = staged().cuts[cut.key] || [], chg = !sameSet(d, MODEL.sel[cut.key] || []);
  var s = '<span class="' + P + '-crc" role="group" aria-label="' + esc(cut.label) + '">'
    + '<button type="button" class="' + P + '-cchip' + (d.length ? '' : ' ' + P + '-on') + '" data-action="cutnone" data-key="' + cut.key + '" aria-pressed="' + (d.length ? 'false' : 'true') + '">Все</button>';
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i].v, on = d.indexOf(v) > -1;
    s += '<button type="button" class="' + P + '-cchip' + (on ? ' ' + P + '-on' : '') + '" data-action="cutv" data-key="' + cut.key + '" data-val="' + esc(v) + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
      + '<span class="' + P + '-cck" aria-hidden="true"></span>' + esc(cutName(v)) + '<span class="' + P + '-optn">' + fmtInt(vals[i].n) + '</span></button>';
  }
  if (!vals.length) s += '<span class="' + P + '-crn">в выбранном юните значений нет</span>';
  return rowHTML(cut.key, cut.label, chg, s + '</span>');
}
function cutRowHTML(cut) {
  var vals = cutValues(cut.key);
  if (vals.length <= CFG.modal.inline) return cutChipsHTML(cut, vals);
  var sel = staged().cuts[cut.key] || [], chg = !sameSet(sel, MODEL.sel[cut.key] || []);
  var val = !sel.length ? 'Все' : (sel.length === 1 ? cutName(sel[0]) : cutName(sel[0]) + ' +' + (sel.length - 1));
  return rowAccHTML('cut:' + cut.key, cut.label, val, vals.length + ' ' + plural(vals.length, 'значение', 'значения', 'значений'), sel.length > 0, chg, function () { return cutBodyHTML(cut); });
}
// Метрики — по группам «Сводки» с флажком группы (снять / вернуть всю группу); поиск — когда
// метрик больше CFG.modal.msearch. Флажки — набранный показ (stagedView), не применённый.
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
    s += '<label class="' + P + '-opt ' + P + '-mgh"><input type="checkbox" data-mgroup="' + bl.key + '"' + (on === all ? ' checked' : '') + (on > 0 && on < all ? ' data-ind="1"' : '') + '>'
      + '<span class="' + P + '-optt">' + esc(bl.name) + '</span><span class="' + P + '-optn">' + on + ' из ' + all + '</span></label>' + rows;
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
    + '<span class="' + P + '-mdd">Выбор копится и применяется одной кнопкой «Применить» внизу окна.</span></div>'
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
    + '<div class="' + P + '-drn">База сравнения — вся компания под теми же разрезами (сейчас: ' + esc(benchLabel()) + '). Юнит на базу не влияет.</div>'
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
function filterBarHTML() {
  var P = CFG.ns, chips = filterChips(), n = pendingN(), on = !!state.drawer;
  var s = '<div class="' + P + '-fbar">'
    + '<button type="button" class="' + P + '-fbtn' + (on ? ' ' + P + '-on' : '') + '" data-action="drawer" aria-haspopup="true" aria-expanded="' + (on ? 'true' : 'false') + '"'
    + tip({ title: 'Фильтры и настройки', text: 'Юнит, HRBP, разрезы численности и показ метрик — в одном окне. Всё выбранное применяется вместе кнопкой «Применить».' })
    + '>' + FILTER_SVG + 'Фильтры' + (chips.length ? '<span class="' + P + '-cnt">' + chips.length + '</span>' : '') + '</button>';
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
  s += '<span class="' + P + '-sp"></span>';
  s += '<span class="' + P + '-bench"' + tip({ title: 'База сравнения',
    text: 'Вся компания под теми же разрезами численности. Юнит на базу не влияет: снимите разрез — база расширится.',
    note: 'С базой сравниваются метрики без утверждённой цели.' }) + '>База: <b>' + esc(benchLabel()) + '</b></span>';
  return s + '</div>';
}
// Сколько ждём ответ и сколько шёл прошлый: «12 с · прошлый ответ — 14 с» (секундомер — БЛОК 6, раз в секунду).
function pendText() {
  if (!state.pend) return '';
  var sec = Math.floor((Date.now() - state.pend.at) / 1000);
  return (sec >= 2 ? sec + ' с' : '') + (state.lastResp > 1500 ? (sec >= 2 ? ' · ' : '') + 'прошлый ответ — ' + Math.round(state.lastResp / 1000) + ' с' : '');
}
function noticesHTML() {
  var P = CFG.ns, M = MODEL, s = '';
  if (state.pend) s += '<div class="' + P + '-load"><span>' + esc(CFG.text.loading) + ' <span data-pendt="1">' + esc(pendText()) + '</span></span><i></i></div>';
  if (state.warn) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(state.warn.replace('{s}', String(Math.round(CFG.pendingWarnMs / 1000)))) + '</div>';
  if (outOfZone()) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(CFG.text.outOfZone) + '</div>';
  if (M.cut) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(CFG.text.truncated.replace('{n}', fmtInt(M.rows))) + '</div>';
  var v = state.view || 'onepager';
  if (M.meta && M.meta.ret_base === 'active' && (v === 'onepager' || v === 'teams')) {
    s += '<div class="' + P + '-note ' + P + '-ninfo">Тип численности «Активная»: закрепляемость новичков считается от даты перехода в активную численность (active_hire_dt), а не от даты найма в компанию.</div>';
  }
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
  var d = { half: 460, side: 480, wide: 960 };
  return Math.max(260, state.cw[kind] || d[kind] || 480);
}
// Ориентир графика: цель, если она действует на последнем слоте; иначе база.
function refKind(unitId, m, g, i) {
  var s = MODEL.cal[g][i];
  if (resolveKpi(unitId, m.key, s ? s.e : '')) return 'kpi';
  return comparable(m) ? 'bench' : '';
}
function yoySpec(unitId, ser, m) {
  var M = MODEL, L = M.L, cur = [], prev = [], labels = [], heads = [], ref = null;
  for (var k = 0; k < 12; k++) {
    cur.push(12 + k <= L ? mval(ser, 'm', m, 12 + k) : null);
    prev.push(mval(ser, 'm', m, k));
    labels.push(MONTH_ABBR[dparts(M.cal.m[12 + k] ? M.cal.m[12 + k].s : '').m]);
    heads.push(monthFull(12 + k) + ' · к ' + monthDat(k));
  }
  var rk = refKind(unitId, m, 'm', L);
  if (rk === 'kpi') ref = targetSeries(unitId, m.key, 'm').slice(12, 24);
  else if (rk === 'bench') { ref = []; for (var b = 0; b < 12; b++) ref.push(12 + b <= L ? mval(M.base, 'm', m, 12 + b) : null); }
  var y = dparts(M.cal.m[L].s).y;
  return { m: m, labels: labels, cur: cur, prev: prev, ref: ref, refKind: rk, boldIdx: L - 12, heads: heads, prevHeads: null,
           curName: String(y), prevName: String(y - 1), refName: rk === 'kpi' ? 'цель' : 'база · ' + benchLabel(),
           tips: { cur: 'Значения ' + y + ' года на конец закрытых месяцев. Незакрытый месяц не показывается.',
                   prev: 'Те же месяцы ' + (y - 1) + ' года — с чем сравнивается «год к году».',
                   ref: rk === 'kpi' ? 'Цель юнита — своя или ближайшая выше по дереву — на каждый месяц.' : 'База — вся компания под теми же разрезами численности.' } };
}
function weekSpec(unitId, ser, m) {
  var M = MODEL, Lw = lastIdx('w'), cur = [], prev = [], labels = [], heads = [], prevHeads = [], ref = null;
  for (var k = 0; k < 12; k++) {
    var i = Lw - 11 + k;
    cur.push(mval(ser, 'w', m, i));
    prev.push(i - 12 >= 0 ? mval(ser, 'w', m, i - 12) : null);
    labels.push(weekTick(i));
    heads.push('Неделя ' + weekRange(i));
    prevHeads.push(i - 12 >= 0 ? weekRange(i - 12) : '—');
  }
  var rk = refKind(unitId, m, 'w', Lw);
  if (rk === 'kpi') ref = targetSeries(unitId, m.key, 'w').slice(Lw - 11, Lw + 1);
  else if (rk === 'bench') { ref = []; for (var b = 0; b < 12; b++) ref.push(mval(M.base, 'w', m, Lw - 11 + b)); }
  return { m: m, labels: labels, cur: cur, prev: prev, ref: ref, refKind: rk, boldIdx: 11, heads: heads, prevHeads: prevHeads,
           curName: 'последние 12 нед.', prevName: 'предыдущие 12', refName: rk === 'kpi' ? 'цель' : 'база · ' + benchLabel(),
           tips: { cur: 'Последние 12 закрытых недель (пн–вс). Окна недельных метрик — 13, 26 и 52 недели.',
                   prev: '12 недель перед ними — неделя к неделе на 12 назад.',
                   ref: rk === 'kpi' ? 'Цель юнита — своя или ближайшая выше по дереву.' : 'База — вся компания под теми же разрезами численности.' } };
}
// Заголовок графика — капитель серым (как «ПОЛЬЗОВАТЕЛИ ПО ПЕРИОДАМ» в Proteus Adoption),
// справа легенда-кнопки: клик выключает линию на всех графиках, наведение подсвечивает её.
function chartBlock(kind, key, title, spec, H) {
  var P = CFG.ns, C = CFG.colors;
  var items = [{ k: 'cur', l: spec.curName, c: C.cur }, { k: 'prev', l: spec.prevName, c: C.prev }];
  if (spec.ref) items.push({ k: 'ref', l: spec.refKind === 'kpi' ? 'цель' : 'база', c: spec.refKind === 'kpi' ? C.kpi : C.bench, dash: true });
  // Все линии графика выключены (их гасили на других графиках) — текущая рисуется всё равно (svgLine).
  var nOn = 0;
  for (var j = 0; j < items.length; j++) if (lineOn(items[j].k)) nOn++;
  var forced = nOn === 0, lg = '';
  if (forced) nOn = 1;
  for (var i = 0; i < items.length; i++) {
    var it = items[i], off = !lineOn(it.k) && !(forced && it.k === 'cur'), lock = !off && nOn <= 1;
    lg += '<button type="button" class="' + P + '-lg' + (off ? ' ' + P + '-off' : '') + '" data-action="lg" data-key="' + it.k + '" data-lgs="' + it.k + '" aria-pressed="' + (off ? 'false' : 'true') + '"' + (lock ? ' data-lock="1"' : '')
      + tip({ title: it.l, text: spec.tips ? spec.tips[it.k] : '', note: lock ? 'Последнюю линию выключить нельзя.' : (off ? 'Клик — вернуть линию на графики.' : 'Клик — убрать линию со всех графиков.') }) + '>'
      + '<i class="' + P + '-lgk' + (it.dash ? ' ' + P + '-dash' : '') + '" style="border-top-color:' + it.c + '"></i>' + esc(it.l) + '</button>';
  }
  return '<div class="' + P + '-chb" data-chb="1"><div class="' + P + '-chh"><span class="' + P + '-cap">' + esc(title) + '</span>'
    + '<span class="' + P + '-lgd" role="group" aria-label="Линии графика">' + lg + '</span></div>'
    + chartSlot(kind, key, function (w, ctx) { return svgLine(spec, w, H, ctx); }) + '</div>';
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
    tips.push({ title: monthFull(idx[k]), rows: rows, note: b.ref === null || b.ref === undefined ? 'Ориентира у метрики нет — цвет не ставится.' : STATE_TXT[states[k] || 'neutral'] });
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
        q: hInfo({ title: 'Юнит отчёта', text: 'Выбирается в шапке. От него считается наследование целей; для зоны из нескольких юнитов — от их общего предка.' }),
        row1: '<span class="' + P + '-ks">' + esc(lvl) + '</span>',
        row2: '<span class="' + P + '-ks">' + nC + ' ' + plural(nC, 'подразделение', 'подразделения', 'подразделений') + (M.single ? ' уровнем ниже' : ' в корнях зоны') + '</span>' })
    + kpiCard({ label: 'Сотрудников', value: fmtInt(hc), q: hInfo(moveTip(mv, hire, fire)),
        row1: '<span class="' + P + '-ks">на ' + esc(fmtDay(day)) + '</span>'
          + (mv ? '<span class="' + P + '-ks">за год <b class="' + P + '-mvn">' + esc(signed(mv.to - mv.from)) + '</b></span>' : ''),
        row2: mv ? '<span class="' + P + '-ks">найм ' + fmtInt(mv.hire) + ' · уходы ' + fmtInt(mv.fire) + ' · переводы ' + esc(signed(mv.other)) + '</span>'
          : '<span class="' + P + '-ks">разрез: ' + esc(selLabel()) + '</span>' })
    + kpiCard({ label: M.single ? 'Целей на юните' : 'Целей внутри зоны', value: String(own.length),
        q: hInfo({ title: 'Свои цели', text: 'Цели, поставленные на сам юнит (для зоны — на юниты внутри неё). Цель с разрезом видна, только когда выбран ровно этот разрез.' }),
        row1: live ? '<span class="' + P + '-tag ' + P + '-own">' + live + ' в фокусе сейчас</span>' : '<span class="' + P + '-ks">' + (own.length ? 'ни одна не подходит под разрезы' : 'своих целей нет') + '</span>',
        row2: '<span class="' + P + '-ks">реестр и новая цель — вкладка «Цели»</span>' })
    + kpiCard({ label: 'Наследуемых целей', value: String(inh),
        q: hInfo({ title: 'Наследование', text: 'Цель, поставленная выше по дереву, действует на всю ветку вниз, пока не встретится своя.' }),
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
function moveOf(ser) {
  var L = MODEL.L, a = ser && ser.m;
  if (!a || !a.hc || L < 12) return null;
  var from = a.hc[L - 12] || 0, to = a.hc[L] || 0, hire = 0, fire = 0, months = [];
  for (var i = L - 11; i <= L; i++) {
    var h = a.hire ? (a.hire[i] || 0) : 0, f = a.fire ? (a.fire[i] || 0) : 0;
    hire += h; fire += f; months.push({ i: i, h: h, f: f });
  }
  return { from: from, to: to, hire: hire, fire: fire, other: to - from - hire + fire, months: months };
}
function moveTip(mv, hire, fire) {
  var L = MODEL.L, t = { title: 'Численность и движение', text: 'Списочная численность на конец месяца под выбранными разрезами.' };
  if (!mv) { t.rows = [{ label: 'найм за месяц', value: '+' + fmtInt(hire) }, { label: 'увольнения за месяц', value: MINUS + fmtInt(fire) }]; return t; }
  var day0 = MODEL.cal.m[L - 12] ? MODEL.cal.m[L - 12].e : '';
  t.rows = [{ label: 'было' + (day0 ? ' на ' + fmtDay(day0) : ''), value: fmtInt(mv.from) }, { label: 'найм в компанию', value: '+' + fmtInt(mv.hire) },
    { label: 'увольнения из компании', value: MINUS + fmtInt(mv.fire) }, { label: 'переводы и прочее', value: signed(mv.other) },
    { label: 'стало', value: fmtInt(mv.to) }];
  for (var k = mv.months.length - 6; k < mv.months.length; k++) {
    var x = mv.months[k];
    t.rows.push({ label: monthLabel(x.i), value: '+' + fmtInt(x.h) + ' / ' + MINUS + fmtInt(x.f), dim: true });
  }
  t.note = ['«Переводы и прочее» — переходы между подразделениями, смена разреза (покраски, штата…) и правки структуры.', 'Ниже — найм и увольнения по последним 6 месяцам.'];
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
// «сверх цели ≈ 3,1», «до базы не хватает ≈ 2,4»: число — в конце, падеж не согласуется (≈ 3,1 — дробь).
function exPhrase(m, bl, ex) { return m.exA.replace('ориентира', refWord(bl)) + ' ' + fmtPeople(ex); }
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
// Один факт на метрику: юнит хуже ориентира (с командой, где отклонение сидит, и трендом) →
// иначе команды хуже ориентира → иначе ухудшение подряд → иначе юнит заметно лучше ориентира.
function metricFact(m, teams) {
  var M = MODEL, L = M.L, O = CFG.obs, small = smallHide(M.scope, m);
  var v = small ? null : mval(M.scope, 'm', m, L), bl = obsBase(scopeUnit(), m, v);
  var bt = badTeams(m, teams), tr = small ? null : worsening(m, M.scope), ab = small ? '' : absText(m, M.scope, L);
  var ex = bl ? excessPeople(m, M.scope, L, bl.ref) : 0, dir = m.better === 'higher';
  if (bl && bl.state === 'bad' && relDev(v, bl.ref) >= O.dev && ex >= O.minPeople) {
    var body = [(ab ? ab + ' · ' : '') + exPhrase(m, bl, ex)], rule = ['хуже ' + refWord(bl) + ' на ' + Math.round(O.dev * 100) + '% и больше'];
    if (bt.length && bt[0].ex >= O.conc * ex) {
      body.push(' · больше половины — ', { r: bt[0].r, mk: m.key }, ' (' + fmtPeople(bt[0].ex) + ')');
      rule.push('больше половины отклонения — в одной команде');
    } else if (bt.length) {
      body.push(' · больше всего — ', { r: bt[0].r, mk: m.key }, ' (' + fmtPeople(bt[0].ex) + ')');
      if (bt.length > 1) body.push(', ', { r: bt[1].r, mk: m.key }, ' (' + fmtPeople(bt[1].ex) + ')');
    }
    if (tr) { body.push(' · ' + trendWord(m) + ': ' + trendText(m, tr)); rule.push('ухудшение ' + O.trend + ' месяца подряд'); }
    body.push('.');
    return { sev: bl.kind === 'kpi' ? 'high' : 'mid', pri: 1, w: ex, body: body, rule: rule.join('; '),
      lead: m.name + ' ' + fmtVal(m, v) + ' — ' + (dir ? 'ниже ' : 'выше ') + refWord(bl) + ' ' + fmtVal(m, bl.ref) };
  }
  if (bt.length === 1) {
    var b1 = bt[0];
    return { sev: 'mid', pri: 2, w: b1.ex, rule: 'команда от ' + CFG.small.min + ' человек хуже своего ориентира на ' + O.teamMin + ' человека и больше',
      body: [fmtVal(m, b1.v) + ' при ' + (b1.bl.kind === 'kpi' ? 'цели ' : 'базе ') + fmtVal(m, b1.bl.ref) + ' · ' + exPhrase(m, b1.bl, b1.ex) + ' · ',
             { r: b1.r, mk: m.key, t: 'открыть в «Командах»' }],
      lead: m.name + ': ' + qName(b1.r) + ' хуже ' + refWord(b1.bl) };
  }
  if (bt.length) {
    var tb = [], w = 0;
    for (var i = 0; i < bt.length && i < 3; i++) {
      // Первая команда — с полной подписью «≈ 1,2 новичков ушло сверх базы», дальше — только число.
      tb.push(i ? '; ' : '', { r: bt[i].r, mk: m.key }, ' — ' + fmtVal(m, bt[i].v) + ' при ' + (bt[i].bl.kind === 'kpi' ? 'цели ' : 'базе ') + fmtVal(m, bt[i].bl.ref)
        + ' (' + (i ? fmtPeople(bt[i].ex) : exPhrase(m, bt[i].bl, bt[i].ex)) + ')');
      w += bt[i].ex;
    }
    tb.push(bt.length > 3 ? '; и ещё ' + (bt.length - 3) + '.' : '.');
    return { sev: 'mid', pri: 2, w: w, body: tb, rule: 'команда от ' + CFG.small.min + ' человек хуже своего ориентира на ' + O.teamMin + ' человека и больше',
      lead: m.name + ': ' + bt.length + ' ' + plural(bt.length, 'команда', 'команды', 'команд') + ' хуже ориентира' };
  }
  if (tr) {
    return { sev: 'mid', pri: 3, w: 0, rule: 'ухудшение ' + O.trend + ' месяца подряд, за них — на ' + Math.round(O.dev * 100) + '% и больше',
      body: [capFirst(trendText(m, tr)) + (bl ? ' · ' + (bl.kind === 'kpi' ? 'цель ' : 'база ') + fmtVal(m, bl.ref) : '') + '.'],
      lead: m.name + ': ' + trendWord(m) };
  }
  // Хороший факт по причинам увольнений не ставим, пока есть что заполнять (задача — отдельным фактом).
  var todo = m.num === 'nr' && M.scope.m.nr && (M.scope.m.nr[L] || 0) > 0;
  if (bl && bl.state === 'good' && relDev(v, bl.ref) >= O.dev && !todo) {
    return { sev: 'good', pri: 1, w: -ex, body: [ab ? endDot(ab) : ''], rule: 'лучше ' + refWord(bl) + ' на ' + Math.round(O.dev * 100) + '% и больше',
      lead: m.name + ' ' + fmtVal(m, v) + ' — ' + (dir ? 'выше ' : 'ниже ') + refWord(bl) + ' ' + fmtVal(m, bl.ref) };
  }
  return null;
}
// Увольнения из компании за недели a…b (поток недели, без окна).
function weekFire(ser, a, b) {
  var f = ser && ser.w ? ser.w.fire : null, n = 0;
  if (!f) return 0;
  for (var i = a; i <= b; i++) n += f[i] || 0;
  return n;
}
// Всплеск уходов: последние spikeWeeks недель против обычного темпа (среднее предыдущих недель).
function exitSpike(ser) {
  var W = lastIdx('w'), O = CFG.obs, n = O.spikeWeeks;
  if (W < n * 2) return null;
  var last = weekFire(ser, W - n + 1, W), usual = weekFire(ser, 0, W - n) / (W - n + 1) * n;
  if (last < O.spikeMin || last < O.spikeX * usual) return null;
  return { last: last, usual: usual, a: W - n + 1, b: W };
}
function obsFacts() {
  var M = MODEL, L = M.L, O = CFG.obs, all = teamRows(true), teams = [], leaves = [], out = [], i;
  for (i = 0; i < all.length; i++) {
    if (!isSmall(all[i].ser)) teams.push(all[i]);
    if (all[i].id === '·' || !rowCanExp(all[i])) leaves.push(all[i]);
  }
  var mets = selMetrics('');
  for (i = 0; i < mets.length; i++) if (mets[i].exL) { var f = metricFact(mets[i], teams); if (f) out.push(f); }
  function topLeaves(get, k) {
    var t = [], segs = [];
    for (var j = 0; j < leaves.length; j++) { var c = get(leaves[j]); if (c > 0) t.push({ r: leaves[j], n: c }); }
    t.sort(function (x, y) { return y.n - x.n || (rowName(x.r) < rowName(y.r) ? -1 : 1); });
    for (var q = 0; q < t.length && q < k; q++) segs.push(q ? ', ' : '', { r: t[q].r, mk: '' }, ' — ' + fmtInt(t[q].n));
    if (t.length > k) segs.push(' и ещё ' + (t.length - k));
    return segs;
  }
  var sp = exitSpike(M.scope);
  if (sp) {
    var nw = sp.b - sp.a + 1, tl = topLeaves(function (r) { return weekFire(r.ser, sp.a, sp.b); }, 3);
    out.push({ sev: sp.last >= 3 * sp.usual ? 'high' : 'mid', pri: 0, w: sp.last - sp.usual,
      lead: 'Всплеск уходов: ' + fmtInt(sp.last) + ' за ' + nw + ' ' + plural(nw, 'неделю', 'недели', 'недель') + ' — обычно ' + (sp.usual < 1 ? 'меньше 1' : 'около ' + fmtInt(sp.usual)),
      body: (tl.length ? ['Больше всего: '].concat(tl, ['. ']) : []).concat(['Месячная текучесть считается окном в 12 месяцев — свежий всплеск в ней почти не виден.']),
      rule: 'увольнений за ' + nw + ' ' + plural(nw, 'неделю', 'недели', 'недель') + ' в ' + O.spikeX + ' раза больше обычного темпа и не меньше ' + O.spikeMin });
  }
  var nr = !state.metricOff.exit_reasons && M.scope.m.nr ? (M.scope.m.nr[L] || 0) : 0;
  if (nr) {
    var rl = topLeaves(function (r) { return r.ser.m.nr ? (r.ser.m.nr[L] || 0) : 0; }, 4);
    out.push({ sev: 'mid', pri: 4, w: nr,
      lead: fmtInt(nr) + ' ' + plural(nr, 'увольнение', 'увольнения', 'увольнений') + ' без причины за 3 мес',
      body: (rl.length ? ['Заполнить в кадровой системе: '].concat(rl, ['. ']) : []).concat(['Кто именно — в отчёте «Детальные списки».']),
      rule: 'причина не проставлена через 30 и больше дней после увольнения' });
  }
  var mv = moveOf(M.scope);
  if (mv && mv.from && Math.abs(mv.to - mv.from) / mv.from >= O.hc) {
    var dp = Math.round(Math.abs(mv.to - mv.from) / mv.from * 100);
    out.push({ sev: 'mid', pri: 5, w: 0,
      lead: 'Численность ' + (mv.to > mv.from ? '+' : MINUS) + dp + '% за год: ' + fmtInt(mv.from) + ' → ' + fmtInt(mv.to),
      body: ['Найм ' + fmtInt(mv.hire) + ', уходы ' + fmtInt(mv.fire) + ', переводы и прочее ' + signed(mv.other) + '.'],
      rule: 'изменение численности за год на ' + Math.round(O.hc * 100) + '% и больше' });
  }
  // Важность, затем тип факта (pri: всплеск · юнит · команды · тренд · причины · численность), затем люди.
  var rank = { high: 0, mid: 1, good: 2 };
  out.sort(function (a, b) { return rank[a.sev] - rank[b.sev] || a.pri - b.pri || b.w - a.w; });
  return out.slice(0, O.max);
}
// Одна строка: важность, главный факт, «Ещё N ▾» (или «Подробнее ▾»); список растёт вниз.
var SEV_CLS = { high: '-sevh', mid: '-sevm', good: '-sevg' };
function obsHTML() {
  var P = CFG.ns, O = CFG.obs, list = obsFacts();
  var info = hInfo({ title: 'Что видно в данных', text: 'Только факты, которые прошли пороги. Нет фактов — метрики в пределах обычного разброса.',
    rows: [{ label: 'хуже или лучше цели, базы', value: 'от ' + Math.round(O.dev * 100) + '%' }, { label: 'сверх ориентира у команды', value: 'от ' + O.teamMin + ' чел.' },
           { label: 'отклонение в одной команде', value: 'от ' + Math.round(O.conc * 100) + '%' }, { label: 'ухудшение подряд', value: O.trend + ' мес.' },
           { label: 'всплеск уходов за ' + O.spikeWeeks + ' нед.', value: '×' + O.spikeX + ', от ' + O.spikeMin + ' чел.' }, { label: 'численность за год', value: '±' + Math.round(O.hc * 100) + '%' }],
    note: 'Команды — три уровня ниже юнита отчёта; меньше ' + CFG.small.min + ' человек не оцениваются. Отклонение — в людях: сколько уходов, новичков, увольнений без причины сверх ориентира.' });
  if (!list.length) {
    return '<div class="' + P + '-obs"><div class="' + P + '-obs-h"><span class="' + P + '-obs-ico" aria-hidden="true">✓</span>'
      + '<span class="' + P + '-obs-t">Что видно в данных</span>' + info
      + '<span class="' + P + '-obs-lead">Отклонений выше порогов нет: метрики в пределах обычного разброса.</span></div></div>';
  }
  var o = list[0], open = !!state.obsOpen;
  var h = '<div class="' + P + '-obs ' + P + SEV_CLS[o.sev] + '"><div class="' + P + '-obs-h">'
    + '<span class="' + P + '-obs-ico" aria-hidden="true">' + (o.sev === 'good' ? '✓' : '!') + '</span>'
    + '<span class="' + P + '-obs-t">Что видно в данных</span>' + info
    + (open ? '<span class="' + P + '-obs-lead"></span>' : '<span class="' + P + '-obs-lead"' + tip({ title: o.lead, text: segsText(o.body), note: 'Отбор по порогу: ' + o.rule }) + '>' + esc(o.lead) + '</span>')
    + '<button type="button" class="' + P + '-obs-tog" data-action="obs" aria-expanded="' + open + '">'
    + (open ? 'Свернуть ▴' : (list.length > 1 ? 'Ещё ' + (list.length - 1) + ' ▾' : 'Подробнее ▾')) + '</button></div>';
  if (open) {
    h += '<ul class="' + P + '-obs-list">';
    for (var i = 0; i < list.length; i++) {
      h += '<li class="' + P + '-obs-li"><i class="' + P + '-obs-dot ' + P + SEV_CLS[list[i].sev] + '"' + tip({ title: list[i].lead, text: 'Отбор по порогу: ' + list[i].rule }) + '></i>'
        + '<div><b>' + esc(list[i].lead) + '.</b> <span>' + segsHTML(list[i].body) + '</span></div></li>';
    }
    h += '</ul>';
  }
  return h + '</div>';
}
// Метрики, строки которых раскрыты на «Сводке» (раскрыть можно несколько сразу).
function opOpen(mk) { return !!state.openM[mk]; }
function onepagerHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, u = scopeUnit();
  var s = pageHead('Сводка', crumbsHTML() + '<span class="' + CFG.ns + '-ldm"> · ' + esc(monthLow(L)) + ' · ' + esc(selLabel()) + '</span>'
    + hInfo({ title: 'Как читать сводку', text: 'Значение метрики за последний закрытый месяц сравнивается с ориентиром: с целью, если она утверждена (своя или унаследованная сверху), иначе — с базой.',
              rows: [{ label: 'база', value: benchLabel() }],
              note: ['База собирается из тех же разрезов численности, но по всей компании.', 'Клик по строке раскрывает динамику: год к году и 12 недель. Раскрыть можно несколько строк.'] }));
  if (!M.scope) return s + hEmpty('Нет данных по выбранным разрезам', 'Под текущими разрезами в выбранном юните нет сотрудников за два года. Снимите один из разрезов: × у его чипа над отчётом.');
  if (!selMetrics('').length) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики: «Фильтры» → «Что показывать».');
  var smallScope = isSmall(M.scope), gatedOn = false;
  for (var g0 = 0; g0 < CFG.small.blocks.length; g0++) if (selMetrics(CFG.small.blocks[g0]).length) gatedOn = true;
  s += kpiCardsHTML() + obsHTML()
    + (smallScope && gatedOn ? '<div class="' + P + '-note ' + P + '-ninfo ' + P + '-gap">В юните ' + fmtInt(hcOf(M.scope)) + ' ' + plural(hcOf(M.scope), 'человек', 'человека', 'человек')
      + ' — меньше ' + CFG.small.min + ': закрепляемость и текучесть не оцениваются, под прочерком — сколько это людей. Оценка — у юнита уровнем выше.</div>' : '')
    + legendHTML(true, smallScope && gatedOn);
  var any = false;
  for (var b = 0; b < CFG.blocks.length; b++) {
    var blk = CFG.blocks[b], mets = selMetrics(blk.key), items = [];
    for (var i = 0; i < mets.length; i++) {
      var m = mets[i], v = mval(M.scope, 'm', m, L), bl = baseline(u, m, v, 'm', L);
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
      var it = items[k], mk = it.m.key, sm = smallHide(M.scope, it.m), open = !sm && opOpen(mk);
      if (open) nOpen++;
      if (!sm) nExp++;
      var hid = hiddenRules(u, mk);
      if (it.bl.kind === 'kpi' && it.bl.inherited) {
        var more = hiddenRules(it.bl.owner, mk);
        for (var h = 0; h < more.length; h++) if (hid.indexOf(more[h]) < 0) hid.push(more[h]);
      }
      var calc = it.m.calc + (it.m.num === 'r3n' || it.m.num === 'r6n' ? (M.meta.ret_base === 'active' ? ' Сейчас база — active_hire_dt.' : '') : '');
      var name = '<span class="' + P + '-rb">' + esc(it.m.name) + hInfo({ title: it.m.name, text: it.m.hint, note: calc })
        + focusTag(it.m, it.bl) + moreFocus(hid, false) + '<span class="' + P + '-us">' + dirText(it.m) + '</span></span>';
      var ab = absText(it.m, M.scope, L), abH = ab ? '<span class="' + P + '-us ' + P + '-abs">' + esc(ab) + '</span>' : '';
      // Юнит меньше CFG.small.min человек: процента, цвета, динамики нет — только сколько это людей.
      if (sm) {
        var why = tip({ title: it.m.name, text: smallWhy(M.scope), rows: absRows(it.m, M.scope, L) });
        rows += '<tr class="' + P + '-row ' + P + '-smr" data-key="' + mk + '">'
          + '<td class="' + P + '-l"><span class="' + P + '-rl"><span class="' + P + '-cars"></span>' + name + '</span></td>'
          + '<td class="' + P + '-lead ' + P + '-muted"' + why + '>—' + abH + '</td>'
          + '<td class="' + P + '-vs"' + why + '><span class="' + P + '-nocmp">мало людей</span></td>'
          + '<td class="' + P + '-muted"' + why + '>—</td><td class="' + P + '-muted"' + why + '>—</td>'
          + '<td class="' + P + '-spk"' + why + '><span class="' + P + '-ks">меньше ' + CFG.small.min + ' чел.</span></td></tr>';
        continue;
      }
      rows += '<tr class="' + P + '-row' + (open ? ' ' + P + '-opn' : '') + '" data-action="openm" data-key="' + mk + '" aria-expanded="' + (open ? 'true' : 'false') + '">'
        + '<td class="' + P + '-l"><span class="' + P + '-rl">' + hCaret(open, 'openm', mk, open ? 'Скрыть динамику' : 'Показать динамику')
        + name + '</span></td>'
        + '<td class="' + P + '-lead">' + esc(fmtVal(it.m, it.v)) + abH + '</td>'
        + cmpTd(it.m, it.v, it.bl)
        + deltaTd(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 1)), 'Сравнение с предыдущим месяцем (' + monthLow(L - 1) + ').')
        + deltaTd(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 12)), 'Сравнение с тем же месяцем прошлого года (' + monthLow(L - 12) + ').')
        + '<td class="' + P + '-spk">' + sparkHTML(u, M.scope, it.m) + '</td></tr>';
      if (open) {
        rows += '<tr class="' + P + '-det"><td colspan="6"><div class="' + P + '-dsplit">'
          + '<div class="' + P + '-dcol">' + chartBlock('half', 'op:' + mk + ':yoy:' + u, 'Год к году', yoySpec(u, M.scope, it.m), CFG.chart.h) + '</div>'
          + '<div class="' + P + '-dcol">' + chartBlock('half', 'op:' + mk + ':wow:' + u, '12 недель к предыдущим 12', weekSpec(u, M.scope, it.m), CFG.chart.h) + '</div>'
          + '</div></td></tr>';
      }
    }
    var allOpen = nExp > 0 && nOpen === nExp;
    var tbl = '<table class="' + P + '-t ' + P + '-fix ' + P + '-op"><colgroup><col style="width:30%"><col style="width:10%"><col style="width:15%">'
      + '<col style="width:11%"><col style="width:11%"><col style="width:23%"></colgroup>'
      + '<thead><tr><th class="' + P + '-l"><span class="' + P + '-rl">'
      + (nExp ? hCaret(allOpen, 'openall', blk.key, allOpen ? 'Свернуть все' : 'Раскрыть все', { title: allOpen ? 'Свернуть все' : 'Раскрыть все', text: 'Динамика всех метрик блока — год к году и 12 недель.' }) : '<span class="' + P + '-cars"></span>')
      + '<span class="' + P + '-rb">Метрика</span></span></th><th>Значение<span class="' + P + '-hc">' + esc(monthFull(L)) + '</span></th>'
      + '<th class="' + P + '-vs">Ориентир<span class="' + P + '-hc">цель или база</span></th>'
      + '<th>Изменение<span class="' + P + '-hc">к ' + esc(monthDat(L - 1)) + '</span></th>'
      + '<th>Год к году<span class="' + P + '-hc">к ' + esc(monthDat(L - 12)) + '</span></th>'
      + '<th class="' + P + '-c">12 мес<span class="' + P + '-hc">точка — к ориентиру месяца</span></th></tr></thead><tbody>' + rows + '</tbody></table>';
    s += '<div class="' + P + '-gap">' + hPanel({ title: blk.name, sub: blk.hint, body: tbl, tbl: true }) + '</div>';
  }
  if (!any) s += hEmpty('Под фильтром «Только фокусные» метрик не осталось', 'На этом юните и выше по ветке целей по выбранным метрикам нет. Выключите тумблер или поставьте цель — вкладка «Цели».');
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
      var va = smallHide(a.ser, m) ? null : mval(a.ser, 'm', m, L), vb = smallHide(b.ser, m) ? null : mval(b.ser, 'm', m, L);
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
  if (smallHide(ser, m)) return smallTd(m, ser, cls);
  if (v === null) return '<td class="' + P + '-muted' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</td>';
  var bl = baseline(unitId, m, v, 'm', L), fact = [{ label: 'факт', value: txt }].concat(absRows(m, ser, L));
  if (bl.kind === 'none') return '<td' + c + tip({ title: m.name, text: 'Ориентира у метрики нет: ' + (m.better === 'flat' ? '«больше» не значит «лучше».' : 'абсолютная величина.'), rows: fact }) + '>' + esc(txt) + '</td>';
  var t = bl.kind === 'kpi'
    ? { title: m.name, text: bl.inherited ? 'Цель унаследована с уровня «' + unitName(MODEL, bl.owner) + '».' : 'Цель стоит на этом юните.',
        rows: fact.concat([{ label: 'цель', value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.kpi }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }]),
        note: STATE_TXT[bl.state] }
    : { title: m.name, text: 'Утверждённой цели нет — сравнение с базой.',
        rows: fact.concat([{ label: benchLabel(), value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.bench }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }]),
        note: STATE_TXT[bl.state] };
  return '<td' + c + tip(t) + '>' + hPill(bl.state, txt)
    + (selected ? '<span class="' + P + '-cref">' + (bl.kind === 'kpi' ? 'цель ' : 'база ') + esc(fmtVal(m, bl.ref)) + '</span>' : '') + '</td>';
}
// Маленькая команда: прочерк без цвета, в подсказке — почему и сколько это людей.
function smallWhy(ser) {
  var n = hcOf(ser);
  return 'Не оценивается: в команде ' + fmtInt(n) + ' ' + plural(n, 'человек', 'человека', 'человек') + ' — меньше ' + CFG.small.min
    + '. На такой команде один человек сдвигает процент на несколько пунктов.';
}
function smallTd(m, ser, cls) {
  var P = CFG.ns;
  return '<td class="' + P + '-muted ' + P + '-sm0' + (cls ? ' ' + cls : '') + '"' + tip({ title: m.name, text: smallWhy(ser), rows: absRows(m, ser, MODEL.L) }) + '>—</td>';
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
    + tip({ title: 'Открыть юнит', text: 'Отчёт переключится на «' + nm + '»: сводка, команды (3 уровня ниже него) и цели — по нему.', note: 'Вернуться — «← Назад» или путь над таблицей.' }) + '>' + OPEN_SVG + '</button>';
}
// Кнопка раскладки «таблица | динамика» в шапке панели: во всю ширину / вернуть обе.
var EXPAND_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>';
var SHRINK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10h-6V4M4 14h6v6M14 10l7-7M10 14l-7 7"/></svg>';
function splitBtn(side) {
  var P = CFG.ns, mode = state.splitMode || 'both';
  if (state.narrow) return '';
  var wide = mode === side, lbl = wide ? 'Вернуть ' + (side === 'table' ? 'динамику' : 'таблицу') + ' рядом' : (side === 'table' ? 'Таблица' : 'Динамика') + ' во всю ширину';
  return '<button type="button" class="' + P + '-ib' + (wide ? ' ' + P + '-on' : '') + '" data-action="split" data-key="' + (wide ? 'both' : side) + '" aria-label="' + esc(lbl) + '"'
    + tip({ title: lbl, text: wide ? 'Две колонки: таблица слева, графики справа.' : 'Ширину колонок можно и тянуть — за разделитель между ними; двойной клик возвращает как было.' }) + '>'
    + (wide ? SHRINK_SVG : EXPAND_SVG) + '</button>';
}
// Свёрнутая колонка — узкая полоса с подписью: клик возвращает обе колонки.
function splitRail(label, arrow) {
  var P = CFG.ns;
  return '<button type="button" class="' + P + '-rail" data-action="split" data-key="both" aria-label="Показать: ' + esc(label) + '"'
    + tip({ title: label, text: 'Вернуть две колонки: таблица слева, графики справа.' }) + '><i>' + arrow + '</i><span>' + esc(label) + '</span></button>';
}
// Путь юнита отчёта над таблицей: предки внутри зоны кликабельны — переход сразу, как
// по кнопке «Открыть юнит»; «↑» — уровнем выше, «← Назад» — к юниту до последнего перехода.
function crumbsHTML() {
  var P = CFG.ns, M = MODEL, parts = [], hz = hzNow(), h = hz ? M.hBy[hz] : null;
  function cb(key, id, name, tipText) {
    return '<button type="button" class="' + P + '-crb" data-action="crumb" data-key="' + key + '" data-id="' + esc(id) + '"'
      + tip({ title: 'Перейти: ' + name, text: tipText || 'Сводка, команды и цели — по этому юниту.' }) + '>' + esc(name) + '</button>';
  }
  var nav = '', up = null;
  if (state.unitBack && state.unitBack.length) {
    var prev = state.unitBack[state.unitBack.length - 1];
    nav += '<button type="button" class="' + P + '-nb" data-action="back"' + tip({ title: 'Назад', text: 'Вернуться к «' + unitsLabel(prev, '') + '» — юниту до последнего перехода.' }) + '>← Назад</button>';
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
  return '<th class="' + P + '-sth' + (cls ? ' ' + cls : '') + (on ? ' ' + P + '-son' : '') + '"' + (extra || '') + ' data-action="tsort" data-key="' + key + '" aria-sort="'
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
  for (var h = 0; h < mets.length; h++) t += sortTh(mets[h].key, mets[h].short, gcls[mets[h].key] || '', { title: mets[h].name, text: mets[h].hint });
  t += '</tr></thead><tbody>';
  t += '<tr class="' + P + '-row ' + P + '-tot' + (!sel ? ' ' + P + '-sel' : '') + '" data-action="team" data-key="">'
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
    t += '<tr class="' + P + '-row' + (row.lvl >= 2 ? ' ' + P + '-lv2' : '') + (isSel ? ' ' + P + '-sel' : '') + (tc.sr ? ' ' + P + (hit ? '-fnd' : '-anc') : '') + '" data-action="team" data-key="' + esc(row.key) + '">'
      + '<td class="' + P + '-l"><span class="' + P + '-rl">' + ind
      + (canExp && !tc.sr ? hCaret(open, 'exp', row.pfx, 'Раскрыть детализацию', { title: 'Детализация', text: 'Юниты уровнем ниже внутри «' + unitName(M, row.id) + '».' }) : '<span class="' + P + '-cars"></span>')
      + '<span class="' + P + '-rb"><span class="' + P + '-nml"><span class="' + P + '-nm"' + nmTip + '>' + (row.id !== '·' && tc.tq ? hlText(rowName(row), tc.tq) : esc(rowName(row))) + '</span>'
      + (nOwn ? '<span class="' + P + '-tag ' + P + '-own"' + tip({ title: 'Фокус юнита', text: 'Цели установлены на этом юните и уходят вниз по всей его ветке.', rows: [{ label: 'целей в фокусе', value: String(nOwn) }] }) + '>★ Фокус</span>' : '')
      + moreFocus(hidOwn, true)
      + (unit && !unit.cur ? '<span class="' + P + '-gone">нет в структуре</span>' : '') + '</span>'
      + '<span class="' + P + '-us">' + (unit ? esc(levelShort(unit.lvl)) + ' · ' : '') + fmtInt(hcOf(row.ser)) + ' чел'
      + (below ? ' · <span class="' + P + '-below"' + tip({ title: 'Ниже ещё ' + below + ' ' + plural(below, 'подразделение', 'подразделения', 'подразделений'),
          text: 'Таблица показывает 3 уровня вниз. Глубже — выберите строку и откройте её юнит иконкой у правого края.' }) + '>ниже ещё ' + below + '</span>' : '')
      + '</span></span>' + drill + '</span></td>';
    for (var mm = 0; mm < mets.length; mm++) t += unitCell(uid, row.ser, mets[mm], isSel, gcls[mets[mm].key]);
    t += '</tr>';
  }
  if (!rows.length) {
    t += '<tr><td class="' + P + '-l" colspan="' + (mets.length + 1) + '"><span class="' + P + '-muted">'
      + (tc.tq ? 'Юнитов с «' + esc(state.tq) + '» среди ' + tc.sr.total + ' загруженных нет.' + ' Таблица ищет в трёх уровнях вниз; по всей зоне — поиск в фильтре «Юнит».'
        : (state.focusOnly ? 'Под фильтром «Только фокусные» юнитов не осталось: ни по одной показанной метрике своих целей здесь нет.' : 'У выбранного юнита нет подразделений уровнем ниже под текущими разрезами.'))
      + '</span></td></tr>';
  }
  return t + '</tbody></table>';
}
function teamsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L;
  var s = pageHead('Команды', crumbsHTML() + '<span class="' + P + '-ldm"> · ' + (M.depth === 'all' ? 'все уровни вниз' : 'на 3 уровня вниз') + ' · ' + esc(monthLow(L)) + '</span>');
  var tc = teamsCtx();
  if (tc.live.length === 1) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики: «Фильтры» → «Что показывать».');
  s += '<div class="' + P + '-tools">' + hSubs(tc.live, tc.blk, 'block') + '<span class="' + P + '-sp2"></span>'
    + '<span class="' + P + '-dhint"' + tip({ title: 'Глубина — 3 уровня', text: 'Таблица показывает три уровня вниз от юнита отчёта. Глубже: выберите строку и нажмите иконку «Открыть юнит» у её правого края — отчёт встанет на этот юнит, и ниже откроются следующие три уровня.' })
    + '>Глубина — 3 уровня · глубже: выберите строку и откройте юнит ' + OPEN_SVG + '</span></div>';
  if (!M.scope) return s + hEmpty('Нет данных по выбранным разрезам', 'Снимите один из разрезов: × у его чипа над отчётом.');
  var sel = tc.sel, mets = tc.mets;
  var cur = sel || { lvl: 0, id: '', ser: M.scope, key: '' };
  var cu = sel ? rowUnit(sel) : scopeUnit(), dyn = state.dyn === 'wow' ? 'wow' : 'yoy', charts = '', gated = 0;
  for (var cm = 0; cm < mets.length; cm++) {
    if (smallHide(cur.ser, mets[cm])) { gated++; continue; }
    var spec = dyn === 'wow' ? weekSpec(cu, cur.ser, mets[cm]) : yoySpec(cu, cur.ser, mets[cm]);
    charts += chartBlock('side', 'tm:' + mets[cm].key + ':' + dyn + ':' + cu + ':' + cur.key, mets[cm].name, spec, CFG.chart.hSmall);
  }
  var right = '<div class="' + P + '-dyn">'
    + (gated ? '<div class="' + P + '-snote">' + esc(smallWhy(cur.ser)) + ' Графиков закрепляемости и текучести по ней нет.</div>' : '') + charts + '</div>';
  var info = hInfo({ title: 'Как читать таблицу', text: 'Значения — за ' + monthLow(L) + '. Цвет — к ориентиру юнита: к цели (своей или ближайшей выше по дереву), иначе к базе «' + benchLabel() + '».',
    note: ['Клик по строке — её графики справа. «Открыть юнит» у выбранной строки делает её юнитом отчёта; вернуться — «← Назад» или путь над таблицей.', 'Клик по заголовку колонки — сортировка. «Напрямую в …» — сотрудники самого юнита, а не его подразделений.'] });
  var mode = state.narrow ? 'both' : (state.splitMode || 'both');
  var search = '<span class="' + P + '-tsw">' + SEARCH_SVG + '<input class="' + P + '-srch" type="text" data-tsearch="1" placeholder="Поиск юнита в таблице" value="' + esc(state.tq || '') + '"></span>';
  var left = hPanel({ cls: P + '-tpan', title: 'Юниты', info: info, sub: 'клик по строке — графики справа и ориентиры под значениями',
    body: '<div data-tbox="1">' + teamsTableHTML(tc) + '</div>', tbl: true, tabs: '<span class="' + P + '-pbtn">' + search + copyBtn('teams') + splitBtn('table') + '</span>' });
  var subTxt = sel ? rowName(sel) : 'ИТОГО · ' + scopeLabel();
  var subHtml = '<span' + tip({ title: subTxt, text: 'Графики — по этой строке таблицы.' }) + '>' + esc(subTxt) + '</span>';
  var rightP = hPanel({ cls: P + '-dpan', title: 'Динамика', subHtml: subHtml, body: right,
    tabs: '<span class="' + P + '-pbtn">' + (sel && sel.id !== '·' ? drillBtn(sel.id) : '') + hSubs([['yoy', 'Год'], ['wow', '12 недель']], dyn, 'dyn') + splitBtn('charts') + '</span>' });
  var sh = state.split || CFG.split.def;
  s += legendHTML(false, true);
  if (mode === 'table') s += '<div class="' + P + '-split ' + P + '-sp1">' + left + splitRail('Динамика', '◂') + '</div>';
  else if (mode === 'charts') s += '<div class="' + P + '-split ' + P + '-sp2c">' + splitRail('Юниты', '▸') + rightP + '</div>';
  else {
    s += '<div class="' + P + '-split" data-split-box="1" style="grid-template-columns:' + splitCols(sh) + '">' + left
      + '<div class="' + P + '-gut" data-split="1" role="separator" aria-orientation="vertical" aria-label="Ширина таблицы" aria-valuemin="' + Math.round(CFG.split.min * 100)
      + '" aria-valuemax="' + Math.round(CFG.split.max * 100) + '" aria-valuenow="' + Math.round(sh * 100) + '" tabindex="0"'
      + tip({ title: 'Ширина колонок', text: 'Потяните, чтобы дать больше места таблице или графикам. Двойной клик — как было; стрелки ← → — с клавиатуры.' }) + '><i></i></div>'
      + rightP + '</div>';
  }
  return s;
}
function splitCols(sh) {
  return state.narrow ? 'minmax(0,1fr)' : 'minmax(0,' + (sh * 100).toFixed(2) + 'fr) 12px minmax(0,' + ((1 - sh) * 100).toFixed(2) + 'fr)';
}

// ---- копирование таблиц «Команд» и «Трансформеров» в буфер (TSV — вставляется в Excel) ----
// Числа — без «%», с запятой; у маленькой команды закрепляемость и текучесть — пустые ячейки.
var COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
function copyBtn(kind) {
  var P = CFG.ns;
  return '<button type="button" class="' + P + '-ib" data-action="copy" data-key="' + kind + '" aria-label="Копировать таблицу"'
    + tip({ title: 'Копировать таблицу', text: kind === 'teams' ? 'Все три уровня — в буфер обмена: вставьте в Excel или письмо.' : 'Сводная по оси — в буфер обмена: вставьте в Excel или письмо.',
            note: 'Числа — без «%», с запятой.' + (kind === 'teams' ? ' У команд меньше ' + CFG.small.min + ' человек закрепляемость и текучесть — пустые.' : '') }) + '>' + COPY_SVG + '</button>';
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
    for (var k = 0; k < mets.length; k++) a.push(smallHide(ser, mets[k]) ? '' : tsvNum(mets[k], mval(ser, 'm', mets[k], L)));
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
function transformHTML() {
  var P = CFG.ns, M = MODEL, L = M.L;
  var s = pageHead('Трансформеры', 'Сводная таблица метрики по оси за 12 месяцев. Юнит и разрезы — из «Фильтров», здесь выбирается ось: разрез численности или атрибут сотрудника на конец месяца (грейд, стаж, возраст, город…).');
  var avail = selMetrics('');
  if (!avail.length) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики: «Фильтры» → «Что показывать».');
  var m = avail[0];
  for (var a = 0; a < avail.length; a++) if (avail[a].key === state.tfMetric) m = avail[a];
  var axis = wantAxis(), mOpts = [], aOpts = [];
  for (var i = 0; i < avail.length; i++) mOpts.push([avail[i].key, avail[i].name]);
  for (var j = 0; j < CFG.axes.length; j++) aOpts.push([CFG.axes[j].key, CFG.axes[j].label]);
  s += '<div class="' + P + '-tools">'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('tfm', mOpts, m.key) + '</div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Ось разбивки</span>' + hSel('tfa', aOpts, axis) + '</div>'
    + '</div>';
  // Все 17 осей приезжают с каждым ответом — смена оси мгновенная. Запасной режим датасета
  // (TR_ALL_MAX): у большой ветки с разрезами атрибут догружается один раз по запросу.
  if (!axisReady(axis)) {
    if (state.pend) return s + hEmpty('Загружаю разбивку «' + axisLabel(axis) + '»', 'Ветка большая и выбраны разрезы: атрибуты по ней считаются отдельным запросом, один раз.');
    return s + hEmpty('Разбивка «' + axisLabel(axis) + '» ещё не загружена', 'Ветка большая и выбраны разрезы: атрибуты по ней считаются отдельным запросом. Нажмите «Загрузить».')
      + '<div class="' + P + '-tnote"><button class="' + P + '-btn ' + P + '-pri" data-action="axis" data-key="' + esc(axis) + '">Загрузить</button></div>';
  }
  var list = trSorted(axis), months = [];
  if (!list.length || !M.scope) return s + hEmpty('Нет данных для разбивки', 'Под текущими разрезами в выбранном юните нет сотрудников.');
  for (var k = L - 11; k <= L; k++) months.push(k);
  // Что тянет метрику: значения оси, которые сильнее всего уводят её хуже ориентира юнита (цели или
  // базы) в последнем месяце — в людях (excessPeople). До 3 значений от CFG.obs.minPeople; у
  // удержания и текучести — только от CFG.small.min человек, как у команд. «Остальные» не помечаются.
  var vS = mval(M.scope, 'm', m, L), blS = vS === null ? null : baseline(scopeUnit(), m, vS, 'm', L), pull = {}, pulls = [];
  if (blS && blS.ref !== null && m.exL) {
    for (var q = 0; q < list.length; q++) {
      if (list[q].rest || smallHide(list[q].ser, m)) continue;
      var exq = excessPeople(m, list[q].ser, L, blS.ref);
      if (exq >= CFG.obs.minPeople) pulls.push({ i: q, ex: exq });
    }
    pulls.sort(function (a2, b2) { return b2.ex - a2.ex; });
    pulls = pulls.slice(0, 3);
    for (var pq = 0; pq < pulls.length; pq++) pull[pulls[pq].i] = pulls[pq].ex;
  }
  var refL = blS && blS.kind === 'kpi' ? 'цель ' + fmtVal(m, blS.ref) : (blS ? 'база ' + fmtVal(m, blS.ref) : '');
  function pullTag(ex) {
    return '<span class="' + P + '-pull"' + tip({ title: 'Тянет метрику', text: 'Это значение оси сильнее других уводит «' + m.name + '» хуже ориентира юнита (' + refL + ') — в ' + monthLow(L) + '.',
      rows: [{ label: m.exL, value: fmtPeople(ex) }], note: 'Сравнение с ориентиром юнита — без поправки на то, что у разных групп свой обычный уровень.' }) + '>' + esc(fmtPeople(ex)) + ' сверх</span>';
  }
  var th = '<table class="' + P + '-t"><thead><tr><th class="' + P + '-l">' + esc(axisLabel(axis)) + '</th>';
  for (var hm = 0; hm < months.length; hm++) {
    var pp = dparts(M.cal.m[months[hm]].s);
    th += '<th>' + esc(MONTH_ABBR[pp.m] + (hm === 0 || pp.m === 0 ? ' ' + String(pp.y).slice(2) : '')) + '</th>';
  }
  th += '<th class="' + P + '-vs">За 12 мес<span class="' + P + '-hc">к ' + esc(monthDat(L - 11)) + '</span></th></tr></thead><tbody>';
  function prow(name, ser, cls, ex) {
    var r = '<tr class="' + cls + '"><td class="' + P + '-l">' + esc(name) + (ex ? pullTag(ex) : '') + '<span class="' + P + '-us">' + fmtInt(hcOf(ser)) + ' чел</span></td>';
    for (var c = 0; c < months.length; c++) r += '<td' + (c === months.length - 1 ? ' class="' + P + '-now"' : '') + '>' + esc(fmtVal(m, mval(ser, 'm', m, months[c]))) + '</td>';
    return r + deltaTd(m, deltaOf(m, mval(ser, 'm', m, L), mval(ser, 'm', m, L - 11)), 'Изменение за 12 месяцев: ' + monthLow(L) + ' к ' + monthDat(L - 11) + '.', P + '-vs') + '</tr>';
  }
  th += prow('ИТОГО · ' + scopeLabel(), M.scope, P + '-tot');
  for (var rr = 0; rr < list.length; rr++) th += prow(trName(list[rr]), list[rr].ser, list[rr].rest ? P + '-rest' : '', pull[rr]);
  th += '</tbody></table>';
  var nv = trCount(axis), worst = [];
  for (var w0 = 0; w0 < pulls.length; w0++) worst.push(trName(list[pulls[w0].i]));
  return s + hPanel({ title: m.name + ' · сводная по оси «' + axisLabel(axis) + '»',
    sub: 'последний месяц выделен · ' + nv + ' ' + plural(nv, 'значение', 'значения', 'значений') + (worst.length ? ' · хуже ориентира сильнее всего: ' + worst.join(', ') : ''),
    body: th, tbl: true, tabs: '<span class="' + P + '-pbtn">' + copyBtn('tr') + '</span>' });
}

// ---- вкладка «Цели»: реестр зоны и строка для новой цели ----
function ruleStatus(r, day) {
  if (!ruleActive(r, day)) return r.from > day ? ['neutral', 'с ' + fmtDay(r.from)] : ['neutral', 'истекла'];
  if (!ruleMatches(r)) return ['wait', 'ждёт разреза'];
  return ['good', 'в фокусе'];
}
function ruleSpan(r) {
  var a = r.from > '2000-01-01' ? 'с ' + fmtDay(r.from) : '';
  // «Бессрочно» в реестре — 2099-12-31 (в Date ClickHouse не влезает больше 2149-06-06).
  var b = r.to < '2099-12-31' ? 'по ' + fmtDay(r.to) : 'бессрочно';
  return a ? a + ' ' + b : b;
}
// rk юнита для строки реестра целей: справочник его не везёт (на супер-HRBP — сотни КБ),
// выбранному юниту он приезжает в meta.rk.
function unitRk(u) {
  if (!u) return '';
  return u.rk || (MODEL.single && MODEL.scopeIds[0] === u.id ? MODEL.scopeRk : '');
}
function kdValue(k, dflt) { return state.kd && state.kd[k] !== undefined && state.kd[k] !== null ? state.kd[k] : dflt; }
function sqlStr(v) { return "'" + String(v).replace(/'/g, "''") + "'"; }
function kdLine() {
  var M = MODEL, u = M.single ? M.units[M.scopeIds[0]] : null;
  var mk = kdValue('metric', 'regret'), tg = String(kdValue('target', '')).replace(',', '.').replace(/\s/g, '');
  var y = M.L >= 0 ? dparts(M.cal.m[M.L].s).y : 2026;
  var from = kdValue('from', y + '-01-01'), note = kdValue('note', '');
  var f = [];
  for (var i = 0; i < CFG.cuts.length; i++) {
    var sel = M.sel[CFG.cuts[i].key] || [];
    f.push(sqlStr(sel.length === 1 ? sel[0] : 'all'));
  }
  var rk = unitRk(u) || '<rk юнита>';
  var id = 'R-' + String(from).replace(/-/g, '').slice(0, 6) + '-' + String(rk).slice(0, 6) + '-' + mk;
  var num = tg !== '' && !isNaN(Number(tg)) ? String(Number(tg)) : '<цель>';
  return '(' + [sqlStr(id), sqlStr(rk), sqlStr(mk), num].concat(f).concat([sqlStr(from), 'null', sqlStr(M.meta && M.meta.me || ''), sqlStr(note)]).join(', ') + '),';
}
function goalsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, day = M.cal.m[L] ? M.cal.m[L].e : '';
  var s = pageHead('Цели', 'Цель ставится на юнит и действует на всю его ветку вниз, пока ниже не встретится своя. Несколько целей на одном юните разводятся разрезами численности: '
    + 'правило с разрезом работает, только когда в фильтрах выбран <b>ровно этот</b> разрез. Источник — параграф «KPI · реестр целей» ноута HRBP HUB: строка там = цель здесь после пересчёта.');
  var rules = M.rules.slice();
  rules.sort(function (a, b) {
    var da = pathTo(a.unit).length, db = pathTo(b.unit).length;
    return da - db || (unitName(M, a.unit) < unitName(M, b.unit) ? -1 : (unitName(M, a.unit) > unitName(M, b.unit) ? 1 : (a.metric < b.metric ? -1 : 1)));
  });
  var t = '<table class="' + P + '-t"><thead><tr><th class="' + P + '-l">Юнит</th><th class="' + P + '-l">Метрика</th><th>Цель</th>'
    + '<th class="' + P + '-l">Разрезы</th><th class="' + P + '-l">Действует</th><th class="' + P + '-l">Статус</th><th class="' + P + '-l">Автор · комментарий</th><th></th></tr></thead><tbody>';
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i], m = METRIC[r.metric], st = ruleStatus(r, day), cuts = ruleCuts(r), unit = M.units[r.unit];
    var chips = '';
    for (var c = 0; c < cuts.length; c++) chips += '<span class="' + P + '-fchip">' + esc(cuts[c]) + '</span>';
    var above = !inZone(r.unit);
    t += '<tr><td class="' + P + '-l">' + esc(unitName(M, r.unit)) + '<span class="' + P + '-us">' + esc(unit ? levelLabel(unit.lvl) : '') + (above ? ' · выше зоны, наследуется' : '') + '</span></td>'
      + '<td class="' + P + '-l">' + esc(m ? m.name : r.metric) + '</td>'
      + '<td>' + esc(m ? (m.better === 'higher' ? '≥ ' : '≤ ') + fmtVal(m, r.target) : String(r.target)) + '</td>'
      + '<td class="' + P + '-l">' + (chips || '<span class="' + P + '-muted">вся численность</span>') + '</td>'
      + '<td class="' + P + '-l"><span class="' + P + '-muted">' + esc(ruleSpan(r)) + '</span></td>'
      + '<td class="' + P + '-l"><span class="' + P + '-st ' + P + '-' + st[0] + '"' + tip({ title: st[1], text: st[0] === 'wait' ? 'Цель привязана к разрезам. Выберите их в «Фильтрах» — или нажмите «Показать».' : (st[0] === 'good' ? 'Цель действует при текущих разрезах.' : 'Цель вне срока действия на дату данных.'), note: cuts.length ? cuts.join('; ') : null }) + '>' + esc(st[1]) + '</span></td>'
      + '<td class="' + P + '-l"><span class="' + P + '-muted">' + esc((r.author || '—') + (r.note ? ' · ' + r.note : '')) + '</span><span class="' + P + '-us ' + P + '-mono">' + esc(r.id) + '</span></td>'
      + '<td>' + (above ? '' : '<button class="' + P + '-lnk" data-action="gorule" data-key="' + esc(r.id) + '"' + tip({ title: 'Показать цель в отчёте', text: 'Открыть юнит цели и выбрать её разрезы — цель станет фокусом «Сводки».' }) + '>Показать</button>') + '</td></tr>';
  }
  if (!rules.length) t += '<tr><td class="' + P + '-l" colspan="8"><span class="' + P + '-muted">В зоне и выше по ветке целей пока нет.</span></td></tr>';
  t += '</tbody></table>';
  s += '<div class="' + P + '-gap">' + hPanel({ title: 'Реестр целей', sub: 'цели на юнитах зоны и на их предках (наследуются вниз) · статус — на ' + fmtDay(day), body: t, tbl: true }) + '</div>';

  var u = M.single ? M.units[M.scopeIds[0]] : null, mOpts = [];
  for (var k = 0; k < CFG.metrics.length; k++) if (targetable(CFG.metrics[k])) mOpts.push([CFG.metrics[k].key, CFG.metrics[k].name]);
  var y = L >= 0 ? dparts(M.cal.m[L].s).y : 2026;
  var cutsNow = [];
  for (var q = 0; q < CFG.cuts.length; q++) {
    var sv = M.sel[CFG.cuts[q].key] || [];
    if (sv.length === 1) cutsNow.push('<span class="' + P + '-fchip">' + esc(CFG.cuts[q].label + ': ' + sv[0]) + '</span>');
    else if (sv.length > 1) cutsNow.push('<span class="' + P + '-fchip">' + esc(CFG.cuts[q].label + ': все (выбрано ' + sv.length + ')') + '</span>');
  }
  var form = '<div class="' + P + '-form">'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Юнит</span><span class="' + P + '-cn">' + esc(u ? u.nm : 'выберите один юнит в шапке') + '</span>'
    + '<span class="' + P + '-mono">rk: ' + esc(unitRk(u) || '—') + '</span></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('kdm', mOpts, kdValue('metric', 'regret')) + '</div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Цель, %</span><input class="' + P + '-inp" type="text" inputmode="decimal" data-kd="target" placeholder="например, 3,5" value="' + esc(kdValue('target', '')) + '"></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Действует с</span><input class="' + P + '-inp" type="text" data-kd="from" placeholder="ГГГГ-ММ-ДД" value="' + esc(kdValue('from', y + '-01-01')) + '"></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Комментарий</span><input class="' + P + '-inp" type="text" data-kd="note" placeholder="зачем цель" value="' + esc(kdValue('note', '')) + '"></div>'
    + '</div>'
    + '<div class="' + P + '-tnote">Разрезы берутся из «Фильтров»: ' + (cutsNow.length ? cutsNow.join('') : '<b>вся численность</b>')
    + '. Мультивыбор цель не поддерживает — такой разрез уйдёт в строку как «все».</div>'
    + '<div class="' + P + '-chh"><span class="' + P + '-cht">Строка для реестра</span><span class="' + P + '-chl"><span data-kd-msg="1">' + esc(state.copied || '') + '</span>'
    + '<button class="' + P + '-btn" data-action="copy">Скопировать</button></span></div>'
    + '<textarea class="' + P + '-code" readonly data-kd-out="1">' + esc(kdLine()) + '</textarea>'
    + '<ol class="' + P + '-steps"><li>Скопируйте строку и добавьте её в <b>insert</b> параграфа «KPI · реестр целей» ноута HRBP HUB (или отправьте владельцу ноута).</li>'
    + '<li>Запустите ноут — «HH · проверки» покажет правила с неизвестным rk или метрикой.</li>'
    + '<li>После выгрузки цель появится здесь и на «Сводке»; снять цель — удалить строку или закрыть её датой valid_to.</li></ol>';
  s += hPanel({ title: 'Новая цель', sub: u ? 'на юнит «' + u.nm + '» и всю его ветку' : 'цель ставится на один юнит — выберите его в шапке', body: form });
  return s;
}

// ---- вкладка «Каталог метрик» ----
function catalogHTML() {
  var P = CFG.ns, s = pageHead('Каталог метрик', 'Действующие метрики отчёта и то, что в работе. Метка «показывается» — метрика включена сейчас в окне «Фильтры» → «Что показывать». Формулы — в подсказках.');
  s += '<div class="' + P + '-cgrid">';
  for (var b = 0; b < CFG.blocks.length; b++) {
    var list = '<ul class="' + P + '-clist">';
    for (var i = 0; i < CFG.metrics.length; i++) {
      var m = CFG.metrics[i];
      if (m.block !== CFG.blocks[b].key) continue;
      var n = 0;
      for (var r = 0; r < MODEL.rules.length; r++) if (MODEL.rules[r].metric === m.key) n++;
      list += '<li><span class="' + P + '-cn">' + esc(m.name) + hInfo({ title: m.name, text: m.hint, note: m.calc })
        + (state.metricOff[m.key] ? '' : '<span class="' + P + '-cb">показывается</span>') + '</span>'
        + '<span class="' + P + '-cm">' + esc(dirText(m) + (targetable(m) ? ' · цели ставятся' : ' · без целей и цвета') + (n ? ' · целей в зоне: ' + n : '')) + '</span></li>';
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
    + '<li>Цифры — за последний закрытый месяц: <b>' + esc(monthLow(MODEL.L)) + '</b>.</li>'
    + '<li>Цвет — сравнение с ориентиром: с целью юнита, а если её нет — со всей компанией.'
    + '<span class="' + CFG.ns + '-tpl">' + hPill('good', 'лучше') + hPill('bad', 'хуже') + hPill('neu', 'в пределах ±5 %') + '</span></li>'
    + '<li>Фильтры и что показывать — в окне по кнопке «Фильтры»: выбор копится и применяется одной кнопкой «Применить».</li>'
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
      html: '<b>Сводка</b> — метрики выбранного юнита. <b>Команды</b> — сравнение подразделений. <b>Трансформеры</b> — метрика по грейду, стажу, городу. <b>Цели</b> — реестр целей. <b>Каталог метрик</b> — что и как считается.' });
    add({ sel: '[data-action="drawer"]', demo: true, done: function () { return !!state.drawer; }, title: 'Фильтры и настройки',
      html: 'Юнит, HRBP, разрезы численности и что показывать — в одном окне. Нажмите — окно откроется.',
      hint: 'Нажмите на подсвеченную кнопку или «Показать».' });
    add({ sel: P + '-mdl [data-tz="unit"]', drawer: true, lock: true, title: 'Юнит отчёта',
      html: 'Дерево вашей зоны на всю глубину и поиск по нему — сразу, без загрузки. Выберите подразделение: отчёт перестроится под него после «Применить».' });
    add({ sel: P + '-mdl [data-tz="hrbp"]', drawer: true, lock: true, need: hrbpVisible(), title: 'HRBP',
      html: 'Выберите HRBP — отчёт сузится до его зоны, а дерево юнитов ниже покажет только её подразделения.' });
    add({ sel: P + '-mdl [data-tz="cuts"]', drawer: true, lock: true, title: 'Разрезы',
      html: 'Покраска, IT / nonIT, стрим, специализация, штат, тип численности. Где значений до трёх — флажки в строку, длиннее — список с поиском. Можно отметить несколько значений: метрики пересчитаются только по этим сотрудникам.' });
    add({ sel: P + '-mdl [data-tz="view"]', drawer: true, lock: true, title: 'Что показывать',
      html: '<b>Метрики</b> — какие строки показывать, по группам: флажок группы снимает или возвращает её целиком. <b>Только фокусные</b> — метрики, у которых есть цель. Это вид: данные не перезапрашиваются.' });
    add({ sel: P + '-mdf', drawer: true, lock: true, title: 'Применить',
      html: 'Внизу окна всегда видно, что изменено. «Применить» пересчитывает отчёт одним запросом и закрывает окно, «Отменить» возвращает как было. Закрыли окно, не применив, — над отчётом останется напоминание.' });
    add({ sel: P + '-fbar', lock: true, title: 'Применённые фильтры',
      html: 'Что применено — чипами рядом с кнопкой «Фильтры»: × снимает фильтр сразу. Справа — база сравнения: вся компания под теми же разрезами, с ней сравниваются метрики без цели.' });
    add({ sel: function (R) { var k = R.querySelectorAll(P + '-kpis>' + P + '-kpi'); return k.length > 1 ? k[1] : null; }, title: 'Сотрудники и движение',
      html: 'Численность на конец месяца и как она менялась за год: найм в компанию, увольнения из компании, переводы между подразделениями. Помесячно — в ⓘ.' });
    add({ sel: P + '-obs', title: 'Что видно в данных',
      html: 'Короткая сводка: только факты, которые прошли пороги, — хуже или лучше цели и базы на 10% и больше (в людях), в какой команде сидит отклонение, ухудшение 3 месяца подряд, всплеск уходов, незаполненные причины. <b>«Ещё N»</b> раскрывает список, имя команды в нём открывает её в «Командах». Команды меньше ' + CFG.small.min + ' человек не оцениваются.' });
    add({ sel: function (R) { var t = firstOp(R); return t ? t.querySelectorAll(P + '-row>' + P + '-lead') : null; }, all: true, title: 'Значение',
      html: 'Метрика за последний закрытый месяц, под ней — сколько это людей: «9 уходов за год», «16 из 17 новичков».' });
    add({ sel: function (R) { var t = firstOp(R); return t ? [t.querySelector(P + '-vs')].concat(slice(t.querySelectorAll(P + '-row>' + P + '-vs'))) : null; },
      all: true, title: 'Ориентир',
      html: 'С чем сравнивается значение: «Цель ≤ 2,0 %» — утверждённая цель юнита (своя или унаследованная сверху), «База 92,0 %» — вся компания. Пилюля под ним — насколько лучше или хуже.' });
    add({ sel: function (R) { var t = firstOp(R); return t ? t.querySelectorAll(P + '-spk') : null; }, all: true, title: '12 месяцев',
      html: 'Линия — 12 месяцев. Точка — месяц: цвет — сравнение с его ориентиром, пунктир — сам ориентир (цель или база). Наведите на месяц — значение и ориентир.' });
    add({ sel: 'tr[data-action="openm"]', demo: true, at: 'left', done: function (k) { return opOpen(k); }, title: 'Динамика метрики',
      html: 'Нажмите на строку метрики — под ней откроются графики «год к году» и «12 недель». Открыть можно сразу несколько строк.',
      hint: 'Нажмите на подсвеченную строку или «Показать».' });
    add({ sel: 'tr' + P + '-det ' + P + '-dsplit', title: 'Графики',
      html: 'Синяя линия — этот год, серая — прошлый, пунктир — база или цель. Наведите на график — значения месяца. Клик по пункту легенды справа выключает линию.' });
  } else if (view === 'teams') {
    add({ sel: function (R) { var b = R.querySelector('[data-action="block"]'); return b ? b.parentNode : null; }, title: 'Группы метрик',
      html: '<b>Все метрики</b> — все колонки сразу, или одна группа: удержание, текучесть, структура команды.' });
    add({ sel: P + '-tpan', title: 'Подразделения',
      html: 'Юнит отчёта («ИТОГО») и три уровня под ним. ▸ у строки раскрывает её подразделения, ▸ у «ИТОГО» — все сразу. Цвет значения — сравнение с ориентиром подразделения. Прочерк — команда меньше ' + CFG.small.min + ' человек: закрепляемость и текучесть по ней не оцениваются.' });
    add({ sel: P + '-tpan tr' + P + '-row:not(' + P + '-tot)', demo: true, at: 'left', done: function (k) { return state.selTeam === k; }, title: 'Выбрать строку',
      html: 'Нажмите на строку — справа появятся её графики, а под значениями — ориентиры. Клик только выбирает строку и никуда не уводит.',
      hint: 'Нажмите на подсвеченную строку или «Показать».' });
    add({ sel: P + '-tpan tr' + P + '-sel ' + P + '-drill', lock: true, pad: 4, title: 'Открыть юнит',
      html: 'Иконка у выбранной строки делает её юнитом отчёта: сводка, команды и цели перестроятся под неё, ниже откроются её три уровня. Вернуться — «← Назад» или путь над таблицей.' });
    add({ sel: P + '-dpan', title: 'Динамика строки',
      html: '<b>Год</b> — помесячно к прошлому году, <b>12 недель</b> — к предыдущим 12 неделям. Наведите на график — значения; клик по пункту легенды выключает линию.' });
    add({ sel: P + '-tsw', title: 'Поиск в таблице',
      html: 'Найдёт подразделение среди трёх загруженных уровней и подсветит совпадение. По всей зоне ищет фильтр «Юнит».' });
    add({ sel: P + '-tpan [data-action="copy"]', pad: 4, title: 'Копировать таблицу',
      html: 'Все три уровня — в буфер обмена: вставьте в Excel или письмо.' });
    add({ sel: P + '-tpan th' + P + '-sth:not(' + P + '-l)', pad: 2, title: 'Сортировка',
      html: 'Клик по заголовку колонки — сортировка внутри каждого уровня; ещё клик — в обратную сторону, третий — как было.' });
    add({ sel: '[data-split]', need: !state.narrow && (state.splitMode || 'both') === 'both', pad: 2, title: 'Ширина колонок',
      html: 'Потяните разделитель — больше места таблице или графикам, двойной клик — как было. ⤢ в шапке панели разворачивает её во всю ширину.' });
    add({ sel: P + '-dhint', title: 'Глубже трёх уровней',
      html: 'Выберите строку и откройте её юнит иконкой — таблица покажет следующие три уровня.' });
  } else if (view === 'transform') {
    add({ sel: function (R) { var x = R.querySelector('select[data-sel="tfm"]'); return x ? x.parentNode.parentNode : null; }, title: 'Метрика',
      html: 'Какую метрику раскладывать по оси.' });
    add({ sel: function (R) { var x = R.querySelector('select[data-sel="tfa"]'); return x ? x.parentNode.parentNode : null; }, lock: true, title: 'Ось разбивки',
      html: 'Разрез численности или атрибут сотрудника на конец месяца: грейд, сеньорность, стаж, возраст, город… Все оси уже посчитаны — переключаются сразу.' });
    add({ sel: P + '-content ' + P + '-panel', title: 'Сводная таблица',
      html: 'Строки — значения оси, колонки — 12 месяцев (последний выделен), справа — изменение за год. Юнит и разрезы берутся из «Фильтров».' });
    add({ sel: P + '-pull', all: true, rings: true, title: 'Что тянет метрику',
      html: 'Метка «≈ 1,2 сверх» — значение оси, которое сильнее других уводит метрику хуже ориентира юнита: столько людей сверх ориентира (уходов за год, ушедших новичков…). Нет меток — ни одно значение заметно не тянет.' });
    add({ sel: P + '-content ' + P + '-panel [data-action="copy"]', pad: 4, title: 'Копировать',
      html: 'Сводная — в буфер обмена: вставьте в Excel или письмо.' });
  } else if (view === 'goals') {
    add({ sel: P + '-content ' + P + '-panel', title: 'Реестр целей',
      html: 'Цели на юнитах вашей зоны и выше. Цель действует на юнит и всю ветку вниз, пока ниже не встретится своя. Статус: в фокусе, ждёт разреза или вне срока.' });
    add({ sel: '[data-action="gorule"]', lock: true, pad: 4, title: 'Показать цель',
      html: 'Откроет юнит цели и выставит её разрезы в фильтрах.' });
    add({ sel: function (R) { var ps = R.querySelectorAll(P + '-content ' + P + '-panel'); return ps.length > 1 ? ps[ps.length - 1] : null; }, title: 'Новая цель',
      html: 'Отчёт цели только читает. Здесь собирается строка для реестра — её добавляют в параграф «KPI · реестр целей» ноута Helicopter.' });
  } else if (view === 'catalog') {
    add({ sel: P + '-cgrid ' + P + '-panel', title: 'Метрики по группам',
      html: 'Что значит метрика, в какую сторону лучше и ставятся ли на неё цели. «показывается» — метрика включена в окне «Фильтры» → «Что показывать». Формула — в ⓘ.' });
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
  if (!M.meta) return hEmpty('Нет служебной строки meta', 'Проверьте лимит строк и сортировку чарта: строка role = meta должна приезжать всегда (FIELDS.md).');
  if (M.role !== 'none' && M.L < 12) return hEmpty('Календарь отчёта пуст', 'В hrbp_hub_calendar нет закрытого месяца текущего года — перезапустите ноут HRBP HUB.');
  return hEmpty(CFG.text.noAccess, 'Логин: ' + (M.meta.me || '—') + '. Зону выдаёт владелец отчёта: строка в реестре доступа (параграф «HH · зоны HRBP и доступ» ноута).');
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
  h.push(headHTML());
  if (!ok) {
    h.push('<div class="' + P + '-content">' + accessHTML() + '</div></div>');
    return buildCSS() + h.join('');
  }
  h.push(filterBarHTML());
  h.push(noticesHTML());
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
      var sp = overlay.querySelector('.' + CFG.ns + '-split');
      if (!sp) return;
      if (state.narrow) { sp.classList.remove(CFG.ns + '-fit'); sp.style.height = ''; return; }
      // Видимое ещё не измерено (первый кадр) — оценка по экрану монитора, а не по высоте ячейки.
      var scrH = window.screen && window.screen.availHeight ? window.screen.availHeight - 140 : 99999;
      var or = overlay.getBoundingClientRect(), r = sp.getBoundingClientRect(), scr = state.vpH > 0 ? state.vpH : Math.min(window.innerHeight || overlay.clientHeight, scrH);
      var top = r.top - or.top + overlay.scrollTop, vis = Math.min(overlay.clientHeight, scr);
      var h = Math.max(CFG.split.minH, Math.min(overlay.clientHeight - top - CFG.spacing.gutter, vis - 2 * CFG.spacing.gap));
      sp.classList.add(CFG.ns + '-fit');
      sp.style.height = Math.round(h) + 'px';
    }
    function relayout() {
      var a = measureNarrow();
      fitSplit();
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
    var FOCUS_KEYS = ['data-psearch', 'data-cutkey', 'data-cutval', 'data-metric', 'data-mgroup', 'data-action', 'data-key', 'data-val', 'data-id', 'data-pop'];
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
      var ae = document.activeElement, fin = !!(state.drawer && ae && ae !== overlay && overlay.contains(ae)), fsel = fin ? focusSel(ae) : '';
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
      // Колонки и списки окна — после placeDrawer: одна колонка или две решает ширина окна.
      restoreScrolls(keep);
      if (fin && !overlay.contains(document.activeElement)) {
        var fe = fsel ? overlay.querySelector('.' + CFG.ns + '-mdl ' + fsel) : null;
        if (!fe) fe = overlay.querySelector('.' + CFG.ns + '-mdl');
        if (fe) focusQuiet(fe);
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
    function onLeave() { legendHi(null); dropTip(); }

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
      setSplit(g.parentNode, CFG.split.def);
      relayout();
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
      var ta = overlay.querySelector('[data-kd-out]'), ok = false;
      try { if (ta) { ta.focus(); ta.select(); ok = document.execCommand('copy'); } } catch (er) { ok = false; }
      if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
        try { navigator.clipboard.writeText(kdLine()); ok = true; } catch (er2) { ok = false; }
      }
      state.copied = ok ? 'Скопировано' : 'Выделите строку и нажмите Ctrl+C';
      var msg = overlay.querySelector('[data-kd-msg]');
      if (msg) msg.textContent = state.copied;
    }
    function updateKd() {
      var out = overlay.querySelector('[data-kd-out]');
      if (out) out.value = kdLine();
      state.copied = '';
      var msg = overlay.querySelector('[data-kd-msg]');
      if (msg) msg.textContent = '';
    }

    function onClick(e) {
      // Тур «Как работать»: кнопка в шапке.
      var ta = trigger(e.target, 'data-tact');
      if (ta) { tourAct(ta.getAttribute('data-tact')); return; }
      // Разделы окна фильтров сворачивает только их заголовок (клик по пустому месту окна ничего
      // не закрывает); окно закрывают ×, Esc, подложка, «Отменить» и «Применить».
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
        // HRBP выбран — раздел сворачивается, дерево юнитов ниже уже его зона; юнит выбран из
        // поиска — поиск очищается, дерево показывает юнит на месте.
        if (act === 'hpick') { state.unitAll = false; state.open = ''; state.qk.hrbp = ''; }
        state.qk.unit = '';
        render();
        return;
      }
      if (act === 'unitall') { state.unitAll = !state.unitAll; state.qk.unit = ''; render(); focusPop('unit'); return; }
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
      if (act === 'lg') {
        if (a.getAttribute('data-lock')) return;
        state.lineOff[key] = !state.lineOff[key];
        render();
        var again = overlay.querySelector('[data-action="lg"][data-key="' + key + '"]');
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
      if (act === 'dyn') { state.dyn = key; render(); return; }
      if (act === 'axis') { var nx = reqNow(); nx.axis = key || wantAxis(); emit(nx); return; }
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
      if (act === 'copy') { copyLine(); return; }
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
      var sel = t.getAttribute('data-sel');
      if (sel === 'tfm') { state.tfMetric = t.value; render(); return; }
      if (sel === 'tfa') {
        state.tfAxis = t.value;
        // Ось уже в ответе (разрез или атрибуты небольшой ветки) — без запроса.
        if (axisReady(t.value)) { render(); return; }
        var n = reqNow();
        n.axis = t.value;
        emit(n);
        return;
      }
      if (sel === 'kdm') { state.kd.metric = t.value; render(); return; }
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
      var kd = t.getAttribute('data-kd');
      if (kd) { state.kd[kd] = t.value; updateKd(); }
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
        setSplit(e.target.parentNode, (state.split || CFG.split.def) + (k === 39 ? 0.05 : -0.05));
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
      if (k === 27 && state.drawer) { closeDrawer(); return; }
      // Не-кнопки с role="button" («×» у разреза): Enter/пробел = клик.
      if ((k === 13 || k === 32) && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON') {
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
    // Прокрутка отчёта во время тура — подсветка едет за целью.
    overlay.addEventListener('scroll', function () { if (state.tour) tourPos(); });

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
    if (state.pend && state.pend.sig === echo) { state.lastResp = Date.now() - state.pend.at; state.pend = null; }
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
