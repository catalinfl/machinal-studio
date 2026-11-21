import test from 'node:test';
import assert from 'node:assert/strict';
import { compileComponent } from './render.mjs';
import { threeComponent, videoComponent, colorVideoSource } from './multimedia-fixture.mjs';
import { imageDataURL } from './image-fixture.mjs';

const native = { skip: !process.env.SCENE_BROWSER, timeout: 120000 };
const config = { width: 1920, height: 1080, fps: 30, durationInFrames: 180, captionSafeBottom: 0.24 };
const scene = content => `<script>import {SceneCanvas} from '@direction/scene-svelte';</script><SceneCanvas background="#151A20">${content}</SceneCanvas>`;
const text = (copy, left, top, size = 48) => `<p style="margin:0;position:absolute;left:${left}px;top:${top}px;font-family:'Direction Sans';font-size:${size}px;line-height:1.2;color:white">${copy}</p>`;

test('native scene inspection accepts readable FHD Romanian labels with a separate caption band', native, async () => {
  const result = await compileComponent({ inspectLayout: true, config, component: scene(text('Mihai Eminescu', 150, 180, 80) + text('Știință, poezie și creație', 150, 350, 40)) });
  assert.ok(result.javascript.length > 0);
});

test('native scene inspection rejects collisions, clipped text, illegible type and caption-band overlap', native, async () => {
  for (const [component, expected] of [
    [scene(text('Știință', 150, 180) + text('Poezie', 170, 190)), /text_collision/],
    [scene(text('În afara cadrului', -160, 180)), /text_out_of_frame/],
    [scene(text('Text ilizibil', 150, 180, 8)), /text_too_small/],
    [scene(text('Text', 150, 180, 300)), /text_too_large/],
    [scene(text('Ocupă subtitrarea', 150, 920)), /caption_band_collision/],
  ]) {
    await assert.rejects(compileComponent({ inspectLayout: true, config, component }), expected);
  }
});

test('intentional decorative overlaps do not disable off-canvas and caption-band checks', native, async () => {
  await assert.rejects(compileComponent({ inspectLayout: true, config, component: scene(`<div data-layout-overlap="allow">${text('Nu ascunde subtitrarea', 150, 920)}</div>`) }), /caption_band_collision/);
});

test('native layout inspection supports attached images, video seeking and real Three.js', native, async () => {
  const mediaConfig = { width: 320, height: 180, fps: 10, durationInFrames: 10 };
  const imageComponent = `<script>import {SceneCanvas} from '@direction/scene-svelte';let {images}=$props();</script><SceneCanvas><img src={images.image_1} alt="Artwork" style="width:160px;height:90px" /></SceneCanvas>`;
  for (const input of [
    { component: imageComponent, images: { image_1: imageDataURL } },
    { component: threeComponent },
    { component: videoComponent, videos: { video_1: colorVideoSource() } },
  ]) {
    try {
      const result = await compileComponent({ ...input, config: mediaConfig, inspectLayout: true });
      assert.ok(result.javascript.length > 0);
    } catch (error) {
      throw new Error(`Layout inspection failed for ${input.images ? 'image' : input.videos ? 'video' : 'Three.js'}: ${error.message}`, { cause: error });
    }
  }
});
