#!/usr/bin/env node
/**
 * Will these photographs work on the site?
 *
 *   npm run check                          checks everything in source/
 *   npm run check ~/Desktop/new-shoot      checks a folder before you commit to it
 *   npm run check ~/Pictures/one.HEIC      checks a single file
 *
 * Reads each file exactly the way `npm run images` will, reports what it found
 * and what it would have to do to it, and writes nothing at all. Safe to point
 * at anything.
 */

import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { READABLE, VIDEO, openImage, normalise, levelScaleFor, hasHeicDecoder } from './lib/decode.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = process.argv[2];
const target = arg ? path.resolve(arg.replace(/^~(?=$|\/)/, os.homedir())) : path.join(ROOT, 'source');

if (!existsSync(target)) {
  console.error(`\n  nothing at ${target}\n`);
  process.exit(1);
}

const GOOD = '  ok  ';
const WARN = ' note ';
const BAD = ' NOPE ';

async function list(p) {
  const s = await stat(p);
  if (s.isFile()) return [p];
  const out = [];
  for (const e of await readdir(p, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(p, e.name);
    if (e.isDirectory()) out.push(...(await list(abs)));
    else out.push(abs);
  }
  return out.sort();
}

const files = await list(target);
let usable = 0;
let unusable = 0;
let notes = 0;

const rel0 = path.relative(process.cwd(), target);
console.log(`\nchecking ${rel0 && !rel0.startsWith('..') ? rel0 : target}`);
console.log(hasHeicDecoder ? '  iPhone HEIC files: supported\n' : '  iPhone HEIC files: heic-convert not installed, falling back to system tools\n');

for (const abs of files) {
  const rel = path.relative(target, abs) || path.basename(abs);
  const ext = path.extname(abs).toLowerCase();

  if (VIDEO.has(ext)) {
    console.log(`${WARN} ${rel}`);
    console.log(`       a video — put one in source/video/ and run \`npm run video\``);
    notes++;
    continue;
  }

  if (!READABLE.has(ext)) {
    if (/\.(txt|md|json)$/i.test(ext) || rel === '.DS_Store') continue;
    console.log(`${BAD} ${rel}`);
    console.log(`       ${ext || 'no extension'} is not an image format the site can read.`);
    console.log(`       Readable: ${[...READABLE].join(' ')}`);
    unusable++;
    continue;
  }

  const { img, via, notes: why, tmp } = await openImage(abs);
  if (!img) {
    console.log(`${BAD} ${rel}`);
    for (const n of why) console.log(`       ${n}`);
    console.log(`       Open it in Preview and export a JPEG, or find the original.`);
    unusable++;
    continue;
  }

  const meta = await img.metadata();
  const swapped = (meta.orientation ?? 1) >= 5;
  const hasRotationTag = (meta.orientation ?? 1) !== 1;
  const w = swapped ? meta.height : meta.width;
  const h = swapped ? meta.width : meta.height;
  const longEdge = Math.max(w, h);

  const { did } = normalise(img, meta);
  const scale = await levelScaleFor(img, meta);
  if (scale !== 1) did.push(`${meta.depth} levels rescaled`);
  if (via && via !== 'sharp') did.push(`decoded with ${via}`);

  const shape = w === h ? 'square' : w > h ? 'landscape' : 'portrait';
  const ratio = (Math.max(w, h) / Math.min(w, h)).toFixed(2);

  const soft = longEdge < 1200;
  const tiny = longEdge < 400;
  const mark = tiny ? BAD : soft ? WARN : GOOD;

  console.log(`${mark} ${rel}`);
  console.log(
    `       ${meta.format} · ${w}×${h} · ${shape} ${ratio}:1 · ` +
      (longEdge >= 4000 ? 'big enough for anything' : longEdge >= 2000 ? 'good size' : longEdge >= 1200 ? 'usable' : 'small')
  );
  if (did.length) console.log(`       will be: ${did.join(', ')}`);
  if (hasRotationTag) {
    console.log(`       carries an EXIF rotation tag. If it comes out sideways, the tag is wrong —`);
    console.log(`       add "ignoreExifOrientation": true for it in crops.json.`);
  }
  if (tiny) {
    console.log(`       under 400px on the long edge — too small to fill a slot. Find the original.`);
    unusable++;
  } else if (soft) {
    console.log(`       under 1200px — it will be used, but may look soft in a large slot.`);
    notes++;
    usable++;
  } else {
    usable++;
  }

  if (tmp) await import('node:fs/promises').then((fs) => fs.rm(tmp, { force: true }));
}

console.log(`\n  ${usable} usable, ${unusable} not usable, ${notes} worth a look\n`);
if (usable && target !== path.join(ROOT, 'source')) {
  console.log(`  To use them: copy the good ones into a folder under source/ and run \`npm run images\`.`);
  console.log(`  source/hero/  source/portfolio/  source/case-study/  source/comparison/ground/  source/comparison/aerial/\n`);
}
process.exit(unusable ? 1 : 0);
