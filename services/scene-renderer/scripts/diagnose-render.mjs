import { appendFileSync, mkdirSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [sourceFile, outputDirectory] = process.argv.slice(2);
if (!sourceFile || !outputDirectory) throw new Error('Usage: node diagnose-render.mjs saved.scene.json NEW_OUTPUT_DIRECTORY');
const output = resolve(outputDirectory);
mkdirSync(output, { recursive: false });
const logFile = join(output, 'render.jsonl');
for (const level of ['info', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), level, event: args[0], details: args.slice(1) })}\n`);
    original(...args);
  };
}

const serviceRoot = process.env.DIAGNOSTIC_SERVICE_ROOT ?? resolve(import.meta.dirname, '..');
const { renderComponent } = await import(pathToFileURL(join(serviceRoot, 'render.mjs')));
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const input = { component: source.component, config: source.config, images: source.images ?? {}, videos: source.videos ?? {} };
const workers = (process.env.DIAGNOSTIC_WORKERS ?? '4,1,4').split(',');
if (workers.some(value => !/^(?:[1-9]|1[0-6])$/.test(value))) throw new Error('DIAGNOSTIC_WORKERS must contain worker counts from 1 to 16');
process.env.SCENE_CACHE_MAX_BYTES = '0';

async function resources(label) {
  const paths = ['memory.current', 'memory.peak', 'memory.max', 'memory.events', 'pids.current', 'pids.events', 'cpu.stat', 'cpu.pressure', 'memory.pressure'];
  const values = await Promise.all(paths.map(async path => {
    try { return [path, (await readFile(`/sys/fs/cgroup/${path}`, 'utf8')).trim()]; }
    catch { return [path, 'unavailable']; }
  }));
  console.info('diagnostic_resources', { label, ...Object.fromEntries(values), processes: await processCounts() });
}

async function processCounts() {
  try {
    const entries = (await readdir('/proc')).filter(name => /^\d+$/.test(name));
    const statuses = await Promise.all(entries.map(async name => {
      try { return await readFile(`/proc/${name}/status`, 'utf8'); }
      catch { return ''; }
    }));
    return { total: statuses.filter(Boolean).length, zombies: statuses.filter(status => /^State:\s+Z/m.test(status)).length };
  } catch { return null; }
}

const summary = [];
for (const [index, count] of workers.entries()) {
  const label = `run-${index + 1}-workers-${count}`;
  process.env.SCENE_WORKERS = count;
  const started = performance.now();
  await resources(`${label}-start`);
  const sampling = setInterval(() => { resources(label).catch(error => console.warn('diagnostic_sampling_failed', error.message)); }, 5000);
  let result;
  try {
    result = await renderComponent(input, new AbortController().signal, { requestId: label });
    const { scene, ...manifest } = result.manifest;
    await writeFile(join(output, `${label}.manifest.json`), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    summary.push({ label, success: true, elapsedMs: Math.round(performance.now() - started), bytes: result.bytes, metrics: manifest.metrics });
  } catch (error) {
    const failure = { label, success: false, elapsedMs: Math.round(performance.now() - started), message: error.message.slice(0, 2000), stderrTail: String(error.stderr ?? '').slice(-8192) };
    console.error('diagnostic_render_failed', failure);
    summary.push(failure);
  } finally {
    await result?.dispose();
    clearInterval(sampling);
    await resources(`${label}-end`);
    await writeFile(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  }
}
console.info('diagnostic_summary', summary);
process.exitCode = summary.some(run => !run.success) ? 1 : 0;
