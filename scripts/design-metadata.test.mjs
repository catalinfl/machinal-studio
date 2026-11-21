import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { refreshDesignMetadata } from './refresh-design-metadata.mjs';

const root = new URL('../', import.meta.url);
const document = await readFile(new URL('DESIGN.md', root), 'utf8');
const css = await readFile(new URL('client/src/styles/editor-suite.css', root), 'utf8');
const current = JSON.parse(await readFile(new URL('.impeccable/design.json', root), 'utf8'));
const at = '2026-11-08T00:00:00.000Z';

test('refresh follows declared frontmatter, preserves other surface records and reports actual CSS separately', () => {
  const before = structuredClone(current);
  const result = refreshDesignMetadata(current, document, css, at);
  assert.deepEqual(current, before, 'The input object is not mutated');
  assert.equal(result.generatedAt, at);
  assert.equal(result.extensions.colorMeta.datum.canonical, '#8ba8ff');
  assert.equal(result.extensions.colorMeta.command.canonical, '#181c23');
  assert.equal(result.extensions.colorMeta['cobalt-action'], undefined);
  assert.ok(Object.values(result.extensions.colorMeta).every(token => token.tonalRamp.length === 8));
  assert.equal(result.extensions.editorSuite.implementedTokens['--primary'], 'light-dark(#7047c7, #c6adff)');
  assert.match(result.extensions.editorSuite.typography.interface, /IBM Plex Sans/);
  assert.match(result.extensions.sourceRefresh.conflicts[0], /graphite.*paper\/plum/);
  for (const key of ['homepage', 'authenticatedPages', 'sceneGeneration', 'machinalBrandMark']) {
    assert.deepEqual(result.extensions[key], current.extensions[key]);
  }
});

test('narrative retains exact documented language and source hashes without claiming new visual checks', () => {
  const result = refreshDesignMetadata(current, document, css, at);
  assert.equal(result.narrative.northStar, 'The post-production suite');
  assert.ok(document.includes(result.narrative.overview));
  for (const line of [...result.narrative.dos, ...result.narrative.donts]) assert.ok(document.includes(line));
  for (const rule of result.narrative.rules) assert.ok(document.includes(rule.body));
  assert.equal(result.extensions.sourceRefresh.sources['DESIGN.md'], createHash('sha256').update(document).digest('hex'));
  assert.equal(result.extensions.sourceRefresh.visualInspection, false);
  assert.equal(result.extensions.sourceRefresh.designDocumentPreserved, true);
});

test('refreshed previews have isolated CSS, accessible controls and no stale cobalt fallback', () => {
  const result = refreshDesignMetadata(current, document, css, at);
  assert.equal(result.components.length, 5);
  for (const component of result.components) {
    assert.match(component.html, /ds-/);
    assert.match(component.css, /:hover/);
    assert.match(component.css, /:focus-visible/);
    assert.doesNotMatch(component.css, /#275bd8|#1f4fc2|#193f9e/);
    assert.equal(component.refersTo, undefined);
  }
  assert.match(result.components.find(item => item.name === 'Tool Ribbon').html, /aria-pressed/);
  assert.match(result.components.find(item => item.name === 'Icon Button').html, /aria-label/);
});

test('refresh is deterministic with a retained timestamp and rejects unsupported frontmatter instead of guessing', () => {
  const result = refreshDesignMetadata(current, document, css, at);
  assert.deepEqual(refreshDesignMetadata(result, document, css, at), result);
  assert.throws(() => refreshDesignMetadata(current, document.replace('  datum: "#8ba8ff"', '  datum: { unknown: true }'), css, at), /Unsupported colors scalar/);
});
