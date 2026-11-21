import { build } from 'esbuild';
import { compile, compileModule, parse } from 'svelte/compiler';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { embeddedSceneFonts } from './fonts.mjs';
import { normalizeSvgImages } from './svg-images.mjs';
import { validateSceneDesign } from './contract.mjs';
import { BundleCache } from './bundle-cache.mjs';
import { SceneDiagnosticError } from './diagnostics.mjs';
import { validateMediaReferences } from './media-references.mjs';
import { validateSceneParameters, validateSceneModels } from '@machinal/scenes/runtime';

const allowedImports = new Set(['svelte', '@machinal/scenes', '@machinal/scenes/svelte', '@machinal/scenes/runtime', '@direction/scene-svelte', '@direction/scene-runtime', 'three']);
const bundles = new BundleCache();

export function validateInput(input) {
  if (!input || typeof input.component !== 'string' || input.component.length > 64000) throw new SceneDiagnosticError('A Svelte component of at most 64000 characters is required');
  const config = input.config;
  try { validateSceneParameters(input.parameters); validateSceneModels(input.models); }
  catch (error) { throw new SceneDiagnosticError(error.message); }
  if (!config || ![config.width, config.height, config.fps, config.durationInFrames].every(Number.isFinite)) throw new SceneDiagnosticError('Invalid scene configuration');
  if (![config.width, config.height, config.durationInFrames].every(Number.isInteger)
    || config.width < 2 || config.height < 2 || config.width > 1920 || config.height > 1920
    || config.width % 2 || config.height % 2 || config.fps < 1 || config.fps > 60
    || config.durationInFrames < 1 || config.durationInFrames / config.fps > 60) throw new SceneDiagnosticError('Scene exceeds rendering limits');
  if (config.transparent !== undefined && typeof config.transparent !== 'boolean') throw new SceneDiagnosticError('Invalid scene transparency');
  if (config.captionSafeBottom !== undefined && (!Number.isFinite(config.captionSafeBottom) || config.captionSafeBottom < 0 || config.captionSafeBottom > 0.5)) throw new SceneDiagnosticError('Invalid caption safe band');
  if (input.images !== undefined) {
    if (!input.images || typeof input.images !== 'object' || Array.isArray(input.images)) throw new SceneDiagnosticError('Invalid embedded images');
    const images = Object.entries(input.images);
    if (images.length > 4 || images.some(([id, source]) => !/^image_[1-4]$/.test(id) || typeof source !== 'string'
      || !/^data:image\/(png|jpeg|webp);base64,/.test(source) || source.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 + 64)) throw new SceneDiagnosticError('Invalid embedded images');
  }
  if (input.videos !== undefined) {
    if (!input.videos || typeof input.videos !== 'object' || Array.isArray(input.videos)) throw new SceneDiagnosticError('Invalid embedded videos');
    const videos = Object.entries(input.videos);
    if (videos.length > 2 || videos.some(([id, source]) => !/^video_[1-2]$/.test(id) || typeof source !== 'string'
      || !/^data:video\/(mp4|webm);base64,/.test(source) || source.length > Math.ceil(20 * 1024 * 1024 / 3) * 4 + 64)) throw new SceneDiagnosticError('Invalid embedded videos');
  }
  validateMediaReferences(parse(input.component), input);
  return { width: config.width, height: config.height, fps: config.fps, durationInFrames: config.durationInFrames, ...(config.transparent ? { transparent: true } : {}), ...(config.captionSafeBottom ? { captionSafeBottom: config.captionSafeBottom } : {}) };
}

export async function bundleComponent(source, outdir, preview = false, config = {}) {
  const key = createHash('sha256').update(JSON.stringify([source, preview, config.visualMode ?? null, Boolean(config.inspectLayout), Boolean(config.inspectEvidence)])).digest('hex');
  const javascript = await bundles.get(key, () => buildComponent(source, preview, config));
  await writeFile(`${outdir}/scene.js`, javascript);
}

