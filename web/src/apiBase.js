/**
 * Apache/proxy a veces elimina Authorization; el backend también acepta este header.
 * Mantener en minúsculas: Express normaliza headers a minúsculas.
 */
export const CRM_JWT_FALLBACK_HEADER = 'X-TecnoXpert-Jwt';

/**
 * Si la base es "dominio:puerto" o "host" sin esquema, Axios falla en k.send() con ERR_BAD_REQUEST
 * "Unsupported protocol" (el bundler minificado apunta a esa línea).
 */
function withHttpScheme(base) {
  const b = String(base || '').trim().replace(/\/$/, '');
  if (!b) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(b)) return b;
  if (b.startsWith('//')) return b;
  return `https://${b}`;
}

/**
 * URL base del servidor Node (API + webhook + socket).
 *
 * - Vacío → axios usa rutas relativas (/api/...): correcto si el panel lo sirve el mismo Node (p. ej. :8989)
 *   o en desarrollo con el proxy de Vite.
 * - Si abres el panel desde Apache/XAMPP (otro puerto u origen), /api no existe ahí → 404.
 *   Solución: `VITE_API_URL` al hacer build, meta `crm-api-base`, o `window.__CRM_API_BASE__` en index.html.
 */
export function resolveApiBase() {
  const fromEnv = withHttpScheme(String(import.meta.env.VITE_API_URL || '').trim());
  if (fromEnv) return fromEnv;

  if (typeof window !== 'undefined') {
    const winBase = window.__CRM_API_BASE__;
    if (typeof winBase === 'string' && winBase.trim()) {
      return withHttpScheme(winBase);
    }

    const raw = String(
      document.querySelector('meta[name="crm-api-base"]')?.getAttribute('content') || ''
    ).trim();
    const metaBase = raw.replace(/\/$/, '');
    if (metaBase === 'same' || metaBase === '__SAME_ORIGIN__') {
      return '';
    }
    if (metaBase) return withHttpScheme(metaBase);

    /**
     * Producción: por defecto MISMO ORIGEN que la página (rutas relativas /api/...).
     * El sitio en :443 / :80 debe tener Apache/nginx con ProxyPass /api → Node (p. ej. 127.0.0.1:3001).
     * NO forzar :8989 desde el navegador: ese puerto suele estar cerrado o sin certificado → ping falla y "No autorizado".
     * Para API en otro host/puerto explícito: definí window.__CRM_API_BASE__ en crm-api-config.js
     */
    if (import.meta.env.PROD) {
      return '';
    }
  }

  return '';
}

/** Rutas de login del panel CRM (se prueban en orden). */
export const CRM_LOGIN_PATHS = ['/api/crm-auth/login', '/api/crmpanel/login'];

/** Ruta absoluta o relativa a la API (para mensajes de error / diagnóstico). */
export function crmApiFullUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  const base = resolveApiBase().replace(/\/$/, '');
  if (!base) return p;
  return `${base}${p}`;
}

function toAbsoluteApiUrl(u) {
  if (typeof window === 'undefined') return u;
  if (/^https?:\/\//i.test(u)) return u;
  return `${window.location.origin}${u}`;
}

export function absoluteCrmLoginUrl() {
  if (typeof window === 'undefined') return CRM_LOGIN_PATHS[0];
  return toAbsoluteApiUrl(crmApiFullUrl(CRM_LOGIN_PATHS[0]));
}

/** Texto con todas las URLs de login (para mensajes de error). */
export function describeCrmLoginUrls() {
  if (typeof window === 'undefined') return CRM_LOGIN_PATHS.join(' · ');
  return CRM_LOGIN_PATHS.map((path) => toAbsoluteApiUrl(crmApiFullUrl(path))).join(' · ');
}
