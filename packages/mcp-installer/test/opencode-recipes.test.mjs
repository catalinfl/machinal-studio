import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { installRecipeFiles } from '../src/opencode-recipes.mjs';
import { installCheckpoints } from '../src/opencode-checkpoints.mjs';

const recipe = 'document:\n  version: 2\n  texts:\n    - text: "Dacă lumea — René Guénon ș ț"\n      words: [{text: "Dacă", start: 0, end: 1}]\n';
const operations = ['validate_recipe', 'compile_recipe', 'generate_assets', 'render_video', 'get_job_result'];

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'machinal-recipe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const transforms = [];
  const calls = [];
  const permissions = [];
  const ctx = {
    tool: { transform: async fn => { transforms.push(fn); } },
    permission: { assert: async input => { permissions.push(input); } },
  };
  await installRecipeFiles(ctx, ['custom-server']);
  await installCheckpoints(ctx, ['custom-server']);
  const response = { statusCode: 200, data: { status: 'completed', recipeYaml: recipe, cost: { knownCredits: 2 }, compositionVersion: `sha256:${'a'.repeat(64)}`, captionVersion: `sha256:${'b'.repeat(64)}`, diagnostics: [], requirements: [] } };
  const createTools = () => {
    const tools = new Map(operations.map(name => [`custom-server_${name}`, {
      input: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'], additionalProperties: false },
      description: name, options: { permission: 'original' },
      execute: async (input, context) => {
        calls.push({ name, input, context });
        return { content: JSON.stringify(response) };
      },
    }]));
    for (const transform of transforms) transform({ update: (id, fn) => { if (tools.has(id)) fn(tools.get(id)); } });
    return tools;
  };
  const context = { signal: new AbortController().signal, sessionID: 'session', agent: 'build', messageID: 'message', id: 'call' };
  return { directory, ctx, calls, permissions, createTools, context, response };
}

test('local recipes reach every original MCP executor verbatim with permissions and paid safeguards intact after refresh', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'final.edit.yaml');
  await writeFile(path, recipe, 'utf8');
  for (let refresh = 0; refresh < 2; refresh++) {
    const tools = f.createTools();
    for (const name of operations.slice(0, 4)) {
      const tool = tools.get(`custom-server_${name}`);
      const args = { projectId: 'owned', compositionFile: path, idempotencyKey: 'same-key', userApproved: true, expectedCompositionVersion: 'sha256:keep' };
      await tool.execute(args, f.context);
      const last = f.calls.at(-1);
      assert.equal(last.input.composition, recipe);
      assert.equal(last.input.compositionFile, undefined);
      assert.equal(last.input.idempotencyKey, 'same-key');
      assert.equal(last.input.expectedCompositionVersion, 'sha256:keep');
      assert.equal(last.input.userApproved, true);
      assert.equal(last.context, f.context);
      assert.equal(tool.options.permission, 'original');
      assert.equal(f.permissions.at(-1).action, 'read');
    }
  }
});

test('timing and preflight checkpoints automate exact hashes and caption guards without changing consent or idempotency', async t => {
  const f = await fixture(t);
  const tools = f.createTools();
  const baseline = join(f.directory, 'timing.checkpoint.json');
  const recipeFile = join(f.directory, 'timing.edit.yaml');
  await tools.get('custom-server_get_job_result').execute({ projectId: 'owned', jobId: 'existing', recipeFile, checkpointFile: baseline }, f.context);
  const saved = JSON.parse(await readFile(baseline, 'utf8'));
  assert.equal(saved.jobId, 'existing');
  assert.equal(saved.captionVersion, f.response.data.captionVersion);
  assert.equal(await readFile(recipeFile, 'utf8'), recipe);
  const checkpoint = join(f.directory, 'preflight.checkpoint.json');
  await tools.get('custom-server_validate_recipe').execute({ projectId: 'owned', compositionFile: recipeFile, captionBaselineFile: baseline, checkpointFile: checkpoint }, f.context);
  assert.equal(f.calls.at(-1).input.expectedCaptionVersion, saved.captionVersion);
  assert.equal(f.calls.at(-1).input.checkpointFile, undefined);
  await tools.get('custom-server_render_video').execute({ projectId: 'owned', compositionFile: recipeFile, checkpointFile: checkpoint, captionBaselineFile: baseline, userApproved: false, idempotencyKey: 'unchanged' }, f.context);
  assert.equal(f.calls.at(-1).input.expectedCompositionVersion, saved.compositionVersion);
  assert.equal(f.calls.at(-1).input.expectedCaptionVersion, saved.captionVersion);
  assert.equal(f.calls.at(-1).input.userApproved, false);
  assert.equal(f.calls.at(-1).input.idempotencyKey, 'unchanged');
});

test('checkpoint failures preserve originals and block invalid paid continuations before the MCP executor', async t => {
  const f = await fixture(t);
  const tools = f.createTools();
  const path = join(f.directory, 'preflight.checkpoint.json');
  const input = { projectId: 'owned', composition: recipe, checkpointFile: path };
  await tools.get('custom-server_validate_recipe').execute(input, f.context);
  const intact = await readFile(path, 'utf8');
  const repeated = await tools.get('custom-server_validate_recipe').execute(input, f.context);
  assert.match(repeated.metadata.checkpointFileError, /exists/);
  assert.equal(await readFile(path, 'utf8'), intact);
  const calls = f.calls.length;
  for (const data of [
    { ...JSON.parse(intact), projectId: 'other' },
    { ...JSON.parse(intact), ready: false },
    { ...JSON.parse(intact), productionReview: { status: 'revision_required' } },
    { ...JSON.parse(intact), operation: 'get_job_result' },
  ]) {
    await writeFile(path, JSON.stringify(data), 'utf8');
    await assert.rejects(tools.get('custom-server_render_video').execute({ ...input, userApproved: true, idempotencyKey: 'same' }, f.context));
  }
  assert.equal(f.calls.length, calls);
  f.ctx.permission.assert = async () => { throw new Error('denied'); };
  await assert.rejects(tools.get('custom-server_render_video').execute(input, f.context), /denied/);
  assert.equal(f.calls.length, calls);
});

