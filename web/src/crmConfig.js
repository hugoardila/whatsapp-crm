export const PIPELINE_STAGES = [
  'Nuevo',
  'Contactado',
  'Calificado',
  'Cotización en preparación',
  'Cotización enviada',
  'Seguimiento 24h',
  'Seguimiento 72h',
  'Negociación',
  'Pago confirmado',
  'Pedido / encargo',
  'Entregado',
  'Postventa',
  'Cerrado — ganado',
  'Cerrado — perdido'
];

export const CRM_PRIORITIES = [
  { value: 'low', label: 'Baja' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Urgente' }
];

export const FOLLOW_UP_KIND_OPTIONS = [
  { value: 'manual', label: 'Manual' },
  { value: 'quote_followup_24h', label: 'Cotización 24h' },
  { value: 'quote_followup_72h', label: 'Cotización 72h' },
  { value: 'negotiation_first_touch', label: 'Primer contacto negociación' },
  { value: 'payment_confirmation', label: 'Pago confirmado' },
  { value: 'postsale_checkin', label: 'Postventa' }
];

export function priorityLabel(value) {
  return CRM_PRIORITIES.find((item) => item.value === value)?.label || 'Normal';
}

export function followUpKindLabel(value) {
  return FOLLOW_UP_KIND_OPTIONS.find((item) => item.value === value)?.label || value || 'Manual';
}

export function followUpStateLabel(value) {
  if (value === 'overdue') return 'Vencido';
  if (value === 'done') return 'Hecho';
  if (value === 'canceled') return 'Cancelado';
  return 'Pendiente';
}
