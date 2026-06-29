#!/usr/bin/env node
/*
 * apply-bandcamp-enhancements.mjs
 * ---------------------------------------------------------------------------
 * Applies the Bandcamp-focused enhancements to Anakunda's
 * "[RED/OPS/DIC] Upload Assistant" userscript (v1.43x).
 *
 * It transforms YOUR trusted copy of the script instead of hand-editing it, so
 * every byte that should not change stays byte-for-byte identical. It is
 * idempotent and refuses to write anything if it can't find an expected anchor
 * or if the result doesn't parse.
 *
 * Enhancements
 *   1. FLAC 24bit  — every Bandcamp track is tagged lossless FLAC 24-bit, so the
 *      upload form auto-selects Format = FLAC and Bitrate = "24bit Lossless".
 *      (Two insertions in bcParser: JSON/`tralbum` path + HTML fallback path.)
 *
 *   2. Cover -> ImgBB — the Bandcamp cover is re-hosted to ImgBB using your API
 *      key. RED's rehost list is switched to ImgBB (PTPimg kept as a fallback),
 *      and the key is provided to the ImgBB handler two ways for robustness:
 *      via the `imgbb_api_key` GM value and directly on the live
 *      `imageHostHandlers.imgbb` handler.
 *
 *   3. Bandcamp link -> ALBUM INFO — the source/store link block is moved out of
 *      the release description (RELEASE INFO / `release_desc`) and into the album
 *      description (ALBUM INFO / `album_desc`).
 *
 * Usage
 *   node apply-bandcamp-enhancements.mjs <input.user.js> [output.user.js]
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMGBB_API_KEY = '50b144a5dc7ea978a05d76002b79452f';

const [, , inPath, outPathArg] = process.argv;
if (!inPath || inPath === '-h' || inPath === '--help') {
	console.error('Usage: node apply-bandcamp-enhancements.mjs <input.user.js> [output.user.js]');
	process.exit(inPath ? 0 : 1);
}

// Fail with a clean, single-line message instead of a stack trace.
process.on('uncaughtException', (e) => {
	console.error('Error: ' + (e && e.message ? e.message : e));
	process.exit(1);
});

// --- helpers ----------------------------------------------------------------

/** Replace exactly one occurrence; throw if the anchor is missing or ambiguous. */
function applyOnce(content, re, replacer, label) {
	if (re.global) throw new Error(`Internal error: anchor regex for "${label}" must not be global.`);
	let count = 0;
	const out = content.replace(re, (...args) => { count++; return replacer(...args); });
	if (count === 0) {
		throw new Error(
			`Could not locate the anchor for "${label}".\n` +
			`This file does not look like the expected Upload Assistant script ` +
			`(or that section was renamed). Nothing was written.`);
	}
	if (count > 1) throw new Error(`Anchor for "${label}" matched ${count} times; aborting to avoid corruption.`);
	return out;
}

/** Build the FLAC-24bit property block, reusing the anchor's indentation. */
function flacBlock(indent) {
	return ['', "encoding: 'lossless',", "codec: 'FLAC',", 'bitdepth: 24,'].join('\n' + indent);
}

// --- edits ------------------------------------------------------------------
// Each edit is idempotent: `done(src)` short-circuits if it's already applied.

