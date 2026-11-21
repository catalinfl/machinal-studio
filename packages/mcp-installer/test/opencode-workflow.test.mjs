import assert from 'node:assert/strict';
import test from 'node:test';
import { installWorkflowStartup } from '../src/opencode-workflow.mjs';

async function fixture(ids = ['machinal-editing', 'machinal-cinema', 'machinal-review']) {
  const hooks = new Map();
  await installWorkflowStartup({
    skill: { list: async () => ids.map(id => ({ id })) },
    session: { hook: async (name, callback) => hooks.set(name, callback) },
  });
  return async prompt => { await hooks.get('prompt')({ prompt }); return prompt; };
}

test('video creation attaches installed production skills through native resolution, once, without altering copy', async () => {
  const admit = await fixture();
  for (const text of ['Creează un video documentar despre București', 'Create a cinematic film about the moon', 'Editează acest video', 'Creează un video folosind machinal MCP']) {
    const prompt = { text, files: [{ uri: 'file:///source.mp4' }], skills: [{ id: 'custom' }] };
    await admit(prompt);
    await admit(prompt);
    assert.deepEqual(prompt.skills.map(skill => skill.id), ['custom', 'machinal-editing', 'machinal-cinema', 'machinal-review']);
    assert.equal(prompt.text, text);
    assert.equal(prompt.files.length, 1);
  }
});

test('legacy skill duplicates disappear only when their machinal replacement exists', async () => {
  const skills = new Map(['machinal-editing', 'directional-editing', 'directional-support', 'unrelated'].map(id => [id, { id }]));
  await installWorkflowStartup({
    skill: { transform: async callback => callback({ get: id => skills.get(id), remove: id => skills.delete(id) }) },
    session: { hook: async () => {} },
  });
  assert.deepEqual([...skills.keys()], ['machinal-editing', 'directional-support', 'unrelated']);
});

test('selected production skills work with short briefs and missing installations are not invented', async () => {
  const admit = await fixture(['machinal-cinema']);
  const prompt = await admit({ text: 'Tu decizi', skills: [{ id: 'machinal-scenes' }] });
  assert.deepEqual(prompt.skills, [{ id: 'machinal-scenes' }, { id: 'machinal-cinema' }]);
});

test('renderer debugging, code reviews and ambiguous questions do not trigger a production flow', async () => {
  const admit = await fixture();
  for (const text of ['Repară rendererul video și skill-ul cinema', 'Create a test for the video API', 'Cum fac un film?', 'Vreau informații despre cinema']) {
    const prompt = await admit({ text });
    assert.equal(prompt.skills, undefined, text);
  }
});
