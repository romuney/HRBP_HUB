"""Собирает ноут Helicopter «HRBP HUB» из параграфов в YAML того же формата, что
экспорт Helicopter (title + paragraphs: sid / title / shebang / code / isEnabled).

    python3 helicopter/build.py        # → helicopter/HRBP HUB.yaml

Источник правды — файлы helicopter/paragraphs/NN <название>.<sql|py|md>:
номер задаёт порядок, название — заголовок параграфа, расширение — shebang
(sql → gp, py → python или python_condition по таблице ниже, md → md).
sid детерминированный (UUID v7 от номера и названия): пересборка не меняет sid,
и Helicopter узнаёт те же параграфы.
"""
import hashlib
import os
import re

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
PAR = os.path.join(HERE, 'paragraphs')
OUT = os.path.join(HERE, 'HRBP HUB.yaml')

# номер параграфа → (shebang для .py, включён, цвет)
SPECIAL = {
    '01': ('python_condition', True, None),
    '12': (None, True, '#FDC454'),          # реестр целей — правится руками
    '15': ('python', True, '#1BA6CE'),
    '16': ('python', True, None),
    '17': ('python_condition', False, None),
    '18': (None, False, None),
}
BASE_MS = 1790064000000                     # 2026-09-22 12:00 UTC — основа sid


def sid(num, title):
    h = hashlib.md5((num + '|' + title).encode()).hexdigest()
    ms = BASE_MS + int(num) * 1000
    t = '%012x' % ms
    return '%s-%s-7%s-%s%s-%s' % (t[:8], t[8:12], h[:3], '89ab'[int(h[3], 16) % 4], h[4:7], h[7:19])


class Literal(str):
    pass


def literal(dumper, data):
    return dumper.represent_scalar('tag:yaml.org,2002:str', data, style='|')


class Dumper(yaml.SafeDumper):
    """Отступ у элементов списка — как в экспорте Helicopter («  - sid: …»)."""
    def increase_indent(self, flow=False, indentless=False):
        return super().increase_indent(flow, False)


Dumper.add_representer(Literal, literal)


def build():
    paras = []
    for fn in sorted(os.listdir(PAR)):
        m = re.match(r'^(\d\d) (.+)\.(sql|py|md)$', fn)
        if not m:
            continue
        num, title, ext = m.groups()
        code = open(os.path.join(PAR, fn), encoding='utf-8').read()
        code = '\n'.join(line.rstrip() for line in code.strip('\n').split('\n'))
        sh, on, color = SPECIAL.get(num, (None, True, None))
        shebang = {'sql': 'gp', 'md': 'md'}.get(ext) or sh or 'python'
        p = {'sid': sid(num, title), 'title': title, 'shebang': shebang, 'code': Literal(code), 'isEnabled': on}
        if color:
            p['color'] = color
        paras.append(p)
    doc = {'title': 'HRBP HUB', 'paragraphs': paras}
    with open(OUT, 'w', encoding='utf-8') as f:
        yaml.dump(doc, f, Dumper=Dumper, allow_unicode=True, sort_keys=False, width=10000, default_flow_style=False)
    return OUT, paras


if __name__ == '__main__':
    out, paras = build()
    back = yaml.safe_load(open(out, encoding='utf-8'))
    assert [p['title'] for p in back['paragraphs']] == [p['title'] for p in paras]
    for p in back['paragraphs']:
        print('%-18s %-6s %-40s %s' % (p['shebang'], 'on' if p['isEnabled'] else 'OFF', p['title'], p['sid']))
    print('→', out)
