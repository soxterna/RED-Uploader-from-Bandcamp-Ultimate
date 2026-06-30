# Exact changes

What the transformer (`apply-bandcamp-enhancements.mjs` / `.pl`, identical output) does to
the Upload Assistant script. Seven idempotent edits.

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
 					media: media,
+					encoding: 'lossless',
+					codec: 'FLAC',
+					bitdepth: 24,
 					genre: tags.toString(),
```

`release.codec` → *Format = FLAC*; `release.encoding === 'lossless'` with
`release.bitdepths.includes(24)` → `encoding = '24bit Lossless'` → *Bitrate = 24bit
Lossless*.

---

## 2. Initial year defaults to the edition year

```diff
-			if (elementWritable(ref = formItem('year'))) ref.value = release.album_year || '';
+			if (elementWritable(ref = formItem('year'))) ref.value = release.album_year || releaseYear || '';
```

`year` (initial) falls back to `releaseYear` — the same value used for `remaster_year`
(edition) — when the original year is unknown. A 2018 Bandcamp release fills 2018 in both.

---

## 3. Bandcamp link in ALBUM INFO **and** RELEASE INFO, labelled "Release info:"

### 3a. Append to the album description (ALBUM INFO / `album_desc`)

```diff
+		if (sourceUrl || release.urls.length > 0) {
+			const _bcSourceLinks = getReleaseUrls();
+			if (_bcSourceLinks) description += (description ? '\n\n' : '') + 'Release info:\n' + _bcSourceLinks;
+		}
 		const finalizeDesc = elem => fetchOnlineAdditions().then(t => { description += '\n\n' + t }, reason => { }).then(function() {
 			if (description) elem.value += '\n\n' + description.trim();   // writes album_desc
```

### 3b. Keep it in the release description (RELEASE INFO / `release_desc`), with the label

```diff
-			if (sourceUrl || release.urls.length > 0) rlsDesc.push(getReleaseUrls());
+			if (sourceUrl || release.urls.length > 0) rlsDesc.push('Release info:\n' + getReleaseUrls());
```

### 3c. Same for the `release_lineage` path (non-RED trackers)

```diff
-			if (sourceUrl || release.urls.length > 0) lineage.push(getReleaseUrls());
+			if (sourceUrl || release.urls.length > 0) lineage.push('Release info:\n' + getReleaseUrls());
```

`getReleaseUrls()` renders `release.urls` + store URLs via `getLinkCode()` (which maps
`bandcamp.com` → `Bandcamp`). For a Bandcamp upload that is the Bandcamp link, now shown in
both descriptions under a `Release info:` heading.

---

## 4. Cover rehost → ImgBB (robust; fixes "pictures not uploading")

Injected right after `var imageHosts = new ImageHostManager(...)`:

```js
/* imgbb-rehost-override (added by apply-bandcamp-enhancements) */
(function() {
	const IMGBB_KEY = '50b144a5dc7ea978a05d76002b79452f';
	function _imgbbParam(item) {
		if (typeof item == 'string')
			return Promise.resolve(/^data:/.test(item) ? item.replace(/^data:[^,]*,/, '') : item);
		if (item instanceof Blob) return new Promise(function(resolve, reject) {
			const fr = new FileReader;
			fr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));
			fr.onerror = () => reject('ImgBB: file read error');
			fr.readAsDataURL(item);
		});
		return Promise.reject('ImgBB: unsupported image input');
	}
	function _imgbbUpload(item) {
		return _imgbbParam(item).then(image => new Promise(function(resolve, reject) {
			GM_xmlhttpRequest({
				method: 'POST',
				url: 'https://api.imgbb.com/1/upload?key=' + encodeURIComponent(IMGBB_KEY),
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				data: 'image=' + encodeURIComponent(image),
				responseType: 'json',
				onload: function(r) {
					let j = r.response;
					if (typeof j != 'object' || j == null) try { j = JSON.parse(r.responseText) } catch (e) { }
					if (j && j.success && j.data && (j.data.url || j.data.display_url)) {
						const u = j.data.url || j.data.display_url;
						resolve({ original: u, thumb: (j.data.thumb && j.data.thumb.url) || u });
					} else reject('ImgBB: ' + ((j && j.error && j.error.message) || ('HTTP ' + r.status)));
				},
				onerror: () => reject('ImgBB: network error'),
				ontimeout: () => reject('ImgBB: timeout'),
			});
		}));
	}
	if (typeof imageHosts == 'object' && imageHosts) {
		imageHosts.rehostImages = (items) => Promise.all((items || []).map(_imgbbUpload));
		imageHosts.uploadImages = (items) => Promise.all((items || []).map(_imgbbUpload));
	}
})();
```

**Why an override:** `setCover()` (auto cover), `inputDataHandler` (drag a cover into the
Image field) and `textAreaDropHandler` (images in descriptions) all go through
`imageHosts.rehostImages` / `imageHosts.uploadImages`. Overriding those two routes every
image path through a direct ImgBB API call — no dependency on the minified library's ImgBB
handler, key storage, or rehost-list. The returned `{ original, thumb }` shape matches what
the script's `singleImageGetter` / `urlHandler` already consume. This replaces the earlier,
fragile approach (rehost-list swap + GM value + poking `imageHostHandlers.imgbb`).

---

## Verification performed

- All seven edits applied against a fixture mirroring every anchor region.
- The Perl output is **byte-identical** to the Node output.
- `node --check` passes on both outputs.
- Idempotent: re-running skips all seven and yields an identical file.
- Fails safe: missing anchors → clear error, nothing written.
