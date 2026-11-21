import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInput } from './bundle.mjs';

const config = { width: 1080, height: 1920, fps: 30, durationInFrames: 60 };
const png = 'data:image/png;base64,aA==';

test('rejects all missing Guénon image attachments before compiling or encoding', () => {
  const component = `<script>let {images={}}=$props();</script><img src={images.image_1} alt=""/><img src={images.image_2} alt=""/><img src={images.image_3} alt=""/>`;
  assert.throws(() => validateInput({ component, config }), /Missing scene attachments: images.image_1, images.image_2, images.image_3/);
  assert.doesNotThrow(() => validateInput({ component, config, images: { image_1: png, image_2: png, image_3: png } }));
});

test('checks aliased and static bracket media references, including script expressions', () => {
  const component = `<script>let {images:photos={},videos={}}=$props(); const file=photos['image_2']; const movie=videos.video_1;</script><p>{file}{movie}</p>`;
  assert.throws(() => validateInput({ component, config, images: { image_2: png } }), /videos.video_1/);
});

test('does not confuse unrelated local objects with media props or invent dynamic IDs', () => {
  assert.doesNotThrow(() => validateInput({ component: `<script>const images={image_1:'label'};</script><p>{images.image_1}</p>`, config }));
  assert.doesNotThrow(() => validateInput({ component: `<script>let {images={}}=$props(); const id='image_1';</script><p>{images[id]}</p>`, config }));
});
