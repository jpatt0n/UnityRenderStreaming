// Run with: node --test test/videoplayer-audio.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makePlayer() {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/js/videoplayer.js'), 'utf8');
  const context = {
    window: { location: { pathname: '/' }, addEventListener() {} },
    document: {
      addEventListener() {},
      createElement() {
        return { style: {}, muted: false, paused: true, addEventListener() {}, remove() {},
          play() { this.paused = false; return Promise.resolve(); } };
      }
    },
    MediaStream: class {},
    console: { warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '')
    .replace('export class VideoPlayer', 'class VideoPlayer') + '\nthis.VideoPlayer = VideoPlayer;', context);
  const player = new context.VideoPlayer();
  player.createPlayer({ appendChild() {} }, { checked: false });
  return player;
}

test('Join starts with sound and no hidden extra video click', async () => {
  const player = makePlayer();
  await player.startPlayback();
  assert.equal(player.videoElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('autoplay denial keeps video running and exposes an explicit sound action', async () => {
  const player = makePlayer();
  player.videoElement.play = function () {
    if (!this.muted) return Promise.reject({ name: 'NotAllowedError' });
    this.paused = false;
    return Promise.resolve();
  };
  await player.startPlayback();
  assert.equal(player.videoElement.muted, true);
  assert.equal(player.videoElement.paused, false);
  assert.equal(player.soundButtonElement.hidden, false);
  player.videoElement.play = function () { this.paused = false; return Promise.resolve(); };
  await player._enableSound();
  assert.equal(player.videoElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('a late rejection from the old player cannot mute a reconnected player', async () => {
  const player = makePlayer();
  let reject;
  player.videoElement.play = () => new Promise((_, r) => { reject = r; });
  const oldPlay = player.startPlayback();
  player.createPlayer({ appendChild() {} }, { checked: false });
  await player.startPlayback();
  reject({ name: 'NotAllowedError' });
  await oldPlay;
  assert.equal(player.videoElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('an older playback request cannot override a newer successful request', async () => {
  const player = makePlayer();
  let reject;
  player.videoElement.play = () => new Promise((_, r) => { reject = r; });
  const oldPlay = player.startPlayback();
  player.videoElement.play = function () { this.paused = false; return Promise.resolve(); };
  await player.startPlayback();
  reject({ name: 'NotAllowedError' });
  await oldPlay;
  assert.equal(player.videoElement.muted, false);
});

test('an interrupted play request does not mute the stream', async () => {
  const player = makePlayer();
  player.videoElement.play = () => Promise.reject({ name: 'AbortError' });
  await player.startPlayback();
  assert.equal(player.videoElement.muted, false);
});
