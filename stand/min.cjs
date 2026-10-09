// kit/min.cjs — сжатая сборка JS кастомного чарта Proteus (react_sanbbox) для папки поставки и её проверка.
//
// Зачем. Proteus кладёт код чарта в form_data.jsx КАЖДОГО POST chart/data: открытие борда, «Применить», кросс-фильтр,
// даже ответ из кэша. Тело POST браузер не сжимает; отправка у владельца ≈50 КБ/с (DevTools 07.10), то есть 169 КБ кода —
// 5,8 с на каждый запрос. Сборка без комментариев и пробелов, с короткими локальными именами режет код на 40–45 %
// (playbook: CJ-21 в 07-chart.md, DV-06 в 14-delivery.md; замеры на чартах четырёх проектов — kit/RESULTS.js.md).
//
// Что НЕ трогается: верхний уровень скрипта. option, data, applyCrossFilter, имена функций и переменных верхнего
// уровня — контракт песочницы и скилла proteus-echarts-builder (toplevel: false и в compress, и в mangle). Кириллица
// остаётся как есть (ascii_only: false): «\uXXXX» — 6 байт против 2 у UTF-8. Аргументы функций не выбрасываются
// (keep_fargs). terser с ecma: 5 синтаксис НЕ понижает: на вход нужен уже ES5 (CJ-02; макет на современном JS — сначала
// Babel, CJ-23).
//
// Запуск (terser — глобально, версия закреплена: иначе сборка поплывёт и `pack.py --check` разойдётся):
//   npm i -g terser@5.51.2
//   NODE_PATH=$(npm root -g) node kit/min.cjs 'шапка' < proteus/report.chart.js > 'Поставка/2. Чарт.js'
//   NODE_PATH=$(npm root -g) node kit/min.cjs 'шапка' --check < in.js > out.js     # + проверка результата (stderr)
//   NODE_PATH=$(npm root -g) node kit/min.cjs --verify 'Поставка/2. Чарт.js'        # проверить готовую сборку
//   NODE_PATH=$(npm root -g) node kit/min.cjs 'шапка' --check --css-var TP_CSS --budget 360 < in.js > out.js
//
// Флаги (после шапки, порядок любой):
//   --check            после сжатия проверить результат; провал — код 1, в stdout ничего не пишется;
//   --verify <файл>    только проверка готового файла (без сжатия), сводка — в stdout;
//   --css-var ИМЯ      строку CSS в `var ИМЯ = "…"` верхнего уровня сжать до сборки (без комментариев и лишних
//                      пробелов; правила CSS после сжатия те же — сверка CSSOM в kit/RESULTS.js.md); можно несколько раз;
//   --budget КиБ       сборка больше — провал (код 1): каждый КиБ кода — в каждом запросе данных;
//   --kbps N           скорость отправки для оценки «≈ с на запрос» (по умолчанию 50 — замер владельца 07.10).
// Размеры — в байтах и КиБ (1 КиБ = 1 024 Б). Сводка («было → стало, ≈ с отправки») — в stderr, сборка — в stdout.
// Без флагов вывод байт в байт как у detail_list:stand/min.cjs (проверено cmp на обоих чартах DL), так что проект может
// перейти на kit/min.cjs без смены поставки. Коды выхода: 0 — сборка годится; 1 — сжатие или проверка не прошли;
// 2 — неверный вызов или не запустилось (нет файла, нет terser): ничего не проверено.
//
// Проверка (--check / --verify):
//   1. разбор acorn как ES5 (ecmaVersion 5, script): в песочнице ES5 — договор скилла (CJ-02); ES2015+ в сборке — ошибка;
//   2. глобальный option: присваивание `option = …` вне функций (terser сливает хвост в `…}(),option={…};` — это тоже
//      верхний уровень); если в исходнике это последний оператор — и в сборке (CJ-04);
//   3. имена верхнего уровня (var / function) исходника все на месте (только с --check: исходник под рукой);
//   4. нет кода из строки: eval, Function (с new и без, .call / .apply / .bind), они же через window. / self. / globalThis.,
//      косвенный (0, eval)(…), строка в setTimeout / setInterval — как no-eval / no-new-func / no-implied-eval у
//      kit/eslint.chart.cjs; код из строки в песочнице не проверен, загрузчик кода откачен (CJ-22, DV-07);
//   5. версия terser = 5.51.2 (иначе — предупреждение: сборка разойдётся с прежней).
// validate.py и check.py скилла гоняйте на исходнике: на сборке они падают по форме текста (C1, H3, S1, S3, S5…),
// а поведение сборки проверяет браузер — smoke скилла или kit/sbx/run.cjs (ST-30 в 13-stand.md).
// Модуль: require('<kit>/min.cjs') → { minifyChart, verify, cssMin, terserOptions, TERSER_PIN } для своих сборщиков.
'use strict';

