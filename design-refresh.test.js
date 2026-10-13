'use strict';
// Guards the Oct 2026 color/layout refresh of the Log screen so later edits
// can't quietly undo it or break the script by removing an element it uses.
const { loadHtml } = require('./helpers');

const html = loadHtml();
const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
const body = html.slice(html.indexOf('<body>'));

function assert(cond, msg){ if(!cond) throw new Error(msg); }

test('palette tokens: near-white text, brighter amber/teal/rose', function(){
  assert(/--text-primary:#FCFDFE;/.test(css), 'text-primary should be #FCFDFE');
  assert(/--amber:#F5A623;/.test(css), 'amber should be #F5A623');
  assert(/--teal:#3DDBB0;/.test(css), 'teal should be #3DDBB0');
  assert(/--rose:#FF7A8A;/.test(css), 'rose should be #FF7A8A');
  assert(/--text-muted:#A9B1C3;/.test(css), 'text-muted should be #A9B1C3');
});

test('no leftover monospace font and no all-caps label styling', function(){
  assert(!/JetBrains/.test(html), 'JetBrains Mono should be gone');
  assert(!/text-transform:\s*uppercase/.test(css), 'labels should be sentence case (no text-transform:uppercase)');
});

test('bottom nav has Log, Stats, Calendar, Vehicle, Help; top tab row is gone', function(){
  const nav = body.slice(body.indexOf('<nav class="bottom">'), body.indexOf('</nav>'));
  ['log','stats','calendar','vehicle','help'].forEach(function(p){
    assert(nav.indexOf('data-panel="' + p + '"') !== -1, 'nav missing ' + p);
  });
  assert((nav.match(/<button/g) || []).length === 5, 'nav should have exactly 5 buttons');
  assert(body.indexOf('class="tabs"') === -1, 'duplicate top tab row should be removed');
});

test('Install moved from the nav to Settings and is wired up', function(){
  assert(body.indexOf('installNavBtn') === -1, 'installNavBtn should be gone');
  assert(body.indexOf('id="installSettingsBtn"') !== -1, 'Settings should have an Install app button');
  assert(/getElementById\('installSettingsBtn'\)/.test(html), 'Install app button must be wired in JS');
  assert(/closeModal\('settingsModal'\);\s*openModal\('installModal'\)/.test(html), 'Install should close Settings before opening the install modal');
});

test('stream chips: "All streams" chip is tagged and wider; chips are centered', function(){
  const tagged = (html.match(/allChip\.className = 'stream-chip all'/g) || []).length;
  assert(tagged === 2, 'both the Log and Stats "All" chips should carry the "all" class (found ' + tagged + ')');
  assert(/\.stream-chip\.all\{flex:1\.4 1 0;/.test(css), '.stream-chip.all should be wider than the others');
  assert(/\.stream-chip\{[^}]*text-align:center/.test(css), 'stream chips should center their text');
});

test('Today/Week/Month share one card; Month miles is kept; expenses use a real minus sign', function(){
  assert((body.match(/class="odo-col"/g) || []).length === 3, 'expected 3 odo columns');
  ['odoToday','odoWeek','odoMonth','odoMiles'].forEach(function(id){
    assert(body.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  assert((html.match(/textContent = '\\u2212'\+fmtMoney/g) || []).length === 3, 'expense sub-values should use the \\u2212 minus sign');
});

test('wake status: one "Listening for" line under the mic, not duplicated in the hint', function(){
  const toggleAt = body.indexOf('id="wakeToggle"');
  const hintAt = body.indexOf('id="micHint"');
  assert(toggleAt !== -1 && hintAt !== -1 && toggleAt < hintAt, 'wake toggle should sit directly under the mic, before the hint');
  assert(!/micHint\.innerHTML\s*=\s*fillAppName\(t\('wakeListeningLabel'\)\)/.test(html), 'hint must not repeat the "Listening for" label');
  assert(!/wakeToggle\.textContent\s*=\s*'(🎙️|⏸) '/.test(html), 'wake toggle should not use emoji prefixes');
});

test('clock shows no seconds', function(){
  assert(!/second:'2-digit'/.test(html), 'clock should not tick seconds');
});
