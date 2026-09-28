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
5. Глубина и масштаб: путь отчёта lvl1 + lvl3…lvl12, раскрытие узлов глубже −2
   (exp_f) число в число, справочник большой зоны (путь + окрестность), поиск q_f.
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
            if c['id'] != '·':
                ok(vsum(gs, 'm') == arrs(c, 'm'), 'Σ −2 == узел −1 %s [%s]' % (c['id'], user))
            else:
                ok(not gs, 'у «прямо в юните» нет −2 [%s]' % user)
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
    # ---------------- 5. глубина до 12-го уровня и большие зоны ----------------
    tech = U['Технологии']
    deep = [U['Отдел бэкенда'], U['Отдел бэкенда / группа 1'], U['Подзвено A1'], U['Ячейка A1-1']]
    outside = U['Отдел клиринга']
    flt = {'unit_f': [sid(tech.rk)], 'exp_f': [sid(u.rk) for u in deep] + [sid(outside.rk), sid(tech.rk)]}
    rows, _ = ask(flt)
    m = meta(rows)
    ok(set(m['exp']) == {sid(u.rk) for u in deep},
       'раскрытие: чужой узел и сам юнит отброшены, свои приняты: %s' % m['exp'])
    rks = {sid(u.rk): u.rk for u in W.UNITS}
    for e in deep:
        xs = [r for r in rows if r['role'] == 'x' and r['pid'] == sid(e.rk)]
        ok(len(xs) > 0, 'раскрытие %s: есть строки детей' % e.name_at(W.D))
        for r in xs:
            child = None if r['id'] == '·' else rks[r['id']]
            compare('раскрытие %s → %s' % (e.name_at(W.D), r['id']), r, X.child_of(e.rk, child), {})
        ok(vsum(xs, 'm') == X.component_series('m', X.under({tech.rk}, {e.rk}), {}) and
           vsum(xs, 'w') == X.component_series('w', X.under({tech.rk}, {e.rk}), {}),
           'Σ детей раскрытого %s == его ветка' % e.name_at(W.D))
    yach = [r for r in rows if r['role'] == 'x' and r['pid'] == sid(U['Ячейка A1-1'].rk)]
    ok([r['id'] for r in yach] == ['·'], 'lvl12 — нижний уровень отчёта: у «Ячейки» только «прямо в ней» (lvl13 внутри)')
    base_rows, _ = ask({'unit_f': [sid(tech.rk)]})
    norm_cg = lambda rs: sorted((r['role'], r['id'], r['pid'], r['m_hc'], r['w_rg']) for r in rs if r['role'] in ('scope', 'c', 'g', 'base', 'f'))
    ok(norm_cg(rows) == norm_cg(base_rows), 'раскрытие не меняет юнит, −1, −2, базу и фасеты')
    # путь отчёта: lvl2 пропущен, компания — родитель блоков
    urows, _ = ch.run('SELECT id, pid, lvl, path, kids_n, nm FROM prod_proteus.hrbp_hub_unit')
    UT = {r['id']: r for r in urows}
    ok(UT[sid(tech.rk)]['pid'] == sid(root) and UT[sid(tech.rk)]['lvl'] == 3, 'блок (lvl3) стоит прямо под компанией: lvl2 пропущен')
    ok(sid(U['Микроячейка A1-1-a'].rk) not in UT and sid(U['ТБанк · Банк'].rk) not in UT, 'lvl13 и lvl2 в справочник не попадают')
    ok(max(r['lvl'] for r in urows) == 12 and UT[sid(U['Ячейка A1-1'].rk)]['kids_n'] == 0, 'нижний уровень — 12, детей у него нет')
    rows, _ = ask({'unit_f': [sid(root)]})
    dct = [r for r in rows if r['role'] == 'c' and r['id'] == '·']
    ok(len(dct) == 1, 'люди lvl1/lvl2 — строка «прямо в компании»')
    compare('прямо в компании (lvl1 + lvl2)', dct[0], X.direct(root), {}, ('m',))
    # справочник большой зоны: путь + окрестность; поиск по имени
    def dict_ids(rs):
        return {ln.split('\t')[0] for ln in by(rs, 'dict')[0]['j'].split('\n')}
    rows_full, _ = ask({'unit_f': [sid(tech.rk)]})
    ok(meta(rows_full)['dict_mode'] == 'full' and dict_ids(rows_full) == set(UT), 'маленькая зона: справочник целиком')
    flt = {'unit_f': [sid(tech.rk)], 'exp_f': [sid(U['Отдел бэкенда / группа 1'].rk)]}
    rows, _ = ch.dataset(flt, 'a.sergeeva', dict_full_max=10)
    m = meta(rows)
    kpi_units = {r['pid'] for r in by(rows, 'kpi')}
    scope = {sid(tech.rk)}
    sanc = set(UT[sid(tech.rk)]['path'])
    exp = {sid(U['Отдел бэкенда / группа 1'].rk)}
    xanc = set(UT[sid(U['Отдел бэкенда / группа 1'].rk)]['path'])
    want = {i for i, r in UT.items()
            if i in sanc or r['pid'] in sanc or r['pid'] in exp or i in xanc or r['pid'] == sid(root)
            or (len(r['path']) >= 3 and r['path'][-3] in scope) or i in kpi_units}
    ok(m['dict_mode'] == 'part' and dict_ids(rows) == want,
       'большая зона: путь, соседи, дети и внуки юнита, дети раскрытых, цели (%d из %d юнитов)' % (len(want), len(UT)))
    c_ids = {r['id'] for r in rows if r['role'] in ('c', 'g', 'x') and r['id'] != '·'}
    ok(c_ids <= dict_ids(rows), 'все строки команд −1/−2/раскрытия есть в справочнике')
    rows, _ = ch.dataset({'unit_f': [sid(tech.rk)], 'q_f': ['ЯЧЕЙКА']}, 'a.sergeeva', dict_full_max=10)
    hit = sid(U['Ячейка A1-1'].rk)
    ok(meta(rows)['q'] == 'ЯЧЕЙКА' and hit in dict_ids(rows) and set(UT[hit]['path']) <= dict_ids(rows),
       'поиск по всей зоне: найденный юнит и его путь в справочнике')
    rows, _ = ch.dataset({'q_f': ['ячейка']}, 'b.kotov', dict_full_max=1)
    ok(hit not in dict_ids(rows), 'поиск не выходит за зону HRBP')

    print('ClickHouse %s · %d проверок, провалено %d' % (ch.VERSION, cases, bad))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
