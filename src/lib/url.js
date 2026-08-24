/**
 * Internal links, with the deploy base path applied.
 *
 * Astro prepends `base` to the assets it processes itself, but not to paths
 * written by hand. On a GitHub Pages project site — served from
 * /repo-name/ rather than the domain root — every one of those would 404.
 * Route them all through here instead.
 */
const BASE = import.meta.env.BASE_URL || '/';

export function url(pathname = '/') {
  if (/^([a-z]+:)?\/\//i.test(pathname) || pathname.startsWith('#') || pathname.startsWith('mailto:')) {
    return pathname;
  }
  const [path, hash = ''] = pathname.split('#');
  const clean = path.replace(/^\//, '');
  // The site root keeps its trailing slash. On a project repo, /repo would
  // otherwise cost every visitor a redirect to /repo/.
  const joined = clean
    ? `${BASE.replace(/\/$/, '')}/${clean}`.replace(/\/{2,}/g, '/').replace(/\/$/, '')
    : BASE.endsWith('/')
      ? BASE
      : `${BASE}/`;
  return hash ? `${joined}#${hash}` : joined;
}
