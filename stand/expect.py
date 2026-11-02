"""Независимый расчёт компонентов метрик по состоянию синтетического мира.

Не читает ни SQL, ни таблицы — только world.py. С ним сверяется результат всей
цепочки GP → ClickHouse → датасет: если где-то съехал слот, потерялся джойн или
окно захватило лишнее, числа разойдутся здесь.

Определения — ровно те, что зафиксированы в business-context.md и в параграфах:
  hc, jun    на конец слота, все типы численности (с 12.10; «Активная» — фильтром hct), без уволенных в этот
             день (16.10: company_fire_flg = 0); без выбранного
             типа — только юридическая численность (13.10: договор ГПХ — тип W.NONLEGAL)
  rg, nrg    увольнения за окно 12 мес / 52 нед, атрибуты на день увольнения
  rgs, nrgs  те же увольнения без окна (поток слота)
  hcw        знаменатель текучести — численность активной HQ (13.10): месяцы — на конец месяца, недели — Σ за 52
  nrd        знаменатель nr: те же увольнения с причиной или без (16.10)
  nr         месяцы — увольнения с начала года (недели — за 13 нед) без причины, legal_fire_dt не пуст, прошло 30+ дней
  hire       найм в компанию; при «Активной» — приход в активную: найм с типом «Активная» + переход кандидата +
             внутренний перевод (13.10); когорта закрепляемости при «Активной» — от него же
  r3*, r6*   месяцы (19.10) — когорта месяца найма, без окна: r3d — нанятые в месяце, r3n — те из них, кто работает
             через 3/6 мес от найма; только те, у кого срок уже прошёл (найм + 3/6 мес ≤ дата данных);
             недели — по слоту созревания (найм + 91/182 дня), окно 39/26 нед (13.10)
  hire, fire поток слота
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world as W  # noqa: E402

LM = W.D   # последний месяц отчёта — текущий, по дату данных (15.10: «метрики на вчера»)
YEAR = LM.year
LW = W.D - dt.timedelta(days=W.D.isoweekday() % 7)
WIN = {'m': {'rg': 12, 'nr': 3}, 'w': {'rg': 52, 'nr': 13, 'r3': 39, 'r6': 26}}


def slot(grain, idx):
    if grain == 'm':
        s = W.add_months(dt.date(YEAR - 1, 1, 1), idx)
        e = W.month_end(s)
        return s, (W.D if s <= W.D < e else e)
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
            'staff': 'Штат' if a['rel'] == 'Штатный сотрудник' else 'Не штат', 'hct': a['hct'] if W.is_legal(a) else W.NONLEGAL}


def passes(a, flt):
    c = cuts_of(a)
    if not flt.get('hct') and c['hct'] == W.NONLEGAL:   # без выбранного типа — только юридическая численность
        return False
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
    """Кэш: работающие на конец слота, любого типа численности: (атрибуты, юнит, множество rk пути, путь)."""
    key = (grain, i)
    if key not in _STOCK:
        e_ = slot(grain, i)[1]
        rows = []
        if e_ <= W.D:
            for emp in W.EMPS:
                st = W.state(emp, e_)
                if st is None or st[0].fire == e_:    # уволенный в день среза — не в численности (16.10)
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
            # приход в активную (13.10): найм с типом «Активная», переход кандидата (стажёр → активная), внутренний перевод
            if W.seg_at(p, p.hire)['hct'] == 'Активная':
                evs.append(('hire_a', p.hire))
            if p.active_hire and p.active_hire != p.hire and p.active_hire <= (p.fire or W.D) and p.active_hire <= W.D:
                evs.append(('hire_a', p.active_hire))
            for d in W.internal_transfers(e):
                if p.hire <= d <= (p.fire or W.D) and d not in (p.hire, p.active_hire):
                    evs.append(('hire_a', d))
            for kind, d in evs:
                a = W.seg_at(p, d)
                rp = rpath(a['unit'], d)
                out.append((kind, d, e, p, a, frozenset(rp), rp))
    return out


EVENTS = events()


def component_series(grain, pred, flt, active_base=False):
    """→ {компонент: [24 значения]} для области pred(unit, date) и фильтров flt."""
    lo = -11 if grain == 'm' else -51
    raw = {k: {i: 0 for i in range(lo, 24)} for k in ('hc', 'jun', 'hch', 'fire', 'rg', 'nrg', 'nr', 'nrd', 'hire', 'r3n', 'r3d', 'r6n', 'r6d')}
    for i in range(lo, 24):
        for a, unit, pth, rp in stock(grain, i):
            if not passes(a, flt) or not pred(unit, pth, rp):
                continue
            raw['hc'][i] += 1
            raw['jun'][i] += int(W.is_junior(a['sen']))
            c = cuts_of(a)
            raw['hch'][i] += int(c['hct'] == 'Активная' and c['paint'] == 'HQ')
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
            raw['nrd'][i] += int((not p.legal_fire_null) and d <= W.D - dt.timedelta(days=30))   # знаменатель nr (16.10)
        if kind == ('hire_a' if active_base else 'hire_c'):
            i = slot_of(grain, d)
            if i is not None:
                raw['hire'][i] += 1
        if kind == ('hire_a' if active_base else 'hire_c'):
            for hz, (mons, dys) in ((3, (3, 91)), (6, (6, 182))):
                md = W.add_months(d, mons) if grain == 'm' else d + dt.timedelta(days=dys)
                if md > W.D:
                    continue
                if grain == 'm':   # 19.10: слот месяца найма (у кого срок прошёл; созревший ли месяц — решает чарт)
                    i = slot_of(grain, d)
                else:
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
    # знаменатель текучести — активная HQ (13.10): месяцы — на конец месяца, недели — Σ за 52 нед
    out['hcw'] = [raw['hch'][i] for i in range(24)] if grain == 'm' else [sum(raw['hch'][j] for j in range(i - win['rg'] + 1, i + 1)) for i in range(24)]
    out['rgs'] = [raw['rg'][i] for i in range(24)]      # без окна — для текучести с начала года (12.10)
    out['nrgs'] = [raw['nrg'][i] for i in range(24)]
    if grain == 'm':   # с начала года (13.10): с января того же года — блоки idx 0…11 и 12…23
        for k in ('nr', 'nrd'):
            out[k] = [sum(raw[k][j] for j in range(i - i % 12, i + 1)) for i in range(24)]
    else:
        for k in ('nr', 'nrd'):
            out[k] = [sum(raw[k][j] for j in range(i - win['nr'] + 1, i + 1)) for i in range(24)]
    for k in ('r3n', 'r3d', 'r6n', 'r6d'):
        if grain == 'm':   # 19.10: когорта месяца найма — без окна
            out[k] = [raw[k][i] for i in range(24)]
        else:
            out[k] = [sum(raw[k][j] for j in range(max(i - win[k[:2]] + 1, lo), i + 1)) for i in range(24)]
    return out
