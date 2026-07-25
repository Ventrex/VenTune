const assert = require('assert/strict');

process.env.DATABASE_URL ||= 'postgres://localhost/ventune_test';
const { youtubeUrl } = require('../../seed/download-track');

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

console.log('download: alleen geldige expliciete YouTube-bronnen worden geaccepteerd');
