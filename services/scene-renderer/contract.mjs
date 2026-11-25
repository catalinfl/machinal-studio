import { SceneDiagnosticError } from './diagnostics.mjs';

const SCENE_PACKAGES = new Set(['@machinal/scenes', '@machinal/scenes/svelte', '@direction/scene-svelte']);
const RUNTIME_HELPER_PACKAGES = new Set(['@machinal/scenes/runtime', '@direction/scene-runtime']);
const FORBIDDEN_RUNTIME_PROPS = new Set([
  'frame',
  'fps',
  'durationInFrames',
  'totalFrames',
  'time',
  'currentTime',
  'elapsed',
  'progress',
  'width',
  'height',
]);
const WALL_CLOCK_TIMERS = new Set(['requestAnimationFrame', 'setInterval', 'setTimeout']);
const ANIMATED_STYLE_PROPERTY = /(?:opacity|transform|clip-path|stroke-dashoffset)\s*:/i;

const RUNTIME_FIX =
  'Import `{ SceneCanvas, useScene }` from `@direction/scene-svelte`, call `const scene = useScene()`, and derive motion reactively with `$derived(scene.frame.time)` (or use `SceneThree` returning `{ update(frame) }`). Valid `$props()` are only `images`, `videos`, `models`, and `parameters`.';

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (visit(node, parent) === false) return;
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit, node);
    } else if (value && typeof value === 'object') {
      walk(value, visit, node);
    }
  }
}

function unwrapTs(node) {
  let current = node;
  while (current && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(current.type)) {
    current = current.expression;
  }
  return current;
}

function isRuneCall(node, name) {
  const expr = unwrapTs(node);
  if (expr?.type !== 'CallExpression') return false;
  if (expr.callee?.type === 'Identifier' && expr.callee.name === name) return true;
  if (expr.callee?.type === 'MemberExpression' && expr.callee.object?.type === 'Identifier' && expr.callee.object.name === name) return true;
  return false;
}

function propKeyName(property) {
  if (!property || property.type !== 'Property') return undefined;
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return undefined;
}

function memberName(node) {
  if (node?.type !== 'MemberExpression') return undefined;
  return node.computed
    ? (node.property?.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : undefined)
    : node.property?.name;
}

function collectForbiddenRuntimeProps(ast) {
  const found = new Set();
  const propsAliases = new Set();
  walk(ast.instance, node => {
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
      for (const declarator of node.declaration.declarations ?? []) {
        if (declarator.id?.type === 'Identifier' && FORBIDDEN_RUNTIME_PROPS.has(declarator.id.name)) {
          found.add(declarator.id.name);
        }
      }
      return;
    }
    if (node.type === 'VariableDeclarator' && isRuneCall(node.init, '$props')) {
      if (node.id?.type === 'ObjectPattern') {
        for (const property of node.id.properties ?? []) {
          const key = propKeyName(property);
          if (key && FORBIDDEN_RUNTIME_PROPS.has(key)) found.add(key);
        }
      } else if (node.id?.type === 'Identifier') {
        propsAliases.add(node.id.name);
      }
    }
  });
  if (propsAliases.size) {
    walk(ast, node => {
      if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return;
      if (!propsAliases.has(node.object.name)) return;
      const key = memberName(node);
      if (key && FORBIDDEN_RUNTIME_PROPS.has(key)) found.add(key);
    });
  }
  return [...found];
}

function hasAnimatedTemplateStyle(html) {
  let animated = false;
  walk(html, node => {
    if (animated) return false;
    if (node.type !== 'Attribute' || node.name !== 'style' || !Array.isArray(node.value)) return;
    const hasTag = node.value.some(chunk => chunk?.type === 'MustacheTag');
    if (!hasTag) return;
    if (node.value.length === 1 && node.value[0]?.type === 'MustacheTag') {
      animated = true;
      return false;
    }
    const text = node.value.filter(chunk => chunk?.type === 'Text').map(chunk => chunk.data).join(' ');
    if (ANIMATED_STYLE_PROPERTY.test(text)) {
      animated = true;
      return false;
    }
  });
  return animated;
}

function findNonReactiveFrameRead(init, sceneVars) {
  let found = false;
  walk(init, (node, parent) => {
    if (found) return false;
    if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration'].includes(node.type)) return false;
    if (isRuneCall(node, '$derived') || isRuneCall(node, '$effect')) return false;
    if (node.type === 'MemberExpression' && node.object?.type === 'Identifier' && sceneVars.has(node.object.name) && memberName(node) === 'frame') {
      if (parent?.type === 'MemberExpression' && parent.object === node && memberName(parent) === 'config') return;
      found = true;
      return false;
    }
  });
  return found;
}

