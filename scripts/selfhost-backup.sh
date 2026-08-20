#!/bin/sh
set -eu
umask 077

BACKUP_DIR=${BACKUP_DIR:-/backups}
INTERVAL_SECONDS=${SELFHOST_BACKUP_INTERVAL_SECONDS:-86400}
RETENTION_DAYS=${SELFHOST_BACKUP_RETENTION_DAYS:-7}

# 连接信息必须由 Compose 注入；脚本既不拼接连接 URL，也不记录密码。
: "${PGHOST:?PGHOST must be supplied by Compose}"
: "${PGUSER:?PGUSER must be supplied by Compose}"
: "${PGDATABASE:?PGDATABASE must be supplied by Compose}"
: "${PGPASSWORD:?PGPASSWORD must be supplied by Compose}"

is_integer() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) return 0 ;;
  esac
}

is_backup_name() {
  case "$1" in
    workbuddy-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9].dump) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_integer "$INTERVAL_SECONDS" || [ "$INTERVAL_SECONDS" -lt 3600 ] || [ "$INTERVAL_SECONDS" -gt 604800 ]; then
  echo "[selfhost-backup] invalid SELFHOST_BACKUP_INTERVAL_SECONDS" >&2
  exit 1
fi
if ! is_integer "$RETENTION_DAYS" || [ "$RETENTION_DAYS" -lt 1 ] || [ "$RETENTION_DAYS" -gt 90 ]; then
  echo "[selfhost-backup] invalid SELFHOST_BACKUP_RETENTION_DAYS" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
dump_partial=
sha_partial=
final_dump=
final_sha=
pair_committed=0
remove_regular_file() {
  if [ -n "$1" ] && [ -f "$1" ]; then
    rm -f "$1"
  fi
}
cleanup_uncommitted_partials_and_finals() {
  # 只有一个提交标记；未提交时，无论中断发生在任一次 mv 的前后都回滚本轮四个路径。
  if [ "$pair_committed" != "1" ]; then
    remove_regular_file "$dump_partial"
    remove_regular_file "$sha_partial"
    remove_regular_file "$final_dump"
    remove_regular_file "$final_sha"
  fi
}
abort_uncommitted_pair() {
  cleanup_uncommitted_partials_and_finals
  exit 1
}
trap cleanup_uncommitted_partials_and_finals 0
trap abort_uncommitted_pair HUP INT TERM

cleanup_expired_pairs() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'workbuddy-????????-??????.dump' -mtime "+$RETENTION_DAYS" -print |
    while IFS= read -r dump; do
      dump_name=${dump##*/}
      # find 的 ? 只是粗筛；删除前必须逐位确认 UTC 数字文件名。
      if ! is_backup_name "$dump_name"; then
        continue
      fi
      sha="${dump}.sha256"
      # 仅清理本服务命名且 dump/校验文件都存在的一对，绝不扫描或删除其他备份。
      if [ -f "$dump" ] && [ -f "$sha" ]; then
        rm -f "$dump" "$sha"
        printf '%s\n' "[selfhost-backup] retention=deleted dump=$dump checksum=$sha"
      fi
    done
}

backup_once() {
  stamp=$(date -u +%Y%m%d-%H%M%S)
  dump_name="workbuddy-${stamp}.dump"
  dump_file="$BACKUP_DIR/$dump_name"
  sha_file="${dump_file}.sha256"
  dump_partial="${dump_file}.partial"
  sha_partial="${sha_file}.partial"

  if [ -e "$dump_file" ] || [ -e "$sha_file" ] || [ -e "$dump_partial" ] || [ -e "$sha_partial" ]; then
    echo "[selfhost-backup] refusing backup filename collision" >&2
    return 1
  fi

  # 在任一最终文件发布前登记本轮所有路径；二者成功后只以单一标记提交。
  final_dump="$dump_file"
  final_sha="$sha_file"
  pair_committed=0

  pg_dump --format=custom --no-owner --no-acl --file "$dump_partial"
  hash=$(sha256sum "$dump_partial" | awk '{print $1}')
  if [ -z "$hash" ]; then
    echo "[selfhost-backup] checksum calculation failed" >&2
    return 1
  fi
  # 清单始终只包含 basename，供 restore 在 /backups 内执行 sha256sum -c。
  printf '%s  %s\n' "$hash" "$dump_name" > "$sha_partial"
  mv "$sha_partial" "$sha_file"
  mv "$dump_partial" "$dump_file"
  pair_committed=1
  cleanup_expired_pairs
  printf '%s\n' "[selfhost-backup] status=ready dump=$dump_file checksum=$sha_file"
}

backup_once
while :; do
  sleep "$INTERVAL_SECONDS"
  backup_once
done
