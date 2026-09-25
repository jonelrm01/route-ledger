'use strict';
// Shared utilities for GigHelper's regression tests.
//
// The app is a single-file HTML/JS PWA (index.html) with no build step and
// no module system, so these tests don't import "the app" the normal way.
// Instead, they extract specific functions/objects straight out of the real
// index.html at test-run time (by name, brace-matched) and execute them in
// a minimal Node vm sandbox with just the mocks each test needs (a fake
// localStorage, a fake DOM element, etc).
//
// Why this matters: it means a test here is checking the ACTUAL shipped
// code, not a hand-typed copy of what that code is supposed to do. If a
// future edit changes categoriesForStream() or shareBackupNow() in
// index.html, these tests re-extract the new version automatically — no
// separate copy to keep in sync, no risk of the test quietly drifting from
// reality the way one-off session tests could.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_HTML_PATH = path.join(__dirname, '..', 'index.html');

function loadHtml(){
  return fs.readFileSync(APP_HTML_PATH, 'utf8');
}

function extractScript(html){
  const m = html.match(/<script>([\s\S]*)<\/script>/);
  if(!m) throw new Error('No <script> tag found in index.html');
  return m[1];
}

// Extracts one top-level `function name(...) { ... }` declaration's full
// source (matching braces, so nested `{ }` inside the function are fine).
function extractFn(html, name){
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{');
  const m = re.exec(html);
  if(!m) throw new Error('Function not found in index.html: ' + name);
  const start = m.index + m[0].indexOf('{');
  let depth = 0;
  for(let i = start; i < html.length; i++){
    if(html[i] === '{') depth++;
    else if(html[i] === '}'){
      depth--;
      if(depth === 0) return html.slice(m.index, i + 1);
    }
  }
  throw new Error('Unbalanced braces extracting function: ' + name);
}

// Extracts a top-level `var NAME = { ... }` object literal (e.g. I18N,
// HELP_CONTENT) by brace-matching, and evaluates it into a real object.
function extractObjectLiteral(html, varName){
  const marker = 'var ' + varName + ' = {';
  const idx = html.indexOf(marker);
  if(idx === -1) throw new Error('Object literal not found: ' + varName);
  const start = html.indexOf('{', idx);
  let depth = 0, end = -1;
  for(let i = start; i < html.length; i++){
    if(html[i] === '{') depth++;
    else if(html[i] === '}'){ depth--; if(depth === 0){ end = i; break; } }
  }
  if(end === -1) throw new Error('Unbalanced braces extracting object: ' + varName);
  return eval('(' + html.slice(start, end + 1) + ')'); // eslint-disable-line no-eval
}

// Runs one or more extracted source strings together in a fresh vm sandbox
// seeded with `mocks`, then returns the sandbox so the test can call into
// it and inspect whatever state it left behind (localStorage writes, DOM
// mutations on a fake element, etc).
function runInSandbox(sources, mocks){
  const sandbox = Object.assign({ console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Promise: Promise }, mocks || {});
  vm.createContext(sandbox);
  const code = Array.isArray(sources) ? sources.join('\n') : sources;
  vm.runInContext(code, sandbox);
  return sandbox;
}

module.exports = { loadHtml, extractScript, extractFn, extractObjectLiteral, runInSandbox, APP_HTML_PATH };
