#!/usr/bin/env node
'use strict';
// Turns the in-app User guide (HELP_CONTENT in index.html) into
// support-agent/Knowledge.gs, the only source of facts the email agent may
// use. Run it whenever the guide changes:
//
//     node tools/build-knowledge.js
//
// A test fails if Knowledge.gs is out of date, so the agent can never answer
// from an old manual.
const fs = require('fs');
const path = require('path');
const { extractObjectLiteral } = require('../tests/helpers');

const ROOT = path.join(__dirname, '..');
const LANGS = ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'];

function generate(html) {
  const help = extractObjectLiteral(html, 'HELP_CONTENT');
  const out = {};
  LANGS.forEach(function (lang) {
    if (!help[lang]) throw new Error('HELP_CONTENT has no ' + lang);
    out[lang] = {
      title: help[lang].title,
      sections: help[lang].sections.map(function (s) { return { title: s.title, body: s.body }; })
    };
  });
  return [
    '// AUTO-GENERATED from the in-app User guide (HELP_CONTENT in index.html).',
    '// Do not edit by hand. Rebuild with: node tools/build-knowledge.js',
    '// This is the ONLY source of facts the support agent may use.',
    'var KNOWLEDGE = ' + JSON.stringify(out, null, 2) + ';',
    ''
  ].join('\n');
}

module.exports = { generate: generate, LANGS: LANGS };

if (require.main === module) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const src = generate(html);
  fs.writeFileSync(path.join(ROOT, 'support-agent', 'Knowledge.gs'), src, 'utf8');
  console.log('support-agent/Knowledge.gs written (' + src.length + ' characters).');
}
