"""Синтетический мир HRBP HUB: оргструктура, сотрудники, события.

Один источник правды для двух вещей сразу:
  1) таблицы-источники GP той же схемы, что в бою (gen_sources.py кладёт их
     в PostgreSQL, и параграфы ноута исполняются над ними как над боевыми);
  2) независимый расчёт метрик прямо по состоянию мира (expect.py) — с ним
     сверяется всё, что насчитали GP → ClickHouse → датасет.

Мир детерминирован (seed), поэтому любое расхождение воспроизводится.
Нарочно заложены случаи, на которых ломаются витрины: переводы между юнитами,
реорганизация (управление переезжает в другой департамент), расформированный
отдел, новый отдел, переименование, повторный найм, стажёры, декрет,
увольнения без причины, увольнения в последние 30 дней, сотрудники прямо
в юните верхнего уровня, rk листа ≠ mapped rk.

Уровни — как в mapped-структуре боевой базы (ультраширокая): lvl1 — компания,
lvl2 — юрлицо-группировка (отчёт его пропускает), lvl3 — блоки, дальше до lvl13.
Одна ветка уходит вглубь до lvl13: отчёт берёт уровни до 12-го, сотрудники
lvl13 считаются прямо в своём юните 12-го уровня. Есть люди прямо в lvl1 и lvl2.
"""
import datetime as dt
import hashlib
import random

D = dt.date(2026, 9, 27)          # последний день данных (воскресенье)
START = dt.date(2023, 1, 1)       # начало истории в синтетике
SUPER_UNIT_RK = '50eb70d6df69372ceb7f354df8e8aa53'
JUN_PATTERNS = ('intern', 'jun')  # ILIKE 'intern%' / 'jun%'

R = random.Random(20260928)


def rk_of(key):
    return hashlib.md5(('unit:' + key).encode()).hexdigest()


def month_end(d):
    n = dt.date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return n - dt.timedelta(days=1)


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    y += d.year
    m += 1
    last = month_end(dt.date(y, m, 1)).day
    return dt.date(y, m, min(d.day, last))


# ---------------------------------------------------------------- оргструктура
class Unit:
    def __init__(self, key, name, parent, level):
        self.key = key
        self.rk = rk_of(key)
        self.names = [(dt.date(2000, 1, 1), name)]       # (с даты, имя)
        self.parents = [(dt.date(2000, 1, 1), parent)]   # (с даты, родитель-Unit|None)
        self.level = level
        self.valid_from = dt.date(2000, 1, 1)
        self.valid_to = dt.date(5999, 1, 1)
        self.head = None                                 # сотрудник-руководитель
        self.raw_rk = self.rk                            # management_unit_rk (сырой)

    def name_at(self, d):
        nm = self.names[0][1]
        for f, n in self.names:
            if f <= d:
                nm = n
        return nm

    def parent_at(self, d):
        p = self.parents[0][1]
        for f, x in self.parents:
            if f <= d:
                p = x
        return p

    def chain_at(self, d):
        out, u = [], self
        while u is not None:
            out.append(u)
            u = u.parent_at(d)
        return out[::-1]


UNITS = []


def mk(key, name, parent, level):
    u = Unit(key, name, parent, level)
    UNITS.append(u)
    return u


