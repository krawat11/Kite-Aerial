#!/usr/bin/env node
/**
 * Runs before every `astro build`.
 *
 * reference/ holds images that are not Kite Aerial's work. They exist so the
 * layout can be viewed fully dressed during `npm run dev`. They must never
 * reach a deployed build, so this deletes the dev-served copies and the
 * reference manifest before Astro runs. The originals in reference/ are left
 * alone; they are gitignored.
 */

import { rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

await rm(path.join(ROOT, 'public/_reference'), { recursive: true, force: true });
await mkdir(path.join(ROOT, 'src/data'), { recursive: true });
await writeFile(
  path.join(ROOT, 'src/data/manifest.reference.json'),
  JSON.stringify({ generated: null, frames: [] }, null, 2) + '\n'
);

console.log('prebuild: reference imagery cleared from the build');
