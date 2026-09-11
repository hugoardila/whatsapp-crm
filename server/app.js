'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { execFile } = require('child_process');
const { promisify } = require('util');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const crypto = require('crypto');
const multer = require('multer');
const twilio = require('twilio');
const { db, normalizeCustomerPhone } = require('./db');
const { logEvent, logPath: EVENT_LOG_FILE } = require('./eventLog');
const openaiBot = require('./openaiBot');
const { detectSpamReason } = require('./inboundSpam');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { signAdvisorToken, getJwtSecret } = require('./advisorAuth');
const {
  applyBusinessSettingsToProcessEnv,
  getBusinessSettingsForClient,
  updateBusinessSettings
} = require('./businessSettings');
const {
  registerCotizacionesMessagesBeforeGate,
  registerCotizacionesRoutes
} = require('./cotizacionesRoutes');
const { createProxyMiddleware } = require('http-proxy-middleware');
const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8989);
/** Segundo puerto solo para el panel (legacy). Vacío = panel servido en PORT junto a la API. */
const CRM_PORT_RAW = process.env.CRM_PORT;
const CRM_PORT =
  CRM_PORT_RAW === '0' ||
  CRM_PORT_RAW === 'false' ||
  CRM_PORT_RAW === '' ||
  CRM_PORT_RAW == null
    ? null
    : Number(CRM_PORT_RAW);
applyBusinessSettingsToProcessEnv({ port: PORT });

/** Mínimo de dígitos del teléfono normalizado (evita rechazar números válidos cortos). */
const MIN_PHONE_DIGITS = Math.max(
  7,
  Math.min(15, Number(process.env.MIN_PHONE_DIGITS || 8) || 8)
);

const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
const OPENAI_BOT_ENABLED =
  Boolean(OPENAI_API_KEY) &&
  String(process.env.OPENAI_BOT_ENABLED || 'true').toLowerCase() !== 'false';

/** Panel CRM principal (login). Sobrescribir con variables de entorno en producción. */
const CRM_ADMIN_USER = String(process.env.CRM_ADMIN_USER || 'tecnoxpert').trim();
const CRM_ADMIN_PASSWORD = String(process.env.CRM_ADMIN_PASSWORD || 'Fiddle72*').trim();
const CRM_JWT_SECRET = String(
  process.env.CRM_JWT_SECRET || process.env.ADVISOR_JWT_SECRET || ''
).trim();
const ADVISOR_JWT_SECRET_RAW = String(process.env.ADVISOR_JWT_SECRET || '').trim();

function currentBusinessName() {
  return String(process.env.CRM_BUSINESS_NAME || 'Bruja TecnoXpert').trim() || 'Bruja TecnoXpert';
}

function currentBusinessTagline() {
  return (
    String(process.env.CRM_BUSINESS_TAGLINE || 'WhatsApp Business').trim() ||
    'WhatsApp Business'
  );
}

function currentTwilioSid() {
  return String(process.env.TWILIO_ACCOUNT_SID || '').trim();
}

function currentTwilioToken() {
  return String(process.env.TWILIO_AUTH_TOKEN || '').trim();
}

function currentWhatsappFrom() {
  return (
    String(process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+5215540952942').trim() ||
    'whatsapp:+5215540952942'
  );
}

function twilioUserError(err) {
  const code = Number(err?.code || 0);
  if (code === 63016) {
    return {
      status: 409,
      error: 'No se puede enviar este mensaje porque la ventana de WhatsApp de 24 horas esta cerrada. El cliente debe escribir primero para reabrir la conversacion, o se debe usar una plantilla aprobada.',
      twilioCode: 63016
    };
  }
  return {
    status: 500,
    error: err?.message || 'Error al enviar por Twilio',
    twilioCode: err?.code || null
  };
}

const WHATSAPP_TEMPLATES = [
  {
    id: 'seguimiento_cliente',
    label: 'Seguimiento cliente',
    contentSid: 'HX7629880c5f78c5dbf73be3eb10062b42',
    language: 'es_MX',
    body: 'Platicame que ha pasado, hablameos y buscamos una solicion',
    variables: []
  }
];

const ADVISOR_ALERT_TEMPLATE = {
  id: 'alerta_asesor',
  contentSid: 'HX74000360de7b37cc15222d8164c5cdd4',
  cooldownMs: 5 * 60 * 1000
};

function currentWebhookUrl() {
  return String(process.env.PUBLIC_WEBHOOK_URL || `http://127.0.0.1:${PORT}/webhook`)
    .trim()
    .replace(/\/$/, '');
}

function currentPublicApiUrl() {
  return String(process.env.PUBLIC_API_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function currentValidateSig() {
  return String(process.env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false';
}

function currentOpenAiApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function currentOpenAiModel() {
  return String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
}

function currentOpenAiBotEnabled() {
  return (
    Boolean(currentOpenAiApiKey()) &&
    String(process.env.OPENAI_BOT_ENABLED || 'true').toLowerCase() !== 'false'
  );
}

function currentCrmAdminUser() {
  return String(process.env.CRM_ADMIN_USER || 'tecnoxpert').trim() || 'tecnoxpert';
}

function currentCrmAdminPassword() {
  return String(process.env.CRM_ADMIN_PASSWORD || 'Fiddle72*');
}

function currentCrmJwtSecret() {
  return String(process.env.CRM_JWT_SECRET || process.env.ADVISOR_JWT_SECRET || '').trim();
}

function currentAdvisorJwtSecretRaw() {
  return String(process.env.ADVISOR_JWT_SECRET || '').trim();
}

/**
 * JWT: Authorization, X-TecnoXpert-Jwt, query (?token= / ?jwt=), body (auth_token / authToken / jwt).
 * El body solo aplica tras express.json(); el gate corre después.
 */
function readJwtFromRequest(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  if (m) return m[1];
  const x = String(req.headers['x-tecnoxpert-jwt'] || '').trim();
  if (x) return x;
  try {
    const q = req.query;
    if (q && typeof q === 'object') {
      const qt = String(q.token || q.jwt || q.auth_token || '').trim();
      if (qt) return qt;
    }
  } catch {
    /* ignore */
  }
  const b = req.body;
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    const bt = String(b.auth_token || b.authToken || b.jwt || '').trim();
    if (bt) return bt;
  }
  return null;
}

function verifyCrmJwtToken(token) {
  const secret = currentCrmJwtSecret();
  if (!secret || !token) return false;
  try {
    const p = jwt.verify(String(token), secret);
    return Boolean(p && p.crm === 1);
  } catch {
    return false;
  }
}

/** Asesor: firma con ADVISOR_JWT_SECRET; si en .env solo está CRM_JWT_SECRET, el token puede verificarse con ese. */
function advisorClientSecret() {
  return currentAdvisorJwtSecretRaw() || currentCrmJwtSecret() || 'advisor-client-mask';
}

function advisorClientRef(row) {
  const id = Number(row && row.id);
  const phone = String((row && row.customer_phone) || '');
  if (!Number.isFinite(id) || id < 1 || !phone) return '';
  const sig = crypto
    .createHmac('sha256', advisorClientSecret())
    .update(String(id) + ':' + phone)
    .digest('base64url')
    .slice(0, 18);
  return 'c' + id + '.' + sig;
}

function advisorClientAlias(row) {
  const id = Number(row && row.id);
  const fallback = 'Cliente ' + (Number.isFinite(id) && id >= 1 ? id : '');
  const name = String((row && row.real_profile_name) || '').trim().replace(/\s+/g, ' ');
  if (!name) return fallback;
  const nameDigits = name.replace(/\D/g, '');
  const phoneDigits = String((row && row.customer_phone) || '').replace(/\D/g, '');
  if (nameDigits && (nameDigits === phoneDigits || nameDigits.length >= 7)) return fallback;
  return name.slice(0, 80);
}
function advisorCountryCode(row) {
  const phone = String((row && row.customer_phone) || '').replace(/\D/g, '');
  if (!phone) return '';
  const codes = ['593', '57', '52', '51', '56', '54', '55', '58', '53', '591', '598', '595', '594', '590', '599', '597', '596', '592', '1'];
  const code = codes.find((prefix) => phone.startsWith(prefix));
  return code ? '+' + code : '+' + phone.slice(0, Math.min(3, phone.length));
}

function resolveAdvisorClientRef(ref) {
  const raw = String(ref || '').trim();
  const m = /^c(\d+)\.([A-Za-z0-9_-]{8,})$/.exec(raw);
  if (!m) return null;
  const id = Number(m[1]);
  if (!Number.isFinite(id) || id < 1) return null;
  const row = db.prepare('SELECT id, customer_phone, pipeline_label, assigned_advisor_id, conv_status FROM conversations WHERE id = ?').get(id);
  if (!row) return null;
  const expected = advisorClientRef(row);
  try {
    const a = Buffer.from(raw);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return row;
}

function verifyAdvisorTokenFlexible(token) {
  if (!token) return null;
  const secrets = [...new Set([currentAdvisorJwtSecretRaw(), currentCrmJwtSecret()].filter(Boolean))];
  for (const secret of secrets) {
    try {
      const p = jwt.verify(String(token), secret);
      const aid = Number(p?.aid);
      if (Number.isFinite(aid) && aid >= 1) return aid;
    } catch {
      /* siguiente */
    }
  }
  return null;
}

const outboundDir = path.join(__dirname, 'data', 'uploads', 'outbound');
fs.mkdirSync(outboundDir, { recursive: true });

function extFromMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/ogg': '.ogg',
    'audio/webm': '.webm',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/mp4': '.m4a',
    'audio/aac': '.aac',
    'audio/amr': '.amr',
    'audio/3gpp': '.3gp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'application/pdf': '.pdf'
  };
  if (map[m]) return map[m];
  const sub = m.split('/')[1];
  if (sub) return `.${sub.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'bin'}`;
  return '.bin';
}

const OUTBOUND_EXT_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg; codecs=opus',
  '.webm': 'audio/webm',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.3gp': 'video/3gpp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf'
};

function outboundContentType(filename) {
  const ext = path.extname(filename).toLowerCase();
  return OUTBOUND_EXT_MIME[ext] || 'application/octet-stream';
}

async function convertOutboundMediaIfNeeded(file) {
  const originalPath = file?.path;
  const originalMime = String(file?.mimetype || '').toLowerCase().split(';')[0].trim();
  if (!originalPath || !fs.existsSync(originalPath)) return file;

  const isAudio = originalMime.startsWith('audio/');
  const isVideo = originalMime.startsWith('video/');
  if (!isAudio && !isVideo) return file;

  const outExt = isAudio ? '.mp3' : '.mp4';
  const outMime = isAudio ? 'audio/mpeg' : 'video/mp4';
  const outPath = path.join(outboundDir, crypto.randomUUID() + outExt);
  const args = isAudio
    ? [
        '-y',
        '-i',
        originalPath,
        '-vn',
        '-map_metadata',
        '-1',
        '-ac',
        '1',
        '-ar',
        '48000',
        '-c:a',
        'libmp3lame',
        '-b:a',
        '64k',
        outPath
      ]
    : [
        '-y',
        '-i',
        originalPath,
        '-vf',
        'scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-profile:v',
        'baseline',
        '-level',
        '3.1',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '96k',
        '-movflags',
        '+faststart',
        outPath
      ];

  try {
    await execFileAsync('ffmpeg', args, { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    try { fs.unlinkSync(originalPath); } catch {}
    logEvent('outbound_media', 'converted', {
      from: path.basename(originalPath),
      to: path.basename(outPath),
      fromMime: originalMime,
      toMime: outMime
    });
    return {
      ...file,
      path: outPath,
      filename: path.basename(outPath),
      mimetype: outMime
    };
  } catch (err) {
    logEvent('outbound_media', 'convert_failed', {
      file: path.basename(originalPath),
      mimetype: originalMime,
      error: err.message
    });
    throw new Error('No se pudo convertir el audio/video a un formato compatible con WhatsApp.');
  }
}

const uploadOutbound = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, outboundDir),
    filename: (_req, file, cb) => {
      cb(null, `${crypto.randomUUID()}${extFromMime(file.mimetype)}`);
    }
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ct = String(file.mimetype || '').toLowerCase();
    const ok =
      ct.startsWith('image/') ||
      ct.startsWith('audio/') ||
      ct.startsWith('video/') ||
      ct === 'application/pdf';
    if (ok) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'));
  }
});

function publicApiOrigin() {
  const publicApiUrl = currentPublicApiUrl();
  if (publicApiUrl) return publicApiUrl;
  try {
    return new URL(currentWebhookUrl()).origin;
  } catch {
    return '';
  }
}

const corsList = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

/** Ping público lo antes posible (antes de CORS/gate). Si en producción no ves "build":"jabru-ping-v2", PM2 no está sirviendo ESTE app.js. */
const COTIZACIONES_IA_PING_BUILD = 'jabru-ping-v2';
function sendCotizacionesIaPingJson(_req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    ok: true,
    service: 'cotizaciones-ia',
    build: COTIZACIONES_IA_PING_BUILD,
    time: new Date().toISOString(),
    use_paths: [
      'POST /api/messages/cotizacion-chat (recomendado tras proxy Apache)',
      'POST /api/messages/cotizacion-pdf',
      'POST /api/cotizacion-ia/chat (alias)',
      'POST /api/cotizacion-ia/pdf (alias)'
    ],
    note:
      'Si /api/cotizaciones-ia-ping da 401 pero /api/health OK, Apache tiene un ProxyPass que empieza por /api/cotizacion o /api/cotizaciones hacia otro servicio: quitá esa línea o unificá /api → un solo Node. Este ping vive también en GET /api/health/cotizaciones-ia-ping.'
  });
}
app.get('/api/health/cotizaciones-ia-ping', sendCotizacionesIaPingJson);
app.get('/api/cotizaciones-ia-ping', sendCotizacionesIaPingJson);
app.get('/cotizaciones-ia-ping', sendCotizacionesIaPingJson);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsList.length ? corsList : true,
    credentials: true
  }
});

io.use((socket, next) => {
  const crmToken = socket.handshake.auth?.crmToken;
  if (crmToken && currentCrmJwtSecret() && verifyCrmJwtToken(crmToken)) {
    socket.auth_role = 'admin';
    return next();
  }

  const advisorToken = socket.handshake.auth?.advisorToken;
  if (advisorToken && ADVISOR_JWT_SECRET_RAW) {
    try {
      const payload = jwt.verify(String(advisorToken), ADVISOR_JWT_SECRET_RAW);
      const aid = Number(payload?.aid);
      if (Number.isFinite(aid) && aid >= 1) {
        socket.auth_role = 'advisor';
        socket.advisor_id = aid;
        return next();
      }
    } catch {
      /* token asesor invalido */
    }
  }

  return next(new Error('unauthorized'));
});

let twilioClient = null;
let twilioClientKey = '';
function getTwilioClient() {
  const sid = currentTwilioSid();
  const token = currentTwilioToken();
  if (!sid || !token) {
    twilioClient = null;
    twilioClientKey = '';
    return null;
  }
  const key = `${sid}::${token}`;
  if (twilioClient && twilioClientKey === key) {
    return twilioClient;
  }
  twilioClient = twilio(sid, token);
  twilioClientKey = key;
  return twilioClient;
}

