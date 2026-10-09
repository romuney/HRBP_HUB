"""Что Superset 2 (Proteus) делает с SQL датасета до ClickHouse — и сколько это стоит.

    <venv chdb 2.1.1 + sqlparse==0.4.4>/bin/python stand/superset.py [логин] ['{"staff_f": ["Штат"]}']
    … stand/superset.py --hostile [логин] [фильтры]   # враждебные значения в каждом носителе: путь = прямой
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
import re
import sys
import time

try:
    import sqlparse
except ImportError:
    sys.exit('нет sqlparse: pip install sqlparse==0.4.4 (в venv с chdb 2.1.1)')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402

# Патч лексера Superset 2.0.1 / 2.1.0 (superset/sql_parse.py): литерал '…' с '' и \\ внутри — одна строка.
# В бою (09.10) — Superset 2.1.0, sqlparse 0.4.3 + этот патч (insert(0)); на 0.4.4 тот же литерал ставят
# insert(25) через Lexer (как Superset 2.1.3) — так стенд в venv sp044. Без патча стенд видел бы текст не так, как бой.
_PATCH_RX = r"'(''|\\\\|\\|[^'])*'"


def lexer_patch():
    kw = sqlparse.keywords
    if hasattr(kw, 'FLAGS'):
        first = kw.SQL_REGEX[0][0]
        if getattr(getattr(first, '__self__', None), 'pattern', None) != _PATCH_RX:
            kw.SQL_REGEX.insert(0, (re.compile(_PATCH_RX, kw.FLAGS).match, sqlparse.tokens.String.Single))
        return
    lex = sqlparse.lexer.Lexer
    rx = kw.SQL_REGEX
    if not any(isinstance(r, str) and r == _PATCH_RX for r, _ in rx[:40]):
        rx.insert(25, (_PATCH_RX, sqlparse.tokens.String.Single))
        lex.get_default_instance().set_SQL_REGEX(rx)


lexer_patch()

# Враждебные значения (набор SP-11 гайда, kit/superset201.py HOSTILE_FULL): апостроф, «]», комментарии,
# слэш в конце, «;», управляющие, 3000 знаков. Тире chdb портит в тексте запроса — его здесь нет.
HOSTILE = ["O'Brien; x", 'a]b', 'x -- y', 'x // y', '# x', 'a\\', 'a;b', 'Отдел «Альфа» 1',
           '[a', 'x /* y', 'y */ z', '`b`', "O\\'K", 'a\tb\x01c', 'Ж' * 3000]
CARRIERS = ['unit_f', 'paint_f', 'it_f', 'stream_f', 'spec_f', 'staff_f', 'hct_f', 'tr_f']


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


def _sg_tokens(sql):
    import sqlglot
    return [(t.token_type, t.text) for t in sqlglot.tokenize(sql, read='clickhouse')]


def path_check(rendered, direct=None):
    """Путь Superset над рендером → None, если всё как надо, иначе текст ошибки: одна инструкция,
    strip_comments и reindent не трогают токенов (sqlglot), ответ ClickHouse после пути = прямому."""
    if direct is None:
        direct, _ = ch.run(rendered)
    cols = list(direct[0].keys()) if direct else ['role']
    try:
        final, _ = superset_steps(rendered, cols)
    except AssertionError as ex:
        return str(ex)
    try:
        import sqlglot  # noqa: F401
        sc = sqlparse.format(rendered.strip('\t\r\n; '), strip_comments=True)
        if _sg_tokens(sc) != _sg_tokens(rendered.strip('\t\r\n; ')):
            return 'strip_comments меняет токены'
        wrapped = 'SELECT %s \nFROM (%s) AS virtual_table \n LIMIT %d' % (', '.join(cols), sc, 50000)
        if _sg_tokens(final) != _sg_tokens(wrapped):
            return 'reindent меняет не только пробелы'
    except ImportError:
        pass
    except Exception as ex:  # noqa: BLE001 — sqlglot не разобрал текст после пути
        return 'sqlglot: %s' % str(ex).split('\n')[0][:200]
    try:
        via, _ = ch.run(final)
    except Exception as ex:  # noqa: BLE001
        return 'ClickHouse: %s' % str(ex).split('\n')[0][:200]
    key = lambda rs: sorted(json.dumps(r, sort_keys=True, ensure_ascii=False) for r in rs)  # noqa: E731
    return None if key(via) == key(direct) else 'ответ ДРУГОЙ'


def hostile_cases(base=None):
    """(подпись, фильтры): все хвосты разом в каждом носителе + каждый хвост отдельно в spec_f."""
    base = dict(base or {})
    out = []
    for c in CARRIERS:
        f = dict(base)
        f[c] = list(HOSTILE)
        out.append(('%s ← все %d хвостов' % (c, len(HOSTILE)), f))
    for h in HOSTILE:
        f = dict(base)
        f['spec_f'] = [h]
        out.append(('spec_f ← %r' % (h if len(h) < 40 else '%s × %d' % (h[0], len(h))), f))
    return out


def hostile_run(user='b.kotov', base=None, path=None):
    """→ [(подпись, None | ошибка)] по hostile_cases."""
    res = []
    for label, flt in hostile_cases(base):
        try:
            rendered = ch.render(flt, user, path=path or ch.DATASET)
            res.append((label, path_check(rendered)))
        except Exception as ex:  # noqa: BLE001
            res.append((label, 'рендер / прямой запуск: %s' % str(ex).split('\n')[0][:200]))
    return res


def main():
    if '--hostile' in sys.argv:
        args = [a for a in sys.argv[1:] if a != '--hostile']
        res = hostile_run(args[0] if args else 'b.kotov', json.loads(args[1]) if len(args) > 1 else {'staff_f': ['Штат']},
                          os.environ.get('HH_DATASET'))
        for label, err in res:
            print('%-4s %s%s' % ('ok' if err is None else 'FAIL', label, '' if err is None else ' — ' + err))
        bad = sum(1 for _, e in res if e)
        print('враждебный ввод через путь Superset: %d случаев, %d провалов' % (len(res), bad))
        sys.exit(1 if bad else 0)

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
