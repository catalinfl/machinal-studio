import { createSceneServer } from './http-server.mjs';
import { compileComponent, renderComponent } from './render.mjs';
import { prepareText } from './text.mjs';
import { inspectEvidence } from './evidence.mjs';
import { ensureRendererReady } from './renderer.mjs';

const server = createSceneServer({ token: process.env.SCENE_SERVICE_TOKEN, compile: compileComponent, render: renderComponent, text: prepareText, inspect: inspectEvidence, ready: ensureRendererReady });
server.listen(Number(process.env.PORT || 8091), process.env.SCENE_SERVICE_HOST || '127.0.0.1', () => console.log('Scene render service listening; /health checks native renderer, browser and FFmpeg readiness'));
