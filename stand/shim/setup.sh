#!/bin/sh
# Стенд HRBP HUB без реестров пакетов (pip / npm закрыты, GitHub открыт) — 11.11.
#   sh stand/shim/setup.sh            # → /home/claude/vendor: psycopg 3, sqlparse 0.4.4, sqlglot, terser 5.51.2, clickhouse 24.8.4.13
#   export PYTHONPATH=/home/claude/vendor/py:/home/claude/vendor/sp044
# Обёртки: psycopg2 → psycopg 3 (чистый Python, системная libpq); chdb → `clickhouse local --path` (ClickHouse 24.8, как бой).
set -e
V=/home/claude/vendor; S=$V/src; HERE=$(cd "$(dirname "$0")" && pwd)
mkdir -p $S $V/py $V/sp044 $V/ch
cd $S
[ -d psycopg ] || git clone -q --depth 1 https://github.com/psycopg/psycopg
[ -d sqlparse044 ] || git clone -q --depth 1 --branch 0.4.4 https://github.com/andialbrecht/sqlparse sqlparse044
[ -d sqlglot ] || git clone -q --depth 1 https://github.com/tobymao/sqlglot
[ -d terser ] || git clone -q --depth 1 --branch v5.51.2 https://github.com/terser/terser
ln -sfn $S/psycopg/psycopg/psycopg $V/py/psycopg
ln -sfn $S/sqlglot/sqlglot $V/py/sqlglot
ln -sfn $S/sqlparse044/sqlparse $V/sp044/sqlparse
cp -r $HERE/psycopg2 $HERE/chdb $V/py/
# terser: сборка не нужна — dist/bundle.min.js отдаёт исходник; source-map — заглушка (карты не нужны)
T=$S/terser; G=$(npm root -g)
echo "module.exports = require('../main.js');" > $T/dist/bundle.min.js
mkdir -p $T/node_modules/@jridgewell/source-map
printf '{"name":"@jridgewell/source-map","version":"0.3.3","main":"index.js","exports":{".":{"import":"./index.mjs","require":"./index.js"}}}\n' > $T/node_modules/@jridgewell/source-map/package.json
printf 'class SourceMapConsumer{constructor(){throw new Error("no maps")}}\nclass SourceMapGenerator{constructor(){throw new Error("no maps")}}\nmodule.exports={SourceMapConsumer,SourceMapGenerator};\n' > $T/node_modules/@jridgewell/source-map/index.js
printf 'export class SourceMapConsumer{constructor(){throw new Error("no maps")}}\nexport class SourceMapGenerator{constructor(){throw new Error("no maps")}}\n' > $T/node_modules/@jridgewell/source-map/index.mjs
ln -sfn /opt/node-tools/node_modules/acorn $T/node_modules/acorn
ln -sfn $T $G/terser; ln -sfn /opt/node-tools/node_modules/acorn $G/acorn; ln -sfn /opt/node-tools/node_modules/eslint $G/eslint
# ClickHouse 24.8.4.13 (= бой 24.8): статический бинарник из релиза на GitHub
cd $V/ch
[ -x clickhouse ] || { curl -sSL -o ch.tgz https://github.com/ClickHouse/ClickHouse/releases/download/v24.8.4.13-lts/clickhouse-common-static-24.8.4.13-amd64.tgz
  tar xzf ch.tgz && ln -sfn $V/ch/clickhouse-common-static-24.8.4.13/usr/bin/clickhouse $V/ch/clickhouse && rm ch.tgz; }
# PostgreSQL 16 (играет GP): база gp, роль root
pg_ctlcluster 16 main start 2>/dev/null || true
su postgres -c "psql -tc \"select 1 from pg_roles where rolname='root'\" | grep -q 1 || psql -c 'create role root superuser login'"
su postgres -c "psql -lqt | cut -d'|' -f1 | grep -qw gp || createdb -O root gp"
echo "готово: export PYTHONPATH=$V/py:$V/sp044"
