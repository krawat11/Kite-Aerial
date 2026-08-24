/**
 * The layout reads manifest.json and nothing else. Adding a photograph means
 * dropping a file into a folder under source/ and running `npm run images` —
 * no markup change, no JSON to edit.
 *
 * Roles come from the folder a file was dropped into:
 *   source/hero/                -> hero
 *   source/portfolio/           -> portfolio
 *   source/case-study/          -> case
 *   source/comparison/ground/   -> comparison-ground
 *   source/comparison/aerial/   -> comparison-aerial
 *
 * reference/ is a separate, dev-only manifest of images that are not Kite
 * Aerial's work. `npm run build` clears them, and verify.mjs fails the build if
 * any reach dist/.
 */

import manifest from '../data/manifest.json';
import referenceManifest from '../data/manifest.reference.json';

const derived = import.meta.glob('/src/images/derived/*.jpg', {
  eager: true,
  import: 'default',
});

export const IS_DEV = import.meta.env.DEV;

const real = (manifest.frames ?? []).map((f) => ({ ...f, real: true }));

const reference = IS_DEV
  ? (referenceManifest.frames ?? []).map((f) => ({ ...f, real: false, reference: true }))
  : [];

export const usingReference = reference.length > 0;
export const counts = manifest.counts ?? { found: 0, kept: 0 };
export const generated = manifest.generated;

/** Where to drop a file to fill each kind of slot. Shown on empty placeholders. */
export const DROP = {
  hero: 'source/hero/',
  portfolio: 'source/portfolio/',
  case: 'source/case-study/',
  'comparison-ground': 'source/comparison/ground/',
  'comparison-aerial': 'source/comparison/aerial/',
};

/** Astro <Picture> needs the imported ImageMetadata, not a path string. */
export function asset(frame) {
  if (!frame?.real) return null;
  return derived[`/src/images/derived/${frame.slug}.jpg`] ?? null;
}

const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.source).localeCompare(String(b.source));

/**
 * Frames for a role, in the order their filenames imply.
 *
 *   count     pad or trim to exactly this many slots (nulls become placeholders)
 *   fill      top up short lists from reference imagery in dev only
 *   fallback  other roles to borrow real frames from when this one is empty
 */
export function framesFor(role, { count = null, fill = false, fallback = [] } = {}) {
  let picked = real.filter((f) => f.role === role).sort(byOrder);

  for (const alt of fallback) {
    if (count != null && picked.length >= count) break;
    const extra = real.filter((f) => f.role === alt && !picked.includes(f)).sort(byOrder);
    picked = [...picked, ...extra];
  }

  if (fill) {
    const want = count ?? picked.length + reference.length;
    picked = [...picked, ...reference.slice(0, Math.max(0, want - picked.length))];
  }

  if (count == null) return picked;
  const out = picked.slice(0, count);
  while (out.length < count) out.push(null);
  return out;
}

/**
 * The hero prefers source/hero/, and borrows from the rest rather than showing
 * an empty cluster while there is anything at all to show.
 */
export function heroFrames(count = 6) {
  const own = framesFor('hero');
  if (own.length >= 3) return own.slice(0, count);
  // Comparison frames are deliberately not borrowed: the aerial half is usually
  // the same photograph as one of the case-study stages, and the cluster
  // showing the same house twice reads as a mistake.
  return framesFor('hero', { count, fill: true, fallback: ['case', 'portfolio'] });
}

/** Both halves, or neither. A one-sided comparison argues against itself. */
export function comparisonPair() {
  const [ground] = framesFor('comparison-ground', { count: 1 });
  const [aerial] = framesFor('comparison-aerial', { count: 1 });
  return { ground, aerial, ready: Boolean(ground && aerial) };
}

/**
 * Candidate widths for <Picture>.
 *
 * Two ceilings, both of which matter. Never wider than the frame actually is,
 * because Astro will happily upscale. And never wider than the largest entry in
 * the list, because nothing on the site is displayed above about 1300 CSS
 * pixels and a 2000px AVIF of a detailed photograph blows the 400KB budget on
 * its own.
 */
export function widthsFor(frame, list = [360, 560, 860, 1200, 1600]) {
  const ceiling = Math.max(...list);
  const max = Math.min(frame?.width ?? ceiling, ceiling);
  return [...list.filter((w) => w < max), max];
}

/** "51.6864°N 3.9103°W · 98 m · 25.07.26" — an instrument reading beside the photograph. */
export function flightLog(frame) {
  if (!frame?.flight) return null;
  const { coords, altitude, date } = frame.flight;
  const parts = [];
  if (coords) parts.push(coords);
  if (altitude != null) parts.push(`${altitude} m`);
  if (date) {
    const [y, m, d] = date.split('-');
    parts.push(`${d}.${m}.${y.slice(2)}`);
  }
  return parts.length ? parts.join('  ·  ') : null;
}
