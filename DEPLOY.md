# Going live

## The short way

```
npm run github -- your-github-username kite-aerial
```

That works out the right `base` for you, writes the deploy config, builds (so
every budget and form check runs before anything reaches GitHub), makes the
first commit, and prints the three steps left. Leave the repo name off and it
sets up a `username.github.io` user site instead.

Then do step 2 below — the enquiry form still needs one click from you once the
site is live.

The rest of this page is the same thing by hand, plus the detail.

---

## 1. Point the site at its address

`src/content/site.json` → `deploy`:

```json
"deploy": {
  "url": "https://YOUR-USERNAME.github.io",
  "base": "/"
}
```

| Where it lives | `url` | `base` |
|---|---|---|
| GitHub Pages, user site (`username.github.io`) | `https://username.github.io` | `/` |
| GitHub Pages, project repo | `https://username.github.io` | `/repo-name/` |
| Netlify | `https://your-site.netlify.app` | `/` |
| Your own domain | `https://kiteaerial.co.uk` | `/` |

**A project repo needs the trailing slash on `base`.** Without it every
stylesheet, photograph and link 404s. This is the single most common way a
GitHub Pages deploy goes wrong, and it is why every internal link on this site
goes through `src/lib/url.js` instead of being written by hand.

These two values feed the canonical tags, the sitemap and `robots.txt`, so they
have to match reality before you push.

---

## 2. Turn the enquiry form on

The form posts to **FormSubmit**, which works from a static host with no
account and no backend. It is configured in `src/content/site.json` → `form`.

1. Deploy the site (step 3).
2. Go to the live site and send yourself a test enquiry.
3. **FormSubmit emails you a confirmation link. Click it.** Nothing arrives
   until you do — this happens once.
4. Send a second test enquiry and check it lands in
   `rawat.keshav11@gmail.com`.
5. Once activated, FormSubmit gives you a hashed endpoint like
   `https://formsubmit.co/ajax/a1b2c3d4…`. Swap that into `form.endpoint` so
   your email address is not sitting in the page source for scrapers to find.

**Until you have done step 3, the form will look like it works and go
nowhere.** That is FormSubmit's design, not a bug in the site.

### Testing it before you deploy

```
npm run form:test    # in one terminal — the local receiver
npm run dev          # in another
```

In dev the form posts to `localhost:4444` instead of the live service, so you
can fill it in and watch the submission arrive. Nothing is sent to anybody.
Submissions print in the receiver's terminal and append to
`form-submissions.log`.

`npm run test:form` drives all of that in a headless browser and checks
nineteen things: empty submits are blocked, errors name the field, focus moves
to the first problem, a bad email is caught, correcting it clears the error,
the payload arrives complete, the honeypot never leaves the browser, empty
optional fields are dropped, and a failure leaves everything typed intact with
the button re-enabled.

### Using something else instead

Change `form.provider` and `form.endpoint` together:

| provider | endpoint | notes |
|---|---|---|
| `formsubmit` | `https://formsubmit.co/ajax/YOUR@EMAIL` | no account, works anywhere |
| `formspree` | `https://formspree.io/f/YOUR_ID` | free tier, needs an account |
| `web3forms` | `https://api.web3forms.com/submit` | needs `accessKey` set too |
| `netlify` | `null` | Netlify hosting only, plus Forms enabled |

`npm run build` fails if the form would ship pointing at localhost or at a
placeholder, so a misconfigured form cannot go live by accident.

---

## 3. Publish

### GitHub Pages

```
git init && git add -A && git commit -m "Kite Aerial"
git branch -M main
git remote add origin git@github.com:YOUR-USERNAME/YOUR-REPO.git
git push -u origin main
```

Then **Settings → Pages → Source: GitHub Actions**. The workflow in
`.github/workflows/deploy.yml` builds and publishes on every push to `main`,
and runs `npm run verify` first — so a push that breaks the performance budget
or misconfigures the form fails there rather than going live.

Two things that trip people up, both already handled:

- `public/.nojekyll` stops GitHub ignoring the `_astro/` folder, which would
  otherwise strip every stylesheet and image.
- `src/images/derived/` and `public/media/` are deliberately **not** gitignored.
  `source/` is, because the camera originals are large and the site does not
  need them to build. Rerun `npm run images` after changing a photograph and
  commit what changes.
- The workflow does **not** rerun `npm run images`. With `source/` absent from
  the repo there would be nothing to process, and the ingest clears its output
  folder before it starts — it would delete the committed photographs and
  publish a site with no images. `npm run images` now refuses to run in that
  situation rather than trusting you to notice.

### Netlify

`netlify.toml` is already here. Connect the repo, set `form.provider` to
`netlify` and `form.endpoint` to `null`, and enable Forms in the site settings.

---

## 4. Before you tell anyone about it

- [ ] Send a test enquiry on the live site and confirm it reaches your inbox
- [ ] Get written permission from the case-study owner: people are identifiable
      on the patio in one still and in the video
- [ ] Re-export the three case-study stills at full resolution — they are
      1024px Apple Photos previews and `rejects.txt` flags them as soft
- [ ] Read the case-study stage notes in `src/content/frames.json`. They are
      written in the first person, as you, but somebody else wrote them.
- [ ] Replace the hero and portfolio photographs with your own Welsh work. They
      are American and alpine properties, and the copy around them says Gower.

Deliberately left alone, and fine as they are: `credentials.aircraftModel` is
`null` so the model line is omitted, and the two testimonial slots render
nothing until real quotes are confirmed in writing.

---

## Checking your own work

```
npm run check        will these photographs work? changes nothing
npm run build        builds, and enforces every budget
npm run test:site    every page, desktop and mobile: broken images, sideways
                     scroll, alt text, headings, meta, canonical, console
                     errors, keyboard focus, reduced motion
npm run test:form    the enquiry flow, end to end
```

`test:site` and `test:form` need a browser once:

```
npx playwright install chromium
```
