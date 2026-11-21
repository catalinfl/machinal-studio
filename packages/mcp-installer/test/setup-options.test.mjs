import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseEndpoint, chooseSkillOptions, DEFAULT_LOCAL_URL } from '../src/setup-options.mjs';

test('the interactive wizard distinguishes an existing server from this user’s local Docker', async () => {
  const prompts = [];
  const ui = {
    select: async (question) => { prompts.push(question); return 'local'; },
    input: async (question) => { prompts.push(question); return question.default; },
  };
  assert.deepEqual(await chooseEndpoint({}, { env: {}, interactive: true, ui }), { mode: 'local', url: DEFAULT_LOCAL_URL });
  assert.equal(prompts[0].message, 'API location');
  assert.deepEqual(prompts[0].choices.map((choice) => choice.value), ['server', 'local']);
  assert.equal(prompts[0].choices[0].name, 'Server — machinal account');
  assert.match(prompts[0].choices[0].description, /Hosted API.*account and credits/);
  assert.equal(prompts[1].default, DEFAULT_LOCAL_URL);
});

test('switching from a hosted environment default to local does not reuse the hosted URL', async () => {
  let defaultURL;
  const ui = {
    select: async () => 'local',
    input: async (question) => { defaultURL = question.default; return 'http://localhost:9090'; },
  };
  assert.deepEqual(await chooseEndpoint({}, { env: { MACHINAL_API_ORIGIN: 'https://hosted.example' }, interactive: true, ui }), { mode: 'local', url: 'http://localhost:9090/mcp' });
  assert.equal(defaultURL, DEFAULT_LOCAL_URL);
});

test('server selection offers development localhost without guessing a production domain', async () => {
  const ui = {
    select: async () => 'server',
    input: async (question) => { assert.equal(question.default, DEFAULT_LOCAL_URL); return 'https://my-api.example'; },
  };
  assert.deepEqual(await chooseEndpoint({}, { env: {}, interactive: true, ui }), { mode: 'server', url: 'https://my-api.example/mcp' });
  await assert.rejects(chooseEndpoint({ mode: 'hosted' }, { env: {}, interactive: false }), /Specify --url/);
});

test('existing directional API-origin settings still work as a migration alias', async () => {
  const context = { env: { DIRECTION_API_ORIGIN: 'https://legacy.example' }, interactive: false };
  assert.deepEqual(await chooseEndpoint({}, context), { mode: 'server', url: 'https://legacy.example/mcp' });
});

test('mode flags work unattended, infer existing --url usage, and reject contradictory addresses', async () => {
  const context = { env: {}, interactive: false };
  assert.deepEqual(await chooseEndpoint({ mode: 'local' }, context), { mode: 'local', url: DEFAULT_LOCAL_URL });
  assert.deepEqual(await chooseEndpoint({ url: 'https://api.example' }, context), { mode: 'server', url: 'https://api.example/mcp' });
  assert.deepEqual(await chooseEndpoint({ mode: 'server', url: DEFAULT_LOCAL_URL }, context), { mode: 'server', url: DEFAULT_LOCAL_URL });
  assert.deepEqual(await chooseEndpoint({ mode: 'hosted', url: DEFAULT_LOCAL_URL }, context), { mode: 'server', url: DEFAULT_LOCAL_URL });
  assert.deepEqual(await chooseEndpoint({ url: DEFAULT_LOCAL_URL }, context), { mode: 'server', url: DEFAULT_LOCAL_URL });
  for (const values of [{ mode: 'invalid' }, { mode: 'local', url: 'https://api.example' }]) {
    await assert.rejects(chooseEndpoint(values, context));
  }
});

test('interactive URLs are validated without exiting or echoing credentials', async () => {
  const ui = { input: async (question) => {
    assert.match(question.validate('http://bad.example'), /HTTPS/);
    assert.match(question.validate('https://api.example'), /loopback/);
    assert.equal(question.validate(DEFAULT_LOCAL_URL), true);
    return DEFAULT_LOCAL_URL;
  } };
  await chooseEndpoint({ mode: 'local' }, { env: {}, interactive: true, ui });
});

test('bundled skills are optional and style selection is validated', async () => {
  assert.equal(await chooseSkillOptions({ 'no-skills': true }, { interactive: false }), null);
  assert.deepEqual(await chooseSkillOptions({}, { interactive: false }), { style: 'auto' });
  assert.deepEqual(await chooseSkillOptions({ style: 'cinematic' }, { interactive: false }), { style: 'cinematic' });
  for (const values of [{ style: 'unsupported' }, { style: 'social', 'no-skills': true }, { 'replace-skills': true, 'no-skills': true }]) {
    await assert.rejects(chooseSkillOptions(values, { interactive: false }));
  }
  assert.equal(await chooseSkillOptions({}, { interactive: true, ui: { confirm: async () => false } }), null);
});
