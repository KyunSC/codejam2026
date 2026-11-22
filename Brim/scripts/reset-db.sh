#!/bin/sh
# Drops and recreates the local database with an empty schema, and empties stored attachments.
# Runs directly against Postgres: a full clear has no API endpoint.
# The database name comes from DATABASE_URL (the environment, else .env.local), else DB_NAME, else brim_ap.
# Only the name is used: dropdb/createdb/psql connect with your default local Postgres settings (PGHOST, PGUSER, ...).
set -e
cd "$(dirname "$0")/.."
URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL=//p' .env.local 2>/dev/null | tr -d '"' | tail -n 1)}"
if [ -n "$URL" ]; then
  NAME="${URL##*/}"
  NAME="${NAME%%\?*}"
fi
DB="${NAME:-${DB_NAME:-brim_ap}}"
dropdb --if-exists --force "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f db/schema.sql
find storage -mindepth 1 -delete 2>/dev/null || mkdir -p storage
echo "database $DB reset"
