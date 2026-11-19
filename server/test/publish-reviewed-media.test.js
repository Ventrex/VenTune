const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { publiceerMp3, herstelPublicatie } = require('../lib/publish-reviewed-media');

test('approved staged MP3 moves to its category without losing bytes', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ventune-stage-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const src = path.join(dir, '_Tijdelijk', 'Videogames', 'demo-1.mp3');
  await fs.mkdir(path.dirname(src), { recursive: true });
  await fs.writeFile(src, Buffer.from('audio-test'));
  const moved = await publiceerMp3('/media/_Tijdelijk/Videogames/demo-1.mp3', dir);
  assert.equal(moved.url, '/media/Videogames/demo-1.mp3');
  assert.equal((await fs.readFile(moved.doel)).toString(), 'audio-test');
  await herstelPublicatie(moved);
  assert.equal((await fs.readFile(src)).toString(), 'audio-test');
});

test('old audio and unsafe temporary paths are not touched', async () => {
  assert.equal(await publiceerMp3('/media/Film/old.mp3', '/unused'), null);
  await assert.rejects(() => publiceerMp3('/media/_Tijdelijk/Film/../../bad.mp3', '/unused'), /Ongeldig tijdelijk/);
});
