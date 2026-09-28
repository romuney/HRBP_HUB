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
  carriers: { unit: 'unit_f', axis: 'tr_f', depth: 'depth_f', q: 'q_f' },
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
  // Порядок значений там, где он смысловой, а не по численности.
  order: {
    age: ['до 25', '25–34', '35–44', '45 и старше'],
    exp: ['до 1 года', '1–3 года', '3–5 лет', 'более 5 лет'],
    head: ['Руководитель', 'Не руководитель'],
    staff: ['Штат', 'Не штат'],
    seniority: ['Intern', 'Junior', 'Junior+', 'Middle', 'Middle+', 'Senior', 'Senior+', 'Lead']
  },
  blocks: [
    { key: 'retention', name: 'Удержание и текучесть', hint: 'Закрепляемость новичков, нежелательные уходы, причины увольнений.' },
    { key: 'structure', name: 'Структура команды', hint: 'Численность и доля джунов.' }
  ],
  // num / den — компоненты куба; denDiv — знаменатель-сумма за окно → средняя.
  // better: higher | lower | flat (у flat цвета и целей нет — «больше» не значит «лучше»).
  metrics: [
    { key: 'retention_new_3', block: 'retention', name: 'Закрепляемость новичков · 3 мес', short: 'Закрепл. 3 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r3n', den: 'r3d',
      hint: 'Доля новичков, которые работают в компании через 3 месяца после найма.',
      calc: 'Когорта — новички, у кого 3 месяца от найма исполнились в окне; дожившие / когорта. Окно созревания 3 мес (13 нед). База отсчёта — company_hire_dt, при типе численности «Активная» — active_hire_dt.',
      numL: 'продолжают работать', denL: 'новичков в когорте' },
    { key: 'retention_new_6', block: 'retention', name: 'Закрепляемость новичков · 6 мес', short: 'Закрепл. 6 мес',
      fmt: 'pct', better: 'higher', share: true, num: 'r6n', den: 'r6d',
      hint: 'Доля новичков, которые работают в компании через 6 месяцев после найма.',
      calc: 'Как на 3 месяцах, горизонт 6 мес (26 нед).',
      numL: 'продолжают работать', denL: 'новичков в когорте' },
    { key: 'regret', block: 'retention', name: 'Regrettable текучесть', short: 'Regret',
      fmt: 'pct', better: 'lower', num: 'rg', den: 'hcw', denDiv: { m: 12, w: 52 },
      hint: 'Годовой темп уходов ценных сотрудников (нежелательные увольнения).',
      calc: 'Regrettable-увольнения за 12 мес (52 нед) / средняя списочная численность за то же окно. Разметка — usr_cross_data.regrettable_n_non_regrettable_base.',
      numL: 'regrettable-увольнений за окно', denL: 'средняя численность' },
    { key: 'nonregret', block: 'retention', name: 'Non regrettable текучесть', short: 'Non-reg.',
      fmt: 'pct', better: 'flat', num: 'nrg', den: 'hcw', denDiv: { m: 12, w: 52 },
      hint: 'Текучесть без сожаления (управляемые уходы). Нейтральная: больше не значит лучше.',
      calc: 'Non-regrettable-увольнения за 12 мес (52 нед) / средняя численность за окно.',
      numL: 'non-regrettable-увольнений', denL: 'средняя численность' },
    { key: 'exit_reasons', block: 'retention', name: 'Незаполненные причины увольнений', short: 'Без причины',
      fmt: 'pct', better: 'lower', num: 'nr', den: 'hc',
      hint: 'Уволенные без проставленной причины (30+ дней после увольнения) от численности юнита. В бизнес-контексте — «Заполнение причин увольнений».',
      calc: 'Увольнения за 3 мес (13 нед) без причины в legal_position_dismissal_reason, с непустой датой и старше 30 дней / численность на конец периода.',
      numL: 'увольнений без причины за 3 мес', denL: 'численность' },
    { key: 'headcount', block: 'structure', name: 'Численность', short: 'Числ.',
      fmt: 'int', better: 'flat', num: 'hc',
      hint: 'Списочная численность на конец периода (active_employee_flg = 1). Абсолютная величина — с базой не сравнивается.',
      calc: 'Сотрудники в списочной численности на последний день периода.' },
    { key: 'jun_team', block: 'structure', name: '% джунов в команде', short: 'Джуны',
      fmt: 'pct', better: 'higher', share: true, num: 'jun', den: 'hc',
      hint: 'Доля сотрудников с seniority intern / jun / jun+ в списочной численности.',
      calc: 'Джуны (seniority ILIKE intern% или jun%) / численность на конец периода.',
      numL: 'джунов', denL: 'численность' }
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
  pendingWarnMs: 9000,
  // Уровни — номера mapped-структуры, как в ультраширокой: 1 — компания, дальше 3…12
  // (lvl2 отчёт пропускает). Подпись — по номеру, у юнитов одного уровня разные слова
  // в названиях («Департамент …», «Отдел …»), поэтому слово не выдумываем.
  levels: { 1: 'Компания' },
  searchMin: 2,              // с какой длины строки поиск идёт по всей зоне
  searchDelay: 500,          // пауза ввода перед поиском по всей зоне, мс
  // Глубина «Команд»: 3 уровня вниз по умолчанию; «все» — пока ветка юнита не больше
  // порога датасета (meta.all_max), иначе ответ — мегабайты.
  depths: [['3', '3 уровня'], ['all', 'Все уровни']],
  tabs: [
    { key: 'onepager', label: 'Сводка' }, { key: 'teams', label: 'Команды' },
    { key: 'transform', label: 'Трансформеры' }, { key: 'goals', label: 'Цели' },
    { key: 'catalog', label: 'Каталог метрик' }
  ],
  text: {
    noData: 'Нет данных',
    title: 'HRBP HUB',
    loading: 'Обновляю данные…',
    notApplied: 'Фильтр не применился: чарт должен фильтровать сам себя. В JSON-метаданных дашборда: cross_filters_enabled: true и у этого чарта crossFilters.scope.excluded: [] — инструкция поставки, п. 4.5.',
    noAccess: 'Для вашего логина нет зоны HRBP в отчёте.',
    outOfZone: 'Запрошенный юнит вне вашей зоны — показана ваша зона.'
  },
  // TeamPulse — токены макета (styles.css). Жёлтый в светофоре запрещён.
  colors: {
    bg: '#f4f5f7', card: '#ffffff', line: '#e7e9ee', line2: '#eef0f3',
    ink: '#23272e', ink2: '#454b55', muted: '#8a909c', muted2: '#aab0bb',   // текст — как в Proteus Adoption
    green: '#12b048', greenBg: '#bff2cd', greenTx: '#0a8f3c',
    red: '#f51f1f', redBg: '#ffcccc', redTx: '#d11414',
    warn: '#f59300', warnBg: '#ffe6a0', warnTx: '#9a6500',
    blue: '#3b6fe0', blueBg: '#eef3fe', act: '#2b6cff',
    surface2: '#f3f4f6', hover: '#fafbfc', bench: '#9aa0ac',
    cur: '#4f5766', prev: '#c7c8cc', kpi: '#2b6cff', label: '#3f4654', axis: '#8a909c',
    axisLine: '#9ba4b5', axisStrong: '#3a3f4a', grid: '#eef0f4', now: '#b0b7c4',
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
  // Отступы — шкала 2…16 профиля; thH — высота строки шапки таблицы (под неё липнет «Итого»).
  spacing: { gutter: 16, gap: 12, thH: 30 },
  chart: { h: 236, hSmall: 200, bars: 300 }
};

// ---------- БЛОК 2: ВХОД + СОСТОЯНИЕ + ХЕЛПЕРЫ ----------
// ВСЕ строки data, не data[0].
var rawData = (typeof data !== 'undefined' && Array.isArray(data)) ? data : [];

// Состояние переживает перерисовку Proteus.
// Для таблиц с поиском/сортировкой/пагинацией имена ключей бери из TABLES.md,
// чтобы правки разных сессий не расходились.
if (!window.__pvtState) window.__pvtState = {};
var __S = window.__pvtState;
if (!__S[CFG.ns]) __S[CFG.ns] = {
  tip: null,
  view: '',              // вкладка (data-view): '' = «Сводка»
  open: '',              // открытый поповер: 'unit' | 'hrbp' | 'cut:<разрез>' | 'metrics' | ''
  q: '',                 // строка поиска открытого поповера
  stage: null,           // набранные, но не применённые фильтры: {unit: [...], cuts: {разрез: [...]}}
  qT: null,              // таймер поиска по всей зоне
  treeOpen: {},          // раскрытые узлы дерева в выборе юнита
  hOpen: {},             // раскрытые узлы дерева HRBP
  depthNote: false,      // «Все уровни» недоступны для этой ветки — показать пояснение
  openMetric: '',        // раскрытая строка сводки
  metricOff: {},         // метрики, снятые с показа
  focusOnly: false,      // «Только фокусные»
  block: 'retention',    // подвкладка «Команд»
  selTeam: '',           // выбранная строка «Команд» ('' — ИТОГО)
  openRows: {},          // раскрытые узлы «Команд»: ключ — путь узла от −1 через '/'
  dyn: 'yoy',            // «Год» | «12 недель» в «Командах»
  tfMetric: 'regret', tfMode: 'dyn', tfAxis: '',
  axisTried: {},         // оси трансформеров, которые уже запрашивались
  kd: {},                // черновик новой цели (вкладка «Цели»)
  copied: '',
  cw: {},                // измеренные ширины графиков по видам: half | side | wide
  narrow: false,         // ячейка уже 1100 px
  pend: null,            // {sig, at} — эмит ушёл, ждём ответ с тем же эхом
  pendT: null, lastSig: '',
  warn: ''               // предупреждение (не применился фильтр и т. п.)
};
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
            tr: [], rules: [], role: 'none', scopeIds: [], roots: [], single: false,
            sel: {}, axis: '', reqUnit: [], q: '', dictMode: 'full', zoneN: 0,
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
        var u = { id: f[0], pid: f[1] || '', lvl: num(f[2]) || 0, hc: num(f[3]) || 0, cur: f[4] === '1', rk: f[5] || '', nm: f[6] || '—',
                  nk: f.length > 7 ? (num(f[7]) || 0) : -1 };
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
    else if (role === 'tr') M.tr.push({ v: id, ser: serOf(r) });
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
  M.reqUnit = meta.req_unit || [];
  M.depth = meta.depth === 'all' ? 'all' : '3';
  M.depthReq = meta.depth_req === 'all' ? 'all' : '3';
  M.scopeN = num(meta.scope_n) || 0;
  M.allMax = num(meta.all_max) || 0;
  M.q = meta.q || '';
  M.dictMode = meta.dict_mode || 'full';
  M.zoneN = num(meta.zone_n) || 0;
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
  return { unit: sameSet(MODEL.scopeIds, MODEL.roots) ? [] : MODEL.scopeIds.slice(), cuts: cuts, axis: MODEL.axis || '',
           depth: MODEL.depthReq, q: '' };
}
// Эхо запроса: что датасет получил (req_unit — как пришло, до проверки доступа).
function reqEcho() {
  var r = reqNow(), u = [];
  for (var i = 0; i < MODEL.reqUnit.length; i++) if (MODEL.reqUnit[i]) u.push(MODEL.reqUnit[i]);
  r.unit = u;
  r.q = MODEL.q;
  return r;
}
function sigOf(o) {
  var s = 'u:' + (o.unit || []).slice().sort().join(',');
  for (var i = 0; i < CFG.cuts.length; i++) s += '|' + CFG.cuts[i].key + ':' + ((o.cuts && o.cuts[CFG.cuts[i].key]) || []).slice().sort().join('\u0001');
  return s + '|a:' + (o.axis || '') + '|d:' + (o.depth === 'all' ? 'all' : '3') + '|q:' + (o.q || '');
}
// Строка фильтров копит выбор (юнит, HRBP, разрезы) и отправляет его одной кнопкой
// «Применить»: staged() — применённое плюс набранное, stageDiff() — сколько фильтров изменено.
function staged() {
  var a = reqNow();
  if (!state.stage) return a;
  a.unit = state.stage.unit.slice();
  for (var k in state.stage.cuts) if (state.stage.cuts.hasOwnProperty(k)) a.cuts[k] = state.stage.cuts[k].slice();
  return a;
}
function stageDiff() {
  if (!state.stage) return 0;
  var a = reqNow(), b = staged(), n = sameSet(a.unit, b.unit) ? 0 : 1;
  for (var i = 0; i < CFG.cuts.length; i++) if (!sameSet(a.cuts[CFG.cuts[i].key] || [], b.cuts[CFG.cuts[i].key] || [])) n++;
  return n;
}
function stageEdit(fn) {
  if (!state.stage) { var a = reqNow(); state.stage = { unit: a.unit, cuts: a.cuts }; }
  fn(state.stage);
  if (!stageDiff()) state.stage = null;
}
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
  if (o.q) add(CFG.carriers.q, [o.q]);
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
    var mk = r.color ? '<i class="' + P + '-t-m' + (r.dash ? ' ' + P + '-dash' : '') + '" style="' + (r.dash ? 'border-top-color:' : 'background:') + r.color + '"></i>' : '';
    s += '<span class="' + P + '-t-r' + (r.dim ? ' ' + P + '-dim' : '') + '">' + mk + '<span class="' + P + '-t-l">' + esc(r.label) + '</span>'
      + (r.pill ? '<b class="' + P + '-cell ' + P + '-' + r.pill + ' ' + P + '-t-pill">' + esc(r.value) + '</b>' : '<b class="' + P + '-t-v">' + esc(r.value) + '</b>') + '</span>';
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

