import { SceneDiagnosticError } from './diagnostics.mjs';

const MEDIA_ITEM_ID = /^(image_[1-4]|video_[1-2]|model_[1-2])$/;

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(item => walk(item, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function unwrapTs(node) {
  let current = node;
  while (current && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression'].includes(current.type)) {
    current = current.expression;
  }
  return current;
}

function memberName(node) {
  return node.computed ? node.property?.type === 'Literal' ? node.property.value : undefined : node.property?.name;
}

function propKeyName(property) {
  if (!property || property.type !== 'Property') return undefined;
  if (property.key?.type === 'Identifier') return property.key.name;
  if (property.key?.type === 'Literal' && typeof property.key.value === 'string') return property.key.value;
  return undefined;
}

export function validateMediaReferences(ast, input) {
  const aliases = new Map();
  const propsAliases = new Set();
  const topLevelMediaProps = new Set();

  walk(ast.instance, node => {
    if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration') {
      for (const declarator of node.declaration.declarations ?? []) {
        if (declarator.id?.type === 'Identifier' && MEDIA_ITEM_ID.test(declarator.id.name)) {
          topLevelMediaProps.add(declarator.id.name);
        }
      }
      return;
    }
    if (node.type !== 'VariableDeclarator') return;
    const init = unwrapTs(node.init);
    if (init?.type !== 'CallExpression' || init.callee?.name !== '$props') return;
    if (node.id?.type === 'Identifier') {
      propsAliases.add(node.id.name);
      return;
    }
    if (node.id?.type !== 'ObjectPattern') return;
    for (const property of node.id.properties ?? []) {
      const kind = propKeyName(property);
      if (kind && MEDIA_ITEM_ID.test(kind)) {
        topLevelMediaProps.add(kind);
        continue;
      }
      if (!['images', 'videos', 'models'].includes(kind)) continue;
      const binding = property.value?.type === 'AssignmentPattern' ? property.value.left : property.value;
      if (binding?.type === 'Identifier') aliases.set(binding.name, kind);
    }
  });

  if (propsAliases.size) {
    walk(ast, node => {
      if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return;
      if (!propsAliases.has(node.object.name)) return;
      const id = memberName(node);
      if (typeof id === 'string' && MEDIA_ITEM_ID.test(id)) topLevelMediaProps.add(id);
    });
  }

  if (topLevelMediaProps.size) {
    const bad = [...topLevelMediaProps];
    const examples = bad.map(id => `${id.startsWith('image_') ? 'images' : id.startsWith('video_') ? 'videos' : 'models'}.${id}`);
    throw new SceneDiagnosticError(
      `Machinal does not pass \`${bad.join(', ')}\` as top-level props — they stay empty and render blank boxes. Destructure \`let { images = {}, videos = {}, models = {} } = $props();\` and reference \`${examples.join(', ')}\` instead.`,
    );
  }

  const missing = new Set();
  walk(ast, node => {
    if (node.type !== 'MemberExpression' || node.object?.type !== 'Identifier') return;
    const kind = aliases.get(node.object.name);
    const id = memberName(node);
    if (!kind || typeof id !== 'string' || !MEDIA_ITEM_ID.test(id)) return;
    if (!Object.hasOwn(input[kind] ?? {}, id)) missing.add(`${kind}.${id}`);
  });
  if (missing.size) throw new SceneDiagnosticError(`Missing scene attachments: ${[...missing].join(', ')}. Attach the actual approved project files in compile_scene; a prop reference does not attach media. Preserve existing artwork and do not regenerate successful assets.`);
}
