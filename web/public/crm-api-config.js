/**
 * RECOMENDADO: dejá vacío ('') y hacé que Apache (HTTPS :443) reenvíe /api al Node interno.
 *
 * Ejemplo en el VirtualHost de tecnoxpert.com (Node suele estar en 127.0.0.1:3001 — mirá PM2 / .env):
 *
 *   SSLProxyEngine on
 *   ProxyPreserveHost On
 *   RequestHeader set X-Forwarded-Proto "https"
 *   ProxyPass        /api        http://127.0.0.1:3001/api
 *   ProxyPassReverse /api        http://127.0.0.1:3001/api
 *   ProxyPass        /webhook    http://127.0.0.1:3001/webhook
 *   ProxyPassReverse /webhook    http://127.0.0.1:3001/webhook
 *   ProxyPass        /socket.io  http://127.0.0.1:3001/socket.io
 *   ProxyPassReverse /socket.io  http://127.0.0.1:3001/socket.io
 *
 * Probá: GET .../api/health?cotizaciones_ping=1 → JSON con objeto "cotizaciones_ia" y build jabru-ping-v2.
 * Apache debe reenviar TODO /api al mismo Node (PM2). Si solo /api/health y login llegan al CRM, el resto
 * dará 401 "No autorizado" (36 bytes) desde otro servicio.
 *
 * Si el panel corre con `npm run start:crm` (serve-crm.cjs) en :8988, ese proceso proxifica
 * /api (y /webhook, /socket.io) a Node. Si en cambio Apache sirve solo los archivos de dist/ en :8988
 * sin Node delante, agregá en ESE VirtualHost (antes del rewrite al index.html del SPA):
 *
 *   ProxyPass        /api        http://127.0.0.1:3001/api
 *   ProxyPassReverse /api        http://127.0.0.1:3001/api
 *   (y lo mismo para /webhook y /socket.io que arriba)
 *
 * Variable opcional para serve-crm: CRM_API_PROXY_TARGET=http://127.0.0.1:PUERTO
 *
 * Solo si NO podés usar proxy y el puerto del Node es público con SSL válido:
 *   window.__CRM_API_BASE__ = 'https://tecnoxpert.com:PUERTO';
 * (Si ponés dominio:puerto sin https://, el panel falla en Axios con "Unsupported protocol" en el .js minificado.)
 */
window.__CRM_API_BASE__ = '';
