import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.LOCAL_VERIFY_API || 'http://127.0.0.1:18090';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Test only an explicitly selected loopback installation');
const directory = resolve(process.env.LOCAL_VERIFY_DIRECTORY || '.local-verification');
await mkdir(directory, { recursive: true });
assert.equal((await readdir(directory)).length, 0, 'Select a new LOCAL_VERIFY_DIRECTORY; existing verification evidence is never overwritten');

const runtime = await (await fetch(`${origin}/runtime`)).json();
assert.equal(runtime.mode, 'local');
assert.equal(runtime.applicationKeyRequired, false);
assert.equal(runtime.cloudStorage, false);
assert.equal(runtime.ai.configured, false, 'Synthetic verification must use an installation with no AI key');

let sequence = 0;
async function rpc(method, params = {}) {
  const response = await fetch(`${origin}/mcp`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params }),
  });
  assert.equal(response.status, 200, `${method} HTTP ${response.status}`);
  const reply = await response.json();
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  return reply.result;
}

async function tool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  const output = result.structuredContent;
  assert.ok(!result.isError, `${name}: ${JSON.stringify(output || result.content)}`);
  assert.ok(output.statusCode < 400, `${name}: ${JSON.stringify(output)}`);
  return output.data;
}

const handshake = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'local-synthetic-verification', version: '1' } });
assert.equal(handshake.serverInfo.name, 'machinal-local');
const tools = await rpc('tools/list');
assert.ok(!tools.tools.some(tool => tool.name === 'get_credits'));
const capabilities = await tool('get_capabilities');
assert.equal(capabilities.generation.clientScene.configured, true);
assert.equal(capabilities.generation.clientScene.providerRequired, false);
assert.equal(capabilities.generation.clientScene.serverRenderingBilled, false);
assert.equal(capabilities.generation.compositionPreview.billingBasis, 'none-local-hardware');
assert.equal(capabilities.generation.image.configured, false);
const brief = await tool('get_editing_reference', { topic: 'brief' });
assert.match(brief.guide, /no machinal credit wallet locally/);
const project = await tool('create_project', { name: `Synthetic local verification ${new Date().toISOString()}` });
const projectId = project.id;
assert.ok(projectId);
await tool('get_workflow_preferences');
await tool('get_download_preferences');

async function completed(jobId) {
  for (let waits = 0; waits < 5; waits++) {
    const job = await tool('wait_for_job', { projectId, jobId, timeoutSeconds: 120 });
    if (job.status === 'completed') return;
    assert.ok(!['failed', 'cancelled'].includes(job.status), JSON.stringify(job));
  }
  throw new Error(`Job ${jobId} did not complete within bounded waits; do not resubmit it automatically`);
}

const component = `<script>
  import { useScene } from '@machinal/scenes';
  const scene = useScene();
  const x = $derived(24 + scene.frame.progress * 220);
</script>
<div class="stage"><div class="square" style:transform={\`translateX(\${x}px) rotate(\${scene.frame.progress * 90}deg)\`}></div></div>
<style>.stage{position:absolute;inset:0;background:#182536;display:flex;align-items:center}.square{width:48px;height:48px;background:#e8bc70}</style>`;
const scene = await tool('compile_scene', {
  projectId, component, duration: 1, width: 320, height: 180, fps: 10,
  userApproved: true, idempotencyKey: randomUUID(), title: 'Synthetic local runtime test',
});
await completed(scene.id);
const compiled = await tool('get_job_result', { projectId, jobId: scene.id });
const asset = (compiled.result || compiled).asset;
assert.ok(asset?.file?.endsWith('.scene.json'), JSON.stringify(compiled));

const composition = `document:
  version: 2
  mode: assemble
  tracks:
    - id: synthetic
      type: video
      clips:
        - {id: shot, assetId: ${asset.id}, start: 0s, inPoint: 0s, outPoint: 1s, volume: 0}
  output: {aspect: landscape, resolution: 480p, fps: 10, format: mp4}
bindings: {}
assets: ${JSON.stringify([asset])}
`;
await writeFile(resolve(directory, 'synthetic.edit.yaml'), composition, { encoding: 'utf8', flag: 'wx' });
await tool('validate_recipe', { projectId, composition });
const render = await tool('render_video', { projectId, composition, userApproved: true, idempotencyKey: randomUUID() });
await completed(render.id);
const delivery = await tool('get_video_result', { projectId, jobId: render.id, delivery: 'link', userApproved: true });
assert.equal(delivery.download.storage, 'volume');
assert.equal(delivery.download.reachability, 'same-machine');
const output = await fetch(delivery.download.url, { redirect: 'error' });
assert.ok(output.ok);
const bytes = Buffer.from(await output.arrayBuffer());
assert.ok(bytes.length > 512);
assert.equal(bytes.subarray(4, 8).toString(), 'ftyp');
const filename = resolve(directory, 'synthetic.mp4');
await writeFile(filename, bytes, { flag: 'wx' });
await writeFile(resolve(directory, 'checkpoint.json'), JSON.stringify({ projectId, sceneJobId: scene.id, renderJobId: render.id, filename, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), providerCalls: 0 }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: 'passed', projectId, sceneJobId: scene.id, renderJobId: render.id, filename, bytes: bytes.length, providerCalls: 0 }));
