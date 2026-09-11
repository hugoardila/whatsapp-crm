'use strict';

/**
 * Heurísticas locales (sin OpenAI) para marcar conversaciones como spam automáticamente.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {string|null} código de razón o null
 */
function detectSpamReason(db, conversationId, bodyText) {
  const raw = String(bodyText || '').trim();
  if (!raw) return null;
  const t = norm(raw);

  // Códigos de verificación de redes / apps (ej. "38745 es tu código de confirmación de Facebook")
  if (/\b\d{4,8}\b/.test(raw)) {
    if (
      /codigo.{0,45}(confirmacion|verificacion|seguridad|acceso|inicio)/.test(t) ||
      /(confirmacion|verificacion).{0,25}codigo/.test(t) ||
      /(facebook|instagram|meta|google|whatsapp|tiktok|telegram|snapchat|twitter|x\s).{0,35}codigo/.test(
        t
      ) ||
      /codigo.{0,35}(facebook|instagram|meta|google|whatsapp|tiktok|telegram|snapchat)/.test(t)
    ) {
      return 'social_verification_code';
    }
  }
  if (
    /(facebook|instagram|meta)\s+(security|confirmation)\s+code/.test(t) ||
    /is your.{0,25}(facebook|instagram|meta|google)\s+code/.test(t) ||
    /your\s+\d{4,8}\s+is your/.test(t)
  ) {
    return 'social_verification_code_en';
  }

  // Frases típicas de phishing genérico
  if (
    /banco.{0,25}(clav|token|otp|actualiza)/.test(t) ||
    /actualiza tus datos.{0,35}(cuenta|banco|bancaria)/.test(t)
  ) {
    return 'phishing_style';
  }

  // Oferta masiva / catálogo no solicitado / MLM (conservador: frases largas)
  const coldPhrases = [
    'oportunidad unica de negocio',
    'gana dinero desde tu celular',
    'gana dolares desde',
    'sin invertir y sin experiencia',
    'catalogo de productos al mayoreo',
    'lista de precios mayoristas',
    'somos distribuidores autorizados',
    'unete a mi equipo de ventas',
    'unete a nuestro equipo de ventas',
    'productos importados directos de china',
    'replicas de alta gama',
    'promocion solo por este mes',
    'quieres recibir mas informacion sobre nuestros productos',
    'vende por catalogo',
    'trabaja desde casa y gana',
    'cadena de referidos',
    'marketing multinivel',
    'afiliate y gana comisiones',
    'mayoristas en toda colombia envio gratis',
    'super descuentos en productos importados',
    'oferta exclusiva para los primeros en escribir'
  ];
  for (const p of coldPhrases) {
    if (t.includes(p)) return 'cold_offer_or_mlm';
  }

  // Mensaje idéntico repetido en ventana corta (simultáneos / flood)
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
       WHERE conversation_id = ? AND direction = 'inbound' AND body = ?
       AND datetime(created_at) > datetime('now', '-3 minutes')`
    )
    .get(conversationId, raw);
  if ((row?.n || 0) >= 3) return 'repeated_identical';

  return null;
}

module.exports = { detectSpamReason };
