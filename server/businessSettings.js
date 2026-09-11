'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_PATH = path.join(DATA_DIR, 'business-settings.json');

const SECRET_FIELDS = [
  'twilio_account_sid',
  'twilio_auth_token',
  'openai_api_key',
  'crm_admin_password',
  'crm_jwt_secret',
  'advisor_jwt_secret'
];

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeOptionalUrl(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  try {
    const url = new URL(text);
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new Error(`URL invalida: ${text}`);
  }
}

function normalizeWhatsappFrom(value, fallback = 'whatsapp:+5215540952942') {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) {
    throw new Error('El numero de WhatsApp debe tener entre 7 y 15 digitos');
  }
  return `whatsapp:+${digits}`;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'si', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function buildDefaults(port) {
  const fallbackWebhook = `http://127.0.0.1:${port}/webhook`;
  return {
    business_name: normalizeText(process.env.CRM_BUSINESS_NAME, 'Bruja TecnoXpert'),
    business_tagline: normalizeText(process.env.CRM_BUSINESS_TAGLINE, 'Atencion esoterica por WhatsApp'),
    public_webhook_url: normalizeOptionalUrl(process.env.PUBLIC_WEBHOOK_URL, fallbackWebhook),
    public_api_url: normalizeOptionalUrl(process.env.PUBLIC_API_URL, ''),
    twilio_account_sid: normalizeText(process.env.TWILIO_ACCOUNT_SID, ''),
    twilio_auth_token: normalizeText(process.env.TWILIO_AUTH_TOKEN, ''),
    twilio_whatsapp_from: normalizeWhatsappFrom(
      process.env.TWILIO_WHATSAPP_FROM,
      'whatsapp:+5215540952942'
    ),
    validate_twilio_signature:
      String(process.env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false',
    openai_api_key: normalizeText(process.env.OPENAI_API_KEY, ''),
    openai_model: normalizeText(process.env.OPENAI_MODEL, 'gpt-4o-mini'),
    openai_bot_enabled:
      String(process.env.OPENAI_BOT_ENABLED || 'true').toLowerCase() !== 'false',
    crm_admin_user: normalizeText(process.env.CRM_ADMIN_USER, 'tecnoxpert'),
    crm_admin_password: String(process.env.CRM_ADMIN_PASSWORD || 'Fiddle72*'),
    crm_jwt_secret: normalizeText(
      process.env.CRM_JWT_SECRET || process.env.ADVISOR_JWT_SECRET,
      ''
    ),
    advisor_jwt_secret: normalizeText(process.env.ADVISOR_JWT_SECRET, '')
  };
}

function readStoredSettings() {
  ensureDataDir();
  if (!fs.existsSync(SETTINGS_PATH)) return {};
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

function normalizeRuntimeSettings(source, port) {
  const defaults = buildDefaults(port);
  const merged = { ...defaults, ...(source || {}) };

  const settings = {
    business_name: normalizeText(merged.business_name, defaults.business_name),
    business_tagline: normalizeText(merged.business_tagline, defaults.business_tagline),
    public_webhook_url: normalizeOptionalUrl(merged.public_webhook_url, defaults.public_webhook_url),
    public_api_url: normalizeOptionalUrl(merged.public_api_url, ''),
    twilio_account_sid: normalizeText(merged.twilio_account_sid, ''),
    twilio_auth_token: normalizeText(merged.twilio_auth_token, ''),
    twilio_whatsapp_from: normalizeWhatsappFrom(
      merged.twilio_whatsapp_from,
      defaults.twilio_whatsapp_from
    ),
    validate_twilio_signature: normalizeBoolean(
      merged.validate_twilio_signature,
      defaults.validate_twilio_signature
    ),
    openai_api_key: normalizeText(merged.openai_api_key, ''),
    openai_model: normalizeText(merged.openai_model, defaults.openai_model),
    openai_bot_enabled: normalizeBoolean(merged.openai_bot_enabled, defaults.openai_bot_enabled),
    crm_admin_user: normalizeText(merged.crm_admin_user, defaults.crm_admin_user),
    crm_admin_password: String(
      merged.crm_admin_password == null || merged.crm_admin_password === ''
        ? defaults.crm_admin_password
        : merged.crm_admin_password
    ),
    crm_jwt_secret: normalizeText(merged.crm_jwt_secret, ''),
    advisor_jwt_secret: normalizeText(merged.advisor_jwt_secret, '')
  };

  if (!settings.crm_jwt_secret) {
    settings.crm_jwt_secret = settings.advisor_jwt_secret;
  }

  if (!settings.business_name) {
    throw new Error('El nombre del negocio es obligatorio');
  }
  if (!settings.crm_admin_user) {
    throw new Error('El usuario del CRM es obligatorio');
  }
  if (!String(settings.crm_admin_password || '').trim()) {
    throw new Error('La contrasena del CRM no puede quedar vacia');
  }
  if (!settings.crm_jwt_secret && !settings.advisor_jwt_secret) {
    throw new Error('Debes configurar al menos una clave JWT para CRM o asesores');
  }

  return settings;
}

function getBusinessSettings(options = {}) {
  const port = Number(options.port || process.env.PORT || 8989);
  return normalizeRuntimeSettings(readStoredSettings(), port);
}

function applyBusinessSettingsToProcessEnv(options = {}) {
  const settings = getBusinessSettings(options);
  process.env.CRM_BUSINESS_NAME = settings.business_name;
  process.env.CRM_BUSINESS_TAGLINE = settings.business_tagline;
  process.env.PUBLIC_WEBHOOK_URL = settings.public_webhook_url;
  process.env.PUBLIC_API_URL = settings.public_api_url;
  process.env.TWILIO_ACCOUNT_SID = settings.twilio_account_sid;
  process.env.TWILIO_AUTH_TOKEN = settings.twilio_auth_token;
  process.env.TWILIO_WHATSAPP_FROM = settings.twilio_whatsapp_from;
  process.env.VALIDATE_TWILIO_SIGNATURE = settings.validate_twilio_signature ? 'true' : 'false';
  process.env.OPENAI_API_KEY = settings.openai_api_key;
  process.env.OPENAI_MODEL = settings.openai_model;
  process.env.OPENAI_BOT_ENABLED = settings.openai_bot_enabled ? 'true' : 'false';
  process.env.CRM_ADMIN_USER = settings.crm_admin_user;
  process.env.CRM_ADMIN_PASSWORD = settings.crm_admin_password;
  process.env.CRM_JWT_SECRET = settings.crm_jwt_secret;
  process.env.ADVISOR_JWT_SECRET = settings.advisor_jwt_secret || settings.crm_jwt_secret;
  return settings;
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 1)}***${text.slice(-1)}`;
  return `${text.slice(0, 3)}...${text.slice(-3)}`;
}

function getBusinessSettingsForClient(options = {}) {
  const settings = getBusinessSettings(options);
  return {
    settings: {
      business_name: settings.business_name,
      business_tagline: settings.business_tagline,
      public_webhook_url: settings.public_webhook_url,
      public_api_url: settings.public_api_url,
      twilio_whatsapp_from: settings.twilio_whatsapp_from,
      validate_twilio_signature: settings.validate_twilio_signature,
      openai_model: settings.openai_model,
      openai_bot_enabled: settings.openai_bot_enabled,
      crm_admin_user: settings.crm_admin_user,
      twilio_account_sid_masked: maskSecret(settings.twilio_account_sid),
      twilio_auth_token_masked: maskSecret(settings.twilio_auth_token),
      openai_api_key_masked: maskSecret(settings.openai_api_key),
      crm_admin_password_masked: maskSecret(settings.crm_admin_password),
      crm_jwt_secret_masked: maskSecret(settings.crm_jwt_secret),
      advisor_jwt_secret_masked: maskSecret(settings.advisor_jwt_secret),
      twilio_account_sid_configured: Boolean(settings.twilio_account_sid),
      twilio_auth_token_configured: Boolean(settings.twilio_auth_token),
      openai_api_key_configured: Boolean(settings.openai_api_key),
      crm_admin_password_configured: Boolean(settings.crm_admin_password),
      crm_jwt_secret_configured: Boolean(settings.crm_jwt_secret),
      advisor_jwt_secret_configured: Boolean(settings.advisor_jwt_secret)
    },
    runtime: {
      twilio_ready: Boolean(settings.twilio_account_sid && settings.twilio_auth_token),
      openai_ready: Boolean(settings.openai_api_key),
      openai_bot_ready: Boolean(
        settings.openai_bot_enabled &&
          settings.openai_api_key &&
          settings.twilio_account_sid &&
          settings.twilio_auth_token
      ),
      crm_auth_ready: Boolean(settings.crm_jwt_secret),
      advisor_auth_ready: Boolean(settings.advisor_jwt_secret || settings.crm_jwt_secret)
    }
  };
}

function updateBusinessSettings(input, options = {}) {
  const port = Number(options.port || process.env.PORT || 8989);
  const currentStored = readStoredSettings();
  const nextStored = { ...currentStored };

  const assignText = (key, fallback) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    nextStored[key] = normalizeText(input[key], fallback);
  };

  const assignOptionalUrl = (key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    nextStored[key] = normalizeOptionalUrl(input[key], '');
  };

  const assignBoolean = (key, fallback) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    nextStored[key] = normalizeBoolean(input[key], fallback);
  };

  const assignSecret = (key) => {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const text = String(input[key] ?? '').trim();
    if (!text) return;
    nextStored[key] = text;
  };

  assignText('business_name', 'Bruja TecnoXpert');
  assignText('business_tagline', 'Atencion esoterica por WhatsApp');
  assignOptionalUrl('public_webhook_url');
  assignOptionalUrl('public_api_url');
  if (Object.prototype.hasOwnProperty.call(input, 'twilio_whatsapp_from')) {
    nextStored.twilio_whatsapp_from = normalizeWhatsappFrom(input.twilio_whatsapp_from);
  }
  assignBoolean(
    'validate_twilio_signature',
    String(process.env.VALIDATE_TWILIO_SIGNATURE || 'true').toLowerCase() !== 'false'
  );
  assignText('openai_model', 'gpt-4o-mini');
  assignBoolean(
    'openai_bot_enabled',
    String(process.env.OPENAI_BOT_ENABLED || 'true').toLowerCase() !== 'false'
  );
  assignText('crm_admin_user', 'tecnoxpert');

  assignSecret('twilio_account_sid');
  assignSecret('twilio_auth_token');
  assignSecret('openai_api_key');
  assignSecret('crm_admin_password');
  assignSecret('crm_jwt_secret');
  assignSecret('advisor_jwt_secret');

  const previous = normalizeRuntimeSettings(currentStored, port);
  const next = normalizeRuntimeSettings(nextStored, port);

  writeStoredSettings(nextStored);
  applyBusinessSettingsToProcessEnv({ port });

  const changedKeys = [];
  for (const [key, value] of Object.entries(next)) {
    if (previous[key] !== value) changedKeys.push(key);
  }

  const authChanged = changedKeys.some((key) =>
    ['crm_admin_user', 'crm_admin_password', 'crm_jwt_secret', 'advisor_jwt_secret'].includes(key)
  );

  return {
    settings: next,
    changed_keys: changedKeys,
    auth_changed: authChanged,
    secret_fields: SECRET_FIELDS
  };
}

module.exports = {
  SECRET_FIELDS,
  SETTINGS_PATH,
  applyBusinessSettingsToProcessEnv,
  getBusinessSettings,
  getBusinessSettingsForClient,
  updateBusinessSettings
};
