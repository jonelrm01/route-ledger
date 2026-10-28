'use strict';
// Confetti celebrations: the burst itself, the on/off + reduced-motion rules,
// and that the right moments trigger it (and restore does not).
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function makeSandbox(opts){
  opts = opts || {};
  const src = [
    "var store = " + JSON.stringify(opts.store || {}) + ";",
    "var localStorage = { getItem: function(k){ return store.hasOwnProperty(k) ? store[k] : null; }, setItem: function(k, v){ store[k] = String(v); } };",
    "var reduced = " + (opts.reduced ? 'true' : 'false') + ";",
    "var appended = 0, removed = 0, oscillators = [], noiseBuffers = 0, audioContexts = 0;",
    "var fakeCtx = { scale: function(){}, clearRect: function(){}, save: function(){}, restore: function(){}, translate: function(){}, rotate: function(){}, fillRect: function(){} };",
    "function FakeAudioContext(){ audioContexts++; this.state = 'running'; this.currentTime = 0; this.sampleRate = 8000; this.destination = {};" +
      " this.createGain = function(){ return { gain: { value: 0, setValueAtTime: function(){}, exponentialRampToValueAtTime: function(){} }, connect: function(){} }; };" +
      " this.createOscillator = function(){ var o = { type: '', frequency: { value: 0 }, connect: function(){}, start: function(){}, stop: function(){} }; oscillators.push(o); return o; };" +
      " this.createBuffer = function(c, len){ noiseBuffers++; return { getChannelData: function(){ return new Array(len); } }; };" +
      " this.createBufferSource = function(){ return { buffer: null, connect: function(){}, start: function(){} }; };" +
      " this.createBiquadFilter = function(){ return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: function(){} }; }; }",
    "var window = { innerWidth: 400, innerHeight: 800, devicePixelRatio: 1, matchMedia: function(q){ return { matches: reduced }; }" + (opts.audio ? ", AudioContext: FakeAudioContext" : "") + " };",
    "var document = { hidden: " + (opts.hidden ? 'true' : 'false') + ", createElement: function(){ return { style: {}, setAttribute: function(){}, getContext: function(){ return fakeCtx; }, parentNode: null }; }, body: { appendChild: function(c){ appended++; c.parentNode = { removeChild: function(){ removed++; } }; } } };",
    "function requestAnimationFrame(){}",
    "var CELEBRATE_KEY = 'routeLedger.celebrations.v1'; var SOUND_KEY = 'routeLedger.celebrationSound.v1'; var cheerCtx = null;",
    "var CONFETTI_COLORS = ['#F5A623','#3DDBB0','#FF7A8A','#FCFDFE','#7CC4FF']; var lastCelebrateAt = 0;",
    extractFn(html, 'celebrationsEnabled'),
    extractFn(html, 'setCelebrationsEnabled'),
    extractFn(html, 'celebrationSoundEnabled'),
    extractFn(html, 'setCelebrationSoundEnabled'),
    extractFn(html, 'prefersReducedMotion'),
    extractFn(html, 'makeConfetti'),
    extractFn(html, 'stepConfetti'),
    extractFn(html, 'cheerNotes'),
    extractFn(html, 'playCheer'),
    extractFn(html, 'drawConfetti'),
    extractFn(html, 'celebrate')
  ];
  return runInSandbox(src);
}

function seeded(){ let x = 7; return function(){ x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; }; }

test('a burst has the requested number of particles, starting at the origin and fanning upward', function(){
  const sb = makeSandbox();
  const parts = sb.makeConfetti(60, 400, 800, 200, 560, seeded());
  assert.strictEqual(parts.length, 60);
  parts.forEach(function(p){ assert.strictEqual(p.x, 200); assert.strictEqual(p.y, 560); });
  const upward = parts.filter(function(p){ return p.vy < 0; }).length;
  assert.strictEqual(upward, 60, 'every particle launches upward (got ' + upward + '/60)');
});

test('particles fall, then finish and get cleaned up', function(){
  const sb = makeSandbox();
  const p = sb.makeConfetti(1, 400, 800, 200, 560, seeded())[0];
  const vy0 = p.vy;
  sb.stepConfetti(p);
  assert.ok(p.vy > vy0, 'gravity pulls it down');
  let frames = 1;
  while(sb.stepConfetti(p) && frames < 500) frames++;
  assert.ok(frames < 200, 'every particle finishes in a couple of seconds (took ' + frames + ' frames)');
});

test('celebrate draws once, and never stacks a second burst right behind the first', function(){
  const sb = makeSandbox();
  assert.strictEqual(sb.celebrate('small'), true);
  assert.strictEqual(sb.appended, 1);
  assert.strictEqual(sb.celebrate('big'), false, 'a second call inside 700ms is ignored');
  assert.strictEqual(sb.appended, 1);
});

