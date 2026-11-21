import { readFile, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';

export class SceneDiagnosticError extends Error {}

export class SceneInfrastructureError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.code = code;
  }
}

const maxErrorCharacters = 2000;
const maxStderrCharacters = 8192;

const resourceFiles = ['pids.current', 'pids.max', 'pids.events', 'memory.current', 'memory.max', 'memory.events'];

export async function resourceSnapshot(read = readFile) {
  return Object.fromEntries(await Promise.all(resourceFiles.map(async name => {
    try { return [name, String(await read(`/sys/fs/cgroup/${name}`, 'utf8')).trim().slice(0, 512)]; }
    catch { return [name, null]; }
  })));
}

export async function filesystemSnapshot(paths = [tmpdir(), '/dev/shm'], inspect = statfs) {
  return Object.fromEntries(await Promise.all(paths.map(async path => {
    try {
      const info = await inspect(path);
      return [path, { type: info.type, totalBytes: info.blocks * info.bsize, availableBytes: info.bavail * info.bsize, availableInodes: info.ffree }];
    } catch { return [path, null]; }
  })));
}

export function reportSceneFailure(error, context, write = console.error) {
  write('scene_request_failed', JSON.stringify({
    ...context,
    name: error.name,
    message: String(error.message ?? error).slice(0, maxErrorCharacters),
    code: error.code,
    signal: error.signal,
    killed: error.killed,
    stderrTail: typeof error.stderr === 'string' ? error.stderr.slice(-maxStderrCharacters) : undefined,
  }));
}
