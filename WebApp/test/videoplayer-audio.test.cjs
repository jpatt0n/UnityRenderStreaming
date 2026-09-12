// Run with: node --test test/videoplayer-audio.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makePlayer() {
  const source = fs.readFileSync(path.join(__dirname, '../client/public/js/videoplayer.js'), 'utf8');
  const context = {
    window: { location: { pathname: '/' }, addEventListener() {}, removeEventListener() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      createElement() {
        return { style: {}, muted: false, paused: true, addEventListener() {}, remove() {},
          pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); } };
      }
    },
    MediaStream: class {
      constructor(tracks = []) { this.tracks = tracks; }
      getTracks() { return [...this.tracks]; }
      getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
      addTrack(t) { this.tracks.push(t); }
      removeTrack(t) { this.tracks = this.tracks.filter(x => x !== t); }
    },
    console: { warn() {} }
  };
  vm.createContext(context);
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, '')
    .replace('export class VideoPlayer', 'class VideoPlayer') + '\nthis.VideoPlayer = VideoPlayer;', context);
  const player = new context.VideoPlayer();
  player.createPlayer({ appendChild() {} }, { checked: false });
  player.audioElement.srcObject.addTrack({ kind: 'audio', id: 'show' });
  return player;
}

test('Join starts with sound and no hidden extra video click', async () => {
  const player = makePlayer();
  await player.startPlayback();
  assert.equal(player.audioElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('autoplay denial keeps video running and exposes an explicit sound action', async () => {
  const player = makePlayer();
  player.audioElement.play = function () {
    if (!this.muted) return Promise.reject({ name: 'NotAllowedError' });
    this.paused = false;
    return Promise.resolve();
  };
  await player.startPlayback();
  assert.equal(player.audioElement.muted, true);
  assert.equal(player.videoElement.muted, true);
  assert.equal(player.videoElement.paused, false);
  assert.equal(player.soundButtonElement.hidden, false);
  player.audioElement.play = function () { this.paused = false; return Promise.resolve(); };
  await player._enableSound();
  assert.equal(player.audioElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('a late rejection from the old player cannot mute a reconnected player', async () => {
  const player = makePlayer();
  let reject;
  player.audioElement.play = () => new Promise((_, r) => { reject = r; });
  const oldPlay = player.startPlayback();
  player.createPlayer({ appendChild() {} }, { checked: false });
  await player.startPlayback();
  reject({ name: 'NotAllowedError' });
  await oldPlay;
  assert.equal(player.audioElement.muted, false);
  assert.equal(player.soundButtonElement.hidden, true);
});

test('an older playback request cannot override a newer successful request', async () => {
  const player = makePlayer();
  let reject;
  player.audioElement.play = () => new Promise((_, r) => { reject = r; });
  const oldPlay = player.startPlayback();
  player.audioElement.play = function () { this.paused = false; return Promise.resolve(); };
  await player.startPlayback();
  reject({ name: 'NotAllowedError' });
  await oldPlay;
  assert.equal(player.audioElement.muted, false);
});

test('an interrupted play request does not mute the stream', async () => {
  const player = makePlayer();
  player.audioElement.play = () => Promise.reject({ name: 'AbortError' });
  await player.startPlayback();
  assert.equal(player.audioElement.muted, false);
});

test('audio starts while first video frame is still pending', async () => {
  const player = makePlayer();
  player.videoElement.play = () => new Promise(() => {});
  let audioStarts = 0;
  player.audioElement.play = function () { audioStarts++; this.paused = false; return Promise.resolve(); };
  void player.startPlayback();
  await Promise.resolve();
  assert.equal(audioStarts, 1);
  assert.equal(player.audioElement.paused, false);
  assert.equal(player.videoElement.muted, true);
});

test('late audio and video tracks have independent playback streams', async () => {
  const player = makePlayer();
  const video = { kind: 'video', id: 'camera' };
  const audio = { kind: 'audio', id: 'show-replacement' };
  player.addTrack(video);
  player.addTrack(audio);
  assert.equal(player.videoElement.srcObject.getTracks().length, 1);
  assert.equal(player.videoElement.srcObject.getTracks()[0], video);
  assert.equal(player.audioElement.srcObject.getTracks().length, 1);
  assert.equal(player.audioElement.srcObject.getTracks()[0], audio);
  await Promise.resolve();
  assert.equal(player.audioElement.paused, false);
});

test('renegotiation selects the replacement audio track without stopping peer-owned tracks', () => {
  const player = makePlayer();
  const old = { kind: 'audio', id: 'old', stop() { assert.fail('Peer owns track disposal'); } };
  const next = { kind: 'audio', id: 'next' };
  player.addTrack(old);
  player.addTrack(next);
  player.addTrack(next);
  assert.equal(player.audioElement.srcObject.getTracks().length, 1);
  assert.equal(player.audioElement.srcObject.getTracks()[0], next);
});

test('disconnect releases both media elements and ignores late play rejection', async () => {
  const player = makePlayer();
  const audio = player.audioElement;
  const video = player.videoElement;
  let reject;
  audio.play = () => new Promise((_, r) => { reject = r; });
  const pending = player.startPlayback();
  player._releaseCapturedInputs = () => {};
  player._unlockKeyboardMovementKeys = () => {};
  player._setInputSenderChannel = () => {};
  player.deletePlayer();
  reject({ name: 'NotAllowedError' });
  await pending;
  assert.equal(audio.paused, true);
  assert.equal(video.paused, true);
  assert.equal(audio.srcObject, null);
  assert.equal(video.srcObject, null);
  assert.equal(player.audioElement, null);
});
