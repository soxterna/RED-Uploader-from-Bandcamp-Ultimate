#!/usr/bin/env node
/*
 * apply-bandcamp-enhancements.mjs
 * ---------------------------------------------------------------------------
 * Applies the Bandcamp-focused enhancements to Anakunda's
 * "[RED/OPS/DIC] Upload Assistant" userscript (v1.43x).
 *
 * It transforms YOUR trusted copy of the script in place of hand-editing it,
 * so every byte that should not change stays byte-for-byte identical.
 *
 * Enhancements
 *   1. Bandcamp releases are auto-selected as FLAC / "24bit Lossless" in the
 *      upload form. The Bandcamp parser does not report a codec/bit depth, so
 *      the form is left blank by default. We tag every Bandcamp track as
 *      lossless FLAC 24-bit, which makes the existing form-fill logic pick
 *      FLAC + 24bit Lossless automatically. (This is the only behavioural
 *      change; it is applied to both the JSON/`tralbum` path and the HTML
 *      fallback path of `bcParser`.)
 *
 *   2. The Bandcamp cover is auto-fetched at full resolution and auto-uploaded
 *      to your image host. This already works in the base script
 *      (`bcParser` sets `cover_url` to the `_0` original; `setCover()` then
 *      rehosts it when `auto_rehost_cover` is on). We only VERIFY it is present.
 *
 *   3. The Bandcamp release URL is auto-linked in the torrent (release)
 *      description. This already works in the base script (each track carries
 *      `url`, which feeds `release.urls`; `getReleaseUrls()` renders it via the
 *      `bandcamp.com` entry of `getLinkCode()` and pushes it into the release
 *      description). We only VERIFY it is present.
 *
 * Usage
 *   node apply-bandcamp-enhancements.mjs <input.user.js> [output.user.js]
 *
 * If <output.user.js> is omitted, "<input>.bandcamp.user.js" is written next
 * to the input. The script is idempotent: running it twice is a no-op for the
 * code change.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

let src = readFileSync(inPath, 'utf8');

// --- helpers ----------------------------------------------------------------

/** Replace exactly one occurrence; throw if the anchor is missing or ambiguous. */
function applyOnce(content, re, replacer, label) {
	if (re.global) throw new Error(`Internal error: anchor regex for "${label}" must not be global.`);
	let count = 0;
	const out = content.replace(re, (...args) => {
		count++;
		return replacer(...args);
	});
	if (count === 0) {
		throw new Error(
			`Could not locate the anchor for "${label}".\n` +
			`This file does not look like the expected Upload Assistant script ` +
			`(or the relevant section was renamed). No changes were written.`);
	}
	if (count > 1) {
		// Cannot happen with a non-global regex, but guard anyway.
		throw new Error(`Anchor for "${label}" matched ${count} times; aborting to avoid corruption.`);
	}
	return out;
}

/** Build the inserted FLAC-24bit property block, reusing the anchor's indentation. */
function flacBlock(indent) {
	return ['', "encoding: 'lossless',", "codec: 'FLAC',", 'bitdepth: 24,'].join('\n' + indent);
}

const changed = [];
const skipped = [];
const notes = [];

// --- Enhancement #1a: Bandcamp -> FLAC 24bit (JSON / `tralbum` path) ---------
//
// ...
//   total_tracks: releaseMeta != null && releaseMeta.numTracks ? ... : tralbum.trackinfo.length,
//   media: 'WEB',                <-- insert encoding/codec/bitdepth after this
//   cover_url: imgUrl,
//
{
	const alreadyRe =
		/media: 'WEB',\s*\n[ \t]*encoding: 'lossless',\s*\n[ \t]*codec: 'FLAC',\s*\n[ \t]*bitdepth: 24,/;
	if (alreadyRe.test(src)) {
		skipped.push("Bandcamp FLAC 24bit (JSON path) — already applied");
	} else {
		src = applyOnce(
			src,
			/(total_tracks: releaseMeta != null && releaseMeta\.numTracks[^\n]*\n)([ \t]*)(media: 'WEB',)/,
			(_m, head, indent, mediaLine) => head + indent + mediaLine + flacBlock(indent),
			'Bandcamp FLAC 24bit (JSON path)');
		changed.push("Bandcamp FLAC 24bit (JSON path)");
	}
}

