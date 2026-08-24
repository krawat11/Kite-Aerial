#!/usr/bin/env node
/**
 * Sets the site up for GitHub Pages and gets the repository ready to push.
 *
 *   npm run github -- <your-github-username> [repo-name]
 *
 *   npm run github -- keshav                 a user site: keshav.github.io
 *   npm run github -- keshav kite-aerial     a project site: /kite-aerial/
 *
 * Works out the right `base` from which of those you asked for — a project repo
 * serves from /repo-name/ and needs the trailing slash, and getting that wrong
 * is what makes every stylesheet and photograph 404 on a fresh Pages deploy.
 *
 * Then it writes the deploy config, builds (so the budget and form checks run
 * before anything reaches GitHub), makes the first commit, and prints the two
 * commands left for you.
 *
 * Pushing is yours: this has no access to your GitHub account.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');
const SITE = path.join(ROOT, 'src/content/site.json');

const [username, repoArg] = process.argv.slice(2);

if (!username || username.startsWith('-')) {
  console.error(`
  Which GitHub account is this going to?

    npm run github -- <username>              publishes at username.github.io
    npm run github -- <username> <repo-name>  publishes at username.github.io/repo-name/

  The username is the one in your GitHub profile URL.
`);
  process.exit(1);
}

const clean = (s) => s.replace(/^https?:\/\//, '').replace(/\/+$/, '').trim();
const user = clean(username).replace(/\.github\.io$/, '');
const repo = repoArg ? clean(repoArg) : `${user}.github.io`;
const isUserSite = repo.toLowerCase() === `${user.toLowerCase()}.github.io`;

const url = `https://${user}.github.io`;
const base = isUserSite ? '/' : `/${repo}/`;

/* ---- 1. write the deploy config ---- */

const site = JSON.parse(await readFile(SITE, 'utf8'));
const before = { ...site.deploy };
site.deploy = { ...site.deploy, url, base };
await writeFile(SITE, JSON.stringify(site, null, 2) + '\n');

console.log(`
  ${isUserSite ? 'User site' : 'Project site'}

    url    ${before.url}  ->  ${url}
    base   ${before.base}  ->  ${base}

  The site will live at ${url}${base === '/' ? '' : base}
`);

/* ---- 2. build, so nothing broken reaches GitHub ---- */

console.log('  Building…\n');
try {
  const { stdout } = await run('npm', ['run', 'build'], { cwd: ROOT, maxBuffer: 1024 * 1024 * 32 });
  const verify = stdout.slice(stdout.indexOf('\nverify'));
  console.log(verify.trimEnd().split('\n').map((l) => '  ' + l).join('\n'));
} catch (e) {
  console.error('\n  The build failed, so nothing has been committed. What it said:\n');
  console.error((e.stdout || e.stderr || String(e)).split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
  console.error('\n  Fix that and run this again. The deploy config above has been saved either way.\n');
  process.exit(1);
}

/* ---- 3. get the repository ready ---- */

const git = (...args) => run('git', args, { cwd: ROOT });

if (!existsSync(path.join(ROOT, '.git'))) {
  await git('init');
  await git('branch', '-M', 'main');
  console.log('\n  Started a git repository.');
}

// A commit needs an identity, and a fresh machine may not have one.
try {
  await git('config', 'user.email');
} catch {
  await git('config', 'user.email', `${user}@users.noreply.github.com`);
  await git('config', 'user.name', user);
  console.log('  Set a local git identity for this repository.');
}

await git('add', '-A');

let committed = false;
try {
  await git('commit', '-m', 'Kite Aerial');
  committed = true;
} catch {
  /* nothing changed since the last commit — fine */
}

const { stdout: count } = await git('rev-list', '--count', 'HEAD').catch(() => ({ stdout: '0' }));
const { stdout: tracked } = await git('ls-files').catch(() => ({ stdout: '' }));

console.log(`
  ${committed ? 'Committed' : 'Nothing new to commit'} — ${tracked.trim().split('\n').filter(Boolean).length} files tracked, ${count.trim()} commit(s).

  ────────────────────────────────────────────────────────────

  Three things left, and only you can do them.

  1. Make an empty repository on GitHub called  ${repo}
     No README, no .gitignore, no licence — this folder already has them.
     https://github.com/new

  2. Push it:

     git remote add origin https://github.com/${user}/${repo}.git
     git push -u origin main

  3. On GitHub: Settings -> Pages -> Source: "GitHub Actions"

     The workflow already in this folder takes it from there, and runs the
     build checks first — a push that breaks the performance budget or points
     the enquiry form at localhost fails there instead of going live.

  Give it a couple of minutes, then open ${url}${base === '/' ? '' : base}

  One more, once it is live: send yourself a test enquiry and click the
  confirmation link FormSubmit emails you. Until you do, the form goes nowhere.
`);
