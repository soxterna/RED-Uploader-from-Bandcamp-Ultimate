#!/usr/bin/env node
/*
 * apply-bandcamp-enhancements.mjs
 * ---------------------------------------------------------------------------
 * Applies the Bandcamp-focused enhancements to Anakunda's
 * "[RED/OPS/DIC] Upload Assistant" userscript (v1.43x).
 *
 * Run it on YOUR pristine copy of the script. It edits at verified anchors,
 * keeps every other byte identical, is idempotent, and refuses to write if an
 * anchor is missing or the result doesn't parse.
 *
 * Enhancements
 *   1. FLAC 24bit — Bandcamp tracks are tagged lossless FLAC 24-bit, so the
 *      form auto-selects Format = FLAC and Bitrate = "24bit Lossless".
 *   2. Initial year = edition year — the initial/original year defaults to the
 *      edition (release) year when no separate original year is known (so a
 *      2018 Bandcamp release fills 2018 in both year fields).
 *   3. Bandcamp link in BOTH places — the source link is shown in the album
 *      description (ALBUM INFO) AND the release description (RELEASE INFO), each
 *      prefixed with the text "Release info:".
 *   4. Cover -> ImgBB (robust) — imageHosts.rehostImages / uploadImages are
 *      overridden with a small, self-contained ImgBB uploader that posts to the
 *      public ImgBB API with your key. This does not depend on the (minified)
 *      image-host library's internals, which is why covers now upload reliably.
 *
 * Usage
 *   node apply-bandcamp-enhancements.mjs <input.user.js> [output.user.js]
 *
 * (No Node? Use the Perl version: `perl apply-bandcamp-enhancements.pl <input>`,
 *  which produces an identical result and needs no install on macOS.)
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
process.on('uncaughtException', (e) => {
	console.error('Error: ' + (e && e.message ? e.message : e));
	process.exit(1);
});

// --- helpers ----------------------------------------------------------------

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

function flacBlock(indent) {
	return ['', "encoding: 'lossless',", "codec: 'FLAC',", 'bitdepth: 24,'].join('\n' + indent);
}

// Self-contained ImgBB uploader, injected right after `new ImageHostManager(...)`.
const imgbbOverride = [
	'/* imgbb-rehost-override (added by apply-bandcamp-enhancements) */',
	'(function() {',
	"\tconst IMGBB_KEY = '" + IMGBB_API_KEY + "';",
	'\tfunction _imgbbParam(item) {',
	"\t\tif (typeof item == 'string')",
	"\t\t\treturn Promise.resolve(/^data:/.test(item) ? item.replace(/^data:[^,]*,/, '') : item);",
	'\t\tif (item instanceof Blob) return new Promise(function(resolve, reject) {',
	'\t\t\tconst fr = new FileReader;',
	"\t\t\tfr.onload = () => resolve(String(fr.result).replace(/^data:[^,]*,/, ''));",
	"\t\t\tfr.onerror = () => reject('ImgBB: file read error');",
	'\t\t\tfr.readAsDataURL(item);',
	'\t\t});',
	"\t\treturn Promise.reject('ImgBB: unsupported image input');",
	'\t}',
	'\tfunction _imgbbUpload(item) {',
	'\t\treturn _imgbbParam(item).then(image => new Promise(function(resolve, reject) {',
	'\t\t\tGM_xmlhttpRequest({',
	"\t\t\t\tmethod: 'POST',",
	"\t\t\t\turl: 'https://api.imgbb.com/1/upload?key=' + encodeURIComponent(IMGBB_KEY),",
	"\t\t\t\theaders: { 'Content-Type': 'application/x-www-form-urlencoded' },",
	"\t\t\t\tdata: 'image=' + encodeURIComponent(image),",
	"\t\t\t\tresponseType: 'json',",
	'\t\t\t\tonload: function(r) {',
	'\t\t\t\t\tlet j = r.response;',
	"\t\t\t\t\tif (typeof j != 'object' || j == null) try { j = JSON.parse(r.responseText) } catch (e) { }",
	'\t\t\t\t\tif (j && j.success && j.data && (j.data.url || j.data.display_url)) {',
	'\t\t\t\t\t\tconst u = j.data.url || j.data.display_url;',
	'\t\t\t\t\t\tresolve({ original: u, thumb: (j.data.thumb && j.data.thumb.url) || u });',
	"\t\t\t\t\t} else reject('ImgBB: ' + ((j && j.error && j.error.message) || ('HTTP ' + r.status)));",
	'\t\t\t\t},',
	"\t\t\t\tonerror: () => reject('ImgBB: network error'),",
	"\t\t\t\tontimeout: () => reject('ImgBB: timeout'),",
	'\t\t\t});',
	'\t\t}));',
	'\t}',
	"\tif (typeof imageHosts == 'object' && imageHosts) {",
	'\t\timageHosts.rehostImages = (items) => Promise.all((items || []).map(_imgbbUpload));',
	'\t\timageHosts.uploadImages = (items) => Promise.all((items || []).map(_imgbbUpload));',
	'\t}',
	'})();',
].join('\n');

