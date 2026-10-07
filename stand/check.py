"""Регресс HRBP HUB на стенде: ответ датасета против независимого расчёта по миру
и инварианты, на которых держится экран.

    python3 stand/check.py            # после gen_sources.py, run_gp.py --seed-kpi, ch.py load

1. Число в число: компоненты метрик области, команд −1/−2 и базы == расчёт по
   миру (expect.py) — все 24 слота месяцев и недель, 12 компонентов, при разных
   HRBP, юнитах и разрезах, включая закрепляемость от active_hire_dt.
2. Сходимость внутри ответа: Σ команд −1 == область; Σ −2 внутри узла == узел;
   Σ разбивки трансформера == область (по разрезу и по атрибуту); фасеты == численность.
3. Доступ: чужой юнит не открывается (откат на свою зону), справочник и цели —
   только зона и её предки, без роли — только meta.
4. Устойчивость: AlwaysTrue при сохранении датасета, враждебный ввод, старый
   анализатор, prefer_column_name_to_alias = 1, join_use_nulls = 1, типы без Nullable.
5. Глубина и масштаб: путь отчёта lvl1 + lvl3…lvl12; «Команды» на 3 уровня и все
   уровни (depth_f) число в число, Σ детей == узел на каждом уровне, «Напрямую в …»
   только рядом с подразделениями, порог «все уровни»; справочник — вся зона логина на
   всю глубину при любом выборе; свёртка атрибутов == листовой куб; пути корней HRBP.
7. Кеш Proteus: логин в ключе кеша. Superset 2 кладёт current_username() в ключ кеша
   результата, только если регулярка ExtraCache.regex находит вызов внутри {{ … }} в тексте
   SQL датасета (в {% set %} — не находит, и ответ кешируется общим на всех): текст шаблона
   совпадает с регуляркой Superset 2 не в комментарии, а при рендере вызов идёт с
   add_to_cache_keys = True (значение по умолчанию).
6. Окно фильтров без запроса: распределение численности в справочнике (9-е поле,
   словари — meta.fdv) не зависит от выбора, и расчёт чарта по нему (fdCalc: поддеревья
   по родителям справочника, пара — в фасет разреза, если проходит остальные разрезы)
   даёт ровно строки f и численность области ответа с тем же выбором — в том числе на
   реорганизованных и расформированных юнитах.
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402
import expect as X  # noqa: E402
import world as W  # noqa: E402

COMP = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'hire', 'fire']
CARRIER = {'paint': 'paint_f', 'it': 'it_f', 'stream': 'stream_f', 'spec': 'spec_f', 'staff': 'staff_f', 'hct': 'hct_f'}
bad = 0
cases = 0


def sid(rk):
    return hashlib.md5(rk.encode()).hexdigest()[:12]


def ok(cond, msg):
    global bad, cases
    cases += 1
    if not cond:
        bad += 1
        print('FAIL ' + msg)
    return cond


def unarr(v):
    """Массив из ответа: «0» — все нули, «N@…» — первые N слотов нули, хвост — нули до 24 (как parseArr чарта)."""
    if not v:
        return []
    off, _, body = v.rpartition('@') if '@' in v else ('0', '', v)
    a = [0] * int(off) + [int(x) for x in body.split(',')]
    return a + [0] * (24 - len(a))


def arrs(row, grain):
    return {c: unarr(row[grain + '_' + c]) for c in COMP}


def ask(flt=None, user='a.sergeeva', settings=''):
    rows, st = ch.dataset(flt or {}, user, settings)
    return rows, st


def by(rows, role):
    return [r for r in rows if r['role'] == role]


def meta(rows):
    return json.loads(by(rows, 'meta')[0]['j'])


def ch_filters(cuts):
    return {CARRIER[k]: v for k, v in cuts.items() if v}


def compare(label, row, pred, cuts, grains=('m', 'w')):
    active = cuts.get('hct') == ['Активная']
    good = True
    for g in grains:
        exp = X.component_series(g, pred, cuts, active)
        got = arrs(row, g)
        for c in COMP:
            if got[c] != exp[c]:
                good = ok(False, '%s: %s_%s\n     ждали %s\n     пришло %s' % (label, g, c, exp[c], got[c])) and good
                break
    ok(good, label)
    return good


def tr_ok(rows, axes, label):
    """Трансформеры: каждая ось есть, Σ её значений == область в 12 последних месяцах, раньше — нули."""
    last = meta(rows)['last_m']
    sc = arrs(by(rows, 'scope')[0], 'm')
    tr = by(rows, 'tr')
    for ax in axes:
        vs = [r for r in tr if r['pid'] == ax]
        s12 = {c: [x if last - 11 <= i <= last else 0 for i, x in enumerate(sc[c])] for c in COMP}
        good = len(vs) > 0 and vsum(vs, 'm') == s12
        ok(good, 'Σ трансформера «%s» == область за 12 мес [%s]' % (ax, label))
    ok(all(not r['w_hc'] for r in tr), 'у трансформера нет недель [%s]' % label)


def tree_ok(rows, label):
    """Дерево «Команд» в ответе: у каждого узла Σ строк детей == узел (месяцы и недели),
    родитель каждой строки есть в ответе, «·» — только рядом с подразделениями."""
    tree = [r for r in rows if r['role'] in ('c', 'g', 'x')]
    # узел дерева — путь от −1 (pid строки + её id): реорганизованный юнит стоит в двух местах
    nodes = {(r['pid'] + '/' if r['pid'] else '') + r['id']: r for r in tree if r['id'] != '·'}
    kids = {}
    for r in tree:
        if r['role'] != 'c':
            kids.setdefault(r['pid'], []).append(r)
    good = True
    for pid, ks in kids.items():
        if pid not in nodes:
            good = ok(False, '%s: строки без родителя в ответе (%s)' % (label, pid)) and good
            continue
        n = nodes[pid]
        if vsum(ks, 'm') != arrs(n, 'm') or vsum(ks, 'w') != arrs(n, 'w'):
            good = ok(False, '%s: Σ детей != узел %s' % (label, pid)) and good
    for r in tree:
        if r['id'] == '·':
            sib = [q for q in tree if q['role'] == r['role'] and q['pid'] == r['pid'] and q['id'] != '·']
            if not sib:
                good = ok(False, '%s: «напрямую» без подразделений рядом (%s)' % (label, r['pid'])) and good
    ok(good, label + ': Σ детей == узел на всех уровнях, «напрямую» только рядом с подразделениями')
    return good


def vsum(rows_, g):
    out = {c: [0] * 24 for c in COMP}
    for r in rows_:
        a = arrs(r, g)
        for c in COMP:
            if a[c]:
                out[c] = [x + y for x, y in zip(out[c], a[c])]
    return out


def main():
    root = W.ROOT.rk
    U = W.BY_NAME
    prow, _ = ch.run("SELECT ifNull(id, '') AS id, arrayMap(x -> ifNull(x, ''), path) AS p FROM prod_proteus.hrbp_hub_unit")
    UTP = {r['id']: r['p'] for r in prow}
    # ---------------- 1. число в число ----------------
    scenarios = [
        ('супер-HRBP, вся компания', 'a.sergeeva', {}, {}, X.under({root})),
        ('супер-HRBP, HQ', 'a.sergeeva', {}, {'paint': ['HQ']}, X.under({root})),
        ('супер-HRBP, две специализации + не штат', 'a.sergeeva', {}, {'spec': ['Разработка', 'Аналитика'], 'staff': ['Не штат']}, X.under({root})),
        ('супер-HRBP, тип численности «Активная» (закрепляемость от active_hire_dt)', 'a.sergeeva', {}, {'hct': ['Активная']}, X.under({root})),
        ('супер-HRBP, стажёры', 'a.sergeeva', {}, {'hct': ['Стажеры']}, X.under({root})),
        ('Котов: своя зона', 'b.kotov', {}, {}, X.under({U['Розничный бизнес'].rk})),
        ('Волков: две корневые ветки', 's.volkov', {}, {}, X.under({U['Департамент данных'].rk, U['Департамент платформ'].rk})),
        ('Волков: реорганизованная ветка', 's.volkov', {'unit_f': [sid(U['Департамент данных'].rk)]}, {}, X.under({U['Департамент данных'].rk})),
        ('Волков: расформированный отдел', 's.volkov', {'unit_f': [sid(U['Отдел ручного тестирования'].rk)]}, {}, X.under({U['Отдел ручного тестирования'].rk})),
        ('Лапин: отдел с группами, IT', 'e.lapin', {'unit_f': [sid(U['Отдел бэкенда'].rk)]}, {'it': ['IT']}, X.under({U['Отдел бэкенда'].rk})),
        ('админ: переименованный отдел', 'r.kazantsev', {'unit_f': [sid(U['Отдел поддержки 1'].rk)]}, {}, X.under({U['Отдел поддержки 1'].rk})),
    ]
    for label, user, flt, cuts, pred in scenarios:
        f = dict(flt)
        f.update(ch_filters(cuts))
        rows, st = ask(f, user)
        sc = by(rows, 'scope')
        if not ok(len(sc) == 1, label + ': одна строка scope'):
            continue
        compare(label + ' · область', sc[0], pred, cuts)
        m = meta(rows)
        scope_ids = m['scope']
        # команды −1: каждая против расчёта «в области И в узле»
        rks = {sid(u.rk): u.rk for u in W.UNITS}
        for r in by(rows, 'c'):
            if r['id'] == '·':
                if len(scope_ids) == 1:
                    compare(label + ' · −1 «прямо в юните»', r, X.direct(rks[scope_ids[0]]), cuts, ('m',))
                continue
            compare(label + ' · −1 ' + r['id'], r, X.under({rks[i] for i in scope_ids}, {rks[r['id']]}), cuts, ('m',))
        # база — вся компания при тех же разрезах
        compare(label + ' · база', by(rows, 'base')[0], X.under({root}), cuts, ('m',))

    # ---------------- 2. сходимость внутри ответа ----------------
    for user, flt in [('a.sergeeva', {}), ('s.volkov', {}), ('b.kotov', {'paint_f': ['HQ']}), ('e.lapin', {'unit_f': [sid(U['Отдел бэкенда'].rk)]})]:
        rows, _ = ask(flt, user)
        sc = arrs(by(rows, 'scope')[0], 'm'), arrs(by(rows, 'scope')[0], 'w')
        ok(vsum(by(rows, 'c'), 'm') == sc[0] and vsum(by(rows, 'c'), 'w') == sc[1], 'Σ команд −1 == область [%s %s]' % (user, flt))
        for c in by(rows, 'c'):
            gs = [g for g in by(rows, 'g') if g['pid'] == c['id']]
            if c['id'] != '·' and gs:     # у узла без подразделений строк −2 нет вовсе
                ok(vsum(gs, 'm') == arrs(c, 'm'), 'Σ −2 == узел −1 %s [%s]' % (c['id'], user))
            else:
                ok(not gs, 'у «прямо в юните» нет −2 [%s]' % user)
        tree_ok(rows, 'дерево [%s %s]' % (user, flt))
        last = meta(rows)['last_m']
        for cut in CARRIER:
            fs = [r for r in by(rows, 'f') if r['pid'] == cut]
            if CARRIER[cut] in flt:
                continue
            ok(sum(int(r['n']) for r in fs) == sc[0]['hc'][last], 'фасеты «%s» == численность области [%s]' % (cut, user))
    # Трансформеры: все 17 осей в каждом ответе; Σ значений оси == область за 12 последних
    # месяцев, прежние слоты — нули. Без разрезов у юнитов со свёрткой (attr_top) атрибуты — из
    # неё (tr_top = 1), иначе — из листового куба; оба пути дают одни и те же строки.
    AXES = list(CARRIER) + ['grade', 'seniority', 'exp', 'gender', 'age', 'office', 'work', 'head', 'legal', 'macro', 'city']
    W_GRADES = len([r for r in by(ask({}, 'a.sergeeva')[0], 'tr') if r['pid'] == 'grade'])
    urows, _ = ch.run('SELECT ifNull(id, \'\') AS id, ifNull(attr_top, 0) AS t FROM prod_proteus.hrbp_hub_unit')
    TOP = {r['id'] for r in urows if int(r['t']) == 1}
    trkey = lambda rs: sorted((r['pid'], r['id'], r['n'], tuple(r['m_' + c] for c in COMP)) for r in rs if r['role'] == 'tr')
    for user, flt in [('a.sergeeva', {}), ('b.kotov', {}), ('b.kotov', {'staff_f': ['Штат']}), ('s.volkov', {}),
                      ('e.lapin', {}), ('e.lapin', {'unit_f': [sid(U['Отдел бэкенда'].rk)]}),
                      ('a.sergeeva', {'unit_f': [sid(U['Технологии'].rk)]}), ('a.sergeeva', {'unit_f': [sid(U['Ячейка A1-1'].rk)]}),
                      ('s.volkov', {'unit_f': [sid(U['Департамент данных'].rk), sid(U['Управление ML'].rk)]})]:
        rows, _ = ask(flt, user)
        m = meta(rows)
        tr_ok(rows, AXES, '%s %s' % (user, flt))
        cuts = any(k in flt for k in CARRIER.values())
        # юниты области без предка в ней же: у всех ли есть свёртка
        smin = [u for u in m['scope'] if not set(UTP[u][:-1]) & set(m['scope'])]
        want_top = 0 if cuts else int(all(u in TOP for u in smin))
        ok(m.get('tr_all') == 1 and m.get('tr_top') == want_top,
           'атрибуты — все, источник %s [%s %s]' % ('свёртка' if want_top else 'листовой куб', user, flt))
        leaf, _ = ch.dataset(flt, user, attr_top=False)
        ok(trkey(rows) == trkey(leaf), 'свёртка == листовой куб: те же строки трансформеров [%s %s]' % (user, flt))
    rows, _ = ask({'spec_f': ['Разработка', 'Аналитика']}, 'a.sergeeva')
    tr_ok(rows, AXES, 'фильтр по специализации')
    ok(sorted(r['id'] for r in by(rows, 'tr') if r['pid'] == 'spec') == ['Аналитика', 'Разработка'],
       'ось отфильтрованного разреза — только выбранные значения')
    # Запасной режим TR_ALL_MAX: без разрезов свёртка всё равно отдаёт все атрибуты; с разрезами
    # ветка больше порога — только разрезы, атрибут из tr_f — во всей ветке.
    rows, _ = ch.dataset({}, 'a.sergeeva', tr_all_max=10)
    ok(meta(rows).get('tr_all') == 1 and meta(rows).get('tr_top') == 1 and {r['pid'] for r in by(rows, 'tr')} == set(AXES),
       'TR_ALL_MAX ниже ветки, разрезов нет: все оси из свёртки')
    rows, _ = ch.dataset({'staff_f': ['Штат']}, 'a.sergeeva', tr_all_max=10)
    ok(meta(rows).get('tr_all') == 0 and {r['pid'] for r in by(rows, 'tr')} == set(CARRIER),
       'TR_ALL_MAX ниже ветки + разрез: атрибутов нет, разрезы — все')
    tr_ok(rows, list(CARRIER), 'порог, только разрезы')
    rows, _ = ch.dataset({'staff_f': ['Штат'], 'tr_f': ['grade']}, 'a.sergeeva', tr_all_max=10)
    ok({r['pid'] for r in by(rows, 'tr')} == set(CARRIER) | {'grade'}, 'TR_ALL_MAX ниже ветки + разрез + tr_f=grade: разрезы и грейд')
    tr_ok(rows, list(CARRIER) + ['grade'], 'порог + tr_f')
    # tr_f без разрезов (ось осталась в маске после снятых разрезов) — атрибут не задваивается:
    # он уже есть в свёртке, лист по нему не читается.
    for kw in ({}, {'tr_all_max': 10}):
        rows, _ = ch.dataset({'tr_f': ['grade']}, 'a.sergeeva', **kw)
        ok(meta(rows).get('tr_top') == 1, 'tr_f без разрезов %s: атрибуты из свёртки' % kw)
        tr_ok(rows, AXES, 'tr_f без разрезов %s' % kw)
    # Хвост атрибута: TR_TOP крупнейших значений + строка '…' (n — сколько в ней), Σ — прежняя;
    # у свёртки и у листового куба — одинаково.
    for top in (True, False):
        rows, _ = ch.dataset({}, 'a.sergeeva', tr_top=5, attr_top=top)
        gr = [r for r in by(rows, 'tr') if r['pid'] == 'grade']
        rest = [r for r in gr if r['id'] == '…']
        ok(len(gr) == 6 and len(rest) == 1 and int(rest[0]['n']) == W_GRADES - 5,
           'грейд при TR_TOP=5 (%s): 5 значений + «…» (%s)' % ('свёртка' if top else 'лист', [(r['id'], r['n']) for r in gr]))
        tr_ok(rows, AXES, 'TR_TOP=5, %s' % ('свёртка' if top else 'лист'))
    rows, _ = ask({'spec_f': ['Разработка']})
    fs = {r['id']: int(r['n']) for r in by(rows, 'f') if r['pid'] == 'spec'}
    ok(len(fs) > 3 and fs.get('Разработка', 0) > 0, 'фасет выбранного разреза показывает ВСЕ значения (кроме себя не фильтрует)')

    # ---------------- 3. доступ ----------------
    rows, _ = ask({'unit_f': [sid(U['Технологии'].rk)]}, 'b.kotov')
    m = meta(rows)
    ok(m['scope'] == [sid(U['Розничный бизнес'].rk)], 'чужой юнит → откат на свою зону (Котов)')
    dict_ids = [ln.split('\t')[0] for ln in by(rows, 'dict')[0]['j'].split('\n')]
    retail = {sid(u.rk) for u in W.UNITS if U['Розничный бизнес'] in u.chain_at(W.D) and u.level in W.REPORT_LEVELS}
    ok(set(dict_ids) == retail | {sid(root)}, 'справочник Котова = его ветка + предки корня')
    kp = by(rows, 'kpi')
    ok({r['id'] for r in kp} == {'T-004', 'T-005', 'T-006', 'T-007'}, 'цели Котова: карты (2) + компанейские (2), без чужих: %s' % sorted(r['id'] for r in kp))
    rows, _ = ask({}, 'nobody')
    ok([r['role'] for r in rows] == ['meta', 'end'] and meta(rows)['role'] == 'none', 'без роли — только meta (и маркер end)')
    rows, _ = ask({}, 'A.SERGEEVA ')
    ok(meta(rows)['role'] == 'super', 'логин нормализуется (регистр, пробелы)')
    rows, _ = ask({}, 's.volkov')
    ok(sorted(ln.split('\t')[0] for ln in by(rows, 'hrbps')[0]['j'].split('\n')) == ['d.orlova', 's.volkov'],
       'быстрый выбор зон Волкова: он сам и младший HRBP внутри')

    # ---------------- 4. устойчивость ----------------
    base_rows, _ = ask({'paint_f': ['HQ'], 'tr_f': ['grade']})
    key = lambda r: (r['role'], r['id'], r['pid'])
    norm = lambda rs: sorted((key(r), tuple(sorted(r.items()))) for r in rs)
    modes = ['prefer_column_name_to_alias = 1', 'join_use_nulls = 1', 'group_by_use_nulls = 1']
    if ch.ANALYZER_OFF:
        modes += [ch.ANALYZER_OFF, ch.ANALYZER_OFF + ', prefer_column_name_to_alias = 1, join_use_nulls = 1, group_by_use_nulls = 1']
    for st in modes:
        rows, _ = ask({'paint_f': ['HQ'], 'tr_f': ['grade']}, settings=st)
        ok(norm(rows) == norm(base_rows), 'режим CH «%s» — те же строки' % st)
    for hostile in [{'unit_f': ["x'); DROP TABLE t;--"]}, {'spec_f': ['a\\b', "o'q"]}, {'tr_f': ["grade'"]},
                    {'unit_f': [''] * 3}, {'hct_f': ['Активная', 'Декрет']}]:
        rows, _ = ask(hostile)
        ok(len(by(rows, 'meta')) == 1, 'враждебный/пустой ввод не роняет запрос: %s' % hostile)
    rows, _ = ch.run(ch.render({}, 'a.sergeeva', always_true=True))
    ok(meta(rows)['scope'] == [sid(root)], 'AlwaysTrue (сохранение датасета) → дефолт: зона пользователя')
    ok(len(json.loads(by(base_rows, 'meta')[0]['j'])['cal']) == 48, 'календарь: 48 слотов в meta')
    # Порядок строк и маркер end: Proteus оборачивает датасет в SELECT … LIMIT «лимит строк» и
    # режет хвост — служебное и значения фильтров обязаны идти первыми, end — последним.
    RANK = ['meta', 'f', 'scope', 'base', 'kpi', 'hrbps', 'dict', 'c', 'g', 'tr', 'x', 'end']
    cols = ', '.join(['role', 'id', 'pid', 'n', 'j'] + ['m_' + c for c in COMP] + ['w_' + c for c in COMP])
    for user, flt in [('a.sergeeva', {}), ('b.kotov', {'staff_f': ['Штат']}), ('s.volkov', {'tr_f': ['grade']})]:
        sql = ch.render(flt, user)
        rows, _ = ch.run(sql)
        seq = [RANK.index(r['role']) for r in rows]
        ok(seq == sorted(seq) and rows[0]['role'] == 'meta' and rows[-1]['role'] == 'end' and meta(rows).get('end') == 1,
           'порядок строк по роли, meta первой, end последней [%s %s]' % (user, flt))
        nf = len(by(rows, 'f'))
        cut, _ = ch.run('SELECT %s FROM (%s) AS virtual_table LIMIT %d' % (cols, sql, len(rows) - 5))
        ok(cut[0]['role'] == 'meta' and len(by(cut, 'f')) == nf and not by(cut, 'end'),
           'обёртка Proteus с лимитом меньше ответа: meta и все %d значений фильтров на месте, end нет [%s]' % (nf, user))
        whole, _ = ch.run('SELECT %s FROM (%s) AS virtual_table LIMIT 10000' % (cols, sql))
        ok(len(whole) == len(rows) and whole[-1]['role'] == 'end', 'обёртка Proteus с лимитом больше ответа: ответ целиком [%s]' % user)
    # ---------------- 5. глубина «Команд» до 12-го уровня и большие зоны ----------------
    tech = U['Технологии']
    rks = {sid(u.rk): u.rk for u in W.UNITS}
    urows, _ = ch.run('SELECT id, pid, lvl, path, kids_n, sub_n, nm FROM prod_proteus.hrbp_hub_unit')
    UT = {r['id']: r for r in urows}
    rows3, _ = ask({'unit_f': [sid(tech.rk)]})
    m3 = meta(rows3)
    ok(m3['depth_req'] == '3' and m3['depth'] == '3', 'по умолчанию «Команды» — 3 уровня')
    x3 = by(rows3, 'x')
    ok(len(x3) > 0 and all(r['pid'].count('/') == 1 for r in x3), '3 уровня: третий уровень есть, четвёртого нет')
    tree_ok(rows3, 'Технологии, 3 уровня')
    rows_all, _ = ask({'unit_f': [sid(tech.rk)], 'depth_f': ['all']})
    ma = meta(rows_all)
    ok(ma['depth_req'] == 'all' and ma['depth'] == 'all' and ma['scope_n'] == UT[sid(tech.rk)]['sub_n'] <= ma['all_max'],
       'все уровни: ветка (%s юнитов) меньше порога — отдаются' % ma['scope_n'])
    tree_ok(rows_all, 'Технологии, все уровни')
    deep = [U['Отдел бэкенда'], U['Отдел бэкенда / группа 1'], U['Подзвено A1']]
    for e in deep:
        xs = [r for r in rows_all if r['role'] in ('g', 'x') and r['pid'].split('/')[-1] == sid(e.rk)]
        ok(len(xs) > 0, 'все уровни: у %s есть строки детей' % e.name_at(W.D))
        for r in xs:
            child = None if r['id'] == '·' else rks[r['id']]
            compare('все уровни %s → %s' % (e.name_at(W.D), r['id']), r, X.child_of(e.rk, child), {})
    yach = sid(U['Ячейка A1-1'].rk)
    ok(yach in {r['id'] for r in rows_all} and not [r for r in rows_all if r['pid'].split('/')[-1] == yach],
       'lvl12 — нижний уровень: «Ячейка» в дереве, строк детей у неё нет (lvl13 — внутри неё)')
    norm_cg = lambda rs: sorted((r['role'], r['id'], r['pid'], r['m_hc'], r['w_rg']) for r in rs if r['role'] in ('scope', 'c', 'g', 'base', 'f'))
    ok(norm_cg(rows_all) == norm_cg(rows3), 'глубина не меняет юнит, −1, −2, базу и фасеты')
    rows_cap, _ = ch.dataset({'unit_f': [sid(tech.rk)], 'depth_f': ['all']}, 'a.sergeeva', all_max=5)
    mc = meta(rows_cap)
    xc = by(rows_cap, 'x')
    ok(mc['depth_req'] == 'all' and mc['depth'] == '3' and mc['scope_n'] > mc['all_max']
       and all(r['pid'].count('/') == 1 for r in xc),
       'все уровни при ветке больше порога — отдаются 3 уровня, в meta видно почему')
    # путь отчёта: lvl2 пропущен, компания — родитель блоков
    ok(UT[sid(tech.rk)]['pid'] == sid(root) and UT[sid(tech.rk)]['lvl'] == 3, 'блок (lvl3) стоит прямо под компанией: lvl2 пропущен')
    ok(sid(U['Микроячейка A1-1-a'].rk) not in UT and sid(U['ТБанк · Банк'].rk) not in UT, 'lvl13 и lvl2 в справочник не попадают')
    ok(max(r['lvl'] for r in urows) == 12 and UT[yach]['kids_n'] == 0, 'нижний уровень — 12, детей у него нет')
    rows, _ = ask({'unit_f': [sid(root)]})
    dct = [r for r in rows if r['role'] == 'c' and r['id'] == '·']
    ok(len(dct) == 1, 'люди lvl1/lvl2 — строка «прямо в компании»')
    compare('прямо в компании (lvl1 + lvl2)', dct[0], X.direct(root), {}, ('m',))
    # справочник: вся зона логина на всю глубину и предки её корней — при любом выборе юнита,
    # разрезах и глубине (поиск и выбор юнита в чарте — без запроса); rk — в meta, не в справочнике
    def dict_ids(rs):
        return {ln.split('\t')[0] for ln in by(rs, 'dict')[0]['j'].split('\n')}
    acc_all, _ = ch.run("SELECT ifNull(login, '') AS login, ifNull(root_id, '') AS r FROM prod_proteus.hrbp_hub_access WHERE ifNull(role, '') = 'hrbp'")
    for user, flts in [('a.sergeeva', [{}, {'unit_f': [sid(tech.rk)]}, {'unit_f': [yach], 'depth_f': ['all']}, {'paint_f': ['HQ']}]),
                       ('s.volkov', [{}, {'unit_f': [sid(U['Департамент данных'].rk)]}, {'spec_f': ['Разработка']}]),
                       ('e.lapin', [{}, {'unit_f': [sid(U['Отдел бэкенда'].rk)]}])]:
        roots_ = {r['r'] for r in acc_all if r['login'] == user} or {sid(root)}
        want = {i for i, r in UT.items() if set(r['path']) & roots_} | {a for r_ in roots_ for a in UT[r_]['path']}
        for flt in flts:
            rows, _ = ask(flt, user)
            dl = by(rows, 'dict')[0]['j'].split('\n')
            t_ids = {r['id'] for r in rows if r['role'] in ('c', 'g', 'x') and r['id'] != '·'}
            ok(dict_ids(rows) == want and int(by(rows, 'dict')[0]['n']) == len(want) and t_ids <= want
               and all(ln.split('\t')[5] == '' for ln in dl),
               'справочник %s %s: вся зона и предки корней (%d юнитов), все строки «Команд» в нём, rk пустой' % (user, flt, len(want)))
    rows, _ = ask({'unit_f': [sid(tech.rk)]})
    ok(meta(rows)['rk'] == tech.rk, 'rk выбранного юнита — в meta')
    rows, _ = ask({}, 's.volkov')
    ok(meta(rows)['rk'] == '', 'у зоны из двух корней rk в meta пустой')
    # HRBP: пути корней для дерева «кто под кем»
    rows, _ = ask({}, 's.volkov')
    hl = [ln.split('\t') for ln in by(rows, 'hrbps')[0]['j'].split('\n')]
    good = len(hl) == 2
    for f in hl:
        roots_ = f[2].split(',')
        paths_ = f[4].split(',') if len(f) > 4 else []
        good = good and len(paths_) == len(roots_) and all(p.split('/')[-1] == r_ and p.split('/') == UT[r_]['path']
                                                          for r_, p in zip(roots_, paths_))
    ok(good, 'HRBP: у каждого корня зоны — его путь от компании')

    # ---------------- 6. окно фильтров: числа по набранному выбору без запроса ----------------
    KEYS = list(CARRIER)

    def fd_model(rows):
        """Распределение из ответа: юнит → (родитель, [(значения 6 разрезов, n)])."""
        fdv = meta(rows)['fdv']
        sizes = [len(fdv[k]) for k in KEYS]
        units = {}
        for ln in by(rows, 'dict')[0]['j'].split('\n'):
            f = ln.split('\t')
            pairs = []
            for pr in (f[8].split(' ') if len(f) > 8 and f[8] else []):
                code, n = pr.split(':')
                c, idx = int(code, 16), []
                for sz in reversed(sizes):
                    idx.append(c % sz)
                    c //= sz
                idx.reverse()
                pairs.append((tuple(fdv[k][i] for k, i in zip(KEYS, idx)), int(n)))
            units[f[0]] = (f[1], pairs)
        return units

    def fd_calc(units, scope, cuts):
        """Как fdCalc чарта: область — поддеревья по родителям справочника; фасет разреза K — пары,
        что проходят все выбранные разрезы, кроме K; численность — пары, что проходят все."""
        kids = {}
        for uid, (pid, _) in units.items():
            kids.setdefault(pid, []).append(uid)
        seen, stack = set(), list(scope)
        while stack:
            x = stack.pop()
            if x not in seen:
                seen.add(x)
                stack.extend(kids.get(x, []))
        fac, tot = {}, 0
        for uid in seen:
            for vals, n in units.get(uid, ('', []))[1]:
                fails = [k for k, v in zip(KEYS, vals) if cuts.get(k) and v not in cuts[k]]
                tot += n if not fails else 0
                for k, v in zip(KEYS, vals):
                    if not fails or fails == [k]:
                        fac[(k, v)] = fac.get((k, v), 0) + n
        return fac, tot

    fd_cases = [('a.sergeeva', {}), ('a.sergeeva', {'paint_f': ['HQ']}),
                ('a.sergeeva', {'spec_f': ['Разработка', 'Аналитика'], 'staff_f': ['Не штат']}),
                ('a.sergeeva', {'unit_f': [sid(tech.rk)]}), ('a.sergeeva', {'unit_f': [yach], 'it_f': ['IT']}),
                ('a.sergeeva', {'hct_f': ['Активная'], 'paint_f': ['HQ', 'Line']}), ('b.kotov', {'staff_f': ['Штат']}),
                ('s.volkov', {}), ('s.volkov', {'unit_f': [sid(U['Департамент данных'].rk)]}),
                ('s.volkov', {'unit_f': [sid(U['Отдел ручного тестирования'].rk)]}),
                ('e.lapin', {'unit_f': [sid(U['Отдел бэкенда'].rk)], 'it_f': ['IT']}),
                ('r.kazantsev', {'unit_f': [sid(U['Отдел поддержки 1'].rk)]})]
    first = {}
    for user, flt in fd_cases:
        rows, _ = ask(flt, user)
        m = meta(rows)
        units = fd_model(rows)
        cuts = {k: flt[CARRIER[k]] for k in KEYS if CARRIER[k] in flt}
        fac, tot = fd_calc(units, m['scope'], cuts)
        frows = {(r['pid'], r['id']): int(r['n']) for r in by(rows, 'f')}
        sc = by(rows, 'scope')
        hc = arrs(sc[0], 'm')['hc'][m['last_m']] if sc else 0
        dj = by(rows, 'dict')[0]['j']
        ok(fac == frows and tot == hc and first.setdefault(user, dj) == dj,
           'окно фильтров без запроса %s %s: фасеты (%d) и численность области (%d) из справочника == ответ, справочник от выбора не зависит'
           % (user, flt, len(frows), hc))
    rows, _ = ask({}, 'b.kotov')
    lines = by(rows, 'dict')[0]['j'].split('\n')
    ok(all(len(ln.split('\t')) == 9 for ln in lines) and sum(1 for ln in lines if ln.split('\t')[8]) > 0,
       'у каждой строки справочника 9 полей, у юнитов с людьми — распределение')
    ok(meta(ask({}, 'nobody')[0]).get('fdv') == {}, 'без роли словарей значений нет')

    # ---------------- 7. кеш Proteus: логин в ключе кеша ----------------
    # Регулярка Superset 2.x (superset/jinja_context.py, ExtraCache.regex): ищет вызов внутри {{ … }}
    # на одной строке. Нашла — Superset рендерит шаблон ради ключа кеша, и current_username()
    # добавляет логин в extra_cache_keys; не нашла — ключ без логина, кеш общий для всех.
    import re as _re
    ExtraCache2 = _re.compile(r"\{\{.*(current_user_id\(.*\)|current_username\(.*\)|cache_key_wrapper\(.*\)|url_param\(.*\)).*\}\}")
    tmpl = open(ch.DATASET, encoding='utf-8').read()
    code = _re.sub(r"\{#.*?#\}", '', tmpl, flags=_re.S)
    ok(ExtraCache2.search(code) is not None,
       'кеш Proteus: current_username() внутри {{ }} в коде шаблона (не в комментарии) — Superset 2 кладёт логин в ключ кеша')
    ok(ExtraCache2.search("{% set me = (current_username() or '')|string|trim|lower %}") is None,
       'регулярка Superset 2 не видит вызов в {% set %} — поэтому он и стоит в {{ }}')
    calls = []

    def _cu(add_to_cache_keys=True):
        calls.append(add_to_cache_keys)
        return 'b.kotov'
    import jinja2 as _j2
    _env = _j2.Environment(extensions=['jinja2.ext.do'])
    _env.from_string(tmpl).render(filter_values=lambda c, d=None, r=False: [], current_username=_cu)
    ok(len(calls) > 0 and all(calls), 'при рендере логин берётся с add_to_cache_keys = True (%d вызовов)' % len(calls))

    print('ClickHouse %s · %d проверок, провалено %d' % (ch.VERSION, cases, bad))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
