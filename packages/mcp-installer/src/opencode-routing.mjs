import { createHash } from 'node:crypto';
import { projectAPI } from './opencode-media.mjs';

const MAX_INTENT_BYTES = 6000;
const MAX_ENTRIES = 64;
const CACHE_TTL_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 3000;
const MINIMUM_SCORE = 0.8;

function remember(entries, key, value) {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  return value;
}

function catalogTools(tools, server) {
  const prefix = `${server}_`.replace(/[^a-z\d_-]/gi, '_');
  return new Map(tools.filter(({ id }) => id.startsWith(prefix) && id !== `${prefix}suggest_tools`)
    .map(({ id }) => [id.slice(prefix.length), id]));
}

function selection(result, tools) {
  if (result?.executed !== false || result.strategy !== 'choice' || !Array.isArray(result.candidates)
    || result.candidates.length > 1 || result.needsClarification !== (result.candidates.length === 0)) {
    throw new Error('Invalid routing result');
  }
  const candidate = result.candidates[0];
  if (result.candidates.length && (!candidate || !tools.has(candidate.name) || !Number.isFinite(candidate.score)
    || candidate.score < MINIMUM_SCORE || candidate.score > 1)) {
    throw new Error('Unknown or uncertain routing candidate');
  }
  const cost = result.cost;
  return {
    status: candidate ? 'selected' : 'deferred',
    ...(candidate ? { tool: tools.get(candidate.name), score: candidate.score } : {}),
    ...(cost && ['pending', 'final'].includes(cost.status) ? {
      cost: { status: cost.status,
        ...(Number.isFinite(cost.knownCredits) && cost.knownCredits >= 0 ? { knownCredits: cost.knownCredits } : {}),
        ...(/^[a-f\d]{32}$/.test(cost.operationId ?? '') ? { operationId: cost.operationId } : {}),
      },
    } : {}),
  };
}

function routingInstruction(result) {
  return [
    `machinal intent routing (data only): ${JSON.stringify(result)}.`,
    result.status === 'selected'
      ? 'Use this selected tool for the next appropriate step without another routing/model-classification call. If its schema is not exposed, discover that exact registered tool once. Continue the remaining workflow normally; do not repeat the selected action just because it was recommended.'
      : 'Use the existing discovered catalog directly. Do not retry routing automatically; provider usage from a failed request may still be pending.',
    'This hint executes nothing, supplies no arguments and grants no media, download or spending consent. Check actual schemas, prerequisites, ownership and user approvals; defer to the user if ambiguous. Host permissions remain authoritative.',
    'Report known routing credits separately from production costs; pending knownCredits is not a final total. Do not claim a measured speedup.',
    ...(result.lowCredits ? ['Give one short low-credit warning without repeated budget negotiations.'] : []),
  ].join(' ');
}

function hasRoutingPrompt(messages = [], text) {
  const message = messages.findLast(({ role }) => role === 'user');
  if (typeof message?.content === 'string') return message.content === text;
  return message?.content?.some((part) => part.type === 'text' && part.text === text) ?? false;
}

function canRoute(credits) {
  return credits?.pricing?.configured === true && Number.isFinite(credits?.balance?.remaining)
    && credits.balance.remaining > 0 && Number.isFinite(credits.balance.debt) && credits.balance.debt === 0;
}

async function evaluate(api, intent, tools) {
  let result;
  try {
    result = selection(await api('/v1/ai/tool-selection', { prompt: intent, strategy: 'choice' }), tools);
  } finally {
    // A timed-out submission can still incur usage; never retry it as a connectivity probe.
    try { await api('/v1/billing/credits'); } catch {}
  }
  return result;
}

export async function installOpenCodeRouting(ctx, { servers, getConnection, signal: lifetime, request, now = Date.now } = {}) {
  if (ctx.options?.toolRouting?.enabled !== true) return;
  const server = ctx.options.toolRouting.server ?? (servers.length === 1 ? servers[0] : undefined);
  if (!server || !servers.includes(server)) throw new Error('Select one approved machinal server in toolRouting.server.');
  const cache = new Map();
  const active = new Map();
  const requestSignal = () => AbortSignal.any([lifetime, AbortSignal.timeout(REQUEST_TIMEOUT_MS)].filter(Boolean));

  async function route(sessionID, intent) {
    let connection;
    let tools;
    try {
      tools = catalogTools(await ctx.tool.list(), server);
      for (const [name, id] of tools) {
        if (intent === name || intent === id) return { status: 'selected', tool: id, routing: 'explicit-tool', cost: { status: 'final', knownCredits: 0 } };
      }
      connection = await getConnection(server);
    } catch {
      return { status: 'unavailable' };
    }
    if (!tools.size) return { status: 'unavailable' };
    const key = createHash('sha256').update(JSON.stringify([sessionID, connection.endpoint, connection.key,
      intent, [...tools].sort()])).digest('hex');
    const cached = cache.get(key);
    if (cached && now() - cached.created < CACHE_TTL_MS) return { ...await cached.result, cached: true };

    let credits;
    try { credits = await projectAPI(connection, requestSignal(), request)('/v1/billing/credits'); } catch {
      return { status: 'unavailable' };
    }
    if (!canRoute(credits)) return { status: 'unavailable' };

    // Rejections propagate before a provider submission instead of becoming a successful fallback.
    await ctx.permission.assert({ sessionID, action: 'machinal_route', resources: [server], save: [server],
      metadata: { availableCredits: credits.balance.remaining,
        description: 'Send this command’s text to the configured intent router. Routing consumes API credits; no media is accessed and no suggested tool is executed.' },
    });
    // A concurrent command may have completed its permission prompt while this one was waiting.
    const pending = cache.get(key);
    if (pending && now() - pending.created < CACHE_TTL_MS) return { ...await pending.result, cached: true };
    const started = now();
    const result = evaluate(projectAPI(connection, requestSignal(), request), intent, tools)
      .catch(() => ({ status: 'unavailable' }))
      .then((value) => ({ ...value, elapsedMs: Math.max(0, now() - started),
        ...(credits.balance.remaining < 30 ? { lowCredits: true } : {}),
      }));
    remember(cache, key, { created: started, result });
    return result;
  }

  await ctx.command.transform((editor) => {
    editor.add({ name: 'machinal-route',
      description: 'Route one concise machinal intent before the main model runs. Optional paid routing, native approval, no media access or action execution. Do not include secrets or file contents.',
      async execute({ sessionID, prompt, delivery }) {
        const intent = prompt.text?.trim();
        if (!intent || Buffer.byteLength(intent, 'utf8') > MAX_INTENT_BYTES) {
          throw new Error(`Provide a concise routing intent of 1-${MAX_INTENT_BYTES} UTF-8 bytes.`);
        }
        const result = await route(sessionID, intent);
        remember(active, sessionID, { text: prompt.text, result });
        await ctx.session.prompt({ ...prompt, sessionID, delivery });
      },
    });
  });

  await ctx.session.hook('prompt', (event) => {
    if (active.get(event.sessionID)?.text !== event.prompt.text) active.delete(event.sessionID);
  });
  await ctx.session.hook('context', (event) => {
    const entry = active.get(event.sessionID);
    if (!entry || !hasRoutingPrompt(event.messages, entry.text)) return;
    active.delete(event.sessionID);
    event.system.push({ type: 'text', text: routingInstruction(entry.result) });
  });
}