async function buildComponent(source, preview, config) {
  const ast = parse(source);
  validateSceneDesign(ast, config.visualMode);
  if (ast.module) throw new SceneDiagnosticError('Module scripts are not supported in generated scenes');
  const compiled = compile(normalizeSvgImages(source, ast.html), { filename: 'GeneratedScene.svelte', generate: 'client', css: 'injected', runes: true });
  const fonts = await embeddedSceneFonts(source);
  const result = await build({
    absWorkingDir: import.meta.dirname,
    ...(preview ? { entryPoints: [fileURLToPath(new URL(config.inspectEvidence ? './evidence-entry.js' : config.inspectLayout ? './inspect-entry.js' : './preview-entry.js', import.meta.url))] } : { stdin: {
      contents: `import Scene from 'generated-scene';
import { mountSvelteScene } from '@machinal/scenes/svelte';
import { exposeScene } from '@machinal/scenes/runtime';
import { installSceneEnvironment, settleSceneFonts } from './scene-environment.js';
try {
  await installSceneEnvironment();
   const request = window.__sceneRequest;
   const capture = request.props?.__capture;
   const authoredRequest = capture ? { ...request, config: capture.config } : request;
   const controller = mountSvelteScene(Scene, document.getElementById('scene'), authoredRequest, {});
  const target = document.getElementById('scene');
   exposeScene({ ...controller,
     manifest: { ...controller.manifest, config: request.config },
     async ready() { await controller.ready(); await settleSceneFonts(target); },
     async seek(frame) { await controller.seek(frame + (capture?.startFrame ?? 0)); await settleSceneFonts(target); },
  });
  controller.ready().catch(error => { window.__sceneError = error.message; });
} catch (error) { window.__sceneError = error.message; }`,
      resolveDir: import.meta.dirname,
    } }),
    bundle: true, format: preview ? 'iife' : 'esm', platform: 'browser', conditions: ['svelte', 'browser'],
    alias: {
      '@direction/scene-svelte': '@machinal/scenes/svelte',
      '@direction/scene-runtime': '@machinal/scenes/runtime',
    },
    minify: preview,
    outfile: 'scene.js', write: false, logLevel: 'silent',
    plugins: [{
      name: 'generated-scene',
      setup(builder) {
        builder.onResolve({ filter: /^scene-font-css$/ }, () => ({ path: 'fonts', namespace: 'scene-fonts' }));
        builder.onLoad({ filter: /.*/, namespace: 'scene-fonts' }, () => ({ contents: `export default ${JSON.stringify(fonts)};`, loader: 'js' }));
        builder.onLoad({ filter: /\.svelte\.js$/ }, async args => {
          const contents = await readFile(args.path, 'utf8');
          return { contents: compileModule(contents, { filename: args.path, generate: 'client' }).js.code, loader: 'js' };
        });
        builder.onLoad({ filter: /\.svelte$/ }, async args => {
          const contents = await readFile(args.path, 'utf8');
          return { contents: compile(contents, { filename: args.path, generate: 'client', css: 'injected', runes: true }).js.code, loader: 'js' };
        });
        builder.onResolve({ filter: /^generated-scene$/ }, () => ({ path: 'scene', namespace: 'generated' }));
        builder.onLoad({ filter: /.*/, namespace: 'generated' }, () => ({ contents: compiled.js.code, loader: 'js', resolveDir: import.meta.dirname }));
        builder.onResolve({ filter: /.*/, namespace: 'generated' }, args => {
          if (allowedImports.has(args.path) || args.path.startsWith('svelte/')) return undefined;
          return { errors: [{ text: `Unsupported scene import: ${args.path}` }] };
        });
      },
    }],
  });
  return result.outputFiles[0].contents;
}

export const sceneHTML = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src blob:; media-src data: blob:; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'">
<style>html,body,#scene{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}</style>
</head><body><div id="scene"></div><script type="module" src="/scene.js"></script></body></html>`;