// --- Enhancement #1b: Bandcamp -> FLAC 24bit (HTML fallback path) ------------
//
//   return Array.from(trs = ...querySelectorAll('table#track_table > tbody > tr.track_row_view'), tr => ({
//     artist: ...,
//     ...
//     media: media,             <-- insert encoding/codec/bitdepth after this
//     genre: tags.toString(),
//
{
	const alreadyRe =
		/track_row_view'\)[\s\S]{0,4000}?media: media,\s*\n[ \t]*encoding: 'lossless',/;
	if (alreadyRe.test(src)) {
		skipped.push("Bandcamp FLAC 24bit (HTML path) — already applied");
	} else {
		src = applyOnce(
			src,
			/(querySelectorAll\('table#track_table > tbody > tr\.track_row_view'\)[\s\S]*?\n)([ \t]*)(media: media,)/,
			(_m, head, indent, mediaLine) => head + indent + mediaLine + flacBlock(indent),
			'Bandcamp FLAC 24bit (HTML path)');
		changed.push("Bandcamp FLAC 24bit (HTML path)");
	}
}

// --- Enhancement #2 (verify): Bandcamp cover auto-fetch + auto-upload --------
{
	const coverOk =
		/cover_url: imgUrl,/.test(src) &&            // bcParser sets the cover
		/function setCover\(/.test(src) &&           // setCover() pipeline exists
		/auto_rehost_cover/.test(src);               // and auto-uploads it
	notes.push(`Cover auto-fetch + auto-upload from Bandcamp: ${coverOk ? 'present ✓' : 'NOT FOUND ✗'}`);
	if (!coverOk) {
		console.warn('WARNING: the Bandcamp cover pipeline was not found — the input may be ' +
			'a different version. The FLAC change (if any) was still applied.');
	}
}

// --- Enhancement #3 (verify): Bandcamp link in the torrent description -------
{
	const linkOk =
		/'bandcamp\.com': \[/.test(src) &&           // getLinkCode() knows bandcamp.com
		/function getReleaseUrls\(\)/.test(src) &&   // it is rendered here
		/getReleaseUrls\(\)/.test(src);              // ...and pushed into the description
	notes.push(`Bandcamp link auto-added to the torrent description: ${linkOk ? 'present ✓' : 'NOT FOUND ✗'}`);
	if (!linkOk) {
		console.warn('WARNING: the release-URL pipeline was not found — the input may be ' +
			'a different version.');
	}
}

// --- Validate the result parses before writing anything ----------------------
{
	const tmp = join(tmpdir(), `ua-bandcamp-check-${process.pid}.js`);
	writeFileSync(tmp, src);
	try {
		execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
	} catch (e) {
		const detail = e.stderr ? e.stderr.toString() : e.message;
		console.error('Syntax check FAILED on the transformed output — refusing to write it:\n' + detail);
		process.exit(2);
	}
}

// --- Write output ------------------------------------------------------------
const outPath = outPathArg || inPath.replace(/(\.user)?\.js$/i, '') + '.bandcamp.user.js';
writeFileSync(outPath, src);

// --- Report ------------------------------------------------------------------
console.log(`\nBandcamp enhancements applied → ${outPath}\n`);
if (changed.length) console.log('Changed:\n' + changed.map(s => '  + ' + s).join('\n'));
if (skipped.length) console.log('Skipped (idempotent):\n' + skipped.map(s => '  = ' + s).join('\n'));
console.log('\nVerified base behaviours:\n' + notes.map(s => '  • ' + s).join('\n'));
console.log('\nDone. Install the output file in Tampermonkey/Violentmonkey to use it.');
