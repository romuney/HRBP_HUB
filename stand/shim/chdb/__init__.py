"""Обёртка «chdb» поверх clickhouse local 24.8.4.13 (статический бинарник с GitHub): реестры пакетов закрыты, а стенду
HRBP HUB нужен ClickHouse 24.8, как в бою. Повторяет то, что берут stand/*.py: Session(path).query(sql, fmt).bytes()."""
__version__ = '2.1.1'
from .session import Session, ChdbError  # noqa: E402,F401


def query(sql, fmt='CSV'):
    return Session().query(sql, fmt)
