'use strict';

const express = require('express');
const {
  cotizacionChat,
  extractQuoteFromConversation,
  computeTotals
} = require('./cotizacionesOpenAI');
const { buildCotizacionPdfBuffer } = require('./cotizacionesPdf');

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   OPENAI_API_KEY: string,
 *   OPENAI_MODEL: string,
 *   getOpenAiSettings?: () => { apiKey?: string, model?: string },
 *   advisorAuthMiddleware?: import('express').RequestHandler,
 *   verifyCrmJwtToken?: (token: string) => boolean,
 *   verifyAdvisorToken?: (token: string) => number | null,
 *   readJwtFromRequest?: (req: import('express').Request) => string | null
 * }} opts
 */
function buildCotizacionesHandlers(opts) {
  const {
    db,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    getOpenAiSettings,
    verifyCrmJwtToken,
    verifyAdvisorToken,
    readJwtFromRequest
  } = opts;

  function resolveOpenAiSettings() {
    if (typeof getOpenAiSettings === 'function') {
      const current = getOpenAiSettings() || {};
      return {
        apiKey: String(current.apiKey || '').trim(),
        model: String(current.model || '').trim() || 'gpt-4o-mini'
      };
    }
    return {
      apiKey: String(OPENAI_API_KEY || '').trim(),
      model: String(OPENAI_MODEL || '').trim() || 'gpt-4o-mini'
    };
  }

  function pickJwt(req) {
    if (typeof readJwtFromRequest === 'function') return readJwtFromRequest(req);
    const h = String(req.headers.authorization || '');
    const m = h.match(/^Bearer\s+(\S+)$/i);
    return m ? m[1] : String(req.headers['x-tecnoxpert-jwt'] || '').trim() || null;
  }

  function cotizacionesDualAuth(req, res, next) {
    const verifyCrm = typeof verifyCrmJwtToken === 'function' ? verifyCrmJwtToken : () => false;
    const verifyAdv = typeof verifyAdvisorToken === 'function' ? verifyAdvisorToken : () => null;
    const tok = pickJwt(req);
    if (!tok) {
      return res.status(401).json({
        ok: false,
        error:
          'Sesión no enviada (falta token). Volvé a iniciar sesión. Si usás Apache, el proxy puede estar borrando el header Authorization: probá actualizar el servidor o revisar la config del proxy.'
      });
    }
    if (verifyCrm(tok)) {
      req.cotizacionCaller = 'crm';
      return next();
    }
    const aid = verifyAdv(tok);
    if (!aid) {
      return res.status(401).json({
        ok: false,
        error: 'Token inválido o vencido. Cerrá sesión y volvé a entrar (CRM o portal de asesores).'
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
    req.cotizacionCaller = 'advisor';
    return next();
  }

  async function handleCotizacionChat(req, res) {
    const { apiKey, model } = resolveOpenAiSettings();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY no configurada' });
    }
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'Enviá la lista de mensajes' });
    }
    const last = messages[messages.length - 1];
    if (last?.role !== 'user' || !String(last.content || '').trim()) {
      return res.status(400).json({ ok: false, error: 'El último mensaje debe ser del usuario' });
    }
    try {
      const reply = await cotizacionChat(apiKey, model, messages);
      res.json({ ok: true, message: reply });
    } catch (e) {
      console.error('cotizaciones/chat:', e.message);
      res.status(500).json({ ok: false, error: e.message || 'Error de OpenAI' });
    }
  }

  async function handleCotizacionPdf(req, res) {
    const { apiKey, model } = resolveOpenAiSettings();
    if (!apiKey) {
      return res.status(503).json({ ok: false, error: 'OPENAI_API_KEY no configurada' });
    }
    const messages = req.body?.messages;
    const fromAdvisorCall = req.cotizacionCaller === 'advisor';
    const advisorId = fromAdvisorCall
      ? Number(req.advisorId)
      : Number(req.body?.advisor_id);
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ ok: false, error: 'Falta la conversación para generar el PDF' });
    }
    if (!Number.isFinite(advisorId) || advisorId < 1) {
      return res
        .status(400)
        .json({
          ok: false,
          error: fromAdvisorCall ? 'Sesión de asesor inválida' : 'Elegí un asesor para la firma'
        });
    }
    const advisor = db
      .prepare(`SELECT id, full_name, email, phone, is_active FROM advisors WHERE id = ?`)
      .get(advisorId);
    if (!advisor || Number(advisor.is_active) !== 1) {
      return res.status(404).json({ ok: false, error: 'Asesor no encontrado o inactivo' });
    }
    try {
      const quote = await extractQuoteFromConversation(apiKey, model, messages);
      const totals = computeTotals(quote);
      const pdf = await buildCotizacionPdfBuffer(quote, totals, advisor);
      const safeName = String(quote.cliente_nombre || 'cliente')
        .replace(/[^\w\s-áéíóúñ]/gi, '')
        .trim()
        .slice(0, 40)
        .replace(/\s+/g, '_');
      const fname = `Cotizacion_Bruja_TecnoXpert_${safeName || 'cliente'}_${Date.now()}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
      res.send(pdf);
    } catch (e) {
      console.error('cotizaciones/pdf:', e.message);
      res.status(500).json({ ok: false, error: e.message || 'No se pudo generar el PDF' });
    }
  }

  async function handleAdvisorCotizacionPdf(req, res) {
    req.body = { ...(req.body || {}), advisor_id: Number(req.advisorId) };
    return handleCotizacionPdf(req, res);
  }

  return {
    cotizacionesDualAuth,
    handleCotizacionChat,
    handleCotizacionPdf,
    handleAdvisorCotizacionPdf
  };
}

/**
 * Todo esto va ANTES de crmApiGate:
 * - Ping público (comprobar que el navegador llega a Node).
 * - Router en /api/messages (rutas legacy).
 * - Router en /api/cotizacion-ia (rutas nuevas: muchos proxy/WAF solo dejan /api/messages/send).
 */
function registerCotizacionesMessagesBeforeGate(app, opts) {
  const h = buildCotizacionesHandlers(opts);

  const msg = express.Router();
  msg.post('/cotizacion-chat', h.cotizacionesDualAuth, h.handleCotizacionChat);
  msg.post('/cotizacion-pdf', h.cotizacionesDualAuth, h.handleCotizacionPdf);
  app.use('/api/messages', msg);

  const alt = express.Router();
  alt.post('/chat', h.cotizacionesDualAuth, h.handleCotizacionChat);
  alt.post('/pdf', h.cotizacionesDualAuth, h.handleCotizacionPdf);
  app.use('/api/cotizacion-ia', alt);
}

/**
 * Alias bajo /api/cotizaciones/* (el crmApiGate exige JWT CRM). Portal asesor: /api/advisor/cotizacion-*.
 */
function registerCotizacionesRoutes(app, opts) {
  const { advisorAuthMiddleware } = opts;
  const h = buildCotizacionesHandlers(opts);

  app.post('/api/cotizaciones/chat', h.handleCotizacionChat);
  app.post('/api/cotizaciones/pdf', h.handleCotizacionPdf);

  app.get('/api/cotizaciones/advisors', (_req, res) => {
    const rows = opts.db
      .prepare(
        `SELECT id, full_name, email, phone FROM advisors WHERE is_active = 1 ORDER BY sort_order ASC, full_name ASC`
      )
      .all();
    res.json(rows);
  });

  if (advisorAuthMiddleware) {
    app.post('/api/advisor/cotizacion-chat', advisorAuthMiddleware, h.handleCotizacionChat);
    app.post('/api/advisor/cotizacion-pdf', advisorAuthMiddleware, h.handleAdvisorCotizacionPdf);
  }
}

module.exports = {
  registerCotizacionesMessagesBeforeGate,
  registerCotizacionesRoutes
};