let advisorAlertSchemaReady = false;
function ensureAdvisorAlertSchema() {
  if (advisorAlertSchemaReady) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS advisor_whatsapp_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      advisor_id INTEGER NOT NULL,
      conversation_id INTEGER NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_alias TEXT,
      last_sent_at TEXT NOT NULL,
      twilio_sid TEXT,
      status TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(advisor_id, conversation_id)
    )
  `);
  advisorAlertSchemaReady = true;
}

function normalizeAdvisorWhatsappTo(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 && digits.startsWith('3')) return 'whatsapp:+57' + digits;
  if (
    digits.startsWith('57') ||
    digits.startsWith('52') ||
    digits.startsWith('593') ||
    digits.startsWith('1')
  ) {
    return 'whatsapp:+' + digits;
  }
  if (digits.length >= 10) return 'whatsapp:+' + digits;
  return '';
}

function advisorAlertAlias(row) {
  const id = Number(row && row.id);
  const fallback = 'Cliente ' + (Number.isFinite(id) && id >= 1 ? id : '');
  const raw = String(
    (row && (row.lead_name || row.profile_name || row.real_profile_name)) || ''
  )
    .trim()
    .replace(/\s+/g, ' ');
  if (!raw) return fallback;
  const nameDigits = raw.replace(/\D/g, '');
  const phoneDigits = String((row && row.customer_phone) || '').replace(/\D/g, '');
  if (nameDigits && (nameDigits === phoneDigits || nameDigits.length >= 7)) return fallback;
  return raw.slice(0, 80);
}

function advisorAlertInCooldown(advisorId, conversationId, nowIso) {
  ensureAdvisorAlertSchema();
  const row = db
    .prepare(
      `SELECT last_sent_at FROM advisor_whatsapp_alerts
       WHERE advisor_id = ? AND conversation_id = ?`
    )
    .get(advisorId, conversationId);
  if (!row || !row.last_sent_at) return false;
  const lastMs = new Date(row.last_sent_at).getTime();
  const nowMs = new Date(nowIso).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - lastMs < ADVISOR_ALERT_TEMPLATE.cooldownMs;
}

function saveAdvisorAlert({ advisorId, conversationId, customerPhone, customerAlias, sentAt, sid, status }) {
  ensureAdvisorAlertSchema();
  db.prepare(
    `INSERT INTO advisor_whatsapp_alerts (
       advisor_id, conversation_id, customer_phone, customer_alias, last_sent_at,
       twilio_sid, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(advisor_id, conversation_id) DO UPDATE SET
       customer_phone = excluded.customer_phone,
       customer_alias = excluded.customer_alias,
       last_sent_at = excluded.last_sent_at,
       twilio_sid = excluded.twilio_sid,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(
    advisorId,
    conversationId,
    customerPhone,
    customerAlias,
    sentAt,
    sid || null,
    status || null,
    sentAt,
    sentAt
  );
}

