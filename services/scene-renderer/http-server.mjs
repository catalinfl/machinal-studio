import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { WorkQueue, QueueFullError } from './work-queue.mjs';
import { SceneDiagnosticError, SceneInfrastructureError, reportSceneFailure } from './diagnostics.mjs';

const maxBody = 96 * 1024 * 1024;
const operationTimeout = 30 * 60 * 1000;

class BodyTooLargeError extends Error {}

function authorized(request, token) {
  const actual = Buffer.from(request.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function bodyJSON(request, signal) {
  const chunks = [];
  let size = 0;
  if (Number(request.headers['content-length']) > maxBody) throw new BodyTooLargeError();
  const abort = () => request.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of request) {
      signal.throwIfAborted();
      size += chunk.length;
      if (size > maxBody) throw new BodyTooLargeError();
      chunks.push(chunk);
    }
  } finally { signal.removeEventListener('abort', abort); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function componentDiagnostics(error) {
  if (error instanceof SceneDiagnosticError) return error.message.slice(0, 4000);
  if (Array.isArray(error.errors)) return error.errors.slice(0, 5).map(item => `${item.location ? `Line ${item.location.line}:${item.location.column}: ` : ''}${item.text}`).join('\n').slice(0, 2000);
  if (typeof error.code === 'string' && /^[a-z_]+$/.test(error.code)) return `${error.code}: ${String(error.message).split('\n')[0]}`.slice(0, 2000);
  return 'Scene processing failed. Check the component and configuration.';
}

export function createSceneServer({ token, compile, render, text, inspect, renderConcurrency = 1, ready = async () => {}, reportError = reportSceneFailure }) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('SCENE_SERVICE_TOKEN is required; the scene service cannot run unauthenticated');
  const rendering = new WorkQueue(renderConcurrency, 8);
  const textWork = renderConcurrency > 1 ? new WorkQueue(1, 8) : rendering;
  const compiling = new WorkQueue(2, 8);
  const inspecting = new WorkQueue(1, 2);
  const exports = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (!authorized(request, token)) { response.writeHead(401).end(); return; }
    const progressMatch = /^\/render-progress\/([a-f0-9]{32})$/.exec(request.url);
    if (request.method === 'GET' && progressMatch) {
      const progress = exports.get(progressMatch[1]);
      if (!progress) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(progress));
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      try { await ready(); response.writeHead(200).end('ready'); }
      catch (error) {
        if (error instanceof SceneInfrastructureError) {
          response.writeHead(503, { 'X-Scene-Error-Code': error.code }).end(error.message);
        } else response.writeHead(503).end('Scene rendering tools are unavailable. Check the scene-renderer installation.');
      }
      return;
    }
    if (request.method !== 'POST' || !['/compile', '/render', '/text', ...(inspect ? ['/inspect'] : [])].includes(request.url)) { response.writeHead(404).end(); return; }
    const suppliedId = request.headers['x-scene-request-id'];
    const requestId = typeof suppliedId === 'string' && /^[a-f0-9]{32}$/.test(suppliedId) ? suppliedId : randomUUID();
    response.setHeader('X-Scene-Request-Id', requestId);
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('Scene operation timed out')), request.url === '/inspect' ? 90000 : operationTimeout);
    timeout.unref();
    const disconnected = () => { if (!response.writableEnded) controller.abort(new Error('Scene client disconnected')); };
    response.on('close', disconnected);
    request.on('aborted', disconnected);
    let release;
    let inputParsed = false;
    let progressId;
    let rendered;
    try {
      // Reserve a bounded slot before buffering potentially large embedded media.
      release = await (request.url === '/inspect' ? inspecting : request.url === '/compile' ? compiling : request.url === '/text' ? textWork : rendering).acquire(controller.signal);
      const input = await bodyJSON(request, controller.signal);
      inputParsed = true;
      controller.signal.throwIfAborted();
      const suppliedProgressId = request.headers['x-scene-progress-id'];
      if (request.url === '/render' && typeof suppliedProgressId === 'string' && /^[a-f0-9]{32}$/.test(suppliedProgressId) && !exports.has(suppliedProgressId)) {
        progressId = suppliedProgressId;
        exports.set(progressId, { stage: 'compiling', writtenFrames: 0, totalFrames: 0, elapsedMs: 0 });
      }
      if (request.url === '/render') await ready();
      if (request.url === '/render') {
        const onProgress = update => {
          if (!progressId || !['compiling', 'cache-lookup', 'cache-miss', 'cache-disabled', 'capture', 'encoding', 'cache-hit'].includes(update.stage)) return;
          const { writtenFrames = 0, totalFrames = 0, elapsedMs = 0 } = update;
          if (!Number.isSafeInteger(writtenFrames) || !Number.isSafeInteger(totalFrames) || writtenFrames < 0 || writtenFrames > totalFrames || !Number.isFinite(elapsedMs) || elapsedMs < 0) return;
          exports.set(progressId, { stage: update.stage, writtenFrames, totalFrames, elapsedMs });
        };
        rendered = await render(input, controller.signal, { requestId, onProgress, concurrency: renderConcurrency });
        const { manifest } = rendered;
        controller.signal.throwIfAborted();
        response.writeHead(200, { 'Content-Type': manifest.transparent ? 'video/webm' : 'video/mp4', 'Content-Length': rendered.bytes ?? rendered.video.length, 'X-Scene-Manifest': Buffer.from(JSON.stringify(manifest)).toString('base64') });
        if (rendered.openStream) await pipeline(rendered.openStream(), response, { signal: controller.signal });
        else response.end(rendered.video);
      } else {
        const result = await (request.url === '/inspect' ? inspect : request.url === '/compile' ? compile : text)(input, controller.signal);
        controller.signal.throwIfAborted();
        response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
      }
    } catch (error) {
      const invalidJSON = error instanceof SyntaxError && !inputParsed;
      if (!(error instanceof SceneDiagnosticError || error instanceof QueueFullError || error instanceof BodyTooLargeError || invalidJSON)) {
        reportError(error, { requestId, route: request.url, elapsedMs: Math.round(performance.now() - started), aborted: controller.signal.aborted });
      }
      if (response.destroyed) return;
      if (response.headersSent) { response.destroy(); return; }
      let status = 422;
      let message = componentDiagnostics(error);
      if (error instanceof QueueFullError) { status = 429; message = error.message; response.setHeader('Retry-After', '5'); }
      else if (error instanceof BodyTooLargeError) { status = 413; message = 'Scene request too large'; }
      else if (invalidJSON) { status = 400; message = 'Invalid scene JSON'; }
      else if (controller.signal.aborted) { status = 408; message = 'Scene operation was cancelled or timed out'; }
      else if (error instanceof SceneInfrastructureError) {
        status = 503; message = error.message;
        response.setHeader('X-Scene-Error-Code', error.code);
      }
      response.writeHead(status, { 'Content-Type': 'text/plain' }).end(message);
    } finally {
      try { await rendered?.dispose?.(); }
      catch (error) { reportError(error, { requestId, route: request.url, phase: 'cleanup' }); }
      clearTimeout(timeout);
      response.off('close', disconnected);
      request.off('aborted', disconnected);
      if (progressId) exports.delete(progressId);
      release?.();
    }
  });
  server.requestTimeout = operationTimeout;
  server.headersTimeout = 30_000;
  server.maxRequestsPerSocket = 100;
  return server;
}
