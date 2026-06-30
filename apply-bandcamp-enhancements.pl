#!/usr/bin/perl
# apply-bandcamp-enhancements.pl
# ---------------------------------------------------------------------------
# Zero-install version of apply-bandcamp-enhancements.mjs (macOS ships Perl).
# Produces an identical result. Run it on YOUR pristine copy of the
# "[RED/OPS/DIC] Upload Assistant" userscript (v1.43x).
#
#   perl apply-bandcamp-enhancements.pl <input.user.js> [output.user.js]
#
# It is idempotent and refuses to write if an anchor is missing.
# See the .mjs header / README.md / CHANGES.md for what each edit does.
# ---------------------------------------------------------------------------
use strict;
use warnings;

my $KEY = '50b144a5dc7ea978a05d76002b79452f';

my $in = shift @ARGV;
if (!defined $in || $in eq '-h' || $in eq '--help') {
	print STDERR "Usage: perl apply-bandcamp-enhancements.pl <input.user.js> [output.user.js]\n";
	exit(defined $in ? 0 : 1);
}
my $out = shift @ARGV;
if (!defined $out) {
	($out = $in) =~ s/(\.user)?\.js$/.bandcamp.user.js/i;
	$out = "$in.bandcamp.user.js" if $out eq $in;
}

open(my $ifh, '<:raw', $in) or die "Cannot open $in: $!\n";
my $src = do { local $/; <$ifh> };
close $ifh;

my (@changed, @skipped);

sub flac_block {
	my ($ind) = @_;
	return "\n$ind" . "encoding: 'lossless'," . "\n$ind" . "codec: 'FLAC'," . "\n$ind" . 'bitdepth: 24,';
}

# Self-contained ImgBB uploader, injected after `new ImageHostManager(...)`.
# Single-quoted heredoc => verbatim (no interpolation); chomp drops the
# heredoc's trailing newline so it matches the .mjs output exactly.
my $override = <<'OVERRIDE';
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
OVERRIDE
chomp $override;

# --- 1. Bandcamp -> FLAC 24bit (JSON / tralbum path) ---
if ($src =~ /media: 'WEB',\s*\n[ \t]*encoding: 'lossless',\s*\n[ \t]*codec: 'FLAC',\s*\n[ \t]*bitdepth: 24,/) {
	push @skipped, 'FLAC 24bit (JSON / tralbum path)';
} else {
	my $n = ($src =~ s/(total_tracks: releaseMeta != null && releaseMeta\.numTracks[^\n]*\n)([ \t]*)(media: 'WEB',)/$1 . $2 . $3 . flac_block($2)/e);
	die "Anchor not found: FLAC 24bit (JSON / tralbum path). Nothing written.\n" unless $n == 1;
	push @changed, 'FLAC 24bit (JSON / tralbum path)';
}

# --- 1. Bandcamp -> FLAC 24bit (HTML fallback path) ---
if ($src =~ /track_row_view'\)[\s\S]{0,4000}?media: media,\s*\n[ \t]*encoding: 'lossless',/) {
	push @skipped, 'FLAC 24bit (HTML fallback path)';
} else {
	my $n = ($src =~ s/(querySelectorAll\('table#track_table > tbody > tr\.track_row_view'\)[\s\S]*?\n)([ \t]*)(media: media,)/$1 . $2 . $3 . flac_block($2)/e);
	die "Anchor not found: FLAC 24bit (HTML fallback path). Nothing written.\n" unless $n == 1;
	push @changed, 'FLAC 24bit (HTML fallback path)';
}

# --- 2. Initial year defaults to edition year ---
if ($src =~ /ref\.value = release\.album_year \|\| releaseYear \|\| '';/) {
	push @skipped, 'Initial year defaults to edition year';
} else {
	my $n = ($src =~ s/ref\.value = release\.album_year \|\| '';/ref.value = release.album_year || releaseYear || '';/);
	die "Anchor not found: Initial year defaults to edition year. Nothing written.\n" unless $n == 1;
	push @changed, 'Initial year defaults to edition year';
}

# --- 3. Link + "Release info:" -> ALBUM INFO (album_desc) ---
if ($src =~ /_bcSourceLinks/) {
	push @skipped, 'Link + "Release info:" -> ALBUM INFO (album_desc)';
} else {
	my $n = ($src =~ s{(\n)([ \t]*)(const finalizeDesc = elem => fetchOnlineAdditions\(\))}{
		my ($nl, $ind, $tok) = ($1, $2, $3);
		$nl
		  . $ind . 'if (sourceUrl || release.urls.length > 0) {' . "\n"
		  . $ind . "\t" . 'const _bcSourceLinks = getReleaseUrls();' . "\n"
		  . $ind . "\t" . q{if (_bcSourceLinks) description += (description ? '\n\n' : '') + 'Release info:\n' + _bcSourceLinks;} . "\n"
		  . $ind . '}' . "\n"
		  . $ind . $tok;
	}e);
	die "Anchor not found: ALBUM INFO link. Nothing written.\n" unless $n == 1;
	push @changed, 'Link + "Release info:" -> ALBUM INFO (album_desc)';
}

# --- 3. Link + "Release info:" -> RELEASE INFO (release_desc) ---
if ($src =~ /rlsDesc\.push\('Release info/) {
	push @skipped, 'Link + "Release info:" -> RELEASE INFO (release_desc)';
} else {
	my $n = ($src =~ s{(if \(sourceUrl \|\| release\.urls\.length > 0\) )rlsDesc\.push\(getReleaseUrls\(\)\);}{$1 . q{rlsDesc.push('Release info:\n' + getReleaseUrls());}}e);
	die "Anchor not found: RELEASE INFO link. Nothing written.\n" unless $n == 1;
	push @changed, 'Link + "Release info:" -> RELEASE INFO (release_desc)';
}

# --- 3. Link + "Release info:" -> release_lineage (non-RED) ---
if ($src =~ /lineage\.push\('Release info/) {
	push @skipped, 'Link + "Release info:" -> release_lineage (non-RED)';
} else {
	my $n = ($src =~ s{(if \(sourceUrl \|\| release\.urls\.length > 0\) )lineage\.push\(getReleaseUrls\(\)\);}{$1 . q{lineage.push('Release info:\n' + getReleaseUrls());}}e);
	die "Anchor not found: release_lineage link. Nothing written.\n" unless $n == 1;
	push @changed, 'Link + "Release info:" -> release_lineage (non-RED)';
}

# --- 4. ImgBB rehost override (cover upload fix) ---
if ($src =~ /imgbb-rehost-override/) {
	push @skipped, 'ImgBB rehost override (cover upload fix)';
} else {
	my $n = ($src =~ s{(: \['PTPimg', 'ImgBB', 'PixHost', 'PostImage'\],\s*\n\);)}{$1 . "\n\n" . $override}e);
	die "Anchor not found: ImgBB rehost override. Nothing written.\n" unless $n == 1;
	push @changed, 'ImgBB rehost override (cover upload fix)';
}

open(my $ofh, '>:raw', $out) or die "Cannot write $out: $!\n";
print $ofh $src;
close $ofh;

print "\nBandcamp enhancements applied -> $out\n\n";
print "Changed:\n", join("\n", map { "  + $_" } @changed), "\n" if @changed;
print "Skipped (idempotent):\n", join("\n", map { "  = $_" } @skipped), "\n" if @skipped;
print "\nDone. Install the output file in Tampermonkey/Violentmonkey to use it.\n";