const edits = [
	// ----- 1. Bandcamp -> FLAC 24bit --------------------------------------
	{
		name: 'FLAC 24bit (JSON / tralbum path)',
		done: s => /media: 'WEB',\s*\n[ \t]*encoding: 'lossless',\s*\n[ \t]*codec: 'FLAC',\s*\n[ \t]*bitdepth: 24,/.test(s),
		apply: s => applyOnce(s,
			/(total_tracks: releaseMeta != null && releaseMeta\.numTracks[^\n]*\n)([ \t]*)(media: 'WEB',)/,
			(_m, head, indent, mediaLine) => head + indent + mediaLine + flacBlock(indent),
			'FLAC 24bit (JSON / tralbum path)'),
	},
	{
		name: 'FLAC 24bit (HTML fallback path)',
		done: s => /track_row_view'\)[\s\S]{0,4000}?media: media,\s*\n[ \t]*encoding: 'lossless',/.test(s),
		apply: s => applyOnce(s,
			/(querySelectorAll\('table#track_table > tbody > tr\.track_row_view'\)[\s\S]*?\n)([ \t]*)(media: media,)/,
			(_m, head, indent, mediaLine) => head + indent + mediaLine + flacBlock(indent),
			'FLAC 24bit (HTML fallback path)'),
	},

	// ----- 2. Cover rehost target -> ImgBB (with API key) -----------------
	{
		name: "RED rehost list -> ['ImgBB', 'PTPimg']",
		done: s => /isRED \? \['ImgBB', 'PTPimg'\]/.test(s),
		apply: s => applyOnce(s,
			/isRED \? \['PTPimg'\/\*, 'Imgur'\*\/\] :/,
			() => "isRED ? ['ImgBB', 'PTPimg'] :",
			"RED rehost list -> ['ImgBB', 'PTPimg']"),
	},
	{
		name: 'ImgBB key via GM value',
		done: s => /GM_setValue\('imgbb_api_key'/.test(s),
		apply: s => applyOnce(s,
			/var imageHosts = new ImageHostManager\(/,
			() =>
				"// ImgBB API key for Bandcamp cover rehosting (added by apply-bandcamp-enhancements)\n" +
				"GM_setValue('imgbb_api_key', '" + IMGBB_API_KEY + "');\n" +
				"var imageHosts = new ImageHostManager(",
			'ImgBB key via GM value'),
	},
	{
		name: 'ImgBB key on live handler',
		done: s => /imgbb-key-setup/.test(s),
		apply: s => applyOnce(s,
			/(: \['PTPimg', 'ImgBB', 'PixHost', 'PostImage'\],\s*\n\);)/,
			(_m, ctorEnd) => ctorEnd + '\n\n' +
				"/* imgbb-key-setup (added by apply-bandcamp-enhancements) */\n" +
				"try {\n" +
				"\tif (typeof imageHostHandlers == 'object' && imageHostHandlers) for (let _h of ['imgbb', 'ImgBB'])\n" +
				"\t\tif (imageHostHandlers[_h]) {\n" +
				"\t\t\timageHostHandlers[_h].apiKey = '" + IMGBB_API_KEY + "';\n" +
				"\t\t\tfor (let _p of ['apikey', 'key', 'api_key'])\n" +
				"\t\t\t\tif (_p in imageHostHandlers[_h]) imageHostHandlers[_h][_p] = '" + IMGBB_API_KEY + "';\n" +
				"\t\t}\n" +
				"} catch (_e) { console.warn('ImgBB key setup failed:', _e); }",
			'ImgBB key on live handler'),
	},

	// ----- 3. Bandcamp link: RELEASE INFO -> ALBUM INFO -------------------
	{
		// Add the source/store links to the album description accumulator.
		name: 'Source links -> ALBUM INFO (album_desc)',
		done: s => /_bcSourceLinks/.test(s),
		apply: s => applyOnce(s,
			/(\n)([ \t]*)(const finalizeDesc = elem => fetchOnlineAdditions\(\))/,
			(_m, nl, indent, token) => nl +
				indent + "if (sourceUrl || release.urls.length > 0) {\n" +
				indent + "\tconst _bcSourceLinks = getReleaseUrls();\n" +
				indent + "\tif (_bcSourceLinks) description += (description ? '\\n\\n' : '') + _bcSourceLinks;\n" +
				indent + "}\n" +
				indent + token,
			'Source links -> ALBUM INFO (album_desc)'),
	},
	{
		// Remove the source links from the RELEASE INFO (release_desc) path.
		name: 'Drop source links from release_desc',
		done: s => !/rlsDesc\.push\(getReleaseUrls\(\)\)/.test(s),
		apply: s => applyOnce(s,
			/([ \t]*)if \(sourceUrl \|\| release\.urls\.length > 0\) rlsDesc\.push\(getReleaseUrls\(\)\);/,
			(_m, indent) => indent + '/* source/store links moved to ALBUM INFO (album_desc) */',
			'Drop source links from release_desc'),
	},
	{
		// Remove the source links from the release_lineage path (non-RED trackers).
		name: 'Drop source links from release_lineage',
		done: s => !/lineage\.push\(getReleaseUrls\(\)\)/.test(s),
		apply: s => applyOnce(s,
			/([ \t]*)if \(sourceUrl \|\| release\.urls\.length > 0\) lineage\.push\(getReleaseUrls\(\)\);/,
			(_m, indent) => indent + '/* source/store links moved to ALBUM INFO (album_desc) */',
			'Drop source links from release_lineage'),
	},
];

// --- run --------------------------------------------------------------------

let src = readFileSync(inPath, 'utf8');
const changed = [];
const skipped = [];

for (const edit of edits) {
	if (edit.done(src)) {
		skipped.push(edit.name);
	} else {
		src = edit.apply(src);
		changed.push(edit.name);
	}
}

// --- verify base behaviours we rely on but don't modify ---------------------
const notes = [];
notes.push(`Bandcamp cover is fetched + rehosted: ${
	/cover_url: imgUrl,/.test(src) && /function setCover\(/.test(src) && /auto_rehost_cover/.test(src)
		? 'present ✓' : 'NOT FOUND ✗'}`);
notes.push(`getLinkCode() knows bandcamp.com: ${/'bandcamp\.com': \[/.test(src) ? 'present ✓' : 'NOT FOUND ✗'}`);

// --- validate the result parses before writing anything ---------------------
{
	const tmp = join(tmpdir(), `ua-bandcamp-check-${process.pid}.js`);
	writeFileSync(tmp, src);
	try {
		execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
	} catch (e) {
		console.error('Syntax check FAILED on the transformed output — refusing to write it:\n' +
			(e.stderr ? e.stderr.toString() : e.message));
		process.exit(2);
	}
}

// --- write output -----------------------------------------------------------
const outPath = outPathArg || inPath.replace(/(\.user)?\.js$/i, '') + '.bandcamp.user.js';
writeFileSync(outPath, src);

// --- report -----------------------------------------------------------------
console.log(`\nBandcamp enhancements applied → ${outPath}\n`);
if (changed.length) console.log('Changed:\n' + changed.map(s => '  + ' + s).join('\n'));
if (skipped.length) console.log('Skipped (idempotent):\n' + skipped.map(s => '  = ' + s).join('\n'));
console.log('\nVerified base behaviours:\n' + notes.map(s => '  • ' + s).join('\n'));
console.log('\nDone. Install the output file in Tampermonkey/Violentmonkey to use it.');
