#!/bin/sh
# First boot: create the SQLite database, then run the standalone server.
set -e
cd /app
if [ ! -f data/node.db ]; then
  echo "[entrypoint] initializing database…"
  bunx prisma db push --skip-generate
fi
exec node server.js
