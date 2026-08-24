#!/usr/bin/env node
/**
 * Kite Aerial image ingest.
 *
 *   npm run images        process source/    -> the site
 *   npm run images:ref    process reference/ -> dev-only filler
 *
 * Drop files into the folders under source/ and run it. Which folder a file is
 * in decides where it appears on the site; nothing has to be registered in code.
 *
 *   source/hero/          the cluster at the top of the home page
 *   source/portfolio/     the three blocks under "Who this is for"
 *   source/case-study/    the sequence on /case-study, in filename order
 *   source/comparison/ground/   the ground-level half of the comparison
 *   source/comparison/aerial/   the aerial half of the comparison
 *
 * Reads basically anything a camera or a phone produces: JPEG, PNG, HEIC/HEIF,
 * TIFF, WebP, AVIF, GIF, BMP. Fixes sideways phone photos, flattens
 * transparency, converts CMYK and greyscale to sRGB, takes the first frame of
 * an animated GIF, and never enlarges anything.
 *
 * Originals in source/ are never modified. Crops live in crops.json so they are
 * reproducible and reviewable rather than done by hand.
 */

import { readFile, writeFile, readdir, mkdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import exifReader from 'exif-reader';
import { READABLE, VIDEO, openImage, normalise, levelScaleFor } from './lib/decode.mjs';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const REF_MODE = process.argv.includes('--reference');
// `npm run dev` re-runs the reference pass first, because `npm run build`
// deliberately wipes it. --quiet keeps that from shouting every time.
const QUIET = process.argv.includes('--quiet');

const SRC_DIR = path.join(ROOT, REF_MODE ? 'reference' : 'source');
const MASTER_DIR = REF_MODE
  ? path.join(ROOT, 'public/_reference')
  : path.join(ROOT, 'src/images/derived');
const VARIANT_DIR = REF_MODE ? MASTER_DIR : path.join(ROOT, 'public/media');
const MANIFEST = path.join(ROOT, 'src/data', REF_MODE ? 'manifest.reference.json' : 'manifest.json');
const REPORT = path.join(ROOT, REF_MODE ? 'rejects.reference.txt' : 'rejects.txt');

/* ------------------------------------------------------------------ folders → roles */

const ROLES = {
  hero: 'hero',
  portfolio: 'portfolio',
  'case-study': 'case',
  case: 'case',
  'comparison/ground': 'comparison-ground',
  'comparison/aerial': 'comparison-aerial',
  '': 'portfolio', // loose in source/ — assume portfolio
};

/* ------------------------------------------------------------------ config */

const crops = existsSync(path.join(ROOT, 'crops.json'))
  ? JSON.parse(await readFile(path.join(ROOT, 'crops.json'), 'utf8'))
  : {};

const S = {
  // Nothing on the site is displayed wider than about 1300 CSS pixels, so 1600
  // already covers a 2x screen at the widest slot. Going bigger only costs
  // bytes: a 2000px AVIF of a detailed photograph is over the 400KB budget on
  // its own, and verify.mjs is a hard gate, not a warning.
  targetLongEdge: 1600,
  standaloneLongEdge: 1400,
  quality: 80,
  masterQuality: 92,
  minUsableLongEdge: 400, // below this a photograph cannot carry a layout at all
  smallWarning: 1200, // below this it will look soft in a large slot
  ...(crops._settings || {}),
};

const editorial = existsSync(path.join(ROOT, 'src/content/frames.json'))
  ? JSON.parse(await readFile(path.join(ROOT, 'src/content/frames.json'), 'utf8'))
  : {};

/**
 * One grade for the whole set. Colour consistency across a grid matters more
 * than any single frame: mixed white balance is the thing that reads as
 * amateur. Deliberately gentle.
 */
const GRADE = { saturation: 1.04, brightness: 1.0, linear: [1.03, -3] };

/** Transparency is flattened onto the page background, not onto white. */
const PAGE_BACKGROUND = '#F2F3F1';

/* ------------------------------------------------------------------- utils */

const slugify = (name) =>
  path
    .basename(name, path.extname(name))
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'frame';

/** "03 - back of house.jpg" -> 3. Anything unnumbered sorts after, alphabetically. */
function orderFromName(file) {
  const m = path.basename(file).match(/^(\d{1,3})\s*[-_. ]/);
  return m ? Number(m[1]) : null;
}

function aspectBucket(w, h) {
  const r = w / h;
  const portrait = r < 1;
  const v = portrait ? h / w : r;
  const table = [
    ['1:1', 1.0],
    ['5:4', 1.25],
    ['4:3', 4 / 3],
    ['3:2', 1.5],
    ['16:9', 16 / 9],
    ['2:1', 2],
    ['pano', 3],
  ];
  let best = table[0];
  for (const t of table) if (Math.abs(v - t[1]) < Math.abs(v - best[1])) best = t;
  return {
    bucket: best[0],
    orientation: v === 1 ? 'square' : portrait ? 'portrait' : 'landscape',
    panorama: v >= 2.2,
  };
}

function tierFor(longEdge) {
  if (longEdge >= 4000) return 'hero';
  if (longEdge >= 2000) return 'grid';
  if (longEdge >= 1200) return 'tile';
  return 'small';
}

/** Almost certainly a video frame grab: exact broadcast size and no exposure data. */
function looksLikeFrameGrab(w, h, exif) {
  const exact = (w === 3840 && h === 2160) || (w === 1920 && h === 1080);
  return exact && !exif?.FNumber && !exif?.ExposureTime;
}

function dms(v, ref) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const d = Number(v[0]) + Number(v[1]) / 60 + Number(v[2]) / 3600;
  return ref === 'S' || ref === 'W' ? -d : d;
}

