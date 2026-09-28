"""Кладёт синтетические источники HRBP HUB в PostgreSQL (схемы и колонки — как в GP).

    python3 stand/gen_sources.py            # база gp на localhost (PGDATABASE=gp)

Таблицы:
  prod_v_emart.mdm_employee_structure_d                подневная витрина (подмножество колонок,
                                                        которое читает ноут; дни — концы месяцев и
                                                        недель, дни событий, срез и каждый 5-й день)
  usr_cross_data.regrettable_n_non_regrettable_base    разметка regrettable на день увольнения
  prod_v_hrmart.legal_position_dismissal_reason        причины увольнений
  prod_v_sse_crossdata.mdm_employee_residence          город / регион / макрорегион
"""
import csv
import datetime as dt
import io
import os
import sys

import psycopg2

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import world as W  # noqa: E402

LV = range(1, 14)
COLS = (['business_dt', 'mdm_employee_rk', 'last_day_flg', 'last_day_of_month_flg', 'last_state_flg',
         'active_employee_flg', 'active_type_nm', 'legal_employee_flg', 'employment_relation_type_desc',
         'seniority', 'grade', 'company_hire_dt', 'company_fire_dt', 'active_hire_dt', 'legal_fire_dt',
         'legal_position_rk', 'management_unit_rk', 'mapped_management_unit_rk', 'mapped_management_unit_nm',
         'management_unit_lvl_num']
        + ['lvl%d_mapped_management_unit_rk' % i for i in LV]
        + ['lvl%d_mapped_management_unit_nm' % i for i in LV]
        + ['lvl%d_management_head_mdm_employee_rk' % i for i in LV]
        + ['emp_specialization_oper_code', 'emp_specialization_it_code', 'emp_stream_desc', 'emp_specialization_desc',
           'hrbp_mdm_employee_rk', 'hrbp_ad_login', 'hrbp_last_nm', 'hrbp_first_nm',
           'experience_group_nm', 'gender_desc', 'birth_dt', 'office_desc', 'employee_contract_type_desc',
           'management_head_flg', 'lvl1_legal_unit_nm', 'ad_login', 'last_nm', 'first_nm'])
TYPES = {'business_dt': 'date', 'mdm_employee_rk': 'bigint', 'last_day_flg': 'smallint', 'last_day_of_month_flg': 'smallint',
         'last_state_flg': 'smallint', 'active_employee_flg': 'smallint', 'legal_employee_flg': 'smallint', 'grade': 'integer',
         'company_hire_dt': 'date', 'company_fire_dt': 'date', 'active_hire_dt': 'date', 'legal_fire_dt': 'date',
         'management_unit_lvl_num': 'numeric', 'hrbp_mdm_employee_rk': 'bigint', 'birth_dt': 'date', 'management_head_flg': 'smallint'}
for i in LV:
    TYPES['lvl%d_management_head_mdm_employee_rk' % i] = 'bigint'


def base_dates():
    """Дни, на которые строки есть у ВСЕХ работающих: концы месяцев и недель, срез, каждый 15-й день."""
    out = set()
    d = W.START
    while d <= W.D:
        if d == W.month_end(d) or d.isoweekday() == 7 or (d - W.START).days % 15 == 0:
            out.add(d)
        d += dt.timedelta(days=1)
    out.add(W.D)
    return out


def event_dates(e):
    """Дни событий сотрудника: найм, увольнение, переход в «Активную», смена состояния."""
    out = set()
    for p in e.periods:
        for x in (p.hire, p.fire, p.active_hire):
            if x and W.START <= x <= W.D:
                out.add(x)
        for sg in p.segs:
            if W.START <= sg[0] <= W.D:
                out.add(sg[0])
    return out


def exp_group(p, d):
    y = (d - p.hire).days / 365.0
    return 'до 1 года' if y < 1 else ('1–3 года' if y < 3 else ('3–5 лет' if y < 5 else 'более 5 лет'))


def row(e, d, last_state):
    st = W.state(e, d)
    if st is None:
        return None
    p, a = st
    unit = a['unit']
    ch = unit.chain_at(d)
    h = W.hrbp_at(unit, d)
    r = dict.fromkeys(COLS)
    r.update(business_dt=d, mdm_employee_rk=e.rk, last_day_flg=int(d == W.D),
             last_day_of_month_flg=int(d == W.month_end(d)), last_state_flg=int(last_state),
             active_employee_flg=0 if a['hct'] == 'Декрет' else 1, active_type_nm=a['hct'],
             legal_employee_flg=int(a['rel'] == 'Штатный сотрудник'), employment_relation_type_desc=a['rel'],
             seniority=a['sen'], grade=a['grade'], company_hire_dt=p.hire,
             company_fire_dt=p.fire if (p.fire and d == p.fire) else None,          # пессимистично: только в день увольнения
             active_hire_dt=p.active_hire if (p.active_hire and p.active_hire <= d) else None,
             legal_fire_dt=(None if p.legal_fire_null else p.fire) if (p.fire and d == p.fire) else None,
             legal_position_rk=p.lp, management_unit_rk=unit.raw_rk, mapped_management_unit_rk=unit.rk,
             mapped_management_unit_nm=unit.name_at(d), management_unit_lvl_num=unit.level,
             emp_specialization_oper_code=a['paint'], emp_specialization_it_code=a['it'], emp_stream_desc=a['stream'],
             emp_specialization_desc=a['spec'],
             hrbp_mdm_employee_rk=h.rk if h else None, hrbp_ad_login=h.login if h else None,
             hrbp_last_nm=h.last if h else None, hrbp_first_nm=h.first if h else None,
             experience_group_nm=exp_group(p, d), gender_desc=e.gender, birth_dt=e.birth, office_desc=e.office,
             employee_contract_type_desc=a['contract'], management_head_flg=int(unit.head is e),
             lvl1_legal_unit_nm=a['legal'], ad_login=e.login, last_nm=e.last, first_nm=e.first)
    for u in ch:
        r['lvl%d_mapped_management_unit_rk' % u.level] = u.rk
        r['lvl%d_mapped_management_unit_nm' % u.level] = u.name_at(d)
        r['lvl%d_management_head_mdm_employee_rk' % u.level] = u.head.rk if u.head else None
    return r


