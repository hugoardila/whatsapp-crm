#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="/opt/lampp/htdocs/jabru"
LOG_DIR="${ROOT_DIR}/logs"
LAMP_BIN="/opt/lampp/lampp"

mkdir -p "${LOG_DIR}"

echo "[$(date -Is)] start-jabru-services.sh: iniciando Apache de LAMPP" >> "${LOG_DIR}/systemd-startup.log"

# PM2 lo maneja pm2-root.service. Este script solo arranca Apache/LAMPP.
if [ ! -x "${LAMP_BIN}" ]; then
  echo "lampp no esta disponible en ${LAMP_BIN}" >&2
  exit 1
fi

"${LAMP_BIN}" startapache >/dev/null 2>&1 || true

echo "[$(date -Is)] start-jabru-services.sh: Apache/LAMPP listo" >> "${LOG_DIR}/systemd-startup.log"

exit 0