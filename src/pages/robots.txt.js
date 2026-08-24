// Generated at build time so the sitemap URL always matches the deploy config
// in src/content/site.json, rather than drifting in a hand-written file.
import site from '../content/site.json';

export function GET() {
  const base = site.deploy.base.replace(/\/$/, '');
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${site.deploy.url}${base}/sitemap-index.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
  );
}
