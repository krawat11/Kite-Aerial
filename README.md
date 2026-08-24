# Kite Aerial

Astro, static output, no client-side framework beyond one progressive-enhancement
script on the enquiry form.

> **From the zip:** the photographs ship in a second archive,
> `kite-aerial-source.zip`, which unpacks into `source/`. The video original is
> in neither — it is 23MB — but its encoded web versions are in `public/media/`,
> so the site runs without it.

```
npm install
npm run dev        # localhost:4321 — look at it
npm run check      # will these photographs work? changes nothing
npm run images     # after you add or change photographs
npm run video      # after you add or change the video (needs ffmpeg)
npm run build      # the deployable site, with every budget enforced
```

**Going live is in [DEPLOY.md](DEPLOY.md)** — the address, the enquiry form,
GitHub Pages, and what to check before you tell anyone about it.

Testing:

```
npm run form:test  # local receiver, so the enquiry form can be tried offline
npm run test:form  # drives the enquiry flow in a browser, 19 checks
npm run test:site  # every page: images, alt text, meta, keyboard, motion
```

---

# Putting your photographs in

**Drop files into the folders under `source/`, then run `npm run images`.**

That is the whole job. Nothing in the code needs editing. Rerun it as often as
you like — it rebuilds everything from whatever is in `source/` at the time, so
removing a photograph is just deleting the file and running it again.

Every empty slot on the site tells you, on the page itself, which folder fills
it. They disappear one by one as the files arrive.

## Which folder

| Folder | Where it appears | How many |
|---|---|---|
| `source/hero/` | The overlapping cluster at the top of the home page | 3 to 6 |
| `source/portfolio/` | The three blocks under "Who this is for" | 3 |
| `source/case-study/` | The sequence on `/case-study`, in filename order | 3 to 8 |
| `source/comparison/ground/` | Left half of the comparison — a house from the pavement | 1 |
| `source/comparison/aerial/` | Right half — the same house from the air | 1 |
| `source/video/` | The orbit at the end of `/case-study` — `npm run video` | 1 |

Files dropped loose in `source/` are treated as portfolio.

**Order** comes from the filename. Start a name with a number and it takes that
position: `01 - establishing.jpg`, `02 - closer.jpg`, `03 - top down.jpg`.
Anything unnumbered sorts after, alphabetically.

**The hero borrows.** While `source/hero/` is empty, the cluster shows whatever
else exists rather than sitting blank, and says so in the setup panel. Put files
in `source/hero/` and it uses those instead.

## What files work

JPEG · PNG · **HEIC and HEIF straight off an iPhone** · TIFF · WebP · AVIF ·
GIF · BMP. Upper or lower case extensions. Spaces, brackets and accents in
filenames are all fine.

Handled automatically, so you never have to prepare a file first:

- **Sideways phone photos** are turned the right way up from the EXIF
  orientation tag.
- **HEIC** is decoded by a bundled pure-JavaScript decoder, so it works with no
  system dependencies. If that ever fails, `sips` (built into macOS),
  `heif-convert`, ImageMagick and ffmpeg are each tried in turn.
- **Transparency** in a PNG is filled with the page background rather than
  black.
- **CMYK** files from a print workflow, and **greyscale** files, are converted
  to screen colour.
- **16-bit TIFFs**, including badly written ones that would otherwise come out
  black, are rescaled correctly.
- **Animated GIFs** contribute their first frame.
- **Any shape** works — portrait, square, 4:3, 3:2, 16:9, panoramic. The layout
  adapts around the ratio instead of cropping everything to match, because that
  crop would throw away the composition the shot was flown for.
- **One colour grade** is applied identically to everything, so a set shot
  across different days still reads as one body of work. Mixed white balance
  across a grid is the most common tell on a first portfolio site.

Nothing is ever enlarged. A small file stays small and the layout works around
it. Over 2000px on the long edge is ideal; under 1200px is used but flagged in
`rejects.txt` as likely to look soft.

## The video

The one thing that doesn't go through `npm run images`. Put **one** clip in
`source/video/` and run:

```
npm run video
```

`.mov` straight off the drone works, as do `.mp4`, `.m4v`, `.avi`, `.mkv` and
`.webm`. 4K is fine — it's scaled to 900 lines, which is more than the player
is ever displayed at. Sound is dropped, because the page doesn't autoplay.
Vertical clips work. Nothing is enlarged, so a 720p clip stays 720p.

It writes an AV1 file, an H.264 file behind it, and a poster frame. The page paints from the poster and downloads nothing until somebody
presses play, which is what keeps the video off the critical path.

