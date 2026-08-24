import { chromium } from 'playwright';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const base = 'http://localhost:4321';
const pages = ['/', '/case-study', '/where-we-fly', '/about', '/enquiry-received', '/404'];
let bad = 0;
const fail = (m) => {
  console.log('  FAIL ' + m);
  bad++;
};
const ok = (m) => console.log('  ok   ' + m);

for (const [w, h, tag] of [
  [1440, 900, 'desk'],
  [390, 844, 'mob'],
]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  const consoleErrors = [];
  p.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  p.on('pageerror', (e) => consoleErrors.push(String(e)));

  for (const route of pages) {
    await p.goto(base + route, { waitUntil: 'load' });
    await p.evaluate(async () => {
      for (const i of document.querySelectorAll('img')) i.removeAttribute('loading');
      let y = 0;
      while (y < document.body.scrollHeight) {
        window.scrollTo(0, y);
        y += 500;
        await new Promise((r) => setTimeout(r, 70));
      }
      window.scrollTo(0, 0);
    });
    await p.waitForTimeout(1500);

    const r = await p.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      broken: [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.currentSrc),
      noAlt: [...document.images].filter((i) => !i.hasAttribute('alt')).length,
      emptyAlt: [...document.images].filter((i) => i.alt === '' && !i.closest('[aria-hidden]')).length,
      h1: document.querySelectorAll('h1').length,
      title: document.title,
      desc: document.querySelector('meta[name=description]')?.content?.length ?? 0,
      canonical: document.querySelector('link[rel=canonical]')?.href ?? null,
      og: Boolean(document.querySelector('meta[property="og:image"]')),
      placeholders: document.body.innerText.match(/TODO|USERNAME|YOUR@|localhost/g) ?? [],
    }));

    const name = `${tag} ${route}`.padEnd(28);
    if (r.overflow) fail(`${name} scrolls sideways`);
    if (r.broken.length) fail(`${name} ${r.broken.length} broken image(s): ${r.broken[0]}`);
    if (r.noAlt) fail(`${name} ${r.noAlt} image(s) with no alt attribute`);
    if (r.h1 !== 1) fail(`${name} has ${r.h1} h1 elements`);
    if (!r.title || r.title.length > 65) fail(`${name} title is ${r.title.length} chars`);
    if (r.desc < 50 || r.desc > 165) fail(`${name} meta description is ${r.desc} chars`);
    if (!r.canonical) fail(`${name} no canonical link`);
    if (!r.og) fail(`${name} no og:image`);
    if (r.placeholders.length) fail(`${name} shows placeholder text: ${[...new Set(r.placeholders)].join(', ')}`);
    if (!r.overflow && !r.broken.length && r.h1 === 1) ok(`${name} ${r.title.slice(0, 40)}`);

    await p.screenshot({ path: `/tmp/shots/final-${tag}-${route.replace(/\W/g, '') || 'home'}.png`, fullPage: true });
  }

  if (consoleErrors.length) fail(`${tag}: ${consoleErrors.length} console error(s) — ${consoleErrors[0].slice(0, 90)}`);
  else ok(`${tag}: no console errors on any page`);
  await ctx.close();
}

/* ---- keyboard and reduced motion ---- */
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const p = await ctx.newPage();
await p.goto(base + '/', { waitUntil: 'load' });
await p.waitForTimeout(600);
const settled = await p.evaluate(() =>
  [...document.querySelectorAll('.hero__slot')].map((e) => getComputedStyle(e).opacity)
);
settled.every((o) => o === '1')
  ? ok(`reduced motion: all ${settled.length} hero frames present and still`)
  : fail(`reduced motion: hero opacity ${settled.join(',')}`);

const ring = [];
for (let i = 0; i < 14; i++) {
  await p.keyboard.press('Tab');
  ring.push(
    await p.evaluate(() => {
      const e = document.activeElement;
      const s = getComputedStyle(e);
      return { tag: e.tagName, outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0 };
    })
  );
}
ring.every((r) => r.outline)
  ? ok(`keyboard: visible focus on all ${ring.length} stops`)
  : fail(`keyboard: ${ring.filter((r) => !r.outline).length} stop(s) with no visible focus`);

await ctx.close();
await b.close();
console.log(bad ? `\n  ${bad} problem(s)\n` : '\n  everything checks out\n');
process.exit(bad ? 1 : 0);
