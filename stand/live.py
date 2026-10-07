"""Живой стенд чарта HRBP HUB: страница с виджетом поверх датасета в chdb.

    python3 stand/live.py [порт]        # http://127.0.0.1:8765/?user=a.sergeeva

Страница повторяет контракт Proteus: хост [_echarts_instance_], массив data,
applyCrossFilter(mask). Маска превращается в фильтры датасета (как filter_values),
запрос уходит в chdb (ch.dataset), скрипт чарта перезапускается с новыми
строками — так Proteus ведёт себя после кросс-фильтра с включённым самовлиянием.
?user= — логин (current_username), ?w= — ширина ячейки дашборда в px.
?selfoff=1 — самовлияние выключено: эмит уходит, ответа нет (проверка
предупреждения «фильтр не применился»).
?long=1 — длинные имена юнитов, как в бою (у каждого второго юнита имя на
3–4 строки): проверка имён «одной строкой с …» в «Командах» и шапке «Динамики».
?limit=N — лимит строк чарта, как его применяет Proteus: SELECT … FROM (датасет) LIMIT N
(хвост ответа молча отрезается — проверка плашки «ответ обрезан» и того, что фильтры целы).

/board — тот же чарт так, как его кладёт Proteus: <iframe sandbox="allow-scripts"> высотой с ячейку
борда внутри холдера с полем 16 px и шапкой чарта, страница борда прокручивается снаружи, шапка
дашборда липкая; данные и кросс-фильтр — через postMessage (до родителя иначе не достучаться).
?ch= — высота ячейки (1300), ?css=1 — вставка «4. CSS борда» из поставки, ?delay= — ответ
датасета дольше на столько мс (бой отвечает дольше стенда). Остальные параметры — как у /.
"""
import http.server
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CHART = os.path.join(HERE, '..', 'proteus', 'hrbp-hub.chart.js')
COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire']
COLS = ', '.join(['role', 'id', 'pid', 'n', 'j'] + ['m_' + c for c in COMP] + ['w_' + c for c in COMP])

PAGE = r'''<!doctype html><html><head><meta charset="utf-8"><title>HRBP HUB · стенд</title>
<style>html,body{margin:0;height:100%;background:#e9ebef;font:13px Arial}
#cell{position:absolute;left:0;top:0;bottom:0;background:#fff}</style></head>
<body><div id="cell"><div _echarts_instance_="ec_1" style="width:100%;height:100%;position:relative"><canvas></canvas></div></div>
<script>
var Q = new URLSearchParams(location.search);
var USER = Q.get('user') || 'a.sergeeva', SELFOFF = Q.get('selfoff') === '1', LONG = Q.get('long') === '1', LIMIT = Q.get('limit') || '';
document.getElementById('cell').style.width = (Q.get('w') ? Q.get('w') + 'px' : '100%');
var SRC = null, FILTERS = JSON.parse(Q.get('flt') || '{}');
window.__masks = []; window.__runs = 0;
function run(rows) {
  window.data = rows; window.__runs++;
  (new Function('data', 'applyCrossFilter', SRC + '\n;return typeof option !== "undefined" ? option : null;'))(rows, applyCrossFilter);
}
function load() {
  return fetch('/data?user=' + encodeURIComponent(USER) + '&flt=' + encodeURIComponent(JSON.stringify(FILTERS)) + (LONG ? '&long=1' : '') + (LIMIT ? '&limit=' + LIMIT : ''))
    .then(function (r) { return r.json(); });
}
function applyCrossFilter(mask) {
  window.__masks.push(mask);
  if (SELFOFF) return;
  FILTERS = {};
  (mask || []).forEach(function (f) { FILTERS[f.column] = f.value; });
  setTimeout(function () { load().then(run); }, 300);
}
fetch('/chart.js').then(function (r) { return r.text(); }).then(function (t) { SRC = t; return load(); }).then(run);
</script></body></html>'''