test('generation checkpoints allow declared pending jobs but rendering requires materialized preflight', async t => {
  const f = await fixture(t);
  f.response.data.requirements = [{ kind: 'image.generate' }];
  const tools = f.createTools();
  const path = join(f.directory, 'pending.checkpoint.json');
  const input = { projectId: 'owned', composition: recipe, checkpointFile: path };
  await tools.get('custom-server_validate_recipe').execute(input, f.context);
  await tools.get('custom-server_generate_assets').execute({ ...input, userApproved: true, idempotencyKey: 'image-pass' }, f.context);
  assert.equal(f.calls.at(-1).input.expectedCompositionVersion, f.response.data.compositionVersion);
  const calls = f.calls.length;
  await assert.rejects(tools.get('custom-server_render_video').execute({ ...input, userApproved: true, idempotencyKey: 'final' }, f.context));
  assert.equal(f.calls.length, calls);
});

test('existing inline and continuation calls are unchanged; mixed sources and invalid file types are rejected', async t => {
  const f = await fixture(t);
  const tool = f.createTools().get('custom-server_render_video');
  const args = { projectId: 'owned', sourceJobId: 'job', userApproved: false };
  await tool.execute(args, f.context);
  assert.deepEqual(f.calls.at(-1).input, args);
  assert.equal(f.permissions.length, 0);
  for (const input of [
    { compositionFile: 'relative.edit.yaml' },
    { compositionFile: join(f.directory, '.env') },
    { compositionFile: join(f.directory, 'a.edit.yaml'), composition: recipe },
    { compositionFile: join(f.directory, 'a.edit.yaml'), sourceJobId: 'job' },
  ]) await assert.rejects(tool.execute(input, f.context));
  assert.equal(f.calls.length, 1);
});

test('authorized caption edits send the intact baseline for exact field comparison without weakening host permissions', async t => {
  const f = await fixture(t);
  const baseline = join(f.directory, 'baseline.edit.yaml');
  await writeFile(baseline, recipe, 'utf8');
  const tool = f.createTools().get('custom-server_compile_recipe');
  const input = { projectId: 'owned', composition: recipe.replace('Guénon', 'Guénon!'), captionBaselineRecipeFile: baseline,
    captionTextEdits: [{ from: 'Guénon', to: 'Guénon!' }], captionEditsApproved: true };
  await tool.execute(input, f.context);
  assert.equal(f.calls.at(-1).input.captionBaseline, recipe);
  assert.equal(f.calls.at(-1).input.captionBaselineRecipeFile, undefined);
  assert.deepEqual(f.calls.at(-1).input.captionTextEdits, input.captionTextEdits);
  assert.equal(f.permissions.at(-1).action, 'read');
  f.ctx.permission.assert = async () => { throw new Error('denied'); };
  await assert.rejects(tool.execute(input, f.context), /denied/);
  assert.equal(f.calls.length, 1);
});

test('file permission rejection propagates before any read or paid MCP submission', async t => {
  const f = await fixture(t);
  const rejection = new Error('host denied');
  f.ctx.permission.assert = async () => { throw rejection; };
  await assert.rejects(f.createTools().get('custom-server_render_video').execute({ compositionFile: join(f.directory, 'final.edit.yaml') }, f.context), error => error === rejection);
  assert.equal(f.calls.length, 0);
});

test('invalid UTF-8 and files over 2 MiB cannot be submitted', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'invalid.edit.yaml');
  const tool = f.createTools().get('custom-server_validate_recipe');
  await writeFile(path, Buffer.from([0xff, 0xfe]));
  await assert.rejects(tool.execute({ compositionFile: path }, f.context));
  await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(tool.execute({ compositionFile: path }, f.context), /2 MiB/);
  assert.equal(f.calls.length, 0);
});

test('resolved result is saved exactly once as UTF-8 with a compact receipt, never overwriting or regenerating', async t => {
  const f = await fixture(t);
  const path = join(f.directory, 'resolved.edit.yaml');
  const tool = f.createTools().get('custom-server_get_job_result');
  const result = await tool.execute({ projectId: 'owned', jobId: 'existing', recipeFile: path }, f.context);
  assert.equal(await readFile(path, 'utf8'), recipe);
  const data = JSON.parse(result.content).data;
  assert.equal(data.recipeYaml, undefined);
  assert.equal(data.recipeFile.bytes, Buffer.byteLength(recipe));
  assert.match(data.recipeFile.sha256, /^[a-f0-9]{64}$/);
  assert.equal(data.cost.knownCredits, 2);
  assert.deepEqual(f.calls[0].input, { projectId: 'owned', jobId: 'existing' });
  await writeFile(path, 'user work');
  const conflict = await tool.execute({ projectId: 'owned', jobId: 'existing', recipeFile: path }, f.context);
  assert.equal(await readFile(path, 'utf8'), 'user work');
  assert.equal(JSON.parse(conflict.content).data.recipeYaml, recipe);
  assert.match(conflict.metadata.recipeFileError, /Destination exists/);
  assert.ok(f.calls.every(call => call.name === 'get_job_result'));
});
