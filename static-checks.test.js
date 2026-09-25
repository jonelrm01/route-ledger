'use strict';
const { loadHtml, extractScript } = require('./helpers');

const html = loadHtml();

test('index.html inline script has valid JS syntax', function(){
  const src = extractScript(html);
  new Function(src); // throws SyntaxError if the script doesn't parse
});

test('index.html has no duplicate element IDs', function(){
  const ids = html.match(/id="[a-zA-Z0-9_]*"/g) || [];
  const counts = {};
  ids.forEach(function(id){ counts[id] = (counts[id] || 0) + 1; });
  const dupes = Object.keys(counts).filter(function(id){ return counts[id] > 1; });
  if(dupes.length){
    throw new Error('Duplicate IDs found (breaks getElementById lookups): ' + dupes.join(', '));
  }
});
