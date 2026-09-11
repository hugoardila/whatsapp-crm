import {
  FileText,
  Image as ImageIcon,
  Mic,
  Video,
  ExternalLink
} from 'lucide-react';

function mediaSrc(apiBase, message, att, index) {
  const b = apiBase || '';
  if (att.localId) {
    return `${b}/api/outbound-media/${encodeURIComponent(att.localId)}`;
  }
  return `${b}/api/messages/${message.id}/attachment/${index}`;
}

/** Twilio a veces manda application/octet-stream; el 2.º/3.er adjunto suele venir sin MIME claro. */
function attachmentDisplayKind(att, message) {
  const ct = String(att.contentType || '').toLowerCase();
  if (ct.startsWith('image/')) return 'image';
  if (ct.startsWith('audio/')) return 'audio';
  if (ct.startsWith('video/')) return 'video';
  if (ct.startsWith('application/pdf') || ct.includes('officedocument')) return 'document';

  const mt = message.message_type || 'text';
  const vague =
    !ct ||
    ct === 'application/octet-stream' ||
    ct === 'binary/octet-stream';
  if (vague && mt === 'image') return 'image';
  if (vague && mt === 'audio') return 'audio';
  if (vague && mt === 'video') return 'video';
  return 'document';
}

export default function MessageBubble({ message, apiBase, onOpenImage }) {
  const isOut = message.direction === 'outbound';
  const atts = Array.isArray(message.attachments) ? message.attachments : [];
  const type = message.message_type || 'text';

  return (
    <div className={`crm-bubble ${isOut ? 'crm-bubble--out' : 'crm-bubble--in'}`}>
      {atts.length > 0 && (
        <div className="crm-bubble__media">
          {atts.map((att, i) => {
            const kind = attachmentDisplayKind(att, message);
            const src = mediaSrc(apiBase, message, att, i);
            if (kind === 'image') {
              return (
                <button
                  key={`${message.id}-img-${i}`}
                  type="button"
                  className="crm-bubble__imgBtn"
                  onClick={() => onOpenImage?.(src)}
                >
                  <img
                    src={src}
                    alt=""
                    className="crm-bubble__img"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      e.target.style.display = 'none';
                    }}
                  />
                </button>
              );
            }
            if (kind === 'video') {
              return (
                <video
                  key={`${message.id}-vid-${i}`}
                  className="crm-bubble__video"
                  controls
                  playsInline
                  preload="metadata"
                  src={src}
                />
              );
            }
            if (kind === 'audio') {
              return (
                <div key={`${message.id}-aud-${i}`} className="crm-bubble__audioWrap">
                  <Mic size={18} className="crm-bubble__audioIcon" aria-hidden />
                  <audio
                    className="crm-bubble__audio"
                    controls
                    playsInline
                    preload="metadata"
                    src={src}
                  />
                </div>
              );
            }
            return (
              <a
                key={`${message.id}-doc-${i}`}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="crm-bubble__doc"
              >
                <FileText size={20} />
                <span>Archivo / documento</span>
                <ExternalLink size={14} />
              </a>
            );
          })}
        </div>
      )}

      {type !== 'text' && atts.length === 0 && (
        <div className="crm-bubble__typeHint">
          {type === 'image' && <ImageIcon size={18} />}
          {type === 'audio' && <Mic size={18} />}
          {type === 'video' && <Video size={18} />}
          {type === 'document' && <FileText size={18} />}
          <span>Multimedia (sin URL guardada)</span>
        </div>
      )}

      {message.body ? <p className="crm-bubble__text">{message.body}</p> : null}

      <span className="crm-bubble__meta">
        {isOut ? 'Tú' : 'Cliente'} · {message._timeLabel}
      </span>
    </div>
  );
}
