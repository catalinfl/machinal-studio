import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { bundleComponent, sceneHTML, validateInput } from './bundle.mjs';
import { inspectComponent } from './inspect.mjs';
import { renderOptions, renderResources, rendererArgs } from './render-options.mjs';
import { cacheBudget, cacheKey, maxRenderBytes, readCachedRender, rendererIdentity, writeCachedRender } from './render-cache.mjs';
import { observeRendererProgress } from './render-progress.mjs';
import { resourceSnapshot, filesystemSnapshot } from './diagnostics.mjs';
import { rendererExecutable } from './renderer.mjs';

const execute = promisify(execFile);

export async function compileComponent(input) {
  validateInput(input);
  const directory = await mkdtemp(join(tmpdir(), 'direction-scene-preview-'));
  try {
    if (input.inspectLayout) await inspectComponent(input, directory);
    await bundleComponent(input.component, directory, true, input.config);
    return { javascript: await readFile(join(directory, 'scene.js'), 'utf8') };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function renderComponent(input, signal, { requestId, onProgress = () => {} } = {}) {
  const started = performance.now();
  const trace = { renderId: randomUUID(), requestId };
  const config = validateInput(input);
  onProgress({ stage: 'compiling', totalFrames: config.durationInFrames });
  signal?.throwIfAborted();
  const options = renderOptions(config, process.env, await renderResources());
  console.info('scene_render_started', JSON.stringify({ ...trace, width: config.width, height: config.height, fps: config.fps, frames: config.durationInFrames, ...options }));
  const budget = cacheBudget(process.env.SCENE_CACHE_MAX_BYTES);
  // Hardware-dependent pixels cannot share a cache without an explicit device fingerprint.
  const cacheRoot = budget > 0 && (!options.gpu || process.env.SCENE_GPU_FINGERPRINT) ? process.env.SCENE_CACHE_DIR : undefined;
  const filename = config.transparent ? 'scene.webm' : 'scene.mp4';
  const directory = await mkdtemp(join(tmpdir(), 'direction-scene-'));
  const resourcesBefore = await resourceSnapshot();
  const filesystemsBefore = await filesystemSnapshot();
  try {
    await bundleComponent(input.component, directory, false, input.config);
    const compiledMs = performance.now() - started;
    console.info('scene_render_compiled', JSON.stringify({ ...trace, elapsedMs: compiledMs }));
    let key;
    if (cacheRoot) {
      onProgress({ stage: 'cache-lookup', totalFrames: config.durationInFrames });
      try {
        key = cacheKey(await readFile(join(directory, 'scene.js')), sceneHTML, { ...input, config }, await rendererIdentity(options));
        const cached = await readCachedRender(cacheRoot, key, signal);
        if (cached) {
          onProgress({ stage: 'cache-hit', writtenFrames: config.durationInFrames, totalFrames: config.durationInFrames });
          console.info('scene_render', JSON.stringify({ ...trace, cache: 'hit', compiledMs, totalMs: performance.now() - started, bytes: cached.video.length }));
          return cached;
        }
        onProgress({ stage: 'cache-miss', totalFrames: config.durationInFrames });
      } catch (error) {
        signal?.throwIfAborted();
        console.warn('scene_cache unavailable', error.message);
        onProgress({ stage: 'cache-disabled', totalFrames: config.durationInFrames });
      }
    } else {
      onProgress({ stage: 'cache-disabled', totalFrames: config.durationInFrames });
    }
    await writeFile(join(directory, 'scene.html'), sceneHTML);
    await writeFile(join(directory, 'request.json'), JSON.stringify({ version: 1, url: '/scene.html', sceneId: 'generated', seed: 'generated', config, props: { images: input.images ?? {}, videos: input.videos ?? {}, parameters: input.parameters ?? {}, models: input.models ?? {} } }));
    const args = rendererArgs(directory, filename, options);
    if (process.env.SCENE_BROWSER) args.push('-browser', process.env.SCENE_BROWSER);
    if (process.env.SCENE_FFMPEG) args.push('-ffmpeg', process.env.SCENE_FFMPEG);
    if (process.env.SCENE_NO_SANDBOX === 'true') args.push('-no-sandbox');
    const task = execute(await rendererExecutable(), args, { signal, timeout: 600000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    console.info('scene_render_native_started', JSON.stringify({ ...trace, pid: task.child.pid, timeoutMs: 600000 }));
    const stopProgress = observeRendererProgress(task.child, update => {
      onProgress({ ...update, stage: update.writtenFrames === update.totalFrames ? 'encoding' : 'capture' });
      void filesystemSnapshot().then(filesystems => console.info('scene_render_progress', JSON.stringify({ ...trace, ...update, filesystems })));
    });
    let stdout;
    try { ({ stdout } = await task); }
    finally { stopProgress(); }
    const manifest = JSON.parse(stdout);
    const renderedBytes = (await stat(join(directory, filename))).size;
    console.info('scene_render_encoded', JSON.stringify({ ...trace, elapsedMs: performance.now() - started, bytes: renderedBytes, maxBytes: maxRenderBytes }));
    if (renderedBytes > maxRenderBytes) throw new Error(`Rendered scene is ${renderedBytes} bytes; output limit is ${maxRenderBytes} bytes`);
    // The service never returns its temporary filesystem paths.
    manifest.file = filename;
    // Embedded originals live in the saved scene source, not the HTTP header.
    delete manifest.scene.props.images;
    delete manifest.scene.props.videos;
    delete manifest.scene.props.models;
    signal?.throwIfAborted();
    const result = { manifest, video: await readFile(join(directory, filename), { signal }) };
    if (cacheRoot && key) {
      try { await writeCachedRender(cacheRoot, key, result, budget); }
      catch (error) { console.warn('scene_cache write_failed', error.message); }
    }
    console.info('scene_render', JSON.stringify({ ...trace, cache: cacheRoot ? 'miss' : 'disabled', compiledMs, totalMs: performance.now() - started, bytes: result.video.length, ...options, metrics: manifest.metrics }));
    return result;
  } catch (error) {
    console.error('scene_render_failed', JSON.stringify({ ...trace, elapsedMs: Math.round(performance.now() - started), ...options, resourcesBefore, resourcesAfter: await resourceSnapshot(), filesystemsBefore, filesystemsAfter: await filesystemSnapshot() }));
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
