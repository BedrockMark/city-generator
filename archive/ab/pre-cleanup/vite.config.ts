import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// Choices API for the A/B mode (src/viewer/ab.ts, spec 3.4): POST { version, seed, file?, data } writes
// references/choices/v<version>/seed<seed>_<YYYYMMDD-HHMMSS>.json (file = another name, still safe()); GET returns
// { changes: [{ label, ctx, a, b, answer, created }] } of every version, for the question scoring.
// (any seed string is accepted: characters outside [\w.-] become '_' in the FILE NAME only, data.seed keeps the raw seed)
const CHOICE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../references/choices');
const fileSeed = (s: string) => s.replace(/[^\w.-]/g, '_').slice(0, 60);
const stamp = (d = new Date()) => { const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };

function choicesApi(): Plugin {
  return {
    name: 'citygen-choices',
    configureServer(server) {
      server.middlewares.use('/api/choices', (req, res) => {
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method === 'GET') {
          const changes: unknown[] = [];
          if (existsSync(CHOICE_ROOT)) for (const v of readdirSync(CHOICE_ROOT)) {
            const dir = join(CHOICE_ROOT, v);
            if (!v.startsWith('v') || !statSync(dir).isDirectory()) continue;
            for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
              try {
                const d = JSON.parse(readFileSync(join(dir, f), 'utf8'));
                for (const c of d.changes ?? []) if (c.answer) changes.push({ label: c.label, ctx: c.ctx, a: c.a, b: c.b, answer: c.answer, created: d.created });
              } catch { /* a broken file is skipped */ }
            }
          }
          return send(200, { changes });
        }
        if (req.method === 'POST') {
          let raw = '';
          req.on('data', (c) => { raw += c; });
          req.on('end', () => {
            try {
              const b = JSON.parse(raw);
              if (!safe(b.version) || typeof b.seed !== 'string' || !b.seed || !b.data || !Array.isArray(b.data.changes)) return send(400, { error: 'bad body' });
              const file0 = b.file ?? `seed${fileSeed(b.seed)}_${stamp()}.json`;
              if (!safe(file0) || !file0.endsWith('.json')) return send(400, { error: 'bad file name' });
              const dir = join(CHOICE_ROOT, `v${b.version}`);
              mkdirSync(dir, { recursive: true });
              // never overwrite: two saves in the same second get _2, _3, ...
              let file = file0;
              for (let j = 2; ; j++) {
                try { writeFileSync(join(dir, file), JSON.stringify(b.data, null, 1), { flag: 'wx' }); break; }
                catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || j > 99) throw e; file = file0.replace(/\.json$/, `_${j}.json`); }
              }
              send(200, { ok: true, file: `v${b.version}/${file}`, n: b.data.changes.length });
            } catch (e) { send(500, { error: String(e) }); }
          });
          return;
        }
        send(405, { error: 'method' });
      });
    },
  };
}

// Holdout API (viewer key K, spec 5.2): POST { version, name, scene } writes references/holdout/<name> (name = v<version>_<stem>.json);
// GET ?name= says whether it exists (the viewer confirms before overwriting).
const HOLDOUT_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../references/holdout');

function holdoutApi(): Plugin {
  return {
    name: 'citygen-holdout',
    configureServer(server) {
      server.middlewares.use('/api/holdout', (req, res) => {
        const send = (code: number, body: unknown) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method === 'GET') {
          const name = new URL(req.url ?? '', 'http://x').searchParams.get('name');
          if (!safe(name) || !name.endsWith('.json')) return send(400, { error: 'bad name' });
          return send(200, { exists: existsSync(join(HOLDOUT_ROOT, name)) });
        }
        if (req.method === 'POST') {
          let raw = '';
          req.on('data', (c) => { raw += c; });
          req.on('end', () => {
            try {
              const b = JSON.parse(raw);
              if (!safe(b.version) || !safe(b.name) || !b.name.endsWith('.json') || !b.scene || !Array.isArray(b.scene.objects)) return send(400, { error: 'bad body' });
              mkdirSync(HOLDOUT_ROOT, { recursive: true });
              writeFileSync(join(HOLDOUT_ROOT, b.name), JSON.stringify(b.scene));
              send(200, { ok: true, file: b.name });
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
export default defineConfig({ server: { port: 5173 }, build: { chunkSizeWarningLimit: 4000 }, plugins: [labelsApi(), choicesApi(), holdoutApi()] });