test('turned off in Settings = nothing is drawn; on by default', function(){
  assert.strictEqual(makeSandbox().celebrationsEnabled(), true);
  const off = makeSandbox({ store: { 'routeLedger.celebrations.v1': 'off' } });
  assert.strictEqual(off.celebrationsEnabled(), false);
  assert.strictEqual(off.celebrate('big'), false);
  assert.strictEqual(off.appended, 0);
  const sb = makeSandbox({ store: { 'routeLedger.celebrationSound.v1': 'off' } });   // isolate the confetti switch
  sb.setCelebrationsEnabled(false);
  assert.strictEqual(sb.celebrate('small'), false);
  sb.setCelebrationsEnabled(true);
  assert.strictEqual(sb.celebrate('small'), true);
});

test('phones set to reduce motion never see confetti, even when the switch is on', function(){
  const sb = makeSandbox({ reduced: true });
  assert.strictEqual(sb.celebrate('big'), false);
  assert.strictEqual(sb.appended, 0);
});

test('triggers: mileage (manual/voice/GPS), CSV + tax downloads, shared backup, odometer update — not restore', function(){
  const add = extractFn(html, 'addEntry');
  assert.ok(/type === 'mileage' && typeof celebrate === 'function'\) celebrate\('small'\)/.test(add), 'addEntry celebrates mileage only');
  assert.ok(/celebrate\('big'\)/.test(extractFn(html, 'exportCsv')), 'CSV export');
  assert.ok(/celebrate\('big'\)/.test(extractFn(html, 'exportTaxSummary')), 'tax summary download');
  assert.ok(/celebrate\('big'\)/.test(extractFn(html, 'shareBackupNow')), 'shared backup');
  assert.ok(/showToast\('Odometer updated'\);\n\s*if\(typeof celebrate === 'function'\) celebrate\('small'\)/.test(html), 'odometer update');
  assert.ok(extractFn(html, 'restoreFromCsvText').indexOf('celebrate') === -1, 'restoring a backup is not a celebration');
});

test('Settings switch exists and its three strings are in all 5 languages', function(){
  ['celebrationsSection', 'celebrationsToggleBtn', 'lblCelebrations'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  ['celebrationsTitle', 'celebrationsOn', 'celebrationsOff'].forEach(function(k){
    const n = (html.match(new RegExp('\\b' + k + ": '", 'g')) || []).length;
    assert.strictEqual(n, 5, k + ' should be in all 5 languages (found ' + n + ')');
  });
});


test('sound: a rising fanfare plus applause; the big one is longer; nothing without Web Audio', function(){
  const small = makeSandbox({ audio: true });
  assert.strictEqual(small.playCheer('small'), true);
  assert.strictEqual(small.oscillators.length, 2);
  assert.strictEqual(small.noiseBuffers, 1, 'applause noise');
  const big = makeSandbox({ audio: true });
  big.playCheer('big');
  assert.strictEqual(big.oscillators.length, 4);
  const notes = Array.from(big.cheerNotes('big'));
  assert.deepStrictEqual(notes.slice().sort(function(a, b){ return a - b; }), notes, 'notes rise');
  assert.strictEqual(makeSandbox().playCheer('big'), false, 'no AudioContext = silently no sound');
});

test('sound respects its own switch, and stays quiet while the app is in the background', function(){
  const off = makeSandbox({ audio: true, store: { 'routeLedger.celebrationSound.v1': 'off' } });
  assert.strictEqual(off.celebrationSoundEnabled(), false);
  assert.strictEqual(off.playCheer('big'), false);
  assert.strictEqual(off.audioContexts, 0, 'no audio device is even opened');
  assert.strictEqual(makeSandbox({ audio: true, hidden: true }).playCheer('big'), false);
  assert.strictEqual(makeSandbox().celebrationSoundEnabled(), true, 'on by default');
});

test('confetti and sound are independent; reduced motion silences only the confetti', function(){
  const reduced = makeSandbox({ audio: true, reduced: true });
  assert.strictEqual(reduced.celebrate('big'), true, 'sound still plays');
  assert.strictEqual(reduced.appended, 0, 'but nothing is drawn');
  const soundOnly = makeSandbox({ audio: true, store: { 'routeLedger.celebrations.v1': 'off' } });
  assert.strictEqual(soundOnly.celebrate('small'), true);
  assert.strictEqual(soundOnly.appended, 0);
  const confettiOnly = makeSandbox({ audio: true, store: { 'routeLedger.celebrationSound.v1': 'off' } });
  assert.strictEqual(confettiOnly.celebrate('small'), true);
  assert.strictEqual(confettiOnly.appended, 1);
  assert.strictEqual(confettiOnly.audioContexts, 0);
  const none = makeSandbox({ audio: true, store: { 'routeLedger.celebrations.v1': 'off', 'routeLedger.celebrationSound.v1': 'off' } });
  assert.strictEqual(none.celebrate('big'), false);
});

test('Settings has a sound switch and its title is in all 5 languages', function(){
  ['celebrationSoundSection', 'celebrationSoundToggleBtn', 'lblCelebrationSound'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  const n = (html.match(/\bcelebrationSoundTitle: '/g) || []).length;
  assert.strictEqual(n, 5);
});
