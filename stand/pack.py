"""Папка поставки: нумерованные копии исходников «что куда вставлять».

    python3 stand/pack.py           # обновить копии 1–3 и 1а из исходников
    python3 stand/pack.py --check   # только сверить: копии == исходники (код 1 — разошлись)

Исходники — источник правды: helicopter/paragraphs → build.py → YAML, датасет и
чарт — proteus/. Файлы 0, 4, 5 папки пишутся руками и здесь не трогаются.
1а — код параграфов, изменённых в последней поставке (CHANGED): у владельца ноут уже
стоит, в нём руками заданы параметры, реестр целей и OWNERS — поэтому ноут не
импортируется заново, а в нём заменяется код только этих параграфов.
"""
import filecmp
import os
import shutil
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PACK = os.path.join(ROOT, 'Поставка — HRBP HUB v2')
COPIES = [
    ('helicopter/HRBP HUB.yaml', '1. Helicopter — ноут HRBP HUB.yaml'),
    ('proteus/hrbp-hub.data.sql', '2. Proteus — датасет hrbp_hub.sql'),
    ('proteus/hrbp-hub.chart.js', '3. Proteus — чарт HRBP HUB.js'),
]
# Параграфы, изменённые в последней поставке (номер → что сделать). 16 — только допись
# таблицы в список: OWNERS у владельца свои.
CHANGED_DATE = '06.10'
CHANGED = [
    ('05', 'заменить код целиком'),
    ('11', 'заменить код целиком'),
    ('14', 'заменить код целиком'),
    ('15', 'заменить код целиком'),
    ('16', "код не заменять (в нём ваши OWNERS): в список таблиц дописать 'hrbp_hub_attr_top' после 'hrbp_hub_attr'"),
    ('19', 'заменить код целиком'),
]
PARS = os.path.join(ROOT, 'helicopter', 'paragraphs')
CHANGED_OUT = '1а. Helicopter — изменённые параграфы.md'


def changed_md():
    out = ['# Helicopter — параграфы, изменённые %s' % CHANGED_DATE, '',
           'Ноут уже стоит: заново его НЕ импортировать (пропадут ваши параметры, реестр целей',
           'и OWNERS). Откройте ноут «HRBP HUB» и в параграфах ниже сделайте, что написано;',
           'параграфы «HH · параметры» и «KPI · реестр целей» не трогать. Потом — запустить ноут',
           'целиком. Полная версия ноута — файл 1 (для новой установки).', '']
    files = sorted(os.listdir(PARS))
    for num, what in CHANGED:
        fn = [f for f in files if f.startswith(num + ' ')][0]
        title, ext = os.path.splitext(fn[3:])
        out += ['## %s %s — %s' % (num, title, what), '']
        if what.startswith('заменить'):
            code = open(os.path.join(PARS, fn), encoding='utf-8').read().rstrip('\n')
            out += ['```' + ('sql' if ext == '.sql' else 'python'), code, '```', '']
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    check = '--check' in sys.argv
    bad = 0
    os.makedirs(PACK, exist_ok=True)
    for src, dst in COPIES:
        a, b = os.path.join(ROOT, src), os.path.join(PACK, dst)
        same = os.path.exists(b) and filecmp.cmp(a, b, shallow=False)
        if check:
            print(('ok    ' if same else 'РАЗНЫЕ ') + dst)
            bad += 0 if same else 1
        elif not same:
            shutil.copyfile(a, b)
            print('→ ' + dst)
    md, b = changed_md(), os.path.join(PACK, CHANGED_OUT)
    same = os.path.exists(b) and open(b, encoding='utf-8').read() == md
    if check:
        print(('ok    ' if same else 'РАЗНЫЕ ') + CHANGED_OUT)
        bad += 0 if same else 1
    elif not same:
        with open(b, 'w', encoding='utf-8') as f:
            f.write(md)
        print('→ ' + CHANGED_OUT)
    sys.exit(1 if bad else 0)
