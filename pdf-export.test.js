'use strict';
// The tax summary can be exported as a PDF built by a tiny writer inside the
// app (no libraries, works offline). These tests check the file is
// structurally valid (xref offsets, page tree), that long reports break
// across pages, that text wraps inside the margins, and that characters
// outside the PDF font's range degrade to "?" instead of corrupting the file.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();
function grab(re, label){ const m = html.match(re); if(!m) throw new Error('not found: ' + label); return m[0]; }

const sb = runInSandbox([
  grab(/var PDF_HELV_WIDTHS = \[[^\]]*\];/, 'PDF_HELV_WIDTHS'),
  grab(/var PDF_WINANSI_MAP = \{[^}]*\};/, 'PDF_WINANSI_MAP'),
  extractFn(html, 'pdfWinAnsi'), extractFn(html, 'pdfEsc'), extractFn(html, 'pdfTextWidth'),
  extractFn(html, 'pdfWrap'), extractFn(html, 'buildPdfBytes')
]);

function pdfString(lines, title){
  const bytes = Array.from(sb.buildPdfBytes(title || 'Test — Tax Summary 2026', lines));
  return bytes.map(function(b){ return String.fromCharCode(b); }).join('');
}
const sample = [
  'GigHelper — Tax Summary', '1/1/2026 to 10/29/2026', '',
  'GROSS INCOME', '  Tow call: $5000.00', '  Total gross income: $5000.00', '',
  'ESTIMATED NET PROFIT', '  = $3590.00'
];

test('output is a well-formed PDF: header, trailer and correct xref offsets', function(){
  const pdf = pdfString(sample);
  assert.strictEqual(pdf.indexOf('%PDF-1.4'), 0);
  assert.ok(/%%EOF\n$/.test(pdf));
  const startxref = parseInt(pdf.match(/startxref\n(\d+)\n%%EOF/)[1], 10);
  assert.strictEqual(pdf.substr(startxref, 4), 'xref', 'startxref must point at the xref table');
  const count = parseInt(pdf.substr(startxref).match(/xref\n0 (\d+)\n/)[1], 10);
  const entries = pdf.substr(startxref).match(/\d{10} \d{5} [nf] \n/g);
  assert.strictEqual(entries.length, count, 'one xref entry per object');
  entries.slice(1).forEach(function(e, i){
    const off = parseInt(e.slice(0, 10), 10);
    assert.strictEqual(pdf.substr(off, String(i + 1).length + 6), (i + 1) + ' 0 obj', 'object ' + (i + 1) + ' offset is wrong');
  });
});

test('stream /Length matches the real content length', function(){
  const pdf = pdfString(sample);
  const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
  let m, seen = 0;
  while((m = re.exec(pdf))){ seen++; assert.strictEqual(parseInt(m[1], 10), m[2].length); }
  assert.ok(seen >= 1);
});

test('a short report is one page; a long report breaks across pages with matching page tree', function(){
  assert.strictEqual(parseInt(pdfString(sample).match(/\/Count (\d+)/)[1], 10), 1);
  const long = [];
  for(let i = 0; i < 200; i++) long.push('  Category ' + i + ': $' + (i * 10) + '.00');
  const pdf = pdfString(['Title'].concat(long));
  const pagesDeclared = parseInt(pdf.match(/\/Count (\d+)/)[1], 10);
  assert.ok(pagesDeclared >= 4, 'expected several pages, got ' + pagesDeclared);
  assert.strictEqual((pdf.match(/\/Type \/Page \/Parent/g) || []).length, pagesDeclared);
  assert.ok(pdf.indexOf('Page ' + pagesDeclared + ' of ' + pagesDeclared) !== -1, 'footer must show the final page number');
});

test('widths table covers every printable ASCII character', function(){
  assert.strictEqual(sb.PDF_HELV_WIDTHS.length, 95);
});

test('long text wraps inside the margins, including an unbreakable word', function(){
  const maxW = 300;
  const text = sb.pdfWinAnsi('Which method you may use has IRS rules and the standard rate generally must be chosen in the first year ' + 'x'.repeat(120));
  const out = Array.from(sb.pdfWrap(text, 10, maxW, false));
  assert.ok(out.length > 2);
  out.forEach(function(l){ assert.ok(sb.pdfTextWidth(l, 10, false) <= maxW + 0.01, 'line too wide: ' + l); });
  assert.strictEqual(out.join('').replace(/ /g, ''), text.replace(/ /g, ''), 'no text may be lost by wrapping');
});

test('characters outside the PDF font range degrade safely', function(){
  assert.strictEqual(sb.pdfWinAnsi('a\u2212b'), 'a-b', 'minus sign becomes a hyphen');
  assert.strictEqual(sb.pdfWinAnsi('x\u2014y'), 'x\x97y', 'em dash maps to its WinAnsi byte');
  assert.strictEqual(sb.pdfWinAnsi('76\u00A2'), '76\xA2');
  assert.strictEqual(sb.pdfWinAnsi('\u6C49\u5B57'), '??', 'Chinese prints as ? rather than corrupting the file');
  assert.strictEqual(sb.pdfWinAnsi('caf\u00E9'), 'caf\xE9', 'Latin-1 letters pass through');
  const pdf = pdfString(['Title', '  Stream \u6C49\u5B57 (test) back\\slash: $1.00']);
  assert.ok(pdf.indexOf('\\(test\\)') !== -1, 'parentheses are escaped');
  assert.ok(pdf.indexOf('back\\\\slash') !== -1, 'backslashes are escaped');
  assert.ok(Array.from(pdf).every(function(ch){ return ch.charCodeAt(0) < 256; }), 'every output char must fit in one byte');
});

test('wiring: PDF button exists, follows US-only visibility, and reuses the same report builder', function(){
  assert.ok(html.indexOf('id="exportTaxPdf"') !== -1);
  assert.ok(/exportPdfBtn\.style\.display = \(currentCountry === 'US'\)/.test(html), 'PDF button must hide outside the US like the text button');
  const pdfFn = extractFn(html, 'exportTaxSummaryPdf');
  assert.ok(pdfFn.indexOf('buildTaxSummary()') !== -1 && pdfFn.indexOf('buildPdfBytes') !== -1);
  assert.ok(pdfFn.indexOf("'application/pdf'") !== -1);
  assert.ok(extractFn(html, 'exportTaxSummary').indexOf('buildTaxSummary()') !== -1, 'text and PDF exports must share one report');
});
