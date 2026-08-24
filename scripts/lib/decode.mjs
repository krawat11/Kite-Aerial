/**
 * Opening an image file, whatever it happens to be.
 *
 * Shared by `npm run images` and `npm run check`, so what the check reports is
 * exactly what the ingest will do.
 *
 * The awkward case is HEIC from an iPhone: sharp can usually read the container
 * but not the HEVC image inside it, because the codec is patent-encumbered and
 * the prebuilt binaries leave it out. A pure-JS decoder handles it with no
 * system dependencies. If that is missing too, whatever converter the machine
 * happens to have is tried in turn — `sips` is built into macOS and is the one
 * that almost always works.
 */

import { readFile, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';

const exec = promisify(execFile);

export const READABLE = new Set([
  '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.webp', '.avif',
  '.tif', '.tiff', '.gif', '.bmp', '.heic', '.heif', '.hif', '.dng',
]);

/** Formats sharp usually cannot finish decoding on its own. */
export const NEEDS_FALLBACK = new Set(['.heic', '.heif', '.hif', '.dng']);

export const VIDEO = new Set(['.mov', '.mp4', '.m4v', '.avi', '.mkv', '.webm']);

export const SHARP_OPTS = {
  failOn: 'none',
  limitInputPixels: 1_000_000_000, // a 100MP panorama is fine
  unlimited: true,
  animated: false, // first frame of a GIF, not the whole animation
};

const CONVERTERS = [
  { cmd: 'sips', args: (i, o) => ['-s', 'format', 'png', i, '--out', o], out: '.png' },
  { cmd: 'heif-convert', args: (i, o) => [i, o], out: '.jpg' },
  { cmd: 'magick', args: (i, o) => [i, o], out: '.png' },
  { cmd: 'convert', args: (i, o) => [i, o], out: '.png' },
  { cmd: 'ffmpeg', args: (i, o) => ['-v', 'error', '-y', '-i', i, '-frames:v', '1', o], out: '.png' },
];

let heicConvert = null;
try {
  heicConvert = (await import('heic-convert')).default;
} catch {
  /* optional */
}

export const hasHeicDecoder = Boolean(heicConvert);

const safeName = (p) => path.basename(p).replace(/[^a-zA-Z0-9.]/g, '-').slice(0, 40);

/**
 * @returns {{ img: import('sharp').Sharp|null, via: string|null, notes: string[], tmp?: string }}
 */
export async function openImage(abs) {
  const ext = path.extname(abs).toLowerCase();
  const notes = [];

  // 1. sharp alone, unless the format is one it usually can't finish.
  if (!NEEDS_FALLBACK.has(ext)) {
    try {
      const img = sharp(abs, SHARP_OPTS);
      await img.stats(); // forces a real decode, not just a header read
      return { img, via: 'sharp', notes };
    } catch (e) {
      notes.push(`sharp could not decode it directly (${e.message.split('\n')[0]})`);
    }
  }

  // 2. pure-JS HEIC/HEIF decoder. No system dependencies.
  if (heicConvert && (NEEDS_FALLBACK.has(ext) || ext === '.avif')) {
    try {
      const jpeg = await heicConvert({ buffer: await readFile(abs), format: 'JPEG', quality: 0.94 });
      return { img: sharp(Buffer.from(jpeg), SHARP_OPTS), via: 'heic-convert', notes };
    } catch (e) {
      notes.push(`heic-convert failed (${e.message.split('\n')[0]})`);
    }
  }

  // 3. sharp anyway — some builds of libvips do carry an HEVC decoder.
  try {
    const img = sharp(abs, SHARP_OPTS);
    await img.stats();
    return { img, via: 'sharp', notes };
  } catch (e) {
    notes.push(`sharp fallback failed (${e.message.split('\n')[0]})`);
  }

  // 4. whatever converter this machine happens to have.
  for (const c of CONVERTERS) {
    try {
      await exec('which', [c.cmd]);
    } catch {
      continue;
    }
    const tmp = path.join(os.tmpdir(), `kite-${process.pid}-${Date.now()}-${safeName(abs)}${c.out}`);
    try {
      await exec(c.cmd, c.args(abs, tmp));
      await stat(tmp);
      return { img: sharp(tmp, SHARP_OPTS), via: c.cmd, notes, tmp };
    } catch {
      await rm(tmp, { force: true });
    }
  }

  return { img: null, via: null, notes };
}

/**
 * Everything that has to happen to an arbitrary input before it can sit in a
 * layout beside other photographs. Returns the pipeline plus what it had to do,
 * so both the ingest and the check can describe it.
 */
export function normalise(img, meta, { background = '#F2F3F1', manualRotate = 0, ignoreExifOrientation = false } = {}) {
  const did = [];

  /*
   * No argument = apply the EXIF orientation tag, which is what makes sideways
   * phone photos come out the right way up.
   *
   * Some files lie. Anything that has been through an editor, an upscaler or a
   * generator can end up stored the right way round but still carrying a
   * rotation tag from an earlier life, and honouring it turns a good photograph
   * on its side. There is no way to detect that from the file, so it is an
   * explicit override in crops.json rather than a guess.
   */
  let pipeline = ignoreExifOrientation ? img : img.rotate();
  if (ignoreExifOrientation && (meta.orientation ?? 1) !== 1) {
    did.push('EXIF rotation ignored');
  } else if ((meta.orientation ?? 1) !== 1) {
    did.push('auto-rotated');
  }
  if (manualRotate) {
    pipeline = pipeline.rotate(manualRotate, { background });
    did.push(`rotated ${manualRotate}°`);
  }

  if (meta.hasAlpha) {
    pipeline = pipeline.flatten({ background });
    did.push('transparency filled');
  }

  if (meta.space && meta.space !== 'srgb' && meta.space !== 'rgb') did.push(`${meta.space} → sRGB`);
  pipeline = pipeline.toColorspace('srgb');

  if (meta.pages > 1) did.push(`first of ${meta.pages} frames`);

  return { pipeline, did };
}

/**
 * Some 16-bit TIFFs carry 8-bit values in a 16-bit container. Left alone, the
 * downshift to 8-bit divides everything by 257 and the photograph comes out
 * black. Detect it from the values actually present rather than the header.
 *
 * Returns a multiplier to fold into the grade's single .linear() call — sharp
 * keeps only one set of linear coefficients, so calling it twice would silently
 * drop the first.
 */
export async function levelScaleFor(img, meta) {
  if (!meta.depth || meta.depth === 'uchar' || meta.depth === 'char') return 1;
  try {
    const st = await img.stats();
    const peak = Math.max(...st.channels.map((c) => c.max));
    return peak > 0 && peak <= 255 ? 257 : 1;
  } catch {
    return 1;
  }
}
