#!/usr/bin/env node
/**
 * The orbit clip: encoded for the web, with its poster frame cut.
 *
 *   npm run video
 *
 * Drop one video into source/video/ and run it. Same idea as the photographs —
 * the folder is the instruction, nothing in the code needs editing.
 *
 * Reads .mov, .mp4, .m4v, .avi, .mkv, .webm and anything else ffmpeg can open,
 * including 4K, vertical, and clips with sound (the sound is dropped, because
 * the page does not autoplay and nobody wants a surprise).
 *
 * Writes a smaller AV1 file, an H.264 file behind it, and a poster frame. The
 * page paints from the poster and only downloads a video when somebody presses
 * play, so this never becomes the slow thing on the page.
 *
 * Needs ffmpeg. It is a separate step from `npm run build` because the clip
 * changes far less often than the pages do.
 */

import { readdir, mkdir, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'source');
const VIDEO_DIR = path.join(SRC, 'video');
const OUT = path.join(ROOT, 'public/media');

const VIDEO_EXT = /\.(mov|mp4|m4v|avi|mkv|webm|mts|m2ts|3gp)$/i;

// The player is never wider than about 1100px in the layout, so 900 lines of
// vertical resolution is already more than the screen can use. Downscaling here
// is the single biggest thing keeping the file small.
const HEIGHT = 900;

await mkdir(OUT, { recursive: true });

/* ------------------------------------------------------------ find the clip */

async function findClip() {
  // source/video/ first — that is where it is meant to go.
  for (const dir of [VIDEO_DIR, SRC]) {
    if (!existsSync(dir)) continue;
    const entries = await readdir(dir, { withFileTypes: true });
    const hits = entries
      .filter((e) => e.isFile() && VIDEO_EXT.test(e.name) && !e.name.startsWith('.'))
      .map((e) => path.join(dir, e.name))
      .sort();
    if (hits.length) return { clip: hits[0], extras: hits.slice(1), dir };
  }
  return { clip: null, extras: [], dir: null };
}

const { clip, extras } = await findClip();

if (!clip) {
  console.log(`
  No video found.

  Put one clip in source/video/ and run this again. A slow orbit of the
  building is what the case study page is built around. .mov straight off the
  drone is fine — so are .mp4, .m4v, .avi, .mkv and .webm.

  The site works without it: the case study page simply leaves the video stage
  out until a clip is there.
`);
  process.exit(0);
}

/* --------------------------------------------------------------- need ffmpeg */

try {
  await run('ffmpeg', ['-version']);
} catch {
  console.error(`
  ffmpeg is not installed, and it is what does the encoding.

    brew install ffmpeg

  (If you do not have Homebrew: https://brew.sh)

  Everything else works without it. The video stage on the case study page
  stays hidden until there is an encoded clip in public/media/.
`);
  process.exit(1);
}

/* ----------------------------------------------------------------- inspect */

const probe = JSON.parse(
  (
    await run('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,codec_name:format=duration',
      '-of', 'json',
      clip,
    ])
  ).stdout
);

const stream = probe.streams?.[0] ?? {};
const duration = Number(probe.format?.duration ?? 0);
const w = stream.width ?? 0;
const h = stream.height ?? 0;
const vertical = h > w;

console.log(`\n  ${path.relative(ROOT, clip)}`);
console.log(`  ${w}×${h} · ${duration.toFixed(1)}s · ${stream.codec_name}${vertical ? ' · vertical' : ''}\n`);
if (extras.length) {
  console.log(`  Using the first clip only. Also in that folder, ignored:`);
  for (const e of extras) console.log(`    ${path.basename(e)}`);
  console.log('');
}
if (duration && duration < 8) {
  console.log(`  Worth knowing: at ${duration.toFixed(1)}s this is shorter than a viewer takes to`);
  console.log(`  read the caption beside it. A slow orbit of 15–25s carries the page better.\n`);
}

// A poster from a quarter of the way in, so it is not the first frame of a
// take-off. Clamped so a very short clip still gets a real frame.
const posterAt = Math.max(0, Math.min(duration * 0.4, Math.max(0, duration - 0.2))).toFixed(2);

// Never enlarge: a 720p clip stays 720p rather than being blown up to 900.
const targetHeight = Math.min(HEIGHT, h || HEIGHT);
const scale = `scale=-2:${targetHeight}:flags=lanczos`;

/* ------------------------------------------------------------------ poster */

const posterRaw = path.join(OUT, '.poster-raw.png');
await run('ffmpeg', ['-v', 'error', '-y', '-ss', posterAt, '-i', clip, '-frames:v', '1', '-vf', scale, posterRaw]);

// Same grade as the stills, so the poster sits inside the set rather than
// beside it. One .linear() call — sharp keeps only the last one.
const poster = sharp(posterRaw).modulate({ saturation: 1.04 }).linear(1.03, -3).toColorspace('srgb');
// One format only: a <video poster> attribute takes a single URL, so the AVIF
// and WebP copies this used to write were never fetched by anything.
await poster.clone().jpeg({ quality: 70, mozjpeg: true }).toFile(path.join(OUT, 'orbit-poster.jpg'));
await rm(posterRaw, { force: true });

/* ----------------------------------------------- AV1 first, H.264 behind it */

const common = ['-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart'];

let av1 = true;
try {
  await run('ffmpeg', [
    '-v', 'error', '-y', '-i', clip,
    '-vf', scale,
    '-c:v', 'libsvtav1', '-crf', '50', '-preset', '6',
    ...common,
    path.join(OUT, 'orbit.av1.mp4'),
  ]);
} catch {
  // Not every ffmpeg build has an AV1 encoder. H.264 alone is fine.
  av1 = false;
  await rm(path.join(OUT, 'orbit.av1.mp4'), { force: true });
  console.log('  No AV1 encoder in this ffmpeg build — H.264 only. Larger file, works everywhere.\n');
}

await run('ffmpeg', [
  '-v', 'error', '-y', '-i', clip,
  '-vf', scale,
  '-c:v', 'libx264', '-crf', '30', '-preset', 'medium',
  '-profile:v', 'high', '-level', '4.0',
  ...common,
  path.join(OUT, 'orbit.h264.mp4'),
]);

/* ------------------------------------------------------------------ report */

const written = ['orbit-poster.jpg', 'orbit.h264.mp4'];
if (av1) written.splice(1, 0, 'orbit.av1.mp4');

for (const f of written) {
  const { size } = await stat(path.join(OUT, f));
  console.log(`  ${f.padEnd(22)} ${(size / 1024).toFixed(0)}KB`);
}
console.log(`\n  Done. Refresh the case study page.\n`);
