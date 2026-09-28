"""Независимый расчёт компонентов метрик по состоянию синтетического мира.

Не читает ни SQL, ни таблицы — только world.py. С ним сверяется результат всей
цепочки GP → ClickHouse → датасет: если где-то съехал слот, потерялся джойн или
окно захватило лишнее, числа разойдутся здесь.

Определения — ровно те, что зафиксированы в business-context.md и в параграфах:
  hc, jun    на конец слота, active_employee_flg = 1 (все, кроме «Декрет»)
  rg, nrg    увольнения за окно 12 мес / 52 нед, атрибуты на день увольнения
  hcw        Σ hc за то же окно
  nr         увольнения за 3 мес / 13 нед без причины, legal_fire_dt не пуст, прошло 30+ дней
  r3*, r6*   новички, созревшие (найм + 3/6 мес или + 91/182 дня) в окне 3 мес / 13 нед
  hire, fire поток слота
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world as W  # noqa: E402

LM = W.month_end(W.D) if W.D == W.month_end(W.D) else W.month_end(W.D.replace(day=1) - dt.timedelta(days=1))
YEAR = LM.year
LW = W.D - dt.timedelta(days=W.D.isoweekday() % 7)
WIN = {'m': {'rg': 12, 'nr': 3, 'ret': 3}, 'w': {'rg': 52, 'nr': 13, 'ret': 13}}


def slot(grain, idx):
    if grain == 'm':
        s = W.add_months(dt.date(YEAR - 1, 1, 1), idx)
        return s, W.month_end(s)
    e = LW - dt.timedelta(days=(23 - idx) * 7)
    return e - dt.timedelta(days=6), e


def slot_of(grain, d):
    lo = -11 if grain == 'm' else -51
    for i in range(lo, 24):
        s, e = slot(grain, i)
        if s <= d <= e:
            return i
    return None


def closed(grain, idx):
    return slot(grain, idx)[1] <= W.D


CUT_KEYS = {'paint': 'paint', 'it': 'it', 'stream': 'stream', 'spec': 'spec', 'hct': 'hct'}


def cuts_of(a):
    return {'paint': a['paint'], 'it': a['it'], 'stream': a['stream'], 'spec': a['spec'],
            'staff': 'Штат' if a['rel'] == 'Штатный сотрудник' else 'Не штат', 'hct': a['hct']}


def passes(a, flt):
    c = cuts_of(a)
    return all(not v or c[k] in v for k, v in flt.items())


def under(*sets):
    """Предикат области: путь юнита на дату пересекается с КАЖДЫМ из множеств rk."""
    return lambda unit, pth, rp: all(pth & s for s in sets)


def direct(rk):
    """Сотрудник сидит прямо в юните rk отчёта: последний узел пути отчёта — rk
    (люди lvl13 — прямо в своём юните lvl12, люди lvl2 — прямо в компании)."""
    return lambda unit, pth, rp: bool(rp) and rp[-1] == rk


def child_of(parent_rk, child_rk):
    """В пути отчёта сразу за parent_rk идёт child_rk; child_rk = None — parent_rk
    последний в пути (сотрудник прямо в нём). Строки «раскрытия» x датасета."""
    def f(unit, pth, rp):
        if parent_rk not in pth:
            return False
        i = rp.index(parent_rk)
        return (rp[i + 1] if i + 1 < len(rp) else None) == child_rk
    return f


_STOCK = {}


def rpath(unit, d):
    """Путь юнита в отчёте на дату: кортеж rk от компании вниз (lvl1, lvl3…lvl12)."""
    return tuple(W.path_rks(unit, d))


def stock(grain, i):
    """Кэш: работающие на конец слота (кроме «Декрет»): (атрибуты, юнит, множество rk пути, путь)."""
    key = (grain, i)
    if key not in _STOCK:
        e_ = slot(grain, i)[1]
        rows = []
        if e_ <= W.D:
            for emp in W.EMPS:
                st = W.state(emp, e_)
                if st is None or st[1]['hct'] == 'Декрет':
                    continue
                a = st[1]
                rp = rpath(a['unit'], e_)
                rows.append((a, a['unit'], frozenset(rp), rp))
        _STOCK[key] = rows
    return _STOCK[key]


def events():
    """Список событий мира: (тип, дата, сотрудник, период, атрибуты на дату, путь на дату)."""
    out = []
    for e in W.EMPS:
        for p in e.periods:
            evs = [('hire_c', p.hire)]
            if p.fire:
                evs.append(('fire', p.fire))
            if p.active_hire and p.active_hire <= (p.fire or W.D) and p.active_hire <= W.D:
                evs.append(('hire_a', p.active_hire))
            for kind, d in evs:
                a = W.seg_at(p, d)
                rp = rpath(a['unit'], d)
                out.append((kind, d, e, p, a, frozenset(rp), rp))
    return out


EVENTS = events()


def component_series(grain, pred, flt, active_base=False):
    """→ {компонент: [24 значения]} для области pred(unit, date) и фильтров flt."""
    lo = -11 if grain == 'm' else -51
    raw = {k: {i: 0 for i in range(lo, 24)} for k in ('hc', 'jun', 'fire', 'rg', 'nrg', 'nr', 'hire', 'r3n', 'r3d', 'r6n', 'r6d')}
    for i in range(lo, 24):
        for a, unit, pth, rp in stock(grain, i):
            if not passes(a, flt) or not pred(unit, pth, rp):
                continue
            raw['hc'][i] += 1
            raw['jun'][i] += int(W.is_junior(a['sen']))
    for kind, d, emp, p, a, pth, rp in EVENTS:
        if not passes(a, flt) or not pred(a['unit'], pth, rp):
            continue
        if kind == 'fire':
            i = slot_of(grain, d)
            if i is None:
                continue
            raw['fire'][i] += 1
            raw['rg'][i] += int(p.regret == 1)
            raw['nrg'][i] += int(p.regret == 2)
            raw['nr'][i] += int((not p.legal_fire_null) and p.reason != 'filled' and d <= W.D - dt.timedelta(days=30))
        if kind == 'hire_c':
            i = slot_of(grain, d)
            if i is not None:
                raw['hire'][i] += 1
        if kind == ('hire_a' if active_base else 'hire_c'):
            for hz, (mons, dys) in ((3, (3, 91)), (6, (6, 182))):
                md = W.add_months(d, mons) if grain == 'm' else d + dt.timedelta(days=dys)
                if md > W.D:
                    continue
                i = slot_of(grain, md)
                if i is None:
                    continue
                raw['r%dd' % hz][i] += 1
                raw['r%dn' % hz][i] += int(p.fire is None or p.fire >= md)
    win = WIN[grain]
    out = {}
    for k in ('hc', 'jun', 'hire', 'fire'):
        out[k] = [raw[k][i] for i in range(24)]
    out['rg'] = [sum(raw['rg'][j] for j in range(i - win['rg'] + 1, i + 1)) for i in range(24)]
    out['nrg'] = [sum(raw['nrg'][j] for j in range(i - win['rg'] + 1, i + 1)) for i in range(24)]
    out['hcw'] = [sum(raw['hc'][j] for j in range(i - win['rg'] + 1, i + 1)) for i in range(24)]
    out['nr'] = [sum(raw['nr'][j] for j in range(i - win['nr'] + 1, i + 1)) for i in range(24)]
    for k in ('r3n', 'r3d', 'r6n', 'r6d'):
        out[k] = [sum(raw[k][j] for j in range(max(i - win['ret'] + 1, lo), i + 1)) for i in range(24)]
    return out