// ---- SVG: линия «период к периоду» (год к году / 12 недель к предыдущим 12) ----
// spec: {m, labels[12], cur[12], prev[12], ref[12], refKind 'kpi'|'bench'|'', boldIdx, nowIdx,
//        heads[12] (заголовки подсказок), prevHeads[12], curName, prevName, refName}
function svgLine(spec, W, H) {
  var P = CFG.ns, C = CFG.colors, m = spec.m, n = spec.labels.length;
  var all = [];
  for (var i = 0; i < n; i++) { all.push(spec.cur[i]); all.push(spec.prev[i]); if (spec.ref) all.push(spec.ref[i]); }
  var sc = lineScale(m, all);
  var kpiNow = null;
  if (spec.refKind === 'kpi' && spec.ref) for (var k = n - 1; k >= 0; k--) if (spec.ref[k] !== null) { kpiNow = spec.ref[k]; break; }
  var gl = Math.ceil(10 + Math.max(textW(axisFmt(m, sc.min)), textW(axisFmt(m, sc.max)), kpiNow !== null ? textW(axisFmt(m, kpiNow)) * 1.08 : 0) + 10);
  var gr = 22, gt = 20, gb = 24;
  var pw = Math.max(40, W - gl - gr), ph = Math.max(40, H - gt - gb);
  function X(i) { return gl + (n <= 1 ? pw / 2 : pw * i / (n - 1)); }
  function Y(v) { return gt + ph - (v - sc.min) / (sc.max - sc.min) * ph; }
  var s = '<svg class="' + P + '-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  // сетка: низ и верх коридора + подпись цели синим
  var ticks = [sc.min, sc.max];
  for (var t = 0; t < ticks.length; t++) {
    var y = Y(ticks[t]);
    s += '<line x1="' + gl + '" x2="' + (gl + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.grid + '"/>';
    s += '<text x="' + (gl - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="' + P + '-ax">' + esc(axisFmt(m, ticks[t])) + '</text>';
  }
  if (kpiNow !== null && kpiNow > sc.min && kpiNow < sc.max) {
    s += '<text x="' + (gl - 10) + '" y="' + (Y(kpiNow) + 4).toFixed(1) + '" text-anchor="end" class="' + P + '-ax ' + P + '-axk">' + esc(axisFmt(m, kpiNow)) + '</text>';
  }
  // ось X
  s += '<line x1="' + gl + '" x2="' + (gl + pw) + '" y1="' + (gt + ph) + '" y2="' + (gt + ph) + '" stroke="' + C.axisLine + '"/>';
  for (var xi = 0; xi < n; xi++) {
    var x = X(xi);
    s += '<line x1="' + x.toFixed(1) + '" x2="' + x.toFixed(1) + '" y1="' + (gt + ph) + '" y2="' + (gt + ph + 4) + '" stroke="' + C.axisLine + '"/>';
    s += '<text x="' + x.toFixed(1) + '" y="' + (gt + ph + 16) + '" text-anchor="middle" class="' + P + '-ax' + (xi === spec.boldIdx ? ' ' + P + '-axb' : '') + '">' + esc(spec.labels[xi]) + '</text>';
  }
  if (spec.nowIdx !== null && spec.nowIdx !== undefined && spec.nowIdx >= 0) {
    s += '<line x1="' + X(spec.nowIdx).toFixed(1) + '" x2="' + X(spec.nowIdx).toFixed(1) + '" y1="' + gt + '" y2="' + (gt + ph) + '" stroke="' + C.now + '"/>';
  }
  function path(arr) {
    var d = '', pen = false;
    for (var i = 0; i < n; i++) {
      if (arr[i] === null || arr[i] === undefined) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(arr[i]).toFixed(1);
      pen = true;
    }
    return d;
  }
  // прошлый период — бледная линия с точками
  s += '<path d="' + path(spec.prev) + '" fill="none" stroke="' + C.prev + '" stroke-width="1.8" stroke-linejoin="round"/>';
  for (var pi = 0; pi < n; pi++) if (spec.prev[pi] !== null) s += '<circle cx="' + X(pi).toFixed(1) + '" cy="' + Y(spec.prev[pi]).toFixed(1) + '" r="2" fill="' + C.prev + '"/>';
  // текущий — тёмная линия с подписями
  s += '<path d="' + path(spec.cur) + '" fill="none" stroke="' + C.cur + '" stroke-width="2.3" stroke-linejoin="round"/>';
  var lastLbl = -100;
  for (var ci = 0; ci < n; ci++) {
    var v = spec.cur[ci];
    if (v === null) continue;
    var cx = X(ci), cy = Y(v);
    s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.6" fill="' + C.cur + '"/>';
    var lbl = fmtVal(m, v);
    var lw = textW(lbl, 10.5);
    if (cx - lw / 2 > lastLbl + 2 || ci === spec.boldIdx) {
      var tx = Math.min(Math.max(cx, gl + lw / 2), gl + pw - lw / 2 + 8);
      s += '<text x="' + tx.toFixed(1) + '" y="' + (cy - 8).toFixed(1) + '" text-anchor="middle" class="' + P + '-vl">' + esc(lbl) + '</text>';
      lastLbl = tx + lw / 2;
    }
  }
  // ориентир — поверх: пунктир не прячет линию под собой
  if (spec.ref) {
    s += '<path d="' + path(spec.ref) + '" fill="none" stroke="' + (spec.refKind === 'kpi' ? C.kpi : C.bench) + '" stroke-width="1.6" stroke-dasharray="5 4"/>';
  }
  // наведение: столбец на каждый слот
  for (var hi = 0; hi < n; hi++) {
    var rows = [];
    var st = null;
    if (spec.cur[hi] !== null && spec.ref && spec.ref[hi] !== null) {
      st = spec.refKind === 'kpi' ? stateForKpi(m, spec.cur[hi], spec.ref[hi]) : compareState(m, spec.cur[hi], spec.ref[hi]);
    }
    if (spec.cur[hi] !== null) rows.push({ label: spec.curName, value: fmtVal(m, spec.cur[hi]), color: C.cur, pill: st && st !== 'neutral' && st !== 'warn' ? st : null });
    if (spec.prev[hi] !== null) rows.push({ label: spec.prevName + (spec.prevHeads ? ' · ' + spec.prevHeads[hi] : ''), value: fmtVal(m, spec.prev[hi]), color: C.prev, dim: true });
    if (spec.ref && spec.ref[hi] !== null) rows.push({ label: spec.refName, value: fmtVal(m, spec.ref[hi]), color: spec.refKind === 'kpi' ? C.kpi : C.bench, dash: true, dim: true });
    if (!rows.length) rows.push({ label: 'нет данных', value: '—' });
    var x0 = hi === 0 ? gl - 6 : (X(hi - 1) + X(hi)) / 2, x1 = hi === n - 1 ? gl + pw + 6 : (X(hi) + X(hi + 1)) / 2;
    s += '<rect x="' + x0.toFixed(1) + '" y="' + gt + '" width="' + Math.max(1, x1 - x0).toFixed(1) + '" height="' + ph + '" fill="transparent" data-kind="pt"'
      + tip({ title: spec.heads[hi], rows: rows, note: st ? STATE_TXT[st] : null }) + '/>';
  }
  return s + '</svg>';
}

// ---- SVG: группы столбиков по месяцам (трансформеры). Шкала от нуля всегда. ----
// spec: {m, labels[12], series:[{name, color, data[12]}], boldIdx}
function svgBars(spec, W, H) {
  var P = CFG.ns, C = CFG.colors, m = spec.m, n = spec.labels.length, k = spec.series.length;
  var mx = 0;
  for (var s0 = 0; s0 < k; s0++) for (var i0 = 0; i0 < n; i0++) { var v0 = spec.series[s0].data[i0]; if (v0 !== null && v0 > mx) mx = v0; }
  var step = niceStep(Math.max(mx, 1e-6) / 4), max = Math.ceil(Math.max(mx, 1e-6) / step) * step;
  var gl = Math.ceil(10 + textW(axisFmt(m, max)) + 10), gr = 16, gt = 12, gb = 24;
  var pw = Math.max(40, W - gl - gr), ph = Math.max(40, H - gt - gb);
  var gw = pw / n, bw = Math.max(2, Math.min(16, (gw - 10) / Math.max(k, 1)));
  function Y(v) { return gt + ph - v / max * ph; }
  var s = '<svg class="' + P + '-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">';
  for (var t = 0; t <= 4; t++) {
    var tv = step * t;
    if (tv > max + 1e-9) break;
    var y = Y(tv);
    s += '<line x1="' + gl + '" x2="' + (gl + pw) + '" y1="' + y.toFixed(1) + '" y2="' + y.toFixed(1) + '" stroke="' + C.grid + '"/>';
    s += '<text x="' + (gl - 10) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" class="' + P + '-ax">' + esc(axisFmt(m, tv)) + '</text>';
  }
  for (var i = 0; i < n; i++) {
    var gx = gl + gw * i, x0 = gx + (gw - bw * k) / 2;
    var rows = [];
    for (var j = 0; j < k; j++) {
      var v = spec.series[j].data[i];
      if (v === null) continue;
      var y1 = Y(v);
      s += '<rect x="' + (x0 + j * bw).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + Math.max(0, gt + ph - y1).toFixed(1) + '" rx="2" fill="' + spec.series[j].color + '"/>';
      rows.push({ label: spec.series[j].name, value: fmtVal(m, v), color: spec.series[j].color });
    }
    s += '<text x="' + (gx + gw / 2).toFixed(1) + '" y="' + (gt + ph + 16) + '" text-anchor="middle" class="' + P + '-ax' + (i === spec.boldIdx ? ' ' + P + '-axb' : '') + '">' + esc(spec.labels[i]) + '</text>';
    s += '<rect x="' + gx.toFixed(1) + '" y="' + gt + '" width="' + gw.toFixed(1) + '" height="' + ph + '" fill="transparent" data-kind="bar"' + tip({ title: spec.heads[i], rows: rows.length ? rows : [{ label: 'нет данных', value: '—' }] }) + '/>';
  }
  s += '<line x1="' + gl + '" x2="' + (gl + pw) + '" y1="' + (gt + ph) + '" y2="' + (gt + ph) + '" stroke="' + C.axisLine + '"/>';
  return s + '</svg>';
}

// ---- спарклайн: столбики за 12 месяцев, цвет — оценка КАЖДОГО месяца ----
function svgSpark(vals, states, tips) {
  var P = CFG.ns, w = 200, h = 40, n = vals.length, pad = 2, mx = 0;
  for (var i = 0; i < n; i++) if (vals[i] !== null && vals[i] > mx) mx = vals[i];
  mx = mx || 1;
  var bw = (w - pad * 2) / n, s = '';
  for (var j = 0; j < n; j++) {
    var v = vals[j];
    var bh = v === null ? 0 : Math.max(2, v / mx * (h - 4));
    s += '<rect x="' + (pad + j * bw).toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + bh.toFixed(1)
      + '" rx="1.5" class="' + P + '-sb ' + P + '-' + (states[j] || 'neutral') + '"' + (tips && tips[j] ? tip(tips[j]) : '') + '/>';
  }
  s += '<rect x="0" y="' + (h - 1) + '" width="' + w + '" height="1" class="' + P + '-sbase"/>';
  return '<svg class="' + P + '-spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">' + s + '</svg>';
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
// в одном чарте стала строкой фильтров под вкладками, окно KPI — вкладкой «Цели».
// Узкая ячейка (< 1100 px) — класс <ns>-narrow на корне вместо @media.
function buildCSS() {
  // Типографика, иконки и отступы — профиль виджетов Proteus Adoption
  // (DESIGN_SYSTEM.md §16 репозитория adoption, код pa-area / pa-strip): кегли —
  // только роли CFG.fonts, веса 400 / 500 / 600 (700+ нет нигде), контролы 34 px,
  // панель 14/16, KPI 12/14, таблица th 9/8 · td 6/8 · строка 44, тултип 7/10.
  var P = '.' + CFG.ns, C = CFG.colors, F = CFG.fonts;
  var SH = '0 1px 3px rgba(20,28,45,.06),0 4px 16px rgba(20,28,45,.04)';
  var SHL = '0 8px 28px rgba(20,28,45,.16)';
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
    P + '-tip ' + P + '-t-l{font-size:11px;font-weight:500;color:' + C.muted + ';min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    P + '-tip ' + P + '-t-v{display:inline;margin:0 0 0 auto;font-size:' + F.body + 'px;font-weight:500;color:' + C.ink + ';white-space:nowrap;font-variant-numeric:tabular-nums;}',
    P + '-tip ' + P + '-t-r' + P + '-dim ' + P + '-t-v{color:' + C.muted + ';}',
    P + '-tip ' + P + '-t-pill{margin:0 0 0 auto;padding:2px 8px;font-size:' + F.note + 'px;}',
    P + '-tip ' + P + '-t-n{display:block;font-size:' + F.cap + 'px;line-height:1.35;font-weight:400;color:' + C.muted + ';margin-top:4px;}',
    P + '-tip ' + P + '-t-r+' + P + '-t-n{margin-top:6px;padding-top:5px;border-top:1px solid ' + C.line2 + ';}',

    // ---- шапка: имя, выбор юнита, свежесть, вкладки ----
    P + '-head{background:' + C.card + ';border-bottom:1px solid ' + C.line + ';}',
    P + '-htop{display:flex;align-items:center;gap:10px;padding:10px 16px;flex-wrap:wrap;}',
    P + '-logo{font-weight:600;font-size:' + F.title + 'px;white-space:nowrap;color:' + C.ink + ';}',
    P + '-logo small{color:' + C.muted + ';font-weight:400;font-size:' + F.note + 'px;margin-left:6px;}',
    P + '-sp{flex:1;}',
    // Свежесть и роль — строкой, как «данные за вчера» в шапке Adoption: не контрол.
    P + '-badge{display:inline-flex;align-items:center;gap:6px;color:' + C.muted + ';font-weight:400;font-size:' + F.note + 'px;white-space:nowrap;cursor:help;}',
    P + '-badge b{color:' + C.ink2 + ';font-weight:500;}',
    P + '-badge+' + P + '-badge{padding-left:10px;border-left:1px solid ' + C.line + ';}',
    P + '-tabbar{display:flex;gap:4px;padding:0 16px;overflow-x:auto;}',
    P + '-tab{display:inline-flex;align-items:center;height:36px;border:0;background:transparent;padding:0 12px;font-weight:500;font-size:' + F.control + 'px;color:' + C.muted + ';cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap;}',
    P + '-tab:hover{color:' + C.ink2 + ';}',
    P + '-tab' + P + '-on{color:' + C.blue + ';border-bottom-color:' + C.blue + ';}',
    P + '-cnt{display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:15px;padding:0 4px;margin-left:5px;border-radius:999px;background:' + C.blueBg + ';color:#2b5fd0;font-size:9px;font-weight:500;}',

    // ---- строка фильтров: контролы 34 px ----
    P + '-fbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:12px 16px 0;}',
    P + '-fsep{width:1px;height:20px;background:' + C.line + ';margin:0 4px;}',
    P + '-dd{position:relative;display:inline-block;}',
    P + '-ddb{display:inline-flex;align-items:center;gap:6px;height:34px;border:1px solid ' + C.line + ';background:' + C.card + ';border-radius:9px;padding:0 12px;font-size:' + F.control + 'px;font-weight:500;color:' + C.ink2 + ';cursor:pointer;white-space:nowrap;max-width:340px;}',
    P + '-ddb:hover{border-color:#d8dce4;}',
    P + '-ddb' + P + '-set{background:' + C.blueBg + ';color:#2b5fd0;border-color:#dbe6fd;}',
    P + '-ddb' + P + '-on{border-color:' + C.act + ';}',
    // выбрано, но не применено: пунктир акцентом — видно, что ждёт «Применить»
    P + '-ddb' + P + '-chg{border-style:dashed;border-color:' + C.act + ';}',
    P + '-ddu ' + P + '-ddv{max-width:260px;}',
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

    // ---- поповеры: разрезы, метрики, выбор юнита ----
    P + '-pop{position:absolute;top:calc(100% + 4px);left:0;z-index:40;background:' + C.card + ';border:1px solid ' + C.line + ';border-radius:9px;box-shadow:' + SHL + ';width:300px;padding:10px;cursor:default;text-align:left;outline:none;}',
    P + '-pop' + P + '-wide{width:440px;}',
    P + '-pop' + P + '-rt{left:auto;right:0;}',
    P + '-poph{font-size:' + F.cap + 'px;text-transform:uppercase;letter-spacing:.4px;color:' + C.muted + ';font-weight:500;margin:2px 4px 8px;display:flex;align-items:center;gap:8px;}',
    P + '-poph span{flex:1;}',
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
    P + '-thint ' + P + '-tn{color:' + C.act + ';font-weight:400;font-size:' + F.note + 'px;white-space:normal;}',
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
    P + '-note' + P + '-info{border-style:solid;border-color:#dbe6fd;background:' + C.blueBg + ';color:#2b5fd0;}',
    P + '-load{display:flex;align-items:center;gap:10px;margin-top:12px;font-size:' + F.note + 'px;font-weight:500;color:' + C.act + ';}',
    P + '-load i{flex:1;height:3px;border-radius:2px;background:linear-gradient(90deg,' + C.act + ',#9dbbff,' + C.act + ');opacity:.7;}',
    P + '-busy ' + P + '-content{opacity:.5;pointer-events:none;transition:opacity .2s;}',

    // ---- контент вкладки: шкала отступов 2…16 ----
    P + '-content{padding:14px 16px 16px;min-width:0;}',
    P + '-pageh{margin:0 0 12px;}',
    P + '-h2{font-size:' + F.title + 'px;margin:0 0 4px;font-weight:600;color:' + C.ink + ';}',
    P + '-lede{margin:0;color:' + C.muted + ';font-size:' + F.note + 'px;line-height:1.5;max-width:110ch;}',
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
    P + '-rb{min-width:0;}',
    P + '-ind{display:inline-block;flex:0 0 auto;align-self:stretch;position:relative;}',
    P + '-t tr' + P + '-lv2 ' + P + '-ind::after{content:"";position:absolute;right:7px;top:3px;width:8px;height:8px;border-left:1px solid ' + C.line + ';border-bottom:1px solid ' + C.line + ';border-bottom-left-radius:3px;}',
    P + '-us{display:block;font-size:' + F.cap + 'px;color:' + C.muted + ';font-weight:400;margin-top:2px;}',
    P + '-muted{color:' + C.muted + ';font-weight:400;}',
    // Каретка — отдельная кнопка 28 × 28 с подложкой при наведении: промах не уходит в клик по строке.
    P + '-car{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin:-6px 4px -6px -6px;border:0;background:transparent;border-radius:7px;color:' + C.muted + ';font-size:12px;line-height:1;cursor:pointer;flex:0 0 auto;padding:0;}',
    P + '-car:hover{background:#eef1f5;color:' + C.ink + ';}',
    P + '-car' + P + '-open{color:' + C.act + ';}',
    P + '-cars{display:inline-block;width:26px;flex:0 0 auto;}',
    // «→ открыть юнит» — иконка-кнопка строки, как ссылка каталога Adoption (22 × 20, без рамки)
    P + '-go{display:inline-flex;align-items:center;justify-content:center;width:22px;height:20px;margin:-4px 0 -4px 2px;border:0;background:transparent;border-radius:6px;color:' + C.muted + ';font-size:12px;line-height:1;cursor:pointer;padding:0;vertical-align:middle;opacity:.7;}',
    P + '-t tr' + P + '-row:hover ' + P + '-go{opacity:1;}',
    P + '-go:hover,' + P + '-go:focus-visible{opacity:1;background:#e9eef4;color:' + C.act + ';outline:none;}',
    P + '-nw{white-space:nowrap;}',

    // ---- ячейки сравнения, пилюли, метки ----
    P + '-cell{display:inline-block;border-radius:7px;padding:5px 8px;font-weight:500;font-size:' + F.body + 'px;line-height:1.15;font-variant-numeric:tabular-nums;}',
    P + '-cell' + P + '-good{background:' + C.greenBg + ';color:' + C.greenTx + ';}',
    P + '-cell' + P + '-bad{background:' + C.redBg + ';color:' + C.redTx + ';}',
    P + '-cell' + P + '-warn,' + P + '-cell' + P + '-neutral{background:' + C.surface2 + ';color:' + C.ink2 + ';}',
    P + '-cref{display:block;font-size:' + F.cap + 'px;color:' + C.muted + ';font-weight:400;margin-top:2px;font-variant-numeric:tabular-nums;}',
    P + '-tgt{font-size:' + F.note + 'px;color:' + C.muted + ';font-weight:400;line-height:1.35;white-space:nowrap;text-align:right;margin-bottom:2px;}',
    P + '-tgt b{color:' + C.ink2 + ';font-weight:500;display:block;font-size:' + F.body + 'px;}',
    P + '-dm{display:inline-block;width:12px;border-top:2px dashed ' + C.bench + ';vertical-align:middle;margin-right:5px;}',
    P + '-dm' + P + '-k{border-top-color:' + C.kpi + ';}',
    // Пилюля изменения: 11,5 / 500, радиус 999, поля 2/8
    P + '-delta{display:inline-flex;align-items:center;gap:4px;font-size:' + F.note + 'px;font-weight:500;padding:2px 8px;border-radius:999px;white-space:nowrap;cursor:help;font-variant-numeric:tabular-nums;}',
    P + '-delta' + P + '-up{background:' + C.greenBg + ';color:' + C.greenTx + ';}',
    P + '-delta' + P + '-down{background:' + C.redBg + ';color:' + C.redTx + ';}',
    P + '-delta' + P + '-flat,' + P + '-delta' + P + '-neu{background:#f0f1f3;}',
    P + '-delta' + P + '-flat{color:' + C.muted + ';}',
    P + '-delta' + P + '-neu{color:' + C.ink2 + ';}',
    // Метка строки (флаг): 9 / 500, радиус 4, поля 1/5
    P + '-tag{display:inline-block;font-size:9px;font-weight:500;text-transform:uppercase;letter-spacing:.3px;padding:1px 5px;border-radius:4px;background:' + C.surface2 + ';color:' + C.ink2 + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    P + '-tag' + P + '-own{background:' + C.warnBg + ';color:' + C.warnTx + ';}',
    P + '-more{display:inline-block;font-size:9px;font-weight:500;letter-spacing:.3px;padding:0 5px;border-radius:4px;border:1px dashed ' + C.line + ';color:' + C.muted + ';vertical-align:1px;cursor:help;white-space:nowrap;margin-left:5px;}',
    P + '-nocmp{font-size:11px;font-weight:400;color:' + C.muted + ';border-bottom:1px dotted ' + C.muted2 + ';white-space:nowrap;cursor:help;}',
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

    // ---- графики: ось 10,5 / 400 (метка «сейчас» — 600), подписи значений 11 с белой обводкой 3 px ----
    P + '-spark{display:block;width:100%;height:40px;}',
    P + '-sbase{fill:' + C.line + ';}',
    P + '-sb' + P + '-good{fill:#80cf9a;}',
    P + '-sb' + P + '-bad{fill:#ef8c8c;}',
    P + '-sb' + P + '-warn,' + P + '-sb' + P + '-neutral{fill:#c7c8cc;}',
    P + '-chart{width:100%;overflow:hidden;}',
    P + '-svg{display:block;overflow:visible;}',
    P + '-ax{font-size:' + F.axis + 'px;fill:' + C.axis + ';font-weight:400;}',
    P + '-axb{fill:' + C.axisStrong + ';font-weight:600;}',
    P + '-axk{fill:' + C.kpi + ';font-weight:600;}',
    P + '-vl{font-size:' + F.val + 'px;fill:' + C.label + ';font-weight:400;paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round;}',
    P + '-chh{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:12px 0 2px;flex-wrap:wrap;}',
    P + '-cht{font-size:' + F.chart + 'px;font-weight:600;color:' + C.ink + ';}',
    P + '-chl{display:flex;gap:12px;flex-wrap:wrap;font-size:' + F.legend + 'px;color:' + C.muted + ';font-weight:400;}',
    P + '-lgm{display:inline-block;width:14px;height:0;border-top:2px solid;vertical-align:middle;margin-right:5px;}',
    P + '-lgm' + P + '-dash{border-top-style:dashed;}',
    P + '-lgb{display:inline-block;width:10px;height:9px;border-radius:3px;vertical-align:middle;margin-right:5px;}',
    P + '-dsplit{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);padding:10px 0 0;}',
    P + '-dsplit::before{content:"";position:absolute;left:50%;top:10px;bottom:0;width:1px;background:' + C.line + ';}',
    P + '-dsplit ' + P + '-dcol:first-child{padding:0 16px 0 12px;}',
    P + '-dsplit ' + P + '-dcol+' + P + '-dcol{padding:0 12px 0 16px;}',
    P + '-narrow ' + P + '-dsplit{grid-template-columns:minmax(0,1fr);padding:10px 12px 0;}',
    P + '-narrow ' + P + '-dsplit::before{display:none;}',
    P + '-narrow ' + P + '-dsplit ' + P + '-dcol:first-child{padding:0 0 14px;}',
    P + '-narrow ' + P + '-dsplit ' + P + '-dcol+' + P + '-dcol{padding:0;border-top:1px solid ' + C.line + ';}',
    P + '-split{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:12px;align-items:start;}',
    P + '-narrow ' + P + '-split{grid-template-columns:minmax(0,1fr);}',
    P + '-split ' + P + '-pb' + P + '-tbl{max-height:680px;}',
    // стопка графиков: зазор 26 (chart-gap профиля)
    P + '-dyn{display:flex;flex-direction:column;gap:26px;}',

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
    + '<div class="' + P + '-ph"><div class="' + P + '-pht"><span>' + esc(o.title) + '</span>'
    + (o.sub ? '<span class="' + P + '-phs">' + esc(o.sub) + '</span>' : '') + '</div>' + (o.tabs || '') + '</div>'
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
function hSearch(kind, placeholder) {
  var P = CFG.ns;
  return '<div class="' + P + '-psearch">' + SEARCH_SVG + '<input class="' + P + '-srch" type="text" data-psearch="' + kind + '" placeholder="'
    + esc(placeholder) + '" value="' + esc(state.q) + '"></div>';
}
function hSel(name, options, value, cls) {
  var P = CFG.ns, s = '<span class="' + P + '-selw' + (cls ? ' ' + cls : '') + '"><select data-sel="' + name + '">';
  for (var i = 0; i < options.length; i++) {
    s += '<option value="' + esc(options[i][0]) + '"' + (options[i][0] === value ? ' selected' : '') + '>' + esc(options[i][1]) + '</option>';
  }
  return s + '</select><i class="' + P + '-selc">▾</i></span>';
}
function hDelta(m, d, text) {
  var P = CFG.ns;
  if (d === null || d === undefined) return '<span class="' + P + '-delta ' + P + '-flat"' + tip({ title: 'Изменение', text: 'Нет значения за один из периодов.' }) + '>—</span>';
  return '<span class="' + P + '-delta ' + P + '-' + deltaClass(m, d) + '"'
    + tip({ title: 'Изменение', text: text, rows: [{ label: 'значение', value: fmtDelta(m, d) }],
            note: m.better === 'flat' ? 'Нейтральная метрика: цвет не ставится.' : null })
    + '>' + esc(fmtDelta(m, d)) + '</span>';
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
  var notes = ['Выберите эти разрезы в строке фильтров — тогда цель станет фокусом отчёта.'];
  if (rules.length > 3) notes.unshift('Показаны 3 из ' + rules.length + '.');
  return ' <span class="' + P + '-more"' + tip({ title: 'Ещё ' + rules.length + ' ' + plural(rules.length, 'цель', 'цели', 'целей') + ' по разрезам численности',
    rows: rows, note: notes }) + '>+' + rules.length + ' по разрезам</span>';
}
// Легенда светофора — одна на отчёт, над таблицами и справа, на вертикали цвета.
function legendHTML(right) {
  var P = CFG.ns, C = CFG.colors;
  var dz = 'Отклонение до 5% от ориентира не считается значимым — ни в плюс, ни в минус. Для цели 4,0% это коридор 3,8–4,2%, для 80% — 76–84%.';
  return '<div class="' + P + '-legend' + (right ? ' ' + P + '-r' : '') + '"><span class="' + P + '-lh">Цвет значения</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Зелёный', text: 'Метрика лучше ориентира больше чем на 5%.', note: 'Ориентир — цель, если она есть, иначе база сравнения.' })
    + '><span class="' + P + '-dot" style="background:' + C.greenBg + '"></span> лучше ориентира</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Красный', text: 'Метрика хуже ориентира больше чем на 5%.', note: '«Лучше» у каждой метрики своё: у текучести — меньше, у закрепляемости — больше.' })
    + '><span class="' + P + '-dot" style="background:' + C.redBg + '"></span> хуже ориентира</span>'
    + '<span class="' + P + '-sw"' + tip({ title: 'Серый — мёртвая зона ±5%', text: dz, note: 'Серым красится и метрика без ориентира: у «больше не значит лучше» цвета быть не может.' })
    + '><span class="' + P + '-dot" style="background:' + C.surface2 + '"></span> в пределах ±5% или без ориентира</span></div>';
}
// Ячейка ориентира: всегда строка ориентира + пилюля, чтобы строки были одной высоты.
function cmpCell(m, v, bl) {
  var P = CFG.ns;
  if (bl.kind === 'kpi') {
    var dk = deltaOf(m, v, bl.ref);
    return '<div class="' + P + '-tgt"><b>' + esc(fmtVal(m, bl.ref)) + '</b><i class="' + P + '-dm ' + P + '-k"></i>цель, ' + (m.better === 'higher' ? 'не ниже' : 'не выше') + '</div>'
      + '<span class="' + P + '-cell ' + P + '-' + bl.state + '"' + tip({ title: 'Сравнение с целью',
        text: 'У метрики есть утверждённая цель, поэтому база сравнения рядом не показывается.',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: 'цель', value: fmtVal(m, bl.ref), color: CFG.colors.kpi, dash: true },
               { label: 'отклонение', value: fmtDelta(m, dk) }],
        note: [(bl.inherited ? 'Цель унаследована с уровня «' : 'Цель стоит на юните «') + unitName(MODEL, bl.owner) + '».', STATE_TXT[bl.state]] })
      + '>' + esc(fmtDelta(m, dk)) + '</span>';
  }
  if (bl.kind === 'bench' && benchSelf()) {
    return '<div class="' + P + '-tgt"><b>' + esc(fmtVal(m, bl.ref)) + '</b><i class="' + P + '-dm"></i>база</div>'
      + '<span class="' + P + '-nocmp"' + tip({ title: 'Юнит совпадает с базой', text: 'Выбрана вся компания: база сравнения — это она же под теми же разрезами. Отклонение появится на юнитах ниже.' }) + '>юнит = база</span>';
  }
  if (bl.kind === 'bench') {
    var db = deltaOf(m, v, bl.ref);
    return '<div class="' + P + '-tgt"><b>' + esc(fmtVal(m, bl.ref)) + '</b><i class="' + P + '-dm"></i>база</div>'
      + '<span class="' + P + '-cell ' + P + '-' + bl.state + '"' + tip({ title: 'Сравнение с базой',
        rows: [{ label: 'факт', value: fmtVal(m, v) }, { label: benchLabel(), value: fmtVal(m, bl.ref), color: CFG.colors.bench, dash: true },
               { label: 'отклонение', value: fmtDelta(m, db) }],
        note: 'База — вся компания под теми же разрезами численности. Мёртвая зона ±5%: внутри неё отклонение серое.' })
      + '>' + esc(fmtDelta(m, db)) + '</span>';
  }
  var why = m.better === 'flat' ? 'У этой метрики «больше» не значит «лучше»: оценивать её цветом было бы неправдой.'
    : 'Абсолютная величина: сравнение со средней по компании показывало бы масштаб, а не оценку.';
  return '<div class="' + P + '-tgt"><b>—</b>ориентира нет</div><span class="' + P + '-nocmp"' + tip({ title: 'Сравнение отключено', text: why }) + '>не сравнивается</span>';
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