const TERSER_PIN = '5.51.2';
const path = require('path');
const fs = require('fs');

// terser и acorn: из NODE_PATH; acorn — ещё и из зависимостей самого terser (у terser 5 он свой в node_modules)
function need(name) {
  try { return require(name); } catch (e) { /* дальше — рядом с terser */ }
  try {
    const base = path.dirname(require.resolve('terser'));
    return require(require.resolve(name, { paths: [base] }));
  } catch (e) {
    const err = new Error('нет модуля ' + name + ': npm i -g terser@' + TERSER_PIN + ' и NODE_PATH=$(npm root -g)');
    err.kitEnv = true;                                            // не запустилось — код 2, а не «сборка не годится»
    throw err;
  }
}

// Параметры terser — ровно как у detail_list:stand/min.cjs (сборки 21-й…27-й поставок, в бою с 23-й)
function terserOptions(head) {
  return {
    ecma: 5,
    toplevel: false,
    compress: { toplevel: false, keep_fargs: true },
    mangle: { toplevel: false },
    // «*/» в шапке закрыл бы комментарий раньше времени
    format: { ascii_only: false, comments: false, preamble: '/* ' + String(head || '').replace(/\*\//g, '* /') + ' */' },
  };
}

// ── CSS: сжатие строки стилей (консервативно: только комментарии и пробелы) ─────────────────────────────────────
// Строки, url(…) и var(…) переносятся как есть (у var() пробел в запасном значении — часть значения: CSSOM его хранит),
// значения кастомных свойств (--x: …) — тоже: CSSOM хранит их текстом. Вне них: пробелы — по одному; вокруг { } ; , > —
// без пробелов; «;» перед «}» — долой. Пробел ПОСЛЕ «:» снимается только в объявлениях (`color: red`): в селекторе и в
// условии @media / @supports он значим — `.a: hover` браузер отбрасывает, `.a:hover` нет. Пробел ПЕРЕД «:» остаётся:
// «.a :hover» (потомок) и «.a:hover» — разные селекторы. «+», «-», «~» не трогаются: calc(100vh - 230px) без пробелов
// ломается. Комментарий уходит без следа; между двумя словами (`#a/**/iframe`, `1px/**/2px`) на его месте — пустой
// `/**/`: пробел дал бы потомка там, где браузер отбросил бы правило, а склейка — одно слово вместо двух.
// Сверка «правила те же» (CSSOM в Chromium, в том числе на случайных комментариях) — kit/RESULTS.js.md, разделы 1 и 8.
function cssMin(css) {
  const segs = [];
  let buf = '', i = 0;
  const n = css.length;
  const flush = () => { if (buf) segs.push({ t: buf, keep: false }); buf = ''; };
  const strEnd = (j) => {                                        // конец строки в кавычках, начатой в j
    const q = css[j];
    let k = j + 1;
    while (k < n && css[k] !== q) k += css[k] === '\\' ? 2 : 1;
    return Math.min(k + 1, n);
  };
  const WORD = /[\w\-\\\u0080-\uffff]/;                          // знаки имени и числа: такие соседи слипаются
  const lastOut = () => (buf ? buf[buf.length - 1] : segs.length ? segs[segs.length - 1].t.slice(-1) : '');
  // конец вывода — «слово»: знак имени или экранированный знак (`.x\:` — часть имени, а не двоеточие)
  const tailWord = () => {
    const t = buf || (segs.length ? segs[segs.length - 1].t : '');
    if (!buf && t.charAt(0) === '\\') return true;                 // кусок-экран (`\31 `): имя продолжается за ним
    let k = t.length - 2, bs = 0;
    while (k >= 0 && t[k] === '\\') { bs++; k--; }
    return bs % 2 === 1 || WORD.test(t.slice(-1));
  };
  const lastSolid = () => { const t = buf.trimEnd(); return t ? t[t.length - 1] : buf ? '' : lastOut(); };
  // где мы: верх файла и блоки @media / @supports / @keyframes… — селекторы и условия; блок правила, @font-face, @page… —
  // объявления. Неизвестное at-правило — как селекторы (пробел после «:» остаётся: дороже на байт, но смысл тот же)
  const DECL_AT = /^(font-face|page|property|counter-style|font-palette-values|viewport|-ms-viewport)$/i;
  const stack = [];
  let stmt = '';                                                  // '' — оператор не начат; '@имя' — at-правило; 's' — прочее
  const inDecl = () => stack.length > 0 && stack[stack.length - 1] === 'decl';
  while (i < n) {
    const c = css[i];
    // значение кастомного свойства (--x: …) — как есть: CSSOM хранит его текстом, с пробелами и комментариями
    const cp = c === '-' && css[i + 1] === '-' && inDecl() && /^[{;]$/.test(lastSolid())
      ? /^--[\w\-\u0080-\uffff]*(?:\s|\/\*[\s\S]*?\*\/)*:/.exec(css.slice(i, i + 400)) : null;
    if (cp) {
      let j = i + cp[0].length, depth = 0;
      while (j < n && /\s/.test(css[j])) j++;
      const v0 = j;
      while (j < n) {
        const d = css[j];
        if (d === '"' || d === "'") { j = strEnd(j); continue; }
        if (d === '/' && css[j + 1] === '*') { const e = css.indexOf('*/', j + 2); j = e < 0 ? n : e + 2; continue; }
        if (d === '(' || d === '[' || d === '{') depth++;
        else if ((d === ')' || d === ']' || d === '}') && depth) depth--;
        else if ((d === ';' || d === '}') && !depth) break;
        j++;
      }
      buf += cp[0].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
      flush(); if (css.slice(v0, j).trim()) segs.push({ t: css.slice(v0, j).trim(), keep: true }); i = j;
      stmt = 's';
      continue;
    }
    if (c === '/' && css[i + 1] === '*') {                       // комментарий — долой
      const j = css.indexOf('*/', i + 2);
      i = j < 0 ? n : j + 2;
      const nx = css[i] || '';
      // слова слиплись бы: `and/**/(` стало бы функцией `and(`, `1/**/.5` — числом 1.5, `#a/**/b` — одним id
      if (tailWord() && (WORD.test(nx) || nx === '%' || nx === '(' || (nx === '.' && /\d/.test(css[i + 1] || '')))) buf += '/**/';
      continue;
    }
    if (c === '"' || c === "'") {                                // строка — как есть
      const j = strEnd(i);
      flush(); segs.push({ t: css.slice(i, j), keep: true }); i = j;
      if (!stmt) stmt = 's';
      continue;
    }
    const fn = /^(url|var)\(/i.exec(css.slice(i, i + 4));
    if (fn && !/[\w-]/.test(css[i - 1] || '')) {                // url(…) / var(…) — как есть, со вложенными скобками
      let j = i + fn[0].length, depth = 1;
      while (j < n && depth) {
        if (css[j] === '"' || css[j] === "'") { j = strEnd(j); continue; }
        if (css[j] === '(') depth++;
        else if (css[j] === ')') depth--;
        j++;
      }
      flush(); segs.push({ t: css.slice(i, j), keep: true }); i = j;
      if (!stmt) stmt = 's';
      continue;
    }
    // экранированный знак — как есть, это часть имени: `\:` не двоеточие, `\ ` не пробел, у `\31 ` пробел — конец
    // шестнадцатеричного кода; отдельным куском, чтобы склейка пробелов его не задела
    if (c === '\\' && i + 1 < n) {
      const e = /^\\(?:[0-9a-fA-F]{1,6}\s?|[\s\S])/.exec(css.slice(i, i + 8));
      flush(); segs.push({ t: e[0], keep: true }); i += e[0].length;
      if (!stmt) stmt = 's';
      continue;
    }
    if (/\s/.test(c)) {                                          // пробелы — один; после «:» в объявлении — ни одного
      while (i < n && /\s/.test(css[i])) i++;
      if (!(inDecl() && lastOut() === ':')) buf += ' ';
      continue;
    }
    if (!stmt) stmt = c === '@' ? '@' + ((/^@([\w-]+)/.exec(css.slice(i, i + 64)) || ['', ''])[1]) : 's';
    if (c === '{') {
      const at = stmt.charAt(0) === '@' ? stmt.slice(1) : '';
      stack.push(!at || DECL_AT.test(at) ? 'decl' : 'group');
      stmt = '';
    } else if (c === '}') { stack.pop(); stmt = ''; } else if (c === ';') stmt = '';
    buf += c;
    i++;
  }
  flush();
  // подряд идущие пробелы — один; затем пробелы у { } ; , > — долой; «;» (и «;;») перед «}» — долой.
  // Только вне строк, url(), var() и значений кастомных свойств: строка "a;}b" остаётся как есть (09.10)
  return segs.map((sg) => (sg.keep ? sg.t : sg.t.replace(/ {2,}/g, ' ').replace(/ ?([{};,>]) ?/g, '$1')
    .replace(/;+}/g, '}'))).join('').trim();
}

// `var ИМЯ = "…css…"` верхнего уровня → та же строка, сжатая cssMin (JSON-кавычки — как у сборщика TeamPulse)
function shrinkCssVars(src, names) {
  if (!names.length) return { src, notes: [] };
  const acorn = need('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
  const edits = [], notes = [];
  for (const st of ast.body) {
    if (st.type !== 'VariableDeclaration') continue;
    for (const d of st.declarations) {
      if (d.id.type === 'Identifier' && names.indexOf(d.id.name) > -1 && d.init && d.init.type === 'Literal' && typeof d.init.value === 'string') {
        const min = cssMin(d.init.value);
        edits.push([d.init.start, d.init.end, JSON.stringify(min)]);
        notes.push(d.id.name + ': CSS ' + size(Buffer.byteLength(d.init.value)) + ' → ' + size(Buffer.byteLength(min)));
      }
    }
  }
  const miss = names.filter((nm) => !notes.some((t) => t.indexOf(nm + ':') === 0));
  if (miss.length) throw new Error('--css-var: нет строки верхнего уровня `var ' + miss.join(', ') + ' = "…"`');
  edits.sort((a, b) => b[0] - a[0]).forEach((e) => { src = src.slice(0, e[0]) + e[2] + src.slice(e[1]); });
  return { src, notes };
}

// ── проверка сборки ──────────────────────────────────────────────────────────────────────────────────────────
// Обход без входа в функции: что выполняется на верхнем уровне скрипта
function walkTop(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  if (/Function/.test(node.type)) return;
  for (const k in node) {
    const v = node[k];
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    if (Array.isArray(v)) v.forEach((x) => walkTop(x, fn));
    else if (v && typeof v.type === 'string') walkTop(v, fn);
  }
}
function walkAll(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    const v = node[k];
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue;
    if (Array.isArray(v)) v.forEach((x) => walkAll(x, fn));
    else if (v && typeof v.type === 'string') walkAll(v, fn);
  }
}
function assignsOption(node) {
  let hit = false;
  walkTop(node, (x) => {
    if (x.type === 'AssignmentExpression' && x.left.type === 'Identifier' && x.left.name === 'option') hit = true;
  });
  return hit;
}
// Код из строки — как его ловят no-eval, no-new-func и no-implied-eval у ESLint (kit/eslint.chart.cjs): eval и Function
// (с new и без, .call / .apply / .bind), они же через window / self / globalThis / top / parent / frames, косвенный
// (0, eval)(…), строка в setTimeout / setInterval. → подпись находки или ''
const GLOBAL_OBJ = /^(window|self|globalThis|top|parent|frames)$/;
function calleeName(c) {
  if (!c) return '';
  if (c.type === 'Identifier') return c.name;
  if (c.type === 'SequenceExpression') return calleeName(c.expressions[c.expressions.length - 1]);
  if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && GLOBAL_OBJ.test(c.object.name)) {
    return c.computed ? (c.property.type === 'Literal' ? String(c.property.value) : '') : c.property.name;
  }
  return '';
}
function stringish(a) {
  if (!a) return false;
  if (a.type === 'Literal' && typeof a.value === 'string') return true;
  if (a.type === 'TemplateLiteral') return true;
  return a.type === 'BinaryExpression' && a.operator === '+' && (stringish(a.left) || stringish(a.right));
}
function codeFromString(x) {
  if (x.type !== 'CallExpression' && x.type !== 'NewExpression') return '';
  const nm = calleeName(x.callee), via = x.callee.type === 'Identifier' ? '' : ' (не напрямую)';
  if (nm === 'eval') return 'eval(…)' + via;
  if (nm === 'Function') return (x.type === 'NewExpression' ? 'new Function' : 'Function(…)') + via;
  const cl = x.callee;
  if (cl.type === 'MemberExpression' && !cl.computed && cl.object.type === 'Identifier' && cl.object.name === 'Function'
    && /^(call|apply|bind)$/.test(cl.property.name)) return 'Function.' + cl.property.name + '(…)';
  if ((nm === 'setTimeout' || nm === 'setInterval') && stringish(x.arguments[0])) return nm + '(«строка», …)';
  return '';
}
// Имена верхнего уровня: function в теле скрипта и любой var вне функций (terser переносит var в `for (var …)`)
function topNames(ast) {
  const s = new Set();
  for (const st of ast.body) if (st.type === 'FunctionDeclaration') s.add(st.id.name);
  walkTop(ast, (x) => {
    if (x.type === 'VariableDeclaration' && x.kind === 'var') x.declarations.forEach((d) => { if (d.id.type === 'Identifier') s.add(d.id.name); });
  });
  return s;
}

// → { ok, fails: [], warns: [], info: [] }
function verify(code, src) {
  const acorn = need('acorn');
  const fails = [], warns = [], info = [];
  let ast = null;
  try {
    ast = acorn.parse(code, { ecmaVersion: 5, sourceType: 'script' });
    info.push('ES5: разбор acorn (ecmaVersion 5) — ок');
  } catch (e) {
    if (/stack/i.test(e.message)) {                               // не синтаксис, а глубина: цепочка `a + b + …` из тысяч частей
      fails.push('не разобрать: ' + e.message + ' — выражение слишком глубокое (тысячи `+` подряд?): разбейте его на части');
    } else {
      fails.push('не ES5: ' + e.message + ' — около «' + code.slice(Math.max(0, (e.pos || 0) - 40), (e.pos || 0) + 40).replace(/\s+/g, ' ') + '»');
      try { ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' }); } catch (e2) { fails.push('не разбирается вовсе: ' + e2.message); }
    }
  }
  if (ast) {
    const optTop = ast.body.some(assignsOption);
    const varOpt = !optTop && ast.body.some((st) => st.type === 'VariableDeclaration'
      && st.declarations.some((d) => d.id.type === 'Identifier' && d.id.name === 'option'));
    if (!optTop) {
      fails.push('нет глобального option: присваивания `option = …` вне функций (контракт песочницы)'
        + (varOpt ? '; есть `var option` — по договору скилла нужно присваивание без var, последним оператором' : ''));
    } else info.push('option: присваивается на верхнем уровне');
    const last = ast.body[ast.body.length - 1];
    let srcAst = null;
    if (src) { try { srcAst = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' }); } catch (e) { warns.push('исходник не разобран: ' + e.message); } }
    const srcLast = srcAst && srcAst.body[srcAst.body.length - 1];
    if (srcLast && assignsOption(srcLast) && !(last && assignsOption(last))) fails.push('option в исходнике — последний оператор, в сборке — нет');
    if (srcAst) {
      const a = topNames(srcAst), b = topNames(ast), lost = [];
      a.forEach((nm) => { if (!b.has(nm)) lost.push(nm); });
      if (lost.length) fails.push('пропали имена верхнего уровня: ' + lost.slice(0, 12).join(', ') + (lost.length > 12 ? '…' : ''));
      else info.push('имена верхнего уровня: ' + a.size + ' из ' + a.size + ' на месте');
    }
    const bad = [];
    walkAll(ast, (x) => { const b = codeFromString(x); if (b) bad.push(b); });
    if (bad.length) fails.push('в коде ' + Array.from(new Set(bad)).join(', ') + ': код из строки в песочнице не проверен (CJ-22, DV-07)');
    else info.push('кода из строки нет (eval, Function, строка в setTimeout)');
  }
  try {
    const v = require(path.join(path.dirname(require.resolve('terser')), '..', 'package.json')).version;
    if (v !== TERSER_PIN) warns.push('terser ' + v + ' ≠ ' + TERSER_PIN + ': сборка разойдётся с прежней (npm i -g terser@' + TERSER_PIN + ')');
  } catch (e) { /* без terser — только --verify */ }
  return { ok: !fails.length, fails, warns, info };
}

// размеры: КиБ (1 024 Б), запятая — десятичный знак; байты — с разрядами
function kib(n) { return (n / 1024).toFixed(1).replace('.', ',') + ' КиБ'; }
function bytes(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' Б'; }
function size(n) { return bytes(n) + ' (' + kib(n) + ')'; }
function secs(n, kbps) { return (n / 1024 / kbps).toFixed(1).replace('.', ','); }

// исходник → сборка (Promise)
async function minifyChart(src, head, opts) {
  opts = opts || {};
  const { minify } = need('terser');
  const pre = shrinkCssVars(src, opts.cssVars || []);
  const r = await minify(pre.src, terserOptions(head));
  return { code: r.code + '\n', notes: pre.notes };
}

function report(label, code, src, opts) {
  const kbps = opts.kbps || 50, b = Buffer.byteLength(code);
  if (src == null) return [label + ': ' + size(b) + ', ≈' + secs(b, kbps) + ' с отправки на запрос при ' + kbps + ' КБ/с'];
  const a = Buffer.byteLength(src);
  const d = a ? Math.round((1 - b / a) * 100) : 0;
  return [label + ': ' + bytes(a) + ' → ' + bytes(b) + ' (' + kib(a).replace(' КиБ', '') + ' → ' + kib(b)
    + (a ? ', ' + (d >= 0 ? '−' + d : '+' + -d) + ' %' : ', исходник пуст') + '), ≈' + secs(b, kbps)
    + ' с отправки на запрос при ' + kbps + ' КБ/с (было ≈' + secs(a, kbps) + ' с)'];
}

function parseArgs(argv) {
  const o = { head: null, check: false, verify: null, cssVars: [], budget: 0, kbps: 50 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => { if (i + 1 >= argv.length) throw new Error('нет значения у ' + a); return argv[++i]; };
    if (a === '--check') o.check = true;
    else if (a === '--verify') o.verify = val();
    else if (a === '--css-var') o.cssVars.push(val());
    else if (a === '--budget') o.budget = +val();
    else if (a === '--kbps') o.kbps = +val();
    else if (a.startsWith('--')) throw new Error('неизвестный флаг ' + a);
    else if (o.head === null) o.head = a;
    else throw new Error('лишний аргумент: ' + a);
  }
  if (!(o.kbps > 0) || !(o.budget >= 0)) throw new Error('--kbps и --budget — числа');
  return o;
}

// код 2 — неверный вызов или не запустилось (нет файла, нет terser / acorn): ничего не проверено
function usage(msg) {
  process.stderr.write(msg + '\nnode kit/min.cjs \'шапка\' [--check] [--css-var ИМЯ] [--budget КиБ] [--kbps N] < in.js > out.js\n'
    + 'node kit/min.cjs --verify сборка.js [--budget КиБ]\n');
  process.exit(2);
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { usage(e.message); }
  if (o.verify) {                                                 // только проверка готового файла
    let code = '';
    try { code = fs.readFileSync(o.verify, 'utf8'); } catch (e) { usage('--verify: не прочитать «' + o.verify + '»: ' + (e.code || e.message)); }
    let v;
    try { v = verify(code, null); } catch (e) { if (e.kitEnv) usage(e.message); throw e; }
    const out = report(path.basename(o.verify), code, null, o).concat(v.info.map((t) => '  ок   ' + t), v.warns.map((t) => '  !    ' + t), v.fails.map((t) => '  FAIL ' + t));
    if (o.budget && Buffer.byteLength(code) > o.budget * 1024) { out.push('  FAIL больше бюджета ' + o.budget + ' КиБ'); v.ok = false; }
    process.stdout.write(out.join('\n') + '\n' + (v.ok ? 'сборка годится\n' : 'сборка НЕ годится\n'));
    process.exit(v.ok ? 0 : 1);
  }
  if (process.stdin.isTTY) usage('исходник — на stdin: node kit/min.cjs \'шапка\' < чарт.js > сборка.js');
  let src = '';
  process.stdin.setEncoding('utf8');
  for await (const d of process.stdin) src += d;
  let res;
  try { res = await minifyChart(src, o.head, o); } catch (e) {
    if (e.kitEnv) usage(e.message);
    process.stderr.write('сжатие не удалось: ' + (e.message || e)
      + (/call stack/i.test(String(e.message)) ? ' — выражение слишком глубокое (тысячи `+` подряд?): разбейте его на части' : '') + '\n');
    process.exit(1);
  }
  if (o.check || o.budget || o.cssVars.length) {
    const lines = report('сборка', res.code, src, o).concat(res.notes.map((t) => '  ' + t));
    let ok = true;
    if (o.check) {
      const v = verify(res.code, src);
      lines.push(...v.info.map((t) => '  ок   ' + t), ...v.warns.map((t) => '  !    ' + t), ...v.fails.map((t) => '  FAIL ' + t));
      ok = v.ok;
    }
    if (o.budget && Buffer.byteLength(res.code) > o.budget * 1024) { lines.push('  FAIL больше бюджета ' + o.budget + ' КиБ'); ok = false; }
    process.stderr.write(lines.join('\n') + '\n');
    if (!ok) process.exit(1);
  }
  process.stdout.write(res.code);
}

module.exports = { minifyChart, verify, cssMin, terserOptions, TERSER_PIN };
if (require.main === module) main();
