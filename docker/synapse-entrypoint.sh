#!/bin/sh
set -eu

SERVER_NAME="${MATRIX_SERVER_NAME:-autoweave.local}"
PUBLIC_URL="${MATRIX_HOMESERVER_PUBLIC_URL:-http://localhost:8008}"
REGISTRATION_SECRET="${MATRIX_REGISTRATION_SHARED_SECRET:-autoweave-matrix-dev-secret}"
CONFIG_PATH="/data/homeserver.yaml"

mkdir -p /data

if [ ! -f "${CONFIG_PATH}" ]; then
  python -m synapse.app.homeserver \
    --server-name "${SERVER_NAME}" \
    --config-path "${CONFIG_PATH}" \
    --generate-config \
    --report-stats=no
fi

python - <<'PY'
from pathlib import Path
import os
import re

config_path = Path("/data/homeserver.yaml")
text = config_path.read_text(encoding="utf-8")

replacements = {
    "enable_registration: false": "enable_registration: false",
    "report_stats: false": "report_stats: false",
}
for old, new in replacements.items():
    if old in text:
        text = text.replace(old, new)

registration_secret = os.environ.get("MATRIX_REGISTRATION_SHARED_SECRET", "")
if re.search(r"^registration_shared_secret:\s*.*$", text, flags=re.MULTILINE):
    text = re.sub(
        r'^registration_shared_secret:\s*".*"$',
        f'registration_shared_secret: "{registration_secret}"',
        text,
        flags=re.MULTILINE,
    )
else:
    text += f'\nregistration_shared_secret: "{registration_secret}"\n'

public_url = os.environ.get("MATRIX_HOMESERVER_PUBLIC_URL", "http://localhost:8008").rstrip("/")
if re.search(r"^public_baseurl:\s*.*$", text, flags=re.MULTILINE):
    text = re.sub(
        r'^public_baseurl:\s*".*"$',
        f'public_baseurl: "{public_url}/"',
        text,
        flags=re.MULTILINE,
    )
else:
    text += f'\npublic_baseurl: "{public_url}/"\n'
text = text.replace("  - bind_addresses:\n    - ::1\n    - 127.0.0.1", "  - bind_addresses:\n    - 0.0.0.0")
if "enable_registration:" not in text:
    text += "\nenable_registration: false\n"
if "allow_public_rooms_without_auth:" not in text:
    text += "\nallow_public_rooms_without_auth: false\n"
if "allow_public_rooms_over_federation:" not in text:
    text += "allow_public_rooms_over_federation: false\n"

config_path.write_text(text, encoding="utf-8")
PY

exec python -m synapse.app.homeserver --config-path "${CONFIG_PATH}"
