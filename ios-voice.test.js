'use strict';
// iPhone voice: the native-speech adapter makes a Capacitor speech plugin look
// like the browser's SpeechRecognition, and only switches on for iOS + plugin.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();
const tick = function(){ return new Promise(function(r){ setImmediate(r); }); };
async function settle(){ for(let i = 0; i < 6; i++) await tick(); }

function fakeTimers(){
  const q = [];
  return {
    setTimeout: function(fn, ms){ q.push({ fn: fn, ms: ms, off: false }); return q.length; },
    clearTimeout: function(id){ if(q[id - 1]) q[id - 1].off = true; },
    runAll: function(){ q.filter(function(x){ return !x.off; }).forEach(function(x){ x.off = true; x.fn(); }); },
    pending: function(){ return q.filter(function(x){ return !x.off; }).length; }
  };
}

function mockPlugin(opts){
  opts = opts || {};
  const log = [], listeners = {};
  return {
    log: log, listeners: listeners,
    checkPermissions: function(){ return Promise.resolve({ speechRecognition: opts.perm || 'granted' }); },
    requestPermissions: function(){ log.push('requestPermissions'); return Promise.resolve({ speechRecognition: opts.afterPrompt || 'granted' }); },
    addListener: function(name, cb){ listeners[name] = cb; return Promise.resolve({ remove: function(){ log.push('remove:' + name); delete listeners[name]; } }); },
    start: function(o){ log.push('start:' + o.language + ':' + o.maxResults + ':' + o.partialResults); return Promise.resolve({}); },
    stop: function(){ log.push('stop'); return Promise.resolve(); }
  };
}

function make(pluginOpts){
  const sb = runInSandbox([extractFn(html, 'makeNativeSpeechRecognition')]);
  const plugin = mockPlugin(pluginOpts), timers = fakeTimers();
  const Ctor = sb.makeNativeSpeechRecognition(plugin, timers);
  const rec = new Ctor();
  const events = [];
  rec.onstart = function(){ events.push('start'); };
  rec.onresult = function(ev){ events.push({ result: Array.from(ev.results[ev.results.length - 1]).map(function(a){ return a.transcript; }) }); };
  rec.onerror = function(ev){ events.push({ error: ev.error }); };
  rec.onend = function(){ events.push('end'); };
  return { rec: rec, plugin: plugin, timers: timers, events: events };
}

test('speech heard -> silence -> one result with alternatives, then end; options passed; listeners cleaned up', async function(){
  const m = make();
  m.rec.lang = 'es-ES'; m.rec.maxAlternatives = 5;
  m.rec.start();
  await settle();
  assert.deepStrictEqual(m.events, ['start']);
  assert.ok(m.plugin.log.indexOf('start:es-ES:5:true') !== -1, 'plugin started with language, max results, partial results');
  m.plugin.listeners.partialResults({ matches: ['20 dólares', '20 dolares ingreso'] });
  m.plugin.listeners.partialResults({ matches: ['20 dólares ingreso doordash', '20 dolares ingreso doordash'] });
  assert.strictEqual(m.timers.pending(), 1, 'only the latest silence timer is live');
  m.timers.runAll();            // silence: the app asks the recognizer to stop
  assert.ok(m.plugin.log.indexOf('stop') !== -1);
  m.plugin.listeners.listeningState({ status: 'stopped' });
  assert.deepStrictEqual(m.events.slice(1), [{ result: ['20 dólares ingreso doordash', '20 dolares ingreso doordash'] }, 'end']);
  assert.ok(m.plugin.log.indexOf('remove:partialResults') !== -1 && m.plugin.log.indexOf('remove:listeningState') !== -1);
});

test('permission denied -> not-allowed (the app already handles that) and the plugin never starts', async function(){
  const m = make({ perm: 'denied', afterPrompt: 'denied' });
  m.rec.start();
  await settle();
  assert.deepStrictEqual(m.events, [{ error: 'not-allowed' }, 'end']);
  assert.ok(m.plugin.log.indexOf('requestPermissions') !== -1, 'it asked first');
  assert.ok(!m.plugin.log.some(function(l){ return l.indexOf('start:') === 0; }));
});

test('first use: the permission sheet is shown, and granting it carries on', async function(){
  const m = make({ perm: 'prompt', afterPrompt: 'granted' });
  m.rec.start();
  await settle();
  assert.ok(m.plugin.log.indexOf('requestPermissions') !== -1);
  assert.strictEqual(m.events[0], 'start');
});

test('tapping stop mid-sentence still delivers what was heard; a safety timer ends it if the plugin goes quiet', async function(){
  const m = make();
  m.rec.start(); await settle();
  m.plugin.listeners.partialResults({ matches: ['log 12 miles'] });
  m.rec.stop();
  m.timers.runAll();   // the plugin never reported "stopped"
  assert.deepStrictEqual(m.events.slice(1), [{ result: ['log 12 miles'] }, 'end']);
});

test('nothing heard -> no-speech then end (the wake/manual flow already handles this quietly)', async function(){
  const m = make();
  m.rec.start(); await settle();
  m.plugin.listeners.listeningState({ status: 'stopped' });
  assert.deepStrictEqual(m.events.slice(1), [{ error: 'no-speech' }, 'end']);
});

test('abort ends without delivering a result or an error', async function(){
  const m = make();
  m.rec.start(); await settle();
  m.plugin.listeners.partialResults({ matches: ['hello'] });
  m.rec.abort();
  assert.deepStrictEqual(m.events.slice(1), ['end']);
});

test('like the browser, starting twice throws, and it can be started again once finished', async function(){
  const m = make();
  m.rec.start();
  assert.throws(function(){ m.rec.start(); }, /already started/);
  await settle();
  m.plugin.listeners.listeningState({ status: 'stopped' });
  m.rec.start();   // new session is allowed
  await settle();
  assert.strictEqual(m.events.filter(function(e){ return e === 'start'; }).length, 2);
});

test('the adapter is only chosen on iOS, inside the native app, with the plugin installed', function(){
  function pick(platform, withPlugin, native){
    const sb = runInSandbox([
      "function makeNativeSpeechRecognition(p){ return function Fake(){ this.fake = true; }; }",
      "function isNativeApp(){ return " + (native === false ? 'false' : 'true') + "; }",
      extractFn(html, 'isIOSNativeApp'), extractFn(html, 'nativeSpeechRecognitionCtor')
    ], { window: { Capacitor: { getPlatform: function(){ return platform; }, Plugins: withPlugin ? { SpeechRecognition: {} } : {} } } });
    return sb.nativeSpeechRecognitionCtor();
  }
  assert.strictEqual(typeof pick('ios', true), 'function');
  assert.strictEqual(pick('android', true), null, 'Android keeps the browser engine');
  assert.strictEqual(pick('ios', false), null, 'no plugin installed = keep the browser engine');
  assert.strictEqual(pick('ios', true, false), null, 'not the native shell (plain web)');
});

test('wiring: engine prefers the adapter; iPhone has no wake word; Install is hidden inside the native app', function(){
  assert.ok(/var SpeechRecognition = nativeSpeechRecognitionCtor\(\) \|\| window\.SpeechRecognition \|\| window\.webkitSpeechRecognition;/.test(html));
  assert.ok(/if\(wakeToggle && isIOSNativeApp\(\)\)\{[\s\S]*?wakeToggle\.style\.display = 'none'/.test(html));
  assert.ok(/standalone = isNativeApp\(\) \|\|/.test(html), 'Install app button hides in the native app');
});
