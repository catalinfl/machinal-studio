import { InstallerError } from './errors.mjs';
import { VERSION } from './version.mjs';
import { parseCreditSummary } from './credits.mjs';
import { API_KEYS_URL, MEMBERSHIP_URL } from './presentation.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROTOCOL_VERSION = '2025-11-25';
const SUPPORTED_VERSIONS = new Set(['2025-03-26', '2025-06-18', PROTOCOL_VERSION]);
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const MEDIA_WORKFLOW_TOOLS = ['request_media_access', 'list_media', 'get_asset_metadata', 'get_upload_target', 'get_media_download', 'get_video_result', 'get_download_preferences', 'set_download_preferences', 'wait_for_job', 'revoke_delivery_link'];

export function isLoopbackEndpoint(endpoint) {
  return LOOPBACK_HOSTS.has(new URL(endpoint).hostname);
}

export function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new InstallerError('Enter an absolute API URL, such as https://your-api.example/mcp.');
  }

  if (url.username || url.password || url.search || url.hash) {
    throw new InstallerError('The API URL must not contain credentials, a query, or a fragment.');
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new InstallerError('HTTPS is required, except for localhost, 127.0.0.1, or [::1] development.');
  }

  if (!['/', '/mcp', '/mcp/'].includes(url.pathname)) {
    throw new InstallerError('Enter the API origin or its /mcp endpoint, not a frontend page or /v1 route.');
  }

  url.pathname = '/mcp';
  return url.href;
}

export function validateAPIKey(value) {
  const key = value?.trim();
  if (!/^(?:mach_|dal_)[a-fA-F\d]{64}$/.test(key ?? '')) {
    throw new InstallerError(`Use a complete machinal application key (mach_… or a legacy dal_… key) from ${API_KEYS_URL}, not a login or provider token. For self-hosting, use the /api-keys page of your own website.`);
  }
  return key;
}

async function readJSON(response) {
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    await response.body?.cancel();
    throw new InstallerError('The endpoint did not return MCP JSON. Check the API URL and proxy configuration.');
  }

  const reader = response.body?.getReader();
  if (!reader) throw new InstallerError('The MCP response was empty.');

  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new InstallerError('The MCP response exceeded the 2 MiB safety limit.');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof InstallerError) throw error;
    throw new InstallerError('The endpoint returned an invalid or interrupted MCP response.');
  } finally {
    reader.releaseLock();
  }
}

function httpError(status) {
  if (status === 401) return `Authentication failed (401). Create or replace your application key at ${API_KEYS_URL} (your own website's /api-keys for self-hosting). Check active Premium/API access. Use key set to replace a saved key, or --session-key for hidden entry.`;
  if (status === 402) return `Active Premium/API access is required (402). Check ${MEMBERSHIP_URL} or your self-hosted account subscription before connecting.`;
  if (status === 403) return `Access denied (403). Check Premium/API access at ${MEMBERSHIP_URL} and the server origin policy.`;
  if (status === 429) return 'The API is rate limited (429). Wait before trying setup again.';
  return `MCP connection failed (HTTP ${status}). Check the API URL and backend availability.`;
}

