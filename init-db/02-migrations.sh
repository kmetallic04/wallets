#!/bin/bash
set -e

export PGPASSWORD="${POSTGRES_PASSWORD}"

echo "Running migrations as ${POSTGRES_USER} on ${APP_DB_NAME}..."

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${APP_DB_NAME}" \
  -f /docker-entrypoint-initdb.d/seed.sql

psql -v ON_ERROR_STOP=1 \
  --username "${POSTGRES_USER}" \
  --dbname "${APP_DB_NAME}" <<EOSQL
  ALTER MATERIALIZED VIEW wallet_balances OWNER TO ${APP_DB_USER};
EOSQL

echo "Migrations completed successfully."
