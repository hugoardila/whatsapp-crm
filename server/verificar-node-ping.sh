#!/usr/bin/env bash
# En el VPS, desde la carpeta server/:  bash verificar-node-ping.sh
set -euo pipefail
PORT="${1:-3001}"
echo "=== GET http://127.0.0.1:${PORT}/api/cotizaciones-ia-ping ==="
curl -sS -i "http://127.0.0.1:${PORT}/api/cotizaciones-ia-ping" | head -n 25
echo
echo "Si NO aparece \"jabru-ping-v2\" en el cuerpo, PM2 NO está ejecutando este app.js en ese puerto."
echo "Comandos: pm2 list   y   pm2 describe jabru"
