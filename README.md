# RED Uploader — Bandcamp enhancements

Bandcamp-focused tweaks for Anakunda's **[RED/OPS/DIC] Upload Assistant** userscript
(`greasyfork.org/scripts/389583`). When you fill an upload form from a Bandcamp album
link, the script now:

1. **Auto-selects the correct FLAC** — Bandcamp releases are tagged **FLAC / `24bit
   Lossless`**, so the *Format* and *Bitrate* dropdowns fill automatically.
2. **Initial year = edition year** — the *initial/original year* defaults to the
   *edition (release) year* when no separate original year is known. A 2018 Bandcamp
   release fills **2018** in both year fields.
3. **Bandcamp link in BOTH descriptions** — the link appears in **ALBUM INFO**
   (`album_desc`) *and* **RELEASE INFO** (`release_desc`), each prefixed with the text
   **`Release info:`**.
4. **Cover → ImgBB (reliable)** — the cover is uploaded to **ImgBB** with your API key
   via a small, self-contained uploader (see "About the cover fix" below).

These are produced by a transformer you run on **your own** copy of the script. See
[`CHANGES.md`](CHANGES.md) for the exact, line-level diff.

---

## Installing / running it

You only need to run one command. Pick whichever is easier:

### Option A — no install (recommended on macOS): Perl

macOS already ships Perl, so nothing to install:

```sh
cd ~/Downloads/scripts/RED          # wherever the files are
perl apply-bandcamp-enhancements.pl "[RED-OPS-DIC] Upload Assistant-1.431.js"
```

That writes `…-1.431.bandcamp.user.js` next to the input.

### Option B — Node.js

If you'd rather use Node (`zsh: command not found: node` just means it isn't
installed):

- **Easiest:** download the macOS installer from <https://nodejs.org> (the "LTS"
  `.pkg`), double-click it, finish the installer, then **open a new Terminal window**
  and run:

  ```sh
  node apply-bandcamp-enhancements.mjs "[RED-OPS-DIC] Upload Assistant-1.431.js"
  ```

- **Or with Homebrew** (if you have it): `brew install node`, then run the same command.

Both options produce a **byte-identical** result.

### Then

Open the **output** file (`…bandcamp.user.js`) and install/replace it in Tampermonkey or
Violentmonkey.

> Always run the transformer on your **pristine v1.431 script**, not on a file you've
> already transformed. It's idempotent and fails safe (clear error + nothing written if
> it can't find the expected code), but the original is the intended input.

---

## About the cover fix (why pictures weren't uploading)

The first attempt set RED's rehost target to ImgBB and tried to hand the key to the
image-host **library's** ImgBB handler. That library is **minified** and couldn't be
fetched in the build environment, so that wiring was a guess — and worse, switching the
rehost list could break the PTPimg path that may have been working, leaving nothing that
succeeds. Result: covers didn't upload.

The fix stops depending on the library's internals. It overrides the two entry points
the script uses (`imageHosts.rehostImages` / `imageHosts.uploadImages`) with a tiny
uploader that **POSTs directly to the public ImgBB API** with your key and returns the
hosted URL. It handles http(s) URLs (Bandcamp covers), `data:` URIs (downsized covers),
and local files (drag-and-drop), and is wrapped so a failure never breaks page load. So
every cover/image path now goes to ImgBB.

> The ImgBB key is embedded in the transformer and its output. ImgBB keys only grant
> image uploads. To change it, edit `IMGBB_API_KEY` (`.mjs`) / `$KEY` (`.pl`) and re-run.

---

## Notes / caveats

- **Initial year:** it defaults to the edition year only when the original year is
  *unknown* (`album_year || releaseYear`). It won't overwrite a genuinely different
  original year (e.g. a reissue). For Bandcamp the original year is usually unset, so
  both fields end up the same.
- Tagging Bandcamp rips as **24-bit** is a convention for this workflow, not a claim
  about the files (Bandcamp FLAC is often 16-bit). Change `bitdepth` if needed.
- The link move is general: any source/store link (`getReleaseUrls()`) is what's shown in
  both descriptions. For Bandcamp that link is just the Bandcamp URL.
