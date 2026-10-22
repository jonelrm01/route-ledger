'use strict';
// "Where your data is kept" chooser + restore-from-backup. Runs the real
// csvContent / parseBackupCsv / restoreFromCsvText from index.html.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

const ENTRIES = [
  { id: 'a1', type: 'income',  stream: 'Driving',  category: 'DoorDash',  amount: 100.5, miles: 0,  ts: '2026-10-12T15:00:00.000Z' },
  { id: 'a2', type: 'expense', stream: 'Personal', category: 'Groceries, "bulk"', amount: 55, miles: 0, ts: '2026-10-12T16:30:00.000Z' },
  { id: 'a3', type: 'mileage', stream: 'Driving',  category: 'Other',     amount: 0,   miles: 12, ts: '2026-10-12T17:00:00.000Z', source: 'gps' },
  { id: 'a4', type: 'income',  stream: 'Dojo',     category: 'Services',  amount: 300, miles: 0,  ts: '2026-10-13T12:00:00.000Z' }
];

function exportSandbox(list, unit){
  const km = unit === 'km';
  return runInSandbox([
    "var currentCurrency = 'USD'; var DEFAULT_STREAMS = ['Driving'];",
    "var ENTRIES = " + JSON.stringify(list) + ";",
    "function allEntries(){ return ENTRIES; }",
    "function distUnitLabel(){ return " + (km ? "'km'" : "'mi'") + "; }",
    "function milesToDisplay(m){ return " + (km ? "m * 1.609344" : "m") + "; }",
    "function mileageSourceOf(e){ return e.source === 'gps' ? 'gps' : 'manual'; }",
    extractFn(html, 'csvContent')
  ]);
}

function restoreSandbox(existing, streamList){
  return runInSandbox([
    "var DEFAULT_STREAMS = ['Driving'];",
    "var entries = " + JSON.stringify(existing) + "; var archivedEntries = [];",
    "var streams = " + JSON.stringify(streamList) + ";",
    "var saved = 0, savedStreams = 0, rendered = 0;",
    "function allEntries(){ return archivedEntries.concat(entries); }",
    "function saveEntries(){ saved++; } function saveStreams(){ savedStreams++; } function renderAll(){ rendered++; }",
    extractFn(html, 'newEntryId'),
    extractFn(html, 'parseCsvRows'),
    extractFn(html, 'parseBackupCsv'),
    extractFn(html, 'entryDupKey'),
    extractFn(html, 'restoreFromCsvText')
  ]);
}

test('backup CSV round-trips: ids, exact timestamps, streams, tricky categories, GPS source', function(){
  const csv = exportSandbox(ENTRIES, 'mi').csvContent();
  const parsed = restoreSandbox([], ['Driving']).parseBackupCsv(csv);
  assert.strictEqual(parsed.invalid, 0);
  assert.strictEqual(parsed.entries.length, 4);
  ENTRIES.forEach(function(orig, i){
    const got = parsed.entries[i];
    assert.strictEqual(got.id, orig.id);
    assert.strictEqual(got.ts, orig.ts, 'timestamp survives exactly (no locale parsing)');
    assert.strictEqual(got.type, orig.type);
    assert.strictEqual(got.stream, orig.stream);
    assert.strictEqual(got.category, orig.category);
    assert.strictEqual(got.amount, orig.amount);
    assert.strictEqual(Math.round(got.miles * 10) / 10, orig.miles);
  });
  assert.strictEqual(parsed.entries[2].source, 'gps');
});

test('a backup made in kilometres restores back to miles', function(){
  const csv = exportSandbox(ENTRIES, 'km').csvContent();
  const trip = restoreSandbox([], ['Driving']).parseBackupCsv(csv).entries.filter(function(e){ return e.type === 'mileage'; })[0];
  assert.ok(Math.abs(trip.miles - 12) < 0.1, 'expected ~12 mi, got ' + trip.miles);
});

test('restore adds new entries and creates streams that do not exist yet', function(){
  const csv = exportSandbox(ENTRIES, 'mi').csvContent();
  const sb = restoreSandbox([], ['Driving']);
  const r = sb.restoreFromCsvText(csv);
  assert.deepStrictEqual([r.added, r.skipped, r.invalid], [4, 0, 0]);
  assert.strictEqual(sb.entries.length, 4);
  assert.deepStrictEqual(Array.from(sb.streams).sort(), ['Dojo', 'Driving', 'Personal']);
  assert.strictEqual(sb.savedStreams, 1);
  assert.ok(sb.saved >= 1 && sb.rendered >= 1);
});