ROOT = mk('root', 'ТБанк', None, 1)
TREE = {
    'Технологии': {
        'Департамент платформ': {'Управление платформ данных': ['Отдел хранилищ', 'Отдел потоков'],
                                 'Управление облака': ['Отдел вычислений', 'Отдел сетей', 'Отдел ручного тестирования']},
        'Департамент данных': {'Управление аналитики': ['Отдел продуктовой аналитики', 'Отдел BI'],
                               'Управление ML': ['Отдел рекомендаций', 'Отдел скоринга']},
        'Департамент разработки': {'Управление мобильной разработки': ['Отдел iOS', 'Отдел Android'],
                                   'Управление веб-разработки': ['Отдел фронтенда', 'Отдел бэкенда', 'Отдел тестирования']},
    },
    'Розничный бизнес': {
        'Департамент карт': {'Управление дебетовых карт': ['Отдел продукта карт', 'Отдел маркетинга карт'],
                             'Управление кредитных карт': ['Отдел кредитного продукта', 'Отдел рисков карт']},
        'Департамент вкладов': {'Управление сбережений': ['Отдел вкладов', 'Отдел инвестиций']},
    },
    'Операции': {
        'Департамент процессинга': {'Управление расчётов': ['Отдел клиринга', 'Отдел сверки'],
                                    'Управление платежей': ['Отдел переводов']},
        'Департамент бэк-офиса': {'Управление документооборота': ['Отдел архива', 'Отдел верификации']},
    },
    'Клиентский сервис': {
        'Департамент поддержки': {'Управление первой линии': ['Отдел поддержки 1', 'Отдел поддержки 2', 'Отдел поддержки 3'],
                                  'Управление второй линии': ['Отдел экспертов', 'Отдел претензий']},
        'Департамент качества': {'Управление контроля качества': ['Отдел оценки звонков']},
    },
    'Корпоративные функции': {
        'Департамент HR': {'HR-партнёры': [], 'Управление подбора': ['Отдел IT-рекрутинга', 'Отдел массового подбора']},
        'Департамент финансов': {'Управление отчётности': ['Отдел МСФО', 'Отдел налогов']},
    },
}
BLOCK = {}      # key юнита -> блок (уровень 3)
LEAVES = []
BY_NAME = {}
# lvl2 — группировки над блоками: в отчёте их нет, блоки встают прямо под компанию
L2 = {'Технологии': mk('lvl2-tech', 'ТБанк · Технологии', ROOT, 2)}
L2_BANK = mk('lvl2-bank', 'ТБанк · Банк', ROOT, 2)
BY_NAME['ТБанк · Технологии'] = L2['Технологии']
BY_NAME['ТБанк · Банк'] = L2_BANK
for bname, deps in TREE.items():
    b = mk(bname, bname, L2.get(bname, L2_BANK), 3)
    BLOCK[b.key] = bname
    BY_NAME[bname] = b
    for dname, uprs in deps.items():
        d = mk(dname, dname, b, 4)
        BY_NAME[dname] = d
        for uname, otds in uprs.items():
            key = uname
            u = mk(key, uname, d, 5)
            if uname == 'HR-партнёры':
                u.rk = SUPER_UNIT_RK
                u.raw_rk = SUPER_UNIT_RK
            BY_NAME[uname] = u
            if not otds:
                LEAVES.append(u)
            for oname in otds:
                o = mk(oname, oname, u, 6)
                BY_NAME[oname] = o
                LEAVES.append(o)
                # у части отделов есть группы седьмого уровня
                if oname in ('Отдел бэкенда', 'Отдел поддержки 1', 'Отдел скоринга'):
                    for gi in (1, 2):
                        g = mk(oname + ' / группа ' + str(gi), 'Группа ' + str(gi) + ' · ' + oname.replace('Отдел ', ''), o, 7)
                        BY_NAME[g.key] = g
                        LEAVES.append(g)
# глубокая ветка: от группы бэкенда вниз до lvl13 (как самые мелкие юниты в бою)
DEEP = []
_par = BY_NAME['Отдел бэкенда / группа 1']
for lv, nm in ((8, 'Команда платёжного API'), (9, 'Подкоманда шлюзов'), (10, 'Звено шлюзов A'),
               (11, 'Подзвено A1'), (12, 'Ячейка A1-1'), (13, 'Микроячейка A1-1-a')):
    _par = mk(nm, nm, _par, lv)
    BY_NAME[nm] = _par
    DEEP.append(_par)
    LEAVES.append(_par)

