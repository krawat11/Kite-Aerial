#!/usr/bin/env node
/**
 * Post-build gate. The performance budget is a hard requirement, so it is
 * enforced here rather than trusted.
 *
 *   - no reference imagery in dist/
 *   - every emitted image under 400KB
 *   - first load under 1.5MB per page
 *   - total page weight reported, capped well above first load
 *   - the video is never the LCP element
 *   - the enquiry form posts somewhere real
 *
 * "First load" means what the browser actually fetches before it can paint:
 * the HTML, its stylesheets and scripts, and the images that are NOT lazy.
 * Each image is counted at its AVIF variant, because that is what any browser
 * built this decade will pick. Counting lazy images, or counting the JPEG
 * fallback, measures a page nobody is served.
 */

import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist');

const KB = 1024;
const BUDGET = {
  image: 400 * KB,
  firstLoad: 1.5 * 1024 * KB,
  totalPage: 5 * 1024 * KB,
};

const problems = [];
const notes = [];

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else out.push(p);
  }
  return out;
}

const sizeOf = async (href) => {
  if (!href?.startsWith('/')) return 0;
  try {
    return (await stat(path.join(DIST, decodeURIComponent(href)))).size;
  } catch {
    return 0;
  }
};

const files = await walk(DIST);

/* ---- 1. no borrowed imagery shipped ---- */
const leaked = files.filter((f) => /_reference/.test(f));
if (leaked.length) {
  problems.push(`reference imagery present in dist/: ${leaked.length} file(s)\n    ${leaked.join('\n    ')}`);
}

/* ---- 2. per-image cap ---- */
const images = files.filter((f) => /\.(avif|webp|jpe?g|png)$/i.test(f));
let biggest = 0;
for (const f of images) {
  const { size } = await stat(f);
  biggest = Math.max(biggest, size);
  if (size > BUDGET.image) {
    problems.push(`image over the 400KB cap: ${path.relative(DIST, f)} — ${(size / KB).toFixed(0)}KB`);
  }
}
notes.push(`${images.length} images emitted, largest ${(biggest / KB).toFixed(0)}KB (cap 400KB)`);

/* ---- 3. per-page weight ---- */

/** The heaviest AVIF a <picture> could serve, and whether it blocks paint. */
function pictures(html) {
  const out = [];
  for (const block of html.match(/<picture[\s\S]*?<\/picture>/g) || []) {
    const avif = block.match(/<source[^>]+type="image\/avif"[^>]*srcset="([^"]+)"/);
    const img = block.match(/<img[^>]*>/)?.[0] ?? '';
    const lazy = /loading="lazy"/.test(img);
    let href = null;
    if (avif) {
      const candidates = avif[1]
        .split(',')
        .map((s) => s.trim().split(/\s+/))
        .map(([url, w]) => ({ url, w: parseInt(w, 10) || 0 }))
        .sort((a, b) => b.w - a.w);
      href = candidates[0]?.url ?? null;
    } else {
      href = img.match(/src="([^"]+)"/)?.[1] ?? null;
    }
    out.push({ href, lazy });
  }
  // Bare <img> outside a <picture> — the video poster, say.
  for (const img of html.match(/<img[^>]*>/g) || []) {
    if (out.some((p) => img.includes(p.href))) continue;
    const src = img.match(/src="([^"]+)"/)?.[1];
    if (src && !out.find((p) => p.href === src)) out.push({ href: src, lazy: /loading="lazy"/.test(img) });
  }
  return out;
}

const pages = files.filter((f) => f.endsWith('.html'));
for (const page of pages) {
  const html = await readFile(page, 'utf8');
  const rel = path.relative(DIST, page);
  let firstLoad = (await stat(page)).size;
  let total = firstLoad;

  for (const m of [
    ...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g),
    ...html.matchAll(/<script[^>]+src="([^"]+)"/g),
  ]) {
    const size = await sizeOf(m[1]);
    firstLoad += size;
    total += size;
  }

  for (const { href, lazy } of pictures(html)) {
    const size = await sizeOf(href);
    total += size;
    if (!lazy) firstLoad += size;
  }

  const line = `${rel.padEnd(28)} first load ${(firstLoad / KB).toFixed(0)}KB · whole page ${(total / KB).toFixed(0)}KB`;
  if (firstLoad > BUDGET.firstLoad) problems.push(`first load over 1.5MB: ${rel} — ${(firstLoad / KB).toFixed(0)}KB`);
  else if (total > BUDGET.totalPage) problems.push(`whole page over 5MB: ${rel} — ${(total / KB).toFixed(0)}KB`);
  else notes.push(line);

  /* ---- 4. the video must not be the LCP element ---- */
  for (const tag of html.match(/<video[\s\S]*?>/g) || []) {
    if (!/preload="none"/.test(tag)) problems.push(`${rel}: <video> is missing preload="none"`);
    if (!/poster="/.test(tag)) problems.push(`${rel}: <video> is missing a poster frame`);
    if (/\sautoplay/.test(tag)) problems.push(`${rel}: <video> autoplays`);
  }

  /* ---- 5. the form has to go somewhere ---- */
  for (const tag of html.match(/<form[\s\S]*?>/g) || []) {
    const action = tag.match(/action="([^"]*)"/)?.[1];
    const netlify = /data-netlify="true"/.test(tag);
    if (!action && !netlify) {
      problems.push(`${rel}: <form> has no action and no Netlify handler — submissions would go nowhere`);
    } else if (action?.includes('localhost')) {
      problems.push(
        `${rel}: <form> posts to ${action} — that is the local test receiver, not a live service.\n` +
          `    This should never happen in a build. Check testLocally in src/content/site.json.`
      );
    } else if (action?.includes('TODO') || action?.includes('YOUR')) {
      problems.push(`${rel}: <form> action still contains a placeholder — ${action}`);
    } else {
      notes.push(`${rel.padEnd(28)} form posts to ${netlify && !action ? 'Netlify Forms' : action}`);
    }
  }
}

/* ---- report ---- */
console.log('\nverify');
for (const n of notes) console.log(`  ok   ${n}`);
if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`  FAIL ${p}`);
  console.error(`\n${problems.length} failure(s)\n`);
  process.exit(1);
}
console.log('  all checks passed\n');
