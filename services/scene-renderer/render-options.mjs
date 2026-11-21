import { availableParallelism, freemem } from 'node:os';
import { readFile } from 'node:fs/promises';

const MiB = 1024 * 1024;
const presets = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);

export function renderOptions(config, env = process.env, resources = {}) {
  const cpus = Math.max(1, Math.floor(resources.cpus ?? availableParallelism()));
  const memory = resources.memory ?? freemem();
  const perWorker = Math.max(384 * MiB, config.width * config.height * 160);
  // Leave room for Node, PNG buffers and FFmpeg instead of using every free byte.
  const memoryWorkers = Math.max(1, Math.floor((memory - 512 * MiB) / perWorker));
  const requested = env.SCENE_WORKERS === undefined || env.SCENE_WORKERS === 'auto'
    ? Math.min(4, cpus)
    : integerOption(env.SCENE_WORKERS, 'SCENE_WORKERS', 1, 16);
  const workers = Math.min(requested, memoryWorkers, config.durationInFrames);
  const threads = env.SCENE_ENCODER_THREADS === undefined || env.SCENE_ENCODER_THREADS === 'auto'
    ? Math.min(4, Math.max(1, cpus - workers))
    : integerOption(env.SCENE_ENCODER_THREADS, 'SCENE_ENCODER_THREADS', 1, 32);
  const preset = env.SCENE_X264_PRESET ?? 'ultrafast';
  if (!presets.has(preset)) throw new Error('Invalid SCENE_X264_PRESET');
  if (env.SCENE_ENABLE_GPU !== undefined && !['true', 'false'].includes(env.SCENE_ENABLE_GPU)) throw new Error('SCENE_ENABLE_GPU must be true or false');
  return { workers, threads, preset, gpu: env.SCENE_ENABLE_GPU === 'true', lossless: true };
}

function integerOption(value, name, min, max) {
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return Number(value);
}

async function text(path) {
  try { return await readFile(path, 'utf8'); } catch { return ''; }
}

export async function renderResources() {
  let cpus = availableParallelism();
  const [quota, limit, current, meminfo, v1Quota, v1Period, v1Limit, v1Current] = await Promise.all([
    text('/sys/fs/cgroup/cpu.max'), text('/sys/fs/cgroup/memory.max'), text('/sys/fs/cgroup/memory.current'), text('/proc/meminfo'),
    text('/sys/fs/cgroup/cpu/cpu.cfs_quota_us'), text('/sys/fs/cgroup/cpu/cpu.cfs_period_us'),
    text('/sys/fs/cgroup/memory/memory.limit_in_bytes'), text('/sys/fs/cgroup/memory/memory.usage_in_bytes'),
  ]);
  const [amount, period] = quota.trim().split(/\s+/).map(Number);
  if (amount > 0 && period > 0) cpus = Math.min(cpus, Math.max(1, Math.floor(amount / period)));
  else if (Number(v1Quota) > 0 && Number(v1Period) > 0) cpus = Math.min(cpus, Math.max(1, Math.floor(Number(v1Quota) / Number(v1Period))));
  const available = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  let memory = available ? Number(available[1]) * 1024 : freemem();
  const cap = Number(limit) > 0 ? Number(limit) : Number(v1Limit);
  const used = Number(current || v1Current);
  if (cap > 0 && Number.isFinite(cap)) memory = Math.min(memory, Math.max(0, cap - used));
  return { cpus, memory };
}

export function rendererArgs(directory, filename, options) {
  const args = ['-request', `${directory}/request.json`, '-serve', directory, '-output', `${directory}/${filename}`,
    '-workers', String(options.workers), '-encoder-threads', String(options.threads), '-x264-preset', options.preset, '-lossless', '-frame-timeout', '15s'];
  if (options.gpu) args.push('-gpu');
  return args;
}