BOARD = r'''<!doctype html><html><head><meta charset="utf-8"><title>HRBP HUB · борд</title>
<style>html,body{margin:0;background:#f6f6f6;font:14px Arial;color:#333}
.pnav{height:48px;background:#fff;border-bottom:1px solid #e8e8e8;display:flex;align-items:center;padding:0 16px;font-weight:600;gap:24px}
.dashboard-header{position:sticky;top:0;z-index:20;height:56px;background:#fff;border-bottom:1px solid #e8e8e8;display:flex;align-items:center;padding:0 24px;font-size:20px;font-weight:600}
.dashboard-grid{padding:16px 24px 480px}
.dashboard-component-chart-holder{background:#fff;padding:16px;border-radius:4px}
.chart-slice{display:block}
.slice-header{display:flex;align-items:center;margin-bottom:4px;font-size:16px;font-weight:600}
.header-controls{margin-left:auto;color:#999}
.react_sanbbox iframe{border:0;width:100%;height:100%}
/*BOARDCSS*/</style></head>
<body><div class="pnav">Proteus <span>Коллекции</span><span>Дашборды</span><span>Графики</span></div>
<div class="dashboard-header">HRBP HUB</div>
<div class="dashboard-grid"><div class="grid-content"><div class="dragdroppable-row"><div class="resizable-container" id="cellbox">
<div class="dashboard-component dashboard-component-chart-holder dashboard-chart-id-800919">
<div class="chart-slice"><div class="slice-header" data-test="slice-header"><div class="header-title">HRBP HUB</div><div class="header-controls">⋯</div></div>
<div class="dashboard-chart"><div class="chart-container"><div class="slice_container"><div class="react_sanbbox" id="sb"><iframe id="fr" sandbox="allow-scripts"></iframe></div></div></div></div></div>
</div></div></div></div></div>
<script>
var Q = new URLSearchParams(location.search);
var USER = Q.get('user') || 'a.sergeeva', SELFOFF = Q.get('selfoff') === '1', LONG = Q.get('long') === '1', LIMIT = Q.get('limit') || '';
var CH = +(Q.get('ch') || 1300), DELAY = +(Q.get('delay') || 0), SRC = null, FILTERS = JSON.parse(Q.get('flt') || '{}');
document.getElementById('cellbox').style.height = CH + 'px';
document.getElementById('fr').style.height = (CH - 32 - 26) + 'px';
window.__masks = []; window.__posts = 0;
var INNER = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%}</style></head><body>'
  + '<div _echarts_instance_="ec_1" style="width:100%;height:100%;position:relative"><canvas></canvas></div><script>'
  + 'var SRC=null;window.__masks=[];window.__runs=0;'
  + 'function applyCrossFilter(m){window.__masks.push(m);parent.postMessage({type:"hh-filter",mask:m},"*");}'
  + 'function run(rows){window.data=rows;window.__runs++;(new Function("data","applyCrossFilter",SRC+"\\n;return typeof option!==\\"undefined\\"?option:null;"))(rows,applyCrossFilter);}'
  + 'window.addEventListener("message",function(e){var d=e.data||{};if(d.type==="hh-data"){if(d.src)SRC=d.src;run(d.rows);}});'
  + 'parent.postMessage({type:"hh-ready"},"*");<\/script></body></html>';
function load() {
  return fetch('/data?user=' + encodeURIComponent(USER) + '&flt=' + encodeURIComponent(JSON.stringify(FILTERS)) + (LONG ? '&long=1' : '') + (LIMIT ? '&limit=' + LIMIT : ''))
    .then(function (r) { return r.json(); });
}
function post(rows, withSrc) {
  window.__posts++;
  document.getElementById('fr').contentWindow.postMessage({ type: 'hh-data', rows: rows, src: withSrc ? SRC : null }, '*');
}
window.addEventListener('message', function (e) {
  var d = e.data || {};
  if (d.type === 'hh-ready') load().then(function (rows) { post(rows, true); });
  if (d.type === 'hh-filter') {
    window.__masks.push(d.mask);
    if (SELFOFF) return;
    FILTERS = {};
    (d.mask || []).forEach(function (f) { FILTERS[f.column] = f.value; });
    setTimeout(function () { load().then(function (rows) { post(rows, false); }); }, 300 + DELAY);
  }
});
fetch('/chart.js').then(function (r) { return r.text(); }).then(function (t) { SRC = t; document.getElementById('fr').srcdoc = INNER; });
</script></body></html>'''
BOARD_CSS = os.path.join(HERE, '..', 'Поставка — HRBP HUB v2', '4. CSS борда (дописать в конец).css')


LONG_TAIL = ' по развитию цифровых каналов, продаж и обслуживания клиентов малого и среднего бизнеса в регионах'


def lengthen(rows):
    """?long=1: у каждого второго юнита справочника (7-е поле строки dict) — длинный хвост имени."""
    for r in rows:
        if r.get('role') != 'dict' or not r.get('j'):
            continue
        out = []
        for i, line in enumerate(r['j'].split('\n')):
            f = line.split('\t')
            if len(f) > 6 and i % 2 == 0:
                f[6] += LONG_TAIL
            out.append('\t'.join(f))
        r['j'] = '\n'.join(out)
    return rows


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype):
        b = body.encode('utf-8') if isinstance(body, str) else body
        self.send_response(code)
        self.send_header('Content-Type', ctype + '; charset=utf-8')
        self.send_header('Content-Length', str(len(b)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/':
            return self.send(200, PAGE, 'text/html')
        if u.path == '/board':
            q = urllib.parse.parse_qs(u.query)
            page = BOARD
            if q.get('css') == ['1']:
                page = page.replace('/*BOARDCSS*/', open(BOARD_CSS, encoding='utf-8').read())
            return self.send(200, page, 'text/html')
        if u.path == '/chart.js':
            return self.send(200, open(CHART, encoding='utf-8').read(), 'application/javascript')
        if u.path == '/data':
            q = urllib.parse.parse_qs(u.query)
            try:
                flt = json.loads(q.get('flt', ['{}'])[0])
                sql = ch.render(flt, q.get('user', ['a.sergeeva'])[0])
                if q.get('limit'):
                    sql = 'SELECT %s FROM (%s) AS virtual_table LIMIT %d' % (COLS, sql, int(q['limit'][0]))
                rows, _ = ch.run(sql)
                if q.get('long') == ['1']:
                    rows = lengthen(rows)
                return self.send(200, json.dumps(rows, ensure_ascii=False), 'application/json')
            except Exception as e:  # noqa: BLE001 — стенд: ошибку показать, не упасть
                return self.send(500, json.dumps({'error': str(e)[:2000]}, ensure_ascii=False), 'application/json')
        return self.send(404, 'not found', 'text/plain')


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print('ClickHouse %s · http://127.0.0.1:%d/?user=a.sergeeva' % (ch.VERSION, port))
    http.server.HTTPServer(('127.0.0.1', port), H).serve_forever()
