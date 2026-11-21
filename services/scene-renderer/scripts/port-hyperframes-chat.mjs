import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const reference = new URL('../../../packages/mcp-installer/library/', import.meta.url);
const ports = [
  { id: 'transitions-3d', ledgerId: 'blocks-transitions-3d', path: 'blocks/transitions-3d.svelte', category: 'blocks', width: 1920, height: 1080, duration: 11, selector: '[data-composition-id="transitions-3d"]' },
  { id: 'ui-3d-reveal', ledgerId: 'blocks-ui-3d-reveal', path: 'blocks/ui-3d-reveal.svelte', category: 'blocks', width: 1920, height: 1080, duration: 13, selector: '[data-composition-id="ui-3d-reveal"]', allowOversize: true },
  { id: 'agent-cursor', ledgerId: 'components-agent-cursor', path: 'components/agent-cursor.svelte', category: 'components', width: 1920, height: 1080, duration: 4.8, selector: '[data-composition-id="agent-cursor"]' },
  { id: 'ai-answer-rank', ledgerId: 'blocks-ai-answer-rank', path: 'blocks/ai-answer-rank.svelte', category: 'blocks', width: 1920, height: 1080, duration: 9, selector: '#aar-root', prefix: 'aar' },
  { id: 'ai-chat-reveal', ledgerId: 'blocks-ai-chat-reveal', path: 'blocks/ai-chat-reveal.svelte', category: 'blocks', width: 1080, height: 1920, duration: 19.3333333333, selector: '#acr-root', prefix: 'acr', logo: true },
  { id: 'vfx-anamorphic-flare', ledgerId: 'blocks-vfx-anamorphic-flare', path: 'blocks/vfx-anamorphic-flare.svelte', category: 'blocks', width: 1920, height: 1080, duration: 10, selector: '#af-root' },
  { id: 'animated-bar-chart', ledgerId: 'components-animated-bar-chart', path: 'components/animated-bar-chart.svelte', category: 'components', width: 1080, height: 1080, duration: 1.2, selector: '.hf-catalog-animated-bar-chart' },
  { id: 'cursor-annotate', ledgerId: 'components-cursor-annotate', path: 'components/cursor-annotate.svelte', category: 'components', width: 1920, height: 1080, duration: 2.95, selector: '[data-composition-id="cursor-annotate"]' },
  { id: 'app-showcase', ledgerId: 'blocks-app-showcase', path: 'blocks/app-showcase.svelte', category: 'blocks', width: 1920, height: 1080, duration: 5.5, selector: '[data-composition-id="app-showcase"]' },
  { id: 'apple-money-count', ledgerId: 'blocks-apple-money-count', path: 'blocks/apple-money-count.svelte', category: 'blocks', width: 1920, height: 1080, duration: 5, selector: '#root', dynamicMoney: true },
];
const approved = new Set(ports.map(port => port.ledgerId));
const sourceBase = 'hyperframes-library/registry/';
const templateDestinations = port => [
  new URL(`scene-templates/hyperframes-${port.ledgerId}.svelte`, reference),
  new URL(`../../../packages/mcp-installer/skills/machinal-scenes/references/scene-templates/hyperframes-${port.ledgerId}.svelte`, import.meta.url),
];

