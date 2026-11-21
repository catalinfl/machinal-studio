import { deflateSync } from 'node:zlib';

function pngChunk(type, bytes) {
  const payload = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of payload) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const size = Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, payload, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(2, 0);
header.writeUInt32BE(1, 4);
header[8] = 8;
header[9] = 6;
// One transparent pixel followed by one opaque red pixel.
const pixels = deflateSync(Buffer.from([0, 0, 0, 0, 0, 255, 0, 0, 255]));
export const imageDataURL = `data:image/png;base64,${Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), pngChunk('IHDR', header), pngChunk('IDAT', pixels), pngChunk('IEND', Buffer.alloc(0))]).toString('base64')}`;

export const imageComponent = `<script>
import {useScene, SceneCanvas} from '@direction/scene-svelte';
let { images = {} } = $props();
const scene = useScene();
const x = $derived(scene.frame.time * 80);
</script>
<SceneCanvas background="#25f4ee"><img src={images.image_1} alt="Attached product" style="position:absolute;inset:0;width:100%;height:100%;image-rendering:pixelated" /><h1 style="position:relative;color:#171b22;transform:translateX({x}px)">A growing idea</h1></SceneCanvas>`;
