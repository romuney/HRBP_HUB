// ============================================================================
// СВОДНАЯ ТАБЛИЦА (Proteus/Superset) — 3 уровня, 3 метрики, months_values
// Итерация:
//  1. Бейджи полноты по узлам L0/L1 из SQL-метаданных.
//  2. Warning перенесён под заголовок (subtitle-row).
//  3. Единая типографика (best-practice для табличных дашбордов).
//  4. Заголовок «Разрез» может растягиваться в 2 строки, месяцы не трогаются.
//  5. Единая иерархия: шаг 20px, начиная от 0 (Итого/L0/L1/L2 = 0/20/40/60).
//  6. Переключатель метрики: Численность (серый) / Найм (зелёный) / Отток (фиолетовый).
// ============================================================================

// ---------- БЛОК 1: КОНФИГ ----------
var CFG = {
  fields: {
    param1: 'param1', param2: 'param2', param3: 'param3',
    param1_name: 'param1_name', param2_name: 'param2_name', param3_name: 'param3_name',
    date: 'business_dt_month',

    // Компактные ряды по периодам — по каждой метрике
    monthsByMetric: {
      hc:   'months_values_hc',
      hire: 'months_values_hire',
      attr: 'months_values_attr'
    },
    // Полный итог до лимита — по каждой метрике
    totalMonthsByMetric: {
      hc:   'months_values_total_hc',
      hire: 'months_values_total_hire',
      attr: 'months_values_total_attr'
    },

    // Метаданные полноты по узлам L0 / L1
    l1_total: 'l1_children_total',   l1_shown: 'l1_children_shown',   l1_complete: 'l1_is_complete',
    l2_total: 'l2_children_total',   l2_shown: 'l2_children_shown',   l2_complete: 'l2_is_complete',

    // Метаданные лимита
    total_groups: 'total_groups_before_limit',
    shown_groups: 'shown_groups',
    limit_flg:    'limit_rows_flg'
  },
  metrics: {
    hc:   { label: 'Численность', shortLabel: 'Числен.', unit: 'чел.',    color: '#c7c8cc', colorHover: '#9aa0ac',    colorBase: '#e7e9ee',  colorOverlay: '#9aa0ac'   },
    hire: { label: 'Найм',        shortLabel: 'Найм',    unit: 'чел.',    color: '#97dece',   colorHover: '#0ea293',   colorBase: '#bff2cd',  colorOverlay: '#009dae'   },
    attr: { label: 'Отток',       shortLabel: 'Отток',   unit: 'чел.',    color: '#ac87c5',   colorHover: '#8f69ab',   colorBase: '#f2eefc',  colorOverlay: '#8f69ab'   }
  },
  defaults: {
    metric: 'hc',
    granularity: 'month',
    mode: 'value',
    barsVisible: true,
    enableCopy: true
  },
  text: {
    title: 'Сводная таблица',
    totalLabel: 'Итого', totalAllLabel: 'Итого по всем',
    searchPlaceholder: 'Поиск', collapseAll: 'Свернуть все',
    metricLabel: 'Метрика:',
    granularityLabel: 'Гранулярность:',
    granMonth: 'Месяц', granQuarter: 'Квартал', granYear: 'Год',
    barsDynamics: 'Динамика', barsModeValue: 'Значение', barsModeShare: 'От общего',
    rowClickFilterHint: 'Клик по строке работает как фильтр',
    barsClear: 'Сбросить', noData: 'Нет данных',
    searchNoResults: 'По вашему запросу ничего не найдено',
    limitWarnPrefix: 'Показано',
    limitWarnMid: 'из',
    limitWarnSuffix: '. Используй фильтры, чтобы не терять данные в работе.',
    incompleteBadgeTitle: 'В группе показаны не все подстроки',
    completeBadgeTitle:   'В группе показаны все подстроки',
    barsShow: 'Включить тоталы', barsHide: 'Отключить тоталы',
    copyBtnTitle: 'Копировать в буфер (без итогов)',
    copySuccessMsg: 'Скопировано', copyErrorMsg: 'Ошибка копирования',
    copyGroupHeader: 'Разрез', copySubHeader: 'Подразрез',
    // Блокировка метрик при разрезах увольнений
    metricBlockedTitle: 'Метрика недоступна',
    metricBlockedText: 'При выбранных разрезах увольнений доступны только данные по оттоку. Метрики Численность и Найм не имеют смысла в контексте причин увольнения.',
    terminationSlices: ['инициатор увольнения', 'группа причин увольнений', 'причина увольнения']
  },
  bars: { height: 130 },
  monthsRu: ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек']
};



// ---------- DESIGN TOKENS: TeamPulse ----------
var DESIGN_TOKENS_CSS = [
  ':root{',
  '  --bg:#f4f5f7;',
  '  --card:#ffffff;',
  '  --line:#e7e9ee;',
  '  --line2:#eef0f3;',
  '  --ink:#1f1f1f;',
  '  --ink2:#3a3f4a;',
  '  --muted:#8a909c;',
  '  --muted2:#aab0bb;',
  '  --green:#12b048; --green-bg:#bff2cd; --green-tx:#0a8f3c;',
  '  --red:#f51f1f; --red-bg:#ffcccc; --red-tx:#d11414;',
  '  --warn:#f59300; --warn-bg:#ffe6a0; --warn-tx:#9a6500;',
  '  --blue:#3b6fe0; --blue-bg:#eef3fe; --act:#2b6cff;',
  '  --ai:#6f4ed8; --ai-bg:#f2eefc; --ai-tx:#5334c4;',
  '  --bench:#9aa0ac;',
  '  --s1:2px; --s2:4px; --s3:6px; --s4:8px; --s5:10px;',
  '  --s6:12px; --s7:14px; --s8:16px; --s9:20px; --s10:24px;',
  '  --fs-micro:9.5px;',
  '  --fs-cap:10.5px;',
  '  --fs-note:11.5px;',
  '  --fs-body:12.5px;',
  '  --fs-lead:13.5px;',
  '  --fs-head:16px;',
  '  --fs-hero:24px;',
  '  --r1:3px; --r2:6px; --r3:9px; --r4:12px; --r5:16px; --r-pill:999px;',
  '  --radius:var(--r4);',
  '  --pad-cell:var(--s5);',
  '  --shadow:0 1px 3px rgba(20,28,45,.06),0 4px 16px rgba(20,28,45,.04);',
  '  --shadow-lg:0 8px 28px rgba(20,28,45,.16);',
  '  --head-h:51px;',
  '  --chart-gap:26px;',
  '}'
].join('\n');

// ---------- БЛОК 2: ВХОД + РАЗВОРАЧИВАНИЕ months_values ----------
var rawData = [];
if (typeof data !== 'undefined' && Array.isArray(data)) rawData = data;

var sourceData = Array.isArray(rawData) ? rawData.slice() : [];

var limitInfo = { total: null, shown: null, limited: false };
// completeness: { "param1": {shown, total, complete}, "param1\u0001param2": {...} }
var completenessByPath = {};
// countByPath: сколько подстрок под каждым узлом (для счётчика возле названия)
var countByPath = {};

function parseYYYYMMToDate(code) {
  var s = String(code == null ? '' : code).trim();
  if (!/^\d{6}$/.test(s)) return null;
  return s.substring(0, 4) + '-' + s.substring(4, 6) + '-01';
}
function cleanTextValue(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '—';
  return String(v).trim();
}

var SEP = '\u0001';

function expandMonthsValues(inputRows, metricKey) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) return [];
  var F = CFG.fields;
  var monthsField = F.monthsByMetric[metricKey] || F.monthsByMetric.hc;
  var expanded = [];
  var hasCompact = false;

  // Сначала соберём метаданные из всей выборки
  inputRows.forEach(function(r) {
    if (!r) return;
    if (r[F.total_groups] != null) limitInfo.total = Number(r[F.total_groups]);
    if (r[F.shown_groups] != null) limitInfo.shown = Number(r[F.shown_groups]);
    if (Number(r[F.limit_flg] || 0) === 1) limitInfo.limited = true;

    var p1 = cleanTextValue(r[F.param1]);
    var p2 = cleanTextValue(r[F.param2]);

    // L0 completeness
    if (r[F.l1_total] != null && r[F.l1_shown] != null) {
      var l1t = Number(r[F.l1_total]);
      var l1s = Number(r[F.l1_shown]);
      if (!completenessByPath[p1]) {
        completenessByPath[p1] = {
          shown: l1s, total: l1t,
          complete: (Number(r[F.l1_complete] || 0) === 1) || l1s >= l1t
        };
      }
    }
    // L1 completeness
    if (r[F.l2_total] != null && r[F.l2_shown] != null) {
      var key = p1 + SEP + p2;
      var l2t = Number(r[F.l2_total]);
      var l2s = Number(r[F.l2_shown]);
      if (!completenessByPath[key]) {
        completenessByPath[key] = {
          shown: l2s, total: l2t,
          complete: (Number(r[F.l2_complete] || 0) === 1) || l2s >= l2t
        };
      }
    }
  });

  // Разворачиваем months_values текущей метрики
  inputRows.forEach(function(r) {
    if (!r) return;
    var mv = r[monthsField];
    if (mv !== null && mv !== undefined && String(mv).trim() !== '') {
      hasCompact = true;
      String(mv).split(';').forEach(function(pair) {
        pair = String(pair || '').trim();
        if (!pair) return;
        var idx = pair.indexOf(':');
        if (idx < 0) return;
        var dateStr = parseYYYYMMToDate(pair.substring(0, idx));
        if (!dateStr) return;
        var val = Number(String(pair.substring(idx + 1)).replace(',', '.'));
        if (isNaN(val)) val = 0;
        expanded.push({
          param1: cleanTextValue(r[F.param1]),
          param2: cleanTextValue(r[F.param2]),
          param3: cleanTextValue(r[F.param3]),
          param1_name: r[F.param1_name],
          param2_name: r[F.param2_name],
          param3_name: r[F.param3_name],
          business_dt_month: dateStr,
          emp_cnt: val
        });
      });
    } else if (!hasCompact) {
      // fallback: если данные пришли в развёрнутом виде
      expanded.push(r);
    }
  });
  return expanded;
}

// Полный итог по периодам из total_months (метрика зависимая)
function parseCompactMonthsMap(str) {
  var out = {};
  if (str == null || String(str).trim() === '') return out;
  String(str).split(';').forEach(function(pair) {
    pair = String(pair || '').trim();
    if (!pair) return;
    var idx = pair.indexOf(':');
    if (idx < 0) return;
    var code = pair.substring(0, idx).trim();
    var val = Number(String(pair.substring(idx + 1)).replace(',', '.'));
    if (isNaN(val)) val = 0;
    if (!/^\d{6}$/.test(code)) return;
    out[code] = val;
  });
  return out;
}
function bucketKeyFromYYYYMM(code, g) {
  var y = code.substring(0, 4), m = parseInt(code.substring(4, 6), 10);
  if (g === 'year') return y;
  if (g === 'quarter') return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
  return y + '-' + code.substring(4, 6);
}
function buildTotalAggFromSql(g, metricKey, srcRows) {
  var out = {};
  if (!Array.isArray(srcRows) || srcRows.length === 0) return out;
  var field = CFG.fields.totalMonthsByMetric[metricKey];
  if (!field) return out;
  var first = null;
  for (var i = 0; i < srcRows.length; i++) {
    if (srcRows[i] && srcRows[i][field]) { first = srcRows[i][field]; break; }
  }
  if (!first) return out;
  var m = parseCompactMonthsMap(first);
  // Для stock-метрики (hc) в квартал/год берём значение последнего месяца в бакете,
  // для flow-метрик (hire/attr) — обычную сумму.
  var stock = (metricKey === 'hc');
  if (stock) {
    var latestByBk = {}; // bk -> { mk: 'YYYYMM', v: N }
    Object.keys(m).forEach(function(code) {
      var bk = bucketKeyFromYYYYMM(code, g);
      var cur = latestByBk[bk];
      if (!cur || code > cur.mk) latestByBk[bk] = { mk: code, v: m[code] };
    });
    Object.keys(latestByBk).forEach(function(bk) { out[bk] = latestByBk[bk].v; });
  } else {
    Object.keys(m).forEach(function(code) {
      var bk = bucketKeyFromYYYYMM(code, g);
      out[bk] = (out[bk] || 0) + m[code];
    });
  }
  return out;
}

// Сохранение состояния между перерисовками (фильтры/разрезы в Proteus)
// При обновлении данных от Proteus (изменение фильтров/разрезов) скрипт выполняется заново,
// поэтому читаем настройки из window.__pvtState — они должны сохраниться от предыдущей перерисовки.
if (!window.__pvtState) window.__pvtState = {};
var savedState = window.__pvtState;
var currentMetric = savedState.metric || CFG.defaults.metric;
var currentMetrics = savedState.metrics || [currentMetric];
var currentGranularity = savedState.granularity || CFG.defaults.granularity;
var currentMode = savedState.mode || CFG.defaults.mode;
var currentBarsVisible = savedState.barsVisible !== undefined ? savedState.barsVisible : CFG.defaults.barsVisible;
var currentSort = savedState.sort || null;

// Немедленно сохраняем настройки обратно — защищаем от сброса при следующем обновлении данных
// Это нужно, чтобы при изменении фильтров/разрезов в Proteus настройки не терялись
window.__pvtState.metric = currentMetric;
window.__pvtState.metrics = currentMetrics;
window.__pvtState.granularity = currentGranularity;
window.__pvtState.mode = currentMode;
window.__pvtState.barsVisible = currentBarsVisible;
window.__pvtState.sort = currentSort;

// ---------- БЛОК 2.1: БЛОКИРОВКА МЕТРИК ПРИ РАЗРЕЗАХ УВОЛЬНЕНИЙ ----------
// Определяет, какие метрики заблокированы при текущих разрезах
function getBlockedMetrics() {
  // Если sourceData пуст — ещё не знаем разрезы, возвращаем пустой массив
  if (!sourceData || sourceData.length === 0) return [];
  
  var F = CFG.fields;
  var blocked = [];
  var hasTerminationSlice = false;
  
  // Проверяем названия разрезов на наличие терминов увольнений
  var sampleRow = sourceData[0] || {};
  var levelNames = [
    sampleRow[F.param1_name] || '',
    sampleRow[F.param2_name] || '',
    sampleRow[F.param3_name] || ''
  ];
  
  var terminationTerms = CFG.text.terminationSlices || [];
  for (var i = 0; i < levelNames.length; i++) {
    var name = String(levelNames[i] || '').toLowerCase().trim();
    for (var j = 0; j < terminationTerms.length; j++) {
      if (name.indexOf(String(terminationTerms[j]).toLowerCase()) >= 0) {
        hasTerminationSlice = true;
        break;
      }
    }
    if (hasTerminationSlice) break;
  }
  
  // Если есть разрез увольнений — блокируем HC и Hire, оставляем только Attr
  if (hasTerminationSlice) {
    blocked.push('hc');
    blocked.push('hire');
  }
  
  return blocked;
}

// Проверяет, заблокирована ли конкретная метрика
function isMetricBlocked(metricKey) {
  var blocked = getBlockedMetrics();
  return blocked.indexOf(metricKey) >= 0;
}

