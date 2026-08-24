import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();
const fail = (m) => {
  console.log('  FAIL ' + m);
  process.exitCode = 1;
};
const ok = (m) => console.log('  ok   ' + m);

await p.goto('http://localhost:4322/#enquiry', { waitUntil: 'load' });

/* ---- 1. empty submit is blocked, errors are named, focus moves ---- */
await p.locator('#enquiry-form [data-submit]').click();
await p.waitForTimeout(300);
const errs = await p.locator('#enquiry-form .field__error:not(:empty)').allTextContents();
errs.length === 3 ? ok(`empty submit blocked, ${errs.length} errors shown`) : fail(`expected 3 errors, got ${errs.length}: ${errs}`);
const focused = await p.evaluate(() => document.activeElement?.id);
focused === 'name' ? ok('focus moved to the first bad field') : fail(`focus went to ${focused}`);
const status = await p.locator('[data-status]').textContent();
/3 fields to fix/.test(status) ? ok(`status says: "${status.trim()}"`) : fail(`status said "${status}"`);

/* ---- 2. a bad email is caught ---- */
await p.fill('#name', 'Ceri Jones');
await p.fill('#email', 'not-an-email');
await p.fill('#where', 'Llanmadoc, Gower');
await p.locator('#enquiry-form [data-submit]').click();
await p.waitForTimeout(250);
const emailErr = await p.locator('#email-error').textContent();
/doesn't look like an email/.test(emailErr) ? ok('bad email caught') : fail(`email error was "${emailErr}"`);

/* ---- 3. correcting it clears the error live ---- */
await p.fill('#email', 'ceri@example.com');
await p.waitForTimeout(200);
(await p.locator('#email-error').textContent()) === '' ? ok('error clears as you fix it') : fail('error did not clear');

/* ---- 4. a real submit reaches the receiver ---- */
await p.fill('#when', 'Before 12 September');
await p.fill('#message', 'Four-bedroom let above Rhossili. Sale, not a let. About an acre.');
await p.selectOption('#what', { index: 1 });
await p.locator('#enquiry-form [data-submit]').click();
await p.waitForSelector('#enquiry-sent:not([hidden])', { timeout: 8000 }).then(
  () => ok('confirmation shown in place, page never reloaded'),
  () => fail('no confirmation appeared')
);
(await p.locator('#enquiry-form').isHidden()) ? ok('form replaced by the confirmation') : fail('form still visible');
const echo = await p.locator('[data-echo]').textContent();
/ceri@example\.com/.test(echo) ? ok(`confirmation echoes the address — "${echo.trim()}"`) : fail(`echo was "${echo}"`);

await p.waitForTimeout(400);
const log = await readFile('form-submissions.log', 'utf8');
const last = log.trim().split('\n\n').pop();
for (const want of ['Ceri Jones', 'ceri@example.com', 'Llanmadoc', 'Rhossili', 'Listing shoot plus video']) {
  last.includes(want) ? ok(`receiver got "${want}"`) : fail(`receiver did not get "${want}"`);
}
last.includes('company') ? fail('honeypot field was sent') : ok('honeypot never leaves the browser');
last.includes('phone') ? fail('empty optional field was sent') : ok('empty optional fields omitted');

/* ---- 5. the failure path recovers without losing what was typed ---- */
await p.goto('http://localhost:4322/', { waitUntil: 'load' });
await p.reload({ waitUntil: 'load' });
await p.evaluate(() => {
  const f = document.getElementById('enquiry-form');
  f.dataset.endpoint = 'http://localhost:4444/enquiry?fail';
});
await p.fill('#name', 'Bethan Price');
await p.fill('#email', 'bethan@example.com');
await p.fill('#where', 'SA3 1AB');
await p.locator('#enquiry-form [data-submit]').click();
await p.waitForTimeout(1200);
const errText = await p.locator('[data-status]').textContent();
/did not go through/.test(errText) ? ok('failure explained to the visitor') : fail(`status was "${errText}"`);
(await p.locator('[data-status] a[href^="mailto:"]').count()) ? ok('failure offers a mailto fallback') : fail('no mailto fallback');
(await p.inputValue('#name')) === 'Bethan Price' ? ok('nothing typed was lost on failure') : fail('form was cleared on failure');
(await p.locator('#enquiry-form [data-submit]').isEnabled()) ? ok('button re-enabled for a retry') : fail('button stuck disabled');

await ctx.close();
await b.close();
console.log(process.exitCode ? '\n  form test FAILED\n' : '\n  form test passed\n');
