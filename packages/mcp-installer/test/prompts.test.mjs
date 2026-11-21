import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import test from 'node:test';
import { confirm, input, password, select } from '@inquirer/prompts';
import { createPromptUI } from '../src/prompts.mjs';

const nextRender = () => new Promise(setImmediate);

async function renderPrompt(t, name, config, { columns = 80, env = {}, keys = ['\r'] } = {}) {
  const inputStream = new PassThrough();
  const output = new PassThrough();
  output.columns = columns;
  const writes = [];
  output.on('data', (chunk) => writes.push(chunk.toString()));
  const controller = new AbortController();
  t.after(() => { controller.abort(); inputStream.destroy(); output.destroy(); });
  const ui = createPromptUI({ confirm, input, password, select }, { stream: { isTTY: true, columns }, env });
  const pending = ui[name](config, { input: inputStream, output, signal: controller.signal });
  await nextRender();
  const initial = writes.join('');
  for (const key of keys) {
    inputStream.write(key);
    await nextRender();
  }
  const result = await pending;
  return { result, initial, text: stripVTControlCharacters(writes.join('')), raw: writes.join('') };
}

for (const columns of [40, 80]) {
  test(`real select prompt at ${columns} columns highlights only the active choice and supports keyboard navigation`, { timeout: 5000 }, async (t) => {
    const rendered = await renderPrompt(t, 'select', { message: 'Client', choices: ['OpenCode V2', 'Claude Code', 'Codex'] }, { columns, keys: ['\x1b[B', '\r'] });
    assert.equal(rendered.result, 'Claude Code');
    assert.match(rendered.initial, /\x1b\[36m> OpenCode V2\x1b\[39m/);
    assert.match(rendered.text, /Up\/down/);
    if (columns === 40) assert.match(rendered.text, /Ctrl\+C cancels/);
    assert.match(rendered.text, /- Client Claude Code/);
    assert.doesNotMatch(rendered.raw, /\x1b\[(32|33|35)m/);
  });
}

test('long lists are bounded to five visible choices and collapse to a short answer', { timeout: 5000 }, async (t) => {
  const rendered = await renderPrompt(t, 'select', {
    message: 'Style', choices: Array.from({ length: 13 }, (_, i) => ({ name: `Style ${i}`, short: `style-${i}`, value: i })),
  });
  assert.equal(rendered.result, 0);
  const initial = stripVTControlCharacters(rendered.initial);
  assert.match(initial, /Style 4/);
  assert.doesNotMatch(initial, /Style 5/);
  assert.match(rendered.text, /- Style style-0/);
});

for (const env of [{ NO_COLOR: '' }, { TERM: 'dumb' }]) {
  test(`prompt theme honors ${Object.keys(env)[0]} without relying on color for selection`, { timeout: 5000 }, async (t) => {
    const rendered = await renderPrompt(t, 'select', { message: 'Client', choices: ['OpenCode', 'Codex'] }, { env });
    assert.match(rendered.text, /> OpenCode/);
    assert.doesNotMatch(rendered.raw, /\x1b\[\d+m/);
  });
}

test('password entry stays masked and its completed answer hides even the key length', { timeout: 5000 }, async (t) => {
  const secret = 'private-test-value';
  const rendered = await renderPrompt(t, 'password', { message: 'API key', mask: '*' }, { keys: [secret, '\x14', '\r'] });
  assert.equal(rendered.result, secret);
  assert.ok(!rendered.text.includes(secret));
  assert.doesNotMatch(rendered.text, /toggle visibility/);
  assert.match(rendered.text, /- API key \[hidden\]/);
});

test('default-no confirmation and inline input validation are preserved', { timeout: 5000 }, async (t) => {
  const confirmation = await renderPrompt(t, 'confirm', { message: 'Replace settings?', default: false });
  assert.equal(confirmation.result, false);
  assert.match(confirmation.text, /\(y\/N\)/);
  const field = await renderPrompt(t, 'input', {
    message: 'URL', validate: (value) => value === 'valid' || 'Enter a valid URL',
  }, { keys: ['\r', 'valid', '\r'] });
  assert.equal(field.result, 'valid');
  assert.match(field.text, /Error: Enter a valid URL/);
});
