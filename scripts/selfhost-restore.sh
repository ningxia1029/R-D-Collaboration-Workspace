#!/bin/sh
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
BACKUP_FILE=${BACKUP_FILE:-}

case "$BACKUP_FILE" in
  ''|*/*|*\\*)
    echo "[selfhost-restore] BACKUP_FILE must be a backup basename" >&2
    exit 1
    ;;
  workbuddy-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump)
    ;;
  *)
    echo "[selfhost-restore] BACKUP_FILE has an invalid name" >&2
    exit 1
    ;;
esac

: "${PGHOST:?PGHOST must be supplied by Compose}"
: "${PGPORT:?PGPORT must be supplied by Compose}"
: "${PGUSER:?PGUSER must be supplied by Compose}"
: "${PGDATABASE:?PGDATABASE must be supplied by Compose}"
: "${PGPASSWORD:?PGPASSWORD must be supplied by Compose}"

BACKUP_PATH="$BACKUP_DIR/$BACKUP_FILE"
SHA_FILE="${BACKUP_PATH}.sha256"
if [ ! -f "$BACKUP_PATH" ] || [ ! -f "$SHA_FILE" ]; then
  echo "[selfhost-restore] backup and matching checksum are both required" >&2
  exit 1
fi

# sha256sum -c 只会验证文件内容；额外锁定清单中的文件名，拒绝挪用其他归档的校验值。
if [ "$(awk 'NF == 2 { print $2 }' "$SHA_FILE")" != "$BACKUP_FILE" ]; then
  echo "[selfhost-restore] checksum filename does not match BACKUP_FILE" >&2
  exit 1
fi

cd "$BACKUP_DIR"
sha256sum -c "$SHA_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null
printf '%s\n' "[selfhost-restore] status=checked backup=$BACKUP_FILE"

if [ "${RESTORE_EXECUTE:-0}" != "1" ]; then
  echo "[selfhost-restore] dry-run complete; set RESTORE_EXECUTE=1 and RESTORE_TARGET_ACK=workbuddy_selfhost_uat to write" >&2
  exit 0
fi
if [ "${RESTORE_TARGET_ACK:-}" != "workbuddy_selfhost_uat" ]; then
  echo "[selfhost-restore] explicit target acknowledgement is required" >&2
  exit 1
fi

pg_isready -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" >/dev/null
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --single-transaction --dbname="$PGDATABASE" "$BACKUP_FILE"
printf '%s\n' "[selfhost-restore] status=restored backup=$BACKUP_FILE"