if (!process.argv.includes('--catalog-only')) for (const port of ports) {
  const sourcePath = port.category === 'components'
    ? `${sourceBase}components/${port.id}/${port.id}.html`
    : `${sourceBase}blocks/${port.id}/${port.id}.html`;
  const source = await readFile(new URL(sourcePath, reference), 'utf8');
  let markup, css, script, preamble = '';

  if (port.id === 'animated-bar-chart') {
    markup = source.match(/(<div class="hf-catalog-animated-bar-chart">[\s\S]*?<\/div>)(?=\s*<script|\s*$)/)?.[1]
      ?? source.match(/<div class="hf-catalog-animated-bar-chart">[\s\S]*?<\/div>/)?.[0];
    css = source.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
    if (!markup) throw new Error(`Original chart markup not found: ${sourcePath}`);
    markup = markup.replace('class="hf-catalog-animated-bar-chart"', 'class="hf-catalog-animated-bar-chart" bind:this={root}');
    script = `
      const timeline = gsap.timeline({ paused: true });
      timeline.from(root.querySelectorAll('.bar'), { scaleY: 0, transformOrigin: 'bottom', duration: 0.8, stagger: 0.08, ease: 'power3.out' }, 0);
      const line = root.querySelector('svg path');
      if (line) { const length = line.getTotalLength(); gsap.set(line, { strokeDasharray: length, strokeDashoffset: length }); timeline.to(line, { strokeDashoffset: 0, duration: 1.2, ease: 'power2.out' }, 0); }
      return timeline;`;
  } else {
    css = source.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] ?? '';
    const templateSource = source.match(/<template>([\s\S]*?)<\/template>/i)?.[1];
    const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]
      ?? (templateSource ? `<template>${templateSource}</template>` : undefined);
    const generic = source.match(/<div class="hf-catalog-animated-bar-chart">[\s\S]*?<\/div>/)?.[0];
    markup = body?.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').trim() ?? generic;
    if (port.id === 'ui-3d-reveal') markup = markup.replace(/<link\b[^>]*>/gi, '');
    if (!markup) throw new Error(`Original body markup not found: ${sourcePath}`);
    const inlineScripts = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(match => !/\bsrc\s*=/.test(match[1]));
    const fullScript = inlineScripts.map(match => match[2]).find(value => /gsap\.timeline|__timelines/.test(value));
    if (fullScript) {
      const wrapped = fullScript.match(/\(function\s*\(\)\s*\{([\s\S]*)\}\)\s*\(\s*\)\s*;?/)?.[1]
        ?? fullScript.match(/\(function\s*\(\)\s*\{([\s\S]*)\}\)\(\)\s*;?/)?.[1]
        ?? fullScript;
      script = wrapped
        .replace(/var\s+vars\s*=\s*[\s\S]*?:\s*\{\s*\}\s*;/, 'var vars = design;')
        .replace(/var\s+vars\s*=\s*[\s\S]*?\n\s*;\s*/, 'var vars = design;')
        .replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;?/g, '')
        .replace(/window\.__timelines\s*\[\s*["'][^"']+["']\s*\]\s*=\s*tl\s*;?/g, 'return tl;')
        .replace(/document\.getElementById\(\s*(["'])([^"']+)\1\s*\)/g, (_, _q, id) => id === 'root' || id.endsWith('-root') ? 'root' : `root.querySelector("#${id}")`)
        .replace(/document\.querySelector(All)?\(/g, (_, all) => `root.querySelector${all ?? ''}(`)
        .replace(/window\.__hyperframes\s*&&\s*typeof\s+window\.__hyperframes\.getVariables\s*===\s*["']function["'][\s\S]*?:\s*\{\s*\}\s*;/g, 'design;')
        .replace(/var\s+vars\s*=\s*[\s\S]*?:\s*\{\s*\}\s*;/, 'var vars = design;')
        .replace(/\bvars\s*=\s*window\.__hyperframes[\s\S]*?;\s*/g, 'vars = design;')
        .replace(/var\s+S\s*=\s*(['"])(.*?)\1\s*;/, `var S = '${port.selector}';`)
        .replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;?/g, '')
        .replace(/window\.__timelines\s*\[[^\]]+\]\s*=\s*tl\s*;?/g, '')
        .replace(/window\.__timelines\s*\[[^\]]+\]\s*=\s*timeline\s*;?/g, '');
      if (/window\.__timelines/.test(script)) throw new Error(`Unadapted global timeline reference in ${port.id}`);
    } else script = '';
    markup = markup.replace(/data-composition-id="[^"]+"/, `data-composition-id="${port.id}"`)
      .replace(/data-composition-src="[^"]+"/g, '');
    if (port.selector.startsWith('#') && !port.complex && !port.canvas) {
      const rootId = port.selector.slice(1);
      if (!markup.includes(`id="${rootId}"`)) markup = markup.replace(/<([a-z][\w-]*)(\s|>)/i, `<$1 id="${rootId}"$2`);
      markup = markup.replace(`id="${rootId}"`, `id="${rootId}" bind:this={root}`);
    } else markup = markup.replace(/<([a-z][\w-]*)(\s|>)/i, `<$1 bind:this={root}$2`);
    if (port.logo) {
      const logo = await readFile(new URL('hyperframes-library/registry/blocks/ai-chat-reveal/assets/hyperframes-logo-white.svg', reference));
      markup = markup.replace('src="assets/hyperframes-logo-white.svg"', `src="data:image/svg+xml;base64,${logo.toString('base64')}"`);
    }
    if (port.id === 'transitions-3d' || port.id === 'app-showcase') {
      markup = markup.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, '').replace(/<audio\b[^>]*\/?>/gi, '');
      css = css.replace(/@import\s+url\([^)]*\)\s*;?/gi, '').replace(/\bbody\b/g, ':global(body)').replace(/\bhtml\b/g, ':global(html)');
    }
    css = css.replace(/(^|})\s*([^{}]+)\s*\{/g, (_all, boundary, selectors) => {
      const scoped = selectors.split(',').map(selector => `:global(${selector.trim()})`).join(', ');
      return `${boundary}\n${scoped} {`;
    });
    css = css.replace(/:global\(:global\(([^)]+)\)\)/g, ':global($1)');
    if (port.id === 'ui-3d-reveal') {
      // The complete editor markup is retained. SVG path-length measurement occurs after mounting.
      preamble = `root.querySelectorAll('svg path, svg circle').forEach(el => {
        const len = el.tagName.toLowerCase() === 'circle' ? 2 * Math.PI * Number(el.getAttribute('r')) : el.getTotalLength();
        el.style.strokeDasharray = len; el.style.strokeDashoffset = len;
      });`;
      markup = markup.replace(/<link\b[^>]*>/gi, '');
    }
    if (port.id === 'agent-cursor' || port.id === 'cursor-annotate') {
      const templateMatch = source.match(/<template>([\s\S]*?)<\/template>/i);
      if (!templateMatch) throw new Error(`Original mount template not found in ${port.id}`);
      css = templateMatch[1].match(/<style>([\s\S]*?)<\/style>/i)?.[1] ?? css;
      markup = templateMatch[1].replace(/<style>[\s\S]*?<\/style>/i, '').trim();
      const sourceScript = [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].find(match => !/\bsrc\s*=/.test(match[1]));
      if (sourceScript) {
        const body = sourceScript[2];
        const start = body.indexOf('(function () {');
        const close = body.indexOf('window.__timelines', start);
        const inner = start >= 0 && close > start ? body.slice(start + '(function () {'.length, close) : body;
        const selected = inner.replace(/var\s+root\s*=\s*document\.getElementById\("root"\);/, '')
          .replace(/var\s+html\s*=\s*document\.documentElement;/, 'var html = root;')
          .replace(/document\.getElementById\("([^"]+)"\)/g, 'root.querySelector("#$1")')
          .replace(/document\.documentElement/g, 'root');
        script = selected
          .replace(/window\.__hfVariables\s*\|\|\s*\{\}/g, 'design')
          .replace(/var\s+vars\s*=\s*Object\.assign\(\{\},\s*DEFAULTS,\s*window\.__hfVariables\s*\|\|\s*\{\},\s*scopedVariables\);/, 'var vars = Object.assign({}, DEFAULTS, design);')
          .replace(/var\s+scopedVariables\s*=\s*\{\};[\s\S]*?var\s+vars\s*=\s*Object\.assign\([^;]+;/g, 'var scopedVariables = {}; var vars = Object.assign({}, DEFAULTS, design);')
          .replace(/var\s+scopedVariables\s*=\s*\{\};[\s\S]*?var\s+vars\s*=\s*Object\.assign\([^;]+;/g, 'var scopedVariables = {}; var vars = Object.assign({}, DEFAULTS, design);')
          .replace(/var\s+vars\s*=\s*Object\.assign\([^;]+;/g, 'var vars = Object.assign({}, DEFAULTS, design);')
          .replace(/var\s+scopedVariables\s*=\s*\{\};\s*try\s*\{[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{[\s\S]*?\}\s*var\s+vars\s*=/g, 'var scopedVariables = {}; var vars =')
          .replace(/var\s+scopedVariables\s*=\s*\{\};[\s\S]*?var\s+vars\s*=\s*Object\.assign\(\{\},\s*DEFAULTS,\s*window\.__hfVariables\s*\|\|\s*\{\},\s*scopedVariables\);/g, 'var vars = Object.assign({}, DEFAULTS, design);')
          .replace(/if\s*\(\s*window\.__hyperframes[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{\s*\}/g, '')
          .replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;?/g, '')
          .replace(/window\.__timelines\s*\[[^\]]+\]\s*=\s*tl\s*;?/g, '')
          .replace(/document\.documentElement/g, 'root')
          .replace(/document\.getElementById\(\s*["']root["']\s*\)/g, 'root')
          .replace(/document\.getElementById\(\s*["']([^"']+)["']\s*\)/g, 'root.querySelector("#$1")')
          .replace(/var\s+root\s*=\s*root\s*;/g, '')
          .replace(/var\s+html\s*=\s*document\.documentElement\s*;/g, 'var html = root;')
          .replace(/document\.documentElement/g, 'root')
          .replace(/if\s*\(\s*window\.__hyperframes[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{\s*\}/g, '')
          .replace(/if\s*\(\s*window\.__hyperframes[\s\S]*?\}\s*/g, '')
          .replace(/window\.__hfVariables\s*\|\|\s*\{\}/g, 'design')
          .replace(/window\.__timelines[\s\S]*$/g, '')
          .replace(/return\s+typeof\s+tl[\s\S]*$/g, '');
      }
      const rootElement = markup.match(/<([a-z][\w-]*)\b([^>]*)>/i);
      if (!rootElement) throw new Error(`Original template root not found in ${port.id}`);
      markup = markup.replace(rootElement[0], `<${rootElement[1]}${rootElement[2]} bind:this={root}>`);
      script = script.replace(/document\.getElementById\(\s*["']root["']\s*\)/g, 'root')
        .replace(/document\.querySelector\(/g, 'root.querySelector(')
        .replace(/document\.querySelectorAll\(/g, 'root.querySelectorAll(');
      script = script.replace(/if\s*\(\s*window\.__hyperframes[\s\S]*?\}\s*catch\s*\([^)]*\)\s*\{\s*\}/g, '');
      script = script.replace(/window\.__hfVariables\s*\|\|\s*\{\}/g, 'design')
        .replace(/var\s+vars\s*=\s*Object\.assign\([^;]+;/g, 'var vars = Object.assign({}, DEFAULTS, design);');
    }
    if (port.id === 'ui-3d-reveal') {
      script = script.replaceAll('document.querySelector(', 'root.querySelector(')
        .replaceAll('document.querySelectorAll(', 'root.querySelectorAll(');
      script = script.replace(/window\.__timelines\s*=\s*window\.__timelines\s*\|\|\s*\{\}\s*;?/g, '')
        .replace(/window\.__timelines\s*\[[^\]]+\]\s*=\s*tl\s*;?/g, '');
      markup = markup.replace(/<div\b([^>]*data-composition-id="ui-3d-reveal"[^>]*)>/, '<div$1 bind:this={root}>');
      markup = markup.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
      markup = markup.replace(/<link\b[^>]*>/gi, '');
      markup = markup.replace(/<audio\b[^>]*>[\s\S]*?<\/audio>/gi, '').replace(/<audio\b[^>]*\/?>/gi, '');
      css = css.replace(/@import\s+url\([^)]*\)\s*;?/gi, '').replace(/\bhtml\b/g, ':global(html)').replace(/\bbody\b/g, ':global(body)');
      css = css.replace(/(^|})\s*([^{}]+)\s*\{/g, (_all, boundary, selectors) =>
        `${boundary}\n${selectors.split(',').map(selector => `:global(${selector.trim()})`).join(', ')} {`);
      css = css.replace(/:global\(:global\(([^)]+)\)\)/g, ':global($1)');
    }
    if (port.id === 'agent-cursor' || port.id === 'cursor-annotate') {
      script = script.replace(/var compositionId\s*=\s*["'][^"']+["']\s*;/g, '')
        .replace(/var\s+root\s*=\s*root\s*;/g, '')
        .replace(/var\s+html\s*=\s*document\.documentElement\s*;/g, 'var html = root;')
        .replace(/document\.documentElement/g, 'root');
      const firstReturn = script.indexOf('\nreturn typeof tl');
      if (firstReturn >= 0) script = script.slice(0, firstReturn);
      script = script.replace(/return tl;\s*draw\(0\);?/g, 'draw(0); return tl;');
      if (!/\breturn tl;/.test(script)) script += '\nreturn tl;';
    }
    if (port.nativeSpecial === 'flare') {
      script = script.replace(/var root\s*=\s*root\s*;/, '')
        .replace(/window\.__hyperframes\s*&&\s*window\.__hyperframes\.getVariables\(\)\s*\|\|\s*\{\}/g, 'design')
        .replace(/return typeof tl[\s\S]*$/, '')
        .replace(/draw\(0\);\s*$/, 'draw(0); return tl;');
    }
    if (port.dynamicMoney) {
      const dynamicSetup = `
        const amount = root.querySelector('#amount');
        const burst = root.querySelector('#moneyBurst');
        const icons = [], specs = [];
        for (let i = 0; i < 62; i += 1) {
          const icon = document.createElement('div');
          const coin = i % 3 === 0;
          icon.className = 'money-icon ' + (coin ? 'coin' : 'bill');
          icon.innerHTML = '<span class="mark">$</span>';
          burst.appendChild(icon); icons.push(icon);
          const angle = i * 2.399963229728653, ring = i % 5;
          specs.push({
            x: Math.max(-865, Math.min(865, Math.cos(angle) * (260 + ring * 145 + (i % 7) * 12) + (i % 4) * 24 - 36)),
            y: Math.max(-465, Math.min(465, Math.sin(angle * 1.13) * (160 + ring * 78 + (i % 6) * 12) + (i % 5) * 18 - 36)),
            delay: (i % 8) * .025, duration: .74 + (i % 5) * .045, fadeDelay: (i % 5) * .05,
            rotation: (i * 43) % 160 - 80, scale: coin ? .72 + (i % 4) * .08 : .68 + (i % 5) * .07
          });
        }
        const state = { value: 0 };
        const renderAmount = value => { amount.textContent = '$' + Math.round(Math.max(0, Math.min(10000, value))).toLocaleString('en-US'); };
        renderAmount(0);
        gsap.set(icons, { x: 0, y: 0, xPercent: -50, yPercent: -50, opacity: 0, scale: .18, transformOrigin: '50% 50%' });
        const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
        tl.from(amount, { y: 26, opacity: 0, scale: .985, duration: .45, ease: 'power2.out' }, 0);
        tl.to(state, { value: 10000, duration: 3.16, ease: 'none', onUpdate: () => renderAmount(state.value), onComplete: () => renderAmount(10000) }, 0);
        tl.to(amount, { color: 'var(--accent, #30d158)', textShadow: '0 3px 0 var(--bg, rgba(255,255,255,0.52)), 0 18px 40px var(--accent, rgba(48,209,88,0.3)), 0 46px 96px var(--brand, rgba(7,84,31,0.2))', duration: .18 }, 3.16);
        tl.to(amount, { scale: 1.06, duration: .16, ease: 'back.out(2.2)' }, 3.16).to(amount, { scale: 1, duration: .23, ease: 'power2.out' }, 3.33);
        tl.to(root.querySelector('#greenFlash'), { opacity: .34, duration: .08, ease: 'none' }, 3.16).to(root.querySelector('#greenFlash'), { opacity: .22, duration: .76, ease: 'none' }, 3.24).to(root.querySelector('#greenFlash'), { opacity: 0, duration: .16, ease: 'power2.out' }, 4);
        icons.forEach((icon, i) => {
          const s = specs[i];
          tl.to(icon, { x: s.x, y: s.y, rotation: s.rotation, scale: s.scale, opacity: 1, duration: s.duration, ease: 'power4.out' }, 3.28 + s.delay);
          tl.to(icon, { y: s.y + (s.y < 0 ? -58 : 58), scale: s.scale * .54, opacity: 0, duration: .38, ease: 'power2.in' }, 4.18 + s.fadeDelay);
        });
        return tl;`;
      script = dynamicSetup;
    }
  }

  const timelineScript = `return (function(){\n${preamble}\n${script}\nreturn typeof tl !== 'undefined' ? tl : (typeof timeline !== 'undefined' ? timeline : gsap.timeline({ paused: true }));\n}).call(this);`;
  const component = `<!-- Faithful Svelte adaptation of ${sourcePath}; original DOM, CSS and GSAP timeline. Apache-2.0; original licence and CREDITS: hyperframes-library/. -->
<svelte:options preserveWhitespace={true} />
<script>
  import { untrack } from 'svelte';
  import { gsap } from 'gsap';
  import { SceneCanvas, useScene } from '@machinal/scenes/svelte';
  let { design = {} } = $props();
  const scene = useScene();
  let root = $state();
  let timeline = $state.raw();
  const scale = $derived(Math.min(scene.frame.config.width / ${port.width}, scene.frame.config.height / ${port.height}));

  $effect(() => {
    if (!root) return;
    const context = gsap.context(() => {
      timeline = initialize();
    }, root);
    return () => {
      context.revert();
      timeline = undefined;
    };
  });

  $effect(() => {
    const active = timeline;
    const time = scene.frame.time;
    if (active) untrack(() => active.seek(time, false));
  });

  function initialize() {
${timelineScript}
  }
</script>

<SceneCanvas background="${port.id === 'ai-answer-rank' ? '#efefee' : port.id === 'ai-chat-reveal' ? '#000' : 'transparent'}">
${markup}
</SceneCanvas>

<style>
:global {
${css}
  :global(${port.selector}) { transform-origin: top left; }
}

</style>
`;
  await writeFile(new URL(`hyperframes-native/${port.path}`, reference), component);
  const metadataPath = new URL(`hyperframes-native/${port.path.replace(/\.svelte$/, '.port.json')}`, reference);
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.animationRuntime = 'gsap';
  if (port.allowOversize) metadata.allowOversize = true;
  if (['blocks-transitions-3d', 'blocks-ui-3d-reveal'].includes(port.ledgerId)) metadata.visualMode = '2d';
  metadata.parameters = [...new Set([...(metadata.parameters ?? []), 'design.duration'])];
  metadata.config = { ...(metadata.config ?? {}), width: port.width, height: port.height, fps: 30, duration: port.duration };
  metadata.adaptations = [`Original ${port.id} DOM, source CSS, font stacks and deterministic GSAP timing retained in scoped Svelte markup. The paused timeline is sought from scene.frame.time.`, ...(port.complex ? ['Full detailed editor DOM, SVG artwork and choreography retained; no canvas-texture redraw.'] : []), ...(port.canvas ? ['Original canvas renderer is invoked deterministically on GSAP timeline updates/seeks.'] : []), ...(port.dynamicMoney ? ['All 62 original bill/coin DOM elements, positions, stagger, count, flash and GSAP tween specs retained.'] : [])];
  metadata.limitations = metadata.limitations?.filter(item => !/simplif|reduced|redrawn into|centered panel|62-item burst|SVG vector tokens/i.test(item)) ?? [];
  if (!metadata.limitations.length) metadata.limitations = ['Original web fonts may resolve to the browser system fallback when unavailable.'];
  metadata.verification = { compiled: false, visualInspection: false, motionVerified: false };
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + '\n');
  const ledgerPath = new URL('hyperframes-native.json', reference);
  const ledger = JSON.parse(await readFile(ledgerPath, 'utf8'));
  const entry = ledger.find(item => item.id === metadata.id);
  Object.assign(entry, metadata, { sourceVersion: `sha256:${createHash('sha256').update(component).digest('hex')}` });
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  for (const destination of templateDestinations(port)) await writeFile(destination, component);
  console.log(`Ported original DOM/CSS/GSAP: ${port.id}`);
}

const catalogPath = new URL('hyperframes-components.json', reference);
const templatesPath = new URL('scene-templates.json', reference);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
const templates = JSON.parse(await readFile(templatesPath, 'utf8'));
for (const port of ports) {
  const id = port.ledgerId;
  const metadata = JSON.parse(await readFile(new URL(`hyperframes-native/${port.path.replace(/\.svelte$/, '.port.json')}`, reference), 'utf8'));
  const source = await readFile(new URL(`hyperframes-native/${port.path}`, reference), 'utf8');
  const entry = catalog.find(entry => entry.id === metadata.id);
  if (!approved.has(metadata.id)) continue;
  entry.nativeLimitations = metadata.limitations;
  entry.nativeVerifiedCompiled = metadata.verification.compiled;
  entry.nativeSourceVersion = `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const template = templates.find(template => template.id === `hyperframes-${id}`);
  if (!template) continue;
  template.config = metadata.config;
  template.requiredImages = metadata.requiredImages;
  template.parameters = metadata.parameters.map(path => ({ path, description: 'Original Hyperframes variable.' }));
  template.adaptation = [...metadata.adaptations, ...metadata.limitations];
}
await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
await writeFile(templatesPath, JSON.stringify(templates, null, 2) + '\n');
