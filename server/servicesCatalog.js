'use strict';

/**
 * Portafolio TecnoXpert — semilla SQLite.
 * category: agrupa el portafolio en la API y en el prompt del bot.
 * keywords: minúsculas sin tildes para coincidencia automática.
 */
const SERVICES = [
  {
    slug: 'reparacion-computadores',
    category: 'Reparación y dispositivos',
    name: 'Reparación de Computadores',
    summary:
      'Solución de fallas de hardware y software para equipos de escritorio y portátiles con garantía y soporte técnico especializado.',
    keywords: [
      'reparacion',
      'computador',
      'computadora',
      'laptop',
      'portatil',
      'pc',
      'windows',
      'hardware',
      'software',
      'formateo',
      'virus',
      'repuesto',
      'componente',
      'ram',
      'memoria',
      'disco',
      'ssd',
      'hdd',
      'fuente',
      'tarjeta madre',
      'motherboard',
      'placa',
      'procesador',
      'gpu',
      'monitor',
      'teclado',
      'mouse',
      'encargo',
      'parte',
      'pc gamer',
      'gamer',
      'armado',
      'armar pc',
      'ensamblaje',
      'ensamblar'
    ],
    sort_order: 10
  },
  {
    slug: 'telefonia-movil',
    category: 'Reparación y dispositivos',
    name: 'Telefonía Móvil',
    summary:
      'Reparación de dispositivos móviles, cambio de pantalla, batería y configuración con piezas originales y técnicos certificados.',
    keywords: [
      'celular',
      'movil',
      'telefono',
      'iphone',
      'android',
      'pantalla',
      'bateria',
      'tablet',
      'repuesto celular',
      'encargo'
    ],
    sort_order: 20
  },
  {
    slug: 'diseno-web',
    category: 'Web, marketing y comercio digital',
    name: 'Diseño Web',
    summary:
      'Diseñamos sitios modernos y responsivos para potenciar tu presencia digital con las últimas tecnologías y tendencias.',
    keywords: [
      'diseno web',
      'pagina web',
      'sitio web',
      'web',
      'landing',
      'wordpress',
      'responsive',
      'ux',
      'ui'
    ],
    sort_order: 30
  },
  {
    slug: 'marketing-digital',
    category: 'Web, marketing y comercio digital',
    name: 'Marketing Digital',
    summary:
      'Gestión de campañas en Meta Ads, Google Ads y WhatsApp Commerce para aumentar tus ventas y llegar a más clientes potenciales.',
    keywords: [
      'marketing',
      'meta ads',
      'facebook ads',
      'google ads',
      'publicidad',
      'seo',
      'sem',
      'redes sociales',
      'campaña',
      'whatsapp commerce'
    ],
    sort_order: 40
  },
  {
    slug: 'whatsapp-commerce',
    category: 'Web, marketing y comercio digital',
    name: 'WhatsApp Commerce',
    summary:
      'Configuración y optimización de tu tienda en WhatsApp Business para vender directamente desde la plataforma más popular.',
    keywords: [
      'whatsapp business',
      'whatsapp commerce',
      'catalogo whatsapp',
      'tienda whatsapp',
      'ventas whatsapp',
      'wcommerce'
    ],
    sort_order: 50
  },
  {
    slug: 'automatizaciones-bots',
    category: 'Web, marketing y comercio digital',
    name: 'Automatizaciones y Bots',
    summary:
      'Desarrollo de bots autorespondedores y conversacionales para WhatsApp, Telegram y redes sociales que automatizan tu atención al cliente.',
    keywords: [
      'bot',
      'bots',
      'automatizacion',
      'chatbot',
      'telegram',
      'twilio',
      'flujo',
      'respuesta automatica',
      'crm'
    ],
    sort_order: 60
  },
  {
    slug: 'instalacion-cctv',
    category: 'Infraestructura, seguridad y asesoría',
    name: 'Instalación CCTV',
    summary:
      'Circuito cerrado de televisión y cableado estructurado para seguridad empresarial con sistemas de alta definición.',
    keywords: [
      'cctv',
      'camara',
      'camaras',
      'videovigilancia',
      'seguridad',
      'dvr',
      'nvr',
      'cableado estructurado'
    ],
    sort_order: 70
  },
  {
    slug: 'soporte-servidores',
    category: 'Infraestructura, seguridad y asesoría',
    name: 'Soporte a Servidores',
    summary:
      'Configuración, virtualización y mantenimiento de servidores físicos y en red con soporte 24/7 y monitoreo continuo.',
    keywords: [
      'servidor',
      'servidores',
      'vps',
      'virtualizacion',
      'vmware',
      'proxmox',
      'linux',
      'windows server',
      'backup',
      'red',
      'datacenter'
    ],
    sort_order: 80
  },
  {
    slug: 'asesoria-empresarial',
    category: 'Infraestructura, seguridad y asesoría',
    name: 'Asesoría Empresarial',
    summary:
      'Guía experta para adquirir e implementar servidores óptimos según tus necesidades con análisis de costos y beneficios.',
    keywords: [
      'asesoria',
      'consultoria',
      'empresa',
      'infraestructura',
      'costos',
      'presupuesto',
      'it empresarial'
    ],
    sort_order: 90
  }
];

module.exports = { SERVICES };