// ---- шапка: имя, юнит, свежесть, роль, вкладки ----
function headHTML() {
  var P = CFG.ns, M = MODEL, ok = M.ok && M.role !== 'none';
  var s = '<div class="' + P + '-head"><div class="' + P + '-htop">';
  s += '<span class="' + P + '-logo">' + esc(CFG.text.title) + '<small>метрики команд</small></span>';
  s += '<span class="' + P + '-sp"></span>';
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
  s += '</div>';
  if (ok) {
    s += '<div class="' + P + '-tabbar" role="tablist">';
    var cur = state.view || 'onepager';
    for (var i = 0; i < CFG.tabs.length; i++) {
      var t = CFG.tabs[i], on = t.key === cur;
      var badge = t.key === 'goals' && M.rules.length ? '<span class="' + P + '-cnt">' + M.rules.length + '</span>' : '';
      s += '<button class="' + P + '-tab' + (on ? ' ' + P + '-on' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '" data-view="' + t.key + '">'
        + esc(t.label) + badge + '</button>';
    }
    s += '</div>';
  }
  return s + '</div>';
}
// ---- строка фильтров: юнит и HRBP (выбор копится до «Применить») ----
// Подпись набора юнитов: вся зона, один юнит, зона HRBP или «N юнитов».
function unitsLabel(ids) {
  var M = MODEL;
  if (!ids.length || sameSet(ids, M.roots)) return M.role === 'hrbp' ? 'Моя зона' : 'Вся зона';
  if (ids.length === 1) return unitName(M, ids[0]);
  var z = zoneOwner(ids);
  return z ? 'Зона ' + z.nm : ids.length + ' ' + plural(ids.length, 'юнит', 'юнита', 'юнитов');
}
function stagedUnit() { return staged().unit; }
function unitChanged() { return !sameSet(stagedUnit(), reqNow().unit); }
function unitDDHTML() {
  var P = CFG.ns, open = state.open === 'unit', ids = stagedUnit();
  var chain = ids.length === 1 ? pathTo(ids[0]) : [], names = [];
  for (var i = 0; i < chain.length; i++) names.push(unitName(MODEL, chain[i]));
  var s = '<div class="' + P + '-dd" data-scope="unit">';
  s += '<button class="' + P + '-ddb ' + P + '-ddu' + (ids.length ? ' ' + P + '-set' : '') + (unitChanged() ? ' ' + P + '-chg' : '') + (open ? ' ' + P + '-on' : '')
    + '" data-action="open" data-pop="unit" aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '"'
    + (open ? '' : tip({ title: 'Юнит отчёта', text: names.length ? names.join(' › ') : unitsLabel(ids),
        note: unitChanged() ? 'Выбран, но ещё не применён — кнопка «Применить».' : 'Сводка, команды и цели — по этому юниту.' })) + '>'
    + '<span class="' + P + '-ddl">Юнит:</span><span class="' + P + '-ddv">' + esc(unitsLabel(ids)) + '</span><span class="' + P + '-ddc">▾</span></button>';
  if (open) {
    s += '<div class="' + P + '-pop ' + P + '-wide" tabindex="-1">'
      + '<div class="' + P + '-poph"><span>Юнит отчёта</span></div>'
      + hSearch('unit', 'Поиск юнита по названию')
      + '<div class="' + P + '-list" data-plist="unit">' + unitListHTML() + '</div>'
      + '<div class="' + P + '-popf"><span>Выбор применится кнопкой «Применить». Цифра справа — численность сейчас.</span></div></div>';
  }
  return s + '</div>';
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
// По умолчанию раскрыты корни и путь до выбранного юнита.
function onScopePath(id) {
  for (var i = 0; i < MODEL.scopeIds.length; i++) if (pathTo(MODEL.scopeIds[i]).indexOf(id) > -1 && MODEL.scopeIds[i] !== id) return true;
  return false;
}
function treeOpen(id, depth) { return state.treeOpen.hasOwnProperty(id) ? !!state.treeOpen[id] : (depth === 0 || onScopePath(id)); }
function treeRows(id, depth, cur, out) {
  var P = CFG.ns, u = MODEL.units[id];
  if (!u || out.n > 600) return;
  out.n++;
  // Большая зона: справочник приходит окрестностью — дети узла могут быть не загружены (nk > 0).
  var kids = kidsOf(id), more = !kids.length && u.nk > 0, open = treeOpen(id, depth);
  out.s += '<div class="' + P + '-tr' + (id === cur ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="' + esc(id) + '" style="padding-left:' + (9 + depth * 16) + 'px">'
    + (kids.length || more ? '<button class="' + P + '-tw" data-action="tree" data-id="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' + (open ? '▾' : '▸') + '</button>' : '<span class="' + P + '-tsp"></span>')
    + '<span class="' + P + '-tn">' + esc(u.nm) + (u.cur ? '' : '<span class="' + P + '-gone">нет в структуре</span>') + '</span>'
    + '<span class="' + P + '-tl">' + esc(levelShort(u.lvl)) + '</span><span class="' + P + '-th">' + fmtInt(u.hc) + '</span></div>';
  if (!open) return;
  if (more) {
    out.s += '<div class="' + P + '-tr ' + P + '-thint" data-action="pick" data-id="' + esc(id) + '" style="padding-left:' + (9 + (depth + 1) * 16) + 'px">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + u.nk + ' ' + plural(u.nk, 'подразделение', 'подразделения', 'подразделений')
      + ' — выберите юнит и примените, они подгрузятся</span></div>';
    return;
  }
  for (var i = 0; i < kids.length; i++) treeRows(kids[i], depth + 1, cur, out);
}
function searchPending() { return !!state.qT || (!!state.pend && !!String(state.q || '').replace(/^\s+|\s+$/g, '')); }
function unitListHTML() {
  var P = CFG.ns, M = MODEL, q = String(state.q || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  var ids = stagedUnit(), cur = ids.length === 1 ? ids[0] : '';
  if (!q) {
    var all = !ids.length || sameSet(ids, M.roots);
    var s = '<div class="' + P + '-tr' + (all ? ' ' + P + '-cur' : '') + '" data-action="pick" data-id="">'
      + '<span class="' + P + '-tsp"></span><span class="' + P + '-tn">' + (M.role === 'hrbp' ? 'Вся моя зона' : 'Вся зона видимости') + '</span>'
      + '<span class="' + P + '-tl">' + M.roots.length + ' ' + plural(M.roots.length, 'корень', 'корня', 'корней') + '</span>'
      + '<span class="' + P + '-th">' + fmtInt(zoneHc(M.roots)) + '</span></div>';
    var out = { s: '', n: 0 };
    var roots = M.roots.slice().sort(function (a, b) { return unitName(M, a) < unitName(M, b) ? -1 : 1; });
    for (var i = 0; i < roots.length; i++) treeRows(roots[i], 0, cur, out);
    return s + out.s;
  }
  var hits = [];
  for (var id in M.units) {
    if (!M.units.hasOwnProperty(id)) continue;
    var u = M.units[id], nm = u.nm.toLowerCase(), at = nm.indexOf(q);
    if (at < 0 || !inZone(id)) continue;
    hits.push({ id: id, u: u, rank: (at === 0 ? 0 : 1) * 100 + u.lvl });
  }
  // Большая зона: справочник — окрестность юнита; остальное ищет датасет (q_f) сам,
  // после паузы в наборе — без Enter.
  var r = '';
  if (M.dictMode === 'part') {
    var done = M.q && M.q.toLowerCase() === q;
    r += done
      ? '<div class="' + P + '-nores">Найдено по всей зоне: ' + hits.length + '</div>'
      : (q.length >= CFG.searchMin
         ? '<div class="' + P + '-nores">' + (searchPending() ? 'Ищу «' + esc(state.q) + '» по всей зоне…' : 'Ищу по всей зоне (' + fmtInt(M.zoneN) + ' юнитов)…') + '</div>'
         : '<div class="' + P + '-nores">Введите от ' + CFG.searchMin + ' букв — найдём по всей зоне</div>');
  }
  if (!hits.length) return r + (M.dictMode === 'part' && !(M.q && M.q.toLowerCase() === q) ? '' : '<div class="' + P + '-nores">Ничего не найдено</div>');
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
function hrbpOpen(login, depth) { return state.hOpen.hasOwnProperty(login) ? !!state.hOpen[login] : depth === 0 && MODEL.hrbps.length <= 40; }
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
  var P = CFG.ns, M = MODEL, q = String(state.q || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  var owner = zoneOwner(stagedUnit().length ? stagedUnit() : M.roots), cur = owner ? owner.login : '';
  if (!M.hrbps.length) return '<div class="' + P + '-nores">Других зон внутри вашей нет</div>';
  if (!q) {
    var out = { s: '', n: 0 };
    for (var i = 0; i < M.hTop.length; i++) hrbpTreeRows(M.hTop[i], 0, cur, out);
    return out.s;
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
function hrbpDDHTML() {
  var P = CFG.ns, open = state.open === 'hrbp', ids = stagedUnit();
  var owner = ids.length ? zoneOwner(ids) : null;
  var s = '<div class="' + P + '-dd" data-scope="hrbp">';
  s += '<button class="' + P + '-ddb' + (owner ? ' ' + P + '-set' : '') + (owner && unitChanged() ? ' ' + P + '-chg' : '') + (open ? ' ' + P + '-on' : '')
    + '" data-action="open" data-pop="hrbp" aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '"'
    + (open ? '' : tip({ title: 'Зона HRBP', text: owner ? owner.nm + ': ' + hrbpRootsText(owner) : 'Выберите HRBP — отчёт покажет его зону.',
        note: 'HRBP вложены по зонам: кто покрывает чужую зону, тот выше.' })) + '>'
    + '<span class="' + P + '-ddl">HRBP:</span><span class="' + P + '-ddv">' + esc(owner ? owner.nm : 'все') + '</span><span class="' + P + '-ddc">▾</span></button>';
  if (open) {
    s += '<div class="' + P + '-pop ' + P + '-wide" tabindex="-1">'
      + '<div class="' + P + '-poph"><span>Зона HRBP</span></div>'
      + hSearch('hrbp', 'Поиск HRBP: фамилия, логин или юнит')
      + '<div class="' + P + '-list" data-plist="hrbp">' + hrbpListHTML() + '</div>'
      + '<div class="' + P + '-popf"><span>Ниже — HRBP, чьи зоны внутри зоны выше. Цифра справа — численность зоны.</span></div></div>';
  }
  return s + '</div>';
}

// ---- строка фильтров: разрезы, метрики, фокус, сброс, база ----
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
function cutDDHTML(cut) {
  var P = CFG.ns, sel = staged().cuts[cut.key] || [], key = 'cut:' + cut.key, open = state.open === key;
  var chg = !sameSet(sel, MODEL.sel[cut.key] || []);
  var val = !sel.length ? 'все' : (sel.length === 1 ? trName(sel[0]) : trName(sel[0]) + ' +' + (sel.length - 1));
  var s = '<div class="' + P + '-dd" data-scope="' + key + '">';
  var names = [];
  for (var i = 0; i < sel.length; i++) names.push(trName(sel[i]));
  s += '<button class="' + P + '-ddb' + (sel.length ? ' ' + P + '-set' : '') + (chg ? ' ' + P + '-chg' : '') + (open ? ' ' + P + '-on' : '') + '" data-action="open" data-pop="' + key + '" aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '"'
    + (open ? '' : tip({ title: cut.label, text: sel.length ? names.join(', ') : cut.all + ': фильтр не задан',
        note: chg ? 'Выбрано, но ещё не применено — кнопка «Применить».' : 'Разрез действует на всё: юнит, команды, базу и цели.' })) + '>'
    + '<span class="' + P + '-ddl">' + esc(cut.label) + ':</span><span class="' + P + '-ddv">' + esc(val) + '</span>'
    + (sel.length ? '<span class="' + P + '-x" role="button" aria-label="Снять фильтр" data-action="clearcut" data-key="' + cut.key + '">×</span>' : '<span class="' + P + '-ddc">▾</span>')
    + '</button>';
  if (open) s += cutPopHTML(cut);
  return s + '</div>';
}
function cutPopHTML(cut) {
  var P = CFG.ns, vals = cutValues(cut.key), d = staged().cuts[cut.key] || [];
  var s = '<div class="' + P + '-pop" tabindex="-1">';
  s += '<div class="' + P + '-poph"><span>' + esc(cut.label) + '</span></div>';
  if (vals.length > 7) s += hSearch('cut', 'Поиск значения');
  s += '<div class="' + P + '-list" data-plist="cut">' + cutListHTML(cut) + '</div>';
  s += '<div class="' + P + '-popf"><span data-pcount="1">' + draftCount(d) + '</span>'
    + '<button class="' + P + '-btn ' + P + '-ghost" data-action="cutnone" data-key="' + cut.key + '">Очистить</button></div>';
  return s + '</div>';
}
function draftCount(vals) { return (vals.length ? 'выбрано: ' + vals.length : 'все значения') + ' · применится кнопкой «Применить»'; }
function cutListHTML(cut) {
  var P = CFG.ns, vals = cutValues(cut.key), q = String(state.q || '').toLowerCase();
  var d = staged().cuts[cut.key] || [];
  var s = '', n = 0;
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i].v;
    if (q && String(v).toLowerCase().indexOf(q) < 0) continue;
    n++;
    s += '<label class="' + P + '-opt"><input type="checkbox" data-cutkey="' + cut.key + '" data-cutval="' + esc(v) + '"' + (d.indexOf(v) > -1 ? ' checked' : '') + '>'
      + '<span class="' + P + '-optt">' + esc(trName(v)) + '</span><span class="' + P + '-optn">' + fmtInt(vals[i].n) + '</span></label>';
  }
  if (!vals.length) return '<div class="' + P + '-nores">В выбранном юните значений нет</div>';
  return n ? s : '<div class="' + P + '-nores">Ничего не найдено</div>';
}
function metricsDDHTML() {
  var P = CFG.ns, open = state.open === 'metrics', on = selMetrics('').length, all = CFG.metrics.length;
  var s = '<div class="' + P + '-dd" data-scope="metrics">';
  s += '<button class="' + P + '-ddb' + (on < all ? ' ' + P + '-set' : '') + (open ? ' ' + P + '-on' : '') + '" data-action="open" data-pop="metrics" aria-haspopup="true" aria-expanded="' + (open ? 'true' : 'false') + '">'
    + '<span class="' + P + '-ddl">Метрики:</span><span class="' + P + '-ddv">' + on + ' из ' + all + '</span><span class="' + P + '-ddc">▾</span></button>';
  if (open) {
    s += '<div class="' + P + '-pop" tabindex="-1"><div class="' + P + '-poph"><span>Метрики для отображения</span></div><div class="' + P + '-list">';
    for (var b = 0; b < CFG.blocks.length; b++) {
      s += '<div class="' + P + '-blk">' + esc(CFG.blocks[b].name) + '</div>';
      for (var i = 0; i < CFG.metrics.length; i++) {
        var m = CFG.metrics[i];
        if (m.block !== CFG.blocks[b].key) continue;
        s += '<label class="' + P + '-opt"><input type="checkbox" data-metric="' + m.key + '"' + (state.metricOff[m.key] ? '' : ' checked') + '>'
          + '<span class="' + P + '-optt">' + esc(m.name) + '</span></label>';
      }
    }
    s += '</div><div class="' + P + '-popf"><span>Только вид: данные не перезапрашиваются</span>'
      + '<button class="' + P + '-btn ' + P + '-ghost" data-action="mall">Все</button><button class="' + P + '-btn ' + P + '-ghost" data-action="mnone">Снять все</button></div></div>';
  }
  return s + '</div>';
}
function filterBarHTML() {
  var P = CFG.ns, M = MODEL, anyCut = false, st = staged(), n = stageDiff();
  var s = '<div class="' + P + '-fbar">' + unitDDHTML() + (hrbpVisible() ? hrbpDDHTML() : '');
  for (var i = 0; i < CFG.cuts.length; i++) {
    s += cutDDHTML(CFG.cuts[i]);
    if ((M.sel[CFG.cuts[i].key] || []).length || (st.cuts[CFG.cuts[i].key] || []).length) anyCut = true;
  }
  // Одна кнопка на всю строку: юнит, HRBP и разрезы уходят одним запросом.
  s += '<button class="' + P + '-btn ' + P + '-pri" data-action="apply"' + (n && !state.pend ? '' : ' disabled')
    + tip({ title: 'Применить фильтры', text: n ? 'Изменено фильтров: ' + n + '. Данные пересчитаются одним запросом.' : 'Выберите юнит, HRBP или значения разрезов — они применятся все сразу.' })
    + '>' + (state.pend && state.stage ? 'Применяю…' : 'Применить' + (n ? ' · ' + n : '')) + '</button>';
  if (n) s += '<button class="' + P + '-btn ' + P + '-ghost" data-action="unstage">Отменить</button>';
  s += '<span class="' + P + '-fsep"></span>' + metricsDDHTML();
  var fo = state.focusOnly;
  s += '<button class="' + P + '-ft' + (fo ? ' ' + P + '-on' : '') + '" data-action="focus" aria-pressed="' + (fo ? 'true' : 'false') + '"'
    + tip({ title: 'Только фокусные', text: 'На «Сводке» остаются метрики с целью — своей или унаследованной. На «Командах» — юниты, где по показанным метрикам стоит своя цель.' })
    + '><span class="' + P + '-ft-tr"><span class="' + P + '-ft-kn"></span></span><span class="' + P + '-ft-tx">Только фокусные</span></button>';
  if (anyCut || !defaultScope() || fo || selMetrics('').length < CFG.metrics.length || n) {
    s += '<button class="' + P + '-btn ' + P + '-ghost" data-action="reset"' + tip({ title: 'Сбросить', text: 'Вернуть свою зону, снять разрезы, показать все метрики — сразу, без «Применить».' }) + '>Сбросить</button>';
  }
  s += '<span class="' + P + '-sp"></span>';
  s += '<span class="' + P + '-bench"' + tip({ title: 'База сравнения',
    text: 'Вся компания под теми же разрезами численности. Юнит на базу не влияет: снимите разрез — база расширится.',
    note: 'С базой сравниваются метрики без утверждённой цели.' }) + '>База: <b>' + esc(benchLabel()) + '</b></span>';
  return s + '</div>';
}
function noticesHTML() {
  var P = CFG.ns, M = MODEL, s = '';
  if (state.pend) s += '<div class="' + P + '-load"><span>' + esc(CFG.text.loading) + '</span><i></i></div>';
  if (state.warn) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(state.warn) + '</div>';
  if (outOfZone()) s += '<div class="' + P + '-note ' + P + '-warn">' + esc(CFG.text.outOfZone) + '</div>';
  var v = state.view || 'onepager';
  if (M.meta && M.meta.ret_base === 'active' && (v === 'onepager' || v === 'teams')) {
    s += '<div class="' + P + '-note ' + P + '-info">Тип численности «Активная»: закрепляемость новичков считается от даты перехода в активную численность (active_hire_dt), а не от даты найма в компанию.</div>';
  }
  return s ? '<div class="' + P + '-notes">' + s + '</div>' : '';
}

// ---- графики: спецификации линий и блок с заголовком ----
// Графики последней сборки: плейсхолдер [data-ci] + функция рисования от ширины.
// Смена ширины ячейки перерисовывает ТОЛЬКО их (repaint в БЛОКЕ 6), без render().
var CHARTS = [];
function chartSlot(kind, draw) {
  CHARTS.push({ kind: kind, draw: draw });
  return '<div class="' + CFG.ns + '-chart" data-cw="' + kind + '" data-ci="' + (CHARTS.length - 1) + '">' + draw(cwOf(kind)) + '</div>';
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
  return { m: m, labels: labels, cur: cur, prev: prev, ref: ref, refKind: rk, boldIdx: L - 12, nowIdx: null, heads: heads, prevHeads: null,
           curName: String(y), prevName: String(y - 1), refName: rk === 'kpi' ? 'цель' : 'база · ' + benchLabel() };
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
  return { m: m, labels: labels, cur: cur, prev: prev, ref: ref, refKind: rk, boldIdx: 11, nowIdx: null, heads: heads, prevHeads: prevHeads,
           curName: 'последние 12 нед.', prevName: 'предыдущие 12', refName: rk === 'kpi' ? 'цель' : 'база · ' + benchLabel() };
}
function chartBlock(kind, title, spec, H) {
  var P = CFG.ns, C = CFG.colors;
  var lg = '<span><i class="' + P + '-lgm" style="border-top-color:' + C.cur + '"></i>' + esc(spec.curName) + '</span>'
    + '<span><i class="' + P + '-lgm" style="border-top-color:' + C.prev + '"></i>' + esc(spec.prevName) + '</span>'
    + (spec.ref ? '<span><i class="' + P + '-lgm ' + P + '-dash" style="border-top-color:' + (spec.refKind === 'kpi' ? C.kpi : C.bench) + '"></i>' + (spec.refKind === 'kpi' ? 'цель' : 'база') + '</span>' : '');
  return '<div class="' + P + '-chh"><span class="' + P + '-cht">' + esc(title) + '</span><span class="' + P + '-chl">' + lg + '</span></div>'
    + chartSlot(kind, function (w) { return svgLine(spec, w, H); });
}
// Спарклайн строки: 12 закрытых месяцев, цвет — оценка каждого месяца.
function sparkHTML(unitId, ser, m) {
  var L = MODEL.L, vals = [], idx = [], tips = [];
  for (var i = L - 11; i <= L; i++) { idx.push(i); vals.push(mval(ser, 'm', m, i)); }
  var states = statesOver(unitId, ser, 'm', m, idx);
  for (var k = 0; k < idx.length; k++) {
    var v = vals[k], b = v === null ? { kind: 'none', ref: null } : baseline(unitId, m, v, 'm', idx[k]);
    var rows = [{ label: 'факт', value: fmtVal(m, v) }];
    if (b.ref !== null && b.ref !== undefined) {
      rows.push({ label: b.kind === 'kpi' ? 'цель' : 'база', value: fmtVal(m, b.ref), dash: true, color: b.kind === 'kpi' ? CFG.colors.kpi : CFG.colors.bench });
      rows.push({ label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, b.ref)) });
    }
    tips.push({ title: monthFull(idx[k]), rows: rows, note: b.ref === null || b.ref === undefined ? 'Ориентира у метрики нет — цвет не ставится.' : STATE_TXT[states[k] || 'neutral'] });
  }
  return svgSpark(vals, states, tips);
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
  return '<div class="' + P + '-kpis">'
    + kpiCard({ label: 'Юнит отчёта', value: scopeLabel(), small: true,
        q: hInfo({ title: 'Юнит отчёта', text: 'Выбирается в шапке. От него считается наследование целей; для зоны из нескольких юнитов — от их общего предка.' }),
        row1: '<span class="' + P + '-ks">' + esc(lvl) + '</span>',
        row2: '<span class="' + P + '-ks">' + nC + ' ' + plural(nC, 'подразделение', 'подразделения', 'подразделений') + (M.single ? ' уровнем ниже' : ' в корнях зоны') + '</span>' })
    + kpiCard({ label: 'Сотрудников', value: fmtInt(hc),
        q: hInfo({ title: 'Численность', text: 'Списочная численность на конец месяца под выбранными разрезами.', rows: [{ label: 'найм за месяц', value: '+' + fmtInt(hire) }, { label: 'увольнения за месяц', value: MINUS + fmtInt(fire) }] }),
        row1: '<span class="' + P + '-ks">на ' + esc(fmtDay(day)) + '</span>',
        row2: '<span class="' + P + '-ks">разрез: ' + esc(selLabel()) + '</span>' })
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
function onepagerHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, u = scopeUnit();
  var s = pageHead('Сводка', 'Юнит: <b>' + esc(scopeLabel()) + '</b>. Разрезы численности: <b>' + esc(selLabel()) + '</b>. '
    + 'Метрики без утверждённой цели сравниваются с базой <b>' + esc(benchLabel()) + '</b> — она собирается из тех же разрезов, но по всей компании. '
    + 'У метрик с целью сравнение идёт с целью. Клик по строке раскрывает динамику: год к году и 12 недель.');
  if (!M.scope) return s + hEmpty('Нет данных по выбранным разрезам', 'Под текущими разрезами в выбранном юните нет сотрудников за два года. Снимите один из разрезов в строке фильтров.');
  if (!selMetrics('').length) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики в списке «Метрики» строки фильтров.');
  s += kpiCardsHTML() + legendHTML(true);
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
    var rows = '';
    for (var k = 0; k < items.length; k++) {
      var it = items[k], mk = it.m.key, open = state.openMetric === mk;
      var hid = hiddenRules(u, mk);
      if (it.bl.kind === 'kpi' && it.bl.inherited) {
        var more = hiddenRules(it.bl.owner, mk);
        for (var h = 0; h < more.length; h++) if (hid.indexOf(more[h]) < 0) hid.push(more[h]);
      }
      var calc = it.m.calc + (it.m.num === 'r3n' || it.m.num === 'r6n' ? (M.meta.ret_base === 'active' ? ' Сейчас база — active_hire_dt.' : '') : '');
      rows += '<tr class="' + P + '-row" data-action="openm" data-key="' + mk + '" aria-expanded="' + (open ? 'true' : 'false') + '">'
        + '<td class="' + P + '-l"><span class="' + P + '-rl">' + hCaret(open, 'openm', mk, 'Показать динамику')
        + '<span class="' + P + '-rb">' + esc(it.m.name) + hInfo({ title: it.m.name, text: it.m.hint, note: calc })
        + focusTag(it.m, it.bl) + moreFocus(hid, false)
        + '<span class="' + P + '-us">' + dirText(it.m) + '</span></span></span></td>'
        + '<td class="' + P + '-lead">' + esc(fmtVal(it.m, it.v)) + '</td>'
        + '<td class="' + P + '-vs">' + cmpCell(it.m, it.v, it.bl) + '</td>'
        + '<td>' + hDelta(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 1)), 'Сравнение с предыдущим месяцем (' + monthLow(L - 1) + ').') + '</td>'
        + '<td>' + hDelta(it.m, deltaOf(it.m, it.v, mval(M.scope, 'm', it.m, L - 12)), 'Сравнение с тем же месяцем прошлого года (' + monthLow(L - 12) + ').') + '</td>'
        + '<td class="' + P + '-spk">' + sparkHTML(u, M.scope, it.m) + '</td></tr>';
      if (open) {
        rows += '<tr class="' + P + '-det"><td colspan="6"><div class="' + P + '-dsplit">'
          + '<div class="' + P + '-dcol">' + chartBlock('half', 'Год к году', yoySpec(u, M.scope, it.m), CFG.chart.h) + '</div>'
          + '<div class="' + P + '-dcol">' + chartBlock('half', '12 недель к предыдущим 12', weekSpec(u, M.scope, it.m), CFG.chart.h) + '</div>'
          + '</div></td></tr>';
      }
    }
    var tbl = '<table class="' + P + '-t ' + P + '-fix ' + P + '-op"><colgroup><col style="width:30%"><col style="width:10%"><col style="width:15%">'
      + '<col style="width:11%"><col style="width:11%"><col style="width:23%"></colgroup>'
      + '<thead><tr><th class="' + P + '-l">Метрика</th><th>Значение<span class="' + P + '-hc">' + esc(monthFull(L)) + '</span></th>'
      + '<th class="' + P + '-vs">Ориентир<span class="' + P + '-hc">цель или база</span></th>'
      + '<th>Изменение<span class="' + P + '-hc">к ' + esc(monthDat(L - 1)) + '</span></th>'
      + '<th>Год к году<span class="' + P + '-hc">к ' + esc(monthDat(L - 12)) + '</span></th>'
      + '<th class="' + P + '-c">12 мес</th></tr></thead><tbody>' + rows + '</tbody></table>';
    s += '<div class="' + P + '-gap">' + hPanel({ title: blk.name, sub: blk.hint + ' · клик по строке раскрывает динамику', body: tbl, tbl: true }) + '</div>';
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
// Дерево «Команд»: датасет отдаёт юнит и 3 уровня вниз (режим «Все уровни» — до 12-го):
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
// all — обойти всё дерево (для «Развернуть всё»), иначе — только раскрытые узлы.
function teamRows(all) {
  var out = [];
  function walk(list, lvl, ppfx) {
    var ls = list.slice().sort(byHc);
    for (var i = 0; i < ls.length; i++) {
      var id = ls[i].id, pfx = id === '·' ? '' : (ppfx ? ppfx + '/' : '') + id;
      var r = { lvl: lvl, id: id, pid: ppfx ? ppfx.slice(ppfx.lastIndexOf('/') + 1) : '', pfx: pfx, ser: ls[i].ser,
                key: lvl + ':' + ppfx + ':' + id };
      out.push(r);
      if (id === '·' || !(all || state.openRows[pfx]) || !rowCanExp(r)) continue;
      walk(kidsAt(r), lvl + 1, pfx);
    }
  }
  walk(MODEL.c, 1, '');
  return out;
}
// Переключатель глубины над таблицей «Команд»: запрос сразу, без «Применить».
function depthHTML() {
  var P = CFG.ns, M = MODEL, big = M.allMax > 0 && M.scopeN > M.allMax, s = '<span class="' + P + '-lh">Глубина</span><div class="' + P + '-subs" role="tablist">';
  for (var i = 0; i < CFG.depths.length; i++) {
    var k = CFG.depths[i][0], on = k === M.depthReq;
    s += '<button class="' + P + '-sub' + (on ? ' ' + P + '-on' : '') + '" role="tab" aria-selected="' + (on ? 'true' : 'false') + '" data-action="depth" data-key="' + k + '"'
      + tip(k === 'all'
        ? { title: 'Все уровни', text: big ? 'Для юнита до ' + fmtInt(M.allMax) + ' подразделений — здесь ' + fmtInt(M.scopeN) + '. Откройте юнит поменьше стрелкой → в строке.'
                                         : 'Всё дерево до 12-го уровня одним запросом.' }
        : { title: '3 уровня', text: 'Три уровня вниз от выбранного юнита — сразу, без догрузки при раскрытии.' })
      + '>' + esc(CFG.depths[i][1]) + '</button>';
  }
  s += '</div>';
  if (state.depthNote || (M.depthReq === 'all' && M.depth !== 'all')) {
    s += '<span class="' + P + '-dnote">Все уровни — для юнита до ' + fmtInt(M.allMax) + ' подразделений, здесь ' + fmtInt(M.scopeN)
      + '. Откройте юнит поменьше стрелкой → в строке.</span>';
  }
  return s;
}
// Юнит, чьи цели действуют на строку: «·» — сотрудники прямо в родителе.
function rowUnit(r) { return r.id !== '·' ? r.id : (r.lvl === 1 ? scopeUnit() : r.pid); }
function rowName(r) {
  if (r.id !== '·') return unitName(MODEL, r.id);
  return 'Напрямую в «' + (r.lvl === 1 ? scopeLabel() : unitName(MODEL, r.pid)) + '»';
}
// Стрелка «→» держится за последнее слово имени: в узкой колонке глубокого
// дерева она не уезжает на отдельную строку.
function nameGo(name, go) {
  if (!go) return esc(name);
  var sp = name.lastIndexOf(' ');
  return (sp > 0 ? esc(name.slice(0, sp + 1)) : '') + '<span class="' + CFG.ns + '-nw">' + esc(sp > 0 ? name.slice(sp + 1) : name) + go + '</span>';
}
function unitCell(unitId, ser, m, selected) {
  var P = CFG.ns, L = MODEL.L, v = mval(ser, 'm', m, L), txt = fmtVal(m, v);
  if (v === null) return '<td class="' + P + '-muted">' + esc(txt) + '</td>';
  var bl = baseline(unitId, m, v, 'm', L);
  if (bl.kind === 'none') return '<td>' + esc(txt) + '</td>';
  var t = bl.kind === 'kpi'
    ? { title: m.name, text: bl.inherited ? 'Цель унаследована с уровня «' + unitName(MODEL, bl.owner) + '».' : 'Цель стоит на этом юните.',
        rows: [{ label: 'факт', value: txt }, { label: 'цель', value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.kpi }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }],
        note: STATE_TXT[bl.state] }
    : { title: m.name, text: 'Утверждённой цели нет — сравнение с базой.',
        rows: [{ label: 'факт', value: txt }, { label: benchLabel(), value: fmtVal(m, bl.ref), dash: true, color: CFG.colors.bench }, { label: 'отклонение', value: fmtDelta(m, deltaOf(m, v, bl.ref)) }],
        note: STATE_TXT[bl.state] };
  return '<td><span class="' + P + '-cell ' + P + '-' + bl.state + '"' + tip(t) + '>' + esc(txt) + '</span>'
    + (selected ? '<span class="' + P + '-cref">' + (bl.kind === 'kpi' ? 'цель ' : 'база ') + esc(fmtVal(m, bl.ref)) + '</span>' : '') + '</td>';
}
function ownLive(unitId, keys) {
  var n = 0;
  for (var i = 0; i < MODEL.rules.length; i++) {
    var r = MODEL.rules[i];
    if (r.unit === unitId && keys.indexOf(r.metric) > -1 && ruleMatches(r)) n++;
  }
  return n;
}
function teamsHTML() {
  var P = CFG.ns, M = MODEL, L = M.L;
  var s = pageHead('Команды', 'Юниты ниже выбранного — сразу на 3 уровня вниз (или все уровни — переключатель «Глубина»). Каретка раскрывает уровень, стрелка → делает юнит юнитом отчёта. '
    + 'Цветом отмечено само значение: у метрик с целью — относительно цели, у остальных — относительно базы <b>' + esc(benchLabel()) + '</b>. '
    + 'Клик по строке показывает ориентиры под значениями и меняет графики справа.');
  var live = [];
  for (var b = 0; b < CFG.blocks.length; b++) if (selMetrics(CFG.blocks[b].key).length) live.push([CFG.blocks[b].key, CFG.blocks[b].name]);
  if (!live.length) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики в списке «Метрики» строки фильтров.');
  var blk = live[0][0];
  for (var q = 0; q < live.length; q++) if (live[q][0] === state.block) blk = state.block;
  var mets = selMetrics(blk), keys = [];
  for (var mk = 0; mk < mets.length; mk++) keys.push(mets[mk].key);
  s += '<div class="' + P + '-tools">' + hSubs(live, blk, 'block') + '<span class="' + P + '-sp2"></span>' + depthHTML() + '</div>';
  if (!M.scope) return s + hEmpty('Нет данных по выбранным разрезам', 'Снимите один из разрезов в строке фильтров.');
  var rows = teamRows();
  if (state.focusOnly) {
    var kept = [];
    for (var f = 0; f < rows.length; f++) if (rows[f].id && rows[f].id !== '·' && ownLive(rows[f].id, keys)) kept.push(rows[f]);
    rows = kept;
  }
  var sel = null;
  for (var r0 = 0; r0 < rows.length; r0++) if (rows[r0].key === state.selTeam) sel = rows[r0];
  var every = teamRows(true), expandable = [];
  for (var e = 0; e < every.length; e++) if (rowCanExp(every[e])) expandable.push(every[e].pfx);
  var allOpen = expandable.length > 0;
  for (var e2 = 0; e2 < expandable.length; e2++) if (!state.openRows[expandable[e2]]) allOpen = false;

  var t = '<table class="' + P + '-t"><thead><tr><th class="' + P + '-l">Юнит</th>';
  for (var h = 0; h < mets.length; h++) t += '<th' + tip({ title: mets[h].name, text: mets[h].hint }) + '>' + esc(mets[h].short) + '</th>';
  t += '</tr></thead><tbody>';
  t += '<tr class="' + P + '-row ' + P + '-tot' + (!sel ? ' ' + P + '-sel' : '') + '" data-action="team" data-key="">'
    + '<td class="' + P + '-l"><span class="' + P + '-rl">'
    + (expandable.length ? hCaret(allOpen, 'expall', allOpen ? '0' : '1', allOpen ? 'Свернуть всё' : 'Развернуть всё', { title: allOpen ? 'Свернуть всё' : 'Развернуть всё', text: 'Все уровни, которые приехали, — сразу.' }) : '<span class="' + P + '-cars"></span>')
    + '<span class="' + P + '-rb">ИТОГО · ' + esc(scopeLabel()) + '<span class="' + P + '-us">' + fmtInt(hcOf(M.scope)) + ' чел</span></span></span></td>';
  for (var tm = 0; tm < mets.length; tm++) t += unitCell(scopeUnit(), M.scope, mets[tm], !sel);
  t += '</tr>';
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    // Отступ дерева: 12 px на уровень, но не больше 8 ступеней — на 12 уровнях имя не сжимается в столбик,
    // а глубину договаривает подпись «ур. N».
    var ind = '<span class="' + P + '-ind" style="width:' + (Math.min(row.lvl - 1, 8) * 12) + 'px"></span>';
    var isSel = sel && sel.key === row.key, uid = rowUnit(row), unit = M.units[row.id];
    var canExp = rowCanExp(row), open = !!state.openRows[row.pfx];
    // На границе глубины подразделения ниже не приехали — говорим, сколько их и как увидеть.
    var below = M.depth === '3' && row.lvl >= 3 && !canExp && unit && unit.nk > 0 ? unit.nk : 0;
    var nOwn = row.id !== '·' ? ownLive(row.id, keys) : 0;
    var hidOwn = [];
    if (row.id !== '·') { var allOwn = ownRules(row.id, ''); for (var ho = 0; ho < allOwn.length; ho++) if (keys.indexOf(allOwn[ho].metric) > -1 && !ruleMatches(allOwn[ho])) hidOwn.push(allOwn[ho]); }
    t += '<tr class="' + P + '-row' + (row.lvl >= 2 ? ' ' + P + '-lv2' : '') + (isSel ? ' ' + P + '-sel' : '') + '" data-action="team" data-key="' + esc(row.key) + '">'
      + '<td class="' + P + '-l"><span class="' + P + '-rl">' + ind
      + (canExp ? hCaret(open, 'exp', row.pfx, 'Раскрыть детализацию', { title: 'Детализация', text: 'Юниты уровнем ниже внутри «' + unitName(M, row.id) + '».' }) : '<span class="' + P + '-cars"></span>')
      + '<span class="' + P + '-rb">' + nameGo(rowName(row), row.id !== '·' ? '<button class="' + P + '-go" data-action="unit" data-id="' + esc(row.id) + '" aria-label="Открыть юнит"'
          + tip({ title: 'Открыть юнит', text: 'Сделать «' + unitName(M, row.id) + '» юнитом отчёта: сводка, команды и цели — по нему.' }) + '>→</button>' : '')
      + (nOwn ? ' <span class="' + P + '-tag ' + P + '-own"' + tip({ title: 'Фокус юнита', text: 'Цели установлены на этом юните и уходят вниз по всей его ветке.', rows: [{ label: 'целей в фокусе', value: String(nOwn) }] }) + '>★ Фокус</span>' : '')
      + moreFocus(hidOwn, true)
      + (unit && !unit.cur ? '<span class="' + P + '-gone">нет в структуре</span>' : '')
      + '<span class="' + P + '-us">' + (unit ? esc(levelShort(unit.lvl)) + ' · ' : '') + fmtInt(hcOf(row.ser)) + ' чел'
      + (below ? ' · <span class="' + P + '-below"' + tip({ title: 'Ниже ещё ' + below + ' ' + plural(below, 'подразделение', 'подразделения', 'подразделений'),
          text: 'Показаны 3 уровня вниз. Глубже — переключатель «Глубина: Все уровни» или стрелка → (юнит станет юнитом отчёта).' }) + '>ниже ещё ' + below + '</span>' : '')
      + '</span></span></span></td>';
    for (var mm = 0; mm < mets.length; mm++) t += unitCell(uid, row.ser, mets[mm], isSel);
    t += '</tr>';
  }
  if (!rows.length) {
    t += '<tr><td class="' + P + '-l" colspan="' + (mets.length + 1) + '"><span class="' + P + '-muted">'
      + (state.focusOnly ? 'Под фильтром «Только фокусные» юнитов не осталось: ни по одной показанной метрике своих целей здесь нет.' : 'У выбранного юнита нет подразделений уровнем ниже под текущими разрезами.')
      + '</span></td></tr>';
  }
  t += '</tbody></table>';
  var cur = sel || { lvl: 0, id: '', ser: M.scope };
  var cu = sel ? rowUnit(sel) : scopeUnit(), right = '<div class="' + P + '-dyn">';
  for (var cm = 0; cm < mets.length; cm++) {
    var spec = state.dyn === 'wow' ? weekSpec(cu, cur.ser, mets[cm]) : yoySpec(cu, cur.ser, mets[cm]);
    right += '<div>' + chartBlock('side', mets[cm].name, spec, CFG.chart.hSmall) + '</div>';
  }
  right += '</div>';
  s += legendHTML(false) + '<div class="' + P + '-split">'
    + hPanel({ title: 'Юниты', sub: 'клик по строке меняет графики справа и показывает ориентиры под значениями', body: t, tbl: true })
    + hPanel({ title: 'Динамика', sub: sel ? rowName(sel) : 'ИТОГО · ' + scopeLabel(), body: right,
               tabs: hSubs([['yoy', 'Год'], ['wow', '12 недель']], state.dyn === 'wow' ? 'wow' : 'yoy', 'dyn') })
    + '</div>';
  s += '<div class="' + P + '-tnote">Цели наследуются вниз по дереву: значение юнита сравнивается с ближайшей целью на нём самом или выше по ветке. '
    + 'Значения — за ' + esc(monthLow(L)) + '. «Напрямую в …» — сотрудники, закреплённые за самим юнитом, а не за его подразделениями.</div>';
  return s;
}

