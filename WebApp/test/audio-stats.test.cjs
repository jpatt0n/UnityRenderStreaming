const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../client/public/js/stats.js'), 'utf8')
  .replace('export function', 'function'), context);
const display = context.createDisplayStringArray;
const track = { id: 'show', readyState: 'live' };
const element = { srcObject: { getAudioTracks: () => [track] }, paused: false, muted: false, readyState: 4 };
const stat = { id: 'audio', type: 'inbound-rtp', kind: 'audio', trackIdentifier: 'show', packetsReceived: 100, totalAudioEnergy: 1 };
const report = fields => new Map([['audio', { ...stat, ...fields }]]);

test('diagnostics distinguish missing track, missing packets, and browser blocking', () => {
  assert.match(display(new Map(), null, { srcObject: null })[0], /waiting for audio track/);
  assert.match(display(new Map(), null, element)[0], /waiting for audio packets/);
  assert.match(display(report(), null, { ...element, muted: true })[0], /blocked/);
  assert.match(display(report(), null, { ...element, paused: true })[0], /paused/);
  assert.match(display(report(), null, element)[0], /playing/);
});

test('silent PCM is different from stalled packets and from nonzero signal', () => {
  const previous = report();
  assert.ok(display(report(), previous).includes('Decoded audio: no new packets'));
  assert.ok(display(report({ packetsReceived: 150 }), previous).includes('Decoded audio: silence'));
  assert.ok(display(report({ packetsReceived: 150, totalAudioEnergy: 2 }), previous).includes('Decoded audio: signal present'));
});

test('buffer delay uses this interval, not the accumulated connection lifetime', () => {
  const previous = report({ jitterBufferDelay: 100, jitterBufferEmittedCount: 10000 });
  const current = report({ jitterBufferDelay: 102, jitterBufferEmittedCount: 10100 });
  assert.ok(display(current, previous).includes('Audio buffer delay: 20 ms'));
});
