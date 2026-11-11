"""Накопленный отпуск (11.11): таблицы ноута в GP против независимого расчёта stand/expect.py.

    python3 stand/vac_check.py      # после run_gp.py: база, куб по каждому юниту, куб атрибутов (юрлицо) — месяцы и недели

ClickHouse и датасет здесь не участвуют (их проверяет check.py, когда отпуска дойдут до датасета).
"""
import hashlib
import os
import sys

import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import expect as X  # noqa: E402
import world as W  # noqa: E402

KEYS = X.VAC_KEYS
ALL = lambda unit, pth, rp: True  # noqa: E731


def uid(rk):
    return hashlib.md5(rk.encode()).hexdigest()[:12]


def sums(cur, table, where, args, grain, group=None):
    cols = ', '.join('%s_%s' % (grain, k) for k in KEYS)
    g = (group + ', ') if group else ''
    cur.execute('select %s%s from %s where %s' % (g, cols, table, where), args)
    out = {}
    for row in cur.fetchall():
        key = row[0] if group else None
        o = out.setdefault(key, {k: [0] * 24 for k in KEYS})
        for k, arr in zip(KEYS, row[1 if group else 0:]):
            for i, x in enumerate(arr or []):
                o[k][i] += x or 0
    return out if group else out.get(None, {k: [0] * 24 for k in KEYS})


def main():
    con = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gp'))
    cur = con.cursor()
    bad, n = [], 0

    def cmp(name, got, exp):
        nonlocal n
        n += 1
        for k in KEYS:
            if list(got[k]) != list(exp[k]):
                bad.append('%s %s: ноут %s ≠ расчёт %s' % (name, k, got[k], exp[k]))
                return

    print('начало метрики (расчёт):', X.vac_start())
    nl = W.NONLEGAL
    for grain in ('m', 'w'):
        # база: вся компания под разрезами
        for label, where, args, flt in (
                ('без разрезов', 'hct <> %s', [nl], {}),
                ('Штат', 'hct <> %s and staff = %s', [nl, 'Штат'], {'staff': ['Штат']}),
                ('Не штат', 'hct <> %s and staff = %s', [nl, 'Не штат'], {'staff': ['Не штат']}),
                ('Активная', 'hct = %s', ['Активная'], {'hct': ['Активная']}),
                ('Прогульщики + Декрет', 'hct in (%s, %s)', ['Прогульщики', 'Декрет'], {'hct': ['Прогульщики', 'Декрет']}),
                ('HQ + Штат', 'hct <> %s and paint = %s and staff = %s', [nl, 'HQ', 'Штат'], {'paint': ['HQ'], 'staff': ['Штат']})):
            cmp('база %s %s' % (grain, label), sums(cur, 'hrbp_hub_base', where, args, grain), X.vac_series(grain, ALL, flt))
        # куб: каждый юнит отчёта, без разрезов и при «Активной»
        cur.execute('select id from hrbp_hub_unit')
        ids = {r[0] for r in cur.fetchall()}
        for u in W.UNITS:
            if uid(u.rk) not in ids:
                continue
            for label, where, args, flt in (('', 'hct <> %s', [nl], {}), (' Активная', 'hct = %s', ['Активная'], {'hct': ['Активная']})):
                got = sums(cur, 'hrbp_hub_cube', where + ' and %s = any(path)', args + [uid(u.rk)], grain)
                cmp('куб %s %s%s' % (grain, u.name_at(W.D), label), got, X.vac_series(grain, X.under({u.rk}), flt))
    # куб атрибутов: юрлицо (только месяцы) — компания и каждый блок
    roots = [u for u in W.UNITS if u.level in (1, 3) and uid(u.rk) in ids]
    for u in roots:
        got = sums(cur, 'hrbp_hub_attr', "attr_k = 'legal' and hct <> %s and %s = any(path)", [nl, uid(u.rk)], 'm', group='attr_v')
        exp = X.vac_series('m', X.under({u.rk}), {}, attr='legal')
        for v in set(got) | set(exp):
            z = {k: [0] * 24 for k in KEYS}
            cmp('атрибут юрлицо=%s %s' % (v, u.name_at(W.D)), got.get(v, z), exp.get(v, z))
        top = sums(cur, 'hrbp_hub_attr_top', "attr_k = 'legal' and unit_id = %s", [uid(u.rk)], 'm', group='attr_v')
        if top:
            for v in set(top) | set(exp):
                z = {k: [0] * 24 for k in KEYS}
                cmp('свёртка юрлицо=%s %s' % (v, u.name_at(W.D)), top.get(v, z), exp.get(v, z))
    print('сравнений: %d, расхождений: %d' % (n, len(bad)))
    for b in bad[:20]:
        print('  ', b)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
