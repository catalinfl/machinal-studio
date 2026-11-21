import { createCredentialStore, WINDOWS_CREDENTIAL } from './credential-store.mjs';
import { checkConnection, normalizeEndpoint, validateAPIKey } from './connection.mjs';
import { API_KEYS_URL, MEMBERSHIP_URL } from './presentation.mjs';
import { promptWindowsKey } from './windows-key-prompt.mjs';
import { installOpenCodeMedia } from './opencode-media.mjs';
import { installDirectTools } from './opencode-tools.mjs';
import { installRecipeFiles } from './opencode-recipes.mjs';
import { installOpenCodeRouting } from './opencode-routing.mjs';
import { installWorkflowStartup } from './opencode-workflow.mjs';
import { installCheckpoints } from './opencode-checkpoints.mjs';
import { TransferError } from './transfer-http.mjs';

function trustedServers(options) {
  const servers = new Map();
  for (const [name, url] of Object.entries(options.servers ?? {})) {
    if (!/^[a-z\d][a-z\d_-]{0,63}$/i.test(name)) continue;
    try { servers.set(name, normalizeEndpoint(url)); } catch {}
  }
  return servers;
}

function matches(server, endpoint) {
  if (server?.type !== 'remote' || server.oauth !== false) return false;
  try { return normalizeEndpoint(server.url) === endpoint; } catch { return false; }
}

function connectionFailure(error) {
  if (error.status === 401) return {
    code: 'key-rejected', nextAction: 'replace',
    error: 'The machinal key was rejected. Offer replace for secure entry; do not repeatedly reconnect with the same rejected key. The previous saved key was not deleted.',
  };
  if ([402, 403].includes(error.status)) return {
    code: 'account-access', nextAction: 'check-account',
    error: `Account access is unavailable. Check ${MEMBERSHIP_URL}; do not generate more API keys to fix subscription or access restrictions.`,
  };
  if (error.status === 429) return {
    code: 'rate-limited', nextAction: 'retry-later',
    error: 'The MCP endpoint is rate limited. Wait before reconnecting; the saved key was not changed.',
  };
  return {
    code: 'connection-failed', nextAction: 'check-endpoint',
    error: 'Could not complete the machinal connection. The current saved key was not deleted. Check the configured API/container, URL and network; retry for network failures, not by creating another key.',
  };
}

