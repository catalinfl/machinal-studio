import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { compileComponent } from '../render.mjs';
import { inspectEvidence } from '../evidence.mjs';
import { imageDataURL } from '../image-fixture.mjs';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);

export function reviewFrames(duration, fps) {
  const last = Math.round(duration * fps) - 1;
  return [...new Set([0, 0.2, 0.45, 0.7, 0.94].map(fraction => Math.min(last, Math.round(duration * fps * fraction))).concat(last))].sort((a, b) => a - b);
}

export async function reviewTemplate(id, output, { portrait = false } = {}) {
  const catalog = JSON.parse(await readFile(new URL('scene-templates.json', reference), 'utf8'));
  const template = catalog.find(item => item.id === id);
  if (!template) throw new Error('Choose an exact bundled scene-template ID');
  const component = await readFile(new URL(`scene-templates/${template.id}.svelte`, reference), 'utf8');
  const width = portrait ? 1080 : 1920, height = portrait ? 1920 : 1080;
  const input = { component, config: { width, height, fps: template.config.fps, durationInFrames: template.config.duration * template.config.fps, visualMode: template.visualMode, captionSafeBottom: 0.24 }, images: Object.fromEntries(template.requiredImages.map(image => [image.id, imageDataURL])) };
  // Explicit developer fixture command only; never receives project media or
  // substitutes this local test path for the MCP production renderer.
  await mkdir(output, { recursive: false });
  const previous = process.env.SCENE_BROWSER;
  process.env.SCENE_BROWSER ||= chromium.executablePath();
  try {
    await compileComponent({ ...input, inspectLayout: true });
    const evidence = await inspectEvidence({ ...input, frames: reviewFrames(template.config.duration, template.config.fps) });
    const frames = [];
    for (const { data, ...frame } of evidence.frames) {
      const file = `frame-${String(frame.frame).padStart(4, '0')}.jpg`;
      await writeFile(resolve(output, file), Buffer.from(data, 'base64'), { flag: 'wx' });
      frames.push({ ...frame, file });
    }
    const report = { templateId: id, templateVersion: template.version, sourceVersion: `sha256:${createHash('sha256').update(component).digest('hex')}`, config: input.config, ...evidence, frames, syntheticImages: true, aestheticApproval: false };
    await writeFile(resolve(output, 'evidence.json'), JSON.stringify(report, null, 2)+'\n', { flag: 'wx' });
    const tiles = frames.map(frame => `<figure><img src="${frame.file}" alt="frame ${frame.frame}"><figcaption>frame ${frame.frame} · ${frame.time.toFixed(2)}s</figcaption></figure>`).join('');
    await writeFile(resolve(output, 'index.html'), `<!doctype html><meta charset="utf-8"><title>${id} fixture review</title><style>body{background:#20252a;color:white;font:16px system-ui}main{display:grid;grid-template-columns:repeat(3,1fr)}img{max-width:100%}figure{margin:12px}</style><h1>${id}: synthetic fixture samples</h1><p>Technical evidence, not aesthetic approval, alpha, smooth motion or final-composition verification. Attached images are synthetic placeholders.</p><main>${tiles}</main>`, { flag: 'wx' });
    return report;
  } finally {
    if (previous === undefined) delete process.env.SCENE_BROWSER;
    else process.env.SCENE_BROWSER = previous;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [id, output, flag] = process.argv.slice(2);
  if (!id || !output || flag && flag !== '--portrait') {
    console.error('Usage: node scripts/review-template.mjs TEMPLATE_ID NEW_OUTPUT_DIRECTORY [--portrait]');
    process.exitCode = 1;
  } else {
    reviewTemplate(id, resolve(output), { portrait: flag === '--portrait' }).then(report => console.log(`Saved ${report.frames.length} synthetic frame samples and versioned evidence to ${resolve(output)}; visual result needs review.`)).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
