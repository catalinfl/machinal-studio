import { createSceneServer } from './http-server.mjs';
import { compileComponent, renderComponent } from './render.mjs';
import { prepareText } from './text.mjs';
import { inspectEvidence } from './evidence.mjs';
import { ensureRendererReady } from './renderer.mjs';
import { renderConcurrency, renderResources } from './render-options.mjs';

const concurrency = renderConcurrency(await renderResources(), process.env.SCENE_RENDER_CONCURRENCY ?? 'auto');
const server = createSceneServer({ token: process.env.SCENE_SERVICE_TOKEN, compile: compileComponent, render: renderComponent, text: prepareText, inspect: inspectEvidence, ready: ensureRendererReady, renderConcurrency: concurrency });
server.listen(Number(process.env.PORT || 8091), process.env.SCENE_SERVICE_HOST || '127.0.0.1', () => console.log('Scene render service listening; /health checks native renderer, browser and FFmpeg readiness'));
