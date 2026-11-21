export function validateSceneDesign(ast, visualMode) {
  if (visualMode === undefined || visualMode === '' || visualMode === 'auto' || visualMode === '2d') return;
  if (visualMode !== '3d') throw new SceneDiagnosticError('Scene visualMode must be auto, 2d or 3d');
  const names = new Set();
  for (const statement of ast.instance?.content?.body ?? []) {
    if (statement.type !== 'ImportDeclaration' || !['@machinal/scenes', '@machinal/scenes/svelte', '@direction/scene-svelte'].includes(statement.source.value)) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'SceneThree') names.add(specifier.local.name);
    }
  }
  let rendered = false;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'InlineComponent' && names.has(node.name)) rendered = true;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(ast.html);
  if (!rendered) throw new SceneDiagnosticError('visualMode=3d requires an imported and rendered SceneThree with real geometry, lights and a deterministic update(frame); CSS/SVG imitations are not a 3D scene');
}
import { SceneDiagnosticError } from './diagnostics.mjs';
