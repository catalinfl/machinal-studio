import { spawn as spawnProcess } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { InstallerError } from './errors.mjs';

export async function promptWindowsKey({ endpoint, apiKeysURL, signal, platform = process.platform, spawn = spawnProcess }) {
  if (platform !== 'win32') throw new InstallerError('Secure desktop key entry is available on Windows. No saved key was changed.');
  if (signal?.aborted) return null;
  const script = await readFile(new URL('./windows-key-prompt.ps1', import.meta.url), 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', '-'], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, MACHINAL_AUTH_ENDPOINT: endpoint, MACHINAL_AUTH_KEYS_URL: apiKeysURL },
    });
    let output = '';
    let failed = false;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > 16_384) { failed = true; output = ''; child.kill(); }
    });
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.on('error', () => { failed = true; });
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) return resolve(null);
      if (!failed && code === 0) {
        try { return resolve(JSON.parse(output)); } catch {}
      }
      reject(new InstallerError('Could not open secure machinal key entry. The saved key was not changed.'));
    });
    child.stdin.end(script);
  });
}
