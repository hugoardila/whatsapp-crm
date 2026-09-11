'use strict';

/**
 * PM2 desde server/: mismo nombre y puerto que la raíz del repo (Apache :8989 → Node :3001).
 * Tras copiar app.js nuevo: pm2 restart jabru
 */
module.exports = {
  apps: [
    {
      name: 'jabru-crm-2',
      cwd: __dirname,
      script: 'app.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002
      }
    }
  ]
};
