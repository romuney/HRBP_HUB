"""Прогон gp-параграфов ноута «HRBP HUB.yaml» в PostgreSQL 16 над синтетикой.

    python3 stand/run_gp.py            # все включённые gp-параграфы по порядку
    python3 stand/run_gp.py --diag     # плюс выключенные (диагностика источников)
    python3 stand/run_gp.py --seed-kpi # с целями стенда (stand/kpi_seed.sql) после реестра целей

Исполняется ТОТ ЖЕ текст, что уедет в Helicopter (читается из YAML), со снятой
GP-спецификой: distributed by / randomly / replicated. Каждый оператор — отдельно,
чтобы видеть, где упало, и печатать результаты стоп-проверок и диагностики.
Стенд не заменяет прогон в GP: версия и планировщик другие (GP6 ≈ PostgreSQL 9.4),
поэтому SQL держится в подмножестве 9.4 — без FILTER, GROUPING SETS, LATERAL и т. п.
current_date стенда — день после последнего дня данных мира (world.D + 1): ноут проверяет
свежесть источника (не старше недели), а синтетический мир застыл на своей дате.
"""
import datetime as dt
import os
import re
import sys
import time

import psycopg2
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
NB = os.path.join(HERE, '..', 'helicopter', 'HRBP HUB.yaml')
sys.path.insert(0, HERE)
import world as W  # noqa: E402

TODAY = W.D + dt.timedelta(days=1)


def to_pg(sql):
    sql = re.sub(r'\bdistributed\s+(by\s*\([^)]*\)|randomly|replicated)', '', sql, flags=re.I)
    sql = re.sub(r'\bcurrent_date\b', "date '%s'" % TODAY.isoformat(), sql, flags=re.I)
    return re.sub(r'^\s*set\s+optimizer\s*=\s*\w+\s*;\s*$', '', sql, flags=re.I | re.M)


def statements(sql):
    out, cur = [], []
    for line in sql.split('\n'):
        cur.append(line)
        if line.rstrip().endswith(';') and not line.lstrip().startswith('--'):
            st = '\n'.join(cur).strip()
            if re.sub(r'--[^\n]*', '', st).strip(' ;\n'):
                out.append(st)
            cur = []
    rest = '\n'.join(cur).strip()
    if re.sub(r'--[^\n]*', '', rest).strip(' ;\n'):
        out.append(rest)
    return out


def main():
    diag = '--diag' in sys.argv
    seed = open(os.path.join(HERE, 'kpi_seed.sql'), encoding='utf-8').read() if '--seed-kpi' in sys.argv else None
    nb = yaml.safe_load(open(NB, encoding='utf-8'))
    con = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gp'))
    con.autocommit = True
    cur = con.cursor()
    total = time.time()
    for p in nb['paragraphs']:
        if p['shebang'] != 'gp' or not (p['isEnabled'] or diag):
            continue
        t0 = time.time()
        for st in statements(to_pg(p['code'])):
            try:
                cur.execute(st)
            except Exception as e:
                print('FAIL  %s\n      %s\n      --- оператор:\n%s' % (p['title'], str(e).strip(), st[:600]))
                sys.exit(1)
            if cur.description and re.match(r'^\s*(--[^\n]*\n\s*)*select', st, flags=re.I):
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
                if len(rows) <= 40:
                    for r in rows:
                        print('      ' + ', '.join('%s=%s' % (c, v) for c, v in zip(cols, r)))
                else:
                    print('      %d строк' % len(rows))
        if seed and p['title'] == 'KPI · реестр целей':
            cur.execute(seed)
        print('ok    %-34s %6.1f с' % (p['title'], time.time() - t0))
    print('всего %.1f с' % (time.time() - total))


if __name__ == '__main__':
    main()
