"""Мок строк data для smoke.mjs: настоящий ответ датасета со стенда.

    python3 stand/mock.py        # → proteus/hrbp-hub.mock.json (live.py должен быть остановлен:
                                 #   chdb держит блокировку каталога)

Супер-HRBP, вся компания, ось трансформеров «Специализация»: в моке есть все
роли строк (meta, dict, hrbps, base, scope, c, g, f, tr, kpi).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ch  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'proteus', 'hrbp-hub.mock.json')

if __name__ == '__main__':
    rows, _ = ch.dataset({'tr_f': ['spec']}, 'a.sergeeva')
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(rows, f, ensure_ascii=False, indent=0)
    roles = {}
    for r in rows:
        roles[r['role']] = roles.get(r['role'], 0) + 1
    print(len(rows), 'строк', roles, os.path.getsize(OUT) // 1024, 'КБ')