function advisorAlertRecipients(convRow) {
  const assignedId = Number(convRow?.assigned_advisor_id || 0);
  if (assignedId > 0) {
    return db
      .prepare(
        `SELECT id, full_name, phone FROM advisors
         WHERE id = ? AND is_active = 1 AND TRIM(COALESCE(phone, '')) != ''`
      )
      .all(assignedId);
  }

  const advisors = db
    .prepare(
      `SELECT id, full_name, phone FROM advisors
       WHERE is_active = 1 AND TRIM(COALESCE(phone, '')) != ''
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  return advisors.filter((advisor) => advisorTurnStatus(advisor.id).can_take);
}

function queueAdvisorWhatsAppAlertsForInbound(convRow, { bodyText, messageType, now }) {
  if (!convRow || !convRow.id) return;
  setImmediate(async () => {
    const twilioApi = getTwilioClient();
    if (!twilioApi) {
      logEvent('advisor_alert', 'skipped', { reason: 'twilio_not_configured' });
      return;
    }

    const recipients = advisorAlertRecipients(convRow);
    if (!recipients.length) {
      logEvent('advisor_alert', 'skipped', {
        reason: 'no_eligible_advisors',
        conversationId: convRow.id,
        assignedAdvisorId: convRow.assigned_advisor_id || null
      });
      return;
    }

    const customerAlias = advisorAlertAlias(convRow);
    for (const advisor of recipients) {
      const advisorId = Number(advisor.id);
      if (advisorAlertInCooldown(advisorId, convRow.id, now)) {
        logEvent('advisor_alert', 'cooldown', {
          advisor_id: advisorId,
          conversationId: convRow.id,
          customer_alias: customerAlias
        });
        continue;
      }

      const to = normalizeAdvisorWhatsappTo(advisor.phone);
      if (!to) {
        logEvent('advisor_alert', 'skipped', {
          reason: 'invalid_advisor_phone',
          advisor_id: advisorId
        });
        continue;
      }

      try {
        const msg = await twilioApi.messages.create({
          from: currentWhatsappFrom(),
          to,
          contentSid: ADVISOR_ALERT_TEMPLATE.contentSid
        });
        saveAdvisorAlert({
          advisorId,
          conversationId: convRow.id,
          customerPhone: convRow.customer_phone,
          customerAlias,
          sentAt: now,
          sid: msg.sid,
          status: msg.status || 'queued'
        });
        logEvent('advisor_alert', 'sent', {
          advisor_id: advisorId,
          conversationId: convRow.id,
          customer_alias: customerAlias,
          template: ADVISOR_ALERT_TEMPLATE.id,
          sidShort: String(msg.sid || '').slice(0, 12),
          message_type: messageType || 'text',
          has_body: Boolean(bodyText)
        });
      } catch (e) {
        console.error('Advisor WhatsApp alert Twilio:', e.message);
        logEvent('advisor_alert', 'twilio_error', {
          advisor_id: advisorId,
          conversationId: convRow.id,
          customer_alias: customerAlias,
          error: e.message,
          twilioCode: e.code || null
        });
      }
    }
  });
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeMatchText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Embudo "Negociación": el bot no responde; solo el asesor. */
function pipelineIsNegotiationLabel(label) {
  const n = normalizeMatchText(String(label || '')).replace(/\s+/g, '');
  return n === 'negociacion';
}

const NEGOTIATION_HANDOFF_OUTBOUND = `¡Listo! Quedaste en **Negociación**: un asesor humano te escribe por aquí para coordinar el adelanto y cerrar la cotización. ¡Gracias por confiar en TecnoXpert!`;

const PIPELINE_LABEL_PRESETS = [
  'Nuevo',
  'Contactado',
  'Calificado',
  'Cotización en preparación',
  'Cotización enviada',
  'Seguimiento 24h',
  'Seguimiento 72h',
  'Negociación',
  'Pago confirmado',
  'Pedido / encargo',
  'Entregado',
  'Postventa',
  'Cerrado — ganado',
  'Cerrado — perdido'
];

const PIPELINE_CLOSED_WON = 'Cerrado — ganado';
const PIPELINE_CLOSED_LOST = 'Cerrado — perdido';
const PIPELINE_CLOSED_STAGES = new Set([PIPELINE_CLOSED_WON, PIPELINE_CLOSED_LOST]);
const CRM_PRIORITY_VALUES = new Set(['low', 'normal', 'high', 'urgent']);
const FOLLOW_UP_STATUS_VALUES = new Set(['pending', 'done', 'canceled']);
const FOLLOW_UP_AUTO_RULES = {
  'Cotización enviada': [
    {
      kind: 'quote_followup_24h',
      title: 'Seguimiento 24h a cotización',
      description: 'Confirmar si el cliente revisó la propuesta y resolver objeciones.',
      offsetMs: 24 * 60 * 60 * 1000
    },
    {
      kind: 'quote_followup_72h',
      title: 'Seguimiento 72h a cotización',
      description: 'Reactivar la oportunidad si aún no hay respuesta del cliente.',
      offsetMs: 72 * 60 * 60 * 1000
    }
  ],
  Negociación: [
    {
      kind: 'negotiation_first_touch',
      title: 'Primer contacto de asesor',
      description: 'Escribir al cliente y validar cierre, pago o condiciones finales.',
      offsetMs: 30 * 60 * 1000
    }
  ],
  'Pago confirmado': [
    {
      kind: 'payment_confirmation',
      title: 'Coordinar pedido o encargo',
      description: 'Confirmar adelanto, pedido, tiempos y responsable del cierre.',
      offsetMs: 6 * 60 * 60 * 1000
    }
  ],
  Entregado: [
    {
      kind: 'postsale_checkin',
      title: 'Seguimiento postventa',
      description: 'Confirmar satisfacción del cliente y abrir oportunidad de recompra o soporte.',
      offsetMs: 3 * 24 * 60 * 60 * 1000
    }
  ]
};

function isoNow() {
  return new Date().toISOString();
}

function dueAtFrom(baseIso, offsetMs) {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}

function normalizeIsoDateInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function normalizePriority(value) {
  const v = String(value || 'normal')
    .trim()
    .toLowerCase();
  return CRM_PRIORITY_VALUES.has(v) ? v : 'normal';
}

function followUpState(row) {
  const status = String(row?.status || 'pending');
  if (status !== 'pending') return status;
  const dueAt = String(row?.due_at || '');
  if (!dueAt) return 'pending';
  const ts = Date.parse(dueAt);
  if (!Number.isFinite(ts)) return 'pending';
  return ts < Date.now() ? 'overdue' : 'pending';
}

function serializeFollowUpRow(row) {
  return {
    ...row,
    state: followUpState(row)
  };
}

function refreshConversationNextFollowUp(conversationId) {
  const nextRow = db
    .prepare(
      `SELECT due_at
       FROM follow_ups
       WHERE conversation_id = ? AND status = 'pending'
       ORDER BY datetime(due_at) ASC, id ASC
       LIMIT 1`
    )
    .get(conversationId);
  db.prepare(`UPDATE conversations SET next_follow_up_at = ? WHERE id = ?`).run(
    nextRow?.due_at || null,
    conversationId
  );
}

function cancelPendingFollowUps(conversationId, opts = {}) {
  const now = isoNow();
  const whereKind = opts.onlySystem ? ` AND created_by = 'system'` : '';
  db.prepare(
    `UPDATE follow_ups
     SET status = 'canceled', updated_at = ?
     WHERE conversation_id = ? AND status = 'pending'${whereKind}`
  ).run(now, conversationId);
  refreshConversationNextFollowUp(conversationId);
}

function upsertAutoFollowUp({
  conversationId,
  customerPhone,
  title,
  description,
  dueAt,
  kind,
  assignedAdvisorId
}) {
  const now = isoNow();
  const existing = db
    .prepare(
      `SELECT id
       FROM follow_ups
       WHERE conversation_id = ? AND kind = ? AND created_by = 'system' AND status = 'pending'
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(conversationId, kind);
  if (existing) {
    db.prepare(
      `UPDATE follow_ups
       SET title = ?, description = ?, due_at = ?, assigned_advisor_id = ?, updated_at = ?
       WHERE id = ?`
    ).run(title, description || null, dueAt, assignedAdvisorId || null, now, existing.id);
  } else {
    db.prepare(
      `INSERT INTO follow_ups (
         conversation_id, customer_phone, title, description, due_at,
         status, kind, assigned_advisor_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'system', ?, ?)`
    ).run(
      conversationId,
      customerPhone,
      title,
      description || null,
      dueAt,
      kind,
      assignedAdvisorId || null,
      now,
      now
    );
  }
  refreshConversationNextFollowUp(conversationId);
}

function schedulePipelineAutomations({ conversationId, customerPhone, pipelineLabel, assignedAdvisorId }) {
  const stage = String(pipelineLabel || '').trim();
  if (!stage) {
    cancelPendingFollowUps(conversationId, { onlySystem: true });
    return;
  }
  if (PIPELINE_CLOSED_STAGES.has(stage)) {
    cancelPendingFollowUps(conversationId);
    return;
  }
  const rules = FOLLOW_UP_AUTO_RULES[stage] || [];
  cancelPendingFollowUps(conversationId, { onlySystem: true });
  if (!rules.length) return;
  const baseIso = isoNow();
  for (const rule of rules) {
    upsertAutoFollowUp({
      conversationId,
      customerPhone,
      title: rule.title,
      description: rule.description,
      dueAt: dueAtFrom(baseIso, rule.offsetMs),
      kind: rule.kind,
      assignedAdvisorId
    });
  }
}

function storeConversationSummary(conversationId, kind, text) {
  const summary = String(text || '').trim() || null;
  const now = isoNow();
  if (kind === 'handoff') {
    db.prepare(
      `UPDATE conversations
       SET handoff_summary = ?, handoff_summary_updated_at = ?, last_summary = ?, last_summary_updated_at = ?
       WHERE id = ?`
    ).run(summary, now, summary, now, conversationId);
    return;
  }
  db.prepare(
    `UPDATE conversations
     SET last_summary = ?, last_summary_updated_at = ?
     WHERE id = ?`
  ).run(summary, now, conversationId);
}

async function refreshConversationAiSummary(conversationId) {
  const openaiApiKey = currentOpenAiApiKey();
  if (!openaiApiKey) return null;
  const summary = await openaiBot.generateNegotiationSummary(
    db,
    openaiApiKey,
    currentOpenAiModel(),
    conversationId
  );
  storeConversationSummary(conversationId, 'conversation', summary);
  return summary;
}

function eventPreviewText(value, limit = 220) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function recordCrmEvent(conversationId, customerPhone, eventType, payload, createdAt = isoNow()) {
  if (!conversationId || !customerPhone || !eventType) return;
  let payloadJson = null;
  if (payload !== undefined) {
    try {
      payloadJson = JSON.stringify(payload);
    } catch {
      payloadJson = JSON.stringify({ note: 'payload_not_serializable' });
    }
  }
  db.prepare(
    `INSERT INTO crm_events (conversation_id, customer_phone, event_type, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(conversationId, customerPhone, eventType, payloadJson, createdAt);
}

function changedFieldsPayload(before, after) {
  const changed = {};
  for (const [key, nextValue] of Object.entries(after || {})) {
    const previousValue = before?.[key] ?? null;
    const normalizedPrev = previousValue == null ? null : previousValue;
    const normalizedNext = nextValue == null ? null : nextValue;
    if (normalizedPrev !== normalizedNext) {
      changed[key] = {
        from: normalizedPrev,
        to: normalizedNext
      };
    }
  }
  return changed;
}

function clearSystemFollowUpsOnCustomerReply(conversationId, customerPhone, pipelineLabel, createdAt) {
  const pendingSystem = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM follow_ups
       WHERE conversation_id = ? AND status = 'pending' AND created_by = 'system'`
    )
    .get(conversationId);
  const pendingCount = Number(pendingSystem?.n || 0);
  if (pendingCount < 1) return;
  cancelPendingFollowUps(conversationId, { onlySystem: true });
  recordCrmEvent(
    conversationId,
    customerPhone,
    'system_followups_cleared',
    {
      reason: 'customer_reply',
      pending_count: pendingCount,
      pipeline_label: pipelineLabel || null
    },
    createdAt
  );
}

function handleInboundCommercialActivity({
  conversationId,
  customerPhone,
  pipelineLabel,
  bodyText,
  attachments,
  messageType,
  createdAt
}) {
  if (!PIPELINE_CLOSED_STAGES.has(String(pipelineLabel || '').trim())) {
    clearSystemFollowUpsOnCustomerReply(conversationId, customerPhone, pipelineLabel, createdAt);
  }
  recordCrmEvent(
    conversationId,
    customerPhone,
    'customer_reply',
    {
      pipeline_label: pipelineLabel || null,
      message_type: messageType || 'text',
      has_body: Boolean(String(bodyText || '').trim()),
      attachment_count: Array.isArray(attachments) ? attachments.length : 0,
      preview: eventPreviewText(bodyText)
    },
    createdAt
  );
}

function advisorPublicSelectSql() {
  return `id, full_name, phone, email, notes, is_active, sort_order, created_at, updated_at, CASE WHEN password_hash IS NOT NULL AND TRIM(COALESCE(password_hash, '')) != '' THEN 1 ELSE 0 END AS has_portal_password`;
}

function hashAdvisorPassword(plain) {
  return bcrypt.hashSync(String(plain), 10);
}

function findAdvisorByLogin(raw) {
  const login = String(raw || '').trim();
  if (!login) return null;
  if (login.includes('@')) {
    const email = login.toLowerCase();
    return db
      .prepare(`SELECT * FROM advisors WHERE LOWER(TRIM(COALESCE(email, ''))) = ?`)
      .get(email);
  }
  const digits = login.replace(/\D/g, '');
  if (digits.length >= MIN_PHONE_DIGITS) {
    const candidates = [digits];
    if (digits.startsWith('57') && digits.length === 12) {
      candidates.push(digits.slice(2));
    } else if (digits.length === 10 && digits.startsWith('3')) {
      candidates.push('57' + digits);
    }
    const unique = [...new Set(candidates)];
    const placeholders = unique.map(() => '?').join(',');
    return db
      .prepare(`SELECT * FROM advisors WHERE phone IN (${placeholders}) ORDER BY id LIMIT 1`)
      .get(...unique);
  }
  return null;
}

function advisorAuthMiddleware(req, res, next) {
  const token = readJwtFromRequest(req);
  const aid = token ? verifyAdvisorTokenFlexible(token) : null;
  if (!aid) {
    return res.status(401).json({
      ok: false,
      error: 'Sesión de asesor no válida o vencida. Volvé a entrar al portal.',
      auth: 'advisor_middleware'
    });
  }
  const advisor = db
    .prepare(`SELECT id, full_name, email, phone, is_active FROM advisors WHERE id = ?`)
    .get(aid);
  if (!advisor || Number(advisor.is_active) !== 1) {
    return res.status(401).json({ ok: false, error: 'Cuenta inactiva o inválida' });
  }
  req.advisorId = aid;
  req.advisor = advisor;
  next();
}

/**
 * Marca spam + pausa bot (sin OpenAI). Devuelve true si la conversación queda en spam.
 */
function autoMarkSpamIfInboundMatches(customerPhone, conversationId, bodyText, messageType) {
  if (String(messageType || 'text') !== 'text') return false;
  const text = String(bodyText || '').trim();
  if (!text) return false;

  const conv = db
    .prepare('SELECT conv_status, bot_paused FROM conversations WHERE customer_phone = ?')
    .get(customerPhone);
  if (!conv) return false;
  const st = String(conv.conv_status || 'inbox').toLowerCase();
  if (st === 'blocked') return false;
  if (st === 'spam') {
    if (Number(conv.bot_paused) !== 1) {
      db.prepare('UPDATE conversations SET bot_paused = 1 WHERE customer_phone = ?').run(
        customerPhone
      );
    }
    return true;
  }

  const reason = detectSpamReason(db, conversationId, text);
  if (!reason) return false;
  db.prepare(
    `UPDATE conversations SET conv_status = 'spam', bot_paused = 1 WHERE customer_phone = ?`
  ).run(customerPhone);
  logEvent('webhook', 'spam_auto', {
    customer_phone: customerPhone,
    conversationId,
    reason,
    preview: text.slice(0, 140)
  });
  return true;
}

function applyInboundServiceKeywordTags(customerPhone, bodyText, createdAtIso) {
  const stRow = db
    .prepare('SELECT conv_status FROM conversations WHERE customer_phone = ?')
    .get(customerPhone);
  const st = String(stRow?.conv_status || 'inbox').toLowerCase();
  if (st === 'spam' || st === 'blocked') return;

  const norm = normalizeMatchText(bodyText);
  if (!norm || norm.length < 3) return;
  const rows = db
    .prepare('SELECT id, keywords FROM services WHERE is_active = 1')
    .all();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO conversation_services (customer_phone, service_id, source, created_at)
     VALUES (?, ?, 'keyword', ?)`
  );
  let any = false;
  for (const row of rows) {
    const kws = safeJsonParse(row.keywords, []);
    const hit = kws.some((kw) => {
      const kn = normalizeMatchText(kw);
      return kn && norm.includes(kn);
    });
    if (hit) {
      const r = insert.run(customerPhone, row.id, createdAtIso);
      if (r.changes > 0) any = true;
    }
  }
  if (any) {
    io.emit('crm:update', { type: 'services', customer_phone: customerPhone });
  }
}

/** Respuestas automáticas del bot: solo si la conversación está en bandeja y no es Negociación ni bot pausado. */
function scheduleOpenAiWhatsAppReply({ customer, conversationId, bodyText, stored }) {
  const twilioApi = getTwilioClient();
  const openaiApiKey = currentOpenAiApiKey();
  const openaiModel = currentOpenAiModel();
  if (!currentOpenAiBotEnabled() || !twilioApi || !openaiApiKey) return;
  if (!stored || !bodyText) return;
  if (openaiBot.shouldSkipAutoReply(bodyText)) return;

  setImmediate(() => {
    (async () => {
      const pauseRow = db
        .prepare(
          'SELECT bot_paused, conv_status, pipeline_label FROM conversations WHERE id = ?'
        )
        .get(conversationId);
      if (!pauseRow) return;
      const folderEarly = String(pauseRow.conv_status || 'inbox').toLowerCase();
      if (folderEarly === 'spam' || folderEarly === 'blocked') {
        logEvent('openai_bot', 'skipped_folder', { customer, conversationId, folder: folderEarly });
        return;
      }
      if (pipelineIsNegotiationLabel(pauseRow.pipeline_label)) {
        logEvent('openai_bot', 'skipped_negotiation_pipeline', {
          customer,
          conversationId
        });
        return;
      }
      if (Number(pauseRow.bot_paused) === 1) {
        logEvent('openai_bot', 'skipped_paused', { customer, conversationId });
        return;
      }

      let handoff = false;
      let outboundPreview = '';
      try {
        const ev = await openaiBot.evaluateNegotiationHandoff(
          db,
          openaiApiKey,
          openaiModel,
          conversationId,
          bodyText
        );
        handoff = Boolean(ev.handoff);
        outboundPreview = ev.lastOutboundPreview || '';
      } catch (e) {
        console.error('OpenAI handoff classifier:', e.message);
        logEvent('openai_bot', 'handoff_classify_error', {
          customer,
          error: e.message
        });
      }

      if (handoff) {
        const sentAt = new Date().toISOString();
        let handoffSummary = '';
        try {
          handoffSummary = await openaiBot.generateNegotiationSummary(
            db,
            openaiApiKey,
            openaiModel,
            conversationId
          );
        } catch (e) {
          logEvent('openai_bot', 'handoff_summary_error', {
            customer,
            error: e.message
          });
        }
        const payload = JSON.stringify({
          inbound_preview: String(bodyText).slice(0, 400),
          outbound_preview: String(outboundPreview).slice(0, 400),
          handoff_summary: String(handoffSummary || '').slice(0, 1200)
        });
        db.prepare(
          `UPDATE conversations SET pipeline_label = 'Negociación', bot_paused = 1,
           negotiation_started_at = ? WHERE id = ?`
        ).run(sentAt, conversationId);
        if (handoffSummary) {
          storeConversationSummary(conversationId, 'handoff', handoffSummary);
        }
        db.prepare(
          `INSERT INTO crm_events (conversation_id, customer_phone, event_type, payload, created_at)
           VALUES (?, ?, 'negotiation_handoff', ?, ?)`
        ).run(conversationId, customer, payload, sentAt);
        schedulePipelineAutomations({
          conversationId,
          customerPhone: customer,
          pipelineLabel: 'Negociación',
          assignedAdvisorId: null
        });

        const toWhatsApp = `whatsapp:+${customer}`;
        try {
          const msg = await twilioApi.messages.create({
            from: currentWhatsappFrom(),
            to: toWhatsApp,
            body: NEGOTIATION_HANDOFF_OUTBOUND
          });
          db.prepare(`UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?`).run(
            sentAt,
            sentAt,
            conversationId
          );
          db.prepare(
            `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
             VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NULL)`
          ).run(
            conversationId,
            NEGOTIATION_HANDOFF_OUTBOUND,
            msg.sid,
            msg.status || 'queued',
            sentAt
          );
          io.emit('crm:update', { type: 'negotiation_handoff', customer_phone: customer });
          logEvent('openai_bot', 'negotiation_handoff_sent', {
            customer,
            conversationId,
            sidShort: String(msg.sid || '').slice(0, 12)
          });
        } catch (e) {
          console.error('OpenAI bot Twilio (handoff):', e.message);
          io.emit('crm:update', { type: 'negotiation_handoff', customer_phone: customer });
          logEvent('openai_bot', 'negotiation_handoff_twilio_error', {
            customer,
            error: e.message
          });
        }
        return;
      }

      let replyText = '';
      try {
        replyText = await openaiBot.generateReplyText(
          db,
          openaiApiKey,
          openaiModel,
          conversationId
        );
      } catch (e) {
        console.error('OpenAI bot:', e.message, e.detail || '');
        logEvent('openai_bot', 'openai_error', {
          customer,
          error: e.message,
          detail: (e.detail || '').slice(0, 300)
        });
        return;
      }

      if (!replyText) return;

      const toWhatsApp = `whatsapp:+${customer}`;
      const sentAt = new Date().toISOString();
      try {
        const msg = await twilioApi.messages.create({
          from: currentWhatsappFrom(),
          to: toWhatsApp,
          body: replyText
        });

        db.prepare(
          `UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?`
        ).run(sentAt, sentAt, conversationId);
        db.prepare(
          `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
           VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NULL)`
        ).run(
          conversationId,
          replyText,
          msg.sid,
          msg.status || 'queued',
          sentAt
        );

        io.emit('crm:update', { type: 'outbound', customer_phone: customer });
        logEvent('openai_bot', 'sent', {
          customer,
          sidShort: String(msg.sid || '').slice(0, 12),
          replyLen: replyText.length
        });
      } catch (e) {
        console.error('OpenAI bot Twilio:', e.message);
        logEvent('openai_bot', 'twilio_error', {
          customer,
          error: e.message
        });
      }
    })();
  });
}

app.use(
  cors({
    origin: corsList.length ? corsList : true,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-TecnoXpert-Jwt']
  })
);

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

function normalizedApiPath(req) {
  const raw = req.path || '';
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Path API para el gate: req.path o, si hace falta, pathname de originalUrl (proxies con prefijo). */
function requestApiPath(req) {
  let p = normalizedApiPath(req);
  if (p.includes('/api/')) return p;
  try {
    const pathOnly = String(req.originalUrl || '').split('?')[0];
    let o = pathOnly;
    if (o.length > 1 && o.endsWith('/')) o = o.slice(0, -1);
    if (o.includes('/api/')) return o;
  } catch {
    /* ignore */
  }
  return p;
}

/** Respaldo por si alguna petición aún pasara por el gate (insensible a mayúsculas). */
function isCotizacionIaMessagesPath(p) {
  const s = String(p || '').toLowerCase();
  return (
    /\/api\/messages\/cotizacion-chat$/.test(s) ||
    /\/api\/messages\/cotizacion-pdf$/.test(s) ||
    /\/api\/cotizacion-ia\/(chat|pdf)$/.test(s)
  );
}

function handleCrmAuthLogin(req, res) {
  const u = String(req.body?.username || '').trim();
  const p = String(req.body?.password || '');
  if (u !== currentCrmAdminUser() || p !== currentCrmAdminPassword()) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  const crmJwtSecret = currentCrmJwtSecret();
  if (!crmJwtSecret) {
    return res.status(503).json({
      ok: false,
      error: 'CRM_JWT_SECRET no configurado (puede usar el mismo ADVISOR_JWT_SECRET en .env)'
    });
  }
  const token = jwt.sign({ crm: 1 }, crmJwtSecret, { expiresIn: '7d' });
  res.json({ ok: true, token });
}

/** Antes del middleware de JWT: el login debe existir aunque algo filtre rutas /api. */
app.post('/api/crm-auth/login', handleCrmAuthLogin);
/** Misma función: por si un proxy/WAF bloquea la ruta con "crm-auth". */
app.post('/api/crmpanel/login', handleCrmAuthLogin);

registerCotizacionesMessagesBeforeGate(app, {
  db,
  getOpenAiSettings: () => ({
    apiKey: currentOpenAiApiKey(),
    model: currentOpenAiModel()
  }),
  verifyCrmJwtToken,
  verifyAdvisorToken: verifyAdvisorTokenFlexible,
  readJwtFromRequest
});

function crmApiGate(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  /** Preflight CORS sin Authorization: si llegara aquí, no exigir JWT CRM. */
  if (method === 'OPTIONS') return next();
  const p = requestApiPath(req);
  if (!p.includes('/api/')) return next();
  if (p.startsWith('/api/outbound-media/') || p.includes('/api/outbound-media/')) return next();
  if (/\/api\/messages\/[^/]+\/attachment\//.test(p)) return next();
  if (p === '/api/health' || p.endsWith('/api/health')) return next();
  if (p.toLowerCase().includes('/api/health/cotizaciones-ia')) return next();
  if (/\/api\/cotizaciones-ia-ping$/i.test(p) || p.toLowerCase().includes('cotizaciones-ia-ping')) {
    return next();
  }
  if (p === '/api/crm-auth/login' || p === '/api/crmpanel/login') return next();
  if (p.endsWith('/api/crm-auth/login') || p.endsWith('/api/crmpanel/login')) return next();
  if (p.startsWith('/api/advisor-auth/') || p.includes('/api/advisor-auth/')) return next();
  if (p.startsWith('/api/advisor/') || /\/api\/advisor\//.test(p)) return next();
  /** Cotizaciones IA: dual auth en cotizacionesRoutes (CRM o asesor). */
  if (isCotizacionIaMessagesPath(p)) return next();
  if (!currentCrmJwtSecret()) {
    return res.status(503).json({ ok: false, error: 'CRM_JWT_SECRET no configurado' });
  }
  const tok = readJwtFromRequest(req);
  if (!tok || !verifyCrmJwtToken(tok)) {
    return res.status(401).json({
      ok: false,
      error:
        'Sesión CRM no válida o vencida. Volvé a iniciar sesión en el panel. (Si esto aparece en Cotizaciones IA, el servidor no tiene el router de cotizaciones actualizado: reiniciá Node/pm2.)',
      auth: 'crm_gate'
    });
  }
  next();
}

app.use(crmApiGate);

registerCotizacionesRoutes(app, {
  db,
  getOpenAiSettings: () => ({
    apiKey: currentOpenAiApiKey(),
    model: currentOpenAiModel()
  }),
  advisorAuthMiddleware,
  verifyCrmJwtToken,
  verifyAdvisorToken: verifyAdvisorTokenFlexible,
  readJwtFromRequest
});

app.get('/api/outbound-media/:file', (req, res) => {
  const ua = String(req.get('user-agent') || '').slice(0, 160);
  const safe = path.basename(req.params.file);
  const logServe = (httpStatus) => {
    logEvent('outbound_media', 'serve', { file: safe, httpStatus, ua });
  };
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[^./]+$/i.test(
      safe
    )
  ) {
    logServe(400);
    return res.status(400).end();
  }
  const full = path.join(outboundDir, safe);
  if (!fs.existsSync(full)) {
    logServe(404);
    return res.status(404).end();
  }

  const mime = outboundContentType(safe);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (err) {
    logEvent('outbound_media', 'stream_error', { file: safe, error: err.message });
    logServe(500);
    return res.status(500).end();
  }
  const size = stat.size;
  const range = req.headers.range;

  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/i.exec(String(range).trim());
    if (m) {
      const start = parseInt(m[1], 10);
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.setHeader('Content-Range', `bytes */${size}`);
        logServe(416);
        return res.status(416).end();
      }
      if (end >= size) end = size - 1;
      const chunk = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunk);
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, max-age=300');
      const stream = fs.createReadStream(full, { start, end });
      stream.on('error', (err) => {
        logEvent('outbound_media', 'stream_error', { file: safe, error: err.message });
        if (!res.headersSent) res.status(500).end();
      });
      res.on('finish', () => logServe(res.statusCode || 206));
      stream.pipe(res);
      return;
    }
  }

  res.status(200);
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const stream = fs.createReadStream(full);
  stream.on('error', (err) => {
    logEvent('outbound_media', 'stream_error', { file: safe, error: err.message });
    if (!res.headersSent) res.status(500).end();
  });
  res.on('finish', () => logServe(res.statusCode || 200));
  stream.pipe(res);
});

function validateTwilio(req) {
  if (!currentValidateSig() || process.env.NODE_ENV === 'development') return true;
  const sig = req.headers['x-twilio-signature'];
  const twilioToken = currentTwilioToken();
  if (!sig || !twilioToken) return false;
  return twilio.validateRequest(twilioToken, sig, currentWebhookUrl(), req.body);
}

function inferMessageType(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('application/pdf') || ct.includes('officedocument') || ct.startsWith('text/')) {
    return 'document';
  }
  return 'document';
}

function resolveStreamContentType(upstreamCt, hint) {
  const up = String(upstreamCt || '').trim();
  const h = String(hint || '').trim();
  const upLo = up.toLowerCase();
  if (up && upLo !== 'application/octet-stream') return up;
  if (h && h.toLowerCase() !== 'application/octet-stream') return h;
  return up || h || 'application/octet-stream';
}

function twilioHostNeedsBasicAuth(hostname) {
  return hostname === 'api.twilio.com';
}

function pipeTwilioMedia(mediaUrl, clientReq, res, contentTypeHint) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const twilioSid = currentTwilioSid();
    const twilioToken = currentTwilioToken();
    if (!twilioSid || !twilioToken || !mediaUrl) {
      res.status(503).end();
      return done();
    }

    const authHeader = `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`;
    const rangeFirstHop = clientReq?.headers?.range;

    function pipeSuccess(upstream, rangeWasSent) {
      const ct = resolveStreamContentType(
        upstream.headers['content-type'],
        contentTypeHint
      );
      res.status(upstream.statusCode);
      res.setHeader('Content-Type', ct);
      const cl = upstream.headers['content-length'];
      if (cl) res.setHeader('Content-Length', cl);
      if (upstream.statusCode === 206 && upstream.headers['content-range']) {
        res.setHeader('Content-Range', upstream.headers['content-range']);
      }
      const ar = upstream.headers['accept-ranges'];
      if (ar) res.setHeader('Accept-Ranges', ar);
      else if (upstream.statusCode === 206 || rangeWasSent) {
        res.setHeader('Accept-Ranges', 'bytes');
      }
      res.setHeader('Cache-Control', 'private, max-age=300');

      upstream.pipe(res);
      res.on('finish', done);
      res.on('close', done);
      upstream.on('error', (e) => {
        console.error('pipeTwilioMedia upstream:', e.message);
        if (!res.headersSent) res.status(502).end();
        done();
      });
    }

    function doGet(urlString, depth) {
      if (depth > 8) {
        if (!res.headersSent) res.status(502).end();
        return done();
      }

      let u;
      try {
        u = new URL(urlString);
      } catch {
        if (!res.headersSent) res.status(400).end();
        return done();
      }

      const headers = {};
      if (twilioHostNeedsBasicAuth(u.hostname)) {
        headers.Authorization = authHeader;
      } else {
        headers['User-Agent'] =
          'Mozilla/5.0 (compatible; TecnoXpertCRM/1.0) AppleWebKit/537.36';
        headers.Accept =
          'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
      }
      if (depth === 0 && rangeFirstHop) {
        headers.Range = rangeFirstHop;
      }

      const opts = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + u.search,
        headers,
        timeout: 60000
      };
      const mod = u.protocol === 'https:' ? https : http;
      const reqOut = mod.get(opts, (up) => {
        const code = up.statusCode;
        if ([301, 302, 303, 307, 308].includes(code) && up.headers.location) {
          const next = new URL(String(up.headers.location), urlString).href;
          up.resume();
          return doGet(next, depth + 1);
        }

        const ok = code === 200 || code === 206;
        if (!ok) {
          if (!res.headersSent) res.status(code === 404 ? 404 : 502).end();
          up.resume();
          return done();
        }

        pipeSuccess(up, Boolean(depth === 0 && rangeFirstHop));
      });

      reqOut.on('error', (e) => {
        console.error('pipeTwilioMedia:', e.message);
        if (!res.headersSent) res.status(502).end();
        done();
      });
      reqOut.on('timeout', () => {
        reqOut.destroy();
        if (!res.headersSent) res.status(504).end();
        done();
      });
    }

    doGet(mediaUrl, 0);
  });
}

function looksLikeExternalProfilePicUrl(u) {
  const s = String(u || '').trim();
  if (!/^https?:\/\//i.test(s)) return false;
  const low = s.toLowerCase();
  return (
    low.includes('whatsapp') ||
    low.includes('fbcdn.net') ||
    low.includes('facebook.com') ||
    low.includes('instagram.') ||
    low.includes('twilio.com')
  );
}

function findAvatarUrlInObject(obj, depth) {
  const d = depth || 0;
  if (d > 10 || obj == null) return null;
  if (typeof obj === 'string' && looksLikeExternalProfilePicUrl(obj)) return obj.trim();
  if (typeof obj !== 'object') return null;
  for (const k of Object.keys(obj)) {
    const lk = k.toLowerCase();
    if (
      (lk.includes('profile') || lk.includes('avatar') || lk.includes('photo')) &&
      (lk.includes('picture') || lk.includes('photo') || lk.includes('image') || lk.includes('url') || lk.includes('avatar'))
    ) {
      const v = obj[k];
      if (typeof v === 'string' && looksLikeExternalProfilePicUrl(v)) return v.trim();
    }
  }
  for (const v of Object.values(obj)) {
    const found = findAvatarUrlInObject(v, d + 1);
    if (found) return found;
  }
  return null;
}

/** Twilio no documenta siempre la URL; probamos varios nombres y ChannelMetadata. */
function extractWhatsAppProfileAvatarUrl(body) {
  if (!body || typeof body !== 'object') return null;
  const directKeys = [
    'ProfilePictureUrl',
    'ProfileImageUrl',
    'ProfilePicture',
    'WaProfilePictureUrl',
    'SenderProfilePictureUrl',
    'ProfilePhotoUrl',
    'ProfilePicUrl',
    'UserProfilePictureUrl'
  ];
  for (const k of directKeys) {
    const v = body[k];
    if (v && looksLikeExternalProfilePicUrl(v)) return String(v).trim();
  }
  const cm = body.ChannelMetadata;
  if (cm && typeof cm === 'string') {
    try {
      const j = JSON.parse(cm);
      const found = findAvatarUrlInObject(j, 0);
      if (found) return found;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function collectInboundMediaAttachments(body) {
  const items = [];
  if (!body || typeof body !== 'object') return items;
  for (const key of Object.keys(body)) {
    const m = /^MediaUrl(\d+)$/.exec(key);
    if (!m) continue;
    const idx = parseInt(m[1], 10);
    if (!Number.isFinite(idx) || idx < 0 || idx > 9) continue;
    const url = body[key];
    if (!url || typeof url !== 'string') continue;
    const contentType =
      body[`MediaContentType${idx}`] || 'application/octet-stream';
    items.push({ idx, url, contentType });
  }
  items.sort((a, b) => a.idx - b.idx);
  return items.map(({ url, contentType }) => ({ url, contentType }));
}

// —— Twilio: mensajes entrantes WhatsApp ——
app.post('/webhook', (req, res) => {
  if (!validateTwilio(req)) {
    console.warn('Webhook rechazado: firma Twilio inválida');
    return res.status(403).send('Forbidden');
  }

  const From = req.body.From;
  const Body = req.body.Body || '';
  const MessageSid = req.body.MessageSid || null;
  const ProfileName = req.body.ProfileName || null;
  const numMediaDeclared = Math.min(
    10,
    parseInt(req.body.NumMedia || '0', 10) || 0
  );
  let attachments = collectInboundMediaAttachments(req.body);
  if (
    attachments.length === 0 &&
    req.body.ReferralMediaUrl &&
    String(req.body.ReferralMediaUrl).startsWith('http')
  ) {
    attachments.push({
      url: req.body.ReferralMediaUrl,
      contentType: req.body.ReferralMediaContentType || 'image/jpeg'
    });
  }
  let messageType = 'text';
  if (attachments.length > 0) {
    messageType = inferMessageType(attachments[0].contentType);
  }

  const customer = normalizeCustomerPhone(From);
  if (!customer) {
    logEvent('webhook', 'skipped', {
      reason: 'from_not_normalized',
      fromSample: String(From || '').slice(0, 40)
    });
    return res.type('text/xml').send('<Response></Response>');
  }

  /** Twilio a veces notifica al mismo webhook con From = número del negocio y sin cuerpo (p. ej. al enviar desde el CRM). */
  const ourDigits = normalizeCustomerPhone(currentWhatsappFrom());
  if (ourDigits && customer === ourDigits) {
    logEvent('webhook', 'skipped', {
      reason: 'from_is_business_number',
      fromSample: String(From || '').slice(0, 40)
    });
    return res.type('text/xml').send('<Response></Response>');
  }

  const bodyText = String(Body || '').trim();
  if (!bodyText && attachments.length === 0) {
    logEvent('webhook', 'skipped', {
      reason: 'no_body_no_media',
      customer,
      numMediaDeclared,
      mediaUrlParamCount: Object.keys(req.body).filter((k) =>
        /^MediaUrl\d+$/.test(k)
      ).length
    });
    return res.type('text/xml').send('<Response></Response>');
  }

  const now = new Date().toISOString();

  let conv = db.prepare('SELECT * FROM conversations WHERE customer_phone = ?').get(customer);
  let createdConversation = false;
  if (!conv) {
    const r = db
      .prepare(
        `INSERT INTO conversations (
           customer_phone, profile_name, last_message_at, unread_inbound, last_inbound_at
         ) VALUES (?, ?, ?, 1, ?)`
      )
      .run(customer, ProfileName, now, now);
    conv = { id: r.lastInsertRowid, customer_phone: customer, profile_name: ProfileName };
    createdConversation = true;
  } else {
    db.prepare(
      `UPDATE conversations SET last_message_at = ?, last_inbound_at = ?, unread_inbound = unread_inbound + 1,
       profile_name = COALESCE(?, profile_name) WHERE id = ?`
    ).run(now, now, ProfileName, conv.id);
  }

  const inboundAvatarUrl = extractWhatsAppProfileAvatarUrl(req.body);
  if (inboundAvatarUrl) {
    db.prepare(
      `UPDATE conversations SET profile_avatar_url = ? WHERE customer_phone = ?`
    ).run(inboundAvatarUrl, customer);
  }

  const convRow = db.prepare('SELECT * FROM conversations WHERE customer_phone = ?').get(customer);
  if (createdConversation) {
    recordCrmEvent(
      convRow.id,
      customer,
      'lead_created',
      {
        source: 'whatsapp_webhook',
        profile_name: ProfileName || null
      },
      now
    );
  }

  const attachmentsJson = attachments.length ? JSON.stringify(attachments) : null;

  let stored = false;
  try {
    db.prepare(
      `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
       VALUES (?, 'inbound', ?, ?, 'received', ?, ?, ?)`
    ).run(convRow.id, bodyText, MessageSid, now, messageType, attachmentsJson);
    stored = true;
  } catch (e) {
    if (!String(e.message).includes('UNIQUE')) throw e;
    if (MessageSid && attachments.length > 0) {
      const row = db
        .prepare(`SELECT attachments FROM messages WHERE twilio_sid = ?`)
        .get(MessageSid);
      let prev = [];
      try {
        prev = row?.attachments ? JSON.parse(row.attachments) : [];
      } catch {
        prev = [];
      }
      const prevMissing =
        !Array.isArray(prev) ||
        prev.length === 0 ||
        prev.every((p) => !p || !p.url);
      const moreMediaThanBefore = attachments.length > prev.length;
      if (prevMissing || moreMediaThanBefore) {
        db.prepare(
          `UPDATE messages SET attachments = ?, message_type = ? WHERE twilio_sid = ?`
        ).run(JSON.stringify(attachments), messageType, MessageSid);
        stored = true;
        logEvent('webhook', 'media_backfill', {
          customer,
          messageSidShort: MessageSid.slice(0, 12),
          attachmentCount: attachments.length,
          previousCount: Array.isArray(prev) ? prev.length : 0
        });
      } else {
        logEvent('webhook', 'duplicate_ignored', {
          customer,
          messageSidShort: MessageSid.slice(0, 12)
        });
      }
    }
  }

  if (stored) {
    logEvent('webhook', 'inbound_stored', {
      customer,
      attachmentCount: attachments.length,
      numMediaDeclared,
      messageType,
      hasBody: Boolean(bodyText)
    });
    if (bodyText) {
      const spamAuto = autoMarkSpamIfInboundMatches(
        customer,
        convRow.id,
        bodyText,
        messageType
      );
      if (!spamAuto) {
        applyInboundServiceKeywordTags(customer, bodyText, now);
      }
    }
    handleInboundCommercialActivity({
      conversationId: convRow.id,
      customerPhone: customer,
      pipelineLabel: convRow.pipeline_label,
      bodyText,
      attachments,
      messageType,
      createdAt: now
    });
    queueAdvisorWhatsAppAlertsForInbound(convRow, {
      bodyText,
      messageType,
      now
    });
  }

  io.emit('crm:update', { type: 'inbound', customer_phone: customer });

  res.type('text/xml').send('<Response></Response>');

  scheduleOpenAiWhatsAppReply({
    customer,
    conversationId: convRow.id,
    bodyText,
    stored
  });
});

// —— API CRM ——
app.get('/api/health', (req, res) => {
  const q = String(req.query?.cotizaciones_ping || '').toLowerCase();
  const withCotizPing = q === '1' || q === 'true';
  const twilioApi = getTwilioClient();
  const openaiApiKey = currentOpenAiApiKey();
  const payload = {
    ok: true,
    business_name: currentBusinessName(),
    business_tagline: currentBusinessTagline(),
    twilio: !!twilioApi,
    webhook: currentWebhookUrl(),
    from: currentWhatsappFrom(),
    openai: Boolean(openaiApiKey),
    openai_bot: currentOpenAiBotEnabled() && Boolean(twilioApi),
    openai_model: openaiApiKey ? currentOpenAiModel() : null,
    advisor_portal: Boolean(getJwtSecret()),
    crm_auth: Boolean(currentCrmJwtSecret()),
    pipeline_labels: PIPELINE_LABEL_PRESETS,
    crm_panel_login_paths: ['/api/crm-auth/login', '/api/crmpanel/login'],
    cotizaciones_ia_paths: [
      'POST /api/messages/cotizacion-chat (recomendado si Apache proxifica mal /api/cotizacion*)',
      'POST /api/messages/cotizacion-pdf',
      'POST /api/cotizacion-ia/chat (alias)',
      'POST /api/cotizacion-ia/pdf (alias)',
      'GET /api/health?cotizaciones_ping=1 (diagnóstico si Apache solo reenvía /api/health)',
      'GET /api/health/cotizaciones-ia-ping (alias)',
      'GET /api/cotizaciones-ia-ping (alias)'
    ],
    cotizaciones_ia_ping_build: COTIZACIONES_IA_PING_BUILD,
    cotizaciones_ia_mount: 'Router /api/messages + /api/cotizacion-ia antes del gate CRM'
  };
  if (withCotizPing) {
    payload.cotizaciones_ia = {
      ok: true,
      service: 'cotizaciones-ia',
      build: COTIZACIONES_IA_PING_BUILD,
      time: new Date().toISOString(),
      post_chat: '/api/messages/cotizacion-chat',
      post_pdf: '/api/messages/cotizacion-pdf',
      note:
        'Si ves esto pero POST /api/messages/cotizacion-chat da 401 corto, Apache no reenvía todo /api al mismo Node: unificá ProxyPass /api → Node.'
    };
  }
  res.json(payload);
});

app.get('/api/business-settings', (_req, res) => {
  const payload = getBusinessSettingsForClient({ port: PORT });
  res.json({ ok: true, ...payload });
});

app.patch('/api/business-settings', (req, res) => {
  try {
    const result = updateBusinessSettings(req.body || {}, { port: PORT });
    const payload = getBusinessSettingsForClient({ port: PORT });
    const crmJwtSecret = currentCrmJwtSecret();
    const nextToken = crmJwtSecret
      ? jwt.sign({ crm: 1 }, crmJwtSecret, { expiresIn: '7d' })
      : null;
    res.json({
      ok: true,
      message: 'Ajustes del negocio guardados',
      changed_keys: result.changed_keys,
      auth_changed: result.auth_changed,
      next_token: nextToken,
      ...payload
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: err.message || 'No se pudieron guardar los ajustes del negocio'
    });
  }
});

app.get('/api/dashboard/summary', (_req, res) => {
  const conversations = db
    .prepare(
      `SELECT c.id, c.customer_phone, c.profile_name, c.lead_name, c.company_name, c.lead_source,
              c.city, c.priority, c.pipeline_label, c.conv_status, c.unread_inbound,
              c.last_message_at, c.next_follow_up_at, c.assigned_advisor_id,
              a.full_name AS assigned_advisor_name
       FROM conversations c
       LEFT JOIN advisors a ON a.id = c.assigned_advisor_id
       ORDER BY datetime(c.last_message_at) DESC`
    )
    .all();
  const pendingFollowUps = db
    .prepare(
      `SELECT fu.*, COALESCE(c.lead_name, c.profile_name) AS display_name,
              c.pipeline_label, c.priority, a.full_name AS assigned_advisor_name
       FROM follow_ups fu
       JOIN conversations c ON c.id = fu.conversation_id
       LEFT JOIN advisors a ON a.id = fu.assigned_advisor_id
       WHERE fu.status = 'pending'
       ORDER BY datetime(fu.due_at) ASC, fu.id ASC`
    )
    .all()
    .map(serializeFollowUpRow);
  const advisors = db
    .prepare(
      `SELECT id, full_name, is_active
       FROM advisors
       WHERE is_active = 1
       ORDER BY sort_order ASC, full_name ASC`
    )
    .all();

  const counts = {
    total_conversations: conversations.length,
    inbox: 0,
    spam: 0,
    blocked: 0,
    unread_inbox: 0,
    active_negotiations: 0,
    quote_sent: 0,
    won: 0,
    lost: 0,
    pending_followups: pendingFollowUps.length,
    overdue_followups: 0,
    due_today: 0
  };
  const todayKey = new Date().toISOString().slice(0, 10);
  const stageMap = new Map();
  for (const conv of conversations) {
    const folder = String(conv.conv_status || 'inbox').toLowerCase();
    if (folder === 'spam') counts.spam += 1;
    else if (folder === 'blocked') counts.blocked += 1;
    else {
      counts.inbox += 1;
      counts.unread_inbox += Number(conv.unread_inbound) || 0;
    }
    if (pipelineIsNegotiationLabel(conv.pipeline_label)) counts.active_negotiations += 1;
    if (String(conv.pipeline_label || '') === 'Cotización enviada') counts.quote_sent += 1;
    if (String(conv.pipeline_label || '') === PIPELINE_CLOSED_WON) counts.won += 1;
    if (String(conv.pipeline_label || '') === PIPELINE_CLOSED_LOST) counts.lost += 1;
    const key = String(conv.pipeline_label || 'Sin etapa');
    stageMap.set(key, (stageMap.get(key) || 0) + 1);
  }
  for (const followUp of pendingFollowUps) {
    if (followUp.state === 'overdue') counts.overdue_followups += 1;
    if (String(followUp.due_at || '').slice(0, 10) === todayKey) counts.due_today += 1;
  }

  const staleConversations = conversations
    .filter((conv) => {
      const stage = String(conv.pipeline_label || '');
      if (PIPELINE_CLOSED_STAGES.has(stage)) return false;
      const folder = String(conv.conv_status || 'inbox').toLowerCase();
      if (folder !== 'inbox') return false;
      const ts = Date.parse(conv.last_message_at || '');
      if (!Number.isFinite(ts)) return false;
      return Date.now() - ts >= 48 * 60 * 60 * 1000;
    })
    .slice(0, 8);

  const advisorLoad = advisors.map((advisor) => ({
    id: advisor.id,
    full_name: advisor.full_name,
    active_negotiations: conversations.filter(
      (conv) =>
        Number(conv.assigned_advisor_id) === Number(advisor.id) &&
        pipelineIsNegotiationLabel(conv.pipeline_label) &&
        String(conv.conv_status || 'inbox') === 'inbox'
    ).length,
    pending_followups: pendingFollowUps.filter(
      (followUp) => Number(followUp.assigned_advisor_id) === Number(advisor.id)
    ).length
  }));

  res.json({
    counts,
    stage_counts: Array.from(stageMap.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label, 'es')),
    followups_due: pendingFollowUps.slice(0, 10),
    stale_conversations: staleConversations,
    advisor_load: advisorLoad,
    hot_pipeline: conversations.slice(0, 10),
    pipeline_labels: PIPELINE_LABEL_PRESETS
  });
});

app.get('/api/conversations/:phone/profile', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const row = db
    .prepare(
      `SELECT c.id, c.customer_phone, c.profile_name, c.lead_name, c.company_name, c.lead_source,
              c.city, c.priority, c.budget_label, c.budget_value, c.internal_notes, c.lost_reason,
              c.pipeline_label, c.next_follow_up_at, c.last_inbound_at, c.last_outbound_at,
              c.last_summary, c.last_summary_updated_at, c.handoff_summary, c.handoff_summary_updated_at,
              c.assigned_advisor_id, a.full_name AS assigned_advisor_name
       FROM conversations c
       LEFT JOIN advisors a ON a.id = c.assigned_advisor_id
       WHERE c.customer_phone = ?`
    )
    .get(phone);
  if (!row) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  const openFollowUps = db
    .prepare(`SELECT COUNT(*) AS n FROM follow_ups WHERE conversation_id = ? AND status = 'pending'`)
    .get(row.id);
  const overdueFollowUps = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM follow_ups
       WHERE conversation_id = ? AND status = 'pending' AND datetime(due_at) < datetime('now')`
    )
    .get(row.id);
  res.json({
    ...row,
    display_name: row.lead_name || row.profile_name || phone,
    open_followups: openFollowUps?.n || 0,
    overdue_followups: overdueFollowUps?.n || 0,
    pipeline_labels: PIPELINE_LABEL_PRESETS
  });
});

