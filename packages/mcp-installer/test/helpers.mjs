import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API_KEY = `mach_${'a'.repeat(64)}`;
export const CLI = fileURLToPath(new URL('../bin/machinal-mcp.mjs', import.meta.url));
export const TOOLS = [{ name: 'list_projects' }, { name: 'get_recipe_schema' }, { name: 'get_credits', annotations: { readOnlyHint: true } }];
export const CREDIT_SUMMARY = {
  balance: { remaining: 900, monthlyRemaining: 800, purchasedRemaining: 100, reserved: 0, debt: 0, usagePending: false, nextReset: '2026-11-01T00:00:00Z' },
  pricing: { configured: true, usdPerCredit: '0.01', renderPerMinute: '2' },
};

export function memoryCredentialStore(initial = null) {
  let saved = initial;
  return {
    calls: [],
    peek: () => saved,
    async read() { this.calls.push('read'); return saved; },
    async write(key) { this.calls.push('write'); saved = key; },
    async delete() {
      this.calls.push('delete');
      const existed = saved !== null;
      saved = null;
      return existed;
    },
  };
}

export async function workspace(t) {
  const base = join(tmpdir(), 'opencode');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(join(base, 'machinal-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function serve(t, handler) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.writeHead(500).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return `http://127.0.0.1:${server.address().port}/mcp`;
}

export async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function reply(response, request, result) {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
}

export function mcpHandler(calls = [], { tools = TOOLS, credits = CREDIT_SUMMARY, creditStatus = 200, serverName = 'machinal' } = {}) {
  return async (request, response) => {
    const body = await requestBody(request);
    calls.push({ headers: request.headers, method: body.method, tool: body.params?.name, url: request.url });
    if (body.method === 'initialize') {
      reply(response, body, { protocolVersion: '2025-11-25', serverInfo: { name: serverName, version: '1.0.0' }, capabilities: { tools: {} } });
    } else if (body.method === 'notifications/initialized') {
      response.writeHead(202).end();
    } else if (body.method === 'tools/list') {
      reply(response, body, { tools });
    } else if (body.method === 'tools/call' && body.params.name === 'get_credits') {
      reply(response, body, { isError: creditStatus >= 400, structuredContent: { statusCode: creditStatus, data: credits } });
    } else {
      response.writeHead(400).end();
    }
  };
}

export function runCLI(args, { cwd, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd,
      env: { ...process.env, MACHINAL_API_KEY: '', MACHINAL_API_ORIGIN: '', DIRECTION_API_KEY: '', DIRECTION_API_ORIGIN: '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
