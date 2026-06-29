# Exact changes

What [`apply-bandcamp-enhancements.mjs`](apply-bandcamp-enhancements.mjs) does to the
Upload Assistant script. Eight idempotent edits in total.

---

## 1. Bandcamp → FLAC / 24bit Lossless

### 1a. JSON / `tralbum` path in `bcParser`

```diff
 				total_tracks: releaseMeta != null && releaseMeta.numTracks ? releaseMeta.numTracks : tralbum.trackinfo.length,
 				media: 'WEB',
+				encoding: 'lossless',
+				codec: 'FLAC',
+				bitdepth: 24,
 				cover_url: imgUrl,
```

### 1b. HTML fallback path in `bcParser`

```diff
 				return Array.from(trs = response.document.querySelectorAll('table#track_table > tbody > tr.track_row_view'), tr => ({
 					...
 					media: media,
+					encoding: 'lossless',
+					codec: 'FLAC',
+					bitdepth: 24,
 					genre: tags.toString(),
```

**Why:** in `parseTracks`, `release.codec` → *Format = FLAC*, and
`release.encoding === 'lossless'` with `release.bitdepths.includes(24)` →
`encoding = '24bit Lossless'` → *Bitrate = 24bit Lossless*. `bitrateWhitelist('FLAC')`
for `media: 'WEB'` is `(?:24bit )?Lossless`, so the option is valid.

---

## 2. Cover rehost → ImgBB (with API key)

### 2a. RED rehost list

```diff
 	// rehost image hosts
-	isRED ? ['PTPimg'/*, 'Imgur'*/] : isNWCD ? ['NWCD'] : isDIC ? ['PTPimg', 'PixHost', 'PostImage']
+	isRED ? ['ImgBB', 'PTPimg'] : isNWCD ? ['NWCD'] : isDIC ? ['PTPimg', 'PixHost', 'PostImage']
 		: ['PTPimg', 'ImgBB', 'PixHost', 'PostImage'],
```

### 2b. ImgBB key via GM value (before the manager is constructed)

```diff
+// ImgBB API key for Bandcamp cover rehosting (added by apply-bandcamp-enhancements)
+GM_setValue('imgbb_api_key', '50b144a5dc7ea978a05d76002b79452f');
 var imageHosts = new ImageHostManager(
```

### 2c. ImgBB key on the live handler (after construction)

Inserted right after the `new ImageHostManager(...)` statement:

```js
/* imgbb-key-setup (added by apply-bandcamp-enhancements) */
try {
	if (typeof imageHostHandlers == 'object' && imageHostHandlers) for (let _h of ['imgbb', 'ImgBB'])
		if (imageHostHandlers[_h]) {
			imageHostHandlers[_h].apiKey = '50b144a5dc7ea978a05d76002b79452f';
			for (let _p of ['apikey', 'key', 'api_key'])
				if (_p in imageHostHandlers[_h]) imageHostHandlers[_h][_p] = '50b144a5dc7ea978a05d76002b79452f';
		}
} catch (_e) { console.warn('ImgBB key setup failed:', _e); }
```

**Why two ways:** the image-host library is minified and couldn't be fetched in this
environment, so the key is set via the standard GM value *and* directly on the live
`imageHostHandlers.imgbb` instance (the script already uses `imageHostHandlers.imgur` /
`.abload`, and `PTPimg` instances carry `.apiKey` — so `imgbb.apiKey` is the expected
shape). The `try/catch` guarantees it can never break page load.

---

## 3. Bandcamp link: RELEASE INFO → ALBUM INFO

### 3a. Append source/store links to the album description

```diff
+		if (sourceUrl || release.urls.length > 0) {
+			const _bcSourceLinks = getReleaseUrls();
+			if (_bcSourceLinks) description += (description ? '\n\n' : '') + _bcSourceLinks;
+		}
 		const finalizeDesc = elem => fetchOnlineAdditions().then(t => { description += '\n\n' + t }, reason => { }).then(function() {
 			if (description) elem.value += '\n\n' + description.trim();   // <-- writes album_desc
```

### 3b. Remove the links from the release description (RED path)

```diff
 			if (lineage.length > 0) rlsDesc.push(lineage);
 			finRlsDesc();
-			if (sourceUrl || release.urls.length > 0) rlsDesc.push(getReleaseUrls());
+			/* source/store links moved to ALBUM INFO (album_desc) */
```

### 3c. Remove the links from the `release_lineage` path (non-RED trackers)

```diff
 			finRlsDesc();
-			if (sourceUrl || release.urls.length > 0) lineage.push(getReleaseUrls());
+			/* source/store links moved to ALBUM INFO (album_desc) */
```

**Why:** `getReleaseUrls()` (= `release.urls` + store URLs, rendered via `getLinkCode()`,
which maps `bandcamp.com` → `Bandcamp`) is now appended to the `description` accumulator
that `finalizeDesc()` writes into `album_desc`, and removed from the `release_desc` /
`release_lineage` paths. For a Bandcamp upload that link is just the Bandcamp URL.

---

## Verification performed

- All eight edits applied against a fixture mirroring every anchor region (correct
  anchors, correct tab/space indentation).
- `node --check` passes on the transformed output.
- Idempotent: re-running on an already-enhanced file produces an identical result and
  skips all eight edits.
- Fails safe: a file without the expected anchors errors clearly and writes nothing.
