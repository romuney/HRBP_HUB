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
import re
import sys

import chdb
import chdb.session as cs
import jinja2
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
DATASET = os.path.join(HERE, '..', 'proteus', 'hrbp-hub.data.sql')
if os.environ.get('HH_DIST') == '1':  # стенд на файлах поставки
    DATASET = os.path.join(HERE, '..', 'Поставка — HRBP HUB v2', '2. Proteus — датасет hrbp_hub.sql')
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
    'hrbp_hub_attr_top': ('(unit_id)', {}),
    'hrbp_hub_base': ('(paint, it, stream, spec, staff, hct)', {}),
}
PG2CH = {'text': 'String', 'integer': 'Int32', 'bigint': 'Int64', 'smallint': 'Int16', 'numeric': 'Float64',
         'double precision': 'Float64', 'date': 'Date', 'timestamp without time zone': 'DateTime'}
UPLOAD = os.path.join(HERE, '..', 'helicopter', 'paragraphs', '15 Выгрузка в ClickHouse.py')


def array_cast_tables():
    """Таблицы, которые ноут выгружает с array_type_cast=True (параграф «Выгрузка в ClickHouse»).
    Без флага gp_to_click кладёт массив GP строкой ('{a,b,c}') — стенд повторяет это,
    чтобы датасет не мог опереться на такую колонку как на массив (так в бою упал
    arrayMap по hrbp_hub_kpi.unit_path: «Argument 2 of function arrayMap must be Array»)."""
    out = set()
    for call in open(UPLOAD, encoding='utf-8').read().split('gp_to_click(')[1:]:
        m = re.match(r"\s*'(\w+)'", call)
        if m and re.search(r'array_type_cast\s*=\s*True', call):
            out.add(m.group(1))
    return out


def ch_type(pg_type, udt, nullable, cast=True):
    if pg_type == 'ARRAY':
        if not cast:
            return 'Nullable(String)' if nullable else 'String'
        inner = PG2CH[{'_text': 'text', '_int4': 'integer', '_int8': 'bigint'}[udt]]
        return 'Array(%s)' % ('Nullable(%s)' % inner if nullable else inner)
    t = PG2CH[pg_type]
    return 'Nullable(%s)' % t if nullable else t


def pg_array_text(v):
    return '{' + ','.join('NULL' if x is None else str(x) for x in v) + '}'


def load(mode='nullable'):
    nullable = mode == 'nullable'
    pg = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gp'))
    cur = pg.cursor()
    S.query('CREATE DATABASE IF NOT EXISTS prod_proteus')
    cast_tables = array_cast_tables()
    for t, (order, _) in TABLES.items():
        cast = t in cast_tables
        cur.execute("select column_name, data_type, udt_name from information_schema.columns "
                    "where table_name = %s order by ordinal_position", (t,))
        cols = cur.fetchall()
        ddl = ', '.join('`%s` %s' % (c, ch_type(dtp, udt, nullable, cast)) for c, dtp, udt in cols)
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
                elif isinstance(v, list) and not cast:
                    v = pg_array_text(v)
                o[n] = v
            lines.append(json.dumps(o, ensure_ascii=False))
        if lines:
            S.query('INSERT INTO prod_proteus.%s FORMAT JSONEachRow\n%s' % (t, '\n'.join(lines)))
        n = S.query('SELECT count() FROM prod_proteus.%s' % t, 'CSV').bytes().decode().strip()
        print('%-20s %8s строк  %s%s' % (t, n, 'nullable' if nullable else 'plain',
                                          '' if cast or not any(d == 'ARRAY' for _, d, _ in cols) else ' · массивы строкой'))


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


def render(flt=None, user='a.sergeeva', always_true=False, path=DATASET, all_max=None, tr_all_max=None,
           tr_top=None, attr_top=True):
    """all_max — подменить порог «все уровни», tr_all_max — порог листового куба атрибутов
    (запасной режим «атрибут по запросу»), tr_top — сколько значений атрибута до строки '…'
    (стенд маленький: так проверяются режимы больших веток), attr_top=False — не читать
    свёртку атрибутов (только листовой куб: так свёртка сверяется с ним). По умолчанию — из
    окружения HH_ALL_MAX / HH_TR_ALL_MAX / HH_TR_TOP / HH_ATTR_TOP=0."""
    flt = flt or {}
    all_max = all_max or os.environ.get('HH_ALL_MAX')
    tr_all_max = tr_all_max or os.environ.get('HH_TR_ALL_MAX')
    tr_top = tr_top or os.environ.get('HH_TR_TOP')
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
    if all_max:
        text = text.replace('{% set ALL_MAX = 1000 %}', '{% set ALL_MAX = ' + str(int(all_max)) + ' %}')
    if tr_all_max:
        text = text.replace('{% set TR_ALL_MAX = 1000000 %}', '{% set TR_ALL_MAX = ' + str(int(tr_all_max)) + ' %}')
    if tr_top:
        text = text.replace('{% set TR_TOP = 30 %}', '{% set TR_TOP = ' + str(int(tr_top)) + ' %}')
    if not attr_top or os.environ.get('HH_ATTR_TOP') == '0':
        text = text.replace('{% set ANYCUT = [] %}', "{% set ANYCUT = ['-'] %}")
    return env.from_string(text).render(filter_values=filter_values, current_username=current_username)


def run(sql, settings=''):
    q = sql + ('\nSETTINGS ' + settings if settings else '')
    d = json.loads(S.query(q, 'JSON').bytes())
    return d['data'], d.get('statistics', {})


def dataset(flt=None, user='a.sergeeva', settings='', always_true=False, all_max=None, tr_all_max=None,
            tr_top=None, attr_top=True):
    return run(render(flt, user, always_true, all_max=all_max, tr_all_max=tr_all_max,
                      tr_top=tr_top, attr_top=attr_top), settings)


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