Needs ffmpeg — `brew install ffmpeg`. Without it, or without a clip, the case
study page leaves that stage out entirely and says what's missing, rather than
shipping a broken player. Checked at build time, not assumed.

A slow orbit of 15–25 seconds carries the page best. `npm run video` tells you
if the clip is shorter than a viewer takes to read the caption beside it. If
there's more than one file in the folder it uses the first alphabetically and
names the ones it skipped.

## Checking before you commit to anything

```
npm run check                      everything currently in source/
npm run check ~/Desktop/new-shoot  a folder you have not moved in yet
npm run check ~/Pictures/one.HEIC  a single file
```

It reads each file exactly the way `npm run images` will, says what it found and
what it would do to it, and **writes nothing at all**. Point it anywhere.

```
  ok   IMG_4821.HEIC
       jpeg · 4032×3024 · landscape 1.33:1 · big enough for anything
       will be: auto-rotated, decoded with heic-convert
 note  scan.tif
       tiff · 1800×1200 · landscape 1.50:1 · usable
       will be: grey16 → sRGB, ushort levels rescaled
 NOPE  screenshot.pdf
       .pdf is not an image format the site can read.
```

## Captions and alt text

The one part worth typing. Put a plain `.txt` beside any image with the same
name:

```
source/hero/rhossili-cottage.jpg
source/hero/rhossili-cottage.txt
```

```
Shows the beach is a five-minute walk, not a claim in the description.
A stone cottage on a coastal slope, with a walled garden running down toward a sandy bay.
```

Line 1 is the caption shown under the photograph — say what the image *sells*,
not what it depicts. Line 2 is the alt text, which is what a screen reader
announces and what Google reads: describe the property and the landscape.

Skip it and the site still works. It uses a neutral description and lists the
file under "alt text still to write" in `rejects.txt`, so nothing gets silently
invented and you always know which ones are outstanding.

For the case study, each stage also wants two or three lines in your own voice
about why that angle was flown. Those go in `src/content/frames.json` under the
image's slug, as `stage`.

## What it tells you

`npm run images` prints one line per photograph — role, size, shape, quality
tier, and whether it had to be rotated or converted. Then it names anything it
could not read, anything worth knowing about, and every image still missing alt
text. The same thing in full detail is written to `rejects.txt`.

```
found 6 file(s), used 6

  hero        rhossili-cottage    4032x3024  4:3   hero  heif (auto-rotated)
  hero        oxwich-bay          4032x3024  4:3   hero  jpeg
  case        case-01-establishing 1024x768  4:3   small jpeg
  ...

  1 image(s) still need alt text — see rejects.txt
  still empty: comparison-ground, comparison-aerial
```

## Turning the setup panels off

The "how to put your photographs in" panels and the folder names on empty slots
are scaffolding, styled so they can't be mistaken for site copy. Each disappears
on its own once the thing it describes exists. To hide all of them at once
without deleting anything, set `showSetupNotes` to `false` in
`src/content/site.json`.

## If a photograph needs fixing

Only then does `crops.json` come in. It is optional and most people never touch
it:

```json
"burned-in-caption.jpg": {
  "crop": { "left": 0, "top": 0, "width": 3800, "height": 2600 },
  "rotate": -1.2,
  "slug": "coastal-cottage"
}
```

`crop` cuts burned-in text off an edge — crop inward, never blur or clone it
out, because a visible smudge is worse than a tighter frame. `rotate` levels a
horizon that is a degree off. Both are measured after the sideways-phone
correction. Originals in `source/` are never modified, so a crop can be changed
or undone at any time.

---

## What is in the build right now

Three photographs and one video, all from the same property.

| Slug | File | Size | Flight |
|---|---|---|---|
| `case-01-establishing` | `case-study/01 - establishing.jpeg` | 1024×768 | 51.6861°N 3.9105°W, 108m, 25.07.26 10:17 |
| `case-02-rear-elevation` | `case-study/02 - rear elevation.jpeg` | 1024×768 | 51.6864°N 3.9103°W, 98m, 25.07.26 10:13 |
| `case-03-plot-boundaries` | `case-study/03 - plot boundaries.jpeg` | 1024×768 | 51.6866°N 3.9104°W, 142m, 25.07.26 10:15 |
| orbit video | `orbit_source.mov` | 3840×2160, 6.4s | 25.07.26 10:14 |

All three stills are 1024px Apple Photos preview exports (`_1_105_c`), not
originals. They work, and they are flagged as soft. Re-export the
full-resolution files from the Photos library over the top of them and rerun
`npm run images`; the flag clears itself.

