"""Минимальная обёртка psycopg2 поверх psycopg 3 (чистый Python, системная libpq) — для стенда HRBP HUB."""
import psycopg as _pg


class _Cur:
    def __init__(self, c):
        self._c = c

    def __getattr__(self, k):
        return getattr(self._c, k)

    def __iter__(self):
        return iter(self._c)

    def copy_expert(self, sql, f):
        with self._c.copy(sql) as cp:
            while True:
                chunk = f.read(1 << 20)
                if not chunk:
                    break
                cp.write(chunk)


class _Con:
    def __init__(self, c):
        self._c = c

    def __getattr__(self, k):
        return getattr(self._c, k)

    def __setattr__(self, k, v):
        if k == '_c':
            object.__setattr__(self, k, v)
        else:
            setattr(self._c, k, v)

    def cursor(self, *a, **kw):
        return _Cur(self._c.cursor(*a, **kw))


def connect(*a, **kw):
    return _Con(_pg.connect(*a, **kw))


Error = _pg.Error