app.patch('/api/conversations/:phone/profile', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const current = db
    .prepare(
      `SELECT id, lead_name, company_name, lead_source, city, priority,
              budget_label, budget_value, internal_notes, lost_reason
       FROM conversations WHERE customer_phone = ?`
    )
    .get(phone);
  if (!current) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }

  const leadName = String(req.body?.lead_name || '')
    .trim()
    .slice(0, 160);
  const companyName = String(req.body?.company_name || '')
    .trim()
    .slice(0, 160);
  const leadSource = String(req.body?.lead_source || '')
    .trim()
    .slice(0, 120);
  const city = String(req.body?.city || '')
    .trim()
    .slice(0, 120);
  const budgetLabel = String(req.body?.budget_label || '')
    .trim()
    .slice(0, 160);
  const internalNotes = String(req.body?.internal_notes || '')
    .trim()
    .slice(0, 4000);
  const lostReason = String(req.body?.lost_reason || '')
    .trim()
    .slice(0, 500);
  const priority = normalizePriority(req.body?.priority);
  let budgetValue = null;
  if (req.body?.budget_value !== null && req.body?.budget_value !== undefined && req.body?.budget_value !== '') {
    const parsed = Number(req.body.budget_value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return res.status(400).json({ ok: false, error: 'budget_value inválido' });
    }
    budgetValue = parsed;
  }

  db.prepare(
    `UPDATE conversations
     SET lead_name = ?, company_name = ?, lead_source = ?, city = ?, priority = ?,
         budget_label = ?, budget_value = ?, internal_notes = ?, lost_reason = ?
     WHERE customer_phone = ?`
  ).run(
    leadName || null,
    companyName || null,
    leadSource || null,
    city || null,
    priority,
    budgetLabel || null,
    budgetValue,
    internalNotes || null,
    lostReason || null,
    phone
  );
  const changedFields = changedFieldsPayload(current, nextProfileState);
  if (Object.keys(changedFields).length) {
    recordCrmEvent(current.id, phone, 'profile_updated', {
      actor: 'crm',
      changed_fields: changedFields
    });
  }
  io.emit('crm:update', { type: 'profile', customer_phone: phone });
  const updated = db
    .prepare(
      `SELECT c.id, c.customer_phone, c.profile_name, c.lead_name, c.company_name, c.lead_source,
              c.city, c.priority, c.budget_label, c.budget_value, c.internal_notes, c.lost_reason,
              c.pipeline_label, c.next_follow_up_at, c.last_inbound_at, c.last_outbound_at,
              c.last_summary, c.last_summary_updated_at, c.handoff_summary, c.handoff_summary_updated_at,
              c.assigned_advisor_id, a.full_name AS assigned_advisor_name
       FROM conversations c
       LEFT JOIN advisors a ON a.id = c.assigned_advisor_id
       WHERE c.customer_phone = ?`
    )
    .get(phone);
  res.json({
    ...updated,
    display_name: updated.lead_name || updated.profile_name || phone
  });
});