export function validateSceneDesign(ast, visualMode) {
  if (visualMode !== undefined && visualMode !== '' && visualMode !== 'auto' && visualMode !== '2d' && visualMode !== '3d') {
    throw new SceneDiagnosticError('Scene visualMode must be auto, 2d or 3d');
  }

  const body = ast.instance?.content?.body ?? [];

  // 1. Reject Remotion-style timing/canvas props in `$props()` or `export let` (before Svelte's `use $props()` error misleads agents).
  const forbiddenProps = collectForbiddenRuntimeProps(ast);
  if (forbiddenProps.length) {
    throw new SceneDiagnosticError(
      `Machinal does not pass \`${forbiddenProps.join(', ')}\` via \`$props()\` or \`export let\` — those props stay frozen at 0 and hide animated elements. ${RUNTIME_FIX}`,
    );
  }

  // 2. Reject non-deterministic wall-clock animation timers.
  let timerFound = null;
  walk(ast.instance, node => {
    if (timerFound) return false;
    if (node.type !== 'CallExpression') return;
    if (node.callee?.type === 'Identifier' && WALL_CLOCK_TIMERS.has(node.callee.name)) {
      timerFound = node.callee.name;
      return false;
    }
    if (
      node.callee?.type === 'MemberExpression'
      && node.callee.object?.type === 'Identifier'
      && ['window', 'globalThis', 'self'].includes(node.callee.object.name)
      && WALL_CLOCK_TIMERS.has(memberName(node.callee))
    ) {
      timerFound = memberName(node.callee);
      return false;
    }
  });
  if (timerFound) {
    throw new SceneDiagnosticError(`\`${timerFound}()\` is non-deterministic and breaks headless frame-by-frame capture. ${RUNTIME_FIX}`);
  }

  // 3. Collect scene runtime imports (`useScene`, `SceneThree`, helper packages).
  const sceneThreeNames = new Set();
  const useSceneNames = new Set();
  let importsRuntimeHelpers = false;
  for (const statement of body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const source = statement.source?.value;
    if (RUNTIME_HELPER_PACKAGES.has(source)) importsRuntimeHelpers = true;
    if (!SCENE_PACKAGES.has(source)) continue;
    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type !== 'ImportSpecifier') continue;
      if (specifier.imported?.name === 'SceneThree') sceneThreeNames.add(specifier.local.name);
      if (specifier.imported?.name === 'useScene') useSceneNames.add(specifier.local.name);
    }
  }

  let renderedSceneThree = false;
  if (sceneThreeNames.size) {
    walk(ast.html, node => {
      if (node.type === 'InlineComponent' && sceneThreeNames.has(node.name)) {
        renderedSceneThree = true;
        return false;
      }
    });
  }

  let calledUseScene = false;
  let usesReactiveRunes = false;
  walk(ast.instance, node => {
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier') {
      if (useSceneNames.has(node.callee.name)) calledUseScene = true;
      if (['$derived', '$effect', '$state'].includes(node.callee.name)) usesReactiveRunes = true;
    } else if (
      node.type === 'CallExpression'
      && node.callee?.type === 'MemberExpression'
      && node.callee.object?.type === 'Identifier'
      && ['$derived', '$effect', '$state'].includes(node.callee.object.name)
    ) {
      usesReactiveRunes = true;
    }
  });

  // 4. Reject non-reactive top-level `useScene()` / `scene.frame` snapshots.
  if (calledUseScene) {
    const sceneVars = new Set();
    for (const statement of body) {
      if (statement.type !== 'VariableDeclaration') continue;
      for (const declarator of statement.declarations ?? []) {
        const init = unwrapTs(declarator.init);
        if (init?.type === 'CallExpression' && init.callee?.type === 'Identifier' && useSceneNames.has(init.callee.name)) {
          if (declarator.id?.type === 'ObjectPattern') {
            if ((declarator.id.properties ?? []).some(prop => propKeyName(prop) === 'frame')) {
              throw new SceneDiagnosticError(
                'Do not destructure `const { frame } = useScene()` at top level — that captures frame 0 once non-reactively. Use `const scene = useScene(); const t = $derived(scene.frame.time);`.',
              );
            }
          } else if (declarator.id?.type === 'Identifier') {
            sceneVars.add(declarator.id.name);
          }
          continue;
        }
        if (sceneVars.size && init && !isRuneCall(init, '$derived') && findNonReactiveFrameRead(init, sceneVars)) {
          throw new SceneDiagnosticError(
            'Non-reactive top-level read of `scene.frame` stays frozen at frame 0 in Svelte 5. Wrap it in `$derived(scene.frame.time)` (or read inside `$derived.by` / `$effect`).',
          );
        }
      }
    }
  }

  // 5. Reject animated/reactive scenes that never read frame time from `useScene()` or `SceneThree`.
  if (ast.instance && !calledUseScene && !renderedSceneThree) {
    if (usesReactiveRunes || importsRuntimeHelpers || hasAnimatedTemplateStyle(ast.html)) {
      throw new SceneDiagnosticError(
        `Animated/reactive scene does not read frame time from \`useScene()\` or \`SceneThree\`, so animated elements stay frozen on frame 0. ${RUNTIME_FIX}`,
      );
    }
  }

  // 6. Explicit 3D mode requires genuine imported + rendered SceneThree.
  if (visualMode === '3d' && !renderedSceneThree) {
    throw new SceneDiagnosticError('visualMode=3d requires an imported and rendered SceneThree with real geometry, lights and a deterministic update(frame); CSS/SVG imitations are not a 3D scene');
  }
}
