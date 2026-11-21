import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); });
  }
};
const output = new URL('../hyperframes/source-data/', import.meta.url);
await mkdir(output, { recursive: true });
const metal = new THREE.MeshStandardMaterial({ color: '#a6adb9', metalness: 0.8, roughness: 0.28 });
const black = new THREE.MeshStandardMaterial({ color: '#111722', metalness: 0.3, roughness: 0.2 });
const glass = new THREE.MeshStandardMaterial({ color: '#263d62', metalness: 0.2, roughness: 0.12 });
const box = (name, width, height, depth, material, radius = 0.04) => {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material);
  mesh.name = name;
  return mesh;
};
const phone = new THREE.Group();
phone.name = 'Sample phone';
phone.add(box('frame', 1.5, 3.2, 0.16, metal, 0.12));
const front = box('front-glass', 1.38, 3.04, 0.012, glass, 0.1);
front.position.z = -0.09;
phone.add(front);
const back = box('rear-window', 1.4, 3.1, 0.012, black, 0.1);
back.position.z = 0.09;
phone.add(back);
for (const x of [-0.38, -0.05]) {
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 24), black);
  lens.rotation.x = Math.PI / 2; lens.position.set(x, 1.13, 0.13); phone.add(lens);
}
const laptop = new THREE.Group();
laptop.name = 'Sample laptop';
const base = box('base', 3.8, 0.11, 2.5, metal);
base.position.set(0, -1.35, 0.9); laptop.add(base);
const lid = box('lid', 3.8, 2.5, 0.09, metal);
laptop.add(lid);
const display = box('display', 3.5, 2.18, 0.01, glass, 0.02);
display.position.z = 0.055; laptop.add(display);
for (let row = 0; row < 5; row++) for (let column = 0; column < 12; column++) {
  const key = box('key', 0.22, 0.012, 0.2, black, 0.01);
  key.position.set(-1.55 + column * 0.28, -1.285, 0.1 + row * 0.26); laptop.add(key);
}
const exporter = new GLTFExporter();
for (const [name, model] of [['iphone', phone], ['macbook', laptop]]) {
  const glb = await exporter.parseAsync(model, { binary: true });
  await writeFile(new URL(`${name}.glb`, output), Buffer.from(glb));
}
await writeFile(new URL('models.LICENSE.txt', output),
  'Project-authored generic sample phone and laptop geometry, CC0-1.0. These substitutes are not the original upstream branded models.\nGenerated with Three.js (MIT); see the Three.js licence in the upstream reference library.\n');
console.log('Built local generic phone and laptop GLB assets.');
