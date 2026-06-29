# Exact changes

This documents precisely what [`apply-bandcamp-enhancements.mjs`](apply-bandcamp-enhancements.mjs)
does to the Upload Assistant script, and the existing code that already covers
requirements 2 and 3.

---

## 1. Bandcamp → FLAC / 24bit Lossless  (behavioural change — added)

### 1a. JSON / `tralbum` path in `bcParser`

**Before**

```js
				track_number: (tralbum.initial_track_num || 0) + (track.track_num || index + 1),
				total_tracks: releaseMeta != null && releaseMeta.numTracks ? releaseMeta.numTracks : tralbum.trackinfo.length,
				media: 'WEB',
				cover_url: imgUrl,
```

**After**

```js
				track_number: (tralbum.initial_track_num || 0) + (track.track_num || index + 1),
				total_tracks: releaseMeta != null && releaseMeta.numTracks ? releaseMeta.numTracks : tralbum.trackinfo.length,
				media: 'WEB',
				encoding: 'lossless',
				codec: 'FLAC',
				bitdepth: 24,
				cover_url: imgUrl,
```

### 1b. HTML fallback path in `bcParser`

**Before**

```js
				return Array.from(trs = response.document.querySelectorAll('table#track_table > tbody > tr.track_row_view'), tr => ({
					artist: isVA ? VA : undefined,
					artists: !isVA ? artist : undefined,
					album: album,
					//album_year: extractYear(releaseDate),
					release_date: releaseDate,
					label: label,
					media: media,
					genre: tags.toString(),
```

**After**

```js
				return Array.from(trs = response.document.querySelectorAll('table#track_table > tbody > tr.track_row_view'), tr => ({
					artist: isVA ? VA : undefined,
					artists: !isVA ? artist : undefined,
					album: album,
					//album_year: extractYear(releaseDate),
					release_date: releaseDate,
					label: label,
					media: media,
					encoding: 'lossless',
					codec: 'FLAC',
					bitdepth: 24,
					genre: tags.toString(),
```

### Why this is enough

In `parseTracks`, the form is filled from the aggregated release values:

```js
if (elementWritable(ref = formItem('format'))) {
	if (allowedFormats.includes(release.codec)) ref.value = release.codec; else ref.selectedIndex = 0;
	notifyChange(ref);                       // -> Format = FLAC
}
let encoding;
if (release.encoding == 'lossless') {
	if (release.bitdepths.includes(24)) encoding = '24bit Lossless';   // <-- matched
	else if (release.bitdepths.some(bitdepth => bitdepth > 0)) encoding = 'Lossless';
}
...
if ((ref = formItem('bitrate')) != null && !ref.disabled && (overwrite || !br_isSet)) {
	ref.value = encoding || '';              // -> Bitrate = 24bit Lossless
	notifyChange(ref);
}
```

`bitrateWhitelist('FLAC')` for non-CD media (`media: 'WEB'`) is `(?:24bit )?Lossless`,
so `24bit Lossless` is a valid option in the dropdown.

---

## 2. Cover auto-fetch + auto-upload  (already present — verified, not changed)

`bcParser` already sets the full-resolution cover (`_0`) on every track:

```js
if (releaseMeta != null && releaseMeta.image) imgUrl = releaseMeta.image.replace(/_\d+(?=\.\w+$)/, '_0');
...
cover_url: imgUrl,
```

`parseTracks` collects these into `release.coverUrls` and calls:

```js
if (elementWritable(i = findImageInput())) setCover(release.coverUrls[0]).then(...)
```

`setCover()` verifies the URL, previews it, checks the size, and — when
`prefs.auto_rehost_cover` is on (default) — re-hosts it via `imageHosts` and writes the
re-hosted URL into the *Image* field. No change required.

---

## 3. Bandcamp link in the torrent description  (already present — verified, not changed)

Every Bandcamp track carries its page URL:

```js
url: releaseMeta != null && releaseMeta.mainEntityOfPage ? releaseMeta.mainEntityOfPage : tralbum.url || response.finalUrl,
```

`parseTracks` aggregates these into `release.urls`, and the upload branch pushes them
into the release description:

```js
if (sourceUrl || release.urls.length > 0) rlsDesc.push(getReleaseUrls());
```

`getReleaseUrls()` renders each URL through `getLinkCode()`, which already maps Bandcamp:

```js
'bandcamp.com': ['https://ptpimg.me/vwki92.jpg', 'Bandcamp'],
```

So the description gets a `[url=…]Bandcamp[/url]` link to the album. No change required.

---

## Verification performed

- Applied both insertions against a fixture mirroring the two `bcParser` regions —
  correct anchors, correct (tab- or space-) indentation.
- `node --check` passes on the transformed output.
- Idempotent: re-running on an already-enhanced file produces an identical result.
- Fails safe: a file without the expected anchors errors clearly and writes nothing.
