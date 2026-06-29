# RED Uploader — Bandcamp enhancements

Bandcamp-focused tweaks for Anakunda's **[RED/OPS/DIC] Upload Assistant** userscript
(`greasyfork.org/scripts/389583`). When you fill an upload form from a Bandcamp
album link, the script now:

1. **Auto-selects the correct FLAC** — every Bandcamp release is tagged as
   **FLAC / `24bit Lossless`**, so the upload form's *Format* and *Bitrate*
   dropdowns are filled automatically.
2. **Re-hosts the Bandcamp cover to ImgBB** — the full-resolution album art is
   fetched and uploaded to **ImgBB** using your API key, then dropped into the
   *Image* field. (RED's rehost target is switched to ImgBB, with PTPimg kept as a
   fallback.)
3. **Auto-links the Bandcamp page in ALBUM INFO** — the source/store link is placed
   in the **album description** (`album_desc`) instead of the **release description**
   (`release_desc`).

See [`CHANGES.md`](CHANGES.md) for the exact, line-level diff of every edit.

## Why a transformer instead of a committed `.user.js`?

The upstream script is ~6,000 lines of third-party code. This environment's egress
policy blocks `greasyfork.org` (and the `@require`d libraries on `openuserjs.org`), so
the pristine source couldn't be fetched here, and hand-retyping it would risk silently
corrupting the 99% that must not change.

Instead, [`apply-bandcamp-enhancements.mjs`](apply-bandcamp-enhancements.mjs)
transforms **your own trusted copy** of the script: every unchanged byte stays
byte-for-byte identical, each change is applied at a verified anchor, and the result is
validated with `node --check` before anything is written.

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

The transformer is **idempotent** (re-running changes nothing) and **fails safe** (if it
can't find the expected code, it prints a clear message and writes nothing).

## What each enhancement does

### 1. FLAC 24bit

`bcParser` (the Bandcamp parser) reports no codec or bit depth, so the form is left
blank. The transformer adds three properties to every Bandcamp track — in both the
JSON/`tralbum` path and the HTML fallback path:

```js
media: 'WEB',
encoding: 'lossless',   // <-- added
codec: 'FLAC',          // <-- added
bitdepth: 24,           // <-- added
```

The existing form-fill logic then sets **Format = FLAC** and **Bitrate = `24bit
Lossless`** (`if (release.bitdepths.includes(24)) encoding = '24bit Lossless'`). For
`media: 'WEB'` the FLAC bitrate whitelist is `(?:24bit )?Lossless`, so it's selectable.

### 2. Cover → ImgBB

Two changes:

- RED's rehost list `['PTPimg']` becomes `['ImgBB', 'PTPimg']` (ImgBB first, PTPimg
  fallback).
- Your ImgBB API key is supplied to the ImgBB handler **two ways** for robustness
  against the minified library's internals:
  1. `GM_setValue('imgbb_api_key', '<key>')` (persisted; picked up by the handler), and
  2. directly on the live handler: `imageHostHandlers.imgbb.apiKey = '<key>'` (also
     trying `ImgBB` / `apikey` / `key` / `api_key` as fallbacks), wrapped in a
     `try/catch` so it can never break page load.

> **Note:** the ImgBB key you provided is embedded in the transformer and in its output
> file. ImgBB keys only grant image uploads, but treat the file accordingly. To use a
> different key, change `IMGBB_API_KEY` at the top of the transformer and re-run.
>
> Want **ImgBB only** (no PTPimg fallback)? Change the rehost list to `['ImgBB']` in the
> output, or edit the `RED rehost list` replacement in the transformer.

### 3. Bandcamp link → ALBUM INFO

The source/store links were pushed into the **release** description:

```js
if (sourceUrl || release.urls.length > 0) rlsDesc.push(getReleaseUrls());   // RELEASE INFO
```

That push (and the analogous `release_lineage` one for non-RED trackers) is removed, and
the links are instead appended to the **album** description accumulator just before it's
written:

```js
if (sourceUrl || release.urls.length > 0) {
	const _bcSourceLinks = getReleaseUrls();
	if (_bcSourceLinks) description += (description ? '\n\n' : '') + _bcSourceLinks;
}
const finalizeDesc = elem => fetchOnlineAdditions()... // appends `description` to album_desc
```

For a Bandcamp upload, `getReleaseUrls()` is exactly the `[url=…]Bandcamp[/url]` link, so
it lands in **ALBUM INFO**.

## Notes / caveats

- Tagging Bandcamp rips as **24-bit** is a deliberate convention for this workflow, not a
  claim about the source files (Bandcamp FLAC is frequently 16-bit). Change `bitdepth` in
  the transformer if your convention differs.
- The link move is general: any source/store link (`getReleaseUrls()`) now goes to ALBUM
  INFO, not just Bandcamp. For Bandcamp uploads that link *is* just the Bandcamp URL.
- Sample rate is intentionally left unset (Bandcamp doesn't expose it reliably).
