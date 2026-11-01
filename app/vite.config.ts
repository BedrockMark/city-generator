import { defineConfig } from 'vite';
// public/assets is a directory junction to ../assets (created by setup); public/data holds generated manifests.
export default defineConfig({ server: { port: 5173 }, build: { chunkSizeWarningLimit: 4000 } });
