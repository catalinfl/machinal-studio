<script>
  import { onDestroy } from 'svelte';
  import { SceneCanvas, useScene } from '@direction/scene-svelte';
  import { resolveSceneObject, progressAt, easing, placeAnchoredLabel, anchorPoint, connectorPath } from '@direction/scene-runtime';
  let { parameters = {} } = $props();
  const scene = useScene();
  const base = $derived(resolveSceneObject(parameters, 'receiver', { x:630, y:242, color:'#f4be58', delay:0.2, duration:0.8 }));

  function stateAt(frame) {
    const progress = progressAt(frame.time, base.delay, base.duration, easing.smooth);
    return { x:base.x + 100*progress, y:base.y, opacity:base.opacity, color:base.color, rotation:base.rotation, scaleX:base.scaleX, scaleY:base.scaleY };
  }

  onDestroy(scene.objects.register('receiver', stateAt));
  const signal = $derived(stateAt(scene.frame));
  const received = $derived(progressAt(scene.frame.time, 0.9, 0.6, easing.smooth));
  const bounds = $derived({x:signal.x,y:signal.y,width:36,height:36});
  const label = $derived(placeAnchoredLabel(bounds, {width:150,height:36}, {x:48,y:120,width:864,height:270},
    {sides:['top','bottom'],gap:40,obstacles:[{x:120,y:210,width:100,height:100},{x:700,y:210,width:120,height:100}]}));

  const connector = $derived(connectorPath(anchorPoint(bounds,'top'), anchorPoint(label.bounds,'bottom')));
</script>

<SceneCanvas background="#101b29">
  <h1>Receptorul răspunde impulsului</h1>
  <svg width="960" height="540" aria-hidden="true">
    <path d="M220 260 H700" stroke="#3f607c" stroke-width="4" fill="none" />
    <path d={connector} stroke="#94aabd" stroke-width="2" fill="none" />
    <circle cx="170" cy="260" r="40" fill="none" stroke="#76b5e8" stroke-width="3" />
    <rect x="700" y="210" width="120" height="100" rx="20" fill="#203b50" stroke="#76b5e8" stroke-width="3" />
    <rect x="704" y="214" width="112" height="92" rx="16" fill="#f4be58" opacity={received*0.45} />
    {#each [0,1,2] as i}
      <path d="M820 260 H874" stroke="#f4be58" stroke-width="3" opacity={received*(1-i*0.2)} transform="translate(0 {28*(i-1)*received})" />
    {/each}
  </svg>
  <div data-scene-object="receiver" class="signal" style="left:{signal.x}px;top:{signal.y}px;opacity:{signal.opacity};background:{signal.color};transform:rotate({signal.rotation}rad) scale({signal.scaleX},{signal.scaleY})"></div>
  <div class="label" style="left:{label.bounds.x}px;top:{label.bounds.y}px">Impuls primit</div>
  <span class="emitter">Emițător</span>
  <span class="receiver-label">Receptor</span>
</SceneCanvas>

<style>
  h1{position:absolute;left:48px;top:36px;margin:0;color:#edf4fa;font:600 32px/1.2 'Direction Sans'}
  svg{position:absolute;inset:0}
  .signal{position:absolute;width:36px;height:36px;border-radius:50%;box-shadow:0 0 20px #f4be5844;transform-origin:center}
  .label{position:absolute;width:150px;height:36px;color:#edf4fa;font:500 20px/36px 'Direction Sans';text-align:center}
  .emitter,.receiver-label{position:absolute;top:334px;color:#a9c4da;font:500 22px/30px 'Direction Sans'}
  .emitter{left:128px}.receiver-label{left:714px}
</style>
