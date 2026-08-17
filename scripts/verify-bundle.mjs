// Bundle reproducer — loads the bundle in jsdom and checks for runtime errors
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html lang="zh-Hant"><body><div id="root"></div></body></html>', {
  url: 'https://savetheday.io/',
  runScripts: 'outside-only',
});

global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(global, 'navigator', { value: { userAgent: dom.window.navigator.userAgent }, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.localStorage = dom.window.localStorage;
global.sessionStorage = dom.window.sessionStorage;
global.location = dom.window.location;
global.MutationObserver = dom.window.MutationObserver;
global.IntersectionObserver = dom.window.IntersectionObserver;
global.ResizeObserver = dom.window.ResizeObserver;
global.matchMedia = dom.window.matchMedia || (() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
global.self = dom.window;

let caughtError = null;
process.on('uncaughtException', (e) => {
  if (!caughtError) caughtError = e.message;
});
process.on('unhandledRejection', (e) => {
  if (!caughtError) caughtError = e.message || String(e);
});

import fs from 'node:fs';
const bundlePath = process.argv[2];
const bundle = fs.readFileSync(bundlePath, 'utf8');
console.log('Bundle:', bundlePath);

fs.writeFileSync('/tmp/run-bundle-temp.mjs', bundle);
try {
  await import('/tmp/run-bundle-temp.mjs');
} catch (e) {
  if (!caughtError) caughtError = e.message;
}

await new Promise(r => setTimeout(r, 2000));

const root = dom.window.document.getElementById('root');
const body = root.innerHTML;
const isErrorPage = body.includes('技術詳情') || body.includes('System error') || body.includes('系統發生錯誤');

console.log('Caught error:', caughtError ? caughtError.substring(0, 200) : '(none)');
console.log('Renders error page:', isErrorPage);
console.log('Root body (first 300):', body.substring(0, 300));

const exitCode = (caughtError || isErrorPage) ? 1 : 0;
console.log('Exit code:', exitCode);
process.exit(exitCode);