# реорганизация: управление платформ данных переезжает в департамент данных
BY_NAME['Управление платформ данных'].parents.append((dt.date(2025, 10, 1), BY_NAME['Департамент данных']))
# расформирован отдел ручного тестирования (люди уходят в «Отдел вычислений»)
BY_NAME['Отдел ручного тестирования'].valid_to = dt.date(2025, 6, 30)
# новый отдел с 2026-02-01
NEW = mk('Отдел ИИ-ассистентов', 'Отдел ИИ-ассистентов', BY_NAME['Управление ML'], 6)
NEW.valid_from = dt.date(2026, 2, 1)
BY_NAME[NEW.key] = NEW
LEAVES.append(NEW)
# переименование
BY_NAME['Отдел поддержки 1'].names.append((dt.date(2026, 1, 1), 'Отдел поддержки VIP'))
# сырой rk ≠ mapped rk у двух отделов
BY_NAME['Отдел архива'].raw_rk = hashlib.md5(b'raw-archive').hexdigest()
BY_NAME['Отдел МСФО'].raw_rk = hashlib.md5(b'raw-ifrs').hexdigest()

# листья, в которые люди приходят (часть — середина дерева: руководители и штаб)
MID = [u for u in UNITS if u.level in (4, 5) and u not in LEAVES]


def leaf_alive(u, d):
    return u.valid_from <= d <= u.valid_to


# ---------------------------------------------------------------- справочники атрибутов
BLOCK_PROFILE = {
    'Технологии': dict(paint=[('HQ', .9), ('Support', .1)], it=[('IT', .95), ('nonIT', .05)],
                       spec=[('Разработка', .45), ('Аналитика', .15), ('Тестирование', .15), ('Инфраструктура', .15), ('Продукт', .1)]),
    'Розничный бизнес': dict(paint=[('HQ', .8), ('Line', .2)], it=[('IT', .3), ('nonIT', .7)],
                             spec=[('Продукт', .35), ('Аналитика', .25), ('Маркетинг', .25), ('Разработка', .15)]),
    'Операции': dict(paint=[('Support', .6), ('Line', .4)], it=[('nonIT', .9), ('IT', .1)],
                     spec=[('Операционная деятельность', .7), ('Аналитика', .15), ('Поддержка', .15)]),
    'Клиентский сервис': dict(paint=[('Line', .9), ('Support', .1)], it=[('nonIT', 1.0)],
                              spec=[('Поддержка', .85), ('Аналитика', .05), ('Операционная деятельность', .1)]),
    'Корпоративные функции': dict(paint=[('Support', 1.0)], it=[('nonIT', .95), ('IT', .05)],
                                  spec=[('HR', .55), ('Финансы', .35), ('Аналитика', .1)]),
}
STREAM_OF_SPEC = {'Разработка': 'Платформа', 'Инфраструктура': 'Платформа', 'Тестирование': 'Платформа',
                  'Аналитика': 'Данные', 'Продукт': 'Продукт', 'Маркетинг': 'Продукт',
                  'Операционная деятельность': 'Операции', 'Поддержка': 'Сопровождение',
                  'HR': 'Корпоративные', 'Финансы': 'Корпоративные'}
SENIORITY = [('Intern', .03), ('Junior', .14), ('Junior+', .1), ('Middle', .3), ('Middle+', .15), ('Senior', .2), ('Lead', .08)]
RELATION = [('Штатный сотрудник', .9), ('Внешний совместитель', .04), ('Договор ГПХ', .06)]
OFFICES = [('Москва, Головной офис', .45), ('Санкт-Петербург', .12), ('Екатеринбург', .1), ('Новосибирск', .08),
           ('Казань', .08), ('Удалённо', .17)]
CITY = {'Москва, Головной офис': ('Москва', 'Москва', 'Центральный'), 'Санкт-Петербург': ('Санкт-Петербург', 'Санкт-Петербург', 'Северо-Западный'),
        'Екатеринбург': ('Екатеринбург', 'Свердловская область', 'Уральский'), 'Новосибирск': ('Новосибирск', 'Новосибирская область', 'Сибирский'),
        'Казань': ('Казань', 'Республика Татарстан', 'Приволжский'), 'Удалённо': ('Воронеж', 'Воронежская область', 'Центральный')}
LEGAL = [('АО «ТБанк»', .8), ('ООО «ТТех»', .2)]


def pick(opts):
    x, acc = R.random(), 0.0
    for v, p in opts:
        acc += p
        if x <= acc:
            return v
    return opts[-1][0]


