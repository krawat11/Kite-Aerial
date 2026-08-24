import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import site from './src/content/site.json' with { type: 'json' };

/*
 * Where the site lives is data, not code — it is set in src/content/site.json
 * so that moving between GitHub Pages, Netlify and a real domain is one edit
 * in one place rather than a hunt through the config.
 */
const { url, base } = site.deploy;

export default defineConfig({
  site: url,
  base,
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !/\/(404|enquiry-received)\/?$/.test(page) })],
  output: 'static',
  build: { inlineStylesheets: 'auto' },
  image: { experimentalLayout: 'constrained' },
  devToolbar: { enabled: false },
  compressHTML: true,
});
