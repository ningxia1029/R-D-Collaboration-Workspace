#!/usr/bin/env bash
set -euo pipefail

# 仅管理 /tmp/workbuddy-phase8-* 下的可丢弃验收实例，拒绝其他路径。
ACTION="${1:-}"
CLUSTER_ROOT="${2:-}"
PORT="${3:-}"
DATABASE_NAME="${4:-}"
POSTGRES_BIN="/usr/lib/postgresql/14/bin"

case "${CLUSTER_ROOT}" in
  /tmp/workbuddy-phase8-*) ;;
  *) echo "拒绝不安全的临时路径：${CLUSTER_ROOT}" >&2; exit 64 ;;
esac

if [[ ! "${PORT}" =~ ^[0-9]{4,5}$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "端口无效：${PORT}" >&2
  exit 64
fi

if [[ ! "${DATABASE_NAME}" =~ ^workbuddy_phase8_[a-zA-Z0-9_]+$ ]]; then
  echo "隔离数据库名无效：${DATABASE_NAME}" >&2
  exit 64
fi

case "${ACTION}" in
  start)
    if [[ -e "${CLUSTER_ROOT}" ]]; then
      echo "临时路径已存在，拒绝覆盖：${CLUSTER_ROOT}" >&2
      exit 73
    fi
    mkdir -m 700 "${CLUSTER_ROOT}"
    "${POSTGRES_BIN}/initdb" -D "${CLUSTER_ROOT}/data" --auth=trust --username=postgres >"${CLUSTER_ROOT}/initdb.log"
    if ! "${POSTGRES_BIN}/pg_ctl" -D "${CLUSTER_ROOT}/data" -l "${CLUSTER_ROOT}/postgres.log" -o "-h 127.0.0.1 -p ${PORT} -k ${CLUSTER_ROOT}" -w start; then
      cat "${CLUSTER_ROOT}/postgres.log" >&2
      exit 1
    fi
    "${POSTGRES_BIN}/createdb" -h 127.0.0.1 -p "${PORT}" -U postgres "${DATABASE_NAME}"
    "${POSTGRES_BIN}/pg_isready" -h 127.0.0.1 -p "${PORT}" -d "${DATABASE_NAME}"
    echo "PHASE8_CLUSTER=${CLUSTER_ROOT}"
    echo "PHASE8_DB=${DATABASE_NAME}"
    ;;
  create-db)
    EXTRA_DATABASE="${5:-}"
    if [[ ! "${EXTRA_DATABASE}" =~ ^workbuddy_phase8_[a-zA-Z0-9_]+$ ]]; then
      echo "额外隔离数据库名无效：${EXTRA_DATABASE}" >&2
      exit 64
    fi
    "${POSTGRES_BIN}/createdb" -h 127.0.0.1 -p "${PORT}" -U postgres "${EXTRA_DATABASE}"
    echo "PHASE8_EXTRA_DB=${EXTRA_DATABASE}"
    ;;
  stop)
    if [[ -f "${CLUSTER_ROOT}/data/postmaster.pid" ]]; then
      "${POSTGRES_BIN}/pg_ctl" -D "${CLUSTER_ROOT}/data" -m fast -w stop
    fi
    if [[ -d "${CLUSTER_ROOT}" ]]; then
      find "${CLUSTER_ROOT}" -mindepth 1 -delete
      rmdir "${CLUSTER_ROOT}"
    fi
    [[ ! -e "${CLUSTER_ROOT}" ]]
    echo "PHASE8_CLEANUP_OK"
    ;;
  *)
    echo "用法：$0 {start|create-db|stop} /tmp/workbuddy-phase8-* PORT workbuddy_phase8_NAME [workbuddy_phase8_EXTRA]" >&2
    exit 64
    ;;
esac
