#!/bin/sh
set -eu

RUNTIME_ROOT="${RUNTIME_ROOT:-/srv/autoweave/runtime}"
RUNTIME_CONTROL_PLANE="${RUNTIME_CONTROL_PLANE:-/srv/autoweave/runtime/control-plane}"
VERTEX_FILE="${RUNTIME_VERTEX_SERVICE_ACCOUNT_FILE:-/srv/autoweave/runtime/control-plane/config/secrets/vertex_service_account.json}"

mkdir -p "${RUNTIME_ROOT}" "${RUNTIME_CONTROL_PLANE}/config/secrets"

if [ ! -f "${VERTEX_FILE}" ]; then
  printf '{}' > "${VERTEX_FILE}"
fi

python -m apps.cli.main bootstrap --root "${RUNTIME_CONTROL_PLANE}" >/tmp/autoweave-bootstrap.log 2>&1 || true

exec uvicorn autoweave_web.main:app --host 0.0.0.0 --port 8000
