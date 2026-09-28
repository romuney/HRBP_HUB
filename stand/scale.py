"""Нагрузочный стенд: масштаб боя (≈100 тыс. сотрудников, ≈10 тыс. юнитов на уровнях
1 и 3…12) прямо в ClickHouse, без GP — проверяется датасет, а не ноут.

    python3 stand/scale.py [каталог chdb]     # по умолчанию stand/.chdb_scale
    HH_SCALE_COMBOS=4 python3 stand/scale.py  # «тяжёлый» куб: вдвое больше комбинаций разрезов

Схема таблиц — как у стенда (ch.load), данные — синтетика нужной формы:
дерево юнитов с глубокими ветками, комбинации разрезов на юнит (в среднем
1 + HH_SCALE_COMBOS, по умолчанию 1,8) и история за два года (куб ≈ 37 тыс. строк,
с HH_SCALE_COMBOS=4 — ≈ 60 тыс.), база — сумма куба по разрезам, 200 зон HRBP,
супер-HRBP и админ, 50 целей. Печатает лучшее из трёх время ответа, число строк
и размер JSON для типовых запросов: супер-HRBP на компании, блок, департамент
с раскрытием, поиск, HRBP своей зоны, разрезы. Куб атрибутов не заполняется:
трансформеры по атрибутам здесь не меряются.
"""
import json
import os
import random
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault('HH_CHDB', sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '.chdb_scale'))
# Схему таблиц создаёт ch.py load — отдельным процессом: chdb 2.x зависает, если в одном
# процессе после psycopg2 гонять тяжёлые вставки.
subprocess.run([sys.executable, os.path.join(HERE, 'ch.py'), 'load', 'nullable'], check=True,
               stdout=subprocess.DEVNULL, env=dict(os.environ))
sys.path.insert(0, HERE)
import ch  # noqa: E402

R = random.Random(100000)
COMBOS = float(os.environ.get('HH_SCALE_COMBOS') or 1.8)
S = ch.S


def uid(n):
    return '%012x' % (0x5ca1e0000000 + n)


def build_tree():
    """→ список юнитов (id, pid, lvl, path, nm, people)."""
    units, cnt = [], [0]

    def add(pid, lvl, path, nm, people):
        cnt[0] += 1
        u = dict(id=uid(cnt[0]), pid=pid, lvl=lvl, path=path + [uid(cnt[0])], nm=nm, people=people, kids=0)
        units.append(u)
        return u

    root = add('', 1, [], 'Компания', 3)
    fan = {4: (4, 9), 5: (3, 7), 6: (2, 6)}
    deep_p = {7: .7, 8: .35, 9: .25, 10: .2, 11: .15, 12: .1}
    deep_n = {7: (1, 4), 8: (1, 3), 9: (1, 2), 10: (1, 2), 11: (1, 2), 12: (1, 2)}

    def grow(node, lvl):
        if lvl <= 6:
            n = R.randint(*fan[lvl])
        elif lvl <= 12 and R.random() < deep_p[lvl]:
            n = R.randint(*deep_n[lvl])
        else:
            n = 0
        for i in range(n):
            ch_ = add(node['id'], lvl, node['path'], 'Юнит %d.%d' % (lvl, cnt[0] + 1), 0)
            node['kids'] += 1
            grow(ch_, lvl + 1)
    for b in range(18):
        blk = add(root['id'], 3, root['path'], 'Блок %d' % (b + 1), 2)
        root['kids'] += 1
        grow(blk, 4)
    for u in units:
        u['people'] = R.randint(9, 19) if u['kids'] == 0 else R.randint(1, 4)
    sub = {}
    for u in units:
        for a in u['path']:
            sub[a] = sub.get(a, 0) + 1
    for u in units:
        u['sub'] = sub[u['id']]
    return units


CUTV = dict(paint=['HQ', 'Line', 'Support', '-'], it=['IT', 'nonIT'],
            stream=['Поток %d' % i for i in range(15)], spec=['Специализация %d' % i for i in range(25)],
            staff=['Штат', 'Не штат'], hct=['Активная', 'Стажеры', 'Декрет', 'Прогульщики'])