// ---- вкладка «Трансформеры» ----
function axisLabel(k) { for (var i = 0; i < CFG.axes.length; i++) if (CFG.axes[i].key === k) return CFG.axes[i].label; return k; }
function wantAxis() { return state.tfAxis || MODEL.axis || CFG.defaultAxis; }
function sumSer(list) {
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
function trSorted(axis) {
  var list = MODEL.tr.slice(), ord = CFG.order[axis], numeric = list.length > 0;
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
  return list;
}
// Пустое значение разреза / атрибута в кубе — '-' (ноут), в подписи — «не указано».
function trName(v) { return v === '' || v === '-' || v === '·' ? 'не указано' : v; }
function transformHTML() {
  var P = CFG.ns, M = MODEL, L = M.L, C = CFG.colors;
  var s = pageHead('Трансформеры', 'Раскладка метрики по оси: динамика по месяцам или сводная таблица. Юнит и разрезы из шапки уже применены — здесь выбирается только ось. '
    + 'Оси — шесть разрезов численности и атрибуты сотрудника на конец месяца (грейд, стаж, возраст, город…). Смена оси перезапрашивает данные.');
  var avail = selMetrics('');
  if (!avail.length) return s + hEmpty('Не выбрано ни одной метрики', 'Включите метрики в списке «Метрики» строки фильтров.');
  var m = avail[0];
  for (var a = 0; a < avail.length; a++) if (avail[a].key === state.tfMetric) m = avail[a];
  var axis = wantAxis(), mOpts = [], aOpts = [];
  for (var i = 0; i < avail.length; i++) mOpts.push([avail[i].key, avail[i].name]);
  for (var j = 0; j < CFG.axes.length; j++) aOpts.push([CFG.axes[j].key, CFG.axes[j].label]);
  s += '<div class="' + P + '-tools">'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('tfm', mOpts, m.key) + '</div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Ось разбивки</span>' + hSel('tfa', aOpts, axis) + '</div>'
    + '<span class="' + P + '-sp2"></span>' + hSubs([['dyn', 'Динамика по оси'], ['pivot', 'Сводная таблица']], state.tfMode === 'pivot' ? 'pivot' : 'dyn', 'tfmode')
    + '</div>';
  if (M.axis !== axis) {
    if (state.pend) return s + hEmpty('Загружаю разбивку «' + axisLabel(axis) + '»', 'Ответ придёт вместе с остальными данными отчёта.');
    return s + hEmpty('Разбивка «' + axisLabel(axis) + '» ещё не загружена', 'Нажмите «Загрузить» — данные подтянутся одним запросом.')
      + '<div class="' + P + '-tnote"><button class="' + P + '-btn ' + P + '-pri" data-action="axis" data-key="' + esc(axis) + '">Загрузить</button></div>';
  }
  if (!M.tr.length || !M.scope) return s + hEmpty('Нет данных для разбивки', 'Под текущими разрезами в выбранном юните нет сотрудников.');
  var list = trSorted(axis), months = [];
  for (var k = L - 11; k <= L; k++) months.push(k);
  if ((state.tfMode || 'dyn') !== 'pivot') {
    var top = list, rest = [];
    if (list.length > 8) {
      var byN = list.slice().sort(function (x, y) { return hcOf(y.ser) - hcOf(x.ser); });
      var keep = byN.slice(0, 7);
      top = []; rest = [];
      for (var t0 = 0; t0 < list.length; t0++) (keep.indexOf(list[t0]) > -1 ? top : rest).push(list[t0]);
    }
    var series = [], lg = '';
    for (var t1 = 0; t1 < top.length; t1++) series.push({ name: trName(top[t1].v), ser: top[t1].ser });
    if (rest.length) series.push({ name: 'Прочие (' + rest.length + ')', ser: sumSer(rest) });
    var sp = { m: m, labels: [], heads: [], series: [], boldIdx: 11 };
    for (var mi = 0; mi < months.length; mi++) {
      var p = dparts(M.cal.m[months[mi]].s);
      sp.labels.push(MONTH_ABBR[p.m] + (mi === 0 || p.m === 0 ? ' ' + String(p.y).slice(2) : ''));
      sp.heads.push(monthFull(months[mi]));
    }
    for (var si = 0; si < series.length; si++) {
      var col = C.series[si % C.series.length], data = [];
      for (var d0 = 0; d0 < months.length; d0++) data.push(mval(series[si].ser, 'm', m, months[d0]));
      sp.series.push({ name: series[si].name, color: col, data: data });
      lg += '<span><i class="' + P + '-lgb" style="background:' + col + '"></i>' + esc(series[si].name) + '</span>';
    }
    var body = '<div class="' + P + '-chh"><span class="' + P + '-cht">' + esc(fmtVal(m, mval(M.scope, 'm', m, L))) + ' · итого за ' + esc(monthLow(L)) + '</span><span class="' + P + '-chl">' + lg + '</span></div>'
      + chartSlot('wide', function (w) { return svgBars(sp, w, CFG.chart.bars); });
    return s + hPanel({ title: m.name + ' · ось «' + axisLabel(axis) + '»', sub: 'последние 12 месяцев' + (rest.length ? ' · 7 крупнейших значений, остальные — «Прочие»' : ''), body: body });
  }
  var th = '<table class="' + P + '-t"><thead><tr><th class="' + P + '-l">' + esc(axisLabel(axis)) + '</th>';
  for (var hm = 0; hm < months.length; hm++) {
    var pp = dparts(M.cal.m[months[hm]].s);
    th += '<th>' + esc(MONTH_ABBR[pp.m] + (hm === 0 || pp.m === 0 ? ' ' + String(pp.y).slice(2) : '')) + '</th>';
  }
  th += '<th class="' + P + '-vs">За 12 мес<span class="' + P + '-hc">к ' + esc(monthDat(L - 11)) + '</span></th></tr></thead><tbody>';
  function prow(name, ser, cls) {
    var r = '<tr class="' + cls + '"><td class="' + P + '-l">' + esc(name) + '<span class="' + P + '-us">' + fmtInt(hcOf(ser)) + ' чел</span></td>';
    for (var c = 0; c < months.length; c++) r += '<td' + (c === months.length - 1 ? ' class="' + P + '-now"' : '') + '>' + esc(fmtVal(m, mval(ser, 'm', m, months[c]))) + '</td>';
    return r + '<td class="' + P + '-vs">' + hDelta(m, deltaOf(m, mval(ser, 'm', m, L), mval(ser, 'm', m, L - 11)), 'Изменение за 12 месяцев: ' + monthLow(L) + ' к ' + monthDat(L - 11) + '.') + '</td></tr>';
  }
  th += prow('ИТОГО · ' + scopeLabel(), M.scope, P + '-tot');
  for (var rr = 0; rr < list.length; rr++) th += prow(trName(list[rr].v), list[rr].ser, '');
  th += '</tbody></table>';
  return s + hPanel({ title: m.name + ' · сводная по оси «' + axisLabel(axis) + '»', sub: 'последний месяц выделен · ' + list.length + ' ' + plural(list.length, 'значение', 'значения', 'значений'), body: th, tbl: true });
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
  var rk = u ? u.rk : '<rk юнита>';
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
      + '<td class="' + P + '-l"><span class="' + P + '-st ' + P + '-' + st[0] + '"' + tip({ title: st[1], text: st[0] === 'wait' ? 'Цель привязана к разрезам. Выберите их в строке фильтров — или нажмите «Показать».' : (st[0] === 'good' ? 'Цель действует при текущих разрезах.' : 'Цель вне срока действия на дату данных.'), note: cuts.length ? cuts.join('; ') : null }) + '>' + esc(st[1]) + '</span></td>'
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
    + '<span class="' + P + '-mono">rk: ' + esc(u ? u.rk : '—') + '</span></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Метрика</span>' + hSel('kdm', mOpts, kdValue('metric', 'regret')) + '</div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Цель, %</span><input class="' + P + '-inp" type="text" inputmode="decimal" data-kd="target" placeholder="например, 3,5" value="' + esc(kdValue('target', '')) + '"></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Действует с</span><input class="' + P + '-inp" type="text" data-kd="from" placeholder="ГГГГ-ММ-ДД" value="' + esc(kdValue('from', y + '-01-01')) + '"></div>'
    + '<div class="' + P + '-ctl"><span class="' + P + '-ctll">Комментарий</span><input class="' + P + '-inp" type="text" data-kd="note" placeholder="зачем цель" value="' + esc(kdValue('note', '')) + '"></div>'
    + '</div>'
    + '<div class="' + P + '-tnote">Разрезы берутся из строки фильтров: ' + (cutsNow.length ? cutsNow.join('') : '<b>вся численность</b>')
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
  var P = CFG.ns, s = pageHead('Каталог метрик', 'Действующие метрики отчёта и то, что в работе. Метка «показывается» — метрика включена сейчас в списке «Метрики». Формулы — в подсказках.');
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

// ---- сборка экрана ----
function accessHTML() {
  var P = CFG.ns, M = MODEL;
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
      + 'z-index:10;overflow:auto;box-sizing:border-box;background:' + CFG.colors.bg + ';';
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
      tip.innerHTML = html;
      tip.style.display = 'block';
      tip.style.left = '0px';
      tip.style.top = '0px';
      var t = tip.getBoundingClientRect();
      var pad = 6, gap = 8;
      var left = rect.left + rect.width / 2 - t.width / 2;
      var top = rect.top + rect.height + gap;
      if (top + t.height > window.innerHeight - pad) top = rect.top - t.height - gap;
      left = Math.max(pad, Math.min(left, window.innerWidth - t.width - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - t.height - pad));
      tip.style.left = Math.round(left) + 'px';
      tip.style.top = Math.round(top) + 'px';
      tip.style.opacity = '1';
    }
    function hideTip() {
      var tip = getTip();
      tip.style.opacity = '0';
      tip.style.display = 'none';
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
    function relayout() {
      var a = measureNarrow(), b = measureCharts();
      if (!a && !b) return false;
      var els = overlay.querySelectorAll('[data-ci]');
      for (var k = 0; k < els.length; k++) {
        var ch = CHARTS[+els[k].getAttribute('data-ci')];
        if (ch) els[k].innerHTML = ch.draw(cwOf(ch.kind));
      }
      return true;
    }

    // render ТОЛЬКО пересобирает разметку. Делегированные обработчики
    // навешиваются ОДИН РАЗ СНАРУЖИ render(): overlay не пересоздаётся.
    // Любой addEventListener внутри render() ЗАПРЕЩЁН — он создаёт дубли.
    // overlay — скролл-контейнер: позицию (и прокрутку списка поповера) храним.
    function render() {
      var st = overlay.scrollTop, sl = overlay.scrollLeft;
      var pl = overlay.querySelector('[data-plist]'), pst = pl ? pl.scrollTop : 0;
      overlay.innerHTML = buildHTML();
      relayout();
      overlay.scrollTop = st;
      overlay.scrollLeft = sl;
      var pl2 = overlay.querySelector('[data-plist]');
      if (pl2) pl2.scrollTop = pst;
      renderTip();
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

    function onOver(e) {
      var el = trigger(e.target, 'data-tip');
      if (!el) return;
      // Якорь — rect ЦЕЛИ как есть; содержимое плашки лежит готовым
      // html в самом data-tip (tipHtml при сборке разметки).
      state.tip = {
        rect: el.getBoundingClientRect(),
        kind: el.getAttribute('data-kind') || '',
        key: el.getAttribute('data-tip') || ''
      };
      renderTip();
    }

    function onOut(e) {
      var el = trigger(e.target, 'data-tip');
      if (!el) return;
      // Переход курсора на ДОЧЕРНИЙ узел той же цели тултип не гасит,
      // иначе он мигает посреди наведения.
      var to = e.relatedTarget;
      while (to) {
        if (to === el) return;
        to = to.parentNode;
      }
      state.tip = null;
      hideTip();
    }

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
        state.q = '';
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
    // Переход к юниту действием (стрелка →, «Показать» у цели): сразу, мимо «Применить»;
    // новое дерево «Команд» — раскрытия и набранные фильтры не переносятся.
    function withUnit(ids) {
      var n = reqNow();
      n.unit = sameSet(ids, MODEL.roots) ? [] : ids.slice();
      n.q = '';
      state.openRows = {};
      state.selTeam = '';
      state.stage = null;
      return n;
    }
    // Поиск юнита по всей зоне (справочник большой зоны приходит окрестностью):
    // после паузы в наборе или по Enter. Уходят применённые фильтры + строка поиска —
    // набранное в строке фильтров остаётся набранным.
    function searchZone() {
      if (state.qT) { clearTimeout(state.qT); state.qT = null; }
      var q = String(state.q || '').replace(/^\s+|\s+$/g, '');
      if (q.length < CFG.searchMin || MODEL.dictMode !== 'part' || q.toLowerCase() === String(MODEL.q || '').toLowerCase()) { refreshList(); return; }
      var n = reqNow();
      n.q = q.slice(0, 60);
      emit(n, true);
    }
    // Трансформеры: ось грузится лениво — один раз на ось, когда вкладку открыли.
    function ensureAxis() {
      if ((state.view || 'onepager') !== 'transform' || state.pend) return;
      var want = wantAxis();
      if (MODEL.axis === want || state.axisTried[want]) return;
      state.axisTried[want] = true;
      var n = reqNow();
      n.axis = want;
      emit(n);
    }
    function focusPop() {
      var inp = overlay.querySelector('[data-psearch]');
      if (inp) {
        inp.focus();
        try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (er) { /* поле без выделения */ }
        return;
      }
      var pop = overlay.querySelector('.' + CFG.ns + '-pop');
      if (pop && pop.focus) pop.focus();
    }
    function refreshList() {
      var box = overlay.querySelector('[data-plist]');
      if (!box) return;
      if (state.open === 'unit') box.innerHTML = unitListHTML();
      else if (state.open === 'hrbp') box.innerHTML = hrbpListHTML();
      else if (state.open.indexOf('cut:') === 0 && CUT[state.open.slice(4)]) box.innerHTML = cutListHTML(CUT[state.open.slice(4)]);
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
      // Клик мимо открытого поповера закрывает его; data-scope — на обёртке
      // открывателя вместе с поповером: клик по списку/поиску — «внутри».
      var sc = trigger(e.target, 'data-scope');
      if (state.open && (!sc || sc.getAttribute('data-scope') !== state.open)) {
        state.open = '';
        state.q = '';
        if (!trigger(e.target, 'data-action') && !trigger(e.target, 'data-view')) { render(); return; }
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
      if (act === 'open') {
        var pop = a.getAttribute('data-pop') || '';
        if (state.open === pop) { state.open = ''; render(); return; }
        state.open = pop;
        state.q = '';
        state.tip = null;
        hideTip();
        render();
        focusPop();
        return;
      }
      if (act === 'tree') { state.treeOpen[id] = !treeOpen(id, MODEL.roots.indexOf(id) > -1 ? 0 : 1); render(); return; }
      if (act === 'unit') { emit(withUnit(id ? [id] : MODEL.roots)); return; }
      // Строка фильтров копит выбор: юнит, зона HRBP, разрезы — до «Применить».
      if (act === 'pick' || act === 'hpick') {
        var ids = [];
        if (act === 'pick') ids = id ? [id] : [];
        else if (MODEL.hBy[id]) ids = sameSet(MODEL.hBy[id].roots, MODEL.roots) ? [] : MODEL.hBy[id].roots.slice();
        stageEdit(function (st) { st.unit = ids; });
        state.open = '';
        state.q = '';
        render();
        return;
      }
      if (act === 'htree') { state.hOpen[id] = !hrbpOpen(id, MODEL.hTop.indexOf(id) > -1 ? 0 : 1); render(); return; }
      if (act === 'clearcut' || act === 'cutnone') {
        stageEdit(function (st) { st.cuts[key] = []; });
        render();
        return;
      }
      if (act === 'apply') {
        if (!stageDiff() || state.pend) return;
        var na = staged();
        if (!sameSet(na.unit, reqNow().unit)) { state.openRows = {}; state.selTeam = ''; }
        emit(na);
        return;
      }
      if (act === 'unstage') { state.stage = null; render(); return; }
      if (act === 'mall' || act === 'mnone') {
        for (var mi = 0; mi < CFG.metrics.length; mi++) state.metricOff[CFG.metrics[mi].key] = act === 'mnone';
        render();
        return;
      }
      if (act === 'focus') { state.focusOnly = !state.focusOnly; render(); return; }
      if (act === 'reset') {
        state.metricOff = {};
        state.focusOnly = false;
        state.openMetric = '';
        state.selTeam = '';
        state.openRows = {};
        state.stage = null;
        emit({ unit: [], cuts: {}, axis: MODEL.axis || '', depth: MODEL.depthReq, q: '' });
        return;
      }
      if (act === 'openm') { state.openMetric = state.openMetric === key ? '' : key; render(); return; }
      if (act === 'block') { state.block = key; state.selTeam = ''; render(); return; }
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
      if (act === 'depth') {
        if (key === 'all' && MODEL.allMax > 0 && MODEL.scopeN > MODEL.allMax) { state.depthNote = true; render(); return; }
        state.depthNote = false;
        var nd = reqNow();
        nd.depth = key === 'all' ? 'all' : '3';
        emit(nd);
        return;
      }
      if (act === 'dyn') { state.dyn = key; render(); return; }
      if (act === 'tfmode') { state.tfMode = key; render(); return; }
      if (act === 'axis') { var nx = reqNow(); nx.axis = key || wantAxis(); emit(nx); return; }
      if (act === 'gorule') {
        for (var r = 0; r < MODEL.rules.length; r++) {
          var rl = MODEL.rules[r];
          if (rl.id !== key) continue;
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
      if (mk !== null && mk !== '') { state.metricOff[mk] = !t.checked; render(); return; }
      var sel = t.getAttribute('data-sel');
      if (sel === 'tfm') { state.tfMetric = t.value; render(); return; }
      if (sel === 'tfa') {
        state.tfAxis = t.value;
        var n = reqNow();
        n.axis = t.value;
        emit(n);
        return;
      }
      if (sel === 'kdm') { state.kd.metric = t.value; render(); return; }
    }

    // Поиск в поповере: пересобираем ТОЛЬКО список — поле ввода не трогаем,
    // фокус и каретка остаются на месте (E23b). Поля новой цели — так же.
    function onInput(e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var ps = t.getAttribute('data-psearch');
      if (ps !== null) {
        state.q = t.value;
        // Большая зона: поиск по всей зоне сам уходит после паузы в наборе — без Enter.
        if (ps === 'unit' && MODEL.dictMode === 'part') {
          if (state.qT) clearTimeout(state.qT);
          state.qT = String(state.q).replace(/^\s+|\s+$/g, '').length >= CFG.searchMin
            ? setTimeout(function () { state.qT = null; searchZone(); }, CFG.searchDelay) : null;
        }
        refreshList();
        return;
      }
      var kd = t.getAttribute('data-kd');
      if (kd) { state.kd[kd] = t.value; updateKd(); }
    }

    // Escape закрывает открытый поповер (smoke E24); Enter в поиске юнита — поиск по всей зоне.
    function onKeydown(e) {
      var k = e.keyCode || e.which;
      if (k === 13 && e.target && e.target.getAttribute && e.target.getAttribute('data-psearch') === 'unit') {
        e.preventDefault();
        searchZone();
        return;
      }
      if (k === 27 && state.open) {
        state.open = '';
        state.q = '';
        render();
        return;
      }
      // Не-кнопки с role="button" («×» у разреза): Enter/пробел = клик.
      if ((k === 13 || k === 32) && e.target && e.target.getAttribute && e.target.getAttribute('role') === 'button' && e.target.tagName !== 'BUTTON') {
        e.preventDefault();
        onClick({ target: e.target });
      }
    }

    overlay.addEventListener('mouseover', onOver);
    overlay.addEventListener('mouseout', onOut);
    overlay.addEventListener('click', onClick);
    overlay.addEventListener('change', onChange);
    overlay.addEventListener('input', onInput);
    overlay.addEventListener('keydown', onKeydown);

    // Глобальные слушатели переживают перезапуск скрипта и накапливаются.
    // Старый снимаем ЯВНО, ссылку держим в state. Escape вешай здесь же,
    // тем же способом, и никогда не внутри render().
    if (state.onWinResize) window.removeEventListener('resize', state.onWinResize);
    state.onWinResize = function () { if (state.tip) renderTip(); };
    window.addEventListener('resize', state.onWinResize);
    // Клик мимо виджета (по дашборду) закрывает поповер.
    if (state.onDocDown) document.removeEventListener('mousedown', state.onDocDown, true);
    state.onDocDown = function (ev) {
      if (!state.open || !overlay.parentNode) return;
      var n = ev.target;
      while (n) { if (n === overlay) return; n = n.parentNode; }
      state.open = '';
      state.q = '';
      render();
    };
    document.addEventListener('mousedown', state.onDocDown, true);

    // Ответ пришёл: эхо совпало с ожиданием — снимаем его; предупреждение
    // «самовлияние не настроено» гасит первый же ответ с тем же эхом.
    var echo = sigOf(reqEcho());
    if (state.pend && state.pend.sig === echo) state.pend = null;
    if (state.pend && Date.now() - state.pend.at > CFG.pendingWarnMs) { state.pend = null; state.warn = CFG.text.notApplied; }
    if (state.lastSig && state.lastSig === echo && state.warn === CFG.text.notApplied) state.warn = '';
    armPend();
    // Набранное применилось (ответ совпал с набором) — строка фильтров снова «чистая».
    if (state.stage && !stageDiff()) state.stage = null;

    render();
    // Ответ поиска по зоне: поповер открыт — курсор обратно в поле поиска.
    if (state.open === 'unit' || state.open === 'hrbp') focusPop();
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
