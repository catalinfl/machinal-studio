import { spawnSync } from 'node:child_process';
import ffmpeg from 'ffmpeg-static';

export function colorVideoSource() {
  const result = spawnSync(ffmpeg, ['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=10:d=0.5','-f','lavfi','-i','color=c=blue:s=160x90:r=10:d=0.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'], {windowsHide:true});
  if (result.status !== 0) throw new Error(`Video fixture failed: ${result.stderr}`);
  return `data:video/mp4;base64,${result.stdout.toString('base64')}`;
}

export const threeComponent = `<script>
import {SceneCanvas, SceneThree} from '@direction/scene-svelte';
import * as THREE from 'three';
function setup({world, camera}) {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7), new THREE.MeshBasicMaterial({color:'#d04090'}));
  world.add(cube);
  camera.position.z = 5;
  return {update(frame) { cube.rotation.set(frame.time * 0.7, frame.time * 1.5, 0); cube.position.x = frame.time - 0.5; }};
}
</script>
<SceneCanvas background="#ffffff"><SceneThree {setup} /></SceneCanvas>`;

export const videoComponent = `<script>
import {SceneCanvas, SceneVideo} from '@direction/scene-svelte';
let {videos = {}} = $props();
</script>
<SceneCanvas background="#ffffff"><SceneVideo src={videos.video_1} width={160} height={180} look="noir" effects={{vignette:0}} fit="contain" /></SceneCanvas>`;

export const multimediaComponent = `<script>
import {SceneCanvas, SceneThree, SceneVideo} from '@direction/scene-svelte';
let {videos = {}} = $props();
function setup({THREE,world,camera}) {
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7),new THREE.MeshBasicMaterial({color:'#d04090'}));
  world.add(cube); camera.position.z = 5;
  return {update(frame) {cube.rotation.set(frame.time * 0.7,frame.time * 1.5,0);}};
}
</script>
<SceneCanvas background="#ffffff">
  <div style="position:absolute;left:0;top:0"><SceneThree {setup} width={160} height={180} /></div>
  <div style="position:absolute;left:160px;top:0"><SceneVideo src={videos.video_1} width={160} height={180} look="noir" effects={{vignette:0}} /></div>
</SceneCanvas>`;
