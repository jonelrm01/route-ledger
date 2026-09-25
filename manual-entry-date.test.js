'use strict';
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

test('tsForDateInput builds a timestamp on the chosen calendar day, at noon local (dodges DST/timezone day-boundary shifts)', function(){
  const fn = extractFn(html, 'tsForDateInput');
  const sandbox = runInSandbox(fn);
  const d = new Date(sandbox.tsForDateInput('2026-09-20'));
  assert.strictEqual(d.getFullYear(), 2026);
  assert.strictEqual(d.getMonth(), 8);
  assert.strictEqual(d.getDate(), 20);
  assert.strictEqual(d.getHours(), 12);
});

test('tsForDateInput handles a year boundary correctly', function(){
  const fn = extractFn(html, 'tsForDateInput');
  const sandbox = runInSandbox(fn);
  const d = new Date(sandbox.tsForDateInput('2025-12-31'));
  assert.strictEqual(d.getFullYear(), 2025);
  assert.strictEqual(d.getMonth(), 11);
  assert.strictEqual(d.getDate(), 31);
});

test('tsForDateInput falls back to a valid "now" timestamp when given an empty string', function(){
  const fn = extractFn(html, 'tsForDateInput');
  const sandbox = runInSandbox(fn);
  const out = sandbox.tsForDateInput('');
  assert.strictEqual(typeof out, 'string');
  assert.ok(!isNaN(new Date(out).getTime()), 'fallback should still be a parseable date');
});
