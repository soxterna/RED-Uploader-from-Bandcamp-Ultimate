# RED Uploader — Bandcamp enhancements

Bandcamp-focused tweaks for Anakunda's **[RED/OPS/DIC] Upload Assistant** userscript
(`greasyfork.org/scripts/389583`). When you fill an upload form from a Bandcamp
album link, the script now:

1. **Auto-selects the correct FLAC** — every Bandcamp release is tagged as
   **FLAC / `24bit Lossless`**, so the upload form's *Format* and *Bitrate*
   dropdowns are filled automatically.
2. **Auto-uploads the Bandcamp cover** — the full-resolution album art is fetched
   and re-hosted to your image host, then dropped into the *Image* field.
3. **Auto-links the Bandcamp page** in the torrent (release) description.

> Items **2** and **3** already work in the upstream script; this repo only adds
> item **1** and *verifies* that 2 and 3 are present. See [`CHANGES.md`](CHANGES.md)
> for the exact code diff.

## Why a transformer instead of a committed `.user.js`?

The upstream script is ~6,000 lines of third-party code. This environment's egress
policy blocks `greasyfork.org`, so the pristine source couldn't be fetched here,
and hand-retyping it risks silently corrupting the 99% that must not change.

Instead, [`apply-bandcamp-enhancements.mjs`](apply-bandcamp-enhancements.mjs)
transforms **your own trusted copy** of the script: every unchanged byte stays
byte-for-byte identical, the change is applied at a verified anchor, and the result
is validated with `node --check` before anything is written.

## Usage

Requirements: Node.js (tested on v22).

```bash
# 1. Save your current Upload Assistant script, e.g. "Upload Assistant.user.js"
# 2. Run the transformer:
node apply-bandcamp-enhancements.mjs "Upload Assistant.user.js"
#    -> writes "Upload Assistant.bandcamp.user.js"

# Optional explicit output path:
node apply-bandcamp-enhancements.mjs input.user.js output.user.js
```

Then install/replace the **output** file in Tampermonkey or Violentmonkey.

The transformer is **idempotent** — running it on an already-enhanced file makes no
further changes — and **fails safely**: if it can't find the expected code (e.g. a
very different script version), it prints a clear message and writes nothing.

## How it works (item 1)

`bcParser` (the Bandcamp parser) doesn't report a codec or bit depth, so the form is
left blank. The transformer adds three properties to every Bandcamp track object — in
both the JSON/`tralbum` path and the HTML fallback path:

```js
media: 'WEB',
encoding: 'lossless',   // <-- added
codec: 'FLAC',          // <-- added
bitdepth: 24,           // <-- added
```

Downstream, the existing form-fill logic then:

- sets **Format = FLAC** (from `release.codec`), and
- sets **Bitrate = `24bit Lossless`** because `release.encoding === 'lossless'` and
  `release.bitdepths` includes `24`
  (`if (release.bitdepths.includes(24)) encoding = '24bit Lossless'`).

For `media: 'WEB'`, the form's bitrate whitelist for FLAC is `(?:24bit )?Lossless`, so
`24bit Lossless` is a valid, selectable option.

## Notes / caveats

- Tagging Bandcamp rips as **24-bit** is a deliberate convention for this workflow, not
  a claim about the source files (Bandcamp FLAC is frequently 16-bit). Adjust the
  `bitdepth` value in the transformer if your convention differs.
- Sample rate is intentionally left unset (Bandcamp doesn't expose it reliably); the
  release description simply omits it.
- The cover is re-hosted only when `auto_rehost_cover` is enabled in the script's prefs
  (the default), which requires your image-host (e.g. PTPimg) key to be configured.
