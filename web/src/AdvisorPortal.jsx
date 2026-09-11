import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  Bell,
  ChevronDown,
  ClipboardList,
  FileText,
  Image as ImageIcon,
  LogIn,
  LogOut,
  MessageSquare,
  Mic,
  Send,
  Sparkles,
  User,
  Video,
  Users,
  X
} from 'lucide-react';
import { CRM_JWT_FALLBACK_HEADER, resolveApiBase } from './apiBase.js';
import MessageBubble from './MessageBubble.jsx';

const API_BASE = resolveApiBase();
const TOKEN_KEY = 'tecnoxpert_advisor_jwt';

const api = axios.create({ baseURL: API_BASE });

/** Mismo conjunto que ADVISOR_FINISH_PIPELINE_LABELS en el servidor. */
const ADVISOR_FINISH_OPTIONS = [
  { value: 'Cerrado — ganado', label: 'Cerrado — ganado' },
  { value: 'Cerrado — perdido', label: 'Cerrado — perdido' },
  { value: 'Esperando respuesta', label: 'Esperando respuesta' },
  { value: 'Cotización enviada', label: 'Cotización enviada' },
  { value: 'En seguimiento', label: 'En seguimiento' },
  { value: 'Nuevo contacto', label: 'Nuevo contacto' }
];

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export default function AdvisorPortal() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [me, setMe] = useState(null);
  const [booting, setBooting] = useState(() => Boolean(sessionStorage.getItem(TOKEN_KEY)));
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [rows, setRows] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState('');
  const [takingClientRef, setTakingClientRef] = useState(null);
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return window.Notification.permission;
  });

  const [selectedClientRef, setSelectedClientRef] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('seguimiento_cliente');
  const [chatErr, setChatErr] = useState('');
  const [finishLabel, setFinishLabel] = useState(ADVISOR_FINISH_OPTIONS[0].value);
  const [actionLoading, setActionLoading] = useState(false);
  const [recordingAudio, setRecordingAudio] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const fileImageRef = useRef(null);
  const fileAudioRef = useRef(null);
  const fileVideoRef = useRef(null);
  const fileDocRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordStreamRef = useRef(null);
  const chatThreadRef = useRef(null);
  const chatEndRef = useRef(null);
  const rowsSnapshotRef = useRef(new Map());
  const rowsSnapshotReadyRef = useRef(false);
  const notificationDedupRef = useRef(new Set());

  const notifyBrowser = useCallback((title, body, tag) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    const dedupKey = String(tag || title);
    if (notificationDedupRef.current.has(dedupKey)) return;
    notificationDedupRef.current.add(dedupKey);
    window.setTimeout(() => notificationDedupRef.current.delete(dedupKey), 45000);
    const notice = new window.Notification(title, {
      body,
      tag: dedupKey,
      renotify: true,
      icon: '/favicon.svg'
    });
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
    window.setTimeout(() => notice.close(), 9000);
  }, []);

  const requestNotifications = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }
    if (window.Notification.permission === 'default') {
      const result = await window.Notification.requestPermission();
      setNotificationPermission(result);
      return result;
    }
    setNotificationPermission(window.Notification.permission);
    return window.Notification.permission;
  }, []);

  const rememberRowsAndNotify = useCallback((nextRows) => {
    const previous = rowsSnapshotRef.current;
    const next = new Map();
    for (const row of nextRows) {
      if (!row?.client_ref) continue;
      next.set(String(row.client_ref), {
        last_message_at: row.last_message_at || '',
        last_body: row.last_body || '',
        last_direction: row.last_direction || '',
        assigned_advisor_id: row.assigned_advisor_id ?? null,
        profile_name: row.profile_name || 'Cliente'
      });
    }

    if (!rowsSnapshotReadyRef.current) {
      rowsSnapshotRef.current = next;
      rowsSnapshotReadyRef.current = true;
      return;
    }

    for (const row of nextRows) {
      if (!row?.client_ref) continue;
      const key = String(row.client_ref);
      const old = previous.get(key);
      const pool = row.assigned_advisor_id == null;
      const name = row.profile_name || 'Cliente';
      const preview = String(row.last_body || '').trim();
      if (!old && pool) {
        notifyBrowser('Nuevo cliente libre', name + ' esta esperando asignacion.', 'advisor-pool-' + key);
        continue;
      }
      if (old && row.last_message_at && row.last_message_at !== old.last_message_at && row.last_direction === 'inbound') {
        notifyBrowser('Nuevo mensaje de cliente', preview ? name + ': ' + preview.slice(0, 90) : name + ' envio un mensaje.', 'advisor-msg-' + key + '-' + row.last_message_at);
      }
    }

    rowsSnapshotRef.current = next;
  }, [notifyBrowser]);

  const scrollChatToBottom = useCallback((smooth = false) => {
    window.setTimeout(() => {
      if (chatEndRef.current) {
        chatEndRef.current.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' });
        return;
      }
      if (chatThreadRef.current) {
        chatThreadRef.current.scrollTop = chatThreadRef.current.scrollHeight;
      }
    }, 0);
  }, []);
  const authedApi = useMemo(() => {
    const inst = axios.create({ baseURL: API_BASE });
    inst.interceptors.request.use((config) => {
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${t}`;
        config.headers[CRM_JWT_FALLBACK_HEADER] = t;
      }
      return config;
    });
    return inst;
  }, []);

  const loadNegotiations = useCallback(async (silent = false) => {
    const t = sessionStorage.getItem(TOKEN_KEY);
    if (!t) return;
    if (!silent) setListLoading(true);
    setListErr('');
    try {
      const { data } = await authedApi.get('/api/advisor/negotiations');
      const nextRows = Array.isArray(data) ? data : [];
      rememberRowsAndNotify(nextRows);
      setRows(nextRows);
    } catch (e) {
      if (!silent) setRows([]);
      if (!silent) setListErr(e.response?.data?.error || e.message || 'No se pudo cargar la lista');
    } finally {
      if (!silent) setListLoading(false);
    }
  }, [authedApi, rememberRowsAndNotify]);

  const clientPath = (clientRef) => encodeURIComponent(String(clientRef || ''));

  const loadThread = useCallback(
    async (phone, silent) => {
      if (!phone) return;
      if (!silent) setMsgLoading(true);
      setChatErr('');
      try {
        const { data } = await authedApi.get(`/api/advisor/conversations/${clientPath(phone)}/messages`);
        setMessages(Array.isArray(data) ? data : []);
        await authedApi.post(`/api/advisor/conversations/${clientPath(phone)}/read`);
      } catch (e) {
        if (!silent) setMessages([]);
        setChatErr(e.response?.data?.error || e.message || 'No se pudo cargar el chat');
      } finally {
        if (!silent) setMsgLoading(false);
      }
    },
    [authedApi]
  );

  useEffect(() => {
    if (!token) {
      setMe(null);
      setBooting(false);
      setRows([]);
      setTemplates([]);
      setSelectedClientRef(null);
      return;
    }
    let cancelled = false;
    setBooting(true);
    (async () => {
      try {
        const { data } = await authedApi.get('/api/advisor/me');
        if (cancelled) return;
        setMe(data.advisor || null);
        if (data.advisor) {
          await loadNegotiations();
          try {
            const tplResponse = await authedApi.get('/api/advisor/templates');
            const list = Array.isArray(tplResponse.data) ? tplResponse.data : [];
            setTemplates(list);
            if (list.length && !list.some((tpl) => tpl.id === selectedTemplateId)) {
              setSelectedTemplateId(list[0].id);
            }
          } catch {
            setTemplates([]);
          }
        }
      } catch {
        if (!cancelled) {
          sessionStorage.removeItem(TOKEN_KEY);
          setToken('');
          setMe(null);
          setRows([]);
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, authedApi, loadNegotiations]);

  useEffect(() => {
    if (!me?.id) return undefined;
    requestNotifications();
    const refreshNow = () => {
      loadNegotiations(true);
      if (selectedClientRef) loadThread(selectedClientRef, true);
    };
    const onVisibility = () => {
      if (!document.hidden) refreshNow();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const socketOpts = {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { advisorToken: token }
    };
    const socket = API_BASE ? io(API_BASE, socketOpts) : io(socketOpts);
    const onCrmUpdate = (payload) => {
      const type = String(payload?.type || '');
      if (['inbound', 'advisor_take', 'deleted', 'conv_status', 'advisor_finish', 'outbound'].includes(type)) {
        loadNegotiations(true);
        if (selectedClientRef) loadThread(selectedClientRef, true);
      }
    };
    const onConnect = () => refreshNow();
    socket.on('connect', onConnect);
    socket.on('crm:update', onCrmUpdate);

    const id = window.setInterval(() => {
      loadNegotiations(true);
    }, document.hidden ? 30000 : 10000);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.off('connect', onConnect);
      socket.off('crm:update', onCrmUpdate);
      socket.close();
    };
  }, [me?.id, token, selectedClientRef, loadThread, loadNegotiations, requestNotifications]);

  useEffect(() => {
    if (!selectedClientRef || msgLoading) return;
    scrollChatToBottom(false);
  }, [selectedClientRef, messages.length, msgLoading, scrollChatToBottom]);
  useEffect(() => {
    if (!selectedClientRef) {
      setMessages([]);
      setDraft('');
      setChatErr('');
      return undefined;
    }
    loadThread(selectedClientRef, false);
    const id = window.setInterval(() => {
      loadThread(selectedClientRef, true);
    }, 12000);
    return () => window.clearInterval(id);
  }, [selectedClientRef, loadThread]);

  useEffect(() => {
    if (!selectedClientRef || !me?.id) return;
    const still = rows.some(
      (r) =>
        String(r.client_ref) === String(selectedClientRef) &&
        Number(r.assigned_advisor_id) === Number(me.id)
    );
    if (!still) setSelectedClientRef(null);
  }, [rows, selectedClientRef, me?.id]);

  useEffect(() => {
    if (!lightbox) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginErr('');
    setLoginLoading(true);
    try {
      const { data } = await api.post('/api/advisor-auth/login', { login, password });
      if (!data?.token) throw new Error('Respuesta inválida');
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setToken(data.token);
      setPassword('');
      requestNotifications();
    } catch (err) {
      setLoginErr(err.response?.data?.error || err.message || 'Error al iniciar sesión');
    } finally {
      setLoginLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
    setMe(null);
    setRows([]);
    setTemplates([]);
    setSelectedClientRef(null);
    window.location.hash = '#/asesor';
  }

  async function handleTake(phone) {
    setTakingClientRef(phone);
    setListErr('');
    try {
      await authedApi.post(`/api/advisor/conversations/${clientPath(phone)}/take`);
      await loadNegotiations();
      setSelectedClientRef(String(phone));
    } catch (e) {
      setListErr(e.response?.data?.error || e.message || 'No se pudo asignar');
    } finally {
      setTakingClientRef(null);
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selectedClientRef || sending) return;
    setSending(true);
    setChatErr('');
    try {
      await authedApi.post(`/api/advisor/conversations/${clientPath(selectedClientRef)}/send`, {
        body: text
      });
      setDraft('');
      await loadThread(selectedClientRef, true);
      await loadNegotiations();
    } catch (err) {
      setChatErr(err.response?.data?.error || err.message || 'No se pudo enviar');
    } finally {
      setSending(false);
    }
  }

  async function handleSendFile(file) {
    if (!file || !selectedClientRef || sending) return;
    setSending(true);
    setChatErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const cap = draft.trim();
      if (cap) fd.append('body', cap);
      await authedApi.post(`/api/advisor/conversations/${clientPath(selectedClientRef)}/send-media`, fd);
      setDraft('');
      await loadThread(selectedClientRef, true);
      await loadNegotiations();
    } catch (err) {
      setChatErr(err.response?.data?.error || err.message || 'No se pudo enviar archivo');
    } finally {
      setSending(false);
    }
  }

  async function handleSendTemplate() {
    if (!selectedClientRef || sending || !selectedTemplateId) return;
    setSending(true);
    setChatErr('');
    try {
      await authedApi.post(`/api/advisor/conversations/${clientPath(selectedClientRef)}/send-template`, {
        templateId: selectedTemplateId
      });
      await loadThread(selectedClientRef, true);
      await loadNegotiations();
    } catch (err) {
      setChatErr(err.response?.data?.error || err.message || 'No se pudo enviar la plantilla');
    } finally {
      setSending(false);
    }
  }

  function stopAudioTracks() {
    if (recordStreamRef.current) {
      recordStreamRef.current.getTracks().forEach((track) => track.stop());
      recordStreamRef.current = null;
    }
  }

  function pickAudioMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
    const options = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm'];
    return options.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  async function startAudioRecording() {
    if (!selectedClientRef || sending || recordingAudio) return;
    setChatErr('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setChatErr('Este navegador no permite grabar audio aqu?. Usa adjuntar archivo de audio.');
      fileAudioRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = pickAudioMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordChunksRef.current = [];
      recordStreamRef.current = stream;
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recordChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setChatErr('No se pudo grabar el audio. Revisa permisos del micr?fono.');
        setRecordingAudio(false);
        stopAudioTracks();
      };
      recorder.onstop = async () => {
        const chunks = recordChunksRef.current;
        const type = recorder.mimeType || mimeType || 'audio/webm';
        recordChunksRef.current = [];
        mediaRecorderRef.current = null;
        setRecordingAudio(false);
        stopAudioTracks();
        if (!chunks.length) return;
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(chunks, { type });
        const file = new File([blob], `nota-voz-${Date.now()}.${ext}`, { type });
        await handleSendFile(file);
      };

      recorder.start();
      setRecordingAudio(true);
    } catch (err) {
      stopAudioTracks();
      setRecordingAudio(false);
      setChatErr(err?.name === 'NotAllowedError' ? 'Permiso de micr?fono denegado.' : 'No se pudo activar el micr?fono.');
    }
  }

  function stopAudioRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  }

  function handleAudioRecordClick() {
    if (recordingAudio) stopAudioRecording();
    else startAudioRecording();
  }

  async function handleFinish() {
    if (!selectedClientRef || actionLoading) return;
    const label = finishLabel;
    if (
      !window.confirm(
        `¿Mover el cliente a «${label}»? Saldrá de tu lista de negociación y se liberará la asignación.`
      )
    ) {
      return;
    }
    setActionLoading(true);
    setChatErr('');
    try {
      await authedApi.post(`/api/advisor/conversations/${clientPath(selectedClientRef)}/finish`, {
        pipeline_label: label
      });
      setSelectedClientRef(null);
      await loadNegotiations();
    } catch (err) {
      setChatErr(err.response?.data?.error || err.message || 'No se pudo guardar la etapa');
    } finally {
      setActionLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      stopAudioTracks();
    };
  }, []);

  const selectedRow = useMemo(
    () => rows.find((r) => String(r.client_ref) === String(selectedClientRef)),
    [rows, selectedClientRef]
  );

  const portalHref = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/asesor`;

  if (booting) {
    return (
      <div className="adv-portal">
        <div className="adv-portal__card">
          <p className="adv-portal__hint">Comprobando sesión…</p>
        </div>
      </div>
    );
  }

  if (!token || !me) {
    return (
      <div className="adv-portal">
        <div className="adv-portal__card">
          <div className="adv-portal__brand">
            <div className="adv-portal__logo" aria-hidden>
              <Users size={26} strokeWidth={2.2} />
            </div>
            <div>
              <h1>Portal asesores</h1>
              <p>TecnoXpert · Negociaciones</p>
            </div>
          </div>
          <form className="adv-portal__form" onSubmit={handleLogin}>
            <label>
              <span>Correo o teléfono (como en el CRM)</span>
              <input
                type="text"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                autoComplete="username"
                placeholder="Solo número, ej. 3143061109"
                required
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {loginErr ? <p className="adv-portal__err">{loginErr}</p> : null}
            <button type="submit" className="adv-portal__submit" disabled={loginLoading}>
              <LogIn size={18} strokeWidth={2.1} aria-hidden />
              {loginLoading ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
          <p className="adv-portal__hint">
            La contraseña la define un administrador en el CRM (Asesores). El servidor debe tener{' '}
            <code className="adv-portal__code">ADVISOR_JWT_SECRET</code> en{' '}
            <code className="adv-portal__code">.env</code>.
          </p>
          <p className="adv-portal__hint adv-portal__hint--muted">
            Enlace: <code className="adv-portal__code">{portalHref}</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="adv-portal adv-portal--app">
      <header className="adv-portal__top">
        <div className="adv-portal__topInner">
          <div className="adv-portal__user">
            <User size={20} strokeWidth={2} aria-hidden />
            <div>
              <strong>{me.full_name}</strong>
              <span className="adv-portal__userMeta">
                {me.email || 'Asesor'}
              </span>
            </div>
          </div>
          <div className="adv-portal__topActions">
            <button
              type="button"
              className={`adv-portal__notifyBtn adv-portal__notifyBtn--${notificationPermission}`}
              onClick={requestNotifications}
              title={notificationPermission === 'granted' ? 'Notificaciones activas' : 'Activar notificaciones'}
            >
              <Bell size={17} strokeWidth={2.1} aria-hidden />
              {notificationPermission === 'granted' ? 'Alertas activas' : notificationPermission === 'denied' ? 'Alertas bloqueadas' : 'Activar alertas'}
            </button>
          <button type="button" className="adv-portal__logout" onClick={handleLogout}>
            <LogOut size={17} strokeWidth={2.1} aria-hidden />
            Salir
          </button>
          </div>
        </div>
      </header>

      <main className="adv-portal__main">
        <h2>Clientes disponibles</h2>
        <p className="adv-portal__intro">
          Aquí solo verás los clientes que el administrador te haya asignado. Atiéndelos por WhatsApp
          desde este portal y marca la <strong>etapa final</strong> cuando termines la gestión.
        </p>

        {listErr ? <p className="adv-portal__banner">{listErr}</p> : null}

        <div className="adv-portal__tableWrap">
          <table className="adv-portal__table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Último mensaje</th>
                <th>Estado</th>
                <th className="adv-portal__thAct">Acción</th>
              </tr>
            </thead>
            <tbody>
              {listLoading && (
                <tr>
                  <td colSpan={4} className="adv-portal__empty">
                    Cargando…
                  </td>
                </tr>
              )}
              {!listLoading &&
                rows.map((r) => {
                  const mine = Number(r.assigned_advisor_id) === Number(me.id);
                  const pool = r.assigned_advisor_id == null;
                  const clientRef = r.client_ref;
                  const open = selectedClientRef === clientRef;
                  return (
                    <tr key={r.client_ref} className={open ? 'adv-portal__row--active' : ''}>
                      <td data-label="Cliente">
                        <span className="adv-portal__name">{r.profile_name || '—'}</span>
                      </td>
                      <td data-label="Último mensaje">
                        <span className="adv-portal__preview">{r.last_body || '—'}</span>
                        <span className="adv-portal__time">{formatTime(r.last_message_at)}</span>
                      </td>
                      <td data-label="Estado">
                        {pool ? (
                          <span className="adv-portal__tag adv-portal__tag--pool">Libre</span>
                        ) : (
                          <span className="adv-portal__tag adv-portal__tag--mine">Tuyo</span>
                        )}
                        {r.negotiation_started_at ? (
                          <span className="adv-portal__time">
                            {formatTime(r.negotiation_started_at)}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Acción" className="adv-portal__act">
                        {pool ? (
                          <button
                            type="button"
                            className="adv-portal__take"
                            disabled={takingClientRef === r.client_ref}
                            onClick={() => handleTake(r.client_ref)}
                          >
                            {takingClientRef === r.client_ref ? 'Asignando...' : 'Tomar cliente'}
                          </button>
                        ) : mine ? (
                          <button
                            type="button"
                            className={`adv-portal__chatToggle${open ? ' adv-portal__chatToggle--open' : ''}`}
                            onClick={() => setSelectedClientRef(open ? null : clientRef)}
                          >
                            <MessageSquare size={16} strokeWidth={2} aria-hidden />
                            {open ? 'Cerrar chat' : 'Abrir chat'}
                            <ChevronDown size={16} strokeWidth={2} aria-hidden />
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              {!listLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="adv-portal__empty">
                    No hay negociaciones disponibles para vos en este momento.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedClientRef && selectedRow && Number(selectedRow.assigned_advisor_id) === Number(me.id) ? (
          <div className="adv-portal__chatModal" role="dialog" aria-modal="true" aria-label="Chat con cliente">
            <button
              type="button"
              className="adv-portal__chatBackdrop"
              onClick={() => setSelectedClientRef(null)}
              aria-label="Cerrar chat"
            />
            <section className="adv-portal__chatSheet">
            <div className="adv-portal__chatSheetHead">
              <div>
                <h3 className="adv-portal__chatTitle">
                  {selectedRow.profile_name || 'Cliente'}{' '}
                  <span className="adv-portal__chatPhone">{selectedRow.country_code || 'Indicativo privado'}</span>
                </h3>
                <p className="adv-portal__chatSub">Conversacion por WhatsApp</p>
                <a className="adv-portal__cotizacionesBtn" href="#/cotizaciones?from=advisor">
                  <Sparkles size={16} strokeWidth={2.1} aria-hidden />
                  Apoyo
                </a>
              </div>
              <button
                type="button"
                className="adv-portal__iconBtn"
                onClick={() => setSelectedClientRef(null)}
                aria-label="Cerrar panel de chat"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            {chatErr ? <p className="adv-portal__banner adv-portal__banner--tight">{chatErr}</p> : null}

            <div className="adv-portal__chatThread" ref={chatThreadRef}>
              {msgLoading ? (
                <p className="adv-portal__hint">Cargando mensajes…</p>
              ) : messages.length === 0 ? (
                <p className="adv-portal__hint">Sin mensajes aún. Escribí abajo para iniciar.</p>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={{ ...m, _timeLabel: formatTime(m.created_at) }}
                      apiBase={API_BASE}
                      onOpenImage={setLightbox}
                    />
                  ))}
                  <div ref={chatEndRef} className="adv-portal__chatEnd" aria-hidden />
                </>
              )}
            </div>

            <form className="adv-portal__composer" onSubmit={handleSend}>
              <div className="adv-portal__tools" aria-label="Adjuntar archivo">
                <input
                  ref={fileImageRef}
                  type="file"
                  accept="image/*"
                  className="crm-hiddenInput"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleSendFile(f);
                  }}
                />
                <input
                  ref={fileAudioRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.aac,.ogg,.oga,.wav,.opus"
                  className="crm-hiddenInput"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleSendFile(f);
                  }}
                />
                <input
                  ref={fileVideoRef}
                  type="file"
                  accept="video/*"
                  className="crm-hiddenInput"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleSendFile(f);
                  }}
                />
                <input
                  ref={fileDocRef}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="crm-hiddenInput"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) handleSendFile(f);
                  }}
                />
                <button
                  type="button"
                  className="adv-portal__toolBtn"
                  disabled={sending}
                  title="Enviar imagen"
                  onClick={() => fileImageRef.current?.click()}
                >
                  <ImageIcon size={18} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className={`adv-portal__toolBtn${recordingAudio ? ' adv-portal__toolBtn--recording' : ''}`}
                  disabled={sending}
                  title={recordingAudio ? 'Detener y enviar audio' : 'Grabar audio'}
                  aria-label={recordingAudio ? 'Detener y enviar audio' : 'Grabar audio'}
                  onClick={handleAudioRecordClick}
                >
                  <Mic size={18} strokeWidth={2.2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="adv-portal__toolBtn"
                  disabled={sending}
                  title="Enviar video"
                  aria-label="Enviar video"
                  onClick={() => fileVideoRef.current?.click()}
                >
                  <Video size={18} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="adv-portal__toolBtn"
                  disabled={sending}
                  title="Enviar PDF"
                  onClick={() => fileDocRef.current?.click()}
                >
                  <FileText size={18} strokeWidth={2} aria-hidden />
                </button>
                <button
                  type="button"
                  className="adv-portal__toolBtn adv-portal__templateIconBtn"
                  disabled={sending || templates.length === 0 || !selectedTemplateId}
                  onClick={handleSendTemplate}
                  title="Enviar plantilla seguimiento"
                  aria-label="Enviar plantilla seguimiento"
                >
                  <ClipboardList size={18} strokeWidth={2} aria-hidden />
                </button>
              </div>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Escribí el mensaje para WhatsApp…"
                rows={2}
                disabled={sending}
              />
              <button type="submit" className="adv-portal__sendBtn" disabled={sending || !draft.trim()}>
                <Send size={18} strokeWidth={2} aria-hidden />
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </form>

            <div className="adv-portal__chatFoot">
              <div className="adv-portal__finishRow">
                <label className="adv-portal__finishLabel">
                  <span>Etapa del embudo (cierre o seguimiento)</span>
                  <select
                    value={finishLabel}
                    onChange={(e) => setFinishLabel(e.target.value)}
                    disabled={actionLoading}
                  >
                    {ADVISOR_FINISH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="adv-portal__btnPrimary"
                  disabled={actionLoading}
                  onClick={handleFinish}
                >
                  Guardar etapa
                </button>
              </div>
              <p className="adv-portal__note">
                Si este cliente debe pasar a otro asesor, solicita la reasignación al administrador.
              </p>
            </div>
            </section>
          </div>
        ) : null}
      </main>

      {lightbox ? (
        <div
          className="adv-portal__lightbox"
          role="dialog"
          aria-label="Imagen"
          onClick={() => setLightbox(null)}
        >
          <button type="button" className="adv-portal__lightboxClose" aria-label="Cerrar">
            ×
          </button>
          <img src={lightbox} alt="" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </div>
  );
}