# ---------------------------------------------------------------- сотрудники
class Period:
    def __init__(self, hire):
        self.hire = hire
        self.fire = None
        self.segs = []            # [from, to|None, attrs]
        self.lp = None            # legal_position_rk
        self.active_hire = hire   # дата перехода в «Активную»
        self.legal_fire_null = False
        self.reason = 'filled'    # filled | null | missing
        self.regret = 0           # 1 regrettable, 2 non-regrettable, 0 прочее


class Emp:
    def __init__(self, rk):
        self.rk = rk
        self.periods = []
        self.gender = 'Женщина' if R.random() < .45 else 'Мужчина'
        self.birth = dt.date(1965, 1, 1) + dt.timedelta(days=R.randrange(0, 365 * 38))
        self.last = R.choice(['Иванов', 'Смирнов', 'Кузнецов', 'Попов', 'Васильев', 'Петров', 'Соколов', 'Михайлов',
                              'Новиков', 'Фёдоров', 'Морозов', 'Волков', 'Алексеев', 'Лебедев', 'Семёнов', 'Егоров'])
        if self.gender == 'Женщина':
            self.last += 'а'
        self.first = R.choice(['Анна', 'Мария', 'Елена', 'Ольга', 'Ирина']) if self.gender == 'Женщина' \
            else R.choice(['Алексей', 'Дмитрий', 'Сергей', 'Андрей', 'Павел'])
        self.login = ('u' + str(rk))
        self.office = pick(OFFICES)


EMPS = []
_next = [100001]


def new_emp():
    e = Emp(_next[0])
    _next[0] += 1
    EMPS.append(e)
    return e


def block_of(u, d):
    for x in u.chain_at(d):
        if x.level == 3:
            return x.key
    return None


def fresh_attrs(unit, d, intern=False):
    prof = BLOCK_PROFILE[BLOCK.get(block_of(unit, d), 'Технологии')]
    spec = pick(prof['spec'])
    sen = 'Intern' if intern else pick(SENIORITY[1:])
    return dict(unit=unit, paint=pick(prof['paint']), it=pick(prof['it']), spec=spec,
                stream=STREAM_OF_SPEC[spec], rel=pick(RELATION), hct='Стажеры' if intern else 'Активная',
                sen=sen, grade=(6 if intern else R.randint(8, 19)), contract=R.choice(['Офис', 'Офис', 'Гибрид', 'Дистанционный']),
                head=0, legal=pick(LEGAL))


def live_leaves(d, block=None):
    out = [u for u in LEAVES if leaf_alive(u, d)]
    if block:
        out = [u for u in out if block_of(u, d) == block]
    return out


def start_period(e, hire, intern=False, unit=None):
    p = Period(hire)
    p.lp = 'LP' + str(e.rk) + '_' + str(len(e.periods))
    unit = unit or R.choice(live_leaves(hire) + MID[:6] if R.random() < .06 else live_leaves(hire))
    a = fresh_attrs(unit, hire, intern)
    p.segs.append([hire, None, a])
    if intern:
        p.active_hire = add_months(hire, R.randint(2, 4))
    e.periods.append(p)
    return p


def change(p, d, **kw):
    cur = p.segs[-1]
    if cur[0] >= d:
        cur[2] = dict(cur[2], **kw)
        return
    cur[1] = d - dt.timedelta(days=1)
    p.segs.append([d, None, dict(cur[2], **kw)])


def month_starts(a, b):
    d = dt.date(a.year, a.month, 1)
    while d <= b:
        yield d
        d = add_months(d, 1)


# стартовое население
for _ in range(1150):
    e = new_emp()
    hire = dt.date(2014, 1, 1) + dt.timedelta(days=R.randrange(0, 365 * 9))
    start_period(e, hire)
# верхушка: прямо в компании (lvl1) и в группировках lvl2 — в отчёте «напрямую в компании»
for _u, _n in ((ROOT, 2), (L2_BANK, 4), (L2['Технологии'], 3)):
    for _ in range(_n):
        e = new_emp()
        start_period(e, dt.date(2015, 1, 1) + dt.timedelta(days=R.randrange(0, 365 * 6)), unit=_u)