app.get('/api/conversations/:phone/followups', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const conv = db.prepare(`SELECT id FROM conversations WHERE customer_phone = ?`).get(phone);
  if (!conv) return res.json([]);
  refreshConversationNextFollowUp(conv.id);
  const rows = db
    .prepare(
      `SELECT fu.*, a.full_name AS assigned_advisor_name
       FROM follow_ups fu
       LEFT JOIN advisors a ON a.id = fu.assigned_advisor_id
       WHERE fu.conversation_id = ?
       ORDER BY CASE fu.status WHEN 'pending' THEN 0 WHEN 'done' THEN 1 ELSE 2 END,
                datetime(fu.due_at) ASC,
                fu.id ASC`
    )
    .all(conv.id);
  res.json(rows.map(serializeFollowUpRow));
});

app.post('/api/conversations/:phone/followups', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const conv = db.prepare(`SELECT id FROM conversations WHERE customer_phone = ?`).get(phone);
  if (!conv) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  const title = String(req.body?.title || '')
    .trim()
    .slice(0, 160);
  if (!title) {
    return res.status(400).json({ ok: false, error: 'Título obligatorio' });
  }
  const dueAt = normalizeIsoDateInput(req.body?.due_at);
  if (!dueAt) {
    return res.status(400).json({ ok: false, error: 'Fecha de seguimiento inválida' });
  }
  const description = String(req.body?.description || '')
    .trim()
    .slice(0, 1000);
  const kind = String(req.body?.kind || 'manual')
    .trim()
    .slice(0, 80) || 'manual';
  let assignedAdvisorId = null;
  if (req.body?.assigned_advisor_id !== null && req.body?.assigned_advisor_id !== undefined && req.body?.assigned_advisor_id !== '') {
    const candidate = Number(req.body.assigned_advisor_id);
    if (!Number.isFinite(candidate) || candidate < 1) {
      return res.status(400).json({ ok: false, error: 'assigned_advisor_id inválido' });
    }
    const advisor = db.prepare(`SELECT id FROM advisors WHERE id = ? AND is_active = 1`).get(candidate);
    if (!advisor) {
      return res.status(404).json({ ok: false, error: 'Asesor no encontrado' });
    }
    assignedAdvisorId = candidate;
  }
  const now = isoNow();
  const insert = db
    .prepare(
      `INSERT INTO follow_ups (
         conversation_id, customer_phone, title, description, due_at,
         status, kind, assigned_advisor_id, created_by, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'crm', ?, ?)`
    )
    .run(conv.id, phone, title, description || null, dueAt, kind, assignedAdvisorId, now, now);
  refreshConversationNextFollowUp(conv.id);
  const created = db
    .prepare(
      `SELECT fu.*, a.full_name AS assigned_advisor_name
       FROM follow_ups fu
       LEFT JOIN advisors a ON a.id = fu.assigned_advisor_id
       WHERE fu.id = ?`
    )
    .get(insert.lastInsertRowid);
  recordCrmEvent(conv.id, phone, 'followup_created', {
    actor: 'crm',
    followup_id: Number(insert.lastInsertRowid),
    title,
    due_at: dueAt,
    kind,
    assigned_advisor_id: assignedAdvisorId
  });
  io.emit('crm:update', { type: 'followup', customer_phone: phone });
  res.status(201).json(serializeFollowUpRow(created));
});

app.patch('/api/followups/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, error: 'ID inválido' });
  }
  const current = db.prepare(`SELECT * FROM follow_ups WHERE id = ?`).get(id);
  if (!current) {
    return res.status(404).json({ ok: false, error: 'Seguimiento no encontrado' });
  }
  let title = current.title;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'title')) {
    title = String(req.body.title || '')
      .trim()
      .slice(0, 160);
    if (!title) return res.status(400).json({ ok: false, error: 'Título obligatorio' });
  }
  let description = current.description || null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'description')) {
    description =
      String(req.body.description || '')
        .trim()
        .slice(0, 1000) || null;
  }
  let dueAt = current.due_at;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'due_at')) {
    const nextDueAt = normalizeIsoDateInput(req.body.due_at);
    if (!nextDueAt) {
      return res.status(400).json({ ok: false, error: 'Fecha de seguimiento inválida' });
    }
    dueAt = nextDueAt;
  }
  let status = current.status;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'status')) {
    const candidate = String(req.body.status || '')
      .trim()
      .toLowerCase();
    if (!FOLLOW_UP_STATUS_VALUES.has(candidate)) {
      return res.status(400).json({ ok: false, error: 'Estado inválido' });
    }
    status = candidate;
  }
  let assignedAdvisorId = current.assigned_advisor_id || null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'assigned_advisor_id')) {
    if (req.body.assigned_advisor_id === null || req.body.assigned_advisor_id === '') {
      assignedAdvisorId = null;
    } else {
      const candidate = Number(req.body.assigned_advisor_id);
      if (!Number.isFinite(candidate) || candidate < 1) {
        return res.status(400).json({ ok: false, error: 'assigned_advisor_id inválido' });
      }
      const advisor = db.prepare(`SELECT id FROM advisors WHERE id = ? AND is_active = 1`).get(candidate);
      if (!advisor) return res.status(404).json({ ok: false, error: 'Asesor no encontrado' });
      assignedAdvisorId = candidate;
    }
  }
  const now = isoNow();
  const doneAt = status === 'done' ? now : null;
  const changedFields = changedFieldsPayload(current, {
    title,
    description,
    due_at: dueAt,
    status,
    assigned_advisor_id: assignedAdvisorId
  });
  db.prepare(
    `UPDATE follow_ups
     SET title = ?, description = ?, due_at = ?, status = ?,
         assigned_advisor_id = ?, updated_at = ?, done_at = ?
     WHERE id = ?`
  ).run(title, description, dueAt, status, assignedAdvisorId, now, doneAt, id);
  refreshConversationNextFollowUp(current.conversation_id);
  const updated = db
    .prepare(
      `SELECT fu.*, a.full_name AS assigned_advisor_name
       FROM follow_ups fu
       LEFT JOIN advisors a ON a.id = fu.assigned_advisor_id
       WHERE fu.id = ?`
    )
    .get(id);
  if (Object.keys(changedFields).length) {
    recordCrmEvent(current.conversation_id, current.customer_phone, 'followup_updated', {
      actor: 'crm',
      followup_id: id,
      changed_fields: changedFields
    });
  }
  io.emit('crm:update', { type: 'followup', customer_phone: current.customer_phone });
  res.json(serializeFollowUpRow(updated));
});

