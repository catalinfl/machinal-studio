import { execFile, spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { InstallerError } from './errors.mjs';
import { DEFAULT_LOCAL_URL } from './setup-options.mjs';
import { DOCKER_URL } from './presentation.mjs';

const exec = promisify(execFile);
const COMPOSE_FILE = 'compose.editengine.yaml';
const SERVICES = ['api', 'scene-renderer', 'client'];

function runQuietly(args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { ...options, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve('') : reject(new Error('Docker did not complete successfully')));
  });
}

export async function runDocker(args, { cwd, env, timeout = 15_000, discardOutput = false } = {}) {
  const { MACHINAL_API_KEY: _machinalKey, DIRECTION_API_KEY: _legacyKey, ...childEnv } = env ?? process.env;
  try {
    const options = { cwd, env: childEnv, timeout, windowsHide: true };
    if (discardOutput) return await runQuietly(args, options);
    return (await exec('docker', args, { ...options, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    const missing = error.code === 'ENOENT';
    throw new InstallerError(missing
      ? `Docker was not found. Install Docker Desktop/Engine: ${DOCKER_URL}. Start it, then rerun setup. Your client settings were not changed.`
      : 'Docker could not complete the operation. Check that Docker Desktop/Engine is running, the selected context is local, ports are free, and disk space/network access are available. Check Docker locally for details; container output is not printed because it may contain secrets.', { code: missing ? 'docker-missing' : 'docker-failed' });
  }
}

async function regularFile(file) {
  try { return (await lstat(file)).isFile(); } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw new InstallerError('Could not inspect the local checkout. Check folder permissions or use --docker-dir with a readable checkout.');
  }
}

export async function findCheckout(start, explicit) {
  let root = resolve(start, explicit ?? '.');
  while (true) {
    if ((await Promise.all(['.machinal-local.json', COMPOSE_FILE, 'api/Dockerfile', 'services/scene-renderer/Dockerfile'].map((file) => regularFile(join(root, file))))).every(Boolean)) return root;
    if (explicit || dirname(root) === root) return null;
    root = dirname(root);
  }
}

function localDaemon(host) {
  if (host.startsWith('unix://') || host.startsWith('npipe://')) return true;
  try {
    const url = new URL(host);
    return url.protocol === 'tcp:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch { return false; }
}

export async function prepareLocalDocker(values, url, context) {
  const { cwd, env, interactive, ui, log } = context;
  if (new URL(url).port !== new URL(DEFAULT_LOCAL_URL).port) {
    throw new InstallerError('No API is listening at this local URL. The bundled Docker checkout exposes port 8080. Start your custom deployment yourself, or rerun with --mode local --url http://127.0.0.1:8080/mcp. No Docker changes were made.');
  }
  const root = await findCheckout(cwd, values['docker-dir']);
  if (!root) throw new InstallerError('No running local API or machinal-local checkout was found. Use --docker-dir PATH to your standalone checkout containing .machinal-local.json and compose.editengine.yaml. No .env, machinal account or key is required; add your own OpenRouter key in the local editor only when needed. To use an existing authenticated deployment, choose Server. No unverified image is downloaded.');
  const docker = context.docker ?? ((args, options = {}) => runDocker(args, { cwd: root, env, ...options }));
  const compose = ['compose', '--project-directory', root, '-f', join(root, COMPOSE_FILE)];
  log(`Local Docker checkout: ${root}. Checking Docker, containers, and images (no changes yet)...`);
  await docker(['info', '--format', '{{.ServerVersion}}']);
  const host = !env.DOCKER_CONTEXT && env.DOCKER_HOST
    ? env.DOCKER_HOST
    : await docker(['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), '--format', '{{.Endpoints.docker.Host}}']);
  if (!localDaemon(host)) throw new InstallerError('Local mode requires a local Docker daemon; the current Docker context points elsewhere. Switch to a local context yourself, or choose Server. No Docker changes were made.');
  await docker(['compose', 'version', '--short']);
  const containers = await docker([...compose, 'ps', '--all', '--format', '{{.Service}}: {{.State}}', ...SERVICES]);
  log(containers ? `Docker containers: ${containers.replace(/[\r\n]+/g, '; ')}` : 'Docker containers: not created yet.');
  const images = (await docker([...compose, 'config', '--images'])).split(/\r?\n/).filter(Boolean);
  let build = images.length === 0;
  for (const image of images) {
    try { await docker(['image', 'inspect', '--format', '{{.Id}}', image]); } catch (error) {
      if (error.code !== 'docker-failed') throw error;
      build = true;
    }
  }
  log(build ? 'Docker images: missing; a local build is needed (first build may take several minutes).' : 'Docker images: already available; existing images can be reused.');
  const message = `${build ? 'Build missing images and start' : 'Start'} the local editor, API and scene renderer from ${root}? This may download base images, use disk/CPU and create user-owned persistent volumes. Ports are loopback-only. Existing volumes will not be deleted.`;
  const approved = values['start-docker'] || (interactive && await ui.confirm({ message, default: false }));
  if (!approved) throw new InstallerError('Docker was not started. Start the checkout yourself or explicitly use --start-docker with --mode local. --yes alone never authorizes starting/building containers. Existing client settings and Docker volumes were preserved.');
  log(`Docker: ${build ? 'building and starting' : 'starting'} services. Please wait; detailed output stays private.`);
  await docker([...compose, 'up', '-d', ...(build ? ['--build'] : []), '--wait', '--wait-timeout', '120', ...SERVICES], { timeout: 15 * 60_000, discardOutput: true });
  log(`Docker ready: API at ${url}. Verifying MCP next; Docker readiness does not prove account/provider access. Containers keep running after setup; manage them from ${root}.`);
}