# помесячная жизнь
for ms in month_starts(START, D):
    me = min(month_end(ms), D)
    days = (me - ms).days + 1
    # найм
    for _ in range(R.randint(26, 44)):
        hire = ms + dt.timedelta(days=R.randrange(days))
        intern = R.random() < .14
        rehire_pool = [x for x in EMPS if x.periods and x.periods[-1].fire and x.periods[-1].fire < hire - dt.timedelta(days=60)]
        if rehire_pool and R.random() < .04:
            e = R.choice(rehire_pool)
        else:
            e = new_emp()
        start_period(e, hire, intern)
    for e in EMPS:
        p = e.periods[-1] if e.periods else None
        if p is None or p.fire is not None or p.hire > me:
            continue
        a = p.segs[-1][2]
        tenure_m = (ms.year - p.hire.year) * 12 + ms.month - p.hire.month
        hazard = .032 if tenure_m < 7 else .013
        if R.random() < hazard:
            fd = ms + dt.timedelta(days=R.randrange(days))
            if fd <= p.hire:
                continue
            p.fire = fd
            x = R.random()
            p.regret = 1 if x < .3 else (2 if x < .75 else 0)
            y = R.random()
            p.reason = 'filled' if y < .8 else ('null' if y < .9 else 'missing')
            if (D - fd).days < 45 and R.random() < .6:
                p.reason = 'missing'
            p.legal_fire_null = R.random() < .02
            if p.segs[-1][0] > fd:
                p.segs = [s for s in p.segs if s[0] <= fd]
            p.segs[-1][1] = None
            continue
        # переходы: стажёр -> активная
        if a['hct'] == 'Стажеры' and p.active_hire and ms <= p.active_hire <= me:
            change(p, p.active_hire, hct='Активная', sen='Junior')
            a = p.segs[-1][2]
        # декрет и выход из него
        if a['hct'] == 'Активная' and e.gender == 'Женщина' and R.random() < .003:
            d0 = ms + dt.timedelta(days=R.randrange(days))
            change(p, d0, hct='Декрет')
            continue
        if a['hct'] == 'Декрет' and R.random() < .12:
            change(p, ms + dt.timedelta(days=R.randrange(days)), hct='Активная')
            continue
        if a['hct'] == 'Активная' and R.random() < .0015:
            change(p, ms + dt.timedelta(days=R.randrange(days)), hct='Прогульщики')
            continue
        if a['hct'] == 'Прогульщики' and R.random() < .6:
            change(p, ms + dt.timedelta(days=R.randrange(days)), hct='Активная')
            continue
        # перевод в другой юнит своего блока
        if R.random() < .008:
            d0 = ms + dt.timedelta(days=R.randrange(days))
            blk = block_of(a['unit'], d0)
            cands = [u for u in live_leaves(d0, blk) if u is not a['unit']]
            if cands:
                change(p, d0, unit=R.choice(cands))
                continue
        # смена специализации
        if R.random() < .003:
            prof = BLOCK_PROFILE[BLOCK.get(block_of(a['unit'], ms), 'Технологии')]
            sp = pick(prof['spec'])
            change(p, ms + dt.timedelta(days=R.randrange(days)), spec=sp, stream=STREAM_OF_SPEC[sp])
            continue
        # рост грейда/сеньорности раз в год
        if ms.month == 4 and R.random() < .25 and a['hct'] == 'Активная':
            order = [s for s, _ in SENIORITY]
            i = order.index(a['sen']) if a['sen'] in order else 3
            change(p, ms, sen=order[min(i + 1, len(order) - 1)], grade=min(a['grade'] + 1, 22))

# расформированный отдел: все, кто там на 2025-07-01, переводятся в «Отдел вычислений»
DISS, TARGET = BY_NAME['Отдел ручного тестирования'], BY_NAME['Отдел вычислений']
for e in EMPS:
    for p in e.periods:
        for s in list(p.segs):
            if s[2]['unit'] is DISS:
                d_cut = dt.date(2025, 7, 1)
                if s[0] >= d_cut:
                    s[2] = dict(s[2], unit=TARGET)
                elif (s[1] is None or s[1] >= d_cut) and (p.fire is None or p.fire >= d_cut):
                    idx = p.segs.index(s)
                    nxt = [d_cut, s[1], dict(s[2], unit=TARGET)]
                    s[1] = d_cut - dt.timedelta(days=1)
                    p.segs.insert(idx + 1, nxt)