app.delete('/api/followups/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, error: 'ID inválido' });
  }
  const current = db.prepare(`SELECT id, conversation_id, customer_phone FROM follow_ups WHERE id = ?`).get(id);
  if (!current) {
    return res.status(404).json({ ok: false, error: 'Seguimiento no encontrado' });
  }
  const deletedFollowUp = db
    .prepare(`SELECT title, due_at, kind, assigned_advisor_id FROM follow_ups WHERE id = ?`)
    .get(id);
  db.prepare(`DELETE FROM follow_ups WHERE id = ?`).run(id);
  refreshConversationNextFollowUp(current.conversation_id);
  recordCrmEvent(current.conversation_id, current.customer_phone, 'followup_deleted', {
    actor: 'crm',
    followup_id: id,
    title: deletedFollowUp?.title || null,
    due_at: deletedFollowUp?.due_at || null,
    kind: deletedFollowUp?.kind || null,
    assigned_advisor_id: deletedFollowUp?.assigned_advisor_id ?? null
  });
  io.emit('crm:update', { type: 'followup', customer_phone: current.customer_phone });
  res.json({ ok: true });
});

app.post('/api/conversations/:phone/ai-summary', async (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const conv = db.prepare(`SELECT id FROM conversations WHERE customer_phone = ?`).get(phone);
  if (!conv) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  if (!currentOpenAiApiKey()) {
    return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY no configurada' });
  }
  try {
    const summary = await refreshConversationAiSummary(conv.id);
    io.emit('crm:update', { type: 'summary', customer_phone: phone });
    res.json({ ok: true, summary });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'No se pudo generar resumen' });
  }
});

function normalizeAdvisorPhoneInput(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length > 16) return null;
  return d;
}

app.get('/api/advisors', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT ${advisorPublicSelectSql()},
              (SELECT COUNT(*) FROM conversations c WHERE c.assigned_advisor_id = advisors.id AND c.conv_status = 'inbox') AS assigned_clients
       FROM advisors
       ORDER BY sort_order ASC, full_name ASC`
    )
    .all();
  res.json(rows);
});

app.post('/api/advisors', (req, res) => {
  const full_name = String(req.body?.full_name || '').trim();
  if (!full_name || full_name.length > 200) {
    return res.status(400).json({ ok: false, error: 'Nombre obligatorio (máx. 200 caracteres)' });
  }
  const phone = normalizeAdvisorPhoneInput(req.body?.phone);
  const emailRaw = String(req.body?.email || '').trim().slice(0, 200);
  const email = emailRaw || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Correo electrónico inválido' });
  }
  const notes = String(req.body?.notes || '').trim().slice(0, 2000) || null;
  let is_active = 1;
  if (req.body?.is_active === false || req.body?.is_active === 0) is_active = 0;
  let sort_order = Number(req.body?.sort_order);
  if (!Number.isFinite(sort_order)) sort_order = 0;
  let password_hash = null;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
    const pw = String(req.body.password || '');
    if (pw.length > 0) {
      if (pw.length < 6) {
        return res.status(400).json({
          ok: false,
          error: 'La contraseña del portal debe tener al menos 6 caracteres'
        });
      }
      password_hash = hashAdvisorPassword(pw);
    }
  }
  const now = new Date().toISOString();
  const ins = db.prepare(
    `INSERT INTO advisors (full_name, phone, email, notes, is_active, sort_order, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const r = ins.run(full_name, phone, email, notes, is_active, sort_order, password_hash, now, now);
  const row = db
    .prepare(`SELECT ${advisorPublicSelectSql()} FROM advisors WHERE id = ?`)
    .get(r.lastInsertRowid);
  res.status(201).json(row);
});

app.patch('/api/advisors/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, error: 'ID inválido' });
  }
  const cur = db.prepare('SELECT * FROM advisors WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ ok: false, error: 'Asesor no encontrado' });

  let full_name = cur.full_name;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'full_name')) {
    full_name = String(req.body.full_name || '').trim();
    if (!full_name || full_name.length > 200) {
      return res.status(400).json({ ok: false, error: 'Nombre inválido' });
    }
  }
  let phone = cur.phone;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'phone')) {
    phone = normalizeAdvisorPhoneInput(req.body.phone);
  }
  let email = cur.email;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'email')) {
    const emailRaw = String(req.body.email || '').trim().slice(0, 200);
    email = emailRaw || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, error: 'Correo electrónico inválido' });
    }
  }
  let notes = cur.notes;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'notes')) {
    notes = String(req.body.notes || '').trim().slice(0, 2000) || null;
  }
  let is_active = Number(cur.is_active) === 1 ? 1 : 0;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'is_active')) {
    is_active = req.body.is_active === false || req.body.is_active === 0 ? 0 : 1;
  }
  let sort_order = Number(cur.sort_order) || 0;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sort_order')) {
    const so = Number(req.body.sort_order);
    if (Number.isFinite(so)) sort_order = so;
  }
  let password_hash = cur.password_hash;
  if (Object.prototype.hasOwnProperty.call(req.body || {}, 'password')) {
    const pw = String(req.body.password || '');
    if (pw.length === 0) {
      password_hash = null;
    } else if (pw.length < 6) {
      return res.status(400).json({
        ok: false,
        error: 'La contraseña del portal debe tener al menos 6 caracteres'
      });
    } else {
      password_hash = hashAdvisorPassword(pw);
    }
  }
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE advisors SET full_name = ?, phone = ?, email = ?, notes = ?, is_active = ?, sort_order = ?, password_hash = ?, updated_at = ?
     WHERE id = ?`
  ).run(full_name, phone, email, notes, is_active, sort_order, password_hash, now, id);
  const row = db.prepare(`SELECT ${advisorPublicSelectSql()} FROM advisors WHERE id = ?`).get(id);
  res.json(row);
});

app.delete('/api/advisors/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id < 1) {
    return res.status(400).json({ ok: false, error: 'ID inválido' });
  }
  const r = db.prepare('DELETE FROM advisors WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ ok: false, error: 'Asesor no encontrado' });
  res.json({ ok: true });
});

app.post('/api/advisor-auth/login', (req, res) => {
  if (!getJwtSecret()) {
    return res.status(503).json({
      ok: false,
      error: 'Portal de asesores no configurado. Defina ADVISOR_JWT_SECRET en el servidor (.env).'
    });
  }
  const adv = findAdvisorByLogin(req.body?.login);
  const password = String(req.body?.password || '');
  if (!adv || !adv.password_hash) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  if (Number(adv.is_active) !== 1) {
    return res.status(401).json({ ok: false, error: 'Cuenta inactiva' });
  }
  if (!bcrypt.compareSync(password, adv.password_hash)) {
    return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  let token;
  try {
    token = signAdvisorToken(adv.id);
  } catch (e) {
    const msg = e?.code === 'NO_SECRET' ? e.message : 'Error al generar sesión';
    return res.status(503).json({ ok: false, error: msg });
  }
  res.json({
    ok: true,
    token,
    advisor: {
      id: adv.id,
      full_name: adv.full_name,
      email: adv.email,
      phone: adv.phone
    }
  });
});

app.get('/api/advisor/me', advisorAuthMiddleware, (req, res) => {
  res.json({ ok: true, advisor: req.advisor });
});

const ADVISOR_TAKE_LIMIT = 4;

function ensureAdvisorTakeCycleSchema() {
  db.exec(
    `CREATE TABLE IF NOT EXISTS advisor_take_cycles (
      advisor_id INTEGER PRIMARY KEY,
      cycle INTEGER NOT NULL DEFAULT 1,
      take_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (advisor_id) REFERENCES advisors(id) ON DELETE CASCADE
    )`
  );
}

function syncAdvisorTakeCycleRows() {
  ensureAdvisorTakeCycleSchema();
  const now = isoNow();
  const active = db.prepare("SELECT id FROM advisors WHERE is_active = 1 ORDER BY sort_order ASC, id ASC").all();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO advisor_take_cycles (advisor_id, cycle, take_count, updated_at) VALUES (?, 1, 0, ?)'
  );
  for (const advisor of active) insert.run(advisor.id, now);
  return active.map((advisor) => Number(advisor.id));
}

function resetAdvisorTakeCycleIfComplete(activeIds) {
  if (!activeIds.length) return false;
  const placeholders = activeIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT advisor_id, take_count, cycle FROM advisor_take_cycles WHERE advisor_id IN (${placeholders})`
    )
    .all(...activeIds);
  if (rows.length !== activeIds.length) return false;
  const complete = rows.every((row) => Number(row.take_count) >= ADVISOR_TAKE_LIMIT);
  if (!complete) return false;
  const nextCycle = Math.max(...rows.map((row) => Number(row.cycle) || 1)) + 1;
  const now = isoNow();
  db.prepare(
    `UPDATE advisor_take_cycles SET cycle = ?, take_count = 0, updated_at = ? WHERE advisor_id IN (${placeholders})`
  ).run(nextCycle, now, ...activeIds);
  logEvent('advisor_cycle', 'reset', { nextCycle, activeAdvisors: activeIds.length, limit: ADVISOR_TAKE_LIMIT });
  return true;
}

function advisorTurnStatus(advisorId) {
  const activeIds = syncAdvisorTakeCycleRows();
  resetAdvisorTakeCycleIfComplete(activeIds);
  const row = db
    .prepare('SELECT cycle, take_count FROM advisor_take_cycles WHERE advisor_id = ?')
    .get(advisorId);
  const count = Number(row?.take_count || 0);
  return {
    advisor_id: Number(advisorId),
    cycle: Number(row?.cycle || 1),
    limit: ADVISOR_TAKE_LIMIT,
    take_count: count,
    remaining: Math.max(0, ADVISOR_TAKE_LIMIT - count),
    can_take: count < ADVISOR_TAKE_LIMIT
  };
}

const claimConversationWithAdvisorTurn = db.transaction((conversationId, advisorId) => {
  const activeIds = syncAdvisorTakeCycleRows();
  resetAdvisorTakeCycleIfComplete(activeIds);
  const turn = db
    .prepare('SELECT cycle, take_count FROM advisor_take_cycles WHERE advisor_id = ?')
    .get(advisorId);
  const count = Number(turn?.take_count || 0);
  if (count >= ADVISOR_TAKE_LIMIT) {
    return {
      ok: false,
      blocked: true,
      turn: {
        advisor_id: Number(advisorId),
        cycle: Number(turn?.cycle || 1),
        limit: ADVISOR_TAKE_LIMIT,
        take_count: count,
        remaining: 0,
        can_take: false
      }
    };
  }

  const up = db
    .prepare('UPDATE conversations SET assigned_advisor_id = ? WHERE id = ? AND assigned_advisor_id IS NULL')
    .run(advisorId, conversationId);
  if (up.changes === 0) {
    const check = db.prepare('SELECT assigned_advisor_id FROM conversations WHERE id = ?').get(conversationId);
    return { ok: false, conflict: true, assigned_advisor_id: check?.assigned_advisor_id ?? null };
  }

  const now = isoNow();
  db.prepare('UPDATE advisor_take_cycles SET take_count = take_count + 1, updated_at = ? WHERE advisor_id = ?')
    .run(now, advisorId);
  const after = db.prepare('SELECT cycle, take_count FROM advisor_take_cycles WHERE advisor_id = ?').get(advisorId);
  resetAdvisorTakeCycleIfComplete(activeIds);
  return {
    ok: true,
    turn: {
      advisor_id: Number(advisorId),
      cycle: Number(after?.cycle || 1),
      limit: ADVISOR_TAKE_LIMIT,
      take_count: Number(after?.take_count || 0),
      remaining: Math.max(0, ADVISOR_TAKE_LIMIT - Number(after?.take_count || 0)),
      can_take: Number(after?.take_count || 0) < ADVISOR_TAKE_LIMIT
    }
  };
});

app.get('/api/advisor/turn-status', advisorAuthMiddleware, (req, res) => {
  res.json(advisorTurnStatus(req.advisorId));
});

app.get('/api/advisor/negotiations', advisorAuthMiddleware, (req, res) => {
  const me = req.advisorId;
  const turn = advisorTurnStatus(me);
  const includeFree = turn.can_take ? 1 : 0;
  const rows = db
    .prepare(
      `SELECT c.id, c.customer_phone, COALESCE(c.lead_name, c.profile_name) AS real_profile_name,
              c.pipeline_label, c.negotiation_started_at, c.last_message_at, c.assigned_advisor_id,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC LIMIT 1) AS last_body,
              (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC LIMIT 1) AS last_direction,
              c.unread_inbound,
              a.full_name AS assigned_advisor_name
       FROM conversations c
       LEFT JOIN advisors a ON a.id = c.assigned_advisor_id
       WHERE c.conv_status = 'inbox'
         AND (c.assigned_advisor_id = ? OR (? = 1 AND c.assigned_advisor_id IS NULL))
       ORDER BY CASE WHEN c.assigned_advisor_id IS NULL THEN 0 ELSE 1 END, datetime(c.last_message_at) DESC`
    )
    .all(me, includeFree);
  res.json(rows.map((row) => ({
    client_ref: advisorClientRef(row),
    profile_name: advisorClientAlias(row),
    country_code: advisorCountryCode(row),
    pipeline_label: row.pipeline_label,
    negotiation_started_at: row.negotiation_started_at,
    last_message_at: row.last_message_at,
    assigned_advisor_id: row.assigned_advisor_id,
    last_body: row.last_body,
    last_direction: row.last_direction,
    unread_inbound: row.unread_inbound,
    assigned_advisor_name: row.assigned_advisor_name
  })));
});
app.post('/api/advisor/conversations/:phone/take', advisorAuthMiddleware, (req, res) => {
  const row = resolveAdvisorClientRef(req.params.phone);
  if (!row) return res.status(404).json({ ok: false, error: 'Cliente no encontrado' });
  if (String(row.conv_status || 'inbox') !== 'inbox') return res.status(403).json({ ok: false, error: 'Conversacion no disponible' });
  const me = req.advisorId;
  const phone = row.customer_phone;
  const cur = row.assigned_advisor_id;
  if (cur != null && Number(cur) !== Number(me)) return res.status(409).json({ ok: false, error: 'Otro asesor ya tomo este cliente' });
  if (cur != null && Number(cur) === Number(me)) return res.json({ ok: true, assigned_advisor_id: me, already: true });
  const claim = claimConversationWithAdvisorTurn(row.id, me);
  if (!claim.ok) {
    if (claim.blocked) {
      return res.status(429).json({
        ok: false,
        error: 'Ya completaste tus 4 clientes de este ciclo. Espera a que los demas asesores completen su turno.',
        turn: claim.turn
      });
    }
    if (claim.conflict) {
      if (Number(claim.assigned_advisor_id) !== Number(me)) return res.status(409).json({ ok: false, error: 'Otro asesor ya tomo este cliente' });
    }
  }
  db.prepare(`UPDATE follow_ups SET assigned_advisor_id = ?, updated_at = ? WHERE conversation_id = ? AND status = 'pending' AND assigned_advisor_id IS NULL`).run(me, isoNow(), row.id);
  recordCrmEvent(row.id, phone, 'advisor_assigned', { advisor_id: me });
  io.emit('crm:update', { type: 'advisor_take', customer_phone: phone });
  res.json({ ok: true, assigned_advisor_id: me, turn: claim.turn || advisorTurnStatus(me) });
});
/** Embudo al cerrar o mover negociación desde portal asesor (sin "Negociación"). */
const ADVISOR_FINISH_PIPELINE_LABELS = new Set(
  PIPELINE_LABEL_PRESETS.filter((label) => !pipelineIsNegotiationLabel(label))
);

