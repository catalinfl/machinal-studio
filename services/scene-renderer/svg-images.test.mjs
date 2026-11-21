import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, compile } from 'svelte/compiler';
import { normalizeSvgImages } from './svg-images.mjs';

function normalize(source) {
  return normalizeSvgImages(source, parse(source).html);
}

test('normalizes SVG image tags and dynamic sources without changing script strings or HTML images', () => {
  const source = `<script>const text = '<img src="example">'; let { images } = $props();</script><img src={images.image_1} /><svg><g><img src={images.image_1} width="80" height="80" /></g></svg>`;
  const normalized = normalize(source);
  assert.ok(normalized.startsWith(source.slice(0, source.indexOf('<svg>'))));
  assert.match(normalized, /<image href=\{images.image_1\} width="80" height="80"\s+preserveAspectRatio="xMidYMid meet"\/>/);
  assert.doesNotThrow(() => compile(normalized, { runes:true }));
  assert.equal(normalize(normalized), normalized);
});

test('follows SVG namespaces through conditional, each and await branches', () => {
  const source = `<svg>{#if true}<img src="a" />{:else}<img src="b" />{/if}{#each [1] as item}<img src={item} />{/each}{#await Promise.resolve(1)}<img src="pending" />{:then value}<img src={value} />{:catch error}<img src={error.message} />{/await}</svg>`;
  const normalized = normalize(source);
  assert.equal((normalized.match(/<image href=/g) ?? []).length, 6);
  assert.doesNotMatch(normalized, /<img/);
  assert.doesNotThrow(() => compile(normalized, { runes:true }));
});

test('retains HTML images in foreignObject while normalizing nested SVG images', () => {
  const source = '<svg><foreignObject><div><img src="html" /><svg><g><img src="svg" /></g></svg></div></foreignObject><image href="valid" /></svg>';
  const normalized = normalize(source);
  assert.match(normalized, /<div><img src="html" \/><svg><g><image href="svg"/);
  assert.match(normalized, /<image href="valid" \/>/);
});

test('handles shorthand sources, non-self-closing HTML images and existing SVG aspect ratios', () => {
  const normalized = normalize('<script>const src="image";</script><svg><img {src} width="80"><img src="b" preserveAspectRatio="none" /></svg>');
  assert.match(normalized, /<image href=\{src\} width="80" preserveAspectRatio="xMidYMid meet" \/>/);
  assert.equal((normalized.match(/preserveAspectRatio="none"/g) ?? []).length, 1);
  assert.doesNotThrow(() => compile(normalized, { runes:true }));
});

test('preserves contain, cover and fill image positioning', () => {
  const normalized = normalize('<svg><img src="a" style="object-fit:contain" /><img src="b" style="object-fit:cover" /><img src="c" style="object-fit:fill" /></svg>');
  assert.match(normalized, /href="a"[^>]+preserveAspectRatio="xMidYMid meet"/);
  assert.match(normalized, /href="b"[^>]+preserveAspectRatio="xMidYMid slice"/);
  assert.match(normalized, /href="c"[^>]+preserveAspectRatio="none"/);
});
