'use strict';

/**
 * Desactiva el middleware hostCheck de Vite (dev + preview).
 * Tras npm install Vite vuelve a bloquear Host con muchos vhost/proxy aunque
 * allowedHosts: true falle por merges/versiones; este parche lo evita.
 */

const fs = require('fs');
const path = require('path');

const chunksDir = path.join(__dirname, '..', 'node_modules', 'vite', 'dist', 'node', 'chunks');
const marker = '/*jabru-skip-host-check*/';

if (!fs.existsSync(chunksDir)) {
  console.warn('[patch-vite] Sin node_modules/vite, se omite.');
  process.exit(0);
}

const files = fs.readdirSync(chunksDir).filter((f) => f.startsWith('dep-') && f.endsWith('.js'));
if (!files.length) {
  console.warn('[patch-vite] No hay chunks dep-*.js en Vite.');
  process.exit(0);
}

const already = files.some((f) =>
  fs.readFileSync(path.join(chunksDir, f), 'utf8').includes(marker)
);
if (already) {
  console.log('[patch-vite] Host check ya estaba desactivado.');
  process.exit(0);
}

let patchedFiles = 0;
for (const f of files) {
  const p = path.join(chunksDir, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(marker)) continue;

  const a =
    'if (allowedHosts !== true && !serverConfig.https) {\n    middlewares.use(hostCheckMiddleware(config, false));\n  }';
  const b =
    'if (allowedHosts !== true && !config.preview.https) {\n    app.use(hostCheckMiddleware(config, true));\n  }';

  let changed = false;
  if (s.includes(a)) {
    s = s.replace(
      a,
      `if (false) ${marker} {\n    middlewares.use(hostCheckMiddleware(config, false));\n  }`
    );
    changed = true;
  }
  if (s.includes(b)) {
    s = s.replace(
      b,
      `if (false) ${marker} {\n    app.use(hostCheckMiddleware(config, true));\n  }`
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(p, s);
    patchedFiles++;
  }
}

if (patchedFiles) {
  console.log('[patch-vite] Host check de Vite desactivado (dev + preview).');
} else {
  console.warn(
    '[patch-vite] No se encontraron bloques esperados; quizá otra versión de Vite.'
  );
}
