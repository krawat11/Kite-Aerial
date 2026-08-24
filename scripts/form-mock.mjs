#!/usr/bin/env node
/**
 * A local stand-in for whatever service receives the enquiry form.
 *
 *   npm run form:test
 *
 * Run it in a second terminal alongside `npm run dev`. The form posts here
 * instead of the live service, so the whole flow can be exercised on localhost:
 * validation, the request, the success state, the failure state.
 *
 * Every submission is printed and appended to form-submissions.log.
 *
 *   /enquiry        accepts the submission
 *   /enquiry?fail   returns a 500, to check the error state looks right
 */

import { createServer } from 'node:http';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';

const PORT = Number(process.env.FORM_MOCK_PORT || 4444);
const LOG = path.resolve(import.meta.dirname, '..', 'form-submissions.log');

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
};

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { ...cors, 'Content-Type': 'text/plain' });
    return res.end('post an enquiry here\n');
  }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1e6) req.destroy();
  });

  req.on('end', async () => {
    const shouldFail = req.url.includes('fail');
    let fields = {};
    try {
      fields = body.trim().startsWith('{')
        ? JSON.parse(body)
        : Object.fromEntries(new URLSearchParams(body));
    } catch {
      fields = { _raw: body };
    }

    const stamp = new Date().toISOString();
    const lines = Object.entries(fields)
      .filter(([k]) => k !== 'form-name')
      .map(([k, v]) => `    ${k.padEnd(10)} ${v}`)
      .join('\n');

    console.log(`\n  ${shouldFail ? 'SIMULATED FAILURE' : 'enquiry received'}  ${stamp}\n${lines}\n`);
    await appendFile(LOG, `${stamp}\n${lines}\n\n`).catch(() => {});

    if (shouldFail) {
      res.writeHead(500, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: 'simulated failure' }));
    }
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, received: Object.keys(fields).length }));
  });
});

server.listen(PORT, () => {
  console.log(`
  Enquiry receiver listening on http://localhost:${PORT}/enquiry

  Leave this running and use the form on the dev site. Submissions print here
  and append to form-submissions.log.

  To check the error state, the form's "test the failure path" link posts to
  /enquiry?fail instead.
`);
});