// Автоматическая коррекция текущей метрики, если она заблокирована
(function autoAdjustBlockedMetric() {
  var blocked = getBlockedMetrics();
  if (blocked.length === 0) return; // Нет блокировок
  
  // Если текущая метрика заблокирована — переключаемся на первую доступную
  if (blocked.indexOf(currentMetric) >= 0) {
    var available = ['hc', 'hire', 'attr'].filter(function(mk) {
      return blocked.indexOf(mk) < 0;
    });
    if (available.length > 0) {
      currentMetric = available[0];
      currentMetrics = [available[0]];
    }
  }
  
  // Также убираем заблокированные метрики из currentMetrics
  if (currentMetrics.length > 0) {
    currentMetrics = currentMetrics.filter(function(mk) {
      return blocked.indexOf(mk) < 0;
    });
    // Если после фильтрации не осталось метрик — берём первую доступную
    if (currentMetrics.length === 0) {
      var available = ['hc', 'hire', 'attr'].filter(function(mk) {
        return blocked.indexOf(mk) < 0;
      });
      if (available.length > 0) {
        currentMetrics = [available[0]];
        currentMetric = available[0];
      }
    } else {
      // Обновляем primary metric
      currentMetric = currentMetrics[0];
    }
  }
})();

// Начальный разворот — под метрику по умолчанию (первичная метрика)
rawData = expandMonthsValues(rawData, currentMetric);

// Счётчики детей по узлам (для цифры возле названия) — считаем один раз по sourceData
// Исправлено: динамический подсчёт по реальным непустым уровням, а не фиксированным p1/p2/p3
(function computeChildrenCounts() {
  var F = CFG.fields;
  // childrenCount[path] = количество уникальных непосредственных детей у узла
  var childrenCount = {};
  sourceData.forEach(function(r) {
    if (!r) return;
    // Собираем все реальные (непустые) значения уровней в порядке иерархии
    var levels = [];
    var p1 = cleanTextValue(r[F.param1]);
    var p2 = cleanTextValue(r[F.param2]);
    var p3 = cleanTextValue(r[F.param3]);
    if (p1 && p1 !== '—') levels.push(p1);
    if (p2 && p2 !== '—') levels.push(p2);
    if (p3 && p3 !== '—') levels.push(p3);
    // Для каждого префикса пути считаем следующего ребёнка
    for (var i = 0; i < levels.length - 1; i++) {
      var parentPath = levels.slice(0, i + 1).join(SEP);
      var childValue = levels[i + 1];
      if (!childrenCount[parentPath]) childrenCount[parentPath] = {};
      childrenCount[parentPath][childValue] = true;
    }
  });
  // Преобразуем в количество уникальных детей
  Object.keys(childrenCount).forEach(function(path) {
    countByPath[path] = Object.keys(childrenCount[path]).length;
  });
})();

