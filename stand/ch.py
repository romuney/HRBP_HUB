"""ClickHouse-стенд HRBP HUB на встроенном ClickHouse (chdb).

    python3 stand/ch.py load [plain|nullable]   # hrbp_hub_* из PostgreSQL → prod_proteus.* в chdb
    python3 stand/ch.py run '{"unit_f": ["…"]}' [логин]   # датасет с фильтрами → строки

Таблицы переносятся как их создал бы gp_to_click: скаляры, массивы, даты. Режим
nullable делает ВСЕ колонки Nullable (и элементы массивов) — так ведут себя
выгрузки в бою (в датасетах Proteus Adoption везде ifNull), plain — без Nullable.
Датасет рендерится как в Superset: filter_values() из словаря фильтров,
current_username() — из логина; always_true=True имитирует сохранение датасета
в Proteus (filter_values отдаёт AlwaysTrueObject вместо списка).
Движок — какой стоит: chdb 2.1.1 = ClickHouse 24.8 (как бой), chdb 4.x = 26.9.
Стенд не заменяет прогон в SQL Lab: настройки кластера Proteus могут отличаться.
"""
import datetime as dt
import decimal
import json
import os
import sys

import chdb
import chdb.session as cs
import jinja2
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, '..', 'proteus', 'hrbp-hub.data.sql')
# Сессия — до любого запроса: в chdb 2.x глобальный движок инициализируется один раз.
_MAJOR_GUESS = 24 if chdb.__version__.startswith('2.') else 26
DB = os.environ.get('HH_CHDB') or os.path.join(HERE, '.chdb%d' % _MAJOR_GUESS)
S = cs.Session(DB)
VERSION = S.query('SELECT version()', 'CSV').bytes().decode().strip().strip('"')
MAJOR = int(VERSION.split('.')[0])
if MAJOR >= 25:
    # Как боевой ClickHouse 24: без Variant-типа как общего супертипа.
    S.query('SET use_variant_as_common_type = 0')
# Настройка анализатора: в 24.8 — allow_experimental_analyzer, в 26 старого анализатора нет.
ANALYZER_OFF = 'allow_experimental_analyzer = 0' if MAJOR < 25 else None

TABLES = {
    'hrbp_hub_calendar': ('(grain, idx)', {}),
    'hrbp_hub_unit': ('(id)', {}),
    'hrbp_hub_access': ('(login)', {}),
    'hrbp_hub_kpi': ('(unit_id)', {}),
    'hrbp_hub_cube': ('(path_s)', {}),
    'hrbp_hub_attr': ('(attr_k, path_s)', {}),
    'hrbp_hub_base': ('(paint, it, stream, spec, staff, hct)', {}),
}
PG2CH = {'text': 'String', 'integer': 'Int32', 'bigint': 'Int64', 'smallint': 'Int16', 'numeric': 'Float64',
         'double precision': 'Float64', 'date': 'Date', 'timestamp without time zone': 'DateTime'}


def ch_type(pg_type, udt, nullable):
    if pg_type == 'ARRAY':
        inner = PG2CH[{'_text': 'text', '_int4': 'integer', '_int8': 'bigint'}[udt]]
        return 'Array(%s)' % ('Nullable(%s)' % inner if nullable else inner)
    t = PG2CH[pg_type]
    return 'Nullable(%s)' % t if nullable else t


def load(mode='nullable'):
    nullable = mode == 'nullable'
    pg = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gp'))
    cur = pg.cursor()
    S.query('CREATE DATABASE IF NOT EXISTS prod_proteus')
    for t, (order, _) in TABLES.items():
        cur.execute("select column_name, data_type, udt_name from information_schema.columns "
                    "where table_name = %s order by ordinal_position", (t,))
        cols = cur.fetchall()
        ddl = ', '.join('`%s` %s' % (c, ch_type(dtp, udt, nullable)) for c, dtp, udt in cols)
        S.query('DROP TABLE IF EXISTS prod_proteus.%s' % t)
        S.query('CREATE TABLE prod_proteus.%s (%s) ENGINE = MergeTree ORDER BY %s SETTINGS allow_nullable_key = 1'
                % (t, ddl, order))
        cur.execute('select * from %s' % t)
        names = [d[0] for d in cur.description]
        lines = []
        for r in cur.fetchall():
            o = {}
            for n, v in zip(names, r):
                if isinstance(v, (dt.date, dt.datetime)):
                    v = v.isoformat()
                elif isinstance(v, decimal.Decimal):
                    v = float(v)
                o[n] = v
            lines.append(json.dumps(o, ensure_ascii=False))
        if lines:
            S.query('INSERT INTO prod_proteus.%s FORMAT JSONEachRow\n%s' % (t, '\n'.join(lines)))
        n = S.query('SELECT count() FROM prod_proteus.%s' % t, 'CSV').bytes().decode().strip()
        print('%-20s %8s строк  %s' % (t, n, 'nullable' if nullable else 'plain'))


class AlwaysTrue:
    """Как AlwaysTrueObject Proteus при сохранении датасета: истинный, итерация пустая."""
    def __bool__(self):
        return True

    def __iter__(self):
        return iter(())

    def __str__(self):
        return ''


def where_in(values, mark="'"):
    def q(v):
        return mark + v.replace("'", "''") + mark if isinstance(v, str) else str(v)
    return '(' + ', '.join(q(v) for v in values) + ')'


def render(flt=None, user='a.sergeeva', always_true=False, path=DATASET, dict_full_max=None):
    """dict_full_max — подменить порог «справочник целиком» (стенд маленький: так
    проверяется режим больших зон). По умолчанию — из окружения HH_DICT_FULL_MAX."""
    flt = flt or {}
    dict_full_max = dict_full_max or os.environ.get('HH_DICT_FULL_MAX')
    env = jinja2.Environment(extensions=['jinja2.ext.do'])
    env.filters['where_in'] = where_in

    def filter_values(col, default=None, remove_filter=False):
        if always_true:
            return AlwaysTrue()
        v = flt.get(col)
        if v is None:
            return [] if default is None else [default]
        return list(v) if isinstance(v, (list, tuple)) else [v]

    def current_username(add_to_cache_keys=True):
        return user
    text = open(path, encoding='utf-8').read()
    if dict_full_max:
        text = text.replace('{% set DICT_FULL_MAX = 1500 %}', '{% set DICT_FULL_MAX = ' + str(int(dict_full_max)) + ' %}')
    return env.from_string(text).render(filter_values=filter_values, current_username=current_username)


def run(sql, settings=''):
    q = sql + ('\nSETTINGS ' + settings if settings else '')
    d = json.loads(S.query(q, 'JSON').bytes())
    return d['data'], d.get('statistics', {})


def dataset(flt=None, user='a.sergeeva', settings='', always_true=False, dict_full_max=None):
    return run(render(flt, user, always_true, dict_full_max=dict_full_max), settings)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'load':
        load(sys.argv[2] if len(sys.argv) > 2 else 'nullable')
    elif len(sys.argv) > 1 and sys.argv[1] == 'run':
        flt = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        rows, st = dataset(flt, sys.argv[3] if len(sys.argv) > 3 else 'a.sergeeva')
        for r in rows:
            print({k: (v[:80] + '…' if isinstance(v, str) and len(v) > 80 else v) for k, v in r.items() if v not in ('', 0)})
        print(len(rows), 'строк', st)
    else:
        print(__doc__)
