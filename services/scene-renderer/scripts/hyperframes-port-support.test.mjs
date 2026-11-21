import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceElements, localizeFontFaces, shaderComponent } from './hyperframes-port-support.mjs';
import { normalizeReservedIdentifiers, modernizeCanvasCapture } from './hyperframes-media.mjs';

test('HTML extraction ignores documentation and strings inside executable scripts', () => {
  const source = '<!-- <style>fake</style> --><style>.real{color:red}</style>'
    + '<script>const example="<style>not CSS</style>";</script>';
  assert.deepEqual(sourceElements(source, 'style').map(node => node.content), ['.real{color:red}']);
  assert.equal(sourceElements(source, 'script').length, 1);
});

test('local fonts keep the declared alias and avoid unavailable local-only faces', () => {
  const result = localizeFontFaces('<style>@font-face{font-family:"ChatUI";font-weight:500;'
    + 'src:url("assets/fonts/inter-latin-500-normal.woff2")}@font-face{font-family:"Apple Color Emoji";'
    + 'src:local("Apple Color Emoji")}</style>');
  assert.equal(result.definitions[0].family, 'ChatUI');
  assert.equal(result.definitions[0].weight, '500');
  assert.doesNotMatch(result.html, /@font-face/);
});

test('Svelte-reserved dollar bindings are adapted without editing currency strings', () => {
  const source = 'const $ = selector => document.querySelector(selector); const label = "$"; $("main");';
  const output = normalizeReservedIdentifiers(source);
  assert.match(output, /const __hfSelect/);
  assert.match(output, /label = "\$"/);
  assert.match(output, /__hfSelect\("main"\)/);
});

test('HTML-in-canvas uses the pinned Chromium signature and retains layoutsubtree', () => {
  const output = modernizeCanvasCapture('gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, content);'
    + 'canvas.setAttribute("layoutsubtree", "");');
  assert.match(output, /uploadHyperframeElement\(gl, gl\.TEXTURE_2D, content, __hfScene\.resources\)/);
  assert.match(output, /setAttribute\("layoutsubtree", ""\)/);
});

test('WebGPU adapters await real GPU resources and never replace the shader with a blank fallback', () => {
  const component = shaderComponent({ id: 'blocks-aurora' }, '<canvas data-shader="Aurora"></canvas>', '', { width: 1920, height: 1080 });
  assert.match(component, /@machinal\/hyperframes\/shaders/);
  assert.match(component, /resources\.track\(runtime\.ready\)/);
  assert.match(component, /resources\.track\(runtime\.seek\(time\)\)/);
  assert.match(component, /runtime\.dispose\(\)/);
  assert.doesNotMatch(component, /requestAnimationFrame|setTimeout|iframe/);
});
