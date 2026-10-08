"""Что Superset 2 (Proteus) делает с SQL датасета до ClickHouse — и сколько это стоит.

    <venv chdb 2.1.1 + sqlparse==0.4.4>/bin/python stand/superset.py [логин] ['{"staff_f": ["Штат"]}']
    HH_DATASET=<другой .sql> … — то же для другой версии датасета (сравнить «было / стало»)

Повторяет шаги Superset 2.1 для виртуального датасета (superset/connectors/sqla/models.py):
  get_rendered_sql       — Jinja, sqlparse.format(strip_comments=True), sqlparse.split;
  get_from_clause        — ParsedQuery (sqlparse.parse) и is_select (ещё format + parse);
  get_query_str_extended — обёртка SELECT … FROM (датасет) AS virtual_table LIMIT N и
                           sqlparse.format(reindent=True): самое дорогое, растёт как скобки × токены;
  get_df                 — parse_sql (sqlparse.parse).
Логин в ключе кеша (current_username() внутри {{ }}) значит: get_sqla_query — рендер и разбор — идёт
и на расчёт ключа: на POST /chart/data, в воркере (ключ, потом запрос) и на каждом заборе qc-….
Печатает время шагов и итог на одно «Применить», затем выполняет в ClickHouse ровно то, что отправил
бы Superset (после reindent), и сверяет ответ с прямым запуском датасета.
Версия sqlparse — как в Superset 2.1 (0.4.3/0.4.4): `pip install sqlparse==0.4.4`.
"""
import json
import os
import sys
import time

try:
    import sqlparse
except ImportError:
    sys.exit('нет sqlparse: pip install sqlparse==0.4.4 (в venv с chdb 2.1.1)')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402


def tm(f, *a, **k):
    t = time.perf_counter()
    r = f(*a, **k)
    return r, time.perf_counter() - t


def superset_steps(rendered, cols, limit=50000):
    """→ (SQL, который уйдёт в ClickHouse; {шаг: секунды}) — как Superset 2.1."""
    st = {}
    sql, st['format(strip_comments)'] = tm(sqlparse.format, rendered.strip('\t\r\n; '), strip_comments=True)
    parts, st['split'] = tm(sqlparse.split, sql)
    assert len(parts) == 1, 'Superset: «Virtual dataset query cannot consist of multiple statements»'
    parsed, st['parse (ParsedQuery)'] = tm(sqlparse.parse, sql.strip(' \t\n;'))
    sc, st['format (is_select)'] = tm(sqlparse.format, sql.strip(' \t\n;'), strip_comments=True)
    p2, st['parse (is_select)'] = tm(sqlparse.parse, sc)
    assert p2[0].get_type() == 'SELECT', 'Superset: «Virtual dataset query must be read-only»'
    wrapped = 'SELECT %s \nFROM (%s) AS virtual_table \n LIMIT %d' % (', '.join(cols), sql, limit)
    final, st['format(reindent) обёртки'] = tm(sqlparse.format, wrapped, reindent=True)
    _, st['parse_sql (get_df)'] = tm(sqlparse.parse, final)
    return final, st


def main():
    user = sys.argv[1] if len(sys.argv) > 1 else 'b.kotov'
    flt = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    rendered, t_jinja = tm(ch.render, flt, user, path=os.environ.get('HH_DATASET') or ch.DATASET)
    direct, _ = ch.run(rendered)
    cols = list(direct[0].keys()) if direct else []
    final, st = superset_steps(rendered, cols)
    toks = sum(1 for _ in sqlparse.lexer.tokenize(rendered))
    print('%s %s: SQL %.1f КБ, токенов sqlparse %d, скобок %d, Jinja %.2f с' % (
        user, json.dumps(flt, ensure_ascii=False), len(rendered) / 1024, toks, rendered.count('('), t_jinja))
    for k, v in st.items():
        print('  %-28s %6.2f с' % (k, v))
    key = t_jinja + sum(v for k, v in st.items() if 'reindent' not in k and 'parse_sql' not in k)
    query = key + st['format(reindent) обёртки'] + st['parse_sql (get_df)']
    print('  разбор на ключ кеша          %6.2f с  (POST, воркер, каждый забор qc-…)' % key)
    print('  разбор на сам запрос         %6.2f с  (воркер)' % query)
    print('  итого на «Применить»         %6.2f с  + ClickHouse (POST + воркер: ключ и запрос + один забор qc-…)'
          % (key + key + query + key))
    via, stat = ch.run(final)
    same = sorted(json.dumps(r, sort_keys=True, ensure_ascii=False) for r in via) == \
        sorted(json.dumps(r, sort_keys=True, ensure_ascii=False) for r in direct)
    print('  ClickHouse после reindent: %d строк, %.2f с — %s' % (
        len(via), stat.get('elapsed', 0), 'ответ тот же' if same else 'ОТВЕТ ДРУГОЙ'))
    if not same:
        sys.exit(1)


if __name__ == '__main__':
    main()