def main():
    con = psycopg2.connect(dbname=os.environ.get('PGDATABASE', 'gp'))
    con.autocommit = True
    cur = con.cursor()
    for s in ('prod_v_emart', 'usr_cross_data', 'prod_v_hrmart', 'prod_v_sse_crossdata'):
        cur.execute('create schema if not exists ' + s)
    cur.execute('drop table if exists prod_v_emart.mdm_employee_structure_d')
    cur.execute('create table prod_v_emart.mdm_employee_structure_d (' +
                ', '.join('%s %s' % (c, TYPES.get(c, 'text')) for c in COLS) + ')')
    base = base_dates()
    buf, n = io.StringIO(), 0
    w = csv.writer(buf)
    for e in W.EMPS:
        ds = sorted(d for d in (base | event_dates(e)) if W.state(e, d) is not None)
        for i, d in enumerate(ds):
            r = row(e, d, i == len(ds) - 1)
            w.writerow(['' if r[c] is None else r[c] for c in COLS])
            n += 1
        if buf.tell() > 20_000_000:
            buf.seek(0)
            cur.copy_expert('copy prod_v_emart.mdm_employee_structure_d from stdin with (format csv)', buf)
            buf = io.StringIO()
            w = csv.writer(buf)
    buf.seek(0)
    cur.copy_expert('copy prod_v_emart.mdm_employee_structure_d from stdin with (format csv)', buf)
    cur.execute('create index on prod_v_emart.mdm_employee_structure_d (business_dt)')
    cur.execute('analyze prod_v_emart.mdm_employee_structure_d')

    # regrettable-разметка: строка на день увольнения + шум нулевыми строками
    cur.execute('drop table if exists usr_cross_data.regrettable_n_non_regrettable_base')
    cur.execute('create table usr_cross_data.regrettable_n_non_regrettable_base (mdm_employee_rk bigint, business_dt date, '
                'regrettable_fire_flg smallint, non_regrettable_fire_flg smallint, potential_regrettable_flg smallint, '
                'potential_non_regrettable_flg smallint)')
    rows = []
    for e in W.EMPS:
        for p in e.periods:
            if p.fire:
                rows.append((e.rk, p.fire, int(p.regret == 1), int(p.regret == 2), 0, 0))
                if W.R.random() < .2:
                    rows.append((e.rk, p.fire - dt.timedelta(days=30), 0, 0, int(p.regret == 1), int(p.regret == 2)))
    cur.executemany('insert into usr_cross_data.regrettable_n_non_regrettable_base values (%s,%s,%s,%s,%s,%s)', rows)

    cur.execute('drop table if exists prod_v_hrmart.legal_position_dismissal_reason')
    cur.execute('create table prod_v_hrmart.legal_position_dismissal_reason (legal_position_rk text, mdm_employee_rk bigint, '
                'fire_dt date, dismissal_reason_group_nm text, dismissal_reason_desc text)')
    rows = []
    for e in W.EMPS:
        for p in e.periods:
            if p.fire and not p.legal_fire_null:
                if p.reason == 'filled':
                    rows.append((p.lp, e.rk, p.fire, 'Инициатива сотрудника', W.R.choice(['Переезд', 'Зарплата', 'Карьера', 'Выгорание'])))
                    if W.R.random() < .03:      # дубль строки причины — пусть ноут переживёт
                        rows.append((p.lp, e.rk, p.fire, 'Инициатива сотрудника', 'Карьера'))
                elif p.reason == 'null':
                    rows.append((p.lp, e.rk, p.fire, None, None))
    cur.executemany('insert into prod_v_hrmart.legal_position_dismissal_reason values (%s,%s,%s,%s,%s)', rows)

    cur.execute('drop table if exists prod_v_sse_crossdata.mdm_employee_residence')
    cur.execute('create table prod_v_sse_crossdata.mdm_employee_residence (mdm_employee_rk bigint, valid_from_dttm timestamp, '
                'valid_to_dttm timestamp, deleted_flg smallint, region_nm text, city_nm text, macroregion_nm text)')
    rows = []
    for e in W.EMPS:
        c, reg, mac = W.CITY[e.office]
        rows.append((e.rk, '2000-01-01', '5999-01-01', 0, reg, c, mac))
    cur.executemany('insert into prod_v_sse_crossdata.mdm_employee_residence values (%s,%s,%s,%s,%s,%s,%s)', rows)
    cur.execute('select count(*), count(distinct mdm_employee_rk), min(business_dt), max(business_dt) '
                'from prod_v_emart.mdm_employee_structure_d')
    print('mdm_employee_structure_d:', cur.fetchone(), '| сотрудников в мире:', len(W.EMPS))


if __name__ == '__main__':
    main()
