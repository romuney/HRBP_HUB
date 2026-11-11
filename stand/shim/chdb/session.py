import os
import subprocess
import tempfile

BIN = os.environ.get('HH_CLICKHOUSE', '/home/claude/vendor/ch/clickhouse')


class ChdbError(RuntimeError):
    pass


class _Res:
    def __init__(self, b):
        self._b = b

    def bytes(self):
        return self._b

    def data(self):
        return self._b.decode()

    def __str__(self):
        return self._b.decode()


class Session:
    def __init__(self, path=None):
        self.path = path or tempfile.mkdtemp(prefix='chl_')
        os.makedirs(self.path, exist_ok=True)
        self.settings = []

    def query(self, sql, fmt='CSV'):
        s = sql.strip()
        if s.upper().startswith('SET ') and ';' not in s:
            self.settings.append(s)        # SET сессии — перед каждым запросом
            return _Res(b'')
        text = ';\n'.join(self.settings + [s])
        p = subprocess.run([BIN, 'local', '--path', self.path, '--format', fmt or 'CSV', '--multiquery'],
                           input=text.encode('utf-8'), capture_output=True)
        if p.returncode != 0:
            raise ChdbError(p.stderr.decode('utf-8', 'replace')[-4000:])
        return _Res(p.stdout)

    def close(self):
        pass

    def cleanup(self):
        pass
