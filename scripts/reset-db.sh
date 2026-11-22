#!/bin/sh
# Drops and recreates the local database with an empty schema, and empties stored attachments.
# Runs directly against Postgres: a full clear has no API endpoint.
set -e
cd "$(dirname "$0")/.."
DB="${DB_NAME:-brim_ap}"
dropdb --if-exists --force "$DB"
createdb "$DB"
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f db/schema.sql
# the Brim employee in the schema gets the demo password, to sign in to the Brim side
npx tsx scripts/set-demo-password.ts ops@brim.example
find storage -mindepth 1 -delete 2>/dev/null || mkdir -p storage
echo "database $DB reset"
