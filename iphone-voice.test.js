'use strict';
// iPhone home-screen web apps: Safari has long refused speech recognition
// inside them. The app must explain that clearly instead of saying
// "didn't catch that" forever, and must not blame the microphone permission.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, runInSandbox } = require('./helpers');

const html = loadHtml();
function env(nav){ return runInSandbox([extractFn(html, 'isIPhoneHomeScreenApp'), extractFn(html, 'voiceFailureKey')], { navigator: nav }); }

test('detects an iPhone/iPad home-screen app, and nothing else', function(){
  const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
  assert.strictEqual(env({ userAgent: iphoneUA, platform: 'iPhone', maxTouchPoints: 5, standalone: true }).isIPhoneHomeScreenApp(), true);
  assert.strictEqual(env({ userAgent: iphoneUA, platform: 'iPhone', maxTouchPoints: 5, standalone: false }).isIPhoneHomeScreenApp(), false, 'a normal Safari tab is not a home-screen app');
  assert.strictEqual(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5, standalone: true }).isIPhoneHomeScreenApp(), true, 'iPad in desktop mode reports as a Mac but has touch');
  assert.strictEqual(env({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0, standalone: undefined }).isIPhoneHomeScreenApp(), false, 'a real Mac is not');
  assert.strictEqual(env({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', platform: 'Linux armv8l', maxTouchPoints: 5 }).isIPhoneHomeScreenApp(), false);
});

test('each speech-recognition error maps to the right explanation', function(){
  const f = env({ userAgent: '', platform: '', maxTouchPoints: 0 }).voiceFailureKey;
  assert.strictEqual(f('service-not-allowed', true), 'voiceIphoneHomeScreen');
  assert.strictEqual(f('service-not-allowed', false), 'voiceNotAvailable');
  assert.strictEqual(f('not-allowed', true), 'voiceIphoneHomeScreen', 'on an iPhone home-screen app this is not a permission the person can fix');
  assert.strictEqual(f('not-allowed', false), null, 'elsewhere it stays the existing "microphone blocked" message');
  assert.strictEqual(f('audio-capture', false), 'voiceNoMic');
  assert.strictEqual(f('language-not-supported', false), 'voiceLanguageUnsupported');
  ['no-speech', 'aborted', 'network', undefined].forEach(function(e){ assert.strictEqual(f(e, true), null, String(e) + ' keeps the normal quiet retry'); });
});

test('wiring: the error handler asks for the explanation before the generic messages', function(){
  const at = function(s){ const i = html.indexOf(s); assert.ok(i !== -1, 'missing ' + s); return i; };
  assert.ok(at('var failKey = voiceFailureKey(ev.error, isIPhoneHomeScreenApp());') < at("if(ev.error === 'not-allowed'){\n        voiceNotice = 'Microphone access is blocked"));
  assert.ok(html.indexOf('voiceNotice = t(failKey); stopWakeModeEntirely(voiceNotice);') !== -1);
});

test('voice failure texts exist in all 5 languages, are safe, and point to a way forward', function(){
  const i18n = extractObjectLiteral(html, 'I18N');
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    ['voiceIphoneHomeScreen', 'voiceNotAvailable', 'voiceNoMic', 'voiceLanguageUnsupported'].forEach(function(k){
      assert.ok(i18n[lang][k] && !/[<>]/.test(i18n[lang][k]), lang + ' missing or unsafe ' + k);
    });
    assert.ok(/Safari/.test(i18n[lang].voiceIphoneHomeScreen), lang + ': the iPhone message must say to open Safari');
  });
});

test('the guide warns iPhone users in all 5 languages (hedged: it "may" not work)', function(){
  const HELP = extractObjectLiteral(html, 'HELP_CONTENT');
  const words = { 'en-US': /iPhone[^.]*may not work/, 'es-ES': /iPhone[^.]*puede no funcionar/, 'it-IT': /iPhone[^.]*può non funzionare/, 'fr-FR': /iPhone[^.]*peut ne pas fonctionner/, 'zh-CN': /iPhone[^。]*可能无法使用/ };
  Object.keys(words).forEach(function(lang){
    const b = HELP[lang].sections[3].body;
    assert.ok(words[lang].test(b) && /Safari/.test(b), lang + ': the voice section should warn iPhone users and mention Safari');
  });
});

test('a failure message is kept when the browser fires its "end" event right after the error', function(){
  // setListening(false) resets the hint to the default text once the mode is idle, which used to erase these messages instantly
  assert.ok(/recognitionMode = 'idle';\s*if\(voiceNotice\)\{ micHint\.textContent = voiceNotice; voiceNotice = ''; \}/.test(html), 'onend must put the notice back after resetting');
  assert.ok(html.indexOf("voiceNotice = 'Microphone access is blocked") !== -1, 'the existing microphone-blocked message needs the same protection');
});
