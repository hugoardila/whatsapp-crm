import { useEffect, useState } from 'react';

function initialsFrom(name, phone) {
  const s = String(name || phone || '?').trim();
  if (!s) return '?';
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export default function ContactAvatar({
  phone,
  displayName,
  apiBase,
  size = 40,
  className = ''
}) {
  const [broken, setBroken] = useState(false);
  const label = initialsFrom(displayName, phone);
  const src =
    phone && !broken
      ? `${apiBase || ''}/api/conversations/${encodeURIComponent(phone)}/avatar`
      : '';

  useEffect(() => {
    setBroken(false);
  }, [phone]);

  const style = {
    width: size,
    height: size,
    fontSize: Math.max(0.65 * size, 11)
  };

  return (
    <div
      className={`crm-avatar ${className}`.trim()}
      style={style}
      aria-hidden={src && !broken ? true : undefined}
    >
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="crm-avatar__initials">{label}</span>
      )}
    </div>
  );
}