def main():
    t0 = time.time()
    units = build_tree()
    people = sum(u['people'] for u in units)
    print('юнитов %d, людей %d, уровни %s' % (len(units), people,
          sorted(set(u['lvl'] for u in units))))
    for t in ('hrbp_hub_unit', 'hrbp_hub_cube', 'hrbp_hub_base', 'hrbp_hub_access', 'hrbp_hub_kpi', 'hrbp_hub_attr'):
        S.query('TRUNCATE TABLE prod_proteus.%s' % t)
    lines = [json.dumps(dict(id=u['id'], rk='rk' + u['id'], nm=u['nm'], lvl=u['lvl'], pid=u['pid'], path=u['path'],
                             is_current=1, hc_now=0, kids_n=u['kids'], sub_n=u['sub'], last_dt='2026-09-27'), ensure_ascii=False)
             for u in units]
    S.query('INSERT INTO prod_proteus.hrbp_hub_unit FORMAT JSONEachRow\n' + '\n'.join(lines))
    # ключи куба: в среднем 1 + COMBOS комбинаций разрезов на юнит, +80 % на историю (комбинации, которых уже нет)
    keys = []
    for u in units:
        k = max(1, min(u['people'], 1 + int(R.expovariate(1 / COMBOS))))
        hist = int(k * .8 + R.random())          # комбинации, которых уже нет: уволились, перешли
        st = R.randrange(15)
        for j in range(k + hist):
            share = u['people'] / k
            w = share * (R.uniform(.9, 1.1) if j < k else R.uniform(.05, .3))
            keys.append(dict(path_s='/'.join(u['path']), path=u['path'], leaf=u['id'],
                             paint=R.choice(CUTV['paint']), it=R.choice(CUTV['it']),
                             stream=CUTV['stream'][(st + (j % 2)) % 15], spec=R.choice(CUTV['spec']),
                             staff='Штат' if R.random() < .9 else 'Не штат',
                             hct='Активная' if R.random() < .9 else R.choice(CUTV['hct'][1:]),
                             w=round(w, 3)))
    S.query('DROP TABLE IF EXISTS prod_proteus.cube_keys')
    S.query('CREATE TABLE prod_proteus.cube_keys (path_s String, path Array(String), leaf String, paint String, it String, '
            'stream String, spec String, staff String, hct String, w Float64) ENGINE = MergeTree ORDER BY path_s')
    S.query('INSERT INTO prod_proteus.cube_keys FORMAT JSONEachRow\n' + '\n'.join(json.dumps(k, ensure_ascii=False) for k in keys))
    comp = ['hc', 'jun', 'rg', 'nrg', 'hcw', 'nr', 'r3n', 'r3d', 'r6n', 'r6d', 'r3an', 'r3ad', 'r6an', 'r6ad', 'hire', 'fire']
    scale = dict(hc=1.0, jun=.15, rg=.03, nrg=.05, hcw=12.0, nr=.01, r3n=.06, r3d=.07, r6n=.05, r6d=.07,
                 r3an=.06, r3ad=.07, r6an=.05, r6ad=.07, hire=.03, fire=.02)

    def gen(c, g):
        return ('arrayMap(i -> toInt32(if(%s AND i > 19, 0, round(w * %s * (0.8 + (cityHash64(path_s, paint, spec, hct, i, \'%s%s\') %% 400) / 1000.0)))), range(24))'
                % ('1' if g == 'm' else '0', scale[c], g, c))
    cols = ', '.join(['path_s', 'path', 'leaf', 'paint', 'it', 'stream', 'spec', 'staff', 'hct']
                     + ['%s AS m_%s' % (gen(c, 'm'), c) for c in comp] + ['%s AS w_%s' % (gen(c, 'w'), c) for c in comp])
    S.query('INSERT INTO prod_proteus.hrbp_hub_cube SELECT %s FROM prod_proteus.cube_keys' % cols)
    agg = ', '.join(['sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), m_%s)) AS m_%s' % (c, c) for c in comp]
                    + ['sumForEach(arrayMap(x -> toInt64(ifNull(x, 0)), w_%s)) AS w_%s' % (c, c) for c in comp])
    S.query('INSERT INTO prod_proteus.hrbp_hub_base SELECT paint, it, stream, spec, staff, hct, %s '
            'FROM prod_proteus.hrbp_hub_cube GROUP BY paint, it, stream, spec, staff, hct' % agg)
    # численность поддеревьев «сейчас» — по кубу (последний закрытый месяц)
    hc = json.loads(S.query("SELECT u AS id, sum(toInt64(ifNull(m_hc[20], 0))) AS hc FROM prod_proteus.hrbp_hub_cube "
                            "ARRAY JOIN path AS u GROUP BY u", 'JSON').bytes())['data']
    hcm = {r['id']: int(r['hc']) for r in hc}
    S.query('TRUNCATE TABLE prod_proteus.hrbp_hub_unit')
    for u in units:
        u['hc'] = hcm.get(u['id'], 0)
    lines = [json.dumps(dict(id=u['id'], rk='rk' + u['id'], nm=u['nm'], lvl=u['lvl'], pid=u['pid'], path=u['path'],
                             is_current=1, hc_now=u['hc'], kids_n=u['kids'], sub_n=u['sub'], last_dt='2026-09-27'), ensure_ascii=False)
             for u in units]
    S.query('INSERT INTO prod_proteus.hrbp_hub_unit FORMAT JSONEachRow\n' + '\n'.join(lines))
    # доступ: 200 HRBP по юнитам 4–5 уровня, супер и админ — на корень
    mids = [u for u in units if u['lvl'] in (4, 5)]
    R.shuffle(mids)
    acc, used = [], set()
    root = units[0]
    acc.append(dict(login='super', hrbp_rk='1', hrbp_nm='Супер HRBP', role='super', root_id=root['id']))
    acc.append(dict(login='admin', hrbp_rk='', hrbp_nm='admin', role='admin', root_id=root['id']))
    i = 0
    for n in range(200):
        for _ in range(R.randint(1, 3)):
            while i < len(mids) and (mids[i]['id'] in used or any(p in used for p in mids[i]['path'])):
                i += 1
            if i >= len(mids):
                break
            used.add(mids[i]['id'])
            acc.append(dict(login='hrbp%03d' % n, hrbp_rk=str(n), hrbp_nm='HRBP %03d' % n, role='hrbp', root_id=mids[i]['id']))
    S.query('INSERT INTO prod_proteus.hrbp_hub_access FORMAT JSONEachRow\n' + '\n'.join(json.dumps(a, ensure_ascii=False) for a in acc))
    kp = []
    for n in range(50):
        u = R.choice(units)
        kp.append(dict(rule_id='S-%03d' % n, unit_id=u['id'], unit_rk='rk' + u['id'], metric_id=R.choice(['regret', 'retention_new_3', 'exit_reasons']),
                       target=3.5, f_paint='all', f_it='all', f_stream='all', f_spec='all', f_staff='all', f_hct='all',
                       valid_from='2025-01-01', valid_to='2099-12-31', author='scale', note='', unit_path=u['path']))
    S.query('INSERT INTO prod_proteus.hrbp_hub_kpi FORMAT JSONEachRow\n' + '\n'.join(json.dumps(k, ensure_ascii=False) for k in kp))
    n_cube = S.query('SELECT count() FROM prod_proteus.hrbp_hub_cube', 'CSV').bytes().decode().strip()
    n_base = S.query('SELECT count() FROM prod_proteus.hrbp_hub_base', 'CSV').bytes().decode().strip()
    tot = S.query('SELECT sum(toInt64(ifNull(m_hc[20], 0))) FROM prod_proteus.hrbp_hub_cube', 'CSV').bytes().decode().strip()
    print('куб %s строк, база %s, численность %s, логинов %d · подготовка %.0f с'
          % (n_cube, n_base, tot, len({a['login'] for a in acc}), time.time() - t0))

    by_lvl = {}
    for u in units:
        by_lvl.setdefault(u['lvl'], []).append(u)
    blk = max(by_lvl[3], key=lambda u: u['hc'])
    dep = max((u for u in by_lvl[4] if blk['id'] in u['path']), key=lambda u: u['hc'])
    deep = [u for u in units if dep['id'] in u['path'] and u['lvl'] in (6, 7, 8)][:4]
    hr = [a for a in acc if a['role'] == 'hrbp'][0]['login']
    cases = [
        ('супер-HRBP, компания', 'super', {}),
        ('супер-HRBP, блок (lvl3)', 'super', {'unit_f': [blk['id']]}),
        ('супер-HRBP, департамент + 4 раскрытия', 'super', {'unit_f': [dep['id']], 'exp_f': [u['id'] for u in deep]}),
        ('супер-HRBP, поиск «Юнит 9.»', 'super', {'unit_f': [blk['id']], 'q_f': ['Юнит 9.']}),
        ('супер-HRBP, компания + 2 специализации', 'super', {'spec_f': CUTV['spec'][:2]}),
        ('супер-HRBP, компания + ось «Специализация»', 'super', {'tr_f': ['spec']}),
        ('HRBP своей зоны', hr, {}),
    ]
    print('%-44s %6s %6s %8s  %s' % ('запрос', 'с', 'строк', 'JSON КБ', 'справочник'))
    for label, user, flt in cases:
        best, rows = None, None
        for k in range(3):
            sql = '-- %d %f\n' % (k, time.time()) + ch.render(flt, user)
            t = time.time()
            rows, _ = ch.run(sql)
            dt_ = time.time() - t
            best = dt_ if best is None else min(best, dt_)
        size = len(json.dumps(rows, ensure_ascii=False).encode())
        meta = json.loads([r for r in rows if r['role'] == 'meta'][0]['j'])
        d = [r for r in rows if r['role'] == 'dict']
        dsz = len(d[0]['j'].encode()) // 1024 if d else 0
        print('%-44s %6.2f %6d %8.0f  %s, %s юн., %d КБ' % (label, best, len(rows), size / 1024,
              meta.get('dict_mode'), d[0]['n'] if d else 0, dsz))


if __name__ == '__main__':
    main()
