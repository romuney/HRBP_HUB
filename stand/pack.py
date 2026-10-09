"""Папка поставки: нумерованные копии исходников «что куда вставлять».

    python3 stand/pack.py           # обновить файлы 1–3 и 1а из исходников
    python3 stand/pack.py --check   # только сверить: файлы == сборка исходников (код 1 — разошлись)

Файл 3 — сжатая сборка чарта (stand/min.cjs = kit/min.cjs гайда, terser 5.51.2, 09.10): Proteus кладёт код
чарта в КАЖДЫЙ POST chart/data, отправка у владельца ≈50 КБ/с — 398 → 232 КиБ, ≈8,0 → 4,6 с на запрос.
Сборка проверяется (--check min.cjs: ES5, option, имена верхнего уровня, нет кода из строки, ≤ 260 КиБ).
Нет node или terser — код 2, а не сырой файл. Читать и править — proteus/hrbp-hub.chart.js.

Исходники — источник правды: helicopter/paragraphs → build.py → YAML, датасет и
чарт — proteus/. Файлы 0, 4, 5 папки пишутся руками и здесь не трогаются.
1а — код параграфов, изменённых в последней поставке (CHANGED): у владельца ноут уже
стоит, в нём руками заданы параметры, реестр целей и OWNERS — поэтому ноут не
импортируется заново, а в нём заменяется код только этих параграфов.
"""
import filecmp
import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PACK = os.path.join(ROOT, 'Поставка — HRBP HUB v2')
COPIES = [
    ('helicopter/HRBP HUB.yaml', '1. Helicopter — ноут HRBP HUB.yaml'),
    ('proteus/hrbp-hub.data.sql', '2. Proteus — датасет hrbp_hub.sql'),
]
CHART_SRC = 'proteus/hrbp-hub.chart.js'
CHART_OUT = '3. Proteus — чарт HRBP HUB.js'
DELIVERY = '20 · 09.10'  # номер и дата поставки — в шапку сборки
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


def chart_min():
    """Сжатая сборка чарта с шапкой: откуда собрано и где править."""
    text = open(os.path.join(ROOT, CHART_SRC), encoding='utf-8').read()
    sha = hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]
    head = ('HRBP HUB · поставка %s · исходник %s — сжатая сборка %s (terser 5.51.2, stand/min.cjs). '
            'Править исходник в репозитории; сборка — python3 stand/pack.py.' % (DELIVERY, sha, CHART_SRC))
    try:
        root = subprocess.run(['npm', 'root', '-g'], capture_output=True, text=True, check=True).stdout.strip()
        r = subprocess.run(['node', os.path.join(ROOT, 'stand', 'min.cjs'), head, '--check', '--budget', '260',
                            '--kbps', '50'], input=text, capture_output=True, text=True,
                           env=dict(os.environ, NODE_PATH=root))
    except OSError as e:
        print('сжатие JS не запустилось (нужны node и npm i -g terser@5.51.2): %s' % e)
        sys.exit(2)
    if r.returncode != 0:
        print(r.stderr)
        sys.exit(r.returncode)
    print(r.stderr.strip().split('\n')[0])
    return r.stdout


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
    js, b = chart_min(), os.path.join(PACK, CHART_OUT)
    same = os.path.exists(b) and open(b, encoding='utf-8').read() == js
    if check:
        print(('ok    ' if same else 'РАЗНЫЕ ') + CHART_OUT)
        bad += 0 if same else 1
    elif not same:
        with open(b, 'w', encoding='utf-8') as f:
            f.write(js)
        print('→ ' + CHART_OUT)
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