if (rawData.length === 0) {
  option = {
    animation: false,
    graphic: [{ type: 'text', left: 10, top: 10, style: { text: CFG.text.noData, fill: '#c00', font: '14px monospace' } }]
  };
} else {

  // ---------- БЛОК 3: АВТОДЕТЕКТ УРОВНЕЙ ----------
  var F = CFG.fields;
  var PLACEHOLDERS = { '': 1, '—': 1, '-': 1, 'все': 1, 'всё': 1, 'all': 1, 'n/a': 1, 'null': 1 };
  function isRealValue(raw) {
    if (raw === null || raw === undefined) return false;
    var s = String(raw).trim();
    if (s === '') return false;
    if (PLACEHOLDERS[s.toLowerCase()]) return false;
    return true;
  }
  function distinctRealCount(field) {
    var seen = {}, count = 0;
    for (var i = 0; i < rawData.length; i++) {
      var raw = rawData[i][field];
      if (!isRealValue(raw)) continue;
      var s = String(raw).trim();
      if (!seen[s]) { seen[s] = true; count++; if (count > 1) return count; }
    }
    return count;
  }
  function levelActive(field, isFirst) {
    var c = distinctRealCount(field);
    return isFirst ? (c >= 1) : (c > 1);
  }
  var levels = [];
  if (levelActive(F.param1, true))  levels.push({ field: F.param1, nameField: F.param1_name, fallbackName: 'param1' });
  if (levelActive(F.param2, false)) levels.push({ field: F.param2, nameField: F.param2_name, fallbackName: 'param2' });
  if (levelActive(F.param3, false)) levels.push({ field: F.param3, nameField: F.param3_name, fallbackName: 'param3' });
  if (levels.length === 0) levels.push({ field: F.param1, nameField: F.param1_name, fallbackName: 'param1' });
  var LEVELS = levels.length;
  var sample = rawData[0] || {};
  var levelNames = levels.map(function(lv) {
    var n = sample[lv.nameField];
    if (n === null || n === undefined || String(n).trim() === '') return lv.fallbackName || lv.field;
    return String(n).trim();
  });

  // ---------- БЛОК 4: НОРМАЛИЗАЦИЯ ----------
  function normalizeDate(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    var s = String(raw).trim();
    if (/^\d{6}$/.test(s)) return parseYYYYMMToDate(s);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
    if (typeof raw === 'number' || /^\d+$/.test(s)) {
      var ts = Number(raw);
      if (ts > 1e12) ts = Math.floor(ts / 1000);
      if (ts > 1000000000) {
        var d = new Date(ts * 1000);
        var y = d.getUTCFullYear();
        var m = String(d.getUTCMonth() + 1); if (m.length < 2) m = '0' + m;
        var dd = String(d.getUTCDate()); if (dd.length < 2) dd = '0' + dd;
        return y + '-' + m + '-' + dd;
      }
    }
    return s.substring(0, 10);
  }
  function normalizeRawData(arr) {
    arr.forEach(function(r) {
      for (var li = 0; li < LEVELS; li++) r[levels[li].field] = cleanTextValue(r[levels[li].field]);
      r[F.date] = normalizeDate(r[F.date]);
      r.emp_cnt = (r.emp_cnt === null || r.emp_cnt === undefined || isNaN(Number(r.emp_cnt))) ? 0 : Number(r.emp_cnt);
    });
  }
  normalizeRawData(rawData);

  // ---------- БЛОК 5: БАКЕТЫ ----------
  function bucketKey(dateStr, g) {
    if (!dateStr) return null;
    var p = String(dateStr).split('-'); if (p.length < 2) return null;
    var y = p[0], m = parseInt(p[1], 10);
    if (!y || isNaN(m)) return null;
    if (g === 'year') return y;
    if (g === 'quarter') return y + '-Q' + (Math.floor((m - 1) / 3) + 1);
    return y + '-' + p[1];
  }
  function bucketLabel(key, g) {
    if (!key) return '';
    if (g === 'year') return key;
    if (g === 'quarter') { var qp = key.split('-Q'); return 'Q' + qp[1] + ' ' + qp[0]; }
    var mp = key.split('-'); return CFG.monthsRu[parseInt(mp[1], 10) - 1] + ' ' + mp[0];
  }
  function bucketOrder(key, g) {
    if (!key) return 999999999;
    if (g === 'year') return parseInt(key, 10) * 10000;
    if (g === 'quarter') { var qp = key.split('-Q'); return parseInt(qp[0], 10) * 10000 + parseInt(qp[1], 10) * 100; }
    var mp = key.split('-'); return parseInt(mp[0], 10) * 10000 + parseInt(mp[1], 10) * 100;
  }

  // ---------- БЛОК 6: АГРЕГАЦИЯ ----------
  // stock-метрики (например численность) агрегируются в квартал/год как значение
  // последнего месяца в бакете, а не как SUM — иначе одни и те же люди сложатся
  // трижды. flow-метрики (найм, отток) агрегируются обычным SUM.
  function isStockMetric(metricKey) { return metricKey === 'hc'; }

  function buildAggregation(g, metricKey) {
    var bucketSet = {}, totalAgg = {}, pathAgg = {}, childrenSet = {};
    var stock = isStockMetric(metricKey);
    // Для stock: сохраняем помесячные срезы и позднейший месяц в бакете
    // stockLatest[bk][pathOr''] = { monthKey: 'YYYY-MM', value: N }
    var stockLatestTotal = {}; // { bk: { monthKey, value } }
    var stockLatestPath  = {}; // { path: { bk: { monthKey, value } } }
    childrenSet[''] = {};

    function monthKeyFromDate(dateStr) {
      // 'YYYY-MM-DD' -> 'YYYY-MM'
      if (!dateStr) return null;
      var p = String(dateStr).split('-');
      if (p.length < 2) return null;
      return p[0] + '-' + p[1];
    }

    rawData.forEach(function(r) {
      var bk = bucketKey(r[F.date], g);
      if (!bk) return;
      var v = Number(r.emp_cnt || 0);
      var mk = monthKeyFromDate(r[F.date]);
      bucketSet[bk] = true;

      if (stock) {
        // Итого: сумма по всем разрезам в пределах ОДНОГО месяца, потом latest month в бакете
        // Собираем через промежуточную мапу: stockLatestTotal[bk][monthKey] = sum по всем разрезам
        if (!stockLatestTotal[bk]) stockLatestTotal[bk] = { _byMonth: {} };
        stockLatestTotal[bk]._byMonth[mk] = (stockLatestTotal[bk]._byMonth[mk] || 0) + v;
      } else {
        totalAgg[bk] = (totalAgg[bk] || 0) + v;
      }

      var parentPath = '';
      for (var li = 0; li < LEVELS; li++) {
        var val = cleanTextValue(r[levels[li].field]);
        if (!childrenSet[parentPath]) childrenSet[parentPath] = {};
        childrenSet[parentPath][val] = true;
        var path = parentPath === '' ? val : (parentPath + SEP + val);

        if (stock) {
          // Для группы (не листа) агрегируем в пределах месяца по всем детям
          if (!stockLatestPath[path]) stockLatestPath[path] = {};
          if (!stockLatestPath[path][bk]) stockLatestPath[path][bk] = { _byMonth: {} };
          stockLatestPath[path][bk]._byMonth[mk] = (stockLatestPath[path][bk]._byMonth[mk] || 0) + v;
        } else {
          if (!pathAgg[path]) pathAgg[path] = {};
          pathAgg[path][bk] = (pathAgg[path][bk] || 0) + v;
        }
        parentPath = path;
      }
    });

    // Свернуть stock: latest month в каждом бакете
    if (stock) {
      Object.keys(stockLatestTotal).forEach(function(bk) {
        var byMonth = stockLatestTotal[bk]._byMonth;
        var maxMk = null;
        Object.keys(byMonth).forEach(function(mk) { if (maxMk === null || mk > maxMk) maxMk = mk; });
        totalAgg[bk] = maxMk ? byMonth[maxMk] : 0;
      });
      Object.keys(stockLatestPath).forEach(function(path) {
        if (!pathAgg[path]) pathAgg[path] = {};
        Object.keys(stockLatestPath[path]).forEach(function(bk) {
          var byMonth = stockLatestPath[path][bk]._byMonth;
          var maxMk = null;
          Object.keys(byMonth).forEach(function(mk) { if (maxMk === null || mk > maxMk) maxMk = mk; });
          pathAgg[path][bk] = maxMk ? byMonth[maxMk] : 0;
        });
      });
    }

    // Подмена totalAgg на полный итог из SQL (если доступен) — Итого до лимита
    var sqlTotalAgg = buildTotalAggFromSql(g, metricKey, sourceData);
    if (Object.keys(sqlTotalAgg).length) {
      Object.keys(sqlTotalAgg).forEach(function(bk) { bucketSet[bk] = true; });
      totalAgg = sqlTotalAgg;
    }

    var buckets = Object.keys(bucketSet).sort(function(a, b) { return bucketOrder(a, g) - bucketOrder(b, g); });
    var childrenSorted = {};
    Object.keys(childrenSet).forEach(function(pp) {
      childrenSorted[pp] = Object.keys(childrenSet[pp]).sort(function(a, b) {
        return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
      });
    });
    return { buckets: buckets, totalAgg: totalAgg, pathAgg: pathAgg, childrenSorted: childrenSorted };
  }

  // ---------- БЛОК 7: ФОРМАТ ----------
  function fmt(v) {
    if (v === null || v === undefined || isNaN(v)) return '0';
    var n = Number(v); if (n === 0) return '0';
    var rounded = Math.round(n * 10) / 10;
    var hasDec = Math.abs(rounded - Math.round(rounded)) > 0.000001;
    var s = hasDec ? String(rounded).replace('.', ',') : String(Math.round(rounded));
    var sign = ''; if (s.charAt(0) === '-') { sign = '-'; s = s.substring(1); }
    var parts = s.split(','); parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return sign + parts.join(',');
  }
  // Компактный формат для лейблов барчартов: используется ТОЛЬКО в SVG над барами.
  // По требованию UX — десятичный разделитель здесь ТОЧКА (в отличие от fmt(), где запятая).
  function fmtCompact(value) {
    if (value == null || isNaN(value)) return '0';
    var abs = Math.abs(value);
    function one(v, suf) { return String(Math.round(v * 10) / 10) + suf; } // точка как в JS-числах
    if (abs >= 1e9) return one(value / 1e9, 'B');
    if (abs >= 1e6) return one(value / 1e6, 'M');
    if (abs >= 1e3) return one(value / 1e3, 'K');
    // Для маленьких значений — целое или с точкой (без пробельных разделителей тысяч)
    var n = Number(value);
    var rounded = Math.round(n * 10) / 10;
    var hasDec = Math.abs(rounded - Math.round(rounded)) > 0.000001;
    return hasDec ? String(rounded) : String(Math.round(rounded));
  }

  // ---------- БЛОК 8: СТРОКИ (mono/multi-метрика) ----------
  // Собирает агрегации по всем активным метрикам в единую структуру.
  // rawDataByMetric[mk] — развёрнутые данные для метрики; обновляется в верхнем слое.
  var rawDataByMetric = {};
  rawDataByMetric[currentMetric] = rawData;

  // Строим агрегацию для конкретной метрики, временно подменяя rawData
  function buildAggregationForMetric(g, metricKey) {
    var saved = rawData;
    rawData = rawDataByMetric[metricKey] || saved;
    var A;
    try { A = buildAggregation(g, metricKey); }
    finally { rawData = saved; }
    return A;
  }

  // Построение табличных строк: каждый бакет → N значений (по числу активных метрик).
  // Сортировка — по основной метрике (primaryMetric).
  function buildTableRows(g, metricsArr, sortState, primaryMetric) {
    var metrics = metricsArr && metricsArr.length ? metricsArr : [primaryMetric];
    // Собираем агрегации по всем метрикам
    var aggByMetric = {};
    var bucketSet = {};
    metrics.forEach(function(mk) {
      var A = buildAggregationForMetric(g, mk);
      aggByMetric[mk] = A;
      A.buckets.forEach(function(bk) { bucketSet[bk] = true; });
    });
    // Объединяем бакеты (union) и сортируем
    var buckets = Object.keys(bucketSet).sort(function(a, b) { return bucketOrder(a, g) - bucketOrder(b, g); });

    // Объединяем childrenSorted по всем метрикам (union) — возможно какие-то точки есть лишь в одной из них
    var childrenSet = {};
    metrics.forEach(function(mk) {
      var cs = aggByMetric[mk].childrenSorted || {};
      Object.keys(cs).forEach(function(pp) {
        if (!childrenSet[pp]) childrenSet[pp] = {};
        cs[pp].forEach(function(v) { childrenSet[pp][v] = true; });
      });
    });
    var childrenSorted = {};
    Object.keys(childrenSet).forEach(function(pp) {
      childrenSorted[pp] = Object.keys(childrenSet[pp]).sort(function(a, b) {
        return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
      });
    });

    var rows = [];
    // Helpers: получить значение по (metric, path, bk)
    function getVal(mk, path, bk) {
      var A = aggByMetric[mk];
      if (path === '') return (A.totalAgg[bk] || 0);
      return (A.pathAgg[path] && A.pathAgg[path][bk]) || 0;
    }
    // Плоский список values/raw: для каждого бакета по M значений подряд
    function makeValues(path) {
      var out = [], raw = [];
      buckets.forEach(function(bk) {
        metrics.forEach(function(mk) {
          var v = getVal(mk, path, bk);
          raw.push(v);
          out.push(fmt(v));
        });
      });
      return { values: out, raw: raw };
    }
    // header (не используется как отдельная DOM-строка; оставлено для computeWidths)
    rows.push({ type: 'header', label: '', values: buckets.map(function(bk) { return bucketLabel(bk, g); }) });

    var totalVals = makeValues('');
    rows.push({ type: 'total', label: CFG.text.totalLabel, path: '',
                values: totalVals.values, raw: totalVals.raw });

    // Сортировка: по primary-метрике (берем aggByMetric[primary])
    var Aprimary = aggByMetric[primaryMetric] || aggByMetric[metrics[0]];
    var sortBk = (sortState && sortState.bucketKey) || (buckets.length ? buckets[buckets.length - 1] : null);
    var sortDir = (sortState && sortState.dir) || 'desc';
    var mult = sortDir === 'asc' ? 1 : -1;
    function sortValues(values, parentPath) {
      return values.slice().sort(function(a, b) {
        var pa = parentPath === '' ? a : (parentPath + SEP + a);
        var pb = parentPath === '' ? b : (parentPath + SEP + b);
        var va = (Aprimary.pathAgg[pa] && Aprimary.pathAgg[pa][sortBk]) || 0;
        var vb = (Aprimary.pathAgg[pb] && Aprimary.pathAgg[pb][sortBk]) || 0;
        if (va === vb) return String(a).toLowerCase().localeCompare(String(b).toLowerCase());
        return (va - vb) * mult;
      });
    }
    function pushNode(depth, parentPath, value) {
      var path = parentPath === '' ? value : (parentPath + SEP + value);
      var isLeaf = depth === LEVELS - 1;
      var vals = makeValues(path);
      rows.push({
        type: isLeaf ? 'leaf' : ('level' + depth), depth: depth, label: value, path: path,
        values: vals.values, raw: vals.raw
      });
      if (!isLeaf) sortValues(childrenSorted[path] || [], path).forEach(function(cv) { pushNode(depth + 1, path, cv); });
    }
    sortValues(childrenSorted[''] || [], '').forEach(function(rv) { pushNode(0, '', rv); });

    return {
      rows: rows, buckets: buckets, granularity: g,
      metrics: metrics, aggByMetric: aggByMetric, aggregation: Aprimary,
      sortBucket: sortBk, sortDir: sortDir
    };
  }

  // Переменные уже объявлены выше (строки 235-238) — не перезаписываем!
  // currentGranularity, currentMode, currentSort, currentBarsVisible сохраняются из window.__pvtState

  // ---------- БЛОК 9: ТЕКСТ / ИКОНКИ ----------
  var measureCanvas = document.createElement('canvas');
  var measureCtx = measureCanvas.getContext('2d');
  function measureText(text, bold) {
    measureCtx.font = (bold ? '600' : '400') + ' 13px Inter,Helvetica,Arial,sans-serif';
    return measureCtx.measureText(text || '').width;
  }
  var ICON_SEARCH = '<svg class="pvt-search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3 3"/></svg>';
  var ICON_CARET = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 3 L5 7 L8 3 Z"/></svg>';
  var ICON_CARET_HEADER = '<svg class="pvt-hdr-caret" width="11" height="11" viewBox="0 0 10 10" fill="currentColor"><path d="M2 3 L5 7 L8 3 Z"/></svg>';
  var ICON_BARS = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="9" width="2.4" height="5" rx="0.5"/><rect x="5.6" y="6" width="2.4" height="8" rx="0.5"/><rect x="9.2" y="3" width="2.4" height="11" rx="0.5"/><rect x="12.8" y="7" width="2.4" height="7" rx="0.5"/></svg>';
  var ICON_BARS_OFF = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><g fill="currentColor"><rect x="2" y="9" width="2.4" height="5" rx="0.5"/><rect x="5.6" y="6" width="2.4" height="8" rx="0.5"/><rect x="9.2" y="3" width="2.4" height="11" rx="0.5"/><rect x="12.8" y="7" width="2.4" height="7" rx="0.5"/></g><path d="M1 15 L15 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  var ICON_COPY = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.2"/><path d="M11 5 V3.2 A1.2 1.2 0 0 0 9.8 2 H3.2 A1.2 1.2 0 0 0 2 3.2 V9.8 A1.2 1.2 0 0 0 3.2 11 H5"/></svg>';
  var ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 L6.5 12 L13 4"/></svg>';
  var ICON_WARN = '<svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor" style="vertical-align:-1px;margin-right:4px;"><path d="M8 1 L15 14 L1 14 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="7.3" y="6" width="1.4" height="4.5" rx="0.5"/><rect x="7.3" y="11.2" width="1.4" height="1.4" rx="0.5"/></svg>';

  // ---------- БЛОК 10: CSS ----------
  // Единая типография: заголовок 16/600, метка 12/500, значения 13/tabular, тулбар 13/400
  var BAR_H = 120; // высота барчартов для блока с подсказкой/кнопкой/динамикой
  var STEP = 20;   // единый шаг иерархии
  var CARET_W = 14;
  // отступы: Итого(depth=-1)=0, L0=0, L1=20, L2=40 — но нужны отступы «после каретки»
  // Реально базовый left padding = 12, каждый следующий уровень += 20
  var BASE_PAD = 12;

  var css = [
    '<style>',
    DESIGN_TOKENS_CSS,
    // Root & typography scale
    '.pvt-root{width:100%;height:100%;font-family:Inter,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--card);display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;font-size:14px;line-height:1.45;}',
    '.pvt-root *,.pvt-root *::before,.pvt-root *::after{box-sizing:border-box;}',

    // Toolbar — 2 строки: 1) контролы, 2) подсказки
    '.pvt-toolbar{display:flex;flex-direction:column;padding:10px 16px 10px 16px;background:var(--card);border-bottom:1px solid var(--line2);flex-shrink:0;box-shadow:var(--shadow);}',
    '.pvt-toolbar-filter-row{display:flex;align-items:center;justify-content:flex-start;gap:12px;margin-top:8px;min-height:0;}',
    '.pvt-toolbar-filter-row.has-filter{margin-top:8px;min-height:18px;}',
    '.pvt-toolbar-row{display:flex;align-items:flex-end;gap:12px;position:relative;flex-wrap:nowrap;}',
    '.pvt-title-wrap{display:flex;align-items:center;height:37px;margin-top:0;flex-shrink:0;}',
    '.pvt-control-group.pvt-metric-group{margin-left:auto;flex-shrink:0;}',
    '.pvt-control-group.pvt-gran-group{margin-left:12px;flex-shrink:0;}',
    '.pvt-search{margin-left:12px;flex-shrink:1;flex-basis:220px;min-width:120px;}',
    '.pvt-title{font-size:14px;font-weight:700;color:var(--ink);letter-spacing:-0.2px;align-self:center;white-space:nowrap;flex-shrink:0;}',
    '.pvt-control-group{display:flex;flex-direction:column;align-items:flex-start;gap:4px;}',
    '.pvt-control-label{font:600 12px Inter,Helvetica,Arial,sans-serif;color:var(--muted);white-space:nowrap;}',
    '.pvt-segmented{display:inline-flex;align-items:center;gap:4px;flex-wrap:wrap;background:#eef0f3;border-radius:var(--r4);padding:3px;overflow:visible;box-shadow:none;}',
    '.pvt-segmented button{border:0;background:transparent;border-radius:var(--r3);padding:8px 15px;font-weight:700;color:var(--muted);cursor:pointer;font-size:var(--fs-body,12.5px);display:inline-flex;align-items:center;gap:8px;transition:background .15s,color .15s,box-shadow .15s;white-space:nowrap;}',
    '.pvt-segmented button:hover{color:var(--ink2);background:transparent;}',
    '.pvt-segmented button.active{background:#fff;color:var(--ink);box-shadow:var(--shadow);}',
    '.pvt-segmented button.active:hover{background:#fff;color:var(--ink);}',
    '.pvt-metric-chip{display:inline-flex;align-items:center;gap:8px;pointer-events:none;}',
    '.pvt-segmented button.active .pvt-metric-chip::before{content:"";width:10px;height:10px;border-radius:var(--r1);background:var(--m-color,#888);box-shadow:inset 0 0 0 1px rgba(255,255,255,.28);flex:0 0 auto;}',
    // Заблокированные метрики — серые, без кликабельности
    '.pvt-segmented button.pvt-metric-blocked{opacity:.5;cursor:not-allowed;pointer-events:none;background:transparent;color:var(--muted);box-shadow:none;}',
    '.pvt-segmented button.pvt-metric-blocked:hover{background:transparent;color:var(--muted);}',
    // Тултипы для кнопок (мгновенный показ 0.1s, появляются ПОД кнопками)
    '.pvt-btn[data-tooltip],.pvt-segmented button[data-tooltip]{position:relative;}',
    '.pvt-btn[data-tooltip]::after,.pvt-segmented button[data-tooltip]::after{content:attr(data-tooltip);position:absolute;top:100%;right:0;left:auto;transform:none;background:rgba(31,31,31,.96);color:#fff;padding:8px 10px;border-radius:10px;font:12px Inter,Helvetica,Arial,sans-serif;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s ease;margin-top:8px;box-shadow:var(--shadow-lg);z-index:10000;text-align:right;}',
    '.pvt-btn[data-tooltip]:hover::after,.pvt-segmented button[data-tooltip]:hover::after{opacity:1;}',
    '.pvt-subtitle-row{display:flex;align-items:center;gap:10px;padding:6px 16px 10px 16px;background:var(--card);flex-shrink:0;min-height:30px;font-size:12px;color:var(--muted);}',
    '.pvt-subtitle-row.empty{padding:0;min-height:0;}',
    '.pvt-warn{display:inline-flex;align-items:center;font:600 12px Inter,Helvetica,Arial,sans-serif;color:var(--warn-tx);background:var(--warn-bg);border:1px solid var(--warn);border-radius:999px;padding:4px 10px;}',
    // Линия под toolbar — padding 4px сверху и снизу
    '.pvt-toolbar + .pvt-scroll{border-top:1px solid var(--line2);margin-top:4px;padding-top:6px;}',
    // Bars title — подсказка и переключатели слева, без второй линии и без absolute-позиционирования
    '.pvt-bars-title{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:12px 16px 6px 16px;background:var(--card);position:sticky;top:0;z-index:5;box-shadow:none;}',
    '.pvt-bars-title.is-filtered{padding-bottom:6px;}',
    '.pvt-bars-top-row{display:flex;align-items:center;gap:10px;width:auto;}',
    '.pvt-bars-top-row b{font-size:14px;font-weight:700;color:var(--ink);}',
    '.pvt-bars-filter-row{display:flex;align-items:center;gap:8px;width:auto;min-height:18px;margin-top:0;}',
    '.pvt-bars-filter-label{font-size:12px;color:var(--act);font-weight:600;display:none;}',
    '.pvt-bars-mode-hint{position:static;font:12px Inter,Helvetica,Arial,sans-serif;color:var(--muted);white-space:nowrap;}',
    '.pvt-bars-mode-row{display:flex;align-items:center;position:static;}',
    '.pvt-bars-mode-hint{position:static;font:12px Inter,Helvetica,Arial,sans-serif;color:var(--muted);white-space:nowrap;}',

    // Controls: одинаковый стиль всех кнопок и селектов, 13px/400
    '.pvt-control-label{font:600 12px Inter,Helvetica,Arial,sans-serif;color:var(--muted);white-space:nowrap;}',
    '.pvt-btn{border:1px solid var(--line);background:#fff;border-radius:var(--r3);padding:8px 14px;font-weight:600;color:var(--ink2);cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:7px;transition:background .15s,border-color .15s;user-select:none;}',
    '.pvt-btn:hover{background:#fafbfc;border-color:#d8dce4;}',
    '.pvt-btn.active{background:var(--act);border-color:var(--act);color:#fff;font-weight:600;}',
    '.pvt-btn.icon-only{padding:8px 10px;min-width:24px;flex-shrink:0;}',
    '.pvt-btn.pvt-copy-success{background:var(--act);color:#fff;border-color:var(--act);}',
    '.pvt-btn.pvt-copy-error{background:var(--red-bg);color:var(--red-tx);border-color:var(--red-bg);font-weight:600;}',

    '.pvt-search{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 12px;transition:all .15s ease;box-shadow:0 1px 2px rgba(20,28,45,.03);overflow:hidden;}',
    '.pvt-search input{width:100%;min-width:0;}',
    '.pvt-search:focus-within{border-color:var(--act);box-shadow:0 0 0 3px rgba(43,108,255,.12);}',
    '.pvt-search input{border:none;outline:none;font:500 13px Inter,Helvetica,Arial,sans-serif;background:transparent;width:100%;color:var(--ink);}',
    '.pvt-search-icon{color:#666;flex-shrink:0;}',
    '.pvt-search-no-results{display:none;text-align:center;padding:20px;color:var(--muted);font:500 13px Inter,Helvetica,Arial,sans-serif;}',
    '.pvt-search-no-results.show{display:flex;align-items:center;justify-content:center;}',
    '.pvt-scroll .pvt-search-no-results.show{position:sticky;top:0;z-index:10;background:var(--card);min-height:40px;}',



    // Bars strip — sticky заголовок (удалено — теперь в блоке .pvt-bars-title выше)
    '.pvt-bars-filter-label{color:var(--act);font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;}',
    '.pvt-bars-clear{margin-left:0;padding:5px 10px;background:var(--blue-bg);border:1px solid transparent;border-radius:var(--r3);font:600 12px Inter,Helvetica,Arial,sans-serif;color:var(--blue);cursor:pointer;transition:all .15s;}',
    '.pvt-bars-clear:hover{background:var(--blue-bg);}',
    '.pvt-bars-clear.hidden{display:none;}',

    // Scroll & table
    '.pvt-scroll{flex:1;overflow:auto;padding:0;background:var(--card);position:relative;}',
    '.pvt-scroll::-webkit-scrollbar{width:10px;height:10px;}',
    '.pvt-scroll::-webkit-scrollbar-track{background:transparent;}',
    '.pvt-scroll::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2);border-radius:5px;border:2px solid #fff;}',
    '.pvt-card{background:var(--card);width:fit-content;min-width:100%;}',
    '.pvt-tbl{border-collapse:separate;border-spacing:0;white-space:nowrap;table-layout:fixed;font-size:13px;}',

    // Header rows
    '.pvt-tbl thead th{position:sticky;background:#fafbfc;color:var(--ink2);text-align:right;padding:5px 10px;font-weight:500;}',
    '.pvt-tbl thead tr.bars-row th{top:0;z-index:3;padding:0!important;margin:0;background:var(--card);border:0;height:' + BAR_H + 'px;line-height:0;vertical-align:bottom;}',
    '.pvt-tbl thead tr.bars-row th:not(.lbl){padding-top:28px!important;}',
    '.pvt-tbl thead tr.bars-row th.lbl{background:var(--card);z-index:4;border:0;padding:0!important;}',
    '.pvt-tbl thead tr.bars-row th.lbl.pvt-bars-title{display:table-cell!important;position:sticky!important;top:0!important;left:0!important;padding:20px 16px 20px 16px!important;vertical-align:top;line-height:1.2;text-align:left;white-space:normal;}',
    '.pvt-tbl thead tr.bars-row th.lbl.pvt-bars-title .pvt-bars-mode-hint{display:block;margin:0;}',
    '.pvt-tbl thead tr.bars-row th.lbl.pvt-bars-title .pvt-bars-mode-row{display:flex;align-items:center;margin-top:8px;}',

    // Second header row = «Разрез: L0 → L1 → L2» (sticky под bars-row)
    '.pvt-tbl thead tr.period-row th{position:sticky;top:36px;z-index:3;border:0;padding:7px 10px;text-align:right;background:#fafbfc;}',
    '.pvt-tbl thead tr.period-row th.lbl{text-align:left;padding:7px 14px;z-index:4;background:#fafbfc;color:var(--act);font-size:12px;font-weight:600;letter-spacing:0.2px;white-space:normal;line-height:1.35;}',
    '.pvt-tbl thead tr.period-row th .pvt-year{display:inline-block;font-size:12px;font-weight:700;color:var(--ink);letter-spacing:.3px;vertical-align:middle;}',
    '.pvt-tbl thead tr.period-row th .pvt-period-name{display:inline-block;font-size:12px;font-weight:500;color:var(--ink2);vertical-align:middle;}',
    '.pvt-tbl thead tr.period-row th.pvt-sortable{cursor:pointer;user-select:none;transition:background .1s ease;}',
    '.pvt-tbl thead tr.period-row th.pvt-sortable:hover{background:#EEF4FA;}',
    '.pvt-tbl thead tr.period-row th.pvt-sort-active{background:#E7F1FB;}',
    // Иконка сортировки: всегда в DOM, отдельный столбец в шапке (не растягивает ячейку по высоте)
    '.pvt-sort-icon{display:inline-block;margin-left:6px;width:10px;height:10px;color:#B8B8B8;line-height:0;vertical-align:middle;opacity:.6;transition:color .1s,opacity .1s;}',
    '.pvt-tbl thead tr.period-row th.pvt-sortable:hover .pvt-sort-icon{color:var(--act);opacity:1;}',
    '.pvt-sort-icon.active{color:var(--act);opacity:1;}',
    '.pvt-sort-icon svg{display:block;width:10px;height:10px;}',
    // Year boundary — синяя вертикальная линия начала года (только в теле и total, 1px)
    '.pvt-tbl tbody td.year-boundary,.pvt-tbl tr.total td.year-boundary{border-left:1px solid var(--act)!important;}',

    // Мультиметрика: подколонки в шапке (sticky, top вычисляется в JS)
    '.pvt-tbl thead tr.metric-row th{position:sticky;top:0;z-index:5;padding:3px 6px;text-align:center;background:#F5F7F9;font-size:10px;font-weight:600;color:var(--ink2);letter-spacing:.3px;text-transform:uppercase;}',
    '.pvt-tbl thead tr.metric-row th.lbl{background:#fafbfc;z-index:6;}',
    // Границы между метриками
    '.pvt-tbl thead tr.metric-row th.pvt-mfirst{border-left:1px solid #C0C0C0;}',

    '.pvt-tbl td.val.pvt-metric-col{padding-left:6px;padding-right:6px;}',
    '.pvt-tbl td.val.pvt-metric-col.pvt-mfirst{border-left:1px solid #E0E0E0;}',
    '.pvt-tbl td.val.pvt-metric-col.pvt-mfirst.year-boundary{border-left:1px solid var(--act)!important;}',

    // Sticky label column
    '.pvt-tbl .lbl{position:sticky;left:0;z-index:2;background:var(--card);text-align:left;padding-left:' + BASE_PAD + 'px;border-right:1px solid #F0F0F0;overflow:hidden;text-overflow:ellipsis;}',
    '.pvt-tbl thead th.lbl{z-index:4;background:#fafbfc;}',
    '.pvt-tbl tr:hover .lbl{background:#F5F9FE;}',

    // Total row — z-index выше чем metric-row (6) чтобы не было просвета
    '.pvt-tbl tr.total .lbl,.pvt-tbl tr.total td{background:var(--blue-bg);font-weight:700;color:var(--ink);position:sticky;z-index:7;font-size:13px;border-top:1px solid #dbe6fd;}',
    '.pvt-tbl tr.total .lbl{z-index:8;padding-left:' + BASE_PAD + 'px!important;}',
    '.pvt-tbl tr.total:hover .lbl,.pvt-tbl tr.total:hover td{background:#D4E5F8;}',
    '.pvt-tbl tr.total{cursor:pointer;}',
    '.pvt-hdr-toggle{cursor:pointer;user-select:none;display:inline-flex;align-items:center;}',
    '.pvt-hdr-caret{display:inline-flex;align-items:center;justify-content:center;width:' + CARET_W + 'px;height:' + CARET_W + 'px;margin-right:6px;color:var(--act);transition:transform .15s ease;transform-origin:center center;flex-shrink:0;}',
    '.pvt-hdr-caret svg{display:block;}',
    '.pvt-hdr-toggle.all-collapsed .pvt-hdr-caret{transform:rotate(-90deg);}',

    // Level rows — единый шаг 20px от 0
    // Итого = 12px (BASE_PAD), L0 = 12+20 = 32, L1 = 12+40 = 52, L2 = 12+60 = 72
    // Но для чисто-визуального выравнивания «лесенкой» ориентируемся на позицию каретки
    '.pvt-tbl tr.lvl-0 .lbl{padding-left:' + (BASE_PAD + 0 * STEP) + 'px;font-weight:600;font-size:13px;color:var(--ink);}',
    '.pvt-tbl tr.lvl-0 .lbl,.pvt-tbl tr.lvl-0 td{background:#fafbfc;cursor:pointer;user-select:none;}',
    '.pvt-tbl tr.lvl-0:hover .lbl,.pvt-tbl tr.lvl-0:hover td{background:#F0F4F8;}',
    '.pvt-tbl tr.lvl-1 .lbl{padding-left:' + (BASE_PAD + 1 * STEP) + 'px;font-weight:500;font-size:13px;color:#333;}',
    '.pvt-tbl tr.lvl-1 .lbl,.pvt-tbl tr.lvl-1 td{background:var(--card);cursor:pointer;user-select:none;}',
    '.pvt-tbl tr.lvl-1:hover .lbl,.pvt-tbl tr.lvl-1:hover td{background:#F7FAFC;}',
    '.pvt-tbl tr.lvl-2 .lbl{padding-left:' + (BASE_PAD + 2 * STEP) + 'px;font-weight:500;font-size:13px;color:#333;}',
    '.pvt-tbl tr.lvl-2 .lbl,.pvt-tbl tr.lvl-2 td{background:var(--card);cursor:pointer;user-select:none;}',
    '.pvt-tbl tr.lvl-2:hover .lbl,.pvt-tbl tr.lvl-2:hover td{background:#F7FAFC;}',
    // Leafs: то же выравнивание что и группы того же уровня, но без каретки
    '.pvt-tbl tr.leaf.d0 .lbl{padding-left:' + (BASE_PAD + 0 * STEP + CARET_W + 4) + 'px;}',
    '.pvt-tbl tr.leaf.d1 .lbl{padding-left:' + (BASE_PAD + 1 * STEP + CARET_W + 4) + 'px;color:var(--ink2);font-weight:400;}',
    '.pvt-tbl tr.leaf.d2 .lbl{padding-left:' + (BASE_PAD + 2 * STEP + CARET_W + 4) + 'px;color:var(--ink2);font-weight:400;}',
    '.pvt-tbl tr.leaf td{color:var(--ink2);}',
    '.pvt-tbl tr.leaf:hover .lbl,.pvt-tbl tr.leaf:hover td{background:#F8FAFC;}',

    // Numeric cells — единый размер 13px, tabular
    '.pvt-tbl .val{text-align:right;font-variant-numeric:tabular-nums;transition:background .1s ease;white-space:nowrap;padding:8px 10px;font-size:13px;font-weight:400;}',
    '.pvt-tbl tbody .lbl{padding-top:8px;padding-bottom:8px;font-size:13px;}',
    '.pvt-tbl .zero{color:var(--muted2)!important;font-weight:400;}',
    '.pvt-tbl td.zero.year-boundary{border-left:1px solid var(--act)!important;}',

    // Caret
    '.pvt-caret{display:inline-flex;align-items:center;justify-content:center;width:' + CARET_W + 'px;height:' + CARET_W + 'px;margin-right:4px;transition:transform .15s ease;transform-origin:center center;color:#666;vertical-align:middle;}',
    '.pvt-caret svg{display:block;}',
    '.pvt-grp-collapsed .pvt-caret{transform:rotate(-90deg);}',

    // Badges: полнота и счётчики
    '.pvt-badge{display:inline-flex;align-items:center;margin-left:8px;padding:1px 7px;border-radius:999px;font:600 11px Inter,Helvetica,Arial,sans-serif;vertical-align:middle;white-space:nowrap;}',
    '.pvt-badge-warn{color:#8A4B00;background:#FFF4CE;border:1px solid #F7D070;}',
    '.pvt-badge-ok{color:var(--ink2);background:#F0F1F3;border:1px solid var(--line);}',

    // Tooltip — белый фон
    '.pvt-tooltip{position:fixed;pointer-events:none;background:var(--card);color:var(--ink);padding:8px 12px;border-radius:12px;font:12px Inter,Helvetica,Arial,sans-serif;box-shadow:var(--shadow),0 0 0 1px rgba(20,28,45,.06);z-index:9999;opacity:0;transition:opacity .12s ease;max-width:300px;line-height:1.5;}',
    '.pvt-tooltip.show{opacity:1;}',
    '.pvt-tooltip b{color:var(--act);font-weight:600;}',

    '.pvt-hidden{display:none!important;}',
    '.pvt-tbl tr.pvt-row-active .lbl,.pvt-tbl tr.pvt-row-active td{background:#DBE9FB!important;}',
    '.pvt-tbl tr.pvt-row-active .lbl{color:var(--act);font-weight:600;box-shadow:inset 3px 0 0 0 var(--act);}',

    '.pvt-bar{transition:fill .12s ease;cursor:default;}',
    '.pvt-bar-label{font:600 11px Inter,Helvetica,Arial,sans-serif;fill:var(--ink2);pointer-events:none;}',
    '</style>'
  ].join('');

  // ---------- БЛОК 11: ШИРИНЫ ----------
  function computeWidths(containerWidth, tableRows, buckets, M) {
    if (!M || M < 1) M = 1;
    var maxLabelPx = 0;
    tableRows.forEach(function(row) {
      if (row.type === 'header') return;
      var isBold = row.type === 'total' || row.type === 'level0';
      var textWidth = measureText(row.label || '', isBold);
      var indent = BASE_PAD;
      if (row.type === 'level0') indent = BASE_PAD + 0 * STEP + CARET_W + 4;
      else if (row.type === 'level1') indent = BASE_PAD + 1 * STEP + CARET_W + 4;
      else if (row.type === 'level2') indent = BASE_PAD + 2 * STEP + CARET_W + 4;
      else if (row.type === 'leaf') indent = BASE_PAD + row.depth * STEP + CARET_W + 4;
      var badgeExtra = (row.type === 'level0' || row.type === 'level1') ? 60 : 0;
      var labelPx = indent + textWidth + badgeExtra + 14;
      if (labelPx > maxLabelPx) maxLabelPx = labelPx;
    });
    var labelWidth = Math.max(160, Math.ceil(maxLabelPx) + 4); // уменьшена мин. ширина (было 260 → 200 → 160)
    var maxCharsInCol = 0;
    buckets.forEach(function(b) { if (String(b).length > maxCharsInCol) maxCharsInCol = String(b).length; });
    tableRows.forEach(function(row) {
      if (row.type === 'header') return;
      row.values.forEach(function(v) { if (v && String(v).length > maxCharsInCol) maxCharsInCol = String(v).length; });
    });
    // Ширина одной подколонки (для одной метрики) — уменьшена (было 60/7.5/22)
    var subColMin = Math.max(38, Math.round(maxCharsInCol * 5.5) + 10);
    // Мин. ширина периода = M подколонок + доп. паддинг для иконки сортировки (уже чем было)
    var colMinWidth = subColMin * M + (M > 1 ? 4 : 12);
    if (colMinWidth < 38) colMinWidth = 38; // уменьшен мин. порог (было 60 → 50 → 38)
    var availableWidth = containerWidth - 13.8;
    var labelMaxWidth = Math.max(240, Math.floor(availableWidth * 0.3)); // уменьшена доля label (было 420/0.5 → 320/0.4 → 240/0.3)
    if (labelWidth > labelMaxWidth) labelWidth = labelMaxWidth;
    var numCols = buckets.length || 1;
    var calc = Math.floor((availableWidth - labelWidth) / numCols);
    var finalColWidth = calc >= colMinWidth ? calc : colMinWidth;
    var totalTableWidth = labelWidth + finalColWidth * numCols;
    var lastColExtra = 0;
    if (totalTableWidth < availableWidth) { lastColExtra = availableWidth - totalTableWidth; totalTableWidth = availableWidth; }
    return { labelWidth: labelWidth, colWidth: finalColWidth, lastColExtra: lastColExtra, totalTableWidth: totalTableWidth, subColWidth: Math.floor(finalColWidth / M), M: M };
  }

  // ---------- БЛОК 12: SVG-БАРЫ ----------
  function buildBarsSvg(buckets, labels, valuesByBk, totalByBk, isFiltered, mode, colWidth, lastColExtra, metricKey) {
    var mCfg = CFG.metrics[metricKey] || CFG.metrics.hc;
    var numCols = buckets.length, svgW = colWidth * numCols + lastColExtra, svgH = BAR_H;
    var padTop = 20, padBottom = 6, plotH = svgH - padTop - padBottom;
    var scaleSource = mode === 'share' && isFiltered ? totalByBk : valuesByBk;
    var maxVal = 0; for (var k in scaleSource) if (scaleSource[k] > maxVal) maxVal = scaleSource[k];
    if (maxVal === 0) maxVal = 1;
    var valueColor = mCfg.color;
    var svg = ['<svg class="pvt-bars-svg" width="' + svgW + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg">'];
    for (var ci = 0; ci < numCols; ci++) {
      var bk = buckets[ci], v = valuesByBk[bk] || 0, t = totalByBk[bk] || 0;
      var w = colWidth + (ci === numCols - 1 ? lastColExtra : 0), x = colWidth * ci;
      var barPad = Math.max(4, w * 0.15), barW = w - barPad * 2, barX = x + w - barPad - barW;
      var labelX = barX + barW / 2;
      if (mode === 'share' && isFiltered) {
        // Режим 100%: общий фон = total, передний план = v от total
        var hT = plotH, hV = t > 0 ? (v / t) * hT : 0;
        var yT = padTop, yV = padTop + (hT - hV);
        // Фоновый rect (total) с большей прозрачностью
        svg.push('<rect x="' + barX + '" y="' + yT + '" width="' + barW + '" height="' + hT + '" rx="2" ry="2" fill="' + mCfg.colorBase + '" opacity="0.5"/>');
        // Передний план (выбранная категория)
        svg.push('<rect class="pvt-bar" x="' + barX + '" y="' + yV + '" width="' + barW + '" height="' + hV + '" rx="2" ry="2" fill="' + mCfg.colorOverlay + '" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '" data-share="' + escAttr(t > 0 ? Math.round((v / t) * 1000) / 10 : 0) + '"/>');
        // Невидимый hover-rect на всю высоту для тултипа
        svg.push('<rect x="' + barX + '" y="' + yT + '" width="' + barW + '" height="' + hT + '" fill="transparent" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '"/>');
        // Лейбл с процентом — над заполненной частью (над цветным баром), показываем всегда
        var pctVal = t > 0 ? Math.round((v / t) * 1000) / 10 : 0;
        svg.push('<text class="pvt-bar-label" x="' + labelX + '" y="' + (yV - 5) + '" text-anchor="middle">' + String(pctVal) + '%</text>');
      } else {
        // Режим значения: обычная шкала от 0 до maxVal
        var h = (v / maxVal) * plotH, y = padTop + (plotH - h);
        svg.push('<rect class="pvt-bar" x="' + barX + '" y="' + y + '" width="' + barW + '" height="' + h + '" rx="2" ry="2" fill="' + valueColor + '" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '"/>');
        // Невидимый hover-rect на всю высоту колонки для тултипа
        svg.push('<rect x="' + barX + '" y="' + padTop + '" width="' + barW + '" height="' + plotH + '" fill="transparent" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '"/>');
        // Лейбл со значением — показываем всегда
        svg.push('<text class="pvt-bar-label" x="' + labelX + '" y="' + (y - 5) + '" text-anchor="middle">' + escHtml(fmtCompact(v)) + '</text>');
      }
    }
    svg.push('</svg>');
    return svg.join('');
  }

  // Мульти-метричные grouped bars: в каждом бакете — M узких столбиков по числу активных метрик.
  // valuesByMk[mk] — { bk → value }; ОБЩАЯ шкала высоты для всех метрик (по максимальному значению).
  function buildBarsSvgMulti(buckets, labels, valuesByMk, totalsByMk, isFiltered, mode, colWidth, lastColExtra, metrics, primaryMetric) {
    if (!metrics || metrics.length <= 1) {
      var mk1 = (metrics && metrics[0]) || primaryMetric;
      var vals = (valuesByMk && valuesByMk[mk1]) || {};
      var tots = (totalsByMk && totalsByMk[mk1]) || vals;
      return buildBarsSvg(buckets, labels, vals, tots, isFiltered, mode, colWidth, lastColExtra, mk1);
    }
    var numCols = buckets.length, M = metrics.length;
    var svgW = colWidth * numCols + lastColExtra, svgH = BAR_H;
    var padTop = 20, padBottom = 6, plotH = svgH - padTop - padBottom;
    // ОБЩИЙ max для всех метрик — чтобы высота баров была сопоставима
    var globalMax = 0;
    metrics.forEach(function(mk) {
      var src = (mode === 'share' && isFiltered) ? (totalsByMk && totalsByMk[mk]) : (valuesByMk && valuesByMk[mk]);
      src = src || {};
      for (var k in src) if (src[k] > globalMax) globalMax = src[k];
    });
    if (globalMax === 0) globalMax = 1;
    var svg = ['<svg class="pvt-bars-svg" width="' + svgW + '" height="' + svgH + '" xmlns="http://www.w3.org/2000/svg">'];
    for (var ci = 0; ci < numCols; ci++) {
      var bk = buckets[ci];
      var w = colWidth + (ci === numCols - 1 ? lastColExtra : 0);
      var xBase = colWidth * ci;
      var groupPad = Math.max(4, w * 0.12);
      var innerW = w - groupPad * 2;
      var subGap = 2;
      var subW = Math.max(3, (innerW - subGap * (M - 1)) / M);
      var groupStart = xBase + w - groupPad - innerW;
      for (var mi = 0; mi < M; mi++) {
        var mk = metrics[mi];
        var mCfg = CFG.metrics[mk] || CFG.metrics.hc;
        var v = ((valuesByMk && valuesByMk[mk]) || {})[bk] || 0;
        var t = ((totalsByMk && totalsByMk[mk]) || {})[bk] || 0;
        var barX = groupStart + mi * (subW + subGap);
        if (mode === 'share' && isFiltered) {
          // Режим 100%: общий фон = total, передний план = v от total
          var hT = plotH, hV = t > 0 ? (v / t) * hT : 0;
          var yT = padTop, yV = padTop + (hT - hV);
          // Фоновый rect (total) с большей прозрачностью
          svg.push('<rect x="' + barX + '" y="' + yT + '" width="' + subW + '" height="' + hT + '" rx="2" ry="2" fill="' + mCfg.colorBase + '" opacity="0.5"/>');
          // Передний план (выбранная категория)
          var pctVal = t > 0 ? Math.round((v / t) * 1000) / 10 : 0;
          svg.push('<rect class="pvt-bar" x="' + barX + '" y="' + yV + '" width="' + subW + '" height="' + hV + '" rx="2" ry="2" fill="' + mCfg.colorOverlay + '" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '" data-share="' + escAttr(pctVal) + '" data-metric="' + mk + '"/>');
          // Невидимый hover-rect на всю высоту для тултипа
          svg.push('<rect x="' + barX + '" y="' + yT + '" width="' + subW + '" height="' + hT + '" fill="transparent" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '"/>');
          // Лейбл с процентом — над заполненной частью (над цветным баром), показываем всегда
          var pctVal = t > 0 ? Math.round((v / t) * 1000) / 10 : 0;
          svg.push('<text class="pvt-bar-label" x="' + (barX + subW / 2) + '" y="' + (yV - 5) + '" text-anchor="middle" font-size="9" fill="' + mCfg.color + '">' + escHtml(pctVal + '%') + '</text>');
        } else {
          // Режим значения: обычная шкала от 0 до maxVal
          var h = (v / globalMax) * plotH, y = padTop + (plotH - h);
          svg.push('<rect class="pvt-bar" x="' + barX + '" y="' + y + '" width="' + subW + '" height="' + h + '" rx="2" ry="2" fill="' + mCfg.color + '" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '" data-metric="' + mk + '"/>');
          // Невидимый hover-rect на всю высоту колонки для тултипа
          svg.push('<rect x="' + barX + '" y="' + padTop + '" width="' + subW + '" height="' + plotH + '" fill="transparent" data-bk="' + escAttr(bk) + '" data-label="' + escAttr(labels[ci]) + '" data-value="' + escAttr(fmt(v)) + '" data-total="' + escAttr(fmt(t)) + '"/>');
          // Лейбл со значением — показываем всегда
          svg.push('<text class="pvt-bar-label" x="' + (barX + subW / 2) + '" y="' + (y - 4) + '" text-anchor="middle" font-size="9" fill="' + mCfg.color + '">' + escHtml(fmtCompact(v)) + '</text>');
        }
      }
    }
    svg.push('</svg>');
    return svg.join('');
  }

  // ---------- БЛОК 13: HTML ----------
  // metrics — массив активных метрик; primaryMetric — основная (первая кликнутая)
  function buildHtml(containerWidth, granularity, metrics, primaryMetric, sortState, barsVisible) {
    metrics = (metrics && metrics.length) ? metrics : [primaryMetric];
    var mCfg = CFG.metrics[primaryMetric] || CFG.metrics.hc;
    var built = buildTableRows(granularity, metrics, sortState, primaryMetric);
    var tableRows = built.rows, buckets = built.buckets, A = built.aggregation;
    var aggByMetric = built.aggByMetric;
    var activeSortBk = built.sortBucket, activeSortDir = built.sortDir;
    // Сортировка всегда активна (дефолт — последний бакет, деск)
    var numCols = buckets.length;
    var M = metrics.length;
    var totalValCols = numCols * M; // общее число числовых колонок
    var W = computeWidths(containerWidth, tableRows, buckets, M);
    var bucketLabels = buckets.map(function(bk) { return bucketLabel(bk, granularity); });

    // colgroup: 1 колонка label + numCols блоков по M подколонок
    var subColWidth = Math.max(60, Math.floor(W.colWidth / M));
    var colgroup = '<colgroup><col style="width:' + W.labelWidth + 'px">';
    for (var cg = 0; cg < numCols; cg++) {
      var isLast = cg === numCols - 1;
      var thisColW = W.colWidth + (isLast ? W.lastColExtra : 0);
      // Распределяем ширину между подколонками: если M>1, делим поровну (остаток — последней)
      var perSub = Math.floor(thisColW / M);
      var lastSub = thisColW - perSub * (M - 1);
      for (var mi = 0; mi < M; mi++) {
        var w = (mi === M - 1) ? lastSub : perSub;
        colgroup += '<col style="width:' + w + 'px">';
      }
    }
    colgroup += '</colgroup>';
    var tableStyle = ' style="width:' + W.totalTableWidth + 'px;"';

    // Бары: в solo-режиме — как раньше; в multi — grouped по метрикам
    var initialValsByMk = {};
    metrics.forEach(function(mk) { initialValsByMk[mk] = (aggByMetric[mk] && aggByMetric[mk].totalAgg) || {}; });
    var initialBarsSvg = buildBarsSvgMulti(buckets, bucketLabels, initialValsByMk, initialValsByMk, false, currentMode, W.colWidth, W.lastColExtra, metrics, primaryMetric);

    // sticky top offsets: bars → hierarchy → period → total-row

    function shortLabel(bk) {
      if (granularity === 'year') return bk;
      if (granularity === 'quarter') return 'Q' + bk.split('-Q')[1];
      var mp = bk.split('-'); return CFG.monthsRu[parseInt(mp[1], 10) - 1];
    }
    // Иерархия для строки-заголовка колонки label: L0 → L1 → L2
    var levelHeaderText = levelNames.join('  →  ');
    var barsMetricLabels = metrics.map(function(mk) { return CFG.metrics[mk].label; }).join(' · ');

    var html = [css, '<div class="pvt-root">'];

    // Toolbar — 2 строки: 1) контролы, 2) подсказки
    html.push('<div class="pvt-toolbar">');
    html.push('<div class="pvt-toolbar-row">');
    html.push('<div class="pvt-title-wrap"><div class="pvt-title">' + escHtml(CFG.text.barsDynamics) + ' · ' + escHtml(barsMetricLabels) + '</div></div>');

    // Метрики
    html.push('<div class="pvt-control-group pvt-metric-group">');
    html.push('<span class="pvt-control-label">' + escHtml(CFG.text.metricLabel) + '</span>');
    html.push('<div class="pvt-segmented" id="pvt-metric">');
    var activeSet = {}; metrics.forEach(function(mk) { activeSet[mk] = true; });
    var blockedMetrics = getBlockedMetrics();
    ['hc','hire','attr'].forEach(function(mk) {
      var m = CFG.metrics[mk];
      var isActive = !!activeSet[mk];
      var isPrimary = (mk === primaryMetric);
      var isBlocked = blockedMetrics.indexOf(mk) >= 0;
      var classes = [];
      if (isActive) classes.push('active' + (isPrimary ? ' primary' : ''));
      if (isBlocked) classes.push('pvt-metric-blocked');
      var classAttr = classes.length > 0 ? ' class="' + classes.join(' ') + '"' : '';
      var tooltip = isBlocked ? ' data-tooltip="' + escAttr(CFG.text.metricBlockedTitle) + '"' : '';
      html.push('<button data-metric="' + mk + '"' + classAttr + tooltip +
        ' style="--m-color:' + (isBlocked ? '#c7c8cc' : m.color) + ';">' +
        '<span class="pvt-metric-chip">' + escHtml(m.label) + (isBlocked ? ' <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style="margin-left:4px;vertical-align:middle;"><path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" stroke-width="1.5"/></svg>' : '') + '</span></button>');
    });
    html.push('</div>');
    html.push('</div>');

    // Гранулярность
    html.push('<div class="pvt-control-group pvt-gran-group">');
    html.push('<span class="pvt-control-label">' + escHtml(CFG.text.granularityLabel) + '</span>');
    html.push('<div class="pvt-segmented" id="pvt-gran">');
    html.push('<button data-gran="month"'   + (granularity === 'month'   ? ' class="active"' : '') + '>' + escHtml(CFG.text.granMonth) + '</button>');
    html.push('<button data-gran="quarter"' + (granularity === 'quarter' ? ' class="active"' : '') + '>' + escHtml(CFG.text.granQuarter) + '</button>');
    html.push('<button data-gran="year"'    + (granularity === 'year'    ? ' class="active"' : '') + '>' + escHtml(CFG.text.granYear) + '</button>');
    html.push('</div>');
    html.push('</div>');

    // Поиск
    html.push('<div class="pvt-search">' + ICON_SEARCH + '<input type="text" placeholder="' + escAttr(CFG.text.searchPlaceholder) + '" id="pvt-search-input"></div>');

    // Кнопки
    html.push('<button class="pvt-btn icon-only" id="pvt-toggle-bars">' + (barsVisible ? ICON_BARS : ICON_BARS_OFF) + '</button>');
    if (CFG.defaults.enableCopy) {
      html.push('<button class="pvt-btn icon-only" id="pvt-copy">' + ICON_COPY + '</button>');
    }
    html.push('</div>');
    html.push('<div class="pvt-toolbar-filter-row"><span class="pvt-bars-filter-label" id="pvt-bars-filter-label"></span><button class="pvt-bars-clear hidden" id="pvt-bars-clear">' + escHtml(CFG.text.barsClear) + '</button></div>');
    html.push('</div>');

    // Subtitle row: warning под заголовком (пункт 2)
    var showWarn = limitInfo.limited;
    html.push('<div class="pvt-subtitle-row' + (showWarn ? '' : ' empty') + '">');
    if (showWarn) {
      var warnText;
      if (!isNaN(limitInfo.shown) && !isNaN(limitInfo.total)) {
        warnText = CFG.text.limitWarnPrefix + ' ' + fmt(limitInfo.shown) + ' ' + CFG.text.limitWarnMid + ' ' + fmt(limitInfo.total) + ' ' + CFG.text.limitWarnSuffix;
      } else {
        warnText = CFG.text.limitWarnSuffix;
      }
      html.push('<div class="pvt-warn">' + ICON_WARN + escHtml(warnText) + '</div>');
    }
    html.push('</div>');

    // Warning о блокировке метрик при разрезах увольнений
    var blockedMetrics = getBlockedMetrics();
    var hasBlocked = blockedMetrics.length > 0;
    if (hasBlocked) {
      html.push('<div class="pvt-subtitle-row">');
      html.push('<div class="pvt-warn" style="background:#FFF4CE;border-color:#F7D070;color:#8A4B00;">' +
        '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="margin-right:6px;vertical-align:-2px;"><path d="M8 1 L15 14 L1 14 Z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><rect x="7.3" y="6" width="1.4" height="4.5" rx="0.5"/><rect x="7.3" y="11.2" width="1.4" height="1.4" rx="0.5"/></svg>' +
        escHtml(CFG.text.metricBlockedText) + '</div>');
      html.push('</div>');
    }

    // Table
    html.push('<div class="pvt-scroll" id="pvt-scroll">');
    html.push('<div class="pvt-search-no-results" id="pvt-search-no-results">' + escHtml(CFG.text.searchNoResults) + '</div>');
    html.push('<div class="pvt-card"><table class="pvt-tbl"' + tableStyle + '>');
    html.push(colgroup);
    html.push('<thead>');

    // 1) bars row — подсказка + переключатель режимов слева (в ячейке label), сам график динамики справа — одна строка
    html.push('<tr class="bars-row" id="pvt-bars-title-row"' + (barsVisible ? '' : ' style="display:none;"') + '>');
    html.push('<th class="lbl pvt-bars-title">');
    html.push('<div class="pvt-bars-mode-hint">' + escHtml(CFG.text.rowClickFilterHint) + '</div>');
    html.push('<div class="pvt-bars-mode-row" id="pvt-bars-mode-row" style="display:none;"><div class="pvt-segmented" id="pvt-bars-mode">');
    html.push('<button data-mode="value"' + (currentMode === 'value' ? ' class="active"' : '') + '>' + escHtml(CFG.text.barsModeValue) + '</button>');
    html.push('<button data-mode="share"' + (currentMode === 'share' ? ' class="active"' : '') + '>' + escHtml(CFG.text.barsModeShare) + '</button>');
    html.push('</div></div>');
    html.push('</th>');
    html.push('<th colspan="' + totalValCols + '" id="pvt-bars-cell" style="padding:0;">' + initialBarsSvg + '</th>');
    html.push('</tr>');

    // 2) period row — объединяем шапку: иерархия «Разрез: L0 → L1 → L2» слева
    // с wrap если длинная. Заголовки периодов отрисовываем colspan=M если мультиметрика.
    var boundaryFlags = new Array(numCols);
    var hierLabelFull = CFG.text.copyGroupHeader + ': ' + levelHeaderText;
    html.push('<tr class="period-row">');
    html.push('<th class="lbl" data-period-lbl="1" title="' + escAttr(hierLabelFull) + '">' + escHtml(hierLabelFull) + '</th>');

    // Иконки сортировки: три варианта (idle/asc/desc)
    var SORT_ICON_IDLE = '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 4 L5 1 L8 4 Z M2 6 L5 9 L8 6 Z"/></svg>';
    var SORT_ICON_ASC  = '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 6 L5 2 L8 6 Z"/></svg>';
    var SORT_ICON_DESC = '<svg viewBox="0 0 10 10" fill="currentColor"><path d="M2 4 L8 4 L5 8 Z"/></svg>';

    function thAttrs(bk, extraCls) {
      var cls = ['pvt-sortable'];
      if (extraCls) cls.push(extraCls);
      if (bk === activeSortBk) cls.push('pvt-sort-active');
      var span = (M > 1) ? (' colspan="' + M + '"') : '';
      return span + ' class="' + cls.join(' ') + '" data-bucket-key="' + escAttr(bk) + '" data-period-th="1"';
    }
    function sortIcon(bk) {
      var isActive = (bk === activeSortBk);
      var svg = SORT_ICON_IDLE;
      if (isActive) svg = (activeSortDir === 'asc') ? SORT_ICON_ASC : SORT_ICON_DESC;
      return '<span class="pvt-sort-icon' + (isActive ? ' active' : '') + '">' + svg + '</span>';
    }
    buckets.forEach(function(bk, idx) {
      if (granularity === 'year') {
        boundaryFlags[idx] = idx > 0;
        html.push('<th' + thAttrs(bk, boundaryFlags[idx] ? 'year-boundary' : '') + '><span class="pvt-year">' + escHtml(shortLabel(bk)) + '</span>' + sortIcon(bk) + '</th>');
        return;
      }
      var isYearStart = false, yearTxt = null;
      if (granularity === 'quarter') { var qp = bk.split('-Q'); yearTxt = qp[0]; isYearStart = qp[1] === '1'; }
      else { var mp = bk.split('-'); yearTxt = mp[0]; isYearStart = parseInt(mp[1], 10) === 1; }
      boundaryFlags[idx] = isYearStart && idx > 0;
      var boundaryCls = boundaryFlags[idx] ? 'year-boundary' : '';
      if (isYearStart) html.push('<th' + thAttrs(bk, boundaryCls) + '><span class="pvt-year">' + escHtml(yearTxt) + '</span>' + sortIcon(bk) + '</th>');
      else html.push('<th' + thAttrs(bk, boundaryCls) + '><span class="pvt-period-name">' + escHtml(shortLabel(bk)) + '</span>' + sortIcon(bk) + '</th>');
    });
    html.push('</tr>');

    // 3) metric-row — только в мультиметрическом режиме
    if (M > 1) {
      html.push('<tr class="metric-row">');
      html.push('<th class="lbl"></th>');
      buckets.forEach(function(bk, idx) {
        var isYearStart = boundaryFlags[idx];
        metrics.forEach(function(mk, mi) {
          var mm = CFG.metrics[mk];
          var classes = [];
          // year-boundary только для первой метрики в начале года
          if (isYearStart && mi === 0) classes.push('year-boundary');
          // pvt-mfirst для первой метрики (кроме первого бакета)
          if (mi === 0 && idx > 0) classes.push('pvt-mfirst');
          var clsStr = classes.length > 0 ? ' class="' + classes.join(' ') + '"' : '';
          html.push('<th' + clsStr + ' style="--m-color:' + mm.color + ';"><span class="pvt-metric-chip">' + escHtml(mm.shortLabel || mm.label) + '</span></th>');
        });
      });
      html.push('</tr>');
    }

    html.push('</thead><tbody>');

    var hdrTip = buckets.map(function(bk) { return bucketLabel(bk, granularity); });
    var groupIdCounter = 0;

    function buildCompletenessBadge(path, isGroup) {
      if (!isGroup) return '';
      var meta = completenessByPath[path];
      var cnt = countByPath[path];
      if (meta && !meta.complete) {
        // Неполно — жёлтый бейдж «shown из total»
        return '<span class="pvt-badge pvt-badge-warn">' +
                 escHtml(fmt(meta.shown) + ' из ' + fmt(meta.total)) +
               '</span>';
      }
      // Полно — тихий счётчик числа детей
      if (cnt != null) {
        return '<span class="pvt-badge pvt-badge-ok">' + escHtml(fmt(cnt)) + '</span>';
      }
      return '';
    }

    for (var ri = 1; ri < tableRows.length; ri++) {
      var row = tableRows[ri], rowClass = '', dataAttrs = '', labelHtml = '', lblStyle = '';
      if (row.type === 'total') {
        rowClass = 'total';
        lblStyle = ' data-total-lbl="1"';
        labelHtml = '<span class="pvt-hdr-toggle" id="pvt-total-toggle">' + ICON_CARET_HEADER + escHtml(row.label) + '</span>';
        dataAttrs = ' data-path=""';
      } else if (row.type === 'leaf') {
        rowClass = 'leaf d' + row.depth;
        dataAttrs = ' data-path="' + escAttr(row.path) + '" data-depth="' + row.depth + '" data-group-value="' + escAttr(row.label) + '"';
        labelHtml = escHtml(row.label);
      } else {
        var depth = row.depth;
        rowClass = 'lvl-' + depth;
        groupIdCounter++;
        dataAttrs = ' data-group-id="g' + groupIdCounter + '" data-path="' + escAttr(row.path) + '" data-depth="' + depth + '" data-group-value="' + escAttr(row.label) + '"';
        labelHtml = '<span class="pvt-caret">' + ICON_CARET + '</span>' + escHtml(row.label) + buildCompletenessBadge(row.path, true);
      }
      var searchText = String(row.label || '').toLowerCase();
      var pathAttr = row.path ? ' data-full-path="' + escAttr(row.path) + '"' : '';
      html.push('<tr class="' + rowClass + '" data-search="' + escAttr(searchText) + '"' + dataAttrs + pathAttr + '>');
      html.push('<td class="lbl"' + lblStyle + ' title="' + escAttr(row.label || '') + '">' + labelHtml + '</td>');
      // Отрисовка: numCols блоков по M подколонок
      for (var ci2 = 0; ci2 < numCols; ci2++) {
        var bk_c = buckets[ci2];
        for (var mi2 = 0; mi2 < M; mi2++) {
          var flatIdx = ci2 * M + mi2;
          var rawVal = row.raw && row.raw[flatIdx] !== undefined ? row.raw[flatIdx] : 0;
          var val = row.values[flatIdx] !== undefined ? row.values[flatIdx] : fmt(rawVal);
          var mkc = metrics[mi2];
          var classes = ['val'];
          if (M > 1) { classes.push('pvt-metric-col'); if (mi2 === 0) classes.push('pvt-mfirst'); }
          // Нули и null значения — светло-серые
          if (rawVal === 0 || rawVal === null || rawVal === undefined) classes.push('zero');
          if (boundaryFlags[ci2] && mi2 === 0) classes.push('year-boundary');
          var tdStyle = row.type === 'total' ? ' data-total-td="1"' : '';
          // data-tip: label|periodLabel|value|metricKey|bucketKey|path (для MoM/YoY в тултипе)
          var tip = (row.label || '') + '|' + (hdrTip[ci2] || '') + '|' + val + '|' + mkc + '|' + bk_c + '|' + (row.path || '');
          html.push('<td class="' + classes.join(' ') + '"' + tdStyle + ' data-tip="' + escAttr(tip) + '" data-raw="' + escAttr(rawVal) + '" data-metric="' + mkc + '" data-bk="' + escAttr(bk_c) + '">' + escHtml(val) + '</td>');
        }
      }
      html.push('</tr>');
    }

    html.push('</tbody></table></div></div>');
    html.push('<div class="pvt-tooltip" id="pvt-tooltip"></div>');
    html.push('</div>');
    return {
      html: html.join(''), aggregation: A, buckets: buckets, bucketLabels: bucketLabels,
      widths: W, metricKey: primaryMetric, metrics: metrics, aggByMetric: aggByMetric,
      barsVisible: barsVisible
    };
  }

  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---------- БЛОК 14: ОБРАБОТЧИКИ ----------
  function attachHandlers(overlay, ctx, initialMode, onGranularityChange, onModeChange, onSortChange, onBarsToggle, onMetricChange) {
    var tooltip = overlay.querySelector('#pvt-tooltip');
    function positionTooltip(e) {
      var tw = tooltip.offsetWidth, th = tooltip.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, gap = 14;
      var x = e.clientX + gap, y = e.clientY + gap;
      if (x + tw + 4 > vw) x = e.clientX - tw - gap;
      if (y + th + 4 > vh) y = e.clientY - th - gap;
      if (x < 4) x = 4; if (y < 4) y = 4;
      tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
    }

    // Metric switcher (Shift+клик — добавить/убрать метрику)
    overlay.querySelectorAll('#pvt-metric button').forEach(function(btn) {
      btn.addEventListener('click', function(ev) {
        var mk = btn.getAttribute('data-metric');
        // Игнорируем клики по заблокированным метрикам
        if (!mk || !CFG.metrics[mk] || !onMetricChange) return;
        if (btn.classList.contains('pvt-metric-blocked')) return;
        onMetricChange(mk, !!ev.shiftKey);
      });
      // Тултип при наведении
      btn.addEventListener('mouseenter', function(ev) {
        if (btn.classList.contains('pvt-metric-blocked')) {
          tooltip.textContent = CFG.text.metricBlockedTitle + ': ' + CFG.text.metricBlockedText;
        } else {
          tooltip.textContent = 'Shift+клик — можно выбрать несколько метрик';
        }
        tooltip.classList.add('show');
        positionTooltip(ev);
      });
      btn.addEventListener('mousemove', function(ev) { positionTooltip(ev); });
      btn.addEventListener('mouseleave', function() { tooltip.classList.remove('show'); });
    });

    overlay.querySelectorAll('.pvt-sortable').forEach(function(th) {
      th.addEventListener('click', function() {
        var bk = th.getAttribute('data-bucket-key');
        if (!bk || !onSortChange) return;
        var cur = ctx.sortState, next;
        if (!cur || cur.bucketKey !== bk) next = { bucketKey: bk, dir: 'asc' };
        else if (cur.dir === 'asc') next = { bucketKey: bk, dir: 'desc' };
        else next = null;
        onSortChange(next);
      });
    });

    var barsCell = overlay.querySelector('#pvt-bars-cell');
    var filterLabelEl = overlay.querySelector('#pvt-bars-filter-label');
    var barsTitleRow = overlay.querySelector('#pvt-bars-title-row');
    var clearBtn = overlay.querySelector('#pvt-bars-clear');
    var filterRowEl = overlay.querySelector('.pvt-toolbar-filter-row');
    var modeRowEl = overlay.querySelector('#pvt-bars-mode-row');
    var collapsedGroups = {};
    var A = ctx.aggregation, buckets = ctx.buckets, bucketLabels = ctx.bucketLabels, W = ctx.widths;
    var aggByMetric = ctx.aggByMetric || {};
    var metricsArr = ctx.metrics || [ctx.metricKey];
    var granularityLocal = ctx.granularity;

    var currentModeLocal = initialMode || 'value';
    // Состояние баров — map по метрикам
    var currentValsByMk = {}, currentTotalsByMk = {};
    metricsArr.forEach(function(mk) {
      currentValsByMk[mk] = (aggByMetric[mk] && aggByMetric[mk].totalAgg) || {};
      currentTotalsByMk[mk] = currentValsByMk[mk];
    });
    var currentFilterLabel = CFG.text.totalAllLabel, currentIsFiltered = false;

    function redrawBars(valsByMk, totsByMk, filterLabel, isFiltered) {
      currentValsByMk = valsByMk; currentTotalsByMk = totsByMk;
      currentFilterLabel = filterLabel; currentIsFiltered = isFiltered;
      if (barsCell) {
        barsCell.innerHTML = buildBarsSvgMulti(buckets, bucketLabels, valsByMk, totsByMk, isFiltered, currentModeLocal, W.colWidth, W.lastColExtra, metricsArr, ctx.metricKey);
        attachBarTooltips();
      }
      if (filterLabelEl) {
        filterLabelEl.textContent = isFiltered ? filterLabel : '';
        filterLabelEl.style.display = isFiltered ? 'inline-flex' : 'none';
      }
      if (filterRowEl) filterRowEl.classList.toggle('has-filter', isFiltered);
      if (barsTitleRow) barsTitleRow.classList.toggle('is-filtered', isFiltered);
      if (clearBtn) clearBtn.classList.toggle('hidden', !isFiltered);
      if (modeRowEl) modeRowEl.style.display = isFiltered ? '' : 'none';
      if (overlay._fixStickyTops) overlay._fixStickyTops();
    }
    function attachBarTooltips() {
      if (!barsCell) return;
      // Тултип на весь бар (невидимый hover-rect с data-bk)
      barsCell.querySelectorAll('rect[data-bk]').forEach(function(rect) {
        // Пропускаем фоновые rect (opacity="0.5")
        if (rect.getAttribute('opacity') === '0.5') return;
        rect.addEventListener('mouseenter', function() {
          var lbl = rect.getAttribute('data-label') || '', val = rect.getAttribute('data-value') || '';
          var tot = rect.getAttribute('data-total') || '', share = rect.getAttribute('data-share');
          var mk = rect.getAttribute('data-metric') || ctx.metricKey;
          var mCfg = CFG.metrics[mk] || CFG.metrics.hc;
          var h = '<b>' + escHtml(currentFilterLabel) + '</b><br>' + escHtml(mCfg.label) + ' · ' + escHtml(lbl) + '<br>Значение: <b>' + escHtml(val) + ' ' + escHtml(mCfg.unit) + '</b>';
          if (currentIsFiltered && tot && tot !== val) { h += '<br>Общий: ' + escHtml(tot); if (share !== null) h += '<br>Доля: <b>' + escHtml(String(share).replace('.', ',')) + '%</b>'; }
          tooltip.innerHTML = h; tooltip.classList.add('show');
        });
        rect.addEventListener('mousemove', positionTooltip);
        rect.addEventListener('mouseleave', function() { tooltip.classList.remove('show'); });
      });
    }
    attachBarTooltips();

    var modeButtons = overlay.querySelectorAll('#pvt-bars-mode button');
    modeButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        var m = btn.getAttribute('data-mode');
        if (m === currentModeLocal) return;
        currentModeLocal = m;
        modeButtons.forEach(function(b) { b.classList.toggle('active', b.getAttribute('data-mode') === currentModeLocal); });
        if (onModeChange) onModeChange(currentModeLocal);
        redrawBars(currentValsByMk, currentTotalsByMk, currentFilterLabel, currentIsFiltered);
      });
    });

    var toggleBarsBtn = overlay.querySelector('#pvt-toggle-bars');
    if (toggleBarsBtn) {
      toggleBarsBtn.addEventListener('click', function() { if (onBarsToggle) onBarsToggle(); });
      // Тултип при наведении
      toggleBarsBtn.addEventListener('mouseenter', function(ev) {
        var icon = toggleBarsBtn.innerHTML;
        tooltip.textContent = icon.indexOf('M1 15') !== -1 ? CFG.text.barsShow : CFG.text.barsHide;
        tooltip.classList.add('show');
        positionTooltip(ev);
      });
      toggleBarsBtn.addEventListener('mousemove', function(ev) { positionTooltip(ev); });
      toggleBarsBtn.addEventListener('mouseleave', function() { tooltip.classList.remove('show'); });
    }

    var copyBtn = overlay.querySelector('#pvt-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function() { doCopy(copyBtn); });
      // Тултип при наведении
      copyBtn.addEventListener('mouseenter', function(ev) {
        tooltip.textContent = CFG.text.copyBtnTitle;
        tooltip.classList.add('show');
        positionTooltip(ev);
      });
      copyBtn.addEventListener('mousemove', function(ev) { positionTooltip(ev); });
      copyBtn.addEventListener('mouseleave', function() { tooltip.classList.remove('show'); });
    }

    // TSV: шапка по уровням разрезов + бакеты (каждая метрика отдельной колонкой в multi-режиме).
    // Итоги (Итого, Подытоги) НЕ включаются — только данные по разрезам для удобства работы в Excel.
    function collectExportData() {
      var M = metricsArr.length;
      var perMetricLabels = M > 1;
      var bucketHdrs = [];
      ctx.bucketLabels.forEach(function(bl) {
        if (perMetricLabels) metricsArr.forEach(function(mk) { bucketHdrs.push(bl + ' — ' + CFG.metrics[mk].label); });
        else bucketHdrs.push(bl);
      });

      var maxDepth = 1;
      overlay.querySelectorAll('tbody tr').forEach(function(tr) {
        var cls = tr.className || '';
        if (cls.indexOf('pvt-hidden') !== -1) return;
        if (cls.indexOf('leaf') === -1) return;
        var path = (tr.getAttribute('data-full-path') || '').split(SEP).filter(function(part) { return part != null && part !== ''; });
        if (path.length > maxDepth) maxDepth = path.length;
      });

      var levelHeaders = [];
      for (var li = 0; li < maxDepth; li++) {
        levelHeaders.push(li === 0 ? CFG.text.copyGroupHeader : (CFG.text.copySubHeader + ' ' + li));
      }
      var headers = levelHeaders.concat(bucketHdrs);

      var rows = [];
      overlay.querySelectorAll('tbody tr').forEach(function(tr) {
        var cls = tr.className || '';
        if (cls.indexOf('pvt-hidden') !== -1) return;
        if (cls.indexOf('leaf') === -1) return;

        var vals = [], cells = tr.children;
        for (var ci = 1; ci < cells.length; ci++) {
          var td = cells[ci];
          if (td.className.indexOf('val') === -1) continue;
          var raw = td.getAttribute('data-raw');
          vals.push(raw != null && raw !== '' ? Number(raw) : 0);
        }

        var path = (tr.getAttribute('data-full-path') || '').split(SEP).filter(function(part) { return part != null && part !== ''; });
        var dims = [];
        for (var di = 0; di < maxDepth; di++) dims.push(path[di] || '');
        rows.push({ dims: dims, values: vals });
      });
      return { headers: headers, rows: rows, dimensionCount: maxDepth };
    }
    function buildTsv(d) {
      function cell(v) { var s = String(v == null ? '' : v); return s.replace(/[\t\n\r]/g, ' '); }
      var lines = [d.headers.map(cell).join('\t')];
      d.rows.forEach(function(r) {
        var row = r.dims.map(cell);
        r.values.forEach(function(v) { row.push(v == null ? '' : v); });
        lines.push(row.join('\t'));
      });
      return lines.join('\n');
    }
    function flashCopyBtn(btn, ok) {
      if (!btn) return;
      var orig = btn.getAttribute('data-orig-html') || btn.innerHTML;
      btn.setAttribute('data-orig-html', orig);
      btn.innerHTML = ok ? ICON_CHECK : ICON_COPY;
      btn.setAttribute('title', ok ? CFG.text.copySuccessMsg : CFG.text.copyErrorMsg);
      btn.classList.toggle('pvt-copy-success', ok);
      btn.classList.toggle('pvt-copy-error', !ok);
      clearTimeout(btn.pvtCopyTimer);
      btn.pvtCopyTimer = setTimeout(function() {
        btn.innerHTML = orig; btn.setAttribute('title', CFG.text.copyBtnTitle);
        btn.classList.remove('pvt-copy-success'); btn.classList.remove('pvt-copy-error');
      }, 1400);
    }
    function doCopy(btn) {
      var tsv = buildTsv(collectExportData());
      var done = function(ok) { flashCopyBtn(btn, ok); };
      function fallback() {
        try {
          var ta = document.createElement('textarea');
          ta.value = tsv; ta.style.position = 'fixed'; ta.style.left = '-9999px';
          document.body.appendChild(ta); ta.select();
          var ok = document.execCommand('copy'); document.body.removeChild(ta); done(!!ok);
        } catch (e) { done(false); }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(function() { done(true); }, fallback);
      } else fallback();
    }

    overlay.querySelectorAll('tr.lvl-0 .pvt-caret, tr.lvl-1 .pvt-caret, tr.lvl-2 .pvt-caret').forEach(function(caret) {
      caret.addEventListener('click', function(e) {
        e.stopPropagation();
        var tr = caret.closest('tr[data-group-id]'); if (!tr) return;
        var gid = tr.getAttribute('data-group-id'); if (!gid) return;
        collapsedGroups[gid] = !collapsedGroups[gid];
        tr.classList.toggle('pvt-grp-collapsed', collapsedGroups[gid]);
        toggleDescendants(tr, collapsedGroups[gid]);
      });
    });
    function toggleDescendants(tr, collapse) {
      var basePath = tr.getAttribute('data-path') || ''; if (basePath === '') return;
      var prefix = basePath + SEP;
      overlay.querySelectorAll('tbody tr[data-path]').forEach(function(r) {
        var p = r.getAttribute('data-path') || '';
        if (p.indexOf(prefix) !== 0) return;
        if (collapse) r.classList.add('pvt-hidden');
        else r.classList.toggle('pvt-hidden', isAncestorCollapsed(basePath, p));
      });
    }
    function isAncestorCollapsed(fromPath, childPath) {
      var relative = childPath.substring(fromPath.length + 1), parts = relative.split(SEP), acc = fromPath;
      for (var i = 0; i < parts.length - 1; i++) {
        acc = acc + SEP + parts[i];
        var mid = overlay.querySelector('tbody tr[data-path="' + acc.replace(/([\\"])/g, '\\$1') + '"]');
        if (mid && mid.getAttribute('data-group-id') && collapsedGroups[mid.getAttribute('data-group-id')]) return true;
      }
      return false;
    }

    var activeRow = null;
    function totalsMap() {
      var out = {};
      metricsArr.forEach(function(mk) { out[mk] = (aggByMetric[mk] && aggByMetric[mk].totalAgg) || {}; });
      return out;
    }
    function pathMap(path) {
      var out = {};
      metricsArr.forEach(function(mk) {
        var pa = aggByMetric[mk] && aggByMetric[mk].pathAgg;
        out[mk] = (pa && pa[path]) || {};
      });
      return out;
    }
    function resetBars() {
      overlay.querySelectorAll('tr.pvt-row-active').forEach(function(r) { r.classList.remove('pvt-row-active'); });
      activeRow = null;
      var tots = totalsMap();
      redrawBars(tots, tots, CFG.text.totalAllLabel, false);
    }
    function filterByRow(tr) {
      var path = tr.getAttribute('data-path') || '';
      if (!path) { resetBars(); return; }
      overlay.querySelectorAll('tr.pvt-row-active').forEach(function(r) { r.classList.remove('pvt-row-active'); });
      tr.classList.add('pvt-row-active'); activeRow = tr;
      var barsHidden = barsTitleRow && barsTitleRow.style.display === 'none';
      redrawBars(pathMap(path), totalsMap(), path.split(SEP).join(' → '), !barsHidden);
    }
    overlay.querySelectorAll('tr.lvl-0, tr.lvl-1, tr.lvl-2, tr.leaf, tr.total').forEach(function(tr) {
      tr.addEventListener('click', function() {
        if (tr === activeRow || tr.classList.contains('total')) { resetBars(); return; }
        filterByRow(tr);
      });
    });
    if (clearBtn) clearBtn.addEventListener('click', resetBars);

    // Общая каретка Итого — свернуть/развернуть все
    var totalToggle = overlay.querySelector('#pvt-total-toggle');
    var allCollapsed = false;
    function doCollapseAll() {
      allCollapsed = !allCollapsed;
      if (totalToggle) totalToggle.classList.toggle('all-collapsed', allCollapsed);
      overlay.querySelectorAll('tr[data-group-id]').forEach(function(tr) {
        var gid = tr.getAttribute('data-group-id'); if (!gid) return;
        collapsedGroups[gid] = allCollapsed;
        tr.classList.toggle('pvt-grp-collapsed', allCollapsed);
      });
      var hideThreshold = (LEVELS === 1) ? -1 : 0;
      overlay.querySelectorAll('tbody tr').forEach(function(r) {
        if (r.classList.contains('total')) return;
        if (parseInt(r.getAttribute('data-depth') || '-1', 10) > hideThreshold) r.classList.toggle('pvt-hidden', allCollapsed);
      });
    }
    if (totalToggle) {
      var totalLblCell = totalToggle.closest('td.lbl');
      if (totalLblCell) {
        totalLblCell.style.cursor = 'pointer';
        totalLblCell.addEventListener('click', function(e) { e.stopPropagation(); doCollapseAll(); });
      }
    }

    var searchInput = overlay.querySelector('#pvt-search-input');
    searchInput.addEventListener('input', function() {
      var q = searchInput.value.toLowerCase().trim();
      var allRows = overlay.querySelectorAll('tbody tr');
      // Ищем элемент внутри текущего overlay
      var noResultsEl = overlay.querySelector('#pvt-search-no-results');

      if (!q) {
        allRows.forEach(function(tr) { tr.classList.remove('pvt-hidden'); });
        if (noResultsEl) noResultsEl.classList.remove('show');
        return;
      }

      var matched = {};
      allRows.forEach(function(tr) {
        if (tr.classList.contains('total')) return;
        if ((tr.getAttribute('data-search') || '').indexOf(q) === -1) return;
        var p = tr.getAttribute('data-path') || ''; if (p) matched[p] = true;
      });
      var visible = {};
      Object.keys(matched).forEach(function(p) {
        var parts = p.split(SEP);
        for (var i = 1; i <= parts.length; i++) visible[parts.slice(0, i).join(SEP)] = true;
      });
      var matchedList = Object.keys(matched);
      var visibleDataCount = 0;
      allRows.forEach(function(tr) {
        if (tr.classList.contains('total')) {
          if (matchedList.length === 0) tr.classList.add('pvt-hidden');
          else tr.classList.remove('pvt-hidden');
          return;
        }
        var p = tr.getAttribute('data-path') || '';
        if (!p) { tr.classList.add('pvt-hidden'); return; }
        var vis = !!visible[p];
        if (!vis) {
          for (var i = 0; i < matchedList.length; i++) {
            if (p.indexOf(matchedList[i] + SEP) === 0) { vis = true; break; }
          }
        }
        tr.classList.toggle('pvt-hidden', !vis);
        if (vis) visibleDataCount++;
      });

      if (noResultsEl) {
        if (visibleDataCount === 0) noResultsEl.classList.add('show');
        else noResultsEl.classList.remove('show');
      }
    });

    // Предыдущий бакет той же гранулярности (соседний слева по дате).
    function prevBucketKey(bk, g) {
      if (!bk) return null;
      if (g === 'year') { var y = parseInt(bk, 10); return isNaN(y) ? null : String(y - 1); }
      if (g === 'quarter') {
        var qp = String(bk).split('-Q'); var yy = parseInt(qp[0], 10), qq = parseInt(qp[1], 10);
        if (isNaN(yy) || isNaN(qq)) return null;
        qq--; if (qq < 1) { qq = 4; yy--; }
        return yy + '-Q' + qq;
      }
      // month
      var mp = String(bk).split('-'); var my = parseInt(mp[0], 10), mm = parseInt(mp[1], 10);
      if (isNaN(my) || isNaN(mm)) return null;
      mm--; if (mm < 1) { mm = 12; my--; }
      return my + '-' + (mm < 10 ? '0' + mm : mm);
    }
    var COMPARE_LABEL = { month: 'MoM', quarter: 'QoQ', year: 'YoY' };

    overlay.querySelectorAll('td.val').forEach(function(td) {
      td.addEventListener('mouseenter', function() {
        var tip = td.getAttribute('data-tip'); if (!tip) return;
        // parts: label|periodLabel|value|metricKey|bucketKey|path
        var parts = tip.split('|');
        var label = parts[0] || '', periodLbl = parts[1] || '', valStr = parts[2] || '';
        var mk = parts[3] || ctx.metricKey, bk = parts[4] || '', path = parts[5] || '';
        var mCfg = CFG.metrics[mk] || CFG.metrics.hc;
        var raw = Number(td.getAttribute('data-raw') || 0);
        var html = '<b>' + escHtml(label) + '</b><br>' + escHtml(mCfg.label) + ' · ' + escHtml(periodLbl) +
                   '<br>Значение: <b>' + escHtml(valStr) + ' ' + escHtml(mCfg.unit) + '</b>';
        var prevBk = prevBucketKey(bk, granularityLocal);
        if (prevBk) {
          var Amk = aggByMetric[mk];
          var prevVal = null;
          if (Amk) {
            if (path === '') prevVal = (Amk.totalAgg && Amk.totalAgg[prevBk]) || null;
            else prevVal = (Amk.pathAgg && Amk.pathAgg[path] && Amk.pathAgg[path][prevBk]) || null;
          }
          // Показываем MoM/YoQ/YoY только если есть данные в предыдущем периоде
          if (prevVal !== null) {
            var diff = raw - prevVal;
            // Определяем метрику из data-tip (для multi-метрики) или из контекста
            var metricFromTip = parts[3] || ctx.metricKey || currentMetric;
            var isAttr = (metricFromTip === 'attr');
            // Для оттока инвертируем цвет: рост = плохо (красный), снижение = хорошо (зелёный)
            var color = isAttr
              ? (diff > 0 ? '#D14343' : (diff < 0 ? '#3FA34D' : '#B8B8B8'))
              : (diff > 0 ? '#3FA34D' : (diff < 0 ? '#D14343' : '#B8B8B8'));
            // Форматируем diff: со знаком минуса для отрицательных, просто 0 для нуля
            var diffAbs = fmt(Math.abs(diff));
            var diffText = (diff === 0) ? '0' : (diff < 0 ? '-' + diffAbs : '+' + diffAbs);
            // Процент: для 0 выводим 0%, иначе считаем
            var pctText;
            if (diff === 0) {
              pctText = '0%';
            } else if (prevVal === 0) {
              pctText = '—';
            } else {
              var pctVal = Math.round(Math.abs(diff) / Math.abs(prevVal) * 1000) / 10;
              pctText = fmt(pctVal).replace(/\u00a0/g, '') + '%';
            }
            html += '<br><span style="opacity:.7;">' + COMPARE_LABEL[granularityLocal] + ' к ' + escHtml(bucketLabel(prevBk, granularityLocal)) + ':</span> ' +
                    '<span style="color:' + color + ';font-weight:600;">' + diffText + ' (' + escHtml(pctText.replace('.', ',')) + ')</span>';
          }
        }
        tooltip.innerHTML = html;
        tooltip.classList.add('show');
      });
      td.addEventListener('mousemove', positionTooltip);
      td.addEventListener('mouseleave', function() { tooltip.classList.remove('show'); });
    });

    overlay.querySelectorAll('#pvt-gran button').forEach(function(btn) {
      btn.addEventListener('click', function() { if (onGranularityChange) onGranularityChange(btn.getAttribute('data-gran')); });
    });
  }

  // ---------- БЛОК 15: DOM + RESIZE ----------
  try {
    document.querySelectorAll('.pvt-html-overlay').forEach(function(o) { o.remove(); });
    if (window.__pvtResizeObserver) { try { window.__pvtResizeObserver.disconnect(); } catch(e) {} window.__pvtResizeObserver = null; }
    if (window.__pvtResizeHandler) { window.removeEventListener('resize', window.__pvtResizeHandler); window.__pvtResizeHandler = null; }

    var echartElList = document.querySelectorAll('[_echarts_instance_]');
    var echartEl = echartElList[echartElList.length - 1];
    if (echartEl) {
      echartEl.querySelectorAll('canvas').forEach(function(c) { c.style.display = 'none'; });
      var node = echartEl, depthN = 0;
      while (node && depthN < 5) { node.style.overflow = 'hidden'; node.style.height = node.clientHeight + 'px'; node = node.parentElement; depthN++; }
      echartEl.style.position = 'relative'; echartEl.style.overflow = 'hidden';

      var render = function() {
        // Сохраняем текущее состояние перед перерисовкой
        window.__pvtState = {
          metric: currentMetric,
          metrics: currentMetrics,
          granularity: currentGranularity,
          mode: currentMode,
          barsVisible: currentBarsVisible,
          sort: currentSort
        };
                var cw = echartEl.clientWidth || 2400;
        var prevOverlay = echartEl.querySelector('.pvt-html-overlay');
        var collapsedState = {}, searchValue = '', scrollLeft = 0, scrollTop = 0, allCollapsedState = false;
        if (prevOverlay) {
          prevOverlay.querySelectorAll('tr.pvt-grp-collapsed').forEach(function(tr) { var p = tr.getAttribute('data-path'); if (p) collapsedState[p] = true; });
          var tt = prevOverlay.querySelector('#pvt-total-toggle'); if (tt && tt.classList.contains('all-collapsed')) allCollapsedState = true;
          var si = prevOverlay.querySelector('#pvt-search-input'); if (si) searchValue = si.value;
          var sc = prevOverlay.querySelector('#pvt-scroll'); if (sc) { scrollLeft = sc.scrollLeft; scrollTop = sc.scrollTop; }
          prevOverlay.remove();
        }
        var overlay = document.createElement('div');
        overlay.className = 'pvt-html-overlay';
        overlay.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;z-index:999;background:var(--card);box-sizing:border-box;';
        var built = buildHtml(cw, currentGranularity, currentMetrics, currentMetric, currentSort, currentBarsVisible);
        overlay.innerHTML = built.html;
        echartEl.appendChild(overlay);

        // Точная стыковка sticky-строк: bars → period → metric → total
        // Оформлена как переиспользуемая функция — пересчитывается при изменении высоты bars-row
        // (например, при показе/скрытии переключателя режимов внутри подсказки).
        overlay._fixStickyTops = function fixStickyTops() {
          var barsRow = overlay.querySelector('.pvt-tbl thead tr.bars-row');
          var periodRow = overlay.querySelector('.pvt-tbl thead tr.period-row');
          var metricRow = overlay.querySelector('.pvt-tbl thead tr.metric-row');
          if (!periodRow) return;
          var barsH   = (currentBarsVisible && barsRow) ? barsRow.getBoundingClientRect().height : 0;
          var periodH = periodRow.getBoundingClientRect().height;
          var metricH = metricRow ? metricRow.getBoundingClientRect().height : 0;
          periodRow.querySelectorAll('th').forEach(function(th) { th.style.top = Math.round(barsH) + 'px'; });
          if (metricRow) {
            var metricTop = barsH + periodH;
            metricRow.querySelectorAll('th').forEach(function(th) { th.style.top = Math.round(metricTop) + 'px'; });
          }
          var totalTop = barsH + periodH + metricH;
          overlay.querySelectorAll('tr.total td, tr.total .lbl').forEach(function(cell) { cell.style.top = Math.round(totalTop) + 'px'; });
        };
        overlay._fixStickyTops();

        attachHandlers(overlay,
          { aggregation: built.aggregation, buckets: built.buckets, bucketLabels: built.bucketLabels, widths: built.widths, sortState: currentSort, metricKey: built.metricKey, metrics: built.metrics, aggByMetric: built.aggByMetric, granularity: currentGranularity },
          currentMode,
          function(g) {
            if (g === currentGranularity) return;
            currentGranularity = g;
            currentSort = null;
            window.__pvtState.granularity = g;
            render();
          },
          function(m) { currentMode = m; window.__pvtState.mode = m; },
          function(s) { currentSort = s; window.__pvtState.sort = s; render(); },
          function() { currentBarsVisible = !currentBarsVisible; window.__pvtState.barsVisible = currentBarsVisible; render(); },
          function(mk, withShift) {
            if (!CFG.metrics[mk]) return;
            // Проверка блокировки метрики при разрезах увольнений
            var blocked = getBlockedMetrics();
            if (blocked.indexOf(mk) >= 0) return; // Игнорируем клики по заблокированным
            
            // Подготовим rawDataByMetric[mk] — если ещё не есть
            if (!rawDataByMetric[mk]) {
              var rd = expandMonthsValues(sourceData, mk);
              normalizeRawData(rd);
              rawDataByMetric[mk] = rd;
            }
            if (withShift) {
              // Toggle в currentMetrics; primary не меняем если он остаётся
              var idx = currentMetrics.indexOf(mk);
              if (idx >= 0) {
                if (currentMetrics.length === 1) return; // не убираем последнюю
                currentMetrics.splice(idx, 1);
                if (currentMetric === mk) currentMetric = currentMetrics[0];
              } else {
                currentMetrics.push(mk);
              }
            } else {
              // Обычный клик — полная замена (одна метрика)
              if (mk === currentMetric && currentMetrics.length === 1) return;
              currentMetric = mk;
              currentMetrics = [mk];
              // Перепарс бейджей под новую primary-метрику (лимит/полнота)
              // Метаданные читаем из sourceData — они одинаковы для всех метрик
              limitInfo = { total: null, shown: null, limited: false };
              completenessByPath = {};
              countByPath = {};
              rawData = rawDataByMetric[mk];
              // Восстанавливаем completenessByPath из sourceData — метаданные общие для всех метрик
              (function recomputeCompleteness() {
                var F = CFG.fields;
                sourceData.forEach(function(r) {
                  if (!r) return;
                  if (r[F.total_groups] != null) limitInfo.total = Number(r[F.total_groups]);
                  if (r[F.shown_groups] != null) limitInfo.shown = Number(r[F.shown_groups]);
                  if (Number(r[F.limit_flg] || 0) === 1) limitInfo.limited = true;
                  var p1 = cleanTextValue(r[F.param1]);
                  var p2 = cleanTextValue(r[F.param2]);
                  // L0 completeness
                  if (r[F.l1_total] != null && r[F.l1_shown] != null) {
                    var l1t = Number(r[F.l1_total]);
                    var l1s = Number(r[F.l1_shown]);
                    if (!completenessByPath[p1]) {
                      completenessByPath[p1] = {
                        shown: l1s, total: l1t,
                        complete: (Number(r[F.l1_complete] || 0) === 1) || l1s >= l1t
                      };
                    }
                  }
                  // L1 completeness
                  if (r[F.l2_total] != null && r[F.l2_shown] != null) {
                    var key = p1 + SEP + p2;
                    var l2t = Number(r[F.l2_total]);
                    var l2s = Number(r[F.l2_shown]);
                    if (!completenessByPath[key]) {
                      completenessByPath[key] = {
                        shown: l2s, total: l2t,
                        complete: (Number(r[F.l2_complete] || 0) === 1) || l2s >= l2t
                      };
                    }
                  }
                });
              })();
              (function recomputeCounts() {
                var F = CFG.fields;
                var childrenCount = {};
                sourceData.forEach(function(r) {
                  if (!r) return;
                  var p1 = cleanTextValue(r[F.param1]);
                  var p2 = cleanTextValue(r[F.param2]);
                  var p3 = cleanTextValue(r[F.param3]);
                  // Собираем все реальные (непустые) значения уровней
                  var levels = [];
                  if (p1 && p1 !== '—') levels.push(p1);
                  if (p2 && p2 !== '—') levels.push(p2);
                  if (p3 && p3 !== '—') levels.push(p3);
                  // Для каждого префикса пути считаем следующего ребёнка
                  for (var i = 0; i < levels.length - 1; i++) {
                    var parentPath = levels.slice(0, i + 1).join(SEP);
                    var childValue = levels[i + 1];
                    if (!childrenCount[parentPath]) childrenCount[parentPath] = {};
                    childrenCount[parentPath][childValue] = true;
                  }
                });
                Object.keys(childrenCount).forEach(function(path) {
                  countByPath[path] = Object.keys(childrenCount[path]).length;
                });
              })();
            }
            // Сохраняем состояние метрик
            window.__pvtState.metric = currentMetric;
            window.__pvtState.metrics = currentMetrics;
            render();
          }
        );

        // Восстанавливаем состояние
        Object.keys(collapsedState).forEach(function(p) {
          var esc = p.replace(/([\\"])/g, '\\$1');
          var tr = overlay.querySelector('tr[data-path="' + esc + '"][data-group-id]');
          if (tr) {
            tr.classList.add('pvt-grp-collapsed');
            var prefix = p + SEP;
            overlay.querySelectorAll('tbody tr[data-path]').forEach(function(r) {
              if ((r.getAttribute('data-path') || '').indexOf(prefix) === 0) r.classList.add('pvt-hidden');
            });
          }
        });
        if (allCollapsedState) {
          var tt2 = overlay.querySelector('#pvt-total-toggle');
          if (tt2) tt2.classList.add('all-collapsed');
          overlay.querySelectorAll('tr[data-group-id]').forEach(function(tr) { tr.classList.add('pvt-grp-collapsed'); });
          var hideThr = (LEVELS === 1) ? -1 : 0;
          overlay.querySelectorAll('tbody tr').forEach(function(r) {
            if (r.classList.contains('total')) return;
            if (parseInt(r.getAttribute('data-depth') || '-1', 10) > hideThr) r.classList.add('pvt-hidden');
          });
        }
        if (searchValue) {
          var si2 = overlay.querySelector('#pvt-search-input');
          if (si2) { si2.value = searchValue; si2.dispatchEvent(new Event('input')); }
        } else {
          var noRes = overlay.querySelector('#pvt-search-no-results');
          if (noRes) noRes.classList.remove('show');
        }
        var sc2 = overlay.querySelector('#pvt-scroll');
        if (sc2) { sc2.scrollLeft = scrollLeft; sc2.scrollTop = scrollTop; }
      };

      render();

      var resizeTimer = null;
      window.__pvtResizeObserver = new ResizeObserver(function() { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); });
      window.__pvtResizeObserver.observe(echartEl);
      window.__pvtResizeObserver.observe(document.body);
      window.__pvtResizeHandler = function() { if (resizeTimer) clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); };
      window.addEventListener('resize', window.__pvtResizeHandler);
    }
  } catch(e) {
    option = { animation: false, graphic: [{ type: 'text', left: 10, top: 10, style: { text: 'Ошибка визуализации: ' + (e && e.message ? e.message : e), fill: '#c00', font: '14px monospace' } }] };
  }

  // ---------- БЛОК 16: ПУСТОЙ ECHARTS-КОНФИГ ----------
  option = {
    animation: false, tooltip: { show: false },
    grid: { show: false, left: 0, right: 0, top: 0, bottom: 0 },
    xAxis: { show: false, type: 'value' }, yAxis: { show: false, type: 'value' },
    series: [{ type: 'scatter', data: [], silent: true }]
  };
}