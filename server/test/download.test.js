const assert = require('assert/strict');

process.env.DATABASE_URL ||= 'postgres://localhost/ventune_test';
const {
    youtubeUrl,
    isAppleTrack,
    isSpeelbareLokaleTrack,
} = require('../../seed/download-track');

assert.equal(
    youtubeUrl({ preview_url: 'dQw4w9WgXcQ' }),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
);
assert.equal(
    youtubeUrl({ bron_url: 'https://youtu.be/dQw4w9WgXcQ' }),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
);
assert.equal(
    youtubeUrl({ bron_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=abc' }),
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
);
assert.equal(youtubeUrl({ bron_url: 'https://example.com/video' }), null);

assert.equal(isAppleTrack({ bron: 'itunes', itunes_track_id: 123 }), true);
assert.equal(isAppleTrack({
    bron: 'lokaal',
    itunes_track_id: 123,
    preview_url: '/media/downloads/baantjer.m4a',
}), true);
assert.equal(isAppleTrack({
    bron: 'lokaal',
    preview_url: '/media/downloads/baantjer.m4a',
    bron_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    download_status: 'available',
}), false);
assert.equal(isSpeelbareLokaleTrack({
    bron: 'lokaal',
    preview_url: '/media/downloads/baantjer.m4a',
    bron_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    download_status: 'available',
}), true);
assert.equal(isSpeelbareLokaleTrack({
    bron: 'lokaal',
    itunes_track_id: 123,
    preview_url: '/media/downloads/preview.m4a',
    download_status: 'available',
}), false);

console.log('download: alleen geldige expliciete YouTube-bronnen worden geaccepteerd');