test('restoring the same backup twice never duplicates, and never touches what is already there', function(){
  const csv = exportSandbox(ENTRIES, 'mi').csvContent();
  const existing = [ENTRIES[0], { id: 'keep-me', type: 'expense', stream: 'Driving', category: 'Gas', amount: 9, miles: 0, ts: '2026-10-01T10:00:00.000Z' }];
  const sb = restoreSandbox(existing, ['Driving', 'Personal', 'Dojo']);
  const first = sb.restoreFromCsvText(csv);
  assert.deepStrictEqual([first.added, first.skipped], [3, 1], 'the entry already here is skipped');
  const second = sb.restoreFromCsvText(csv);
  assert.deepStrictEqual([second.added, second.skipped], [0, 4]);
  assert.strictEqual(sb.entries.length, 5);
  assert.ok(sb.entries.some(function(e){ return e.id === 'keep-me'; }), 'existing entries are untouched');
});

test('older exports (no ID / ISO columns) still restore, and match existing entries instead of duplicating', function(){
  const legacy = '\uFEFF"Date","Time","Type","Stream","Category","Amount (USD)","Distance (mi)","Source"\n' +
    '"10/12/2026","11:00:00 AM","income","Driving","DoorDash","100.50","0.0",""\n' +
    '"10/13/2026","8:15:00 AM","expense","Personal","Groceries","40.00","0.0",""';
  const sb = restoreSandbox([], ['Driving']);
  const r = sb.restoreFromCsvText(legacy);
  assert.deepStrictEqual([r.added, r.skipped, r.invalid], [2, 0, 0]);
  const again = sb.restoreFromCsvText(legacy);
  assert.deepStrictEqual([again.added, again.skipped], [0, 2], 'same file again = no duplicates');
});

test('junk rows are counted, not silently imported; non-GigHelper files add nothing', function(){
  const csv = '"Date","Time","Type","Stream","Category","Amount (USD)","Distance (mi)","Source","ID","Timestamp (ISO)"\n' +
    '"x","y","income","Driving","Uber","10.00","0.0","","z1","not-a-date"\n' +
    '"x","y","bonus","Driving","Uber","10.00","0.0","","z2","2026-10-12T10:00:00.000Z"\n' +
    '"x","y","income","Driving","Uber","10.00","0.0","","z3","2026-10-12T10:00:00.000Z"';
  const sb = restoreSandbox([], ['Driving']);
  const r = sb.restoreFromCsvText(csv);
  assert.deepStrictEqual([r.added, r.invalid], [1, 2]);
  const other = sb.restoreFromCsvText('name,score\nann,3\nbob,4');
  assert.deepStrictEqual([other.added, other.skipped, other.invalid], [0, 0, 0]);
});

test('chooser UI: three options, restore buttons, one-time prompt, and all 8 languages have every new string', function(){
  ['storageSection', 'storageOptions', 'restoreBackupBtn', 'restoreFileInput', 'storageModal', 'storageModalOptions', 'restoreBackupBtn2'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  ['phone', 'file', 'share'].forEach(function(m){ assert.ok(new RegExp("id:'" + m + "'").test(html), 'missing option ' + m); });
  assert.ok(/maybePromptStorageChoice\(\);\n/.test(html), 'prompt is triggered at load and after the welcome screen');
  assert.ok(/function maybePromptStorageChoice[\s\S]*?STORAGE_PROMPTED_KEY[\s\S]*?markStoragePrompted\(\)/.test(html), 'prompt is asked only once');
  const keys = ['storageTitle','storageIntro','storageModalTitle','storagePhone','storagePhoneSub','storageFile','storageFileSub','storageShare','storageShareSub','storageUnavailable','storageStatusPhone','storageStatusFile','storageStatusShare','storageRestoreBtn','storageRestoreHint','storageRestoreDone','storageRestoreNone','storageRestoreError','storageRestoreInvalid','storageLater'];
  keys.forEach(function(k){
    const n = (html.match(new RegExp('\\b' + k + ": '", 'g')) || []).length;
    assert.strictEqual(n, 8, k + ' should be defined in all 8 languages (found ' + n + ')');
  });
});

test('picking "share" shows the share controls even on browsers that also support file access', function(){
  assert.ok(/if\(fsAccessSupported && !shareModeActive\(\)\)/.test(html));
  assert.ok(/function shareModeActive\(\)\{ return loadStorageMode\(\) === 'share' && webShareFilesSupported; \}/.test(html));
});