`source/hero/`, `source/portfolio/` and both comparison folders are empty, so
the home page shows labelled placeholders in those positions.

### `reference/` — dev-only layout filler

Eleven images in the original folder were third-party marketing photographs:
two watermarked `CLE3D` (a Cleveland, Ohio real estate photography company),
four watermarked `BuildGreenNH.com`, all with stripped EXIF, all of American or
alpine properties, several at Pinterest's exact pin dimensions.

They are in `reference/`, not `source/`. `npm run images:ref` processes them so
`npm run dev` can show the layout fully dressed. Three things keep them out of
anything public:

1. `src/lib/frames.js` gates the reference manifest behind `import.meta.env.DEV`.
2. `scripts/clean-reference.mjs` runs before every build and deletes them.
3. `scripts/verify.mjs` fails the build if any reach `dist/`.

---

## Still to do before launch

- **Testimonials** — verbal only. Two entries in `src/content/site.json` with
  `quote: null`. They render nothing until an owner confirms wording in writing.
- **The comparison pair** — needs a ground-level frame. Shoot one on the next
  job, from the pavement, before you launch.
- **The second price** — the brief fixed £150–£200 for the listing shoot and
  said only "higher tier" for the one with video. £250–£325 is a placeholder.
  Confirm it and set `priceConfirmed: true`.
- **`site.json` email** — currently `TODO@kiteaerial.co.uk`.
- **Aircraft model** — EXIF says DJI `FC9589`, which could not be tied to a
  specific model with confidence, so the page says "sub-250g, UK0/C0 class" and
  omits the model. Fill in `credentials.aircraftModel`.
- **The "Who's flying" paragraphs on `/about`** — the one part nobody else can
  write.
- **Domain** — `kiteaerial.co.uk` and `flykite.co.uk` both resolve;
  `flykite.co.uk` is parked for sale on GoDaddy. `redkiteaerial.co.uk` and
  `kiteaerial.uk` had no DNS records when checked. `astro.config.mjs` and
  `public/robots.txt` assume `kiteaerial.co.uk`.
- **Consent** — occupants are identifiable in `case-02-rear-elevation` and in
  the orbit video. Worth the owner's written OK.

---

## Decisions worth knowing about

**Astro `<Picture>` does the AVIF and WebP encoding, not the ingest script.**
Doing both to the same files would encode everything twice. The script writes a
cropped, graded master JPEG per frame into `src/images/derived/`, and
`<Picture>` produces the responsive AVIF and WebP variants from those at build
time. The script also writes standalone AVIF/WebP into `public/media/` for the
video poster and anything served outside Astro's asset pipeline.

**Widths are capped at each frame's native size.** `widthsFor()` filters the
candidate width list so Astro is never asked to upscale.

**One `.linear()` call in the grade.** sharp stores a single set of linear
coefficients, so calling `.linear()` twice silently replaces the first rather
than composing. The 16-bit rescale is folded into the same call as the contrast
lift. This is the bug that made 16-bit TIFFs come out black.

**The hero animation is additive only.** Frames are CSS-positioned at their
final coordinates; the keyframes animate `translate`, `scale` and `opacity` with
`animation-fill-mode: backwards`. Remove the animation — reduced motion, no CSS
animation support, a screenshot — and the settled cluster is exactly as it is.
Verified: slot positions are identical with and without. Nothing moves after
about 1.2 seconds. The cluster also sizes its pass to how many photographs
exist, so three frames get a three-frame diagonal, not a six-frame one with
holes in it.

**The video is not the LCP element.** `preload="none"`, poster frame, controls,
no autoplay. `verify.mjs` asserts all three on every page at build time.

---

## Performance

`npm run build` fails if a budget is missed or if reference imagery reaches
`dist/`. A budget nobody checks is a wish.

```
largest image  under 400KB
first load     under 1.5MB per page
video          preload="none", poster, no autoplay
```

First-load figures are a deliberate over-estimate: `verify.mjs` counts the JPEG
fallback at its largest width for every `<img>`. A real browser picks an AVIF at
the width it needs.

Fonts are self-hosted via `@fontsource-variable` with `unicode-range`
subsetting, so only the Latin blocks download. No Google Fonts request, no
analytics, no cookies, no consent banner, no client-side JavaScript.

## Stack

- Astro 7, static output
- sharp for ingest, `heic-convert` for iPhone files, ffmpeg for the video
- `@fontsource-variable/fraunces` (opsz axis), `inter-tight`, `jetbrains-mono`
- Netlify Forms for the enquiry form — static markup, no backend. Success page
  is `/enquiry-received`.
