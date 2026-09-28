"""Папка поставки: нумерованные копии исходников «что куда вставлять».

    python3 stand/pack.py           # обновить копии 1–3 из исходников
    python3 stand/pack.py --check   # только сверить: копии == исходники (код 1 — разошлись)

Исходники — источник правды: helicopter/paragraphs → build.py → YAML, датасет и
чарт — proteus/. Файлы 0, 4, 5 папки пишутся руками и здесь не трогаются.
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
    sys.exit(1 if bad else 0)
