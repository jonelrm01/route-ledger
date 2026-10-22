'use strict';
// Each stream (Driving, Dojo, Personal, ...) gets its own report. These
// tests run the real buildSummaryText / csvContent / streamScopeName from
// index.html against a small fake data set.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

const ENTRIES = [
  { ts: '2026-10-12T10:00:00', type: 'income',  stream: 'Driving',  category: 'DoorDash', amount: 100, miles: 0 },
  { ts: '2026-10-12T11:00:00', type: 'expense', stream: 'Driving',  category: 'Gas',      amount: 20,  miles: 0 },
  { ts: '2026-10-12T12:00:00', type: 'mileage', stream: 'Driving',  category: 'Trip',     amount: 0,   miles: 12 },
  { ts: '2026-10-12T13:00:00', type: 'income',  stream: 'Dojo',     category: 'Services', amount: 300, miles: 0 },
  { ts: '2026-10-12T14:00:00', type: 'expense', stream: 'Personal', category: 'Groceries', amount: 55, miles: 0 }
];

function makeSandbox(filter){
  const src = [
    "var DEFAULT_STREAMS = ['Driving'];",
    "var streams = ['Driving','Dojo','Personal'];",
    "var statStreamFilter = " + JSON.stringify(filter) + ";",
    "var appName = 'Katana';",
    "var currentCurrency = 'USD';",
    "var ENTRIES = " + JSON.stringify(ENTRIES) + ";",
    "function allEntries(){ return ENTRIES; }",
    "function entriesInRange(){ return ENTRIES; }",
    "function summarize(list){ var s={income:0,expense:0,net:0,miles:0}; list.forEach(function(e){ if(e.type==='income') s.income+=e.amount; else if(e.type==='expense') s.expense+=e.amount; else if(e.type==='mileage') s.miles+=e.miles; }); s.net=s.income-s.expense; return s; }",
    "function t(k){ return ({incomeLabel:'Income',expenseLabel:'Expenses',netLabel:'Net',milesLabel:'Miles',netPerMileLabel:'Net per mile',byCategoryLabel:'By category',byStreamLabel:'By stream'})[k] || k; }",
    "function fmtMoney(n){ return '$' + n.toFixed(2); }",
    "function milesToDisplay(m){ return m; }",
    "function distUnitLabel(){ return 'mi'; }",
    "function categoryLabel(c){ return c; }",
    "function mileageSourceOf(){ return 'manual'; }",
    extractFn(html, 'streamScopeName'),
    extractFn(html, 'applyStatStreamFilter'),
    extractFn(html, 'buildSummaryText'),
    extractFn(html, 'csvContent')
  ];
  return runInSandbox(src);
}

const START = new Date('2026-10-12T00:00:00');
const END = new Date('2026-10-19T00:00:00');

test('a single stream report is titled with that stream and only counts that stream', function(){
  const sb = makeSandbox('Dojo');
  const text = sb.buildSummaryText('Weekly summary', START, END);
  assert.ok(text.split('\n')[0].indexOf('Katana') === 0 && text.split('\n')[0].indexOf('Dojo') !== -1, 'header should name the stream: ' + text.split('\n')[0]);
  assert.ok(text.indexOf('Income: $300.00') !== -1, 'Dojo income only');
  assert.ok(text.indexOf('Expenses: $0.00') !== -1, "other streams' expenses must not leak in");
  assert.ok(text.indexOf('By stream') === -1, 'a single-stream report has no per-stream breakdown');
});

test('Driving report excludes Dojo and Personal', function(){
  const sb = makeSandbox('Driving');
  const text = sb.buildSummaryText('Weekly summary', START, END);
  assert.ok(text.indexOf('Income: $100.00') !== -1);
  assert.ok(text.indexOf('Expenses: $20.00') !== -1);
  assert.ok(text.indexOf('Net: $80.00') !== -1);
  assert.ok(text.indexOf('Groceries') === -1 && text.indexOf('Services') === -1, 'no categories from other streams');
});

test('"All streams" report breaks each stream out on its own line', function(){
  const sb = makeSandbox('all');
  const text = sb.buildSummaryText('Weekly summary', START, END);
  assert.ok(text.indexOf('By stream:') !== -1, 'should have a By stream section');
  assert.ok(/Driving: Net \$80\.00 \(\+\$100\.00 \/ -\$20\.00\) · 12\.0 mi/.test(text), 'Driving line: ' + text);
  assert.ok(/Dojo: Net \$300\.00/.test(text), 'Dojo line');
  assert.ok(/Personal: Net \$-55\.00/.test(text), 'Personal line');
  assert.ok(text.split('\n')[0].indexOf('Dojo') === -1, 'combined header names no single stream');
});

test('stream CSV only has that stream; the full backup export still has every entry', function(){
  const sb = makeSandbox('all');
  const dojo = sb.csvContent('Dojo').split('\n');
  assert.strictEqual(dojo.length, 2, 'header + 1 Dojo row');
  assert.ok(dojo[1].indexOf('"Dojo"') !== -1);
  const all = sb.csvContent().split('\n');
  assert.strictEqual(all.length, 1 + ENTRIES.length, 'no-argument export (backup) must include all entries');
});

test('exportCsv(stream) is not treated as a backup; the Stats button and Log nav wiring', function(){
  assert.ok(/exportCsv\(streamScopeName\(\)\)/.test(html), 'Stats Export CSV button should pass the selected stream');
  const fn = extractFn(html, 'exportCsv');
  assert.ok(/if\(!scoped\)\{[\s\S]*gh_last_export/.test(fn), 'only a full export may reset the backup reminder');
  assert.ok(/syncStatStreamToLog\(\)/.test(html), 'Stats should open on the stream shown in the Log tab');
});

test('report buttons name the stream and the new i18n key exists in every language', function(){
  assert.ok(/function updateReportButtonLabels/.test(html));
  const langs = (html.match(/byStreamLabel:/g) || []).length;
  assert.strictEqual(langs, 8, 'byStreamLabel should be defined for all 8 languages (found ' + langs + ')');
});
