import { SceneDiagnosticError } from './diagnostics.mjs';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function memberName(node) {
  return node.computed ? node.property?.type === 'Literal' ? node.property.value : undefined : node.property?.name;
}

export function validateMediaReferences(ast, input) {
  const aliases = new Map();
  walk(ast.instance, node => {
    if (node.type !== 'VariableDeclarator' || node.init?.callee?.name !== '$props' || node.id.type !== 'ObjectPattern') return;
    for (const property of node.id.properties) {
      const kind = property.key?.name;
      if (!['images', 'videos', 'models'].includes(kind)) continue;
      const binding = property.value?.type === 'AssignmentPattern' ? property.value.left : property.value;
      if (binding?.type === 'Identifier') aliases.set(binding.name, kind);
    }
  });
  const missing = new Set();
  walk(ast, node => {
    if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return;
    const kind = aliases.get(node.object.name);
    const id = memberName(node);
    if (!kind || typeof id !== 'string' || !/^(image_[1-4]|video_[1-2]|model_[1-2])$/.test(id)) return;
    if (!Object.hasOwn(input[kind] ?? {}, id)) missing.add(`${kind}.${id}`);
  });
  if (missing.size) throw new SceneDiagnosticError(`Missing scene attachments: ${[...missing].join(', ')}. Attach the actual approved project files in compile_scene; a prop reference does not attach media. Preserve existing artwork and do not regenerate successful assets.`);
}