// --- edits (each is idempotent via `done`) ----------------------------------

const edits = [
	// 1. Bandcamp -> FLAC 24bit (both parser paths)
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

	// 2. Initial year defaults to the edition year
	{
		name: 'Initial year defaults to edition year',
		done: s => /ref\.value = release\.album_year \|\| releaseYear \|\| '';/.test(s),
		apply: s => applyOnce(s,
			/ref\.value = release\.album_year \|\| '';/,
			() => "ref.value = release.album_year || releaseYear || '';",
			'Initial year defaults to edition year'),
	},

	// 3. Bandcamp link -> ALBUM INFO and RELEASE INFO, labelled "Release info:"
	{
		name: 'Link + "Release info:" -> ALBUM INFO (album_desc)',
		done: s => /_bcSourceLinks/.test(s),
		apply: s => applyOnce(s,
			/(\n)([ \t]*)(const finalizeDesc = elem => fetchOnlineAdditions\(\))/,
			(_m, nl, indent, token) => nl +
				indent + "if (sourceUrl || release.urls.length > 0) {\n" +
				indent + "\tconst _bcSourceLinks = getReleaseUrls();\n" +
				indent + "\tif (_bcSourceLinks) description += (description ? '\\n\\n' : '') + 'Release info:\\n' + _bcSourceLinks;\n" +
				indent + "}\n" +
				indent + token,
			'Link + "Release info:" -> ALBUM INFO (album_desc)'),
	},
	{
		name: 'Link + "Release info:" -> RELEASE INFO (release_desc)',
		done: s => /rlsDesc\.push\('Release info/.test(s),
		apply: s => applyOnce(s,
			/(if \(sourceUrl \|\| release\.urls\.length > 0\) )rlsDesc\.push\(getReleaseUrls\(\)\);/,
			(_m, head) => head + "rlsDesc.push('Release info:\\n' + getReleaseUrls());",
			'Link + "Release info:" -> RELEASE INFO (release_desc)'),
	},
	{
		name: 'Link + "Release info:" -> release_lineage (non-RED)',
		done: s => /lineage\.push\('Release info/.test(s),
		apply: s => applyOnce(s,
			/(if \(sourceUrl \|\| release\.urls\.length > 0\) )lineage\.push\(getReleaseUrls\(\)\);/,
			(_m, head) => head + "lineage.push('Release info:\\n' + getReleaseUrls());",
			'Link + "Release info:" -> release_lineage (non-RED)'),
	},

	// 4. Robust cover rehost: ImgBB direct (override the library entry points)
	{
		name: 'ImgBB rehost override (cover upload fix)',
		done: s => /imgbb-rehost-override/.test(s),
		apply: s => applyOnce(s,
			/(: \['PTPimg', 'ImgBB', 'PixHost', 'PostImage'\],\s*\n\);)/,
			(_m, ctorEnd) => ctorEnd + '\n\n' + imgbbOverride,
			'ImgBB rehost override (cover upload fix)'),
	},
];

// --- run --------------------------------------------------------------------

let src = readFileSync(inPath, 'utf8');
const changed = [];
const skipped = [];

for (const edit of edits) {
	if (edit.done(src)) skipped.push(edit.name);
	else { src = edit.apply(src); changed.push(edit.name); }
}

// validate the result parses
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

const outPath = outPathArg || inPath.replace(/(\.user)?\.js$/i, '') + '.bandcamp.user.js';
writeFileSync(outPath, src);

console.log(`\nBandcamp enhancements applied → ${outPath}\n`);
if (changed.length) console.log('Changed:\n' + changed.map(s => '  + ' + s).join('\n'));
if (skipped.length) console.log('Skipped (idempotent):\n' + skipped.map(s => '  = ' + s).join('\n'));
console.log('\nDone. Install the output file in Tampermonkey/Violentmonkey to use it.');
