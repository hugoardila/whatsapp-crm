# WhatsApp CRM

CRM para conversaciones de WhatsApp, asesores, clientes, asignaciones, multimedia y cotizaciones.

## Configuración

1. Copia `server/.env.example` a `server/.env`.
2. Completa las credenciales de Twilio y los secretos de sesión fuera del control de versiones.
3. Instala dependencias con `npm run setup` y genera el panel con `npm run build`.

Los chats, archivos multimedia, logs y datos de producción están excluidos.

## Organización del código

- `server/`: API Express, autenticación, Twilio, eventos, cotizaciones y persistencia.
- `web/`: panel React/Vite y portal de asesores.
- `server/.env.example`: variables necesarias para el ambiente.
- `docker-compose.yml`: servicio unificado para despliegue.

## Desarrollo

```bash
npm run setup
npm run build --prefix web
npm start
```

Configura el webhook público de Twilio, valida sus firmas y usa secretos diferentes para desarrollo y producción. Las conversaciones y multimedia deben permanecer en almacenamiento privado.
