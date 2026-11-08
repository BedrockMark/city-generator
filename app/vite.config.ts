import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Labels API for the annotation tool (src/viewer/labels.ts): reads / writes references/labels/v<version>/.
const LABEL_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../references/labels');
const safe = (s: unknown) => typeof s === 'string' && /^[\w.-]{1,80}$/.test(s);

function labelsApi(): Plugin {
  return {
    name: 'citygen-labels',
    configureServer(server) {
      server.middlewares.use('/api/labels', (req, res) => {
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method === 'GET') {
          const u = new URL(req.url ?? '', 'http://x');
          const version = u.searchParams.get('version'), seed = u.searchParams.get('seed');
          if (!safe(version) || !safe(seed)) return send(400, { error: 'bad version / seed' });
          const f = join(LABEL_ROOT, `v${version}`, `seed${seed}.json`);
          return send(200, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { version, seed, labels: [] });
        }
        if (req.method === 'POST') {
          let raw = '';
          req.on('data', (c) => { raw += c; });
          req.on('end', () => {
            try {
              const b = JSON.parse(raw);
              if (!safe(b.version) || !safe(b.seed) || !Array.isArray(b.labels)) return send(400, { error: 'bad body' });
              const dir = join(LABEL_ROOT, `v${b.version}`);
              mkdirSync(dir, { recursive: true });
              writeFileSync(join(dir, `seed${b.seed}.json`), JSON.stringify({ version: b.version, seed: b.seed, labels: b.labels }, null, 1));
              if (b.scene && safe(b.scene.name)) writeFileSync(join(dir, b.scene.name), JSON.stringify(b.scene.data));
              send(200, { ok: true, n: b.labels.length });
            } catch (e) { send(500, { error: String(e) }); }
          });
          return;
        }
        send(405, { error: 'method' });
      });
    },
  };
}

// public/assets is a directory junction to ../assets (created by setup); public/data holds generated manifests.
export default defineConfig({ server: { port: 5173 }, build: { chunkSizeWarningLimit: 4000 }, plugins: [labelsApi()] });