# руководители: первый по времени живой сотрудник юнита становится его головой (для цепочки руководителей)
for u in UNITS:
    for e in EMPS:
        p = e.periods[0]
        if p.segs[0][2]['unit'] is u and p.fire is None:
            u.head = e
            break

# HRBP: сотрудники юнита «HR-партнёры»
HRBP_UNIT = BY_NAME['HR-партнёры']
HRBPS = []
names = [('Сергеева', 'Анна', 'a.sergeeva'), ('Волков', 'Сергей', 's.volkov'), ('Зайцева', 'Марина', 'm.zaytseva'),
         ('Котов', 'Борис', 'b.kotov'), ('Белова', 'Нина', 'n.belova'), ('Гусев', 'Олег', 'o.gusev'),
         ('Рыжов', 'Павел', 'p.ryzhov'), ('Лосева', 'Рита', 'r.loseva'), ('Орлова', 'Дина', 'd.orlova'),
         ('Лапин', 'Егор', 'e.lapin'), ('Юдина', 'Галина', 'g.yudina')]
for ln, fn, lg in names:
    e = new_emp()
    e.last, e.first, e.login = ln, fn, lg
    e.gender = 'Женщина' if ln.endswith('а') else 'Мужчина'
    p = start_period(e, dt.date(2019, 3, 1), unit=HRBP_UNIT)
    p.segs[0][2].update(paint='Support', it='nonIT', spec='HR', stream='Корпоративные', rel='Штатный сотрудник',
                        hct='Активная', sen='Senior', head=0)
    HRBPS.append(e)
LEAD = HRBPS[0]           # супер-HRBP: сидит в HR-партнёрах, над ней HRBP нет
HRBP_UNIT.head = LEAD
# зоны: департамент (lvl4) -> HRBP; у пары управлений (lvl5) — «младший» HRBP внутри зоны старшего
ZONE3 = {'Департамент платформ': HRBPS[1], 'Департамент данных': HRBPS[1], 'Департамент разработки': HRBPS[2],
         'Департамент карт': HRBPS[3], 'Департамент вкладов': HRBPS[3], 'Департамент процессинга': HRBPS[4],
         'Департамент бэк-офиса': HRBPS[4], 'Департамент поддержки': HRBPS[5], 'Департамент качества': HRBPS[6],
         'Департамент HR': LEAD, 'Департамент финансов': HRBPS[7]}
ZONE4 = {'Управление ML': HRBPS[8], 'Управление веб-разработки': HRBPS[9], 'Управление первой линии': HRBPS[10]}


def hrbp_at(unit, d):
    ch = unit.chain_at(d)
    h = None
    for u in ch:
        if u.key in ZONE3:
            h = ZONE3[u.key]
        if u.key in ZONE4:
            h = ZONE4[u.key]
    return h


# ---------------------------------------------------------------- доступ к состоянию
def period_at(e, d):
    for p in e.periods:
        end = p.fire or D
        if p.hire <= d <= end:
            return p
    return None


def seg_at(p, d):
    for s in p.segs:
        if s[0] <= d and (s[1] is None or d <= s[1]):
            return s[2]
    return p.segs[-1][2]


def state(e, d):
    """Состояние сотрудника на дату: None — не работает."""
    p = period_at(e, d)
    if p is None:
        return None
    a = seg_at(p, d)
    return p, a


# Уровни, которые берёт отчёт: компания (lvl1) и lvl3…lvl12 — как в ультраширокой.
REPORT_LEVELS = frozenset([1] + list(range(3, 13)))


def report_chain(unit, d):
    return [u for u in unit.chain_at(d) if u.level in REPORT_LEVELS]


def path_rks(unit, d):
    """Путь юнита в отчёте: lvl2 пропущен, глубже lvl12 — обрезано."""
    return [u.rk for u in report_chain(unit, d)]


def is_junior(sen):
    s = (sen or '').lower()
    return any(s.startswith(x) for x in JUN_PATTERNS)
