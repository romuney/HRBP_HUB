// HRBP HUB · файл 6 — сниппет разметки борда (из гайда proteus-playbook, kit/board-check.js; id чарта 800919).
// Нужен, если отчёт не доходит до низа окна или уходит за него: печатает высоту ряда и число для блока 7 файла 4.
// РАЗМЕТКА БОРДА (DevTools): поля, вкладки и ряды над ними, расстояние между вкладками и до значка ссылки, высота ряда
// с нашими чартами и число для правила «высота по экрану», CSS борда на странице и правила с нашими id, есть ли iframe в
// каждой ячейке, цепочка ячейки вверх.
// 1. Открыть борд на вкладке с нашими чартами, НЕ в режиме правки, окно — как обычно работаете.
// 2. F12 → Console. Слева вверху консоли должно стоять «top» (не iframe чарта). Вставить всё, Enter.
//    Chrome при первой вставке просит набрать allow pasting — наберите, Enter, и вставьте снова.
// 3. Прислать вывод целиком (текстом или скрином).
// Только читает размеры и стили элементов страницы: ничего не меняет и никуда не отправляет.
//
// Шаблон playbook: kit/board-check.js (BC-22 в 10-board-css.md, DV-30 в 14-delivery.md). Агенту: заполнить ПАРАМЕТРЫ.
// id чартов — числовые заглушки (DV-05), каждая ровно один раз в строке CHART_IDS: боевые id подставляет сборщик поставки
// (kit/pack_template.py, вид snippet). Стенд гоняет тот же текст: kit/sbx/run.cjs --board-check или каркас проекта (ST-23).
(function () {
  // ── ПАРАМЕТРЫ ─────────────────────────────────────────────────────────────────────────────────────────────────
  var CHART_IDS = ['800919'];           // id наших чартов (все вкладки); меряются видимые на текущей вкладке
  var EXPECT = {                        // поля, которых добиваемся, px; null — не проверять. По умолчанию — числа владельца DL
                                        // (08.10, BC-12): = блоки 5–6 templates/board.template.css
    side: 24,                           // от края окна до крайних чартов ряда, слева и справа
    between: 16,                        // между чартами ряда (зазор сетки Proteus — его не трогаем)
    tabsToRow: 16,                      // от линии вкладок до ряда чартов
    headerToTabs: 12,                   // от шапки борда до своих вкладок; у вкладок верхнего уровня цель 0 (полоса — часть шапки)
    headerToRow: 12,                    // от шапки борда до первого блока сетки, если над рядом нет своих вкладок (верх сетки)
    rowGap: 16,                         // от ряда сетки над вкладками («Ссылки на отчёты») до вкладок — шов рядов
    bottom: 24,                         // от низа ряда до низа окна: отсюда число правила «высота по экрану» (BC-18)
    tabGap: 40,                         // между вкладками (BC-24)
    iconGap: 6                          // от названия вкладки до значка ссылки (BC-24)
  };
  var VH_TOL = 2;                       // число «высоты по экрану» верно, если расходится с расчётом не больше чем на столько px
  var CSS_NAME = 'файл 4 (CSS борда)';           // как файл CSS называется в поставке («файл 9» и т. п.) — для подсказок
  var VH_MARK = /resizable-container/;  // признак правила «высота по экрану» в CSS борда (вместе с 100vh)
  var CHAIN = 24;                       // сколько уровней цепочки ячейки вверх печатать
  // ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

  if (window.top !== window) {          // консоль DevTools смотрит в iframe чарта — там борда нет
    console.log('Консоль смотрит в iframe чарта, а не в страницу борда: слева вверху консоли выберите «top» и запустите ещё раз.');
    return;
  }
  var out = [], miss = [], ids = CHART_IDS;
  function n(v) { return Math.round(v); }
  function name(e) {
    var c = (typeof e.className === 'string' ? e.className : (e.getAttribute('class') || '')).trim();
    return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (c ? '.' + c.split(/\s+/).join('.') : '');
  }
  function box(e) {                     // координаты от начала страницы (с учётом прокрутки)
    var r = e.getBoundingClientRect();
    return { l: r.left, t: r.top + window.scrollY, r: r.right, b: r.bottom + window.scrollY, w: r.width, h: r.height };
  }
  // «замер   (цель — N)»; расхождение больше 1 px — в итог
  function want(what, got, exp, note) {
    if (exp === null || exp === undefined) return what + ' ' + n(got);
    if (Math.abs(got - exp) > 1) miss.push(what + ' ' + n(got) + ' вместо ' + exp);
    return what + ' ' + n(got) + '   (цель — ' + exp + (note ? note : '') + ')';
  }
  function idOf(e) { return (/dashboard-chart-id-(\d+)/.exec(e.getAttribute('class') || '') || [])[1] || ''; }
  function sheetsRules() {              // все правила CSS страницы (чужие таблицы без доступа — пропускаем)
    var all = [];
    function walk(rules) {
      for (var j = 0; rules && j < rules.length; j++) {
        if (rules[j].cssRules && !rules[j].selectorText) walk(rules[j].cssRules);   // @media / @supports
        else all.push(rules[j]);
      }
    }
    for (var i = 0; i < document.styleSheets.length; i++) {
      var r = null;
      try { r = document.styleSheets[i].cssRules; } catch (er) { continue; }
      walk(r);
    }
    return all;
  }
  // число правил верхнего уровня в тексте CSS: блоки { } и @import / @namespace без блока. Комментарии и строки — одним
  // проходом (кто раньше начался): «/*» в строке content не комментарий, «}» в комментарии не конец блока
  function topBlocks(css) {
    var s = css.replace(/\/\*[\s\S]*?(?:\*\/|$)|"(?:[^"\\]|\\[\s\S])*"?|'(?:[^'\\]|\\[\s\S])*'?/g, function (m) {
      return m.charAt(0) === '/' ? ' ' : '""';
    }), d = 0, k = 0;
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '{') { if (!d) k++; d++; } else if (s[i] === '}' && d) d--;
      else if (!d && s[i] === '@' && /^@(import|namespace)\b/i.test(s.slice(i, i + 11))) k++;
    }
    return k;
  }
  // id чарта в тексте — целиком: «chart-id-80256» не должен находиться в «chart-id-802568», а id — в цвете «#802568»
  var ID_RE = {};
  for (var r0 = 0; r0 < ids.length; r0++) ID_RE[ids[r0]] = new RegExp('chart-id-' + ids[r0] + '(?!\\d)');
  var PSEUDO = /::?(before|after|placeholder|selection|marker|backdrop|-webkit-[\w-]+)\b/g;   // querySelector их не ищет
  var RULES = sheetsRules(), EDIT = !!document.querySelector('.dashboard--editing');
  out.push('окно ' + window.innerWidth + '×' + window.innerHeight + ', страница прокручена на ' + n(window.scrollY)
    + (EDIT ? ' · РЕЖИМ ПРАВКИ: в нём раскладка другая — выйдите из него и запустите ещё раз' : ''));

  // ── 1. CSS борда: Superset 2.0–4.0 кладёт его в <style class="CssEditor-css"> в конце <head> (injectCustomCss) ──────
  var ed = document.querySelector('style.CssEditor-css');
  if (ed && !(ed.textContent || '').trim()) {   // 2.0.1 ставит элемент и для пустого CSS борда
    out.push('CSS борда: <style class="CssEditor-css"> пуст — CSS борда не вставлен или не сохранён');
    miss.push('CSS борда пуст');
  } else if (!ed) {
    out.push('CSS борда: <style class="CssEditor-css"> на странице нет — CSS у борда не сохраняли или форк вставляет его иначе'
      + ' (2.0.1 ставит элемент для любого сохранённого CSS, даже пустого); правила с нашими id ищу во всех таблицах стилей');
  } else {
    var txt = ed.textContent || '', acc = -1, blocks = topBlocks(txt), have = [], stub = [];
    try { acc = ed.sheet.cssRules.length; } catch (er) { acc = -1; }
    for (var h = 0; h < ids.length; h++) if (ID_RE[ids[h]].test(txt)) have.push(ids[h]);
    var ph = txt.match(/chart-id-(\d)\1{5}(?!\d)/g) || [];  // заглушки: шесть одинаковых цифр, которых нет среди CHART_IDS
    for (var p = 0; p < ph.length; p++) { var pid = ph[p].slice(9); if (ids.indexOf(pid) < 0 && stub.indexOf(pid) < 0) stub.push(pid); }
    out.push('CSS борда: <style class="CssEditor-css"> ' + txt.length + ' знаков, блоков в тексте ' + blocks + ', браузер принял '
      + (acc < 0 ? '?' : acc) + ' · наших id в тексте: ' + have.length + ' из ' + ids.length + (have.length < ids.length ? ' (нет: '
      + ids.filter(function (x) { return have.indexOf(x) < 0; }).join(', ') + ')' : ''));
    if (acc >= 0 && acc < blocks) {
      out.push('  ! браузер отбросил ' + (blocks - acc) + ' блок(ов) из ' + blocks + ': ошибка в тексте (скобка, запятая) или селектор,'
        + ' которого браузер не знает — сверьте с файлом «' + CSS_NAME + '»');
      miss.push('CSS: отброшено блоков ' + (blocks - acc));
    }
    if (!have.length) { out.push('  ! ни одного нашего id в CSS борда: вставлен прежний или чужой файл, либо id чартов другие'); miss.push('CSS без наших id'); }
    if (stub.length) { out.push('  ! в CSS борда остались заглушки id: ' + stub.join(', ') + ' — замените их на id чартов (Ctrl+H), сохраните'); miss.push('заглушки id в CSS'); }
  }

  // ── 2. наши ячейки: какие есть, видны ли, есть ли в них iframe и растянут ли он ─────────────────────────────────
  var cells = [];
  for (var i = 0; i < ids.length; i++) {
    var all = document.querySelectorAll('.dashboard-chart-id-' + ids[i]);
    if (!all.length) { out.push('чарт ' + ids[i] + ': ячейки .dashboard-chart-id-' + ids[i] + ' на странице нет (другая вкладка, её ещё не открывали, или id другой)'); continue; }
    for (var k = 0; k < all.length; k++) {
      var c = all[k], B = box(c), fr = c.querySelector('iframe'), img = c.querySelector('img.echarts-plugin');
      if (B.w <= 0) { out.push('чарт ' + ids[i] + ': ячейка есть, но скрыта (другая вкладка)'); continue; }
      var line = 'чарт ' + ids[i] + ': ячейка ' + n(B.l) + ',' + n(B.t) + ' ' + n(B.w) + '×' + n(B.h) + ' (' + name(c).slice(0, 70) + ')';
      if (fr) {
        var F = box(fr), fs = getComputedStyle(fr);
        line += ' · iframe ' + n(F.w) + '×' + n(F.h) + ' (атрибуты ' + fr.getAttribute('width') + '×' + fr.getAttribute('height')
          + ', display ' + fs.display + ', sandbox «' + fr.getAttribute('sandbox') + '»)'
          + ' · поля ячейки вокруг iframe: слева ' + n(F.l - B.l) + ', сверху ' + n(F.t - B.t) + ', справа ' + n(B.r - F.r) + ', снизу ' + n(B.b - F.b);
      } else {
        line += ' · iframe НЕТ (чарт не загрузился, заглушка Proteus или ошибка)';
        miss.push('чарт ' + ids[i] + ' без iframe');
      }
      if (img && img.getAttribute('src')) line += ' · канал скриншотов: ' + img.getAttribute('src').length + ' знаков';
      out.push(line);
      cells.push({ id: ids[i], el: c, b: B });
    }
  }
  if (!cells.length) {
    out.push('Видимых ячеек наших чартов нет: откройте вкладку с чартами (не в режиме правки) и запустите ещё раз.');
    console.log(out.join('\n'));
    return;
  }
  cells.sort(function (a, b) { return a.b.t - b.b.t || a.b.l - b.b.l; });
  var ref = cells[0], row = cells.filter(function (x) { return Math.abs(x.b.t - ref.b.t) < 4; });
  row.sort(function (a, b) { return a.b.l - b.b.l; });

  // ── 3. поля: слева, справа, между чартами ряда ─────────────────────────────────────────────────────────────
  var cw = document.documentElement.clientWidth, L = row[0].b, R = row[row.length - 1].b, mid = [];
  out.push(want('поле слева', L.l, EXPECT.side) + ' · ' + want('справа', cw - R.r, EXPECT.side));
  for (var m = 1; m < row.length; m++) mid.push(want('между ' + row[m - 1].id + ' и ' + row[m].id, row[m].b.l - row[m - 1].b.r, EXPECT.between));
  if (mid.length) out.push(mid.join(' · '));
  if (document.documentElement.scrollWidth > cw) { out.push('  ! ЕСТЬ ГОРИЗОНТАЛЬНАЯ ПРОКРУТКА страницы'); miss.push('горизонтальная прокрутка'); }

  // ── 4. вкладки: свои (над рядом) или верхнего уровня (полоса в шапке борда), ряды над ними ─────────────────────
  // Свои — ячейка внутри них. Верхнего уровня — полоса в шапке борда, ВНЕ .grid-container (DashboardBuilder 2.0.1).
  // Вложенные вкладки где-то ещё в сетке — не наши: ряд над ними или под ними к ним не относится.
  var tabs = ref.el.closest('.dashboard-component-tabs'), topLevel = false;
  if (!tabs) {
    var allTabs = document.querySelectorAll('.dashboard-component-tabs');
    for (var x = 0; x < allTabs.length && !tabs; x++) if (!allTabs[x].closest('.grid-container')) { tabs = allTabs[x]; topLevel = true; }
  }
  var nav = tabs && tabs.querySelector('.ant-tabs-nav');
  var hdr = document.querySelector('.dashboard-header-container') || document.querySelector('.header-with-actions');
  if (!nav) {
    // блоки сетки над рядом (ряды, вкладки): тогда поле борда — от шапки до первого из них, а не до нашего ряда
    var blk = ref.el, before = [];
    while (blk && blk.parentElement && !blk.parentElement.classList.contains('grid-content')) blk = blk.parentElement;
    for (var pb = blk && blk.parentElement ? blk.previousElementSibling : null; pb; pb = pb.previousElementSibling) {
      if (pb.getBoundingClientRect().height > 0) before.unshift(pb);
    }
    out.push(document.querySelector('.dashboard-component-tabs') ? 'ряд не во вкладках (вкладки на борде есть, но наши чарты не в них)'
      : 'вкладок нет (.dashboard-component-tabs не нашёл)');
    if (hdr && !before.length) out.push(want('от шапки борда до ряда', ref.b.t - box(hdr).b, EXPECT.headerToRow));
    else if (hdr) {
      out.push('над рядом блоков сетки: ' + before.length + ' · ' + want('от шапки до первого', box(before[0]).t - box(hdr).b, EXPECT.headerToRow)
        + ' · от блока над рядом до ряда ' + n(ref.b.t - box(before[before.length - 1]).b) + ' px');
    }
  } else {
    var N = box(nav);
    if (topLevel) out.push('вкладки — верхнего уровня: Superset рисует их полосу в липкой шапке борда, ряды — в сетке под ней');
    out.push(want('от линии вкладок до чартов', ref.b.t - N.b, EXPECT.tabsToRow) + ' · полоса вкладок ' + n(N.h) + ' px');
    var above = [];                     // ряды сетки над своими вкладками («Ссылки на отчёты» и т. п.), сверху вниз
    if (!topLevel) {
      for (var s = (tabs.closest('.dragdroppable') || tabs).previousElementSibling; s; s = s.previousElementSibling) {
        if (s.getBoundingClientRect().height > 0) above.unshift(s);
      }
    }
    if (hdr) {
      var H = box(hdr).b;
      if (topLevel) {                   // у вкладок верхнего уровня полоса — часть шапки: зазор должен быть 0, а не поле борда
        out.push(want('от шапки борда до вкладок', N.t - H, 0, ': полоса вкладок — часть шапки'));
      } else if (!above.length) {
        out.push(want('от шапки борда до вкладок', N.t - H, EXPECT.headerToTabs));
      } else {                          // поле — от шапки до первого ряда, шов рядов — от последнего ряда до вкладок
        out.push('от шапки борда до вкладок ' + n(N.t - H) + ' px, над вкладками рядов: ' + above.length + ' · '
          + want('от шапки до первого', box(above[0]).t - H, EXPECT.headerToRow) + ' · '
          + want('от последнего до вкладок', N.t - box(above[above.length - 1]).b, EXPECT.rowGap));
      }
    }
    for (var j = 0; j < above.length; j++) {
      var ch = above[j].querySelectorAll('[class*="dashboard-chart-id-"]'), sid = [];
      for (var q = 0; q < ch.length; q++) sid.push(idOf(ch[q]));
      out.push('  над вкладками: ' + name(above[j]).slice(0, 80) + ' — ' + n(above[j].getBoundingClientRect().height) + ' px'
        + (sid.length ? ', чарты ' + sid.join(', ') : ''));
    }
    var act = nav.querySelector('.ant-tabs-tab-active');
    if (act) {
      var t = act.querySelector('[data-test="editable-title-input"]') || act.querySelector('.editable-title') || act;
      var cs = getComputedStyle(t), af = getComputedStyle(act, '::after'), ic = act.querySelector('.fa, .anticon, [class*="anchor"] i');
      out.push('активная вкладка: ' + cs.fontFamily.split(',')[0] + ' ' + cs.fontSize + ' ' + cs.fontWeight + ', цвет ' + cs.color
        + ', фон ' + getComputedStyle(act).backgroundColor + ', черта ::after ' + af.backgroundColor + ' ' + af.height
        + (ic ? ', значок ссылки — шрифт ' + getComputedStyle(ic).fontFamily.split(',')[0] : ''));
      // расстояния (BC-24): до соседней вкладки и от названия до значка ссылки — значок виден при наведении, место у него
      // есть всегда; самый внешний элемент значка — первый [class*="anchor"] во вкладке
      var nx = act.nextElementSibling, an = act.querySelector('[class*="anchor"]'), tr = t.getBoundingClientRect();
      if (nx && !/ant-tabs-tab/.test(nx.getAttribute('class') || '')) nx = null;   // за активной — не вкладка (ink-bar и т. п.)
      if (nx) out.push(want('между вкладками', nx.getBoundingClientRect().left - act.getBoundingClientRect().right, EXPECT.tabGap));
      if (an && !an.getBoundingClientRect().width) {
        out.push('значок ссылки: до наведения Proteus прячет его целиком — расстояние до названия не измерить');
      } else if (an) {
        var ar = an.getBoundingClientRect(), over = !!nx && ar.right > nx.getBoundingClientRect().left;
        out.push(want('значок ссылки за названием', ar.left - tr.right, EXPECT.iconGap) + ', ширина ' + n(ar.width)
          + (over ? ' — НАЕЗЖАЕТ на соседнюю вкладку' : ''));
        if (over) miss.push('значок ссылки наезжает на соседнюю вкладку');
      }
    }
    // украшения владельца на псевдоэлементах (плашка NEW и т. п.) общий сброс `*` не задевает — показать, какие они (BC-19)
    var titles = nav.querySelectorAll('.ant-tabs-tab [data-test="editable-title-input"], .ant-tabs-tab .editable-title');
    for (var z = 0; z < titles.length; z++) {
      ['::before', '::after'].forEach(function (pe) {
        var pp = getComputedStyle(titles[z], pe);
        if (pp.content && pp.content !== 'none' && pp.content !== 'normal' && pp.content !== '""') {
          out.push('  у вкладки «' + titles[z].textContent.trim().slice(0, 30) + '» ' + pe + ': ' + pp.content + ', фон ' + pp.backgroundColor
            + ', кегль ' + pp.fontSize + ', цвет ' + pp.color);
        }
      });
    }
  }

  // ── 5. ряд: верх, высота, зазор до низа окна; число для правила «высота по экрану» ────────────────────────────
  var vhRule = null, vhTop = 0, vhSel = '';
  for (var v = 0; v < RULES.length; v++) {
    var rtx = RULES[v].cssText || '', mm = /100vh\s*-\s*(\d+)px|-(\d+)px\s*\+\s*100vh/.exec(rtx);   // браузер пишет и так, и так
    if (mm && VH_MARK.test(rtx)) { vhRule = rtx; vhTop = +(mm[1] || mm[2]); vhSel = RULES[v].selectorText || ''; break; }
  }
  // ряд, которому правило задаёт высоту: верхняя наша ячейка, чей .resizable-container оно задевает (иначе — опорная):
  // ряд над вкладками или над нашим рядом с его высотой не связан
  var vref = ref, vhHits = false;
  for (var y = 0; vhSel && y < cells.length && !vhHits; y++) {
    var rcy = cells[y].el.closest('.resizable-container');
    try { vhHits = !!rcy && rcy.matches(vhSel.replace(PSEUDO, '')); } catch (er) { vhHits = false; }
    if (vhHits) vref = cells[y];
  }
  var rc = vref.el.closest('.resizable-container'), need = n(vref.b.t) + (EXPECT.bottom || 0);
  // нижний предел высоты из правила (max(560px, …)): ряд на нём — окно для ряда низкое, зазор снизу меньше цели, так задумано
  var vhMin = +((/max\(\s*(\d+)px/.exec(vhRule || '') || [])[1] || 0), atMin = vhMin > 0 && vref.b.h <= vhMin + 1;
  out.push('ряд чартов' + (vref !== ref ? ' (' + vref.id + ', его высоту задаёт правило)' : '') + ': верх ' + n(vref.b.t)
    + ' px от начала страницы, высота ' + n(vref.b.h) + (rc && rc.style.height ? ' (в раскладке ' + rc.style.height + ')' : '')
    + ', от низа ряда до низа окна ' + n(window.innerHeight - (vref.b.b - window.scrollY))
    + (EXPECT.bottom === null || EXPECT.bottom === undefined || EDIT ? '' : '   (цель — ' + EXPECT.bottom
      + (atMin ? '; ряд на нижнем пределе ' + vhMin + ' px — окно для него низкое, так задумано' : '') + ')'));
  if (vhRule && !vhHits && !EDIT) {
    out.push('  ! правило «высота по экрану» не задевает ни одну нашу ячейку (селектор: ' + vhSel.replace(/\s+/g, ' ').slice(0, 120)
      + ') — у форка другие классы или в правиле другие id; число ниже — по опорной ячейке');
    miss.push('правило высоты не задевает наши ячейки');
  }
  if (!vhRule) out.push('правило «высота по экрану» (100vh в ' + VH_MARK + ') в CSS страницы не нашёл — в ' + CSS_NAME + ' его нет или вставлен прежний файл');
  else if (EDIT) out.push('высота по экрану: в CSS «100vh - ' + vhTop + 'px»; в режиме правки число не считаю');
  else if (Math.abs(vhTop - need) <= VH_TOL) {   // верх ряда дробный, округление — ±1–2 px (DL файл 12 — так же, с 28-й поставки)
    out.push('высота по экрану: «100vh - ' + vhTop + 'px» — верно' + (vhTop !== need ? ' (расчёт ' + need + ', допуск ±' + VH_TOL + ' px)' : '')
      + ', ничего менять не нужно');
  }
  else {
    out.push('высота по экрану: в ' + CSS_NAME + ' «100vh - ' + vhTop + 'px» — замените на «100vh - ' + need + 'px» (Ctrl+H), сохраните, обновите страницу');
    miss.push('высота по экрану: ' + vhTop + ' → ' + need);
  }

  // ── 6. правила CSS с нашими id: что из них сейчас что-то задевают (иначе — у форка другие классы или CSS «scoped») ──
  var mine = [], hit = 0;
  for (var w = 0; w < RULES.length; w++) {
    var sel = RULES[w].selectorText;
    if (!sel) continue;
    for (var u = 0; u < ids.length; u++) {
      if (!ID_RE[ids[u]].test(sel)) continue;
      var ok = '?';
      try { ok = document.querySelector(sel.replace(PSEUDO, '')) ? 'да' : 'нет'; } catch (er) { ok = '?'; }
      if (ok === 'да') hit++;
      mine.push('  [' + ok + '] ' + sel.replace(/\s+/g, ' ').slice(0, 150));
      break;
    }
  }
  out.push(!mine.length ? 'правил CSS с нашими id на странице нет — CSS борда не вставлен (не сохранён) или в нём другие id'
    : 'правил CSS с нашими id: ' + mine.length + ', из них сейчас что-то задевают: ' + hit
      + (hit ? ' ([нет] — правило для другого состояния: маркер канала, загрузка, другая вкладка)'
        : ' — НИ ОДНО: у форка другие классы или селекторы изменены (см. текст правил ниже и цепочку ячейки)'));
  if (!mine.length) miss.push('правил с нашими id нет');
  else if (!hit) miss.push('правила с нашими id ничего не задевают');
  mine.sort(function (a, b) { return (a.indexOf('[да]') < 0) - (b.indexOf('[да]') < 0); });
  out.push.apply(out, mine.slice(0, 30));
  if (mine.length > 30) out.push('  … ещё ' + (mine.length - 30));

  // ── 7. цепочка опорной ячейки вверх: поля, отступы, фон — по ней правится CSS, если у форка другие классы (BC-23) ──
  out.push('— цепочка ячейки ' + ref.id + ' вверх (поля, отступы, фон):');
  for (var e = ref.el, d = 0; e && e !== document.documentElement && d < CHAIN; e = e.parentElement, d++) {
    var st = getComputedStyle(e), Rb = e.getBoundingClientRect();
    var mg = [st.marginTop, st.marginRight, st.marginBottom, st.marginLeft].join(' '), pd = [st.paddingTop, st.paddingRight, st.paddingBottom, st.paddingLeft].join(' ');
    out.push('  ' + d + ' ' + name(e).slice(0, 110) + ' · ' + n(Rb.left) + ',' + n(Rb.top + window.scrollY) + ' ' + n(Rb.width) + '×' + n(Rb.height)
      + (mg !== '0px 0px 0px 0px' ? ' · поля ' + mg : '') + (pd !== '0px 0px 0px 0px' ? ' · отступы ' + pd : '')
      + (st.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ' · фон ' + st.backgroundColor : '')
      + (st.overflow !== 'visible' ? ' · overflow ' + st.overflow : '') + (st.position === 'sticky' || st.position === 'fixed' ? ' · ' + st.position : ''));
  }

  // ── итог: одной строкой, чтобы по скрину было видно сразу ───────────────────────────────────────────────────
  out.push(EDIT ? 'ИТОГ: режим правки — числа не сверяю, выйдите из него и запустите ещё раз'
    : miss.length ? 'ИТОГ: расхождений ' + miss.length + ' — ' + miss.join('; ') : 'ИТОГ: поля, вкладки, высота и CSS сходятся с целью');
  console.log(out.join('\n'));
})();