export async function checkConnection(endpoint, apiKey, { fetchImpl = fetch, timeout = 15_000, attempts = 3, sleep = delay, local = false } = {}) {
  const url = normalizeEndpoint(endpoint);
  if (local && !isLoopbackEndpoint(url)) throw new InstallerError('Local connections must use a loopback endpoint.');
  const key = local ? null : validateAPIKey(apiKey);
  const signal = AbortSignal.timeout(timeout);
  const maxAttempts = Number.isInteger(attempts) ? Math.max(1, Math.min(attempts, 3)) : 3;

  async function requestOnce(message, version) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'error',
        signal,
        headers: {
          ...(key ? { Authorization: `Bearer ${key}` } : {}),
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...(version ? { 'MCP-Protocol-Version': version } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', ...message }),
      });
    } catch (error) {
      const transient = signal.aborted || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code);
      throw new InstallerError(`Could not reach the MCP endpoint. ${isLoopbackEndpoint(url) ? 'Make sure the local API/container is running and the port is correct; Local mode can help start Docker.' : 'Check the server URL, TLS, and network.'} Redirects are not followed.`, { code: 'network', retryable: transient });
    }

    if (!response.ok) {
      await response.body?.cancel();
      if (local && [401, 402].includes(response.status)) throw new InstallerError('This endpoint requires a hosted machinal account; it is not the local edition. Start your own machinal-local Docker installation, or choose Server. No credentials were read or sent.', { status: response.status });
      throw new InstallerError(httpError(response.status), { status: response.status, retryable: [502, 503, 504].includes(response.status) });
    }
    if (message.id === undefined) {
      await response.body?.cancel();
      return;
    }

    const reply = await readJSON(response);
    if (reply?.jsonrpc !== '2.0' || reply.id !== message.id || reply.error || !reply.result) {
      throw new InstallerError('The endpoint rejected the MCP handshake or discovery request.');
    }
    return reply.result;
  }

  async function request(message, version) {
    for (let attempt = 1; ; attempt++) {
      try { return await requestOnce(message, version); } catch (error) {
        if (!error.retryable || signal.aborted || attempt >= maxAttempts) throw error;
        await sleep(250 * attempt);
      }
    }
  }

  const initialized = await request({
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'machinal-mcp-setup', version: VERSION },
    },
  });

  const serverName = initialized.serverInfo?.name;
  if (typeof serverName !== 'string' || serverName.toLowerCase() !== (local ? 'machinal-local' : 'machinal') || !SUPPORTED_VERSIONS.has(initialized.protocolVersion)) {
    throw new InstallerError('This is not a supported machinal MCP endpoint. No configuration was saved.');
  }

  await request({ method: 'notifications/initialized' }, initialized.protocolVersion);
  const catalog = await request({ id: 2, method: 'tools/list', params: {} }, initialized.protocolVersion);
  const names = new Set(Array.isArray(catalog.tools) ? catalog.tools.map((tool) => tool?.name) : []);
  if (!names.has('list_projects') || !names.has('get_recipe_schema')) {
    throw new InstallerError('The endpoint is missing the expected machinal tools. Update the API before connecting.');
  }

  const result = { toolCount: catalog.tools.length, credits: null };
  if (local) return { ...result, mode: 'local', creditsWarning: 'No machinal credits or account. AI uses your own OpenRouter key; local encoding uses your hardware.' };
  if (MEDIA_WORKFLOW_TOOLS.some((name) => !names.has(name))) {
    result.mediaWarning = 'Full media workflow unavailable: update the API for consent tools, volume uploads, bounded job waits, opaque revocable download links and optional client-local delivery. Installed instructions do not add missing server capabilities.';
  }
  if (!names.has('get_editing_reference')) {
    result.referenceWarning = 'Live editing reference unavailable: update the API for get_editing_reference. Installed guides are offline snapshots; verify the deployed schema/catalog.';
  }
  if (!names.has('get_credits')) {
    return { ...result, creditsWarning: 'Live credits unavailable: this API does not expose get_credits. Update the API; no balance was assumed.' };
  }
  try {
    const wallet = await request({ id: 3, method: 'tools/call', params: { name: 'get_credits', arguments: {} } }, initialized.protocolVersion);
    const output = wallet.structuredContent;
    if ([401, 402, 403].includes(output?.statusCode)) throw new InstallerError(httpError(output.statusCode), { status: output.statusCode });
    if (!wallet.isError && output?.statusCode === 200) result.credits = parseCreditSummary(output.data);
  } catch (error) {
    if ([401, 402, 403].includes(error.status)) throw error;
  }
  if (!result.credits) result.creditsWarning = 'Live credits unavailable: the API could not return a verified balance. No balance was assumed; check billing before paid work.';
  return result;
}
