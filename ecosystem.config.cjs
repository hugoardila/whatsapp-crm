const path = require('path');

const root = __dirname;

/**
 * API :3001 (Apache :8989) + panel estático :18088 (Apache :8988).
 */
module.exports = {
  apps: [
    {
      name: 'jabru-crm-2',
      script: path.join(root, 'server', 'app.js'),
      cwd: path.join(root, 'server'),
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
        CRM_PORT: '18088'
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s'
    }
  ]
};
