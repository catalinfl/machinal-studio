import assert from 'node:assert/strict';
import test from 'node:test';
import { DIRECT_TOOLS, installDirectTools } from '../src/opencode-tools.mjs';

test('common tools bypass Code Mode search without changing execution, schemas or permissions', async () => {
  const transforms = [];
  const hooks = [];
  const ctx = {
    tool: { transform: async (fn) => { transforms.push(fn); } },
    session: { hook: async (_event, hook) => { hooks.push(hook); } },
  };
  await installDirectTools(ctx, new Map([['team.direction', 'endpoint']]).keys());
  for (let reload = 0; reload < 2; reload++) {
    const execute = async () => {};
    const tools = new Map([...DIRECT_TOOLS, 'render_video'].map((name) => [
      `team_direction_${name}`, { input: { required: ['original'] }, execute,
        options: { namespace: 'team_direction', codemode: true, pinned: true, permission: `original_${name}` } },
    ]));
    for (const transform of transforms) transform({ update: (id, update) => { if (tools.has(id)) update(tools.get(id)); } });
    for (const name of DIRECT_TOOLS) {
      const tool = tools.get(`team_direction_${name}`);
      assert.equal(tool.options.codemode, false);
      assert.equal(tool.options.namespace, 'team_direction');
      assert.equal(tool.options.permission, `original_${name}`);
      assert.equal(tool.options.pinned, undefined);
      assert.equal(tool.execute, execute);
      assert.deepEqual(tool.input, { required: ['original'] });
      assert.ok(tool.description.includes(`direct native tool team_direction_${name}`));
      assert.match(tool.description, /not callable.*inside execute/);
    }
    assert.equal(tools.get('team_direction_render_video').options.codemode, true);
  }
  const event = { system: [] };
  for (const hook of hooks) hook(event);
  assert.match(event.system[0].text, /Discover only unknown tools/);
  assert.match(event.system[0].text, /Web search latency/);
  const guidance = event.system.map(part => part.text).join('\n');
  assert.ok(guidance.includes('team_direction_get_job_result'));
  for (const text of ['recipeFile', 'compositionFile', 'Never invent compression', 'userApproved asserts existing permission', 'never auto-approve', 'EACCES is infrastructure']) {
    assert.ok(guidance.includes(text), `missing integration guidance: ${text}`);
  }
});
