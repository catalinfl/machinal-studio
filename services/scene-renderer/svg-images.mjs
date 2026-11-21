export function normalizeSvgImages(source, template) {
  const edits = [];
  visitTemplate(template, false, node => edits.push(...imageEdits(source, node)));
  for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
    source = source.slice(0, start) + replacement + source.slice(end);
  }
  return source;
}

function visitTemplate(node, inSvg, visitImage) {
  if (!node) return;
  if (node.type === 'Element') {
    if (node.name === 'svg') inSvg = true;
    if (inSvg && node.name === 'img') visitImage(node);
    if (node.name === 'foreignObject') inSvg = false;
  }
  for (const child of node.children ?? []) visitTemplate(child, inSvg, visitImage);
  for (const branch of ['else', 'pending', 'then', 'catch']) visitTemplate(node[branch], inSvg, visitImage);
}

function imageEdits(source, node) {
  // HTML <img> ends SVG parsing in the browser, invalidating Svelte's compiled DOM traversal.
  const edits = [[node.start + 1, node.start + 4, 'image']];
  for (const attribute of node.attributes) {
    if (attribute.type !== 'Attribute' || attribute.name !== 'src') continue;
    const shorthand = source[attribute.start] === '{';
    edits.push(shorthand
      ? [attribute.start, attribute.end, `href=${source.slice(attribute.start, attribute.end)}`]
      : [attribute.start, attribute.start + 3, 'href']);
  }
  const style = node.attributes.find(attribute => attribute.type === 'Attribute' && attribute.name === 'style');
  const css = Array.isArray(style?.value) ? style.value.filter(part => part.type === 'Text').map(part => part.data).join('') : '';
  const fit = css.match(/(?:^|;)\s*object-fit\s*:\s*(cover|fill)\b/i)?.[1]?.toLowerCase();
  const aspect = fit === 'cover' ? 'xMidYMid slice' : fit === 'fill' ? 'none' : 'xMidYMid meet';
  const preserve = node.attributes.some(attribute => attribute.name === 'preserveAspectRatio');
  const selfClosing = /\/\s*>$/.test(source.slice(node.start, node.end));
  const insertion = selfClosing ? source.lastIndexOf('/', node.end - 1) : node.end - 1;
  edits.push([insertion, insertion, `${preserve ? '' : ` preserveAspectRatio="${aspect}"`}${selfClosing ? '' : ' /'}`]);
  return edits;
}
