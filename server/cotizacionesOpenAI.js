'use strict';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const CHAT_SYSTEM = `Eres el asistente de cotizaciones de Bruja TecnoXpert (Colombia): equipos, componentes, armado de PCs y servicios tecnológicos.
Ayudá al usuario a armar una cotización clara: datos del cliente (nombre, contacto), ítems (descripción, cantidad, precio unitario en COP), condiciones, plazo de validez.
Sé profesional, conciso y en español de Colombia. Si falta información importante, preguntala.
Cuando el usuario pida generar el PDF o la cotización formal, indicá que use el botón "Generar cotización PDF" del panel.`;

const EXTRACT_SYSTEM = `Extraé datos de cotización a partir de la conversación (usuario + asistente). Respondé SOLO un JSON válido, sin markdown, con esta forma exacta:
{
  "cliente_nombre": "string",
  "cliente_contacto": "string",
  "items": [ { "descripcion": "string", "cantidad": number, "precio_unitario": number } ],
  "notas": "string",
  "validez_dias": number,
  "iva_porcentaje": number,
  "incluir_iva": boolean
}
Reglas: precios en COP como números sin texto; cantidades enteras o decimales si aplica; si no hay dato usa "" o [] o 0; validez_días por defecto 15; iva_porcentaje por defecto 19; incluir_iva true salvo que la conversación diga explícitamente precios sin IVA.`;

async function openaiChatJson(apiKey, model, messages, options = {}) {
  const { temperature = 0.4, max_tokens = 2048, response_format } = options;
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens,
      ...(response_format ? { response_format } : {})
    })
  });
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(raw.slice(0, 200) || `OpenAI HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `OpenAI ${res.status}`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía de OpenAI');
  return String(text).trim();
}

function sanitizeMessagesForApi(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const out = [];
  for (const m of list.slice(-40)) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').slice(0, 12000);
    if (!content.trim()) continue;
    out.push({ role, content });
  }
  return out;
}

async function cotizacionChat(apiKey, model, messages) {
  const clean = sanitizeMessagesForApi(messages);
  const body = [{ role: 'system', content: CHAT_SYSTEM }, ...clean];
  const text = await openaiChatJson(apiKey, model, body, { temperature: 0.5, max_tokens: 1500 });
  return { role: 'assistant', content: text };
}

async function extractQuoteFromConversation(apiKey, model, messages) {
  const clean = sanitizeMessagesForApi(messages);
  const transcript = clean.map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`).join('\n\n');
  const text = await openaiChatJson(
    apiKey,
    model,
    [
      { role: 'system', content: EXTRACT_SYSTEM },
      { role: 'user', content: `Conversación:\n\n${transcript}` }
    ],
    { temperature: 0.1, max_tokens: 2000, response_format: { type: 'json_object' } }
  );
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('No se pudo interpretar la cotización (JSON inválido)');
  }
  return normalizeQuote(parsed);
}

function normalizeQuote(raw) {
  const cliente_nombre = String(raw.cliente_nombre || '').trim().slice(0, 200);
  const cliente_contacto = String(raw.cliente_contacto || '').trim().slice(0, 200);
  const notas = String(raw.notas || '').trim().slice(0, 2000);
  let validez_dias = Number(raw.validez_dias);
  if (!Number.isFinite(validez_dias) || validez_dias < 1) validez_dias = 15;
  if (validez_dias > 365) validez_dias = 365;
  let iva_porcentaje = Number(raw.iva_porcentaje);
  if (!Number.isFinite(iva_porcentaje) || iva_porcentaje < 0) iva_porcentaje = 19;
  if (iva_porcentaje > 100) iva_porcentaje = 19;
  const incluir_iva = raw.incluir_iva !== false;
  const items = [];
  const arr = Array.isArray(raw.items) ? raw.items : [];
  for (const it of arr.slice(0, 40)) {
    const descripcion = String(it.descripcion || it.description || '').trim().slice(0, 500);
    let cantidad = Number(it.cantidad ?? it.qty ?? 1);
    if (!Number.isFinite(cantidad) || cantidad <= 0) cantidad = 1;
    let precio_unitario = Number(it.precio_unitario ?? it.precio ?? it.unit_price ?? 0);
    if (!Number.isFinite(precio_unitario) || precio_unitario < 0) precio_unitario = 0;
    if (descripcion) items.push({ descripcion, cantidad, precio_unitario });
  }
  return {
    cliente_nombre,
    cliente_contacto,
    notas,
    validez_dias,
    iva_porcentaje,
    incluir_iva,
    items
  };
}

function computeTotals(quote) {
  const subtotal = quote.items.reduce((s, it) => s + it.cantidad * it.precio_unitario, 0);
  let iva = 0;
  let total = subtotal;
  if (quote.incluir_iva && quote.iva_porcentaje > 0) {
    iva = Math.round(subtotal * (quote.iva_porcentaje / 100));
    total = subtotal + iva;
  }
  return { subtotal, iva, total };
}

module.exports = {
  cotizacionChat,
  extractQuoteFromConversation,
  normalizeQuote,
  computeTotals
};
