import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import {
  AlertTriangle,
  Archive,
  Ban,
  Briefcase,
  Bot,
  Building2,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  ClipboardList,
  Flag,
  Image as ImageIcon,
  Inbox,
  LayoutDashboard,
  LogOut,
  MapPin,
  MessageSquare,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  Tags,
  Target,
  Trash2,
  Users,
  Video,
  Wifi,
  WifiOff
} from 'lucide-react';
import MessageBubble from './MessageBubble.jsx';
import ContactAvatar from './ContactAvatar.jsx';
import {
  CRM_JWT_FALLBACK_HEADER,
  CRM_LOGIN_PATHS,
  describeCrmLoginUrls,
  resolveApiBase
} from './apiBase.js';
import {
  CRM_PRIORITIES,
  FOLLOW_UP_KIND_OPTIONS,
  PIPELINE_STAGES,
  followUpKindLabel,
  followUpStateLabel,
  priorityLabel
} from './crmConfig.js';

const API_BASE = resolveApiBase();

const CRM_TOKEN_KEY = 'tecnoxpert_crm_jwt';

const api = axios.create({ baseURL: API_BASE });

function CrmLoginScreen({ onSuccess }) {
  const [username, setUsername] = useState('tecnoxpert');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      let data = null;
      let lastEx = null;
      for (const loginPath of CRM_LOGIN_PATHS) {
        try {
          const res = await api.post(loginPath, { username, password });
          data = res.data;
          break;
        } catch (ex) {
          lastEx = ex;
          if (ex.response?.status === 404) continue;
          throw ex;
        }
      }
      if (!data?.token) {
        throw lastEx || new Error('Respuesta inválida');
      }
      sessionStorage.setItem(CRM_TOKEN_KEY, data.token);
      onSuccess(data.token);
    } catch (ex) {
      const status = ex.response?.status;
      const tried = describeCrmLoginUrls();
      let msg = ex.response?.data?.error || ex.message || 'No se pudo iniciar sesión';
      if (status === 404) {
        msg = `La API no expone aún el login (404). Abre ${window.location.protocol}//${window.location.hostname}:8989/api/health: si falta "crm_panel_login_paths", Node no cargó el app.js nuevo (PM2 suele tener código viejo en RAM). En el servidor: pm2 restart jabru (o desde la raíz del proyecto: npm run pm2:restart). Rutas probadas: ${tried}. Detalle: server/DEPLOY.txt`;
      }
      setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adv-portal">
      <div className="adv-portal__card">
        <div className="adv-portal__brand">
          <div className="adv-portal__logo" aria-hidden>
            <MessageSquare size={28} strokeWidth={2.2} />
          </div>
          <div>
            <h1>Bruja TecnoXpert CRM</h1>
            <p>Acceso al panel principal</p>
          </div>
        </div>
        <form className="adv-portal__form" onSubmit={submit}>
          <label>
            <span>Usuario</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </label>
          <label>
            <span>Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </label>
          {err ? <p className="adv-portal__err">{err}</p> : null}
          <button className="adv-portal__submit" type="submit" disabled={loading}>
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        <p className="adv-portal__hint adv-portal__hint--muted">
          Portal de asesores: <span className="adv-portal__code">#/asesor</span>
        </p>
      </div>
    </div>
  );
}

/** Alineado con el servidor: en Negociación no hay respuestas automáticas del bot. */
function pipelineIsNegotiationEmbudo(label) {
  const n = String(label || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '');
  return n === 'negociacion';
}

function formatPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('57')) {
    return `+${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  }
  return d ? `+${d}` : '—';
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function previewForConv(c) {
  if (c.last_body) return c.last_body;
  const t = c.last_message_type || 'text';
  if (t === 'image') return '📷 Imagen';
  if (t === 'audio') return '🎵 Audio';
  if (t === 'video') return '🎬 Video';
  if (t === 'document') return '📎 Archivo';
  return 'Sin mensajes';
}

function initials(name, phone) {
  const s = (name || phone || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function normalizeConvStatus(convOrStatus) {
  const s =
    typeof convOrStatus === 'object' && convOrStatus !== null
      ? convOrStatus.conv_status
      : convOrStatus;
  const v = String(s || 'inbox').toLowerCase();
  if (v === 'spam' || v === 'blocked') return v;
  return 'inbox';
}

function displayConversationName(conv) {
  return conv?.lead_name || conv?.display_name || conv?.profile_name || formatPhone(conv?.customer_phone);
}

function formatDateTimeLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

function createEmptyFollowUpDraft(hoursAhead = 24) {
  return {
    title: '',
    description: '',
    due_at: formatDateTimeLocalInput(new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString()),
    kind: 'manual',
    assigned_advisor_id: ''
  };
}

function createBusinessSettingsDraft(payload) {
  const settings = payload?.settings || {};
  return {
    business_name: settings.business_name || '',
    business_tagline: settings.business_tagline || '',
    public_webhook_url: settings.public_webhook_url || '',
    public_api_url: settings.public_api_url || '',
    twilio_whatsapp_from: settings.twilio_whatsapp_from || '',
    validate_twilio_signature: settings.validate_twilio_signature !== false,
    openai_model: settings.openai_model || 'gpt-4o-mini',
    openai_bot_enabled: settings.openai_bot_enabled !== false,
    crm_admin_user: settings.crm_admin_user || '',
    twilio_account_sid: '',
    twilio_auth_token: '',
    openai_api_key: '',
    crm_admin_password: '',
    crm_jwt_secret: '',
    advisor_jwt_secret: ''
  };
}

function crmEventLabel(eventType) {
  const labels = {
    lead_created: 'Lead creado',
    customer_reply: 'Cliente respondio',
    system_followups_cleared: 'Seguimientos automaticos limpiados',
    pipeline_stage_changed: 'Etapa actualizada',
    profile_updated: 'Ficha comercial actualizada',
    followup_created: 'Seguimiento creado',
    followup_updated: 'Seguimiento actualizado',
    followup_deleted: 'Seguimiento eliminado',
    negotiation_handoff: 'Handoff a negociacion',
    advisor_assigned: 'Asesor asignado',
    advisor_message_sent: 'Mensaje del asesor',
    advisor_released: 'Cliente reasignado',
    advisor_finished_stage: 'Negociacion cerrada',
    bot_pause_changed: 'Bot actualizado',
    conversation_folder_changed: 'Carpeta actualizada'
  };
  return labels[eventType] || String(eventType || '').replace(/_/g, ' ');
}

function crmFieldLabel(key) {
  const labels = {
    actor: 'Origen',
    advisor_id: 'Asesor',
    assigned_advisor_id: 'Asesor asignado',
    attachment_count: 'Adjuntos',
    budget_label: 'Presupuesto',
    budget_value: 'Monto estimado',
    city: 'Ciudad',
    company_name: 'Empresa',
    due_at: 'Fecha',
    followup_id: 'Seguimiento',
    has_body: 'Incluye texto',
    internal_notes: 'Notas',
    kind: 'Tipo',
    lead_name: 'Nombre',
    lead_source: 'Origen lead',
    lost_reason: 'Motivo de perdida',
    message_type: 'Tipo mensaje',
    pending_count: 'Pendientes',
    pipeline_label: 'Etapa',
    preview: 'Detalle',
    priority: 'Prioridad',
    profile_name: 'Perfil',
    reason: 'Motivo',
    title: 'Titulo'
  };
  return labels[key] || String(key || '').replace(/_/g, ' ');
}

function crmFieldValue(key, value) {
  if (value === null || value === undefined || value === '') return 'Sin dato';
  if (typeof value === 'boolean') return value ? 'Si' : 'No';
  if (key === 'has_body') return Number(value) || value === true ? 'Si' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string' && /_at$/.test(key)) {
    return formatTime(value);
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function crmEventEntries(payload) {
  if (!payload) return [];
  if (payload.changed_fields && typeof payload.changed_fields === 'object') {
    return Object.entries(payload.changed_fields)
      .map(([key, change]) => {
        const from = change?.from ?? 'Sin dato';
        const to = change?.to ?? 'Sin dato';
        return {
          label: crmFieldLabel(key),
          value: `${crmFieldValue(key, from)} -> ${crmFieldValue(key, to)}`
        };
      });
  }
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => ({
      label: crmFieldLabel(key),
      value: crmFieldValue(key, value)
    }));
}

function summaryParagraphs(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line.replace(/^[\-\*\u2022]\s*/, '').trim())
    .filter(Boolean);
}

function followUpTone(state) {
  if (state === 'overdue') return 'crm-taskPill--overdue';
  if (state === 'done') return 'crm-taskPill--done';
  if (state === 'canceled') return 'crm-taskPill--muted';
  return 'crm-taskPill--pending';
}

export default function App() {
  const [crmToken, setCrmToken] = useState(() =>
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(CRM_TOKEN_KEY) || '' : ''
  );
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [sending, setSending] = useState(false);
  const [health, setHealth] = useState(null);
  const [error, setError] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [socketOk, setSocketOk] = useState(false);
  const fileImageRef = useRef(null);
  const fileAudioRef = useRef(null);
  const fileVideoRef = useRef(null);
  const fileDocRef = useRef(null);

  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)').matches : false
  );
  const [mobilePanel, setMobilePanel] = useState('list');
  const [appView, setAppView] = useState('inbox');
  const [advisors, setAdvisors] = useState([]);
  const [advisorsLoading, setAdvisorsLoading] = useState(false);
  const [advisorEditor, setAdvisorEditor] = useState(null);
  const [advisorSaving, setAdvisorSaving] = useState(false);
  const [advisorDeletingId, setAdvisorDeletingId] = useState(null);
  const [estadoFilter, setEstadoFilter] = useState('');
  const [labelSaving, setLabelSaving] = useState(null);
  const [catalogServices, setCatalogServices] = useState([]);
  const [convServices, setConvServices] = useState([]);
  const [serviceSaving, setServiceSaving] = useState(false);
  const [botPauseSaving, setBotPauseSaving] = useState(false);
  const [convFolder, setConvFolder] = useState('inbox');
  const [convActionSaving, setConvActionSaving] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [conversationProfile, setConversationProfile] = useState(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [followUps, setFollowUps] = useState([]);
  const [followUpsLoading, setFollowUpsLoading] = useState(false);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [crmEvents, setCrmEvents] = useState([]);
  const [crmEventsLoading, setCrmEventsLoading] = useState(false);
  const [summaryRefreshing, setSummaryRefreshing] = useState(false);
  const [followUpDraft, setFollowUpDraft] = useState(() => createEmptyFollowUpDraft());
  const [businessSettings, setBusinessSettings] = useState(null);
  const [businessSettingsDraft, setBusinessSettingsDraft] = useState(() =>
    createBusinessSettingsDraft()
  );
  const [businessSettingsLoading, setBusinessSettingsLoading] = useState(false);
  const [businessSettingsSaving, setBusinessSettingsSaving] = useState(false);

  const handleCrmLogout = useCallback(() => {
    try {
      sessionStorage.removeItem(CRM_TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setCrmToken('');
    setSelected(null);
    setMessages([]);
    setConversationProfile(null);
    setFollowUps([]);
    setCrmEvents([]);
    setBusinessSettings(null);
    setBusinessSettingsDraft(createBusinessSettingsDraft());
    setAppView('dashboard');
    setError('');
  }, []);

  useEffect(() => {
    const reqId = api.interceptors.request.use((config) => {
      const t = sessionStorage.getItem(CRM_TOKEN_KEY);
      if (t) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${t}`;
        config.headers[CRM_JWT_FALLBACK_HEADER] = t;
      }
      return config;
    });
    const resId = api.interceptors.response.use(
      (r) => r,
      (ex) => {
        const url = String(ex.config?.url || '');
        if (ex.response?.status === 401 && !url.includes('/crm-auth/login')) {
          sessionStorage.removeItem(CRM_TOKEN_KEY);
          setCrmToken('');
        }
        return Promise.reject(ex);
      }
    );
    return () => {
      api.interceptors.request.eject(reqId);
      api.interceptors.response.eject(resId);
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (!isNarrow) setMobilePanel('list');
  }, [isNarrow]);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/api/conversations');
      setConversations(data);
      setError('');
    } catch {
      setError('No se pudo cargar la bandeja. ¿Está el servidor en marcha?');
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadCatalogServices = useCallback(async () => {
    try {
      const { data } = await api.get('/api/services');
      setCatalogServices(Array.isArray(data) ? data : []);
    } catch {
      setCatalogServices([]);
    }
  }, []);

  const loadAdvisors = useCallback(async () => {
    setAdvisorsLoading(true);
    try {
      const { data } = await api.get('/api/advisors');
      setAdvisors(Array.isArray(data) ? data : []);
    } catch {
      setAdvisors([]);
      setError('No se pudieron cargar los asesores.');
    } finally {
      setAdvisorsLoading(false);
    }
  }, []);

  const loadConvServices = useCallback(async (phone) => {
    if (!phone) {
      setConvServices([]);
      return;
    }
    try {
      const { data } = await api.get(`/api/conversations/${phone}/services`);
      setConvServices(Array.isArray(data) ? data : []);
    } catch {
      setConvServices([]);
    }
  }, []);

  const loadDashboard = useCallback(async (silent) => {
    if (!silent) setDashboardLoading(true);
    try {
      const { data } = await api.get('/api/dashboard/summary');
      setDashboard(data);
    } catch {
      if (!silent) setError('No se pudo cargar el dashboard comercial.');
    } finally {
      if (!silent) setDashboardLoading(false);
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/api/health');
      setHealth(data);
    } catch {
      /* ignore */
    }
  }, []);

  const loadBusinessSettings = useCallback(async (silent) => {
    if (!silent) setBusinessSettingsLoading(true);
    try {
      const { data } = await api.get('/api/business-settings');
      setBusinessSettings(data);
      setBusinessSettingsDraft(createBusinessSettingsDraft(data));
    } catch (err) {
      if (!silent) {
        setError(
          err.response?.data?.error || err.message || 'No se pudieron cargar los ajustes del negocio.'
        );
      }
    } finally {
      if (!silent) setBusinessSettingsLoading(false);
    }
  }, []);

  const loadConversationProfile = useCallback(async (phone) => {
    if (!phone) {
      setConversationProfile(null);
      return;
    }
    try {
      const { data } = await api.get(`/api/conversations/${phone}/profile`);
      setConversationProfile(data);
    } catch {
      setConversationProfile(null);
    }
  }, []);

  const loadFollowUps = useCallback(async (phone) => {
    if (!phone) {
      setFollowUps([]);
      return;
    }
    setFollowUpsLoading(true);
    try {
      const { data } = await api.get(`/api/conversations/${phone}/followups`);
      setFollowUps(Array.isArray(data) ? data : []);
    } catch {
      setFollowUps([]);
    } finally {
      setFollowUpsLoading(false);
    }
  }, []);

  const loadCrmEvents = useCallback(async (phone, options = {}) => {
    if (!phone) {
      setCrmEvents([]);
      return;
    }
    const silent = options.silent === true;
    if (!silent) setCrmEventsLoading(true);
    try {
      const { data } = await api.get(`/api/conversations/${phone}/crm-events`);
      setCrmEvents(Array.isArray(data) ? data : []);
    } catch {
      if (!silent) setCrmEvents([]);
    } finally {
      if (!silent) setCrmEventsLoading(false);
    }
  }, []);

  const loadMessages = useCallback(async (phone, options = {}) => {
    if (!phone) return;
    const silent = options.silent === true;
    if (!silent) setLoadingThread(true);
    try {
      const { data } = await api.get(`/api/conversations/${phone}/messages`);
      setMessages(data);
      await api.post(`/api/conversations/${phone}/read`);
      setConversations((prev) =>
        prev.map((c) =>
          String(c.customer_phone) === String(phone) ? { ...c, unread_inbound: 0 } : c
        )
      );
    } catch {
      setMessages([]);
    } finally {
      if (!silent) setLoadingThread(false);
    }
  }, []);

  const conversationsInFolder = useMemo(
    () => conversations.filter((c) => normalizeConvStatus(c) === convFolder),
    [conversations, convFolder]
  );

  const folderCounts = useMemo(() => {
    const n = { inbox: 0, spam: 0, blocked: 0 };
    for (const c of conversations) {
      n[normalizeConvStatus(c)]++;
    }
    return n;
  }, [conversations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversationsInFolder;
    return conversationsInFolder.filter(
      (c) =>
        c.customer_phone.includes(q) ||
        (c.lead_name || '').toLowerCase().includes(q) ||
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.profile_name || '').toLowerCase().includes(q) ||
        (c.last_body || '').toLowerCase().includes(q) ||
        (previewForConv(c) || '').toLowerCase().includes(q) ||
        (c.pipeline_label || '').toLowerCase().includes(q) ||
        (c.service_tags || '').toLowerCase().includes(q)
    );
  }, [conversationsInFolder, search]);

  const filteredEstado = useMemo(() => {
    const inboxOnly = conversations.filter((c) => normalizeConvStatus(c) === 'inbox');
    if (!estadoFilter) return inboxOnly;
    if (estadoFilter === '__empty__') {
      return inboxOnly.filter((c) => !c.pipeline_label);
    }
    return inboxOnly.filter((c) => (c.pipeline_label || '') === estadoFilter);
  }, [conversations, estadoFilter]);

  const stats = useMemo(() => {
    const unread = conversationsInFolder.reduce((a, c) => a + (c.unread_inbound || 0), 0);
    return {
      total: conversationsInFolder.length,
      unread,
      folderCounts
    };
  }, [conversationsInFolder, folderCounts]);

  useEffect(() => {
    if (!crmToken) return;
    loadConversations();
    loadDashboard();
    loadCatalogServices();
    loadHealth();
    loadBusinessSettings();
  }, [crmToken, loadBusinessSettings, loadCatalogServices, loadConversations, loadDashboard, loadHealth]);

  useEffect(() => {
    if (!crmToken) return;
    if (appView !== 'asesores' && !selected) return;
    loadAdvisors();
  }, [crmToken, appView, loadAdvisors, selected]);

  useEffect(() => {
    if (!crmToken || appView !== 'ajustes') return;
    loadBusinessSettings(true);
  }, [appView, crmToken, loadBusinessSettings]);

  useEffect(() => {
    if (!crmToken) {
      setSocketOk(false);
      return undefined;
    }
    const opts = {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { crmToken }
    };
    const s = API_BASE ? io(API_BASE, opts) : io(opts);
    const onConnect = () => {
      setSocketOk(true);
      loadConversations();
      loadDashboard(true);
    };
    const onDisconnect = () => setSocketOk(false);
    const onCrm = (payload) => {
      loadConversations();
      loadDashboard(true);
      if (
        selected &&
        (!payload?.customer_phone ||
          String(payload.customer_phone) === String(selected))
      ) {
        loadMessages(selected, { silent: true });
        loadConvServices(selected);
        loadConversationProfile(selected);
        loadFollowUps(selected);
        loadCrmEvents(selected, { silent: true });
      }
    };
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('crm:update', onCrm);
    setSocketOk(s.connected);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
      s.off('crm:update', onCrm);
      s.close();
    };
  }, [
    crmToken,
    loadConversations,
    loadConversationProfile,
    loadConvServices,
    loadCrmEvents,
    loadDashboard,
    loadFollowUps,
    loadMessages,
    selected
  ]);

  useEffect(() => {
    if (!crmToken || !selected) return;
    loadMessages(selected);
  }, [crmToken, selected, loadMessages]);

  useEffect(() => {
    if (!crmToken) return;
    loadConvServices(selected);
  }, [crmToken, selected, loadConvServices]);

  useEffect(() => {
    if (!crmToken) return;
    loadConversationProfile(selected);
    loadFollowUps(selected);
    loadCrmEvents(selected);
  }, [crmToken, selected, loadConversationProfile, loadCrmEvents, loadFollowUps]);

  useEffect(() => {
    setFollowUpDraft(createEmptyFollowUpDraft());
  }, [selected]);

  useEffect(() => {
    const visible = conversations.filter((c) => normalizeConvStatus(c) === convFolder);
    if (
      selected &&
      !visible.some((c) => String(c.customer_phone) === String(selected))
    ) {
      setSelected(null);
      setMessages([]);
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
        setMobilePanel('list');
      }
    }
  }, [convFolder, conversations, selected]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  const activeConv = useMemo(() => {
    if (!selected) return undefined;
    const found = conversations.find(
      (c) => String(c.customer_phone) === String(selected)
    );
    if (found) return found;
    return {
      customer_phone: selected,
      profile_name: null,
      lead_name: null,
      bot_paused: 0,
      conv_status: 'inbox',
      pipeline_label: null,
      unread_inbound: 0,
      last_message_at: null
    };
  }, [conversations, selected]);

  const activeDisplayName = useMemo(
    () => displayConversationName(activeConv),
    [activeConv]
  );

  const dashboardCounts = dashboard?.counts || {};

  const linkedServiceIds = useMemo(
    () => new Set(convServices.map((x) => x.service_id)),
    [convServices]
  );

  const servicesAvailableToAdd = useMemo(
    () => catalogServices.filter((s) => !linkedServiceIds.has(s.id)),
    [catalogServices, linkedServiceIds]
  );

  const servicesToAddByCategory = useMemo(() => {
    const map = new Map();
    for (const s of servicesAvailableToAdd) {
      const cat = s.category || 'Servicios';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(s);
    }
    return Array.from(map.entries());
  }, [servicesAvailableToAdd]);

  async function handleSend(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !selected || sending) return;
    setSending(true);
    try {
      await api.post('/api/messages/send', { to: selected, body: text });
      setDraft('');
      await loadMessages(selected, { silent: true });
      await loadConversations();
      await loadConversationProfile(selected);
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al enviar');
    } finally {
      setSending(false);
    }
  }

  async function handleSendFile(file) {
    if (!file || !selected || sending) return;
    setSending(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('to', selected);
      const cap = draft.trim();
      if (cap) fd.append('body', cap);
      await api.post('/api/messages/send-media', fd);
      setDraft('');
      await loadMessages(selected, { silent: true });
      await loadConversations();
      await loadConversationProfile(selected);
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al enviar archivo');
    } finally {
      setSending(false);
    }
  }

  const messagesWithTime = useMemo(
    () =>
      messages.map((m) => ({
        ...m,
        _timeLabel: formatTime(m.created_at)
      })),
    [messages]
  );

  function selectConversation(phone) {
    setAppView('inbox');
    setSelected(phone);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
      setMobilePanel('chat');
    }
  }

  function conversationBotPaused(conv) {
    return Boolean(conv && Number(conv.bot_paused) === 1);
  }

  function phoneApiPath(phone) {
    return encodeURIComponent(String(phone || '').replace(/\D/g, ''));
  }

  async function updateConvStatus(phone, status) {
    if (!phone || convActionSaving) return;
    setConvActionSaving(true);
    setError('');
    try {
      await api.post(`/api/conversations/${phoneApiPath(phone)}/conv-status`, { status });
      await loadConversations();
      await loadDashboard(true);
      if (status === 'spam') setConvFolder('spam');
      else if (status === 'blocked') setConvFolder('blocked');
      else if (status === 'inbox') setConvFolder('inbox');
    } catch (err) {
      const st = err.response?.status;
      const hint = st ? ` (HTTP ${st})` : '';
      setError(
        (err.response?.data?.error || err.message || 'No se pudo actualizar la conversación') +
          hint
      );
      loadConversations();
    } finally {
      setConvActionSaving(false);
    }
  }

  async function deleteConversation(phone) {
    if (!phone || convActionSaving) return;
    const ok = window.confirm(
      '¿Eliminar esta conversación para siempre? Se borrarán todos los mensajes y datos asociados en el CRM. Esto no borra el chat en el teléfono del cliente.'
    );
    if (!ok) return;
    setConvActionSaving(true);
    setError('');
    try {
      await api.post(`/api/conversations/${phoneApiPath(phone)}/delete`);
      if (String(selected) === String(phone)) {
        setSelected(null);
        setMessages([]);
        if (isNarrow) setMobilePanel('list');
      }
      await loadConversations();
      await loadDashboard(true);
    } catch (err) {
      const st = err.response?.status;
      const hint = st ? ` (HTTP ${st})` : '';
      setError(
        (err.response?.data?.error || err.message || 'No se pudo eliminar la conversación') +
          hint
      );
      loadConversations();
    } finally {
      setConvActionSaving(false);
    }
  }

  async function updateBotPaused(paused) {
    if (!selected || botPauseSaving) return;
    setBotPauseSaving(true);
    setError('');
    try {
      await api.post(`/api/conversations/${selected}/bot-pause`, { paused });
      setConversations((prev) =>
        prev.map((c) =>
          String(c.customer_phone) === String(selected)
            ? { ...c, bot_paused: paused ? 1 : 0 }
            : c
        )
      );
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'No se pudo actualizar el bot'
      );
      loadConversations();
    } finally {
      setBotPauseSaving(false);
    }
  }

  async function addConversationService(serviceId) {
    if (!selected || serviceSaving || !serviceId) return;
    setServiceSaving(true);
    setError('');
    try {
      await api.post(`/api/conversations/${selected}/services`, {
        service_id: serviceId
      });
      await loadConvServices(selected);
      await loadConversations();
      await loadDashboard(true);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'No se pudo añadir el servicio'
      );
    } finally {
      setServiceSaving(false);
    }
  }

  async function removeConversationService(serviceId) {
    if (!selected || serviceSaving) return;
    setServiceSaving(true);
    setError('');
    try {
      await api.delete(`/api/conversations/${selected}/services/${serviceId}`);
      await loadConvServices(selected);
      await loadConversations();
      await loadDashboard(true);
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'No se pudo quitar el servicio'
      );
    } finally {
      setServiceSaving(false);
    }
  }

  async function updatePipelineLabel(phone, label) {
    setLabelSaving(phone);
    setError('');
    try {
      const { data } = await api.post(`/api/conversations/${phone}/label`, { label });
      setConversations((prev) =>
        prev.map((c) =>
          String(c.customer_phone) === String(phone)
            ? {
                ...c,
                pipeline_label: label,
                ...(data?.bot_paused === 1 ? { bot_paused: 1 } : {})
              }
            : c
        )
      );
      if (String(selected) === String(phone)) {
        await loadConversationProfile(phone);
        await loadFollowUps(phone);
      }
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo guardar la etiqueta');
      loadConversations();
    } finally {
      setLabelSaving(null);
    }
  }

  function updateProfileField(key, value) {
    setConversationProfile((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveConversationProfile() {
    if (!selected || !conversationProfile || profileSaving) return;
    setProfileSaving(true);
    setError('');
    try {
      const payload = {
        lead_name: conversationProfile.lead_name || '',
        company_name: conversationProfile.company_name || '',
        lead_source: conversationProfile.lead_source || '',
        city: conversationProfile.city || '',
        priority: conversationProfile.priority || 'normal',
        budget_label: conversationProfile.budget_label || '',
        budget_value:
          conversationProfile.budget_value === '' || conversationProfile.budget_value == null
            ? null
            : Number(conversationProfile.budget_value),
        internal_notes: conversationProfile.internal_notes || '',
        lost_reason: conversationProfile.lost_reason || ''
      };
      const { data } = await api.patch(`/api/conversations/${selected}/profile`, payload);
      setConversationProfile(data);
      await loadConversations();
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo guardar la ficha comercial');
    } finally {
      setProfileSaving(false);
    }
  }

  async function refreshConversationSummary() {
    if (!selected || summaryRefreshing) return;
    setSummaryRefreshing(true);
    setError('');
    try {
      const { data } = await api.post(`/api/conversations/${selected}/ai-summary`);
      setConversationProfile((prev) =>
        prev
          ? {
              ...prev,
              last_summary: data.summary || '',
              last_summary_updated_at: new Date().toISOString()
            }
          : prev
      );
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo generar el resumen IA');
    } finally {
      setSummaryRefreshing(false);
    }
  }

  function updateFollowUpDraftField(key, value) {
    setFollowUpDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function createFollowUp() {
    if (!selected || followUpSaving) return;
    if (!followUpDraft.title.trim() || !followUpDraft.due_at) {
      setError('Completa el título y la fecha del seguimiento.');
      return;
    }
    setFollowUpSaving(true);
    setError('');
    try {
      await api.post(`/api/conversations/${selected}/followups`, {
        title: followUpDraft.title,
        description: followUpDraft.description,
        due_at: new Date(followUpDraft.due_at).toISOString(),
        kind: followUpDraft.kind,
        assigned_advisor_id: followUpDraft.assigned_advisor_id || null
      });
      setFollowUpDraft(createEmptyFollowUpDraft());
      await loadFollowUps(selected);
      await loadConversationProfile(selected);
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo crear el seguimiento');
    } finally {
      setFollowUpSaving(false);
    }
  }

  async function updateFollowUp(followUpId, payload) {
    if (!selected || followUpSaving) return;
    setFollowUpSaving(true);
    setError('');
    try {
      await api.patch(`/api/followups/${followUpId}`, payload);
      await loadFollowUps(selected);
      await loadConversationProfile(selected);
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo actualizar el seguimiento');
    } finally {
      setFollowUpSaving(false);
    }
  }

  async function deleteFollowUp(followUpId) {
    if (!selected || followUpSaving) return;
    setFollowUpSaving(true);
    setError('');
    try {
      await api.delete(`/api/followups/${followUpId}`);
      await loadFollowUps(selected);
      await loadConversationProfile(selected);
      await loadDashboard(true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo eliminar el seguimiento');
    } finally {
      setFollowUpSaving(false);
    }
  }

  function updateBusinessSettingsField(key, value) {
    setBusinessSettingsDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveBusinessSettings() {
    if (businessSettingsSaving) return;
    setBusinessSettingsSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/api/business-settings', businessSettingsDraft);
      if (data?.next_token) {
        sessionStorage.setItem(CRM_TOKEN_KEY, data.next_token);
        setCrmToken(data.next_token);
      }
      setBusinessSettings(data);
      setBusinessSettingsDraft(createBusinessSettingsDraft(data));
      await loadHealth();
    } catch (err) {
      setError(
        err.response?.data?.error || err.message || 'No se pudieron guardar los ajustes del negocio.'
      );
    } finally {
      setBusinessSettingsSaving(false);
    }
  }

  const hideSidebarMobile =
    (isNarrow && appView === 'inbox' && selected && mobilePanel === 'chat') ||
    (isNarrow && appView === 'dashboard') ||
    (isNarrow && appView === 'estado') ||
    (isNarrow && appView === 'asesores') ||
    (isNarrow && appView === 'ajustes');
  const hideMainMobile =
    isNarrow &&
    appView === 'inbox' &&
    (!selected || (selected && mobilePanel === 'list'));
  const showMainEmpty = !isNarrow && !selected && appView === 'inbox';
  const showThread = Boolean(
    appView === 'inbox' && selected && (!isNarrow || mobilePanel === 'chat')
  );
  const showDashboard = appView === 'dashboard';
  const showEstado = appView === 'estado';
  const showAsesores = appView === 'asesores';
  const showAjustes = appView === 'ajustes';

  function openAdvisorCreate() {
    setAdvisorEditor({
      mode: 'create',
      full_name: '',
      phone: '',
      email: '',
      notes: '',
      is_active: true,
      sort_order: 0,
      portal_password: '',
      clear_portal_password: false
    });
  }

  function openAdvisorEdit(row) {
    setAdvisorEditor({
      mode: 'edit',
      id: row.id,
      full_name: row.full_name || '',
      phone: row.phone || '',
      email: row.email || '',
      notes: row.notes || '',
      is_active: Number(row.is_active) === 1,
      sort_order: Number(row.sort_order) || 0,
      portal_password: '',
      clear_portal_password: false
    });
  }

  function setAdvisorEditorField(key, value) {
    setAdvisorEditor((prev) => (prev ? { ...prev, [key]: value } : null));
  }

  async function saveAdvisorEditor() {
    if (!advisorEditor) return;
    const e = advisorEditor;
    setAdvisorSaving(true);
    setError('');
    try {
      if (e.mode === 'create') {
        const body = {
          full_name: e.full_name,
          phone: e.phone || undefined,
          email: e.email || undefined,
          notes: e.notes || undefined,
          is_active: e.is_active,
          sort_order: Number(e.sort_order) || 0
        };
        if (e.portal_password && String(e.portal_password).length > 0) {
          body.password = e.portal_password;
        }
        await api.post('/api/advisors', body);
      } else {
        const body = {
          full_name: e.full_name,
          phone: e.phone,
          email: e.email,
          notes: e.notes,
          is_active: e.is_active,
          sort_order: Number(e.sort_order) || 0
        };
        if (e.clear_portal_password) {
          body.password = '';
        } else if (e.portal_password && String(e.portal_password).length > 0) {
          body.password = e.portal_password;
        }
        await api.patch(`/api/advisors/${e.id}`, body);
      }
      setAdvisorEditor(null);
      await loadAdvisors();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo guardar');
    } finally {
      setAdvisorSaving(false);
    }
  }

  async function deleteAdvisorById(id) {
    if (!window.confirm('¿Eliminar este asesor? Esta acción no se puede deshacer.')) return;
    setAdvisorDeletingId(id);
    setError('');
    try {
      await api.delete(`/api/advisors/${id}`);
      await loadAdvisors();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'No se pudo eliminar');
    } finally {
      setAdvisorDeletingId(null);
    }
  }

  const businessName =
    businessSettings?.settings?.business_name || health?.business_name || 'Bruja TecnoXpert';
  const businessTagline =
    businessSettings?.settings?.business_tagline || health?.business_tagline || 'WhatsApp Business';
  const businessRuntime = businessSettings?.runtime || {};

  if (!crmToken) {
    return <CrmLoginScreen onSuccess={setCrmToken} />;
  }

  return (
    <div className="crm-shell">
      {error && (
        <div className="crm-banner crm-shell__banner">
          {error}
          <button type="button" onClick={() => setError('')} aria-label="Cerrar">
            ×
          </button>
        </div>
      )}
      <nav className="crm-mobileNav" aria-label="Navegacion principal movil">
        <button type="button" className={`crm-mobileNav__btn${appView === 'dashboard' ? ' crm-mobileNav__btn--active' : ''}`} onClick={() => { setAppView('dashboard'); setMobilePanel('list'); }}>
          <LayoutDashboard size={18} strokeWidth={2.1} aria-hidden />
          <span>Inicio</span>
        </button>
        <button type="button" className={`crm-mobileNav__btn${appView === 'inbox' ? ' crm-mobileNav__btn--active' : ''}`} onClick={() => { setAppView('inbox'); setMobilePanel('list'); }}>
          <MessageSquare size={18} strokeWidth={2.1} aria-hidden />
          <span>Chats</span>
        </button>
        <button type="button" className={`crm-mobileNav__btn${appView === 'estado' ? ' crm-mobileNav__btn--active' : ''}`} onClick={() => { setAppView('estado'); setMobilePanel('list'); }}>
          <Tags size={18} strokeWidth={2.1} aria-hidden />
          <span>Pipeline</span>
        </button>
        <button type="button" className={`crm-mobileNav__btn${appView === 'asesores' ? ' crm-mobileNav__btn--active' : ''}`} onClick={() => { setAppView('asesores'); setMobilePanel('list'); }}>
          <Users size={18} strokeWidth={2.1} aria-hidden />
          <span>Equipo</span>
        </button>
        <button type="button" className={`crm-mobileNav__btn${appView === 'ajustes' ? ' crm-mobileNav__btn--active' : ''}`} onClick={() => { setAppView('ajustes'); setMobilePanel('list'); }}>
          <Building2 size={18} strokeWidth={2.1} aria-hidden />
          <span>Ajustes</span>
        </button>
      </nav>
      <div className="crm-shell__row">
      <aside
        className={`crm-sidebar${hideSidebarMobile ? ' crm-sidebar--mobileHidden' : ''}`}
        aria-hidden={hideSidebarMobile}
      >
        <div className="crm-sidebar__head">
          <div className="crm-sidebar__brand">
            <div className="crm-sidebar__logo" aria-hidden>
              <MessageSquare size={22} strokeWidth={2.2} />
            </div>
            <div className="crm-sidebar__titles">
              <h1>{businessName}</h1>
              <p>{businessTagline}</p>
            </div>
          </div>
          <nav className="crm-nav" aria-label="Vistas del CRM">
            <button
              type="button"
              className={`crm-nav__btn${appView === 'dashboard' ? ' crm-nav__btn--active' : ''}`}
              onClick={() => setAppView('dashboard')}
            >
              <LayoutDashboard size={17} strokeWidth={2.1} aria-hidden />
              Dashboard
            </button>
            <button
              type="button"
              className={`crm-nav__btn${appView === 'inbox' ? ' crm-nav__btn--active' : ''}`}
              onClick={() => setAppView('inbox')}
            >
              <MessageSquare size={17} strokeWidth={2.1} aria-hidden />
              Chats
            </button>
            <button
              type="button"
              className={`crm-nav__btn${appView === 'estado' ? ' crm-nav__btn--active' : ''}`}
              onClick={() => setAppView('estado')}
            >
              <Tags size={17} strokeWidth={2.1} aria-hidden />
              Pipeline
            </button>
            <button
              type="button"
              className={`crm-nav__btn${appView === 'asesores' ? ' crm-nav__btn--active' : ''}`}
              onClick={() => setAppView('asesores')}
            >
              <Users size={17} strokeWidth={2.1} aria-hidden />
              Asesores
            </button>
            <button
              type="button"
              className={`crm-nav__btn${appView === 'ajustes' ? ' crm-nav__btn--active' : ''}`}
              onClick={() => setAppView('ajustes')}
            >
              <Building2 size={17} strokeWidth={2.1} aria-hidden />
              Ajustes
            </button>
            <button
              type="button"
              className="crm-nav__btn crm-nav__btn--danger"
              onClick={handleCrmLogout}
            >
              <LogOut size={17} strokeWidth={2.1} aria-hidden />
              Salir
            </button>
          </nav>
        </div>

        {(appView === 'inbox' || !isNarrow) && (
          <>
            <div className="crm-folderTabs" role="tablist" aria-label="Carpetas de conversaciones">
              <button
                type="button"
                role="tab"
                aria-selected={convFolder === 'inbox'}
                className={`crm-folderTabs__btn${convFolder === 'inbox' ? ' crm-folderTabs__btn--active' : ''}`}
                onClick={() => setConvFolder('inbox')}
              >
                <Inbox size={15} strokeWidth={2.1} aria-hidden />
                Bandeja
                {folderCounts.inbox > 0 ? (
                  <span className="crm-folderTabs__count">{folderCounts.inbox}</span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={convFolder === 'spam'}
                className={`crm-folderTabs__btn${convFolder === 'spam' ? ' crm-folderTabs__btn--active' : ''}`}
                onClick={() => setConvFolder('spam')}
              >
                <Archive size={15} strokeWidth={2.1} aria-hidden />
                Spam
                {folderCounts.spam > 0 ? (
                  <span className="crm-folderTabs__count">{folderCounts.spam}</span>
                ) : null}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={convFolder === 'blocked'}
                className={`crm-folderTabs__btn${convFolder === 'blocked' ? ' crm-folderTabs__btn--active' : ''}`}
                onClick={() => setConvFolder('blocked')}
              >
                <Ban size={15} strokeWidth={2.1} aria-hidden />
                Bloqueados
                {folderCounts.blocked > 0 ? (
                  <span className="crm-folderTabs__count">{folderCounts.blocked}</span>
                ) : null}
              </button>
            </div>

            <div className="crm-sidebar__search">
              <div className="crm-sidebar__searchWrap">
                <Search size={16} />
                <input
                  type="search"
                  placeholder="Buscar por nombre, teléfono o mensaje…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </div>

            {health && (
              <div className="crm-sidebar__meta">
                <span className="crm-pill">
                  Twilio {health.twilio ? 'activo' : 'off'}
                </span>
                <span className="crm-pill crm-pill--muted">{health.from}</span>
                <span className="crm-pill crm-pill--muted" title="Tiempo real">
                  {socketOk ? (
                    <>
                      <Wifi size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> Live
                    </>
                  ) : (
                    <>
                      <WifiOff size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                      Sin socket
                    </>
                  )}
                </span>
              </div>
            )}

            <div className="crm-sidebar__list">
          {loadingList && <p className="crm-bubble__typeHint">Cargando conversaciones…</p>}
          {!loadingList &&
            filtered.map((c) => (
              <button
                key={c.customer_phone}
                type="button"
                className={`crm-conv ${
                  String(selected) === String(c.customer_phone) ? 'crm-conv--active' : ''
                }`}
                onClick={() => selectConversation(c.customer_phone)}
              >
                <div className="crm-conv__top">
                  <ContactAvatar
                    className="crm-conv__avatar"
                    phone={c.customer_phone}
                    displayName={c.profile_name}
                    apiBase={API_BASE}
                    size={40}
                  />
                  <div className="crm-conv__info">
                    <span className="crm-conv__name">
                      {displayConversationName(c)}
                    </span>
                    {c.pipeline_label ? (
                      <span className="crm-conv__label">{c.pipeline_label}</span>
                    ) : null}
                    {c.next_follow_up_at ? (
                      <span className="crm-conv__due">
                        <Clock3 size={12} strokeWidth={2} aria-hidden />
                        {formatTime(c.next_follow_up_at)}
                      </span>
                    ) : null}
                    <div className="crm-conv__preview">{previewForConv(c)}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="crm-conv__time">{formatTime(c.last_message_at)}</div>
                    {c.unread_inbound > 0 && (
                      <div style={{ marginTop: 6 }}>
                        <span className="crm-badge">{c.unread_inbound}</span>
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          {!loadingList && filtered.length === 0 && (
            <p className="crm-bubble__typeHint">No hay conversaciones que coincidan.</p>
          )}
            </div>

            <div className="crm-sidebar__foot">
              {stats.total} en esta carpeta
              {stats.unread > 0 ? ` · ${stats.unread} sin leer` : ''}
              <span className="crm-sidebar__footGlobal">
                {' '}
                · Total {conversations.length}
              </span>
            </div>
          </>
        )}
      </aside>

      <main className={`crm-main${hideMainMobile ? ' crm-main--mobileHidden' : ''}`}>
        {showMainEmpty && (
          <div className="crm-empty">
            <Sparkles size={40} color="var(--accent)" style={{ marginBottom: 16 }} />
            <h2>Bandeja unificada</h2>
            <p className="crm-bubble__typeHint">
              Selecciona un chat para ver y enviar mensajes de texto, imágenes, audios, videos y
              PDF. Los archivos entrantes llegan por WhatsApp y se muestran en la conversación.
            </p>
          </div>
        )}

        {showDashboard && (
          <div className="crm-dashboard">
            <header className="crm-estado__head">
              {isNarrow && (
                <button
                  type="button"
                  className="crm-threadHead__back"
                  onClick={() => setAppView('inbox')}
                  aria-label="Volver a chats"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              <div className="crm-estado__headText">
                <h2>Dashboard comercial</h2>
                <p>
                  Seguimiento del embudo, agenda pendiente y carga operativa del equipo en tiempo real.
                </p>
              </div>
              <div className="crm-estado__headActions">
                <button
                  type="button"
                  className="crm-threadHead__actionBtn crm-threadHead__actionBtn--danger"
                  onClick={handleCrmLogout}
                >
                  <LogOut size={15} strokeWidth={2} aria-hidden />
                  Cerrar sesión
                </button>
              </div>
            </header>

            <div className="crm-dashboard__metrics">
              <article className="crm-dashboardCard">
                <span className="crm-dashboardCard__label">Conversaciones</span>
                <strong className="crm-dashboardCard__value">{dashboardCounts.total_conversations || 0}</strong>
                <span className="crm-dashboardCard__meta">Bandeja activa: {dashboardCounts.inbox || 0}</span>
              </article>
              <article className="crm-dashboardCard">
                <span className="crm-dashboardCard__label">Negociación</span>
                <strong className="crm-dashboardCard__value">{dashboardCounts.active_negotiations || 0}</strong>
                <span className="crm-dashboardCard__meta">Clientes en cierre con asesor</span>
              </article>
              <article className="crm-dashboardCard">
                <span className="crm-dashboardCard__label">Seguimientos</span>
                <strong className="crm-dashboardCard__value">{dashboardCounts.pending_followups || 0}</strong>
                <span className="crm-dashboardCard__meta">
                  {dashboardCounts.overdue_followups || 0} vencidos · {dashboardCounts.due_today || 0} hoy
                </span>
              </article>
              <article className="crm-dashboardCard">
                <span className="crm-dashboardCard__label">Resultado</span>
                <strong className="crm-dashboardCard__value">
                  {dashboardCounts.won || 0} / {dashboardCounts.lost || 0}
                </strong>
                <span className="crm-dashboardCard__meta">Ganados / perdidos</span>
              </article>
            </div>

            {dashboardLoading ? (
              <p className="crm-bubble__typeHint">Cargando dashboard…</p>
            ) : (
              <div className="crm-dashboard__grid">
                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Target size={16} strokeWidth={2} aria-hidden /> Etapas del embudo
                      </h3>
                      <p>Distribución actual del proceso comercial.</p>
                    </div>
                  </div>
                  <div className="crm-stageList">
                    {(dashboard?.stage_counts || []).map((stage) => (
                      <div key={stage.label} className="crm-stageList__row">
                        <span>{stage.label}</span>
                        <strong>{stage.total}</strong>
                      </div>
                    ))}
                    {(dashboard?.stage_counts || []).length === 0 ? (
                      <p className="crm-bubble__typeHint">Sin datos aún.</p>
                    ) : null}
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Clock3 size={16} strokeWidth={2} aria-hidden /> Agenda inmediata
                      </h3>
                      <p>Próximos seguimientos para no dejar oportunidades frías.</p>
                    </div>
                  </div>
                  <div className="crm-taskList">
                    {(dashboard?.followups_due || []).map((followUp) => (
                      <button
                        key={followUp.id}
                        type="button"
                        className="crm-taskList__item"
                        onClick={() => selectConversation(followUp.customer_phone)}
                      >
                        <div>
                          <strong>{followUp.title}</strong>
                          <p>{followUp.display_name || formatPhone(followUp.customer_phone)}</p>
                        </div>
                        <div className="crm-taskList__meta">
                          <span className={`crm-taskPill ${followUpTone(followUp.state)}`}>
                            {followUpStateLabel(followUp.state)}
                          </span>
                          <span>{formatTime(followUp.due_at)}</span>
                        </div>
                      </button>
                    ))}
                    {(dashboard?.followups_due || []).length === 0 ? (
                      <p className="crm-bubble__typeHint">No hay seguimientos pendientes por ahora.</p>
                    ) : null}
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Users size={16} strokeWidth={2} aria-hidden /> Carga de asesores
                      </h3>
                      <p>Quién tiene negociaciones y pendientes activos.</p>
                    </div>
                  </div>
                  <div className="crm-stageList">
                    {(dashboard?.advisor_load || []).map((advisor) => (
                      <div key={advisor.id} className="crm-stageList__row crm-stageList__row--stack">
                        <div>
                          <strong>{advisor.full_name}</strong>
                          <span>
                            Negociaciones: {advisor.active_negotiations} · Seguimientos: {advisor.pending_followups}
                          </span>
                        </div>
                      </div>
                    ))}
                    {(dashboard?.advisor_load || []).length === 0 ? (
                      <p className="crm-bubble__typeHint">Sin asesores activos.</p>
                    ) : null}
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <AlertTriangle size={16} strokeWidth={2} aria-hidden /> Oportunidades frías
                      </h3>
                      <p>Conversaciones activas sin movimiento reciente.</p>
                    </div>
                  </div>
                  <div className="crm-taskList">
                    {(dashboard?.stale_conversations || []).map((conv) => (
                      <button
                        key={conv.customer_phone}
                        type="button"
                        className="crm-taskList__item"
                        onClick={() => selectConversation(conv.customer_phone)}
                      >
                        <div>
                          <strong>{displayConversationName(conv)}</strong>
                          <p>{conv.pipeline_label || 'Sin etapa'}</p>
                        </div>
                        <div className="crm-taskList__meta">
                          <span>{formatTime(conv.last_message_at)}</span>
                        </div>
                      </button>
                    ))}
                    {(dashboard?.stale_conversations || []).length === 0 ? (
                      <p className="crm-bubble__typeHint">No hay conversaciones frías detectadas.</p>
                    ) : null}
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {showAjustes && (
          <div className="crm-dashboard crm-settings">
            <header className="crm-estado__head">
              {isNarrow && (
                <button
                  type="button"
                  className="crm-threadHead__back"
                  onClick={() => setAppView('inbox')}
                  aria-label="Volver a chats"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              <div className="crm-estado__headText">
                <h2>Ajustes del negocio</h2>
                <p>
                  Configura identidad del CRM, webhook, numero de WhatsApp, OpenAI y Twilio desde un
                  solo lugar.
                </p>
              </div>
              <div className="crm-estado__headActions">
                <button
                  type="button"
                  className="crm-threadHead__actionBtn"
                  onClick={() => loadBusinessSettings()}
                  disabled={businessSettingsLoading || businessSettingsSaving}
                >
                  <RefreshCw size={15} strokeWidth={2} aria-hidden />
                  Recargar
                </button>
                <button
                  type="button"
                  className="crm-threadHead__actionBtn"
                  onClick={saveBusinessSettings}
                  disabled={businessSettingsLoading || businessSettingsSaving}
                >
                  <CheckCircle2 size={15} strokeWidth={2} aria-hidden />
                  {businessSettingsSaving ? 'Guardando...' : 'Guardar ajustes'}
                </button>
              </div>
            </header>

            <div className="crm-settings__status">
              <article className="crm-dashboardCard crm-settingsCard">
                <span className="crm-dashboardCard__label">Marca</span>
                <strong className="crm-dashboardCard__value crm-settingsCard__value">{businessName}</strong>
                <span className="crm-dashboardCard__meta">{businessTagline}</span>
              </article>
              <article className="crm-dashboardCard crm-settingsCard">
                <span className="crm-dashboardCard__label">Twilio</span>
                <strong className="crm-dashboardCard__value crm-settingsCard__value">
                  {businessRuntime.twilio_ready ? 'Listo' : 'Pendiente'}
                </strong>
                <span className="crm-dashboardCard__meta">
                  {businessSettings?.settings?.twilio_whatsapp_from || 'Sin numero configurado'}
                </span>
              </article>
              <article className="crm-dashboardCard crm-settingsCard">
                <span className="crm-dashboardCard__label">OpenAI</span>
                <strong className="crm-dashboardCard__value crm-settingsCard__value">
                  {businessRuntime.openai_ready ? 'Activa' : 'Sin clave'}
                </strong>
                <span className="crm-dashboardCard__meta">
                  Bot {businessRuntime.openai_bot_ready ? 'operativo' : 'pendiente'}
                </span>
              </article>
              <article className="crm-dashboardCard crm-settingsCard">
                <span className="crm-dashboardCard__label">Autenticacion</span>
                <strong className="crm-dashboardCard__value crm-settingsCard__value">
                  {businessRuntime.crm_auth_ready ? 'CRM OK' : 'Revisar'}
                </strong>
                <span className="crm-dashboardCard__meta">
                  Asesores {businessRuntime.advisor_auth_ready ? 'OK' : 'pendiente'}
                </span>
              </article>
            </div>

            {businessSettingsLoading && !businessSettings ? (
              <p className="crm-bubble__typeHint">Cargando ajustes del negocio...</p>
            ) : (
              <div className="crm-dashboard__grid crm-settings__grid">
                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Building2 size={16} strokeWidth={2} aria-hidden /> Identidad y accesos
                      </h3>
                      <p>Nombre visible del CRM y credenciales de entrada al panel principal.</p>
                    </div>
                  </div>
                  <div className="crm-settingsForm">
                    <label className="crm-settingsField">
                      <span>Nombre del negocio / CRM</span>
                      <input
                        type="text"
                        value={businessSettingsDraft.business_name}
                        onChange={(e) => updateBusinessSettingsField('business_name', e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Subtitulo del panel</span>
                      <input
                        type="text"
                        value={businessSettingsDraft.business_tagline}
                        onChange={(e) => updateBusinessSettingsField('business_tagline', e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Usuario administrador CRM</span>
                      <input
                        type="text"
                        value={businessSettingsDraft.crm_admin_user}
                        onChange={(e) => updateBusinessSettingsField('crm_admin_user', e.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Nueva contrasena CRM</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.crm_admin_password}
                        onChange={(e) => updateBusinessSettingsField('crm_admin_password', e.target.value)}
                        placeholder={
                          businessSettings?.settings?.crm_admin_password_configured
                            ? 'Deja vacio para conservar la actual'
                            : 'Configura una contrasena'
                        }
                        autoComplete="new-password"
                      />
                    </label>
                    <p className="crm-settingsHint">
                      Las claves sensibles quedan ocultas. Si un campo secreto se deja vacio, se
                      conserva el valor actual.
                    </p>
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <MessageSquare size={16} strokeWidth={2} aria-hidden /> Twilio y webhook
                      </h3>
                      <p>Canal de WhatsApp Business, URL publica del webhook y credenciales de Twilio.</p>
                    </div>
                  </div>
                  <div className="crm-settingsForm">
                    <label className="crm-settingsField">
                      <span>Numero WhatsApp Business</span>
                      <input
                        type="text"
                        value={businessSettingsDraft.twilio_whatsapp_from}
                        onChange={(e) =>
                          updateBusinessSettingsField('twilio_whatsapp_from', e.target.value)
                        }
                        placeholder="whatsapp:+573117024021"
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Webhook publico</span>
                      <input
                        type="url"
                        value={businessSettingsDraft.public_webhook_url}
                        onChange={(e) =>
                          updateBusinessSettingsField('public_webhook_url', e.target.value)
                        }
                        placeholder="https://tu-dominio.com/webhook"
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>API publica base (opcional)</span>
                      <input
                        type="url"
                        value={businessSettingsDraft.public_api_url}
                        onChange={(e) => updateBusinessSettingsField('public_api_url', e.target.value)}
                        placeholder="https://tu-dominio.com"
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Nuevo Twilio Account SID</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.twilio_account_sid}
                        onChange={(e) =>
                          updateBusinessSettingsField('twilio_account_sid', e.target.value)
                        }
                        placeholder={
                          businessSettings?.settings?.twilio_account_sid_configured
                            ? `Actual: ${businessSettings?.settings?.twilio_account_sid_masked}`
                            : 'Pega aqui el SID'
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Nuevo Twilio Auth Token</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.twilio_auth_token}
                        onChange={(e) =>
                          updateBusinessSettingsField('twilio_auth_token', e.target.value)
                        }
                        placeholder={
                          businessSettings?.settings?.twilio_auth_token_configured
                            ? `Actual: ${businessSettings?.settings?.twilio_auth_token_masked}`
                            : 'Pega aqui el token'
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsCheck">
                      <input
                        type="checkbox"
                        checked={businessSettingsDraft.validate_twilio_signature}
                        onChange={(e) =>
                          updateBusinessSettingsField(
                            'validate_twilio_signature',
                            e.target.checked
                          )
                        }
                      />
                      <span>Validar firma de Twilio en el webhook</span>
                    </label>
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Bot size={16} strokeWidth={2} aria-hidden /> OpenAI y automatizacion
                      </h3>
                      <p>Modelo del bot, clave API y control de respuestas automaticas.</p>
                    </div>
                  </div>
                  <div className="crm-settingsForm">
                    <label className="crm-settingsField">
                      <span>Modelo OpenAI</span>
                      <input
                        type="text"
                        value={businessSettingsDraft.openai_model}
                        onChange={(e) => updateBusinessSettingsField('openai_model', e.target.value)}
                        placeholder="gpt-4o-mini"
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Nueva OpenAI API key</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.openai_api_key}
                        onChange={(e) => updateBusinessSettingsField('openai_api_key', e.target.value)}
                        placeholder={
                          businessSettings?.settings?.openai_api_key_configured
                            ? `Actual: ${businessSettings?.settings?.openai_api_key_masked}`
                            : 'sk-...'
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsCheck">
                      <input
                        type="checkbox"
                        checked={businessSettingsDraft.openai_bot_enabled}
                        onChange={(e) =>
                          updateBusinessSettingsField('openai_bot_enabled', e.target.checked)
                        }
                      />
                      <span>Habilitar respuestas automaticas del bot</span>
                    </label>
                    <div className="crm-settingsInfo">
                      <span>
                        Estado OpenAI:{' '}
                        <strong>{businessRuntime.openai_ready ? 'clave configurada' : 'sin clave'}</strong>
                      </span>
                      <span>
                        Bot IA:{' '}
                        <strong>
                          {businessRuntime.openai_bot_ready ? 'listo para responder' : 'pendiente'}
                        </strong>
                      </span>
                    </div>
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Shield size={16} strokeWidth={2} aria-hidden /> JWT y seguridad
                      </h3>
                      <p>Firmas del CRM y del portal de asesores. Si las cambias, el panel renueva el token.</p>
                    </div>
                  </div>
                  <div className="crm-settingsForm">
                    <label className="crm-settingsField">
                      <span>Nueva clave JWT del CRM</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.crm_jwt_secret}
                        onChange={(e) => updateBusinessSettingsField('crm_jwt_secret', e.target.value)}
                        placeholder={
                          businessSettings?.settings?.crm_jwt_secret_configured
                            ? `Actual: ${businessSettings?.settings?.crm_jwt_secret_masked}`
                            : 'Secreto JWT del CRM'
                        }
                        autoComplete="off"
                      />
                    </label>
                    <label className="crm-settingsField">
                      <span>Nueva clave JWT de asesores</span>
                      <input
                        type="password"
                        value={businessSettingsDraft.advisor_jwt_secret}
                        onChange={(e) =>
                          updateBusinessSettingsField('advisor_jwt_secret', e.target.value)
                        }
                        placeholder={
                          businessSettings?.settings?.advisor_jwt_secret_configured
                            ? `Actual: ${businessSettings?.settings?.advisor_jwt_secret_masked}`
                            : 'Secreto JWT de asesores'
                        }
                        autoComplete="off"
                      />
                    </label>
                    <div className="crm-settingsInfo">
                      <span>
                        CRM auth:{' '}
                        <strong>{businessRuntime.crm_auth_ready ? 'configurado' : 'pendiente'}</strong>
                      </span>
                      <span>
                        Portal asesores:{' '}
                        <strong>
                          {businessRuntime.advisor_auth_ready ? 'configurado' : 'pendiente'}
                        </strong>
                      </span>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </div>
        )}

        {showEstado && (
          <div className="crm-estado">
            <header className="crm-estado__head">
              {isNarrow && (
                <button
                  type="button"
                  className="crm-threadHead__back"
                  onClick={() => setAppView('inbox')}
                  aria-label="Volver a chats"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              <div className="crm-estado__headText">
                <h2>Estado de clientes</h2>
                <p>
                  Solo conversaciones en <strong>Bandeja</strong>. Las etiquetas se guardan al
                  instante.
                </p>
              </div>
            </header>

            <div className="crm-estado__toolbar">
              <label className="crm-estado__filter">
                <span>Filtrar por etiqueta</span>
                <select
                  value={estadoFilter}
                  onChange={(e) => setEstadoFilter(e.target.value)}
                  aria-label="Filtrar tabla por etiqueta"
                >
                  <option value="">Todas las conversaciones</option>
                  <option value="__empty__">Sin etiqueta</option>
                  {PIPELINE_STAGES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <p className="crm-estado__count">
                Mostrando {filteredEstado.length} de {conversations.length}
              </p>
            </div>

            <div className="crm-estado__tableWrap">
              <table className="crm-estado__table">
                <thead>
                  <tr>
                    <th scope="col">Contacto</th>
                    <th scope="col">Teléfono</th>
                    <th scope="col">Etiqueta / proceso</th>
                    <th scope="col">Último mensaje</th>
                    <th scope="col" className="crm-estado__thAction">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList && (
                    <tr>
                      <td colSpan={5} className="crm-estado__loading">
                        Cargando…
                      </td>
                    </tr>
                  )}
                  {!loadingList &&
                    filteredEstado.map((c) => {
                      const cur = c.pipeline_label || '';
                      const extra =
                        cur && !PIPELINE_STAGES.includes(cur) ? cur : null;
                      const selVal = extra ? `__extra__${extra}` : cur;
                      return (
                        <tr key={c.customer_phone}>
                          <td data-label="Contacto">
                            <div className="crm-estado__contactCell">
                              <ContactAvatar
                                phone={c.customer_phone}
                                displayName={c.profile_name}
                                apiBase={API_BASE}
                                size={36}
                              />
                              <span className="crm-estado__contactName">
                                {displayConversationName(c) || '—'}
                              </span>
                            </div>
                          </td>
                          <td data-label="Teléfono">{formatPhone(c.customer_phone)}</td>
                          <td data-label="Etiqueta">
                            <select
                              className="crm-estado__select"
                              value={selVal}
                              disabled={labelSaving === c.customer_phone}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v.startsWith('__extra__')) return;
                                updatePipelineLabel(
                                  c.customer_phone,
                                  v ? v : null
                                );
                              }}
                              aria-label={`Etiqueta para ${c.profile_name || c.customer_phone}`}
                            >
                              <option value="">Sin etiqueta</option>
                              {PIPELINE_STAGES.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                              {extra && (
                                <option value={`__extra__${extra}`}>{extra}</option>
                              )}
                            </select>
                          </td>
                          <td data-label="Último mensaje">
                            <span className="crm-estado__preview">
                              {previewForConv(c)}
                            </span>
                            <span className="crm-estado__time">
                              {formatTime(c.last_message_at)}
                            </span>
                          </td>
                          <td data-label="Acción" className="crm-estado__action">
                            <button
                              type="button"
                              className="crm-estado__openChat"
                              onClick={() => selectConversation(c.customer_phone)}
                            >
                              Abrir chat
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  {!loadingList && filteredEstado.length === 0 && (
                    <tr>
                      <td colSpan={5} className="crm-estado__empty">
                        No hay conversaciones con este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showAsesores && (
          <div className="crm-estado crm-asesores">
            <header className="crm-estado__head">
              {isNarrow && (
                <button
                  type="button"
                  className="crm-threadHead__back"
                  onClick={() => setAppView('inbox')}
                  aria-label="Volver a chats"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              <div className="crm-estado__headText">
                <h2>Asesores</h2>
                <p>
                  Crea y administra el equipo que atiende por WhatsApp. Los datos son internos del CRM
                  (no se envían automáticamente a los clientes). Asigná contraseña de portal para que
                  cada asesor entre con su correo o teléfono y vea únicamente los clientes que el
                  administrador le asignó.
                </p>
                <p className="crm-asesores__portalHint">
                  Portal asesores (login):{' '}
                  <a href="#/asesor" target="_blank" rel="noopener noreferrer">
                    abrir en nueva pestaña
                  </a>{' '}
                  · URL directa: <code className="crm-asesores__inlineCode">#/asesor</code>
                </p>
              </div>
            </header>

            <div className="crm-estado__toolbar">
              <div>
                <p className="crm-estado__count">
                  {advisorsLoading
                    ? 'Cargando…'
                    : `${advisors.length} asesor${advisors.length === 1 ? '' : 'es'}`}
                </p>
                {health && !health.advisor_portal ? (
                  <p className="crm-asesores__warn">
                    El portal de asesores no puede iniciar sesión hasta que configures{' '}
                    <code className="crm-asesores__inlineCode">ADVISOR_JWT_SECRET</code> en el
                    servidor y reinicies Node.
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="crm-asesores__btnPrimary"
                onClick={openAdvisorCreate}
              >
                <Plus size={17} strokeWidth={2.2} aria-hidden />
                Nuevo asesor
              </button>
            </div>

            <div className="crm-estado__tableWrap">
              <table className="crm-estado__table crm-asesores__table">
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Teléfono</th>
                    <th scope="col">Correo</th>
                    <th scope="col">Orden</th>
                    <th scope="col">Clientes</th>
                    <th scope="col">Portal</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="crm-estado__thAction">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {advisorsLoading && (
                    <tr>
                      <td colSpan={8} className="crm-estado__loading">
                        Cargando asesores…
                      </td>
                    </tr>
                  )}
                  {!advisorsLoading &&
                    advisors.map((a) => (
                      <tr key={a.id}>
                        <td data-label="Nombre">
                          <span className="crm-estado__contactName">{a.full_name}</span>
                          {a.notes ? (
                            <span className="crm-asesores__noteHint" title={a.notes}>
                              {a.notes.length > 48 ? `${a.notes.slice(0, 48)}…` : a.notes}
                            </span>
                          ) : null}
                        </td>
                        <td data-label="Teléfono">{a.phone ? formatPhone(a.phone) : '—'}</td>
                        <td data-label="Correo">{a.email || '—'}</td>
                        <td data-label="Orden">{a.sort_order}</td>
                        <td data-label="Clientes">
                          <span className="crm-asesores__clientCount">{Number(a.assigned_clients) || 0}</span>
                        </td>
                        <td data-label="Portal">
                          {Number(a.has_portal_password) === 1 ? (
                            <span className="crm-asesores__pill crm-asesores__pill--on">Sí</span>
                          ) : (
                            <span className="crm-asesores__pill crm-asesores__pill--off">No</span>
                          )}
                        </td>
                        <td data-label="Estado">
                          {Number(a.is_active) === 1 ? (
                            <span className="crm-asesores__pill crm-asesores__pill--on">Activo</span>
                          ) : (
                            <span className="crm-asesores__pill crm-asesores__pill--off">Inactivo</span>
                          )}
                        </td>
                        <td data-label="Acciones" className="crm-estado__action">
                          <div className="crm-asesores__rowActions">
                            <button
                              type="button"
                              className="crm-asesores__iconBtn"
                              onClick={() => openAdvisorEdit(a)}
                              aria-label={`Editar ${a.full_name}`}
                            >
                              <Pencil size={16} strokeWidth={2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="crm-asesores__iconBtn crm-asesores__iconBtn--danger"
                              disabled={advisorDeletingId === a.id}
                              onClick={() => deleteAdvisorById(a.id)}
                              aria-label={`Eliminar ${a.full_name}`}
                            >
                              <Trash2 size={16} strokeWidth={2} aria-hidden />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  {!advisorsLoading && advisors.length === 0 && (
                    <tr>
                      <td colSpan={8} className="crm-estado__empty">
                        No hay asesores. Pulsa «Nuevo asesor» para añadir uno.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showThread && (
          <>
            <header className="crm-threadHead crm-threadHead--wrap">
              {isNarrow && (
                <button
                  type="button"
                  className="crm-threadHead__back"
                  onClick={() => setMobilePanel('list')}
                  aria-label="Volver a conversaciones"
                >
                  <ChevronLeft size={24} strokeWidth={2.2} aria-hidden />
                </button>
              )}
              <ContactAvatar
                className="crm-threadHead__avatar"
                phone={selected}
                displayName={activeDisplayName}
                apiBase={API_BASE}
                size={52}
              />
              <div className="crm-threadHead__text">
                <h2>{activeDisplayName}</h2>
                <p>{formatPhone(selected)}</p>
                {activeConv?.assigned_advisor_name ? (
                  <p className="crm-threadHead__assign">
                    Asesor asignado: <strong>{activeConv.assigned_advisor_name}</strong>
                  </p>
                ) : null}
                <div className="crm-threadHead__botRow">
                  {health?.openai ? (
                    <button
                      type="button"
                      className={
                        conversationBotPaused(activeConv) ||
                        pipelineIsNegotiationEmbudo(activeConv?.pipeline_label)
                          ? 'crm-threadHead__botToggle crm-threadHead__botToggle--paused'
                          : 'crm-threadHead__botToggle'
                      }
                      disabled={
                        botPauseSaving ||
                        pipelineIsNegotiationEmbudo(activeConv?.pipeline_label)
                      }
                      onClick={() =>
                        updateBotPaused(!conversationBotPaused(activeConv))
                      }
                      title={
                        pipelineIsNegotiationEmbudo(activeConv?.pipeline_label)
                          ? 'En Negociación el bot no responde: atiende un asesor. Cambia el embudo para reactivar el asistente.'
                          : conversationBotPaused(activeConv)
                            ? 'Reactivar respuestas automáticas del asistente IA'
                            : 'Pausar el bot: solo atenderá un humano por este chat'
                      }
                    >
                      <Bot size={17} strokeWidth={2} aria-hidden />
                      {botPauseSaving
                        ? 'Guardando…'
                        : pipelineIsNegotiationEmbudo(activeConv?.pipeline_label)
                          ? 'Bot off (Negociación → humano)'
                          : conversationBotPaused(activeConv)
                            ? 'Bot pausado (solo humano)'
                            : 'Bot IA activo'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="crm-threadHead__botToggle crm-threadHead__botToggle--disabled"
                      disabled
                      title="Define OPENAI_API_KEY en el servidor (.env) y reinicia Node para activar el asistente."
                    >
                      <Bot size={17} strokeWidth={2} aria-hidden />
                      {health === null
                        ? 'Bot IA: comprobando servidor…'
                        : 'Bot IA no configurado (API)'}
                    </button>
                  )}
                </div>
                {activeConv?.pipeline_label ? (
                  <span
                    className="crm-threadHead__label"
                    title={
                      activeConv.negotiation_started_at
                        ? `Trazabilidad: negociación iniciada ${activeConv.negotiation_started_at}`
                        : undefined
                    }
                  >
                    {activeConv.pipeline_label}
                  </span>
                ) : null}
                {catalogServices.length > 0 ? (
                  <div className="crm-threadHead__services">
                    <span className="crm-threadHead__servicesLabel">Portafolio</span>
                    <div className="crm-threadHead__serviceChips">
                      {convServices.map((cs) => (
                        <span key={cs.service_id} className="crm-serviceChip">
                          <span className="crm-serviceChip__name">{cs.name}</span>
                          {cs.source === 'keyword' ? (
                            <span className="crm-serviceChip__src" title="Detectado por palabras en el chat">
                              auto
                            </span>
                          ) : null}
                          <button
                            type="button"
                            className="crm-serviceChip__remove"
                            disabled={serviceSaving}
                            onClick={() => removeConversationService(cs.service_id)}
                            aria-label={`Quitar ${cs.name}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    {servicesAvailableToAdd.length > 0 ? (
                      <select
                        className="crm-threadHead__serviceAdd"
                        value=""
                        disabled={serviceSaving}
                        aria-label="Añadir servicio del portafolio"
                        onChange={(e) => {
                          const v = e.target.value;
                          const el = e.target;
                          if (v) addConversationService(parseInt(v, 10));
                          el.value = '';
                        }}
                      >
                        <option value="">+ Añadir servicio…</option>
                        {servicesToAddByCategory.map(([cat, items]) => (
                          <optgroup key={cat} label={cat}>
                            {items.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {selected ? (
                <div className="crm-threadHead__actionsBar" aria-label="Gestionar conversación">
                  {normalizeConvStatus(activeConv) !== 'inbox' ? (
                    <button
                      type="button"
                      className="crm-threadHead__actionBtn"
                      disabled={convActionSaving}
                      onClick={() => updateConvStatus(selected, 'inbox')}
                    >
                      <Inbox size={15} strokeWidth={2.1} aria-hidden />
                      A bandeja
                    </button>
                  ) : null}
                  {normalizeConvStatus(activeConv) !== 'spam' ? (
                    <button
                      type="button"
                      className="crm-threadHead__actionBtn crm-threadHead__actionBtn--muted"
                      disabled={convActionSaving}
                      onClick={() => updateConvStatus(selected, 'spam')}
                    >
                      <Archive size={15} strokeWidth={2.1} aria-hidden />
                      Spam
                    </button>
                  ) : null}
                  {normalizeConvStatus(activeConv) !== 'blocked' ? (
                    <button
                      type="button"
                      className="crm-threadHead__actionBtn crm-threadHead__actionBtn--warn"
                      disabled={convActionSaving}
                      onClick={() => updateConvStatus(selected, 'blocked')}
                    >
                      <Ban size={15} strokeWidth={2.1} aria-hidden />
                      Bloquear
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="crm-threadHead__actionBtn crm-threadHead__actionBtn--delete"
                    disabled={convActionSaving}
                    onClick={() => deleteConversation(selected)}
                  >
                    <Trash2 size={15} strokeWidth={2.1} aria-hidden />
                    Eliminar
                  </button>
                </div>
              ) : null}
            </header>

            <div className="crm-threadWorkspace">
              <div className="crm-threadMain">
                <div className="crm-threadBody">
                  {loadingThread && (
                    <p className="crm-bubble__typeHint">Cargando mensajes…</p>
                  )}
                  {!loadingThread &&
                    messagesWithTime.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        apiBase={API_BASE}
                        onOpenImage={(src) => setLightbox(src)}
                      />
                    ))}
                </div>

                <p className="crm-composer__hint">
                  Texto (Enter envía; Mayús+Enter nueva línea). Adjuntos: imagen, audio, video o PDF
                  (máx. 16 MB). Opcional: escribe un pie de foto antes de adjuntar.
                </p>
                {health?.openai && activeConv && health?.openai_bot ? (
                  normalizeConvStatus(activeConv) !== 'inbox' ? (
                    <p className="crm-composer__botHint crm-composer__botHint--muted">
                      Spam o bloqueado: el asistente IA no responde automáticamente en este chat.
                    </p>
                  ) : conversationBotPaused(activeConv) ? (
                    <p className="crm-composer__botHint crm-composer__botHint--muted">
                      Bot pausado en este chat: el cliente no recibe respuestas automáticas del IA.
                    </p>
                  ) : (
                    <p className="crm-composer__botHint">
                      Automático: cuando el cliente escribe por WhatsApp (texto), el servidor puede
                      responder con el asistente IA sobre servicios Bruja TecnoXpert, si Twilio y la API están
                      activos.
                    </p>
                  )
                ) : null}
                <form className="crm-composer" onSubmit={handleSend}>
                  <div className="crm-composer__tools" aria-label="Adjuntar archivo">
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
                      accept="audio/*"
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
                      className="crm-composer__toolBtn"
                      disabled={sending}
                      title="Enviar imagen"
                      onClick={() => fileImageRef.current?.click()}
                    >
                      <ImageIcon size={20} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="crm-composer__toolBtn"
                      disabled={sending}
                      title="Enviar audio"
                      onClick={() => fileAudioRef.current?.click()}
                    >
                      <Mic size={20} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="crm-composer__toolBtn"
                      disabled={sending}
                      title="Enviar video"
                      onClick={() => fileVideoRef.current?.click()}
                    >
                      <Video size={20} strokeWidth={2} aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="crm-composer__toolBtn"
                      disabled={sending}
                      title="Enviar PDF"
                      onClick={() => fileDocRef.current?.click()}
                    >
                      PDF
                    </button>
                  </div>
                  <textarea
                    rows={2}
                    placeholder="Escribe un mensaje…"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e);
                      }
                    }}
                  />
                  <button type="submit" disabled={sending || !draft.trim()}>
                    {sending ? 'Enviando…' : 'Enviar'}
                  </button>
                </form>
              </div>

              <aside className="crm-threadAside">
                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Target size={16} strokeWidth={2} aria-hidden /> Proceso comercial
                      </h3>
                      <p>Ficha del lead, prioridad y etapa actual.</p>
                    </div>
                  </div>
                  <div className="crm-profileGrid">
                    <label className="crm-profileField">
                      <span>Nombre comercial</span>
                      <input
                        value={conversationProfile?.lead_name || ''}
                        onChange={(e) => updateProfileField('lead_name', e.target.value)}
                        placeholder="Nombre del cliente"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Empresa</span>
                      <input
                        value={conversationProfile?.company_name || ''}
                        onChange={(e) => updateProfileField('company_name', e.target.value)}
                        placeholder="Empresa o negocio"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Origen del lead</span>
                      <input
                        value={conversationProfile?.lead_source || ''}
                        onChange={(e) => updateProfileField('lead_source', e.target.value)}
                        placeholder="WhatsApp, referido, web…"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Ciudad</span>
                      <input
                        value={conversationProfile?.city || ''}
                        onChange={(e) => updateProfileField('city', e.target.value)}
                        placeholder="Ciudad del cliente"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Presupuesto</span>
                      <input
                        value={conversationProfile?.budget_label || ''}
                        onChange={(e) => updateProfileField('budget_label', e.target.value)}
                        placeholder="Ej. 2 a 3 millones"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Monto estimado (COP)</span>
                      <input
                        type="number"
                        min="0"
                        value={conversationProfile?.budget_value ?? ''}
                        onChange={(e) => updateProfileField('budget_value', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="crm-profileField">
                      <span>Prioridad</span>
                      <select
                        value={conversationProfile?.priority || 'normal'}
                        onChange={(e) => updateProfileField('priority', e.target.value)}
                      >
                        {CRM_PRIORITIES.map((item) => (
                          <option key={item.value} value={item.value}>
                            {item.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="crm-profileField">
                      <span>Etapa</span>
                      <select
                        value={conversationProfile?.pipeline_label || activeConv?.pipeline_label || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateProfileField('pipeline_label', value);
                          updatePipelineLabel(selected, value || null);
                        }}
                        disabled={labelSaving === selected}
                      >
                        <option value="">Sin etapa</option>
                        {PIPELINE_STAGES.map((stage) => (
                          <option key={stage} value={stage}>
                            {stage}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="crm-profileField crm-profileField--full">
                    <span>Motivo de pérdida</span>
                    <input
                      value={conversationProfile?.lost_reason || ''}
                      onChange={(e) => updateProfileField('lost_reason', e.target.value)}
                      placeholder="Solo si la oportunidad se perdió"
                    />
                  </label>
                  <label className="crm-profileField crm-profileField--full">
                    <span>Notas internas</span>
                    <textarea
                      rows={4}
                      value={conversationProfile?.internal_notes || ''}
                      onChange={(e) => updateProfileField('internal_notes', e.target.value)}
                      placeholder="Contexto comercial, acuerdos, objeciones, próximos pasos…"
                    />
                  </label>
                  <div className="crm-profileMeta">
                    <span>
                      <Flag size={14} strokeWidth={2} aria-hidden /> {priorityLabel(conversationProfile?.priority)}
                    </span>
                    <span>
                      <MapPin size={14} strokeWidth={2} aria-hidden /> {conversationProfile?.city || 'Sin ciudad'}
                    </span>
                    <span>
                      <Briefcase size={14} strokeWidth={2} aria-hidden />{' '}
                      {conversationProfile?.lead_source || 'Origen no definido'}
                    </span>
                    <span>
                      <Building2 size={14} strokeWidth={2} aria-hidden />{' '}
                      {conversationProfile?.company_name || 'Sin empresa'}
                    </span>
                  </div>
                  <div className="crm-insightCard__actions">
                    <button
                      type="button"
                      className="crm-asesores__btnPrimary"
                      disabled={profileSaving}
                      onClick={saveConversationProfile}
                    >
                      {profileSaving ? 'Guardando…' : 'Guardar ficha'}
                    </button>
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <ClipboardList size={16} strokeWidth={2} aria-hidden /> Seguimientos
                      </h3>
                      <p>
                        Agenda operativa del lead. Abiertos: {conversationProfile?.open_followups || 0} ·
                        vencidos: {conversationProfile?.overdue_followups || 0}
                      </p>
                    </div>
                  </div>
                  <form
                    className="crm-followupComposer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      createFollowUp();
                    }}
                  >
                    <input
                      value={followUpDraft.title}
                      onChange={(e) => updateFollowUpDraftField('title', e.target.value)}
                      placeholder="Título del seguimiento"
                    />
                    <input
                      type="datetime-local"
                      value={followUpDraft.due_at}
                      onChange={(e) => updateFollowUpDraftField('due_at', e.target.value)}
                    />
                    <select
                      value={followUpDraft.kind}
                      onChange={(e) => updateFollowUpDraftField('kind', e.target.value)}
                    >
                      {FOLLOW_UP_KIND_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={followUpDraft.assigned_advisor_id}
                      onChange={(e) => updateFollowUpDraftField('assigned_advisor_id', e.target.value)}
                    >
                      <option value="">Sin asignar</option>
                      {advisors.map((advisor) => (
                        <option key={advisor.id} value={advisor.id}>
                          {advisor.full_name}
                        </option>
                      ))}
                    </select>
                    <textarea
                      rows={2}
                      value={followUpDraft.description}
                      onChange={(e) => updateFollowUpDraftField('description', e.target.value)}
                      placeholder="Descripción opcional"
                    />
                    <button type="submit" className="crm-asesores__btnPrimary" disabled={followUpSaving}>
                      {followUpSaving ? 'Guardando…' : 'Crear seguimiento'}
                    </button>
                  </form>
                  <div className="crm-taskList">
                    {followUpsLoading ? (
                      <p className="crm-bubble__typeHint">Cargando seguimientos…</p>
                    ) : followUps.length === 0 ? (
                      <p className="crm-bubble__typeHint">Todavía no hay seguimientos para este cliente.</p>
                    ) : (
                      followUps.map((item) => (
                        <article key={item.id} className="crm-taskList__card">
                          <div className="crm-taskList__cardHead">
                            <div>
                              <strong>{item.title}</strong>
                              <p>{followUpKindLabel(item.kind)}</p>
                            </div>
                            <span className={`crm-taskPill ${followUpTone(item.state)}`}>
                              {followUpStateLabel(item.state)}
                            </span>
                          </div>
                          {item.description ? <p className="crm-taskList__description">{item.description}</p> : null}
                          <div className="crm-taskList__metaRow">
                            <span>
                              <Clock3 size={13} strokeWidth={2} aria-hidden /> {formatTime(item.due_at)}
                            </span>
                            <span>
                              <Users size={13} strokeWidth={2} aria-hidden />{' '}
                              {item.assigned_advisor_name || 'Sin asignar'}
                            </span>
                          </div>
                          <div className="crm-taskList__actions">
                            <button
                              type="button"
                              className="crm-taskList__actionBtn"
                              disabled={followUpSaving}
                              onClick={() =>
                                updateFollowUp(item.id, {
                                  status: item.state === 'done' ? 'pending' : 'done'
                                })
                              }
                            >
                              <CheckCircle2 size={15} strokeWidth={2} aria-hidden />
                              {item.state === 'done' ? 'Reabrir' : 'Marcar hecho'}
                            </button>
                            <button
                              type="button"
                              className="crm-taskList__actionBtn crm-taskList__actionBtn--danger"
                              disabled={followUpSaving}
                              onClick={() => deleteFollowUp(item.id)}
                            >
                              <Trash2 size={15} strokeWidth={2} aria-hidden />
                              Borrar
                            </button>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Sparkles size={16} strokeWidth={2} aria-hidden /> Resumen IA
                      </h3>
                      <p>Contexto listo para que el asesor continúe la venta sin perder tiempo.</p>
                    </div>
                    <button
                      type="button"
                      className="crm-threadHead__actionBtn"
                      disabled={summaryRefreshing}
                      onClick={refreshConversationSummary}
                    >
                      <RefreshCw size={14} strokeWidth={2} aria-hidden />
                      {summaryRefreshing ? 'Generando…' : 'Actualizar'}
                    </button>
                  </div>
                  <div className="crm-summaryCard">
                    <div className="crm-summaryCard__head">
                      <h4>Resumen de handoff</h4>
                      {conversationProfile?.handoff_summary_updated_at ? (
                        <span>{formatTime(conversationProfile.handoff_summary_updated_at)}</span>
                      ) : null}
                    </div>
                    <div className="crm-summaryCard__body">
                      {summaryParagraphs(conversationProfile?.handoff_summary).length ? (
                        summaryParagraphs(conversationProfile?.handoff_summary).map((line, index) => (
                          <p key={`handoff-${index}`}>{line}</p>
                        ))
                      ) : (
                        <p className="crm-summaryCard__empty">Aún no hay resumen de handoff.</p>
                      )}
                    </div>
                  </div>
                  <div className="crm-summaryCard">
                    <div className="crm-summaryCard__head">
                      <h4>Resumen comercial</h4>
                      {conversationProfile?.last_summary_updated_at ? (
                        <span>{formatTime(conversationProfile.last_summary_updated_at)}</span>
                      ) : null}
                    </div>
                    <div className="crm-summaryCard__body">
                      {summaryParagraphs(conversationProfile?.last_summary).length ? (
                        summaryParagraphs(conversationProfile?.last_summary).map((line, index) => (
                          <p key={`summary-${index}`}>{line}</p>
                        ))
                      ) : (
                        <p className="crm-summaryCard__empty">Genera un resumen para esta conversación.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="crm-insightCard">
                  <div className="crm-insightCard__head">
                    <div>
                      <h3>
                        <Clock3 size={16} strokeWidth={2} aria-hidden /> Trazabilidad CRM
                      </h3>
                      <p>Eventos internos del proceso comercial.</p>
                    </div>
                  </div>
                  <div className="crm-timeline">
                    {crmEventsLoading ? (
                      <p className="crm-bubble__typeHint">Cargando eventos…</p>
                    ) : crmEvents.length === 0 ? (
                      <p className="crm-bubble__typeHint">Sin eventos registrados todavía.</p>
                    ) : (
                      crmEvents.slice(0, 12).map((event) => (
                        <div key={event.id} className="crm-timeline__item">
                          <div className="crm-timeline__dot" />
                          <div className="crm-timeline__content">
                            <div className="crm-timeline__head">
                              <strong>{crmEventLabel(event.event_type)}</strong>
                              <span className="crm-timeline__time">{formatTime(event.created_at)}</span>
                            </div>
                            {crmEventEntries(event.payload).length ? (
                              <div className="crm-timeline__details">
                                {crmEventEntries(event.payload).map((entry, index) => (
                                  <div key={`${event.id}-${entry.label}-${index}`} className="crm-timeline__detail">
                                    <span>{entry.label}</span>
                                    <strong>{entry.value}</strong>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="crm-timeline__empty">Sin detalles adicionales.</p>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </aside>
            </div>
          </>
        )}
      </main>
      </div>

      {advisorEditor && (
        <div
          className="crm-asesores__overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="asesor-editor-title"
          onClick={() => !advisorSaving && setAdvisorEditor(null)}
        >
          <div
            className="crm-asesores__sheet"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="crm-asesores__sheetHead">
              <h2 id="asesor-editor-title">
                {advisorEditor.mode === 'create' ? 'Nuevo asesor' : 'Editar asesor'}
              </h2>
              <button
                type="button"
                className="crm-asesores__sheetClose"
                disabled={advisorSaving}
                onClick={() => setAdvisorEditor(null)}
                aria-label="Cerrar"
              >
                ×
              </button>
            </div>
            <form
              className="crm-asesores__form"
              onSubmit={(ev) => {
                ev.preventDefault();
                saveAdvisorEditor();
              }}
            >
              <label className="crm-asesores__field">
                <span>Nombre completo *</span>
                <input
                  type="text"
                  value={advisorEditor.full_name}
                  onChange={(e) => setAdvisorEditorField('full_name', e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="name"
                />
              </label>
              <label className="crm-asesores__field">
                <span>Teléfono (solo dígitos, opcional)</span>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={advisorEditor.phone}
                  onChange={(e) =>
                    setAdvisorEditorField('phone', e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="Ej. 573001234567"
                  maxLength={16}
                />
              </label>
              <label className="crm-asesores__field">
                <span>Correo (opcional)</span>
                <input
                  type="email"
                  value={advisorEditor.email}
                  onChange={(e) => setAdvisorEditorField('email', e.target.value)}
                  maxLength={200}
                  autoComplete="email"
                />
              </label>
              <label className="crm-asesores__field">
                <span>Notas internas (opcional)</span>
                <textarea
                  rows={3}
                  value={advisorEditor.notes}
                  onChange={(e) => setAdvisorEditorField('notes', e.target.value)}
                  maxLength={2000}
                  placeholder="Horario, especialidad, etc."
                />
              </label>
              <label className="crm-asesores__field">
                <span>
                  {advisorEditor.mode === 'create'
                    ? 'Contraseña del portal (opcional, mín. 6 caracteres)'
                    : 'Nueva contraseña del portal (vacío = no cambiar)'}
                </span>
                <input
                  type="password"
                  value={advisorEditor.portal_password}
                  onChange={(e) => {
                    setAdvisorEditorField('portal_password', e.target.value);
                    if (e.target.value) setAdvisorEditorField('clear_portal_password', false);
                  }}
                  autoComplete="new-password"
                  disabled={advisorEditor.mode === 'edit' && advisorEditor.clear_portal_password}
                  placeholder={advisorEditor.mode === 'create' ? 'Solo si debe poder entrar al portal' : ''}
                />
              </label>
              {advisorEditor.mode === 'edit' ? (
                <label className="crm-asesores__check">
                  <input
                    type="checkbox"
                    checked={advisorEditor.clear_portal_password}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAdvisorEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              clear_portal_password: checked,
                              portal_password: checked ? '' : prev.portal_password
                            }
                          : null
                      );
                    }}
                  />
                  <span>Quitar acceso al portal (eliminar contraseña)</span>
                </label>
              ) : null}
              <div className="crm-asesores__fieldRow">
                <label className="crm-asesores__field crm-asesores__field--narrow">
                  <span>Orden en listas</span>
                  <input
                    type="number"
                    value={advisorEditor.sort_order}
                    onChange={(e) =>
                      setAdvisorEditorField('sort_order', Number(e.target.value) || 0)
                    }
                    step={1}
                  />
                </label>
                <label className="crm-asesores__check">
                  <input
                    type="checkbox"
                    checked={advisorEditor.is_active}
                    onChange={(e) => setAdvisorEditorField('is_active', e.target.checked)}
                  />
                  <span>Asesor activo</span>
                </label>
              </div>
              <div className="crm-asesores__formActions">
                <button
                  type="button"
                  className="crm-asesores__btnGhost"
                  disabled={advisorSaving}
                  onClick={() => setAdvisorEditor(null)}
                >
                  Cancelar
                </button>
                <button type="submit" className="crm-asesores__btnPrimary" disabled={advisorSaving}>
                  {advisorSaving ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          className="crm-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            className="crm-lightbox__close"
            onClick={() => setLightbox(null)}
            aria-label="Cerrar"
          >
            ×
          </button>
          <img src={lightbox} alt="Vista ampliada" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