function formatCoords(lat, lon) {
  if (lat == null || lon == null) return null;
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}

/* ------------------------------------------------------------------- ingest */

/** Every image under source/, tagged with the role its folder implies. */
async function collect(dir, rel = '') {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    const nextRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(...(await collect(abs, nextRel)));
      continue;
    }
    const ext = path.extname(e.name).toLowerCase();
    if (VIDEO.has(ext)) continue; // handled by `npm run video`
    if (!READABLE.has(ext)) {
      if (!/\.(txt|md|json|ds_store)$/i.test(e.name)) {
        out.push({ abs, rel: nextRel, folder: rel, unsupported: true });
      }
      continue;
    }
    out.push({ abs, rel: nextRel, folder: rel, unsupported: false });
  }
  return out;
}

/** A caption and alt text can live in a plain .txt beside the image. */
async function sidecar(abs) {
  const twin = abs.replace(/\.[^.]+$/, '.txt');
  if (!existsSync(twin)) return {};
  const lines = (await readFile(twin, 'utf8')).split('\n').map((l) => l.trim());
  const [caption, ...rest] = lines.filter(Boolean);
  const alt = rest.join(' ').trim();
  return { outcome: caption || undefined, alt: alt || undefined };
}

async function run() {
  /*
   * Refuse to run against an empty source/ when there is already a good set of
   * processed images. The ingest clears its output directory before it starts,
   * so without this an empty or missing source/ silently deletes every
   * photograph on the site — which is exactly what a CI checkout looks like,
   * source/ being gitignored.
   */
  const incoming = (await collect(SRC_DIR)).filter((f) => !f.unsupported);
  const existing = (await readdir(MASTER_DIR).catch(() => [])).filter((f) => f.endsWith('.jpg'));
  if (!incoming.length && existing.length) {
    console.error(
      `\n  Stopping: ${path.relative(ROOT, SRC_DIR)}/ has no images in it, but there are\n` +
        `  ${existing.length} processed photograph(s) in ${path.relative(ROOT, MASTER_DIR)}/.\n\n` +
        `  Running would delete them and leave the site with nothing. If that is really\n` +
        `  what you want, empty that folder by hand first.\n\n` +
        `  If you are seeing this in CI: the processed images are committed on purpose.\n` +
        `  Build directly with \`npm run build\` — this step is not needed there.\n`
    );
    process.exit(1);
  }

  await rm(MASTER_DIR, { recursive: true, force: true });
  await mkdir(MASTER_DIR, { recursive: true });
  await mkdir(VARIANT_DIR, { recursive: true });

  // Clear stale variants. Renaming a slug used to leave its old files behind,
  // which then sat in the build for ever. The orbit files are left alone —
  // they come from `npm run video`, not from here.
  if (!REF_MODE) {
    for (const f of await readdir(VARIANT_DIR).catch(() => [])) {
      if (!f.startsWith('orbit') && /\.(avif|webp|jpe?g|png)$/i.test(f)) {
        await rm(path.join(VARIANT_DIR, f), { force: true });
      }
    }
  }
  await mkdir(path.dirname(MANIFEST), { recursive: true });

  const files = (await collect(SRC_DIR)).sort((a, b) => a.rel.localeCompare(b.rel));
  void incoming;
  const frames = [];
  const problems = [];
  const warnings = [];
  const missingAlt = [];

  for (const entry of files) {
    const { abs, rel, folder } = entry;
    const name = path.basename(rel);

    if (entry.unsupported) {
      problems.push(`${rel}\n    SKIPPED — ${path.extname(name)} is not an image format this can read.\n    Readable: ${[...READABLE].join(' ')}`);
      continue;
    }

    const rule = crops[name] || crops[rel] || {};
    const { img: opened, notes, via, tmp } = await openImage(abs);

    if (!opened) {
      problems.push(
        `${rel}\n    COULD NOT READ IT.\n    ${notes.join('\n    ')}\n` +
          `    If this is an iPhone HEIC, run \`npm install heic-convert\`, or open it in\n` +
          `    Preview and export a JPEG. Otherwise the file is probably damaged.`
      );
      continue;
    }

    const meta = await opened.metadata();

    let exif = null;
    try {
      if (meta.exif) exif = exifReader(meta.exif);
    } catch {
      /* unreadable exif is itself information, recorded below */
    }
    const photo = exif?.Photo || {};
    const img0 = exif?.Image || {};
    const gps = exif?.GPSInfo || {};

    /*
     * Normalise before anything else, so every downstream step sees the same
     * kind of image whatever came in:
     *   .rotate() with no argument applies the EXIF orientation tag, which is
     *   what makes sideways phone photos come out the right way up.
     */
    const { pipeline: normalised, did } = normalise(opened, meta, {
      background: PAGE_BACKGROUND,
      manualRotate: rule.rotate || 0,
      ignoreExifOrientation: Boolean(rule.ignoreExifOrientation),
    });
    let pipeline = normalised;

    // sharp keeps a single set of linear coefficients, so the 16-bit rescale is
    // folded into the grade's one .linear() call rather than applied separately.
    const levelScale = await levelScaleFor(opened, meta);
    const rescaled = levelScale !== 1;
    if (rescaled) {
      warnings.push(`${rel} — ${meta.depth} file holding 8-bit values; rescaled so it does not come out black.`);
    }

    // EXIF orientation 5–8 swaps the axes, so measure after rotating — unless
    // the tag is being ignored, in which case the stored size is the real one.
    const swapped = !rule.ignoreExifOrientation && (meta.orientation ?? 1) >= 5;
    let w = swapped ? meta.height : meta.width;
    let h = swapped ? meta.width : meta.height;

    if (rule.crop) {
      const c = rule.crop;
      const left = Math.max(0, Math.min(c.left | 0, w - 1));
      const top = Math.max(0, Math.min(c.top | 0, h - 1));
      const cw = Math.min(c.width | 0, w - left);
      const ch = Math.min(c.height | 0, h - top);
      pipeline = pipeline.extract({ left, top, width: cw, height: ch });
      w = cw;
      h = ch;
    }

    const longEdge = Math.max(w, h);

    if (longEdge < S.minUsableLongEdge) {
      problems.push(
        `${rel}\n    TOO SMALL TO USE — ${w}×${h}. Anything under ${S.minUsableLongEdge}px on the long\n` +
          `    edge cannot fill a slot without looking broken. Find the original.`
      );
      continue;
    }

    const frameGrab = looksLikeFrameGrab(meta.width, meta.height, photo);
    let tier = tierFor(longEdge);
    if (frameGrab && tier !== 'small') {
      tier = 'tile';
      warnings.push(`${rel} — looks like a video frame grab (${meta.width}×${meta.height}, no exposure data), so it is capped at tile size.`);
    }
    if (longEdge < S.smallWarning) {
      warnings.push(`${rel} — only ${longEdge}px on the long edge. It will be used, but it may look soft in a large slot. A bigger export would be better.`);
    }
    if (via && via !== 'sharp') warnings.push(`${rel} — sharp could not read this format, so it was decoded with ${via}.`);
    if (!via) for (const n of notes) warnings.push(`${rel} — ${n}`);

    /* ---- resize (never upward) and grade ---- */
    const outLong = Math.min(longEdge, S.targetLongEdge);
    const resize = w >= h ? { width: outLong } : { height: outLong };

    const slug = rule.slug || slugify(name);
    const graded = pipeline
      .resize({ ...resize, withoutEnlargement: true, fit: 'inside' })
      .modulate({ saturation: GRADE.saturation, brightness: GRADE.brightness })
      // One linear call only. sharp stores a single set of linear coefficients,
      // so a second call replaces the first rather than composing with it.
      .linear(GRADE.linear[0] * levelScale, GRADE.linear[1])
      .toColorspace('srgb');

    const masterPath = path.join(MASTER_DIR, `${slug}.jpg`);
    const info = await graded
      .clone()
      .jpeg({ quality: REF_MODE ? 72 : S.masterQuality, mozjpeg: true })
      .toFile(masterPath);

    /*
     * No standalone copies in public/. Astro's <Picture> emits the AVIF and
     * WebP the pages actually use, straight from the master. Emitting a second
     * set here doubled the repo for files nothing linked to — the OG image and
     * the video poster are generated by their own scripts.
     */
    if (tmp) await rm(tmp, { force: true });

    const lat = dms(gps.GPSLatitude, gps.GPSLatitudeRef);
    const lon = dms(gps.GPSLongitude, gps.GPSLongitudeRef);
    const shotAt = photo.DateTimeOriginal || img0.DateTime || null;
    const shotDate = shotAt ? new Date(shotAt) : null;
    const validDate = shotDate && !Number.isNaN(shotDate.valueOf()) ? shotDate : null;

    const side = await sidecar(abs);
    const ed = editorial[slug] || {};
    const role = ed.role || ROLES[folder] || ROLES[''] || 'portfolio';
    const alt = ed.alt || side.alt || null;
    if (!alt) missingAlt.push(`${rel}  ->  slug: ${slug}`);

    frames.push({
      slug,
      source: rel,
      folder: folder || '(top level)',
      master: REF_MODE ? `/_reference/${slug}.jpg` : `/src/images/derived/${slug}.jpg`,
      width: info.width,
      height: info.height,
      nativeWidth: w,
      nativeHeight: h,
      nativeLongEdge: longEdge,
      ...aspectBucket(info.width, info.height),
      tier,
      role,
      order: ed.order ?? orderFromName(name) ?? null,
      // A neutral, honest fallback. Never invent a description of a photograph.
      alt: alt || 'Aerial photograph of the property.',
      altWritten: Boolean(alt),
      outcome: ed.outcome ?? side.outcome ?? null,
      stage: ed.stage ?? null,
      inputFormat: meta.format,
      decodedVia: via,
      cropped: Boolean(rule.crop),
      crop: rule.crop || null,
      rotated: rule.rotate || 0,
      autoOriented: !rule.ignoreExifOrientation && (meta.orientation ?? 1) !== 1,
      exifRotationIgnored: Boolean(rule.ignoreExifOrientation) && (meta.orientation ?? 1) !== 1,
      normalisedBy: did,
      hadAlpha: Boolean(meta.hasAlpha),
      bitDepth: meta.depth ?? null,
      rescaled,
      note: rule.note || null,
      exif: {
        present: Boolean(exif),
        make: img0.Make || null,
        model: img0.Model || null,
        shotAt: validDate ? validDate.toISOString() : null,
        fNumber: photo.FNumber ?? null,
        exposureTime: photo.ExposureTime ?? null,
        iso: photo.ISOSpeedRatings ?? null,
        frameGrab,
      },
      flight: {
        coords: formatCoords(lat, lon),
        lat: lat ?? null,
        lon: lon ?? null,
        altitude: gps.GPSAltitude != null ? Math.round(Number(gps.GPSAltitude)) : null,
        date: validDate ? validDate.toISOString().slice(0, 10) : null,
        time: validDate ? validDate.toISOString().slice(11, 16) : null,
      },
    });
  }

  frames.sort(
    (a, b) =>
      (a.order ?? 999) - (b.order ?? 999) || a.source.localeCompare(b.source)
  );

  const byRole = frames.reduce((acc, f) => ((acc[f.role] = (acc[f.role] || 0) + 1), acc), {});

  await writeFile(
    MANIFEST,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        settings: S,
        grade: GRADE,
        counts: {
          found: files.length,
          kept: frames.length,
          skipped: files.length - frames.length,
          byRole,
          byTier: frames.reduce((a, f) => ((a[f.tier] = (a[f.tier] || 0) + 1), a), {}),
        },
        frames,
      },
      null,
      2
    )
  );

  /* ---- the report ---- */
  const lines = [
    `Kite Aerial — image ingest report`,
    `generated ${new Date().toISOString()}`,
    `source: ${path.relative(ROOT, SRC_DIR)}/   found ${files.length}, used ${frames.length}`,
    ``,
  ];
  if (problems.length) lines.push(`NOT USED (${problems.length})`, ``, ...problems.map((p) => p + '\n'));
  else lines.push(`NOT USED — nothing. Every file was read.`, ``);
  if (warnings.length) lines.push(`WORTH KNOWING (${warnings.length})`, ``, ...warnings.map((w) => '  ' + w), ``);
  if (missingAlt.length)
    lines.push(
      `ALT TEXT STILL TO WRITE (${missingAlt.length})`,
      ``,
      `  Describe the property and the landscape, not the equipment. Put it on the`,
      `  second line of a .txt file beside the image, or in src/content/frames.json.`,
      ``,
      ...missingAlt.map((m) => '  ' + m),
      ``
    );
  await writeFile(REPORT, lines.join('\n'));

  /* ---- what the person running this actually needs to see ---- */
  const label = REF_MODE ? '[reference] ' : '';
  if (QUIET) {
    console.log(`${label}${frames.length} frame(s) ready for dev`);
    return;
  }
  console.log(`\n${label}found ${files.length} file(s), used ${frames.length}\n`);
  for (const f of frames) {
    console.log(
      `  ${f.role.padEnd(18)} ${f.slug.slice(0, 26).padEnd(28)} ` +
        `${String(f.nativeWidth)}x${f.nativeHeight}`.padEnd(11) +
        `${f.bucket.padEnd(5)} ${f.tier.padEnd(6)}${f.inputFormat}${f.autoOriented ? ' (auto-rotated)' : ''}${f.exifRotationIgnored ? ' (bogus EXIF rotation ignored)' : ''}`
    );
  }
  if (!frames.length) {
    console.log('  nothing yet — drop some photographs into source/hero/ and run this again');
  }
  console.log('');
  if (problems.length) console.log(`  ${problems.length} file(s) not used — see ${path.basename(REPORT)}`);
  if (warnings.length) console.log(`  ${warnings.length} note(s) — see ${path.basename(REPORT)}`);
  if (missingAlt.length) console.log(`  ${missingAlt.length} image(s) still need alt text — see ${path.basename(REPORT)}`);
  if (!REF_MODE) {
    const empty = ['hero', 'portfolio', 'case', 'comparison-ground', 'comparison-aerial'].filter((r) => !byRole[r]);
    if (empty.length) console.log(`  still empty: ${empty.join(', ')}`);
  }
  console.log('');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
