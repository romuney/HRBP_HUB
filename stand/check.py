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
   только рядом с подразделениями, порог «все уровни»; справочник большой зоны
   (путь + дерево «Команд» + корни HRBP), поиск q_f, пути корней HRBP.
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


def arrs(row, grain):
    return {c: [int(x) for x in row[grain + '_' + c].split(',')] if row[grain + '_' + c] else [] for c in COMP}


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
    for axis in ['spec', 'hct', 'grade', 'age', 'city', 'head']:
        for user, flt in [('a.sergeeva', {}), ('b.kotov', {'staff_f': ['Штат']})]:
            f = dict(flt, tr_f=[axis])
            rows, _ = ask(f, user)
            tr = by(rows, 'tr')
            sc = arrs(by(rows, 'scope')[0], 'm')
            ok(len(tr) > 1 and vsum(tr, 'm') == sc, 'Σ трансформера «%s» == область [%s %s]' % (axis, user, flt))
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
    ok([r['role'] for r in rows] == ['meta'] and meta(rows)['role'] == 'none', 'без роли — только meta')
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
    # справочник большой зоны: путь + дерево «Команд» + корни HRBP; поиск по имени
    def dict_ids(rs):
        return {ln.split('\t')[0] for ln in by(rs, 'dict')[0]['j'].split('\n')}
    ok(meta(rows3)['dict_mode'] == 'full' and dict_ids(rows3) == set(UT), 'маленькая зона: справочник целиком')
    acc, _ = ch.run("SELECT ifNull(root_id, '') AS r FROM prod_proteus.hrbp_hub_access WHERE ifNull(role, '') = 'hrbp'")
    hroots = {r['r'] for r in acc}
    acc_all, _ = ch.run("SELECT ifNull(login, '') AS login, ifNull(root_id, '') AS r FROM prod_proteus.hrbp_hub_access WHERE ifNull(role, '') = 'hrbp'")
    for depth_f, dep in (([], 3), (['all'], 10)):
        flt = {'unit_f': [sid(tech.rk)]}
        if depth_f:
            flt['depth_f'] = depth_f
        rows, _ = ch.dataset(flt, 'a.sergeeva', dict_full_max=10)
        m = meta(rows)
        kpi_units = {r['pid'] for r in by(rows, 'kpi')}
        scope = {sid(tech.rk)}
        sanc = set(UT[sid(tech.rk)]['path'])
        small = m['scope_n'] <= 10
        want = {i for i, r in UT.items()
                if i in sanc or r['pid'] in sanc or r['pid'] == sid(root) or i in kpi_units or i in hroots
                or set(r['path'][max(0, len(r['path']) - 1 - dep):len(r['path']) - 1]) & scope
                or (small and set(r['path']) & scope)}
        ok(m['dict_mode'] == 'part' and dict_ids(rows) == want,
           'большая зона, глубина %s: путь, соседи, дерево «Команд», цели, корни HRBP (%d из %d юнитов)' % (dep, len(want), len(UT)))
        t_ids = {r['id'] for r in rows if r['role'] in ('c', 'g', 'x') and r['id'] != '·'}
        ok(t_ids <= dict_ids(rows), 'все строки «Команд» (глубина %s) есть в справочнике' % dep)
    # область не больше DICT_FULL_MAX при большой зоне — приезжает целиком (дерево выбора
    # юнита в зоне HRBP полное, поиск по ней — в чарте)
    sub_tech = {i for i, r in UT.items() if sid(tech.rk) in r['path']}
    rows, _ = ch.dataset({'unit_f': [sid(tech.rk)]}, 'a.sergeeva', dict_full_max=len(sub_tech))
    m = meta(rows)
    ok(m['dict_mode'] == 'part' and m['scope_n'] == len(sub_tech) and m['scope_full'] == 1 and sub_tech <= dict_ids(rows),
       'большая зона, область ≤ порога: вся ветка «Технологий» в справочнике (%d юнитов), scope_full = 1' % len(sub_tech))
    rows, _ = ch.dataset({'unit_f': [sid(tech.rk)]}, 'a.sergeeva', dict_full_max=len(sub_tech) - 1)
    ok(meta(rows)['scope_full'] == 0 and not sub_tech <= dict_ids(rows), 'область больше порога — окрестностью, scope_full = 0')
    vz = [r for r in acc_all if r['login'] == 's.volkov']
    vroots = sorted(r['r'] for r in vz)
    sub_v = {i for i, r in UT.items() if set(vroots) & set(r['path'])}
    rows, _ = ch.dataset({'unit_f': vroots}, 'a.sergeeva', dict_full_max=len(sub_v))
    ok(meta(rows)['scope_full'] == 1 and sub_v <= dict_ids(rows), 'зона HRBP (s.volkov, %d юнитов) выбрана областью — в справочнике целиком' % len(sub_v))
    # поиск: сначала находки внутри области — даже когда по всей зоне их больше лимита
    qs_ = 'а'
    allhits = [i for i, r in UT.items() if qs_ in r['nm'].lower()]
    inside = {i for i in allhits if sid(tech.rk) in UT[i]['path']}
    rows, _ = ch.dataset({'unit_f': [sid(tech.rk)], 'q_f': [qs_]}, 'a.sergeeva', dict_full_max=10)
    ok(len(allhits) > 60 and inside <= dict_ids(rows) if len(inside) <= 60 else True,
       'поиск «%s»: %d находок по зоне, %d внутри области — все внутренние в справочнике' % (qs_, len(allhits), len(inside)))
    rows, _ = ch.dataset({'unit_f': [sid(tech.rk)], 'q_f': ['ЯЧЕЙКА']}, 'a.sergeeva', dict_full_max=10)
    ok(meta(rows)['q'] == 'ЯЧЕЙКА' and yach in dict_ids(rows) and set(UT[yach]['path']) <= dict_ids(rows),
       'поиск по всей зоне: найденный юнит и его путь в справочнике')
    rows, _ = ch.dataset({'q_f': ['ячейка']}, 'b.kotov', dict_full_max=1)
    ok(yach not in dict_ids(rows), 'поиск не выходит за зону HRBP')
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

    print('ClickHouse %s · %d проверок, провалено %d' % (ch.VERSION, cases, bad))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