function advisorNegotiationAssignedOrRespond(req, res) {
  const row = resolveAdvisorClientRef(req.params.phone);
  if (!row) { res.status(404).json({ ok: false, error: 'Cliente no encontrado' }); return null; }
  if (String(row.conv_status || 'inbox') !== 'inbox') { res.status(403).json({ ok: false, error: 'Conversacion no disponible' }); return null; }
  if (Number(row.assigned_advisor_id) !== Number(req.advisorId)) { res.status(403).json({ ok: false, error: 'No tienes asignado este cliente' }); return null; }
  return { phoneDigits: row.customer_phone, conversationId: row.id };
}

app.get('/api/advisor/conversations/:phone/messages', advisorAuthMiddleware, (req, res) => {
  const a = advisorNegotiationAssignedOrRespond(req, res);
  if (!a) return;
  const rows = db
    .prepare(
      `SELECT id, direction, body, twilio_sid, status, created_at, message_type, attachments
       FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC`
    )
    .all(a.conversationId);
  res.json(
    rows.map((r) => ({
      ...r,
      message_type: r.message_type || 'text',
      attachments: r.attachments ? safeJsonParse(r.attachments, []) : []
    }))
  );
});

app.post('/api/advisor/conversations/:phone/read', advisorAuthMiddleware, (req, res) => {
  const a = advisorNegotiationAssignedOrRespond(req, res);
  if (!a) return;
  db.prepare('UPDATE conversations SET unread_inbound = 0 WHERE customer_phone = ?').run(
    a.phoneDigits
  );
  io.emit('crm:update', { type: 'read', customer_phone: a.phoneDigits });
  res.json({ ok: true });
});

app.get('/api/advisor/templates', advisorAuthMiddleware, (_req, res) => {
  res.json(
    WHATSAPP_TEMPLATES.map(({ id, label, language, body, variables }) => ({ id, label, language, body, variables }))
  );
});

app.post('/api/advisor/conversations/:phone/send-template', advisorAuthMiddleware, async (req, res) => {
  const a = advisorNegotiationAssignedOrRespond(req, res);
  if (!a) return;
  const twilioApi = getTwilioClient();
  if (!twilioApi) return res.status(503).json({ ok: false, error: 'Twilio no configurado' });

  const templateId = String(req.body?.templateId || req.body?.template || '').trim();
  const tpl = WHATSAPP_TEMPLATES.find((item) => item.id === templateId);
  if (!tpl) return res.status(400).json({ ok: false, error: 'Plantilla no valida' });

  const createOpts = {
    from: currentWhatsappFrom(),
    to: `whatsapp:+${a.phoneDigits}`,
    contentSid: tpl.contentSid
  };
  const variables = req.body?.variables && typeof req.body.variables === 'object' ? req.body.variables : {};
  if (Object.keys(variables).length > 0) createOpts.contentVariables = JSON.stringify(variables);

  const now = new Date().toISOString();
  try {
    const msg = await twilioApi.messages.create(createOpts);
    db.prepare('UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?').run(now, now, a.conversationId);
    db.prepare(
      `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
       VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NULL)`
    ).run(a.conversationId, tpl.body || `Plantilla: ${tpl.label}`, msg.sid, msg.status || 'queued', now);
    recordCrmEvent(a.conversationId, a.phoneDigits, 'advisor_template_sent', {
      advisor_id: req.advisorId,
      template_id: tpl.id,
      content_sid: tpl.contentSid
    });
    io.emit('crm:update', { type: 'outbound', customer_phone: a.phoneDigits });
    res.json({ ok: true, sid: msg.sid, status: msg.status, template: tpl.id });
  } catch (e) {
    console.error('Advisor send template Twilio:', e.message);
    const friendly = twilioUserError(e);
    res.status(friendly.status).json({ ok: false, error: friendly.error, twilioCode: friendly.twilioCode });
  }
});

app.post('/api/advisor/conversations/:phone/send', advisorAuthMiddleware, async (req, res) => {
  const a = advisorNegotiationAssignedOrRespond(req, res);
  if (!a) return;
  const twilioApi = getTwilioClient();
  if (!twilioApi) {
    return res.status(503).json({ ok: false, error: 'Twilio no configurado' });
  }
  const text = String(req.body?.body || '').trim();
  if (!text) {
    return res.status(400).json({ ok: false, error: 'Mensaje vacío' });
  }
  const toWhatsApp = `whatsapp:+${a.phoneDigits}`;
  const now = new Date().toISOString();
  try {
    const msg = await twilioApi.messages.create({
      from: currentWhatsappFrom(),
      to: toWhatsApp,
      body: text
    });
    db.prepare('UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?').run(
      now,
      now,
      a.conversationId
    );
    db.prepare(
      `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
       VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NULL)`
    ).run(a.conversationId, text, msg.sid, msg.status || 'queued', now);
    recordCrmEvent(a.conversationId, a.phoneDigits, 'advisor_message_sent', {
      advisor_id: req.advisorId,
      message_type: 'text',
      preview: eventPreviewText(text)
    });
    io.emit('crm:update', { type: 'outbound', customer_phone: a.phoneDigits });
    res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('Advisor send Twilio:', e.message);
    const friendly = twilioUserError(e);
    res.status(friendly.status).json({ ok: false, error: friendly.error, twilioCode: friendly.twilioCode });
  }
});

app.post(
  '/api/advisor/conversations/:phone/send-media',
  advisorAuthMiddleware,
  handleOutboundUpload,
  async (req, res) => {
    const a = advisorNegotiationAssignedOrRespond(req, res);
    if (!a) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return;
    }
    const twilioApi = getTwilioClient();
    if (!twilioApi) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(503).json({ ok: false, error: 'Twilio no configurado' });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Falta archivo' });
    }

    const origin = publicApiOrigin();
    if (!origin) {
      fs.unlink(req.file.path, () => {});
      return res.status(500).json({
        ok: false,
        error:
          'Configure PUBLIC_WEBHOOK_URL o PUBLIC_API_URL para que Twilio pueda descargar el archivo'
      });
    }

    let mediaFile;
    try {
      mediaFile = await convertOutboundMediaIfNeeded(req.file);
    } catch (e) {
      if (req.file?.path) fs.unlink(req.file.path, () => {});
      return res.status(500).json({ ok: false, error: e.message });
    }

    const filename = path.basename(mediaFile.filename || mediaFile.path);
    const mediaUrl = `${origin}/api/outbound-media/${encodeURIComponent(filename)}`;
    const caption = String(req.body?.body || '').trim();
    const contentType = mediaFile.mimetype || outboundContentType(filename) || 'application/octet-stream';
    const messageType = inferMessageType(contentType);
    const attachmentsJson = JSON.stringify([{ localId: filename, contentType }]);
    const now = new Date().toISOString();
    const toWhatsApp = `whatsapp:+${a.phoneDigits}`;

    const createOpts = {
      from: currentWhatsappFrom(),
      to: toWhatsApp,
      mediaUrl: [mediaUrl]
    };
    if (caption) createOpts.body = caption;

    let msg;
    try {
      msg = await twilioApi.messages.create(createOpts);
    } catch (e) {
      console.error('Advisor send media Twilio:', e.message);
      fs.unlink((mediaFile?.path || req.file.path), () => {});
      const friendly = twilioUserError(e);
      return res.status(friendly.status).json({ ok: false, error: friendly.error, twilioCode: friendly.twilioCode });
    }

    try {
      db.prepare(
        'UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?'
      ).run(now, now, a.conversationId);
      db.prepare(
        `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
         VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?)`
      ).run(
        a.conversationId,
        caption || '',
        msg.sid,
        msg.status || 'queued',
        now,
        messageType,
        attachmentsJson
      );
      recordCrmEvent(a.conversationId, a.phoneDigits, 'advisor_message_sent', {
        advisor_id: req.advisorId,
        message_type: messageType,
        preview: eventPreviewText(caption),
        attachment_count: 1
      });
      io.emit('crm:update', { type: 'outbound', customer_phone: a.phoneDigits });
      res.json({ ok: true, sid: msg.sid, status: msg.status });
    } catch (e) {
      console.error('Advisor guardar multimedia (SQLite):', e.message);
      res.status(500).json({
        ok: false,
        error:
          'El mensaje pudo enviarse por Twilio pero no se guardó en el CRM. Revisa el log de eventos.'
      });
    }
  }
);

/** En esta copia los asesores no liberan clientes: solo el admin reasigna. */
app.post('/api/advisor/conversations/:phone/release', advisorAuthMiddleware, (_req, res) => {
  return res.status(403).json({
    ok: false,
    error: 'Solo el administrador puede reasignar o liberar clientes.'
  });
});

app.post('/api/advisor/conversations/:phone/finish', advisorAuthMiddleware, (req, res) => {
  const a = advisorNegotiationAssignedOrRespond(req, res);
  if (!a) return;
  const label = String(req.body?.pipeline_label ?? '').trim();
  if (!label || !ADVISOR_FINISH_PIPELINE_LABELS.has(label)) {
    return res.status(400).json({
      ok: false,
      error: 'Etapa inválida. Usa una del embudo (excepto Negociación).'
    });
  }
  if (pipelineIsNegotiationLabel(label)) {
    return res.status(400).json({ ok: false, error: 'Elegí una etapa distinta de Negociación' });
  }
  const r = db
    .prepare(
      `UPDATE conversations SET pipeline_label = ?, assigned_advisor_id = NULL
       WHERE customer_phone = ? AND assigned_advisor_id = ?`
    )
    .run(label, a.phoneDigits, req.advisorId);
  if (r.changes === 0) {
    return res.status(409).json({ ok: false, error: 'No se pudo actualizar (estado cambió)' });
  }
  schedulePipelineAutomations({
    conversationId: a.conversationId,
    customerPhone: a.phoneDigits,
    pipelineLabel: label,
    assignedAdvisorId: null
  });
  recordCrmEvent(a.conversationId, a.phoneDigits, 'advisor_finished_stage', {
    advisor_id: req.advisorId,
    pipeline_label: label
  });
  io.emit('crm:update', { type: 'advisor_finish', customer_phone: a.phoneDigits, pipeline_label: label });
  res.json({ ok: true, pipeline_label: label });
});

app.get('/api/conversations', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*,
        COALESCE(c.lead_name, c.profile_name) AS display_name,
        (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC LIMIT 1) AS last_body,
        (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id ORDER BY datetime(m.created_at) DESC LIMIT 1) AS last_message_type,
        (SELECT GROUP_CONCAT(s.name, ' · ')
           FROM conversation_services cs
           JOIN services s ON s.id = cs.service_id AND s.is_active = 1
           WHERE cs.customer_phone = c.customer_phone) AS service_tags,
        aa.full_name AS assigned_advisor_name
       FROM conversations c
       LEFT JOIN advisors aa ON aa.id = c.assigned_advisor_id
       ORDER BY datetime(c.last_message_at) DESC`
    )
    .all();
  res.json(rows);
});

app.get('/api/conversations/:phone/messages', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const conv = db.prepare('SELECT id FROM conversations WHERE customer_phone = ?').get(phone);
  if (!conv) return res.json([]);

  const rows = db
    .prepare(
      `SELECT id, direction, body, twilio_sid, status, created_at, message_type, attachments
       FROM messages WHERE conversation_id = ? ORDER BY datetime(created_at) ASC`
    )
    .all(conv.id);
  res.json(
    rows.map((r) => ({
      ...r,
      message_type: r.message_type || 'text',
      attachments: r.attachments ? safeJsonParse(r.attachments, []) : []
    }))
  );
});

/** Trazabilidad CRM (p. ej. paso a negociación por aceptación de adelanto/encargo). */
app.get('/api/conversations/:phone/crm-events', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const rows = db
    .prepare(
      `SELECT id, event_type, payload, created_at
       FROM crm_events WHERE customer_phone = ?
       ORDER BY datetime(created_at) DESC
       LIMIT 80`
    )
    .all(phone);
  res.json(
    rows.map((r) => ({
      ...r,
      payload: r.payload ? safeJsonParse(r.payload, null) : null
    }))
  );
});

app.get('/api/messages/:msgId/attachment/:idx', (req, res, next) => {
  const row = db
    .prepare('SELECT attachments FROM messages WHERE id = ?')
    .get(req.params.msgId);
  if (!row?.attachments) return res.status(404).end();
  const list = safeJsonParse(row.attachments, []);
  const idx = Number(req.params.idx);
  const item = list[idx];
  if (!item?.url) return res.status(404).end();
  pipeTwilioMedia(item.url, req, res, item.contentType).catch(next);
});

app.post('/api/conversations/:phone/read', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  db.prepare('UPDATE conversations SET unread_inbound = 0 WHERE customer_phone = ?').run(phone);
  io.emit('crm:update', { type: 'read', customer_phone: phone });
  res.json({ ok: true });
});

app.get('/api/conversations/:phone/avatar', (req, res, next) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) return res.status(400).end();
  const row = db
    .prepare('SELECT profile_avatar_url FROM conversations WHERE customer_phone = ?')
    .get(phone);
  if (!row?.profile_avatar_url || !looksLikeExternalProfilePicUrl(row.profile_avatar_url)) {
    return res.status(404).end();
  }
  pipeTwilioMedia(row.profile_avatar_url, req, res, null).catch(next);
});

function updateConversationLabelHandler(req, res) {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  let label = req.body?.label;
  if (label === null || label === undefined) {
    label = null;
  } else {
    label = String(label).trim();
    if (!label) label = null;
    if (label && label.length > 120) {
      return res.status(400).json({ ok: false, error: 'Etiqueta demasiado larga (máx. 120)' });
    }
  }
  const row = db
    .prepare('SELECT id, pipeline_label, assigned_advisor_id FROM conversations WHERE customer_phone = ?')
    .get(phone);
  if (!row) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  const wasNegotiation = pipelineIsNegotiationLabel(row.pipeline_label);
  const toNegotiation = label && pipelineIsNegotiationLabel(label);
  if (toNegotiation) {
    db.prepare(
      `UPDATE conversations SET pipeline_label = ?, bot_paused = 1 WHERE customer_phone = ?`
    ).run(label, phone);
  } else if (wasNegotiation && !toNegotiation) {
    db.prepare(
      `UPDATE conversations SET pipeline_label = ?, assigned_advisor_id = NULL WHERE customer_phone = ?`
    ).run(label, phone);
  } else {
    db.prepare('UPDATE conversations SET pipeline_label = ? WHERE customer_phone = ?').run(
      label,
      phone
    );
  }
  schedulePipelineAutomations({
    conversationId: row.id,
    customerPhone: phone,
    pipelineLabel: label,
    assignedAdvisorId: toNegotiation ? null : row.assigned_advisor_id
  });
  if ((row.pipeline_label || null) !== (label || null)) {
    recordCrmEvent(row.id, phone, 'pipeline_stage_changed', {
      from: row.pipeline_label || null,
      to: label || null,
      actor: 'crm'
    });
  }
  io.emit('crm:update', { type: 'label', customer_phone: phone });
  const out = { ok: true, pipeline_label: label };
  if (toNegotiation) out.bot_paused = 1;
  res.json(out);
}

app.patch('/api/conversations/:phone/label', updateConversationLabelHandler);
app.post('/api/conversations/:phone/label', updateConversationLabelHandler);

function updateBotPausedHandler(req, res) {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  let paused = req.body?.paused;
  if (typeof paused === 'string') {
    paused = paused === 'true' || paused === '1';
  }
  paused = Boolean(paused);
  const row = db.prepare('SELECT id, pipeline_label FROM conversations WHERE customer_phone = ?').get(
    phone
  );
  if (!row) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  if (!paused && pipelineIsNegotiationLabel(row.pipeline_label)) {
    return res.status(409).json({
      ok: false,
      error:
        'En Negociación el asistente no se reactiva: sigue el asesor humano. Cambia el embudo a otro estado para volver a usar el bot.',
      bot_paused: 1
    });
  }
  db.prepare('UPDATE conversations SET bot_paused = ? WHERE customer_phone = ?').run(
    paused ? 1 : 0,
    phone
  );
  recordCrmEvent(row.id, phone, 'bot_pause_changed', {
    bot_paused: paused ? 1 : 0,
    pipeline_label: row.pipeline_label || null
  });
  io.emit('crm:update', { type: 'bot_pause', customer_phone: phone });
  res.json({ ok: true, bot_paused: paused ? 1 : 0 });
}

app.patch('/api/conversations/:phone/bot-pause', updateBotPausedHandler);
app.post('/api/conversations/:phone/bot-pause', updateBotPausedHandler);

const CONV_STATUS_SET = new Set(['inbox', 'spam', 'blocked']);

function updateConvStatusHandler(req, res) {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  let status = String(req.body?.status ?? req.query?.status ?? '')
    .trim()
    .toLowerCase();
  if (!CONV_STATUS_SET.has(status)) {
    return res.status(400).json({ ok: false, error: 'Estado inválido (inbox, spam, blocked)' });
  }
  const row = db
    .prepare('SELECT id, conv_status FROM conversations WHERE customer_phone = ?')
    .get(phone);
  if (!row) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  try {
    db.prepare('UPDATE conversations SET conv_status = ? WHERE customer_phone = ?').run(
      status,
      phone
    );
  } catch (e) {
    console.error('conv_status:', e.message);
    return res.status(500).json({
      ok: false,
      error:
        'No se pudo guardar (¿migración de BD aplicada? Reinicia el servidor Node). Detalle: ' +
        e.message
    });
  }
  if ((row.conv_status || 'inbox') !== status) {
    recordCrmEvent(row.id, phone, 'conversation_folder_changed', {
      from: row.conv_status || 'inbox',
      to: status
    });
  }
  io.emit('crm:update', { type: 'conv_status', customer_phone: phone, conv_status: status });
  res.json({ ok: true, conv_status: status });
}

app.patch('/api/conversations/:phone/conv-status', updateConvStatusHandler);
app.post('/api/conversations/:phone/conv-status', updateConvStatusHandler);

function deleteConversationByPhoneHandler(req, res) {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const conv = db.prepare('SELECT id FROM conversations WHERE customer_phone = ?').get(phone);
  if (!conv) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conv.id);
      db.prepare('DELETE FROM conversation_services WHERE customer_phone = ?').run(phone);
      db.prepare('DELETE FROM conversations WHERE customer_phone = ?').run(phone);
    })();
  } catch (e) {
    console.error('deleteConversation:', e.message);
    return res.status(500).json({ ok: false, error: 'Error al borrar en la base de datos' });
  }
  io.emit('crm:update', { type: 'deleted', customer_phone: phone });
  res.json({ ok: true });
}

app.delete('/api/conversations/:phone', deleteConversationByPhoneHandler);
app.post('/api/conversations/:phone/delete', deleteConversationByPhoneHandler);

app.get('/api/services', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, slug, name, summary, category, sort_order
       FROM services WHERE is_active = 1 ORDER BY sort_order ASC, name ASC`
    )
    .all();
  res.json(rows);
});

