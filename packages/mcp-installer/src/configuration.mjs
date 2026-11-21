import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { InstallerError } from './errors.mjs';
import { serverEntry, updateJSON, updateTOML } from './formats.mjs';
import { configureOpenCodeAuth } from './opencode-configuration.mjs';

const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function chooseJSONFile(directory) {
  const json = join(directory, 'opencode.json');
  const jsonc = join(directory, 'opencode.jsonc');
  const [hasJSON, hasJSONC] = await Promise.all([exists(json), exists(jsonc)]);
  if (hasJSON && hasJSONC) {
    throw new InstallerError('Both opencode.json and opencode.jsonc exist in the target directory. Consolidate them before setup.');
  }
  return hasJSON ? json : jsonc;
}

export async function configurationPath({ client, scope, cwd = process.cwd(), home = homedir(), env = process.env }) {
  if (!['project', 'global'].includes(scope)) throw new InstallerError('Choose project or global scope.');
  if (client === 'opencode') {
    if (scope === 'global') return chooseJSONFile(join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode'));
    const nested = join(cwd, '.opencode');
    if (await exists(join(nested, 'opencode.json')) || await exists(join(nested, 'opencode.jsonc'))) {
      return chooseJSONFile(nested);
    }
    return chooseJSONFile(cwd);
  }
  if (client === 'claude') {
    if (scope === 'global' && env.CLAUDE_CONFIG_DIR) {
      throw new InstallerError('Custom CLAUDE_CONFIG_DIR is not supported for global setup. Use project scope or the Claude CLI.');
    }
    return scope === 'global' ? join(home, '.claude.json') : join(cwd, '.mcp.json');
  }
  if (client === 'codex') return join(scope === 'global' ? env.CODEX_HOME || join(home, '.codex') : join(cwd, '.codex'), 'config.toml');
  throw new InstallerError('Choose opencode, claude, or codex.');
}

async function snapshot(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new InstallerError('The target configuration must be a regular file, not a symlink.');
    }
    if (stat.size > MAX_CONFIG_BYTES) throw new InstallerError('The configuration exceeds the 2 MiB safety limit.');
    return { original: await readFile(file, 'utf8'), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === 'ENOENT') return { original: null, mode: 0o600 };
    throw error;
  }
}

export async function planConfiguration(options) {
  if (!/^[a-z\d][a-z\d_-]{0,63}$/i.test(options.name)) {
    throw new InstallerError('Server names must start with a letter or number and contain at most 64 letters, numbers, hyphens, or underscores.');
  }
  const file = await configurationPath(options);
  const previous = await snapshot(file);
  const entry = serverEntry(options.client, options.url, options.mode === 'local');
  const updated = options.client === 'codex'
    ? updateTOML(previous.original ?? '', options.name, entry)
    : updateJSON(previous.original ?? '', options.client, options.name, entry);
  const automaticAuth = options.mode !== 'local' && options.client === 'opencode' && (options.platform ?? process.platform) === 'win32';
  if (automaticAuth) updated.content = configureOpenCodeAuth(updated.content, options.name, options.url);
  return { file, ...previous, ...updated, automaticAuth };
}

export async function planTextFile(file, content) {
  return { file, ...await snapshot(file), content };
}

async function writeExclusive(file, content, mode) {
  const handle = await open(file, 'wx', mode);
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function ensureParentDirectory(file, { mkdirImpl = mkdir } = {}) {
  const directory = dirname(file);
  if (dirname(directory) !== directory) await mkdirImpl(directory, { recursive: true });
}

export async function saveConfiguration(plan) {
  try {
    return await writeConfiguration(plan);
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    if (['EACCES', 'EPERM'].includes(error.code)) {
      throw new InstallerError(`Could not save the client configuration: access denied (${error.code}). Run setup from a writable project folder or choose global scope. Check filesystem permissions and read-only/locked files.`);
    }
    if (['ENOSPC', 'EDQUOT'].includes(error.code)) {
      throw new InstallerError('Could not save the client configuration: disk space or quota exhausted. Free some space and retry.');
    }
    throw new InstallerError('Could not save the client configuration. Check the target directory, write permissions, available disk space, and locked files.');
  }
}

async function writeConfiguration(plan) {
  if (plan.original === plan.content) return { changed: false };
  await ensureParentDirectory(plan.file);
  const lock = `${plan.file}.machinal-lock`;
  let handle;
  try {
    handle = await open(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') throw new InstallerError('Another setup may be editing this configuration. Retry after it finishes; inspect any stale .machinal-lock file.');
    throw error;
  }

  const temporary = `${plan.file}.machinal-${randomUUID()}.tmp`;
  try {
    if ((await snapshot(plan.file)).original !== plan.original) {
      throw new InstallerError('The configuration changed during setup. Run setup again; no settings were overwritten.');
    }
    let backup;
    if (plan.original !== null) {
      backup = `${plan.file}.machinal-backup-${Date.now()}-${randomUUID()}`;
      await writeExclusive(backup, plan.original, 0o600);
    }
    await writeExclusive(temporary, plan.content, plan.mode);
    if ((await snapshot(plan.file)).original !== plan.original) {
      throw new InstallerError('The configuration changed during setup. Run setup again; no settings were overwritten.');
    }
    await rename(temporary, plan.file);
    return { changed: true, backup };
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    await handle.close();
    await unlink(lock);
  }
}
