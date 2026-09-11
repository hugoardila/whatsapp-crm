import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { Download, FileText, LogIn, Sparkles } from 'lucide-react';
import { CRM_JWT_FALLBACK_HEADER, crmApiFullUrl, resolveApiBase } from './apiBase.js';

/**
 * Chat/PDF bajo /api/messages/* (evita prefijos /api/cotizacion* mal proxificados).
 * Ping: GET /api/health?cotizaciones_ping=1 — en algunos VPS Apache solo reenvía /api/health y login al Node;
 * el resto de /api cae en otro servicio (401 "No autorizado").
 */
const COTIZ_CHAT_URL = '/api/messages/cotizacion-chat';
const COTIZ_PDF_URL = '/api/messages/cotizacion-pdf';

const HEALTH_COTIZ_PING_PARAMS = { cotizaciones_ping: '1' };

function absolutePingUrl() {
  const path = '/api/health?cotizaciones_ping=1';
  if (typeof window === 'undefined') return path;
  const base = crmApiFullUrl('/api/health');
  if (/^https?:\/\//i.test(base)) {
    const u = new URL(base);
    u.searchParams.set('cotizaciones_ping', '1');
    return u.toString();
  }
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`;
}

const CRM_TOKEN_KEY = 'tecnoxpert_crm_jwt';
const ADVISOR_TOKEN_KEY = 'tecnoxpert_advisor_jwt';

function parseFromAdvisorHash() {
  const h = window.location.hash || '';
  const q = h.indexOf('?');
  const search = q >= 0 ? h.slice(q + 1) : '';
  return new URLSearchParams(search).get('from') === 'advisor';
}

const WELCOME_ASSISTANT = `¡Hola! Soy el asistente de **cotizaciones** de Bruja TecnoXpert.

Contame qué necesitás cotizar (equipos, partes, armado, cantidades y precios referencia si los tenés). También el **nombre del cliente** y un **contacto** (WhatsApp, correo o teléfono).

Cuando esté listo, tocá **Generar cotización PDF**: se arma el documento con el logo de Bruja TecnoXpert y la **firma del asesor** que elijas arriba.`;

const WELCOME_ASSISTANT_ADVISOR = `¡Hola! Acá armamos la **cotización con IA** para el cliente que tenés abierto en el chat.

Contame equipos, partes, cantidades y precios de referencia si los tenés. Incluí **nombre del cliente** y **contacto** (WhatsApp, correo o teléfono).

El PDF saldrá con **tu firma** como asesor (la sesión actual del portal).`;

function CotizacionesLogin({ onSuccess }) {
  const [username, setUsername] = useState('tecnoxpert');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const api = useMemo(() => {
    const inst = axios.create({ baseURL: resolveApiBase() });
    inst.interceptors.request.use((config) => {
      config.baseURL = resolveApiBase();
      return config;
    });
    return inst;
  }, []);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const { data } = await api.post('/api/crm-auth/login', { username, password });
      if (!data?.token) throw new Error('Respuesta inválida');
      sessionStorage.setItem(CRM_TOKEN_KEY, data.token);
      onSuccess(data.token);
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message || 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="cotiz-login">
      <div className="cotiz-login__card">
        <div className="cotiz-login__brand">
          <Sparkles size={28} strokeWidth={2.2} className="cotiz-login__icon" aria-hidden />
          <div>
            <h1>Cotizaciones IA</h1>
            <p>Usá el mismo usuario del panel CRM</p>
          </div>
        </div>
        <form className="cotiz-login__form" onSubmit={submit}>
          <label>
            <span>Usuario</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={loading}
            />
          </label>
          <label>
            <span>Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={loading}
            />
          </label>
          {err ? <p className="cotiz-login__err">{err}</p> : null}
          <button type="submit" className="cotiz-login__submit" disabled={loading}>
            <LogIn size={18} strokeWidth={2.1} aria-hidden />
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <a className="cotiz-login__back" href="#">
          ← Volver al CRM
        </a>
      </div>
    </div>
  );
}

function AdvisorCotizacionesGate() {
  return (
    <div className="cotiz-login">
      <div className="cotiz-login__card">
        <div className="cotiz-login__brand">
          <Sparkles size={28} strokeWidth={2.2} className="cotiz-login__icon" aria-hidden />
          <div>
            <h1>Cotizaciones IA</h1>
            <p>Iniciá sesión en el portal de asesores para generar cotizaciones con tu firma.</p>
          </div>
        </div>
        <a className="cotiz-login__portalBtn" href="#/asesor">
          Ir al portal de asesores
        </a>
        <a className="cotiz-login__back" href="#/asesor">
          ← Volver
        </a>
      </div>
    </div>
  );
}

export default function CotizacionesApp() {
  const [fromAdvisor, setFromAdvisor] = useState(() => parseFromAdvisorHash());
  const [token, setToken] = useState(() => {
    if (parseFromAdvisorHash()) return sessionStorage.getItem(ADVISOR_TOKEN_KEY) || '';
    return sessionStorage.getItem(CRM_TOKEN_KEY) || '';
  });
  const [meAdvisor, setMeAdvisor] = useState(null);
  const [advisorMeStatus, setAdvisorMeStatus] = useState('idle');
  const [advisors, setAdvisors] = useState([]);
  const [advisorId, setAdvisorId] = useState('');
  const [messages, setMessages] = useState(() => [
    {
      role: 'assistant',
      content: parseFromAdvisorHash() ? WELCOME_ASSISTANT_ADVISOR : WELCOME_ASSISTANT
    }
  ]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [err, setErr] = useState('');
  const [apiPing, setApiPing] = useState(null);
  const threadEndRef = useRef(null);

  const api = useMemo(() => {
    const inst = axios.create({ baseURL: resolveApiBase() });
    const key = fromAdvisor ? ADVISOR_TOKEN_KEY : CRM_TOKEN_KEY;
    inst.interceptors.request.use((config) => {
      config.baseURL = resolveApiBase();
      const t = sessionStorage.getItem(key);
      if (t) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${t}`;
        config.headers[CRM_JWT_FALLBACK_HEADER] = t;
      }
      return config;
    });
    return inst;
  }, [fromAdvisor]);

  useEffect(() => {
    axios
      .get(crmApiFullUrl('/api/health'), { params: HEALTH_COTIZ_PING_PARAMS })
      .then((r) => {
        const ci = r.data?.cotizaciones_ia;
        if (ci && ci.ok === true && ci.service === 'cotizaciones-ia') {
          setApiPing('ok');
          return;
        }
        // Compatibilidad con backend anterior: si /api/health responde ok=true, el API está accesible.
        if (r.data?.ok === true) {
          setApiPing('ok');
          return;
        }
        setApiPing('fail');
      })
      .catch(() => setApiPing('fail'));
  }, []);

  useEffect(() => {
    const onHash = () => {
      const fa = parseFromAdvisorHash();
      setFromAdvisor(fa);
      setToken(
        fa ? sessionStorage.getItem(ADVISOR_TOKEN_KEY) || '' : sessionStorage.getItem(CRM_TOKEN_KEY) || ''
      );
      setMessages([
        {
          role: 'assistant',
          content: fa ? WELCOME_ASSISTANT_ADVISOR : WELCOME_ASSISTANT
        }
      ]);
      setAdvisorId('');
      setMeAdvisor(null);
      setAdvisorMeStatus('idle');
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const loadAdvisors = useCallback(async () => {
    try {
      const { data } = await api.get('/api/advisors');
      const list = (Array.isArray(data) ? data : []).filter((a) => Number(a.is_active) === 1);
      setAdvisors(list);
      setAdvisorId((prev) => (prev ? prev : String(list[0]?.id || '')));
    } catch {
      setAdvisors([]);
    }
  }, [api]);

  useEffect(() => {
    if (!token || fromAdvisor) return;
    loadAdvisors();
  }, [token, fromAdvisor, loadAdvisors]);

  useEffect(() => {
    if (!token || !fromAdvisor) {
      setMeAdvisor(null);
      setAdvisorMeStatus('idle');
      return undefined;
    }
    setAdvisorMeStatus('loading');
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/api/advisor/me');
        if (cancelled) return;
        const adv = data.advisor || null;
        setMeAdvisor(adv);
        setAdvisorMeStatus(adv ? 'ok' : 'error');
      } catch {
        if (!cancelled) {
          setMeAdvisor(null);
          setAdvisorMeStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fromAdvisor, api]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending || !token) return;
    const nextUser = { role: 'user', content: text };
    const history = [...messages, nextUser];
    setMessages(history);
    setDraft('');
    setSending(true);
    setErr('');
    try {
      const key = fromAdvisor ? ADVISOR_TOKEN_KEY : CRM_TOKEN_KEY;
      const auth_token = sessionStorage.getItem(key) || token || '';
      const { data } = await api.post(COTIZ_CHAT_URL, {
        messages: history,
        auth_token
      });
      const reply = data?.message;
      if (!reply?.content) throw new Error('Respuesta inválida');
      setMessages((prev) => [...prev, { role: 'assistant', content: reply.content }]);
    } catch (ex) {
      const st = ex.response?.status;
      const d = ex.response?.data;
      const apiErr = d?.error;
      const authHint = d?.auth ? ` [diagnóstico: ${d.auth}]` : '';
      let msg = (apiErr ? `${apiErr}${authHint}` : null) || ex.message || 'Error al consultar la IA';
      if (st === 404 && !apiErr) {
        msg =
          '404: no existe la ruta en el servidor (subí código nuevo y reiniciá Node/pm2) o el proxy no reenvía /api/messages/cotizacion-chat.';
      }
      if (st === 401 && !apiErr) {
        msg =
          '401 sin JSON del CRM: Apache está bloqueando o no hay ProxyPass /api → Node. Misma pestaña: ' +
          absolutePingUrl();
      }
      setErr(msg);
      setMessages((prev) => prev.slice(0, -1));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  async function handlePdf() {
    const aid = fromAdvisor ? meAdvisor?.id : advisorId;
    if (!token || !aid || pdfLoading) return;
    setPdfLoading(true);
    setErr('');
    try {
      const key = fromAdvisor ? ADVISOR_TOKEN_KEY : CRM_TOKEN_KEY;
      const auth_token = sessionStorage.getItem(key) || token || '';
      const body = fromAdvisor
        ? { messages, auth_token }
        : { messages, advisor_id: Number(advisorId), auth_token };
      const res = await api.post(COTIZ_PDF_URL, body, { responseType: 'blob' });
      const blob = res.data;
      if (blob.type && blob.type.includes('json')) {
        const t = await blob.text();
        const j = JSON.parse(t);
        throw new Error(j.error || 'Error al generar PDF');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Cotizacion_Bruja_TecnoXpert_${Date.now()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (ex) {
      const d = ex.response?.data;
      if (d instanceof Blob) {
        try {
          const t = await d.text();
          const j = JSON.parse(t);
          setErr(j.error || 'Error al generar PDF');
        } catch {
          setErr('Error al generar PDF');
        }
      } else {
        const pe = ex.response?.data?.error;
        setErr(
          pe ||
            (ex.response?.status === 401
              ? `401: comprobá ${absolutePingUrl()} y ProxyPass /api en Apache`
              : null) ||
            ex.message ||
            'No se pudo descargar el PDF'
        );
      }
    } finally {
      setPdfLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(CRM_TOKEN_KEY);
    setToken('');
    setMessages([{ role: 'assistant', content: WELCOME_ASSISTANT }]);
    setAdvisorId('');
  }

  function handleBackToAdvisorChat() {
    window.location.hash = '#/asesor';
  }

  if (fromAdvisor && !token) {
    return <AdvisorCotizacionesGate />;
  }

  if (!fromAdvisor && !token) {
    return <CotizacionesLogin onSuccess={setToken} />;
  }

  return (
    <div className="cotiz-app">
      <header className="cotiz-app__top">
        <div className="cotiz-app__topInner">
          <div className="cotiz-app__titleRow">
            <Sparkles size={22} strokeWidth={2.2} className="cotiz-app__titleIcon" aria-hidden />
            <div>
              <h1>Cotizaciones con IA</h1>
              <p className="cotiz-app__subtitle">
                {fromAdvisor
                  ? `Portal asesores · Firma: ${meAdvisor?.full_name || '…'}`
                  : 'Bruja TecnoXpert · ChatGPT + PDF'}
              </p>
            </div>
          </div>
          <div className="cotiz-app__toolbar">
            {fromAdvisor ? (
              <div className="cotiz-app__advisorLock">
                <span className="cotiz-app__advisorLockLabel">Firma en el PDF</span>
                {advisorMeStatus === 'error' ? (
                  <span className="cotiz-app__advisorLockErr">
                    No se pudo validar la sesión.{' '}
                    <a href="#/asesor">Volver al portal</a>
                  </span>
                ) : (
                  <strong className="cotiz-app__advisorLockName">
                    {advisorMeStatus === 'loading' ? 'Validando sesión…' : meAdvisor?.full_name || '—'}
                  </strong>
                )}
              </div>
            ) : (
              <label className="cotiz-app__selectWrap">
                <span>Asesor (firma en PDF)</span>
                <select
                  value={advisorId}
                  onChange={(e) => setAdvisorId(e.target.value)}
                  disabled={pdfLoading || sending}
                >
                  {advisors.length === 0 ? (
                    <option value="">Cargando asesores…</option>
                  ) : (
                    advisors.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.full_name}
                      </option>
                    ))
                  )}
                </select>
              </label>
            )}
            <button
              type="button"
              className="cotiz-app__pdfBtn"
              disabled={
                pdfLoading ||
                messages.length < 2 ||
                (fromAdvisor ? advisorMeStatus !== 'ok' || !meAdvisor?.id : !advisorId)
              }
              onClick={handlePdf}
            >
              <Download size={18} strokeWidth={2.1} aria-hidden />
              {pdfLoading ? 'Generando…' : 'Generar cotización PDF'}
            </button>
            {fromAdvisor ? (
              <button type="button" className="cotiz-app__ghostBtn" onClick={handleBackToAdvisorChat}>
                Volver al chat
              </button>
            ) : (
              <>
                <button type="button" className="cotiz-app__ghostBtn" onClick={handleLogout}>
                  Cerrar sesión
                </button>
                <a className="cotiz-app__ghostBtn cotiz-app__ghostLink" href="#">
                  CRM
                </a>
              </>
            )}
          </div>
        </div>
      </header>

      {apiPing === 'fail' ? (
        <div className="cotiz-app__banner">
          No responde el API en esta URL:{' '}
          <code className="cotiz-app__code">{absolutePingUrl()}</code>. En HTTPS público lo habitual es{' '}
          <strong>mismo dominio sin puerto extra</strong>: configurá Apache con ProxyPass{' '}
          <code className="cotiz-app__code">/api</code> → Node (ej. <code className="cotiz-app__code">127.0.0.1:3001</code>
          ). Ejemplo completo en <code className="cotiz-app__code">public/crm-api-config.js</code>. Dejá{' '}
          <code className="cotiz-app__code">__CRM_API_BASE__</code> vacío. Si el ping en{' '}
          <code className="cotiz-app__code">/api/health?cotizaciones_ping=1</code> está bien pero el chat
          falla, Apache no está mandando <strong>todo</strong> <code className="cotiz-app__code">/api</code> al
          Node del CRM: hace falta un solo <code className="cotiz-app__code">ProxyPass /api</code> → PM2.
        </div>
      ) : null}
      {err ? <div className="cotiz-app__banner">{err}</div> : null}

      <main className="cotiz-app__main">
        <div className="cotiz-app__thread">
          {messages.map((m, i) => (
            <div
              key={`${i}-${m.role}`}
              className={`cotiz-msg cotiz-msg--${m.role === 'user' ? 'user' : 'assistant'}`}
            >
              <div className="cotiz-msg__bubble">
                {m.role === 'assistant' ? (
                  <div className="cotiz-msg__md">
                    {m.content.split('\n').map((line, li) => {
                      const bold = /^\*\*(.+)\*\*$/.exec(line.trim());
                      if (bold) {
                        return (
                          <p key={li}>
                            <strong>{bold[1]}</strong>
                          </p>
                        );
                      }
                      if (!line.trim()) return <br key={li} />;
                      return <p key={li}>{line}</p>;
                    })}
                  </div>
                ) : (
                  <p>{m.content}</p>
                )}
              </div>
            </div>
          ))}
          {sending ? (
            <div className="cotiz-msg cotiz-msg--assistant">
              <div className="cotiz-msg__bubble cotiz-msg__typing">Pensando…</div>
            </div>
          ) : null}
          <div ref={threadEndRef} />
        </div>

        <form className="cotiz-app__composer" onSubmit={handleSend}>
          <FileText size={18} strokeWidth={2} className="cotiz-app__composerIcon" aria-hidden />
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Escribí los datos de la cotización o preguntá lo que necesites…"
            rows={2}
            disabled={sending}
          />
          <button type="submit" className="cotiz-app__sendBtn" disabled={sending || !draft.trim()}>
            Enviar
          </button>
        </form>
      </main>
    </div>
  );
}