export async function installOpenCodeAuth(ctx, {
  credentialStore = createCredentialStore(), env = process.env,
  verify = checkConnection, prompt = promptWindowsKey, intervalMs = 2000,
} = {}) {
  const servers = trustedServers(ctx.options ?? {});
  const registrations = new Map();
  const credential = {
    name: 'Windows Credential Manager', ...WINDOWS_CREDENTIAL,
    supported: Boolean(credentialStore), status: credentialStore ? 'unchecked' : 'unsupported',
  };
  const state = { key: null, source: 'none', warning: null, paused: null, sessionOnly: false };
  const lifetime = new AbortController();
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };

  async function loadKey() {
    if (state.sessionOnly) return;
    let candidate;
    let source = 'none';
    state.warning = null;
    if (credentialStore && env.MACHINAL_MCP_USE_ENV_KEY !== '1' && env.DIRECTION_MCP_USE_ENV_KEY !== '1') {
      try {
        candidate = await credentialStore.read();
        credential.status = candidate == null ? 'missing' : 'found';
      } catch {
        credential.status = 'unavailable';
        state.warning = 'Windows Credential Manager is unavailable. The current in-memory key was not removed.';
        if (state.key) return;
      }
      if (candidate !== null && candidate !== undefined) source = 'saved';
    } else if (credentialStore) credential.status = 'bypassed';
    const environmentKey = env.MACHINAL_API_KEY || env.DIRECTION_API_KEY;
    if (source === 'none' && environmentKey) { candidate = environmentKey; source = 'environment'; }
    try { state.key = candidate ? validateAPIKey(candidate) : null; state.source = source; } catch {
      state.key = null;
      state.source = source;
      state.warning = 'The saved machinal key has an invalid format. Use replace for secure entry; the saved value has not been deleted.';
    }
  }

  await loadKey();
  await ctx.mcp.transform((editor) => {
    const canonical = servers.get('machinal');
    if (canonical && matches(editor.get('machinal'), canonical) && matches(editor.get('directional'), canonical)) {
      editor.remove('directional');
    }
    for (const [name, endpoint] of servers) {
      const config = editor.get(name);
      registrations.set(name, { name, endpoint, configuration: !config ? 'missing' : matches(config, endpoint) ? 'matched' : 'mismatch' });
      if (!matches(config, endpoint)) continue;
      editor.update(name, (server) => {
        const headers = Object.fromEntries(Object.entries(server.headers ?? {}).filter(([key]) => key.toLowerCase() !== 'authorization'));
        server.headers = { ...headers, Authorization: state.key ? `Bearer ${state.key}` : 'Bearer ' };
        if (state.paused === name) server.disabled = true;
      });
    }
  });

  async function status() {
    let listed;
    let connectionWarning;
    try { listed = await ctx.mcp.list(); } catch {
      connectionWarning = 'OpenCode could not list current MCP connection states. No connection success was assumed; inspect the MCP panel or run opencode mcp list.';
    }
    return {
      source: state.source, hasKey: Boolean(state.key), warning: state.warning,
      credentialStore: { ...credential }, registrations: [...registrations.values()],
      servers: (listed?.data ?? []).filter((server) => servers.has(server.name)).map((server) => ({ name: server.name, status: server.status.status })),
      ...(connectionWarning ? { connectionWarning } : {}),
      apiKeysURL: API_KEYS_URL,
    };
  }

  async function reconnect(name) {
    state.paused = name;
    try { await ctx.mcp.reload(); } finally { state.paused = null; }
    await ctx.mcp.reload();
    return status();
  }

  async function connection(input, context) {
    if (input.action === 'status') return status();
    if (!input.server && servers.size > 1) return {
      ...await status(), code: 'server-required', nextAction: 'select-server',
      error: 'Multiple machinal MCP servers are registered. Use the intended name from registrations as server; do not guess an endpoint or send the saved key to another server.',
    };
    const name = input.server ?? servers.keys().next().value;
    const endpoint = servers.get(name);
    if (!endpoint) return {
      ...await status(), code: 'server-not-registered', nextAction: 'check-setup',
      error: 'This machinal server is not configured for automatic authentication. Inspect the existing MCP configuration and run the machinal setup if needed; never guess a URL or expose the saved key.',
    };
    await ctx.mcp.list();
    if (registrations.get(name)?.configuration !== 'matched') return {
      ...await status(), code: 'server-configuration', nextAction: 'check-setup',
      error: 'The registered MCP is missing or its configuration does not match the approved remote endpoint and API-key authentication. No key was sent. Restore the approved setup; never automatically trust a redirected endpoint.',
    };
    if (input.action === 'replace') {
      await context.progress({ status: 'Use the secure machinal key window. The key never enters chat.' });
      const answer = await prompt({ endpoint, apiKeysURL: API_KEYS_URL, signal: AbortSignal.any([lifetime.signal, context.signal]) });
      if (!answer) return { cancelled: true, ...await status() };
      if (answer.action === 'replace') {
        const key = validateAPIKey(answer.key);
        await verify(endpoint, key);
        if (answer.remember) {
          if (!credentialStore) return { error: 'Secure key storage is unavailable. The saved key was not changed.' };
          await credentialStore.write(key);
          credential.status = 'found';
        }
        state.key = key;
        state.source = answer.remember ? 'saved' : 'session';
        state.sessionOnly = !answer.remember;
        state.warning = answer.remember ? null : 'This replacement is connected for the current session only. The saved key was not changed.';
        return reconnect(name);
      }
      if (answer.action !== 'reuse') return { cancelled: true, ...await status() };
      state.sessionOnly = false;
    }
    await loadKey();
    if (!state.key) return {
      ...await status(),
      code: credential.status === 'unavailable' ? 'credential-store-unavailable' : 'no-usable-key',
      nextAction: credential.status === 'unavailable' ? 'retry-credential-store' : 'replace',
      error: credential.status === 'unavailable'
        ? 'Windows Credential Manager could not be read. Retry under the same Windows user; do not assume the saved key is absent or dump credentials through shell commands.'
        : 'No usable machinal key is available after checking the credential source. Use replace for secure entry. Only one machinal key is needed.',
    };
    await verify(endpoint, state.key);
    return reconnect(name);
  }

  await ctx.tool.transform((editor) => {
    editor.add({
      name: 'machinal_connection',
      description: `Discover and recover machinal MCP even when remote tools are unavailable. status lists registered MCP names, actual connection states and credential diagnostics without secrets. On connection/authentication failure, immediately use reconnect to reread Windows Credential Manager target ${WINDOWS_CREDENTIAL.target}, verify and reconnect without restarting OpenCode. Only offer replace after the saved key is missing/invalid/rejected; it opens secure native entry. Network/account errors do not need new keys. Never put API keys in tool inputs or chat.`,
      input: { type: 'object', properties: { action: { type: 'string', enum: ['status', 'reconnect', 'replace'] }, server: { type: 'string' } }, required: ['action'], additionalProperties: false },
      options: { codemode: false },
      async execute(input, context) {
        const result = await serial(async () => {
          try { return await connection(input, context); } catch (error) {
            return { ...await status(), ...connectionFailure(error) };
          }
        });
        return { content: JSON.stringify(result) };
      },
    });
  });

  await ctx.session.hook('context', (event) => {
    event.system.push({ type: 'text', text: [
      'For machinal work, proactively discover the existing MCP before claiming tools or authentication are missing. Use directly exposed tools first; otherwise search the tool catalog in Code Mode once for the missing machinal tool. Tools omitted from the initial list are not proof of disconnection. Reuse actual discovered namespaces/signatures, never invented tool names or repeated discovery per step.',
      `The local machinal_connection tool remains available when the remote MCP is down. Use status to discover approved MCP names, actual connection states and credential diagnostics. Approved registrations: ${JSON.stringify([...servers].map(([name, endpoint]) => ({ name, endpoint })))}. Do not assume a server name or trust other endpoints. If discovery fails or a connection/authentication call fails, immediately call machinal_connection(action:reconnect,server:<registered name>) once, without asking the user to find or paste a key. Reconnect rereads the saved credential and refreshes MCP in the current OpenCode service; then rediscover tools and retry only safe read-only calls. Do not automatically repeat ambiguous paid submissions; recover their jobs/idempotency first.`,
      `machinal uses ONE application API key, automatically loaded into memory from Windows Credential Manager: service ${WINDOWS_CREDENTIAL.service}, account ${WINDOWS_CREDENTIAL.account}, Windows target ${WINDOWS_CREDENTIAL.target}. The local integration, not the model or shell, reads its secret. Do not search credential files, dump the vault, run cmdkey to extract secrets, or print environment values. No separate OpenCode/AI-provider keys or launcher/restart are needed with this integration. Respect an explicitly selected session/environment key.`,
      `After this one recovery attempt, follow the tool's code/nextAction. Only offer replace when the key is missing, invalid or rejected; secure entry links to ${API_KEYS_URL}, verifies before optional saving and reconnects. An unreadable vault is not an absent key. Network, rate-limit or subscription/access errors do not require a new key. Never request a key in chat, disable host approvals, change a trusted endpoint automatically or delete the old key before verification.`,
    ].join('\n\n') });
  });

  const getConnection = async (name) => {
    if (!name && servers.size > 1) throw new TransferError('Multiple machinal servers are registered. Select the intended approved server explicitly.');
    name ??= servers.keys().next().value;
    const endpoint = servers.get(name);
    if (!endpoint) throw new TransferError('Choose a machinal server approved in the integration settings.');
    await ctx.mcp.list();
    if (registrations.get(name)?.configuration !== 'matched') throw new TransferError('The current MCP configuration does not match the approved endpoint. No credentials were sent.');
    if (!state.key) throw new TransferError('No usable machinal key is loaded. Use machinal_connection reconnect; never put a key in download arguments.');
    return { endpoint, key: state.key };
  };
  await installOpenCodeMedia(ctx, { signal: lifetime.signal, getConnection });
  await installDirectTools(ctx, servers.keys());
  await installWorkflowStartup(ctx);
  await installRecipeFiles(ctx, servers.keys());
  await installCheckpoints(ctx, servers.keys());
  await installOpenCodeRouting(ctx, { servers: [...servers.keys()], signal: lifetime.signal, getConnection });

  const timer = setInterval(() => {
    void serial(async () => {
      const previous = state.key;
      await loadKey();
      if (state.key !== previous) await ctx.mcp.reload();
    }).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  return () => { lifetime.abort(); clearInterval(timer); };
}