app.get('/api/services/:slug', (req, res) => {
  const slug = String(req.params.slug || '').trim().toLowerCase();
  const row = db
    .prepare(
      `SELECT id, slug, name, summary, keywords, category, sort_order, is_active
       FROM services WHERE slug = ?`
    )
    .get(slug);
  if (!row) return res.status(404).json({ ok: false, error: 'Servicio no encontrado' });
  row.keywords = safeJsonParse(row.keywords, []);
  res.json(row);
});

app.get('/api/conversations/:phone/services', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const rows = db
    .prepare(
      `SELECT cs.id AS link_id, cs.source, cs.created_at, cs.notes,
              s.id AS service_id, s.slug, s.name, s.summary
       FROM conversation_services cs
       JOIN services s ON s.id = cs.service_id
       WHERE cs.customer_phone = ? AND s.is_active = 1
       ORDER BY s.sort_order ASC, s.name ASC`
    )
    .all(phone);
  res.json(rows);
});

app.post('/api/conversations/:phone/services', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  if (phone.length < MIN_PHONE_DIGITS) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }
  const conv = db.prepare('SELECT id FROM conversations WHERE customer_phone = ?').get(phone);
  if (!conv) {
    return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });
  }
  let serviceId = req.body?.service_id;
  const slug = req.body?.slug != null ? String(req.body.slug).trim().toLowerCase() : '';
  if (serviceId == null && slug) {
    const srow = db.prepare('SELECT id FROM services WHERE slug = ? AND is_active = 1').get(slug);
    serviceId = srow?.id;
  }
  serviceId = Number(serviceId);
  if (!Number.isFinite(serviceId) || serviceId < 1) {
    return res.status(400).json({ ok: false, error: 'service_id o slug inválido' });
  }
  const svc = db.prepare('SELECT id FROM services WHERE id = ? AND is_active = 1').get(serviceId);
  if (!svc) {
    return res.status(404).json({ ok: false, error: 'Servicio no encontrado' });
  }
  const now = new Date().toISOString();
  const notes =
    req.body?.notes != null && String(req.body.notes).trim()
      ? String(req.body.notes).trim().slice(0, 500)
      : null;
  try {
    db.prepare(
      `INSERT INTO conversation_services (customer_phone, service_id, source, notes, created_at)
       VALUES (?, ?, 'manual', ?, ?)
       ON CONFLICT(customer_phone, service_id) DO UPDATE SET
         notes = COALESCE(excluded.notes, conversation_services.notes)`
    ).run(phone, serviceId, notes, now);
  } catch (e) {
    console.error('conversation_services insert:', e.message);
    return res.status(500).json({ ok: false, error: 'No se pudo guardar' });
  }
  io.emit('crm:update', { type: 'services', customer_phone: phone });
  res.json({ ok: true });
});

app.delete('/api/conversations/:phone/services/:serviceId', (req, res) => {
  const phone = String(req.params.phone).replace(/\D/g, '');
  const serviceId = Number(req.params.serviceId);
  if (phone.length < MIN_PHONE_DIGITS || !Number.isFinite(serviceId)) {
    return res.status(400).json({ ok: false, error: 'Parámetros inválidos' });
  }
  const r = db
    .prepare(
      'DELETE FROM conversation_services WHERE customer_phone = ? AND service_id = ?'
    )
    .run(phone, serviceId);
  if (r.changes === 0) {
    return res.status(404).json({ ok: false, error: 'Vínculo no encontrado' });
  }
  io.emit('crm:update', { type: 'services', customer_phone: phone });
  res.json({ ok: true });
});

app.post('/api/messages/send', async (req, res) => {
  const twilioApi = getTwilioClient();
  if (!twilioApi) {
    return res.status(503).json({ ok: false, error: 'Twilio no configurado' });
  }

  const { to, body } = req.body || {};
  const text = String(body || '').trim();
  if (!text) return res.status(400).json({ ok: false, error: 'Mensaje vacío' });

  let digits = String(to || '').replace(/\D/g, '');
  if (digits.length < 10) {
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }

  const toWhatsApp = `whatsapp:+${digits}`;
  const now = new Date().toISOString();

  try {
    const msg = await twilioApi.messages.create({
      from: currentWhatsappFrom(),
      to: toWhatsApp,
      body: text
    });

    let conv = db.prepare('SELECT * FROM conversations WHERE customer_phone = ?').get(digits);
    if (!conv) {
      const r = db
        .prepare(
          `INSERT INTO conversations (
             customer_phone, profile_name, last_message_at, unread_inbound, last_outbound_at
           ) VALUES (?, NULL, ?, 0, ?)`
        )
        .run(digits, now, now);
      conv = { id: r.lastInsertRowid };
    } else {
      db.prepare('UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?').run(
        now,
        now,
        conv.id
      );
    }

    db.prepare(
      `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
       VALUES (?, 'outbound', ?, ?, ?, ?, 'text', NULL)`
    ).run(conv.id, text, msg.sid, msg.status || 'queued', now);

    io.emit('crm:update', { type: 'outbound', customer_phone: digits });

    res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('Envío Twilio:', e.message);
    const friendly = twilioUserError(e);
    res.status(friendly.status).json({ ok: false, error: friendly.error, twilioCode: friendly.twilioCode });
  }
});

function handleOutboundUpload(req, res, next) {
  uploadOutbound.single('file')(req, res, (err) => {
    if (err) {
      logEvent('send_media', 'upload_error', {
        error: err.message,
        multerCode: err instanceof multer.MulterError ? err.code : undefined
      });
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res
          .status(400)
          .json({ ok: false, error: 'Archivo demasiado grande (máx. 16 MB)' });
      }
      return res.status(400).json({
        ok: false,
        error: err.message || 'Error al subir el archivo'
      });
    }
    next();
  });
}

app.post('/api/messages/send-media', handleOutboundUpload, async (req, res) => {
  const twilioApi = getTwilioClient();
  if (!twilioApi) {
    logEvent('send_media', 'rejected', { reason: 'twilio_not_configured' });
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    return res.status(503).json({ ok: false, error: 'Twilio no configurado' });
  }

  if (!req.file) {
    logEvent('send_media', 'rejected', { reason: 'missing_file' });
    return res.status(400).json({ ok: false, error: 'Falta archivo' });
  }

  const { to, body } = req.body || {};
  let digits = String(to || '').replace(/\D/g, '');
  if (digits.length < 10) {
    logEvent('send_media', 'rejected', {
      reason: 'invalid_phone',
      digitsLength: digits.length
    });
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ ok: false, error: 'Número inválido' });
  }

  const origin = publicApiOrigin();
  if (!origin) {
    logEvent('send_media', 'rejected', {
      reason: 'missing_public_origin',
      hint: 'PUBLIC_WEBHOOK_URL o PUBLIC_API_URL'
    });
    fs.unlink(req.file.path, () => {});
    return res.status(500).json({
      ok: false,
      error:
        'Configure PUBLIC_WEBHOOK_URL o PUBLIC_API_URL para que Twilio pueda descargar el archivo'
    });
  }

  const filename = path.basename(req.file.filename || req.file.path);
  const mediaUrl = `${origin}/api/outbound-media/${encodeURIComponent(filename)}`;
  const caption = String(body || '').trim();
  const contentType = req.file.mimetype || 'application/octet-stream';
  const messageType = inferMessageType(contentType);
  const attachmentsJson = JSON.stringify([{ localId: filename, contentType }]);
  const now = new Date().toISOString();
  const toWhatsApp = `whatsapp:+${digits}`;

  logEvent('send_media', 'attempt', {
    to: digits,
    originalName: req.file.originalname,
    mimetype: contentType,
    messageType,
    size: req.file.size,
    filename,
    origin,
    mediaUrl,
    hasCaption: Boolean(caption)
  });

  const createOpts = {
    from: currentWhatsappFrom(),
    to: toWhatsApp,
    mediaUrl: [mediaUrl]
  };
  if (caption) createOpts.body = caption;

  let msg;
  try {
    msg = await twilioApi.messages.create(createOpts);
  } catch (e) {
    console.error('Envío multimedia Twilio:', e.message);
    const friendly = twilioUserError(e);
    logEvent('send_media', 'twilio_error', {
      error: e.message,
      code: e.code,
      status: e.status,
      moreInfo: e.moreInfo,
      to: digits,
      mediaUrl
    });
    fs.unlink(req.file.path, () => {});
    return res.status(friendly.status).json({ ok: false, error: friendly.error, twilioCode: friendly.twilioCode });
  }

  const bodyStored = caption || '';
  try {
    let conv = db.prepare('SELECT * FROM conversations WHERE customer_phone = ?').get(digits);
    if (!conv) {
      const r = db
        .prepare(
          `INSERT INTO conversations (
             customer_phone, profile_name, last_message_at, unread_inbound, last_outbound_at
           ) VALUES (?, NULL, ?, 0, ?)`
        )
        .run(digits, now, now);
      conv = { id: r.lastInsertRowid };
    } else {
      db.prepare('UPDATE conversations SET last_message_at = ?, last_outbound_at = ? WHERE id = ?').run(
        now,
        now,
        conv.id
      );
    }

    db.prepare(
      `INSERT INTO messages (conversation_id, direction, body, twilio_sid, status, created_at, message_type, attachments)
       VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?)`
    ).run(
      conv.id,
      bodyStored,
      msg.sid,
      msg.status || 'queued',
      now,
      messageType,
      attachmentsJson
    );

    io.emit('crm:update', { type: 'outbound', customer_phone: digits });

    logEvent('send_media', 'twilio_ok', {
      sid: msg.sid,
      status: msg.status,
      to: digits,
      filename
    });

    res.json({ ok: true, sid: msg.sid, status: msg.status });
  } catch (e) {
    console.error('Guardar mensaje multimedia (SQLite):', e.message);
    logEvent('send_media', 'db_error', {
      error: e.message,
      code: e.code,
      to: digits,
      twilioSid: msg.sid,
      note:
        'Twilio ya aceptó el envío; el archivo en disco se conserva para que pueda descargarlo.'
    });
    res.status(500).json({
      ok: false,
      error:
        'El mensaje pudo enviarse por Twilio pero no se guardó en el CRM. Revisa el log de eventos.'
    });
  }
});

function attachCrmFrontendToMainApp() {
  const dist = path.join(__dirname, '..', 'web', 'dist');
  const indexHtml = path.join(dist, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.warn(
      '[CRM] Falta web/dist/index.html — en el servidor: cd web && npm install && npm run build'
    );
    app.get('/', (_req, res) => {
      res.type('html').send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>API</title></head><body>
<p>API activa. <a href="/api/health">/api/health</a></p>
<p>Construye el panel: <code>cd web && npm run build</code></p>
</body></html>`);
    });
    return;
  }
  app.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith('crm-api-config.js')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    })
  );
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    if (req.path.startsWith('/socket.io')) return next();
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(indexHtml);
  });
  console.log(
    `[CRM] Panel en el MISMO puerto que la API → abre http://127.0.0.1:${PORT} (sin configurar nada más)`
  );
}

function startCrmSecondPortIfConfigured() {
  if (CRM_PORT == null || !Number.isFinite(CRM_PORT) || CRM_PORT <= 0) {
    return;
  }
  if (CRM_PORT === PORT) {
    console.warn('[CRM] CRM_PORT no puede ser igual que PORT; omito segundo puerto.');
    return;
  }
  const dist = path.join(__dirname, '..', 'web', 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.warn('[CRM] Segundo puerto omitido: falta web/dist/index.html');
    return;
  }
  const apiTarget = String(process.env.CRM_PANEL_API_TARGET || '')
    .trim()
    .replace(/\/$/, '');
  const proxyTarget = apiTarget || `http://127.0.0.1:${PORT}`;
  const panelApp = express();
  panelApp.use(
    createProxyMiddleware(['/api', '/webhook', '/socket.io'], {
      target: proxyTarget,
      changeOrigin: true,
      ws: true
    })
  );
  panelApp.use(
    express.static(dist, {
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html') || filePath.endsWith('crm-api-config.js')) {
          res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    })
  );
  panelApp.use((_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(dist, 'index.html'));
  });
  const panelServer = http.createServer(panelApp);
  panelServer.listen(CRM_PORT, '0.0.0.0', () => {
    console.log(
      `[CRM] Panel en 0.0.0.0:${CRM_PORT} → estáticos + proxy /api /webhook /socket.io → ${proxyTarget}`
    );
  });
}

attachCrmFrontendToMainApp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`API + webhook + panel en 0.0.0.0:${PORT}`);
  console.log(`Webhook público (Twilio): ${currentWebhookUrl()}`);
  console.log(
    `[CRM] Login panel: POST /api/crm-auth/login o POST /api/crmpanel/login (comprueba con GET /api/health → crm_panel_login_paths)`
  );
  console.log(`Log de eventos (multimedia, etc.): ${EVENT_LOG_FILE}`);
  startCrmSecondPortIfConfigured();
});
