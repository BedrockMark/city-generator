// The fixed regression seed set (scripts/regression_seeds.json: user-reported seeds + 1..N, append-only).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const SEEDS: string[] = JSON.parse(readFileSync(join(here, 'regression_seeds.json'), 'utf8')).seeds;
