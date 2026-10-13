"""Новая версия датасета отвечает так же, как старая? Ответ в ответ, по многим случаям.

    python3 stand/same.py <старый.sql> ['настройки ClickHouse']
    git show HEAD:proteus/hrbp-hub.data.sql > /tmp/old.sql && python3 stand/same.py /tmp/old.sql
    <venv chdb 2.1.1>/bin/python stand/same.py /tmp/old.sql 'allow_experimental_analyzer = 0, group_by_use_nulls = 1'
    USERS=a.sergeeva,b.kotov MODES_USERS=b.kotov … — меньше случаев (по умолчанию 6 логинов, режимы — у двух)

Для переписываний, которые не должны менять ответ (08.10: компоненты одним массивом, короткий SQL):
логины мира × юниты (до 12-го уровня, несколько, чужой) × разрезы (реальные значения из фасетов,
«Активная» — закрепляемость от active_hire_dt) × оси × глубина × запасные режимы (TR_ALL_MAX,
TR_TOP, без свёртки атрибутов). Сверяет порядок ролей и строки целиком (внутри роли — без порядка).
Новые колонки (добавлены, старые не тронуты) в сверку не идут — сверяются колонки старой версии.
Печатает первые расхождения; в конце — «случаев N, расхождений M».
"""
import itertools
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402

OLD = sys.argv[1]
SETTINGS = sys.argv[2] if len(sys.argv) > 2 else ''
USERS = os.environ.get('USERS', 'a.sergeeva,r.kazantsev,b.kotov,s.volkov,e.lapin,nobody').split(',')
MODES_USERS = os.environ.get('MODES_USERS', 'a.sergeeva,b.kotov').split(',')


def cases():
    rows, _ = ch.run(ch.render({}, 'a.sergeeva'))
    d = [r for r in rows if r['role'] == 'dict'][0]['j'].split('\n')
    lv = {ln.split('\t')[0]: int(ln.split('\t')[2]) for ln in d}
    deep = [i for i in lv if lv[i] >= 8][:2]
    mid = [i for i in lv if lv[i] == 4][:3]
    out = [
        {}, {'paint_f': ['Штат']}, {'hct_f': ['Активная']}, {'hct_f': ['Активная'], 'staff_f': ['Штат', 'Внештат']},
        {'it_f': ['IT']}, {'unit_f': mid[:1]}, {'unit_f': mid[:2]}, {'unit_f': deep[:1]},
        {'unit_f': mid[:1], 'paint_f': ['Штат']}, {'tr_f': ['city']}, {'tr_f': ['grade'], 'paint_f': ['Штат']},
        {'depth_f': ['all'], 'unit_f': mid[:1]}, {'depth_f': ['all']}, {'unit_f': ['нет-такого']},
    ]
    vals = {}
    for r in rows:
        if r['role'] == 'f':
            vals.setdefault(r['pid'], []).append(r['id'])
    for k in vals:
        out.append({k + '_f': vals[k][:1]})
        if len(vals[k]) > 1:
            out.append({k + '_f': vals[k][:2], 'unit_f': mid[1:2]})
    return out


def dropnew(r, a):
    if r.get('role') != 'meta':
        return r
    old = next((x for x in a if x.get('role') == 'meta'), None)
    if not old:
        return r
    try:
        jo, jn = json.loads(old['j']), json.loads(r['j'])
    except ValueError:
        return r
    if not set(jn) - set(jo):
        return r
    r = dict(r)
    r['j'] = json.dumps(dict((k, v) for k, v in jn.items() if k in jo), ensure_ascii=False, separators=(',', ':'))
    if r['j'] != old['j'] and json.loads(r['j']) == jo:
        r['j'] = old['j']
    return r


def main():
    modes = [dict(), dict(tr_all_max=5), dict(tr_top=2), dict(attr_top=False)]
    key = lambda r: (r['role'], r['id'], r['pid'], r['j'][:50])  # noqa: E731
    n = bad = 0
    for user in USERS:
        for flt in cases():
            for m in modes:
                if m and user not in MODES_USERS:
                    continue
                a, _ = ch.run(ch.render(flt, user, path=OLD, **m), SETTINGS)
                b, _ = ch.run(ch.render(flt, user, **m), SETTINGS)
                if a and b and set(b[0]) - set(a[0]):  # новые колонки (12.10: m_rgs …) — сверка по колонкам старой версии
                    b = [dict((c, r[c]) for c in a[0]) for r in b]
                b = [dropnew(r, a) for r in b]  # новые ключи meta (13.10: ytd) — сверка по ключам старой версии
                n += 1
                ra = [k for k, _ in itertools.groupby(r['role'] for r in a)]
                rb = [k for k, _ in itertools.groupby(r['role'] for r in b)]
                if ra != rb:
                    bad += 1
                    print('ПОРЯДОК РОЛЕЙ', user, json.dumps(flt, ensure_ascii=False), m, ra, rb)
                    continue
                sa, sb = sorted(a, key=key), sorted(b, key=key)
                if sa != sb:
                    bad += 1
                    print('РАЗНИЦА', user, json.dumps(flt, ensure_ascii=False), m, len(a), len(b))
                    for x, y in zip(sa, sb):
                        if x != y:
                            for c in x:
                                if x[c] != y.get(c):
                                    print('   ', x['role'], x['id'], c, repr(x[c])[:120], '|', repr(y.get(c))[:120])
                            break
                    if bad > 5:
                        break
    print('случаев %d, расхождений %d · ClickHouse %s · %s' % (n, bad, ch.VERSION, SETTINGS or 'настройки по умолчанию'))
    return bad


if __name__ == '__main__':
    sys.exit(1 if main() else 0)
