# Scene runtime contract

This is the implemented scene-engine API. Read it before planning a scene. Compilation alone does not prove visual quality: inspect representative frames, text bounds, media visibility and backward seeking.

## Select a medium, not just an effect

- Use real Three.js for geometric/spatial explanations, perspective, lighting, camera orbits and independently moving meshes. `visualMode: 3d` on `scene.generate` requests this explicitly. CSS perspective, a rotating card or an SVG sphere is not genuine Three.js.
- Use simple HTML/SVG for labels, arrows, charts and geometric diagrams. One coordinate system; each subject owns its decorations. Check first frame, reveal, hold and exit bounds. An entrance curve must hold at opacity 1, not fade out immediately.
- Use actual supplied/generated raster images for complex characters, animals, realistic objects, textures or artwork when procedural CSS/SVG would be fragile or unconvincing. Do not approximate detailed subjects with piles of CSS shapes to avoid images. Plan an approved `image.generate` before the scene and attach its result. Animate the image wrapper, labels and other objects independently; keep captions as real text.
- Without a needed image, obtain/generate it before scene generation. Components cannot call image generation. Never invent filenames, URLs or fake media. A fallback choice does not authorize spending.

## Storyboard and visibility, not placeholder CSS

The YAML `scene.generate.prompt` is an art-directed storyboard, not 'make it cinematic' or 'animate this title'. State the subject/action and narrative purpose, medium (HTML/SVG/image-backed/real Three.js), foreground/midground/background, composition and safe areas, palette/materials/light, exact copy, supplied image roles and scene-local reveal/action/hold/exit times. For 3D name meaningful geometry, mesh motion, lighting, camera framing/path and a readable final composition. Set `visualMode: 3d` when Three.js is requested; in auto mode choose it when depth or spatial motion genuinely helps. CSS perspective is not a 3D substitute. Do not force 3D on a flat chart or violate a deliberate minimal style.

Keep the main subject visible at the actual output size and through the middle hold. Define root/layer dimensions and stacking order. Derive entrance and exit separately, clamp both, and hold opacity at 1 between them; do not fade everything out after its entrance or leave it behind the background. Test representative frames and backwards seeking. A compiler repair must preserve requested subject, copy, assets, motion and visual richness; deleting imagery to make a scene compile is not a repair. A runtime starter/demo primitive is not a finished scene.

Never put AI-production labels, disclaimers, watermarks or technical metadata on screen: no 'AI illustration', 'AI-generated', 'Ilustrație AI', 'Generat cu AI' or 'Narațiune sintetică'. Explanations/provenance belong outside the component. This does not prohibit subject copy that genuinely discusses artificial intelligence. Do not bake production notices into images, CSS pseudo-elements, SVG, canvas or textures. Browser inspection rejects recognized visible production labels and scenes with no detectable foreground at sampled frames; it is not OCR, aesthetic judgment or proof of semantic correctness.

## Deterministic Svelte 5

Use JavaScript in `<script>`, `const scene = useScene()` and `$derived` from `scene.frame.time`, `scene.frame.progress`, `scene.frame.frame` and `scene.frame.config`. `scene.frame.random('key')` is seeded. Never accumulate transforms or use timers, Date, Math.random, requestAnimationFrame, external requests or interactive events. Seeks arrive in arbitrary order.

Allowed imports: `svelte`, `three`, `@direction/scene-svelte`, `@direction/scene-runtime`. No Drei, React Three Fiber, Threlte, GSAP or remote loaders. Runtime helpers: `interpolate(value,[inStart,inEnd],[outStart,outEnd])`, `clamp(value,min,max)`, `easeOutCubic(progress)`.

### Choreography, anchors and camera rigs

`@direction/scene-runtime` also exports `createChoreography([{id,start,duration}])`, `progressAt(time,start,duration,easing?)`, `stagger(index,interval,start?)`, `easing.linear/inOutCubic/outQuint/smooth` and `springAt(elapsedSeconds,{stiffness?,damping?,mass?})`. All times are scene-local seconds, derived from measured cues. `timeline.at(id, scene.frame.time, easing.smooth)` returns `{start,end,progress,active}`; `timeline.marker(id,'start'|'end')` returns a boundary. Zero-duration cues switch instantly. Springs are analytic unit-step responses, may overshoot and never integrate previous frames. Clamp only when appropriate for the property (e.g. opacity), not to hide timing errors.

For subject-local layout use `anchorPoint({x,y,width,height}, 'center'|'top'|'right'|'bottom'|'left')`, `transformPoint(point,{x,y,rotation,scaleX,scaleY})` (radians, local origin), `bezierPoint([p0,p1,p2,p3],progress)` and `connectorPath(from,to,bend?)`. These are pure geometry helpers, not DOM measurement or an automatic constraint solver. Keep connectors and labels in the subject group or compute their endpoints from the SAME pose. `interpolatePose(from,to,progress)` interpolates explicit poses; carry a shared object ID and matching poses between adjacent scenes, rather than assuming hidden state transfers between scene instances.

`@direction/scene-svelte` exports `setCameraOrbit(camera,{target?:[x,y,z],radius,azimuth,elevation})` and `createStudioLighting(world,{intensity?,keyColor?,rimColor?})`. Angles are radians; the orbit assigns an absolute pose per frame and lighting adds a reusable hemisphere/key/fill/rim rig once in setup. SceneThree still owns rendering and resource lifetime. These are starting points, not subject geometry or permission to load external models.

```js
const timing = createChoreography([{id:'engage',start:2.35,duration:1.2}]);
// Inside a derived expression or update(frame), never a timer:
const progress = timing.at('engage', frame.time, easing.inOutCubic).progress;
```

For approved MCP inspection, `data-scene-object="receiver"` annotates a DOM/SVG group with a stable identity. `inspect_scene` returns bounded thumbnails and annotated bounds at explicit frame indices, tied to the source version; no timeline captions or final compositing are included. Bounds are diagnostic geometry, not proof of actual pixel visibility or internal Three.js mesh motion. Read topic `production` for exact consent, limits and evidence boundaries.

### Explicit editable object parameters

`resolveSceneObject(parameters,id,defaults?)` returns bounded x/y/z, rotation (radians), scaleX/scaleY, opacity, delay/duration (seconds) and color values. Declare `let {parameters = {}} = $props()` and derive object geometry from those values, preserving frame-driven motion. Expose the same IDs in `compile_scene.parameters`; only these stored IDs can be patched by `edit_scene_parameters`. `validateSceneParameters` validates a parameter map; unknown fields/nulls/URLs and nonfinite/out-of-range values are rejected. Read topic `scene-authoring` for all bounds, defaults and a complete example.

Parameter-only edits preserve Svelte/config/media/audio and create a new asset after source-version/layout checks. They are not AST rewriting, a universal object editor, physics or automatic visual continuity. A component can still ignore a declared value; verify the relevant source and actual output. Parameters are passed consistently through preview, inspection, local export and native rendering and participate in the native video cache key. Keep captions separate and unchanged.

### Registered semantic state and anchored labels

`scene.objects.register(id, read)` registers a deterministic `read(frame) => ({x,y,z,rotation,scaleX,scaleY,opacity,color})` callback and returns its unregister function. Register once during component initialization and unregister with `onDestroy`; do not register from `update(frame)`. At most 32 unique IDs, with the same field/value bounds as exposed parameters. Inspection samples these declarations into each frame's `states`; DOM annotations remain separate bounds evidence. The controller exposes `snapshotObjects()` after a successful seek and clears readers on disposal. A declaration is author-supplied, not pixel reconstruction or a proof that the visible subject follows it.

`handoff_scene` samples one registered outgoing state at an exact source frame and patches mapped incoming parameter IDs. Both source versions and source-use/edit consent are required. The canvas dimensions and exact visualMode strings must match; authors must also keep units, coordinate origins, rotation meanings and camera framing compatible. Timing controls (`delay`/`duration`) are NOT transferred. It saves a new immutable source with provenance, never changes captions or timeline references. Read `scene-authoring` for arguments and limitations.

`placeAnchoredLabel(subjectBounds,{width,height},stageBounds,{sides?,gap?,obstacles?})` chooses the first fitting side or a deterministic least-penalized fallback. Defaults: right/left/top/bottom, gap 16; at most five candidates and 64 rectangular obstacles. It returns `{bounds,side,anchor,fits,collisions}`. Bounds use one canvas coordinate system, without automatic DOM/font measurement. Supply measured/known label dimensions, exclude the caption band from `stageBounds`, and include other labels as obstacles. `fits:false` is a diagnostic to handle, not permission to move/reflow captions. The result is a bounded rectangular search, not physics, routed connectors, global optimization or a universal constraint solver.

## Fonts

Embedded scene CSS families: `Direction Sans` (Roboto), `Direction Serif` (Merriweather), `Direction Mono` (Roboto Mono), `Montserrat`, `Open Sans`, `Oswald`, `Playfair Display`, `IBM Plex Sans`, `Lato`. Variable weights (Lato: 400/700) and Latin/Latin Extended glyphs are embedded identically in preview and export; italic files are included where supplied (Oswald supplies normal only). Write these family names literally in the component so only required faces are embedded; do not assemble font names dynamically. Set explicit font-size and line-height. Recipe `fontFamily: montserrat` is a separate catalog namespace, not a CSS family. No Google Fonts URLs, @import or OS-dependent fonts. Preserve Romanian diacritics; check wrapping after fonts settle.

New generated scenes are measured in a browser at representative frames. Keep independent text blocks separated, inside the canvas and readable at the actual FHD dimensions. Use shared bounds and flex/grid for related elements. A captionSafeBottom configuration reserves that fraction of the bottom for separate timeline captions: put scene labels above it. Intentional decorative text overlap can opt out of collision checks with data-layout-overlap="allow", but this does not permit off-canvas text or occupying the caption band. Do not place essential labels at 8px or use hundreds of pixels of type in a small card. The inspector validates DOM/SVG text geometry; it cannot infer the meaning of text painted into an arbitrary canvas or embedded image.

## Images

Read the host's embedded image props. Preserve aspect ratio and alpha. In SVG use `<image href={images.image_1} width="..." height="..." preserveAspectRatio="xMidYMid meet" />`. Never place HTML img/div/span directly inside SVG; use SVG elements or explicit foreignObject. Do not put project filenames into src, fetch URLs or create your own data URLs.

```svelte
<script>
  import {useScene, SceneCanvas} from '@direction/scene-svelte';
  let {images = {}} = $props();
  const scene = useScene();
  const x = $derived(80 + Math.min(1, scene.frame.time / 0.8) * 40);
</script>
<SceneCanvas background="#101D2F">
  <div style="position:absolute;left:{x}px;top:180px;width:240px;height:240px">
    <img src={images.image_1} alt="Supplied subject" style="width:100%;height:100%;object-fit:contain" />
  </div>
</SceneCanvas>
```

Adapt this to the actual output dimensions. For 1080×1920 portrait, reserve the caption zone; default to about four words per caption and no more than two fitted lines.

## Genuine Three.js

`SceneThree` owns the only renderer and render loop. `setup({THREE,renderer,world,camera,resources})` may be synchronous or async and must return `{update(frame), dispose?()}`. Tracked setup/assets finish before first-frame inspection/capture; failures are not silently replaced. Use `world`, not an invented context.scene. `update` receives the frame directly, not `{frame}`. Always return an update function. Add visible geometry and lighting for lit materials; configure a camera that sees the object. Use DOM/SVG text overlays, not unsupported external font/model loaders. Supplied images can remain in independent DOM layers next to 3D.

```svelte
<script>
  import {SceneCanvas, SceneThree} from '@direction/scene-svelte';
  function setup({THREE, world, camera}) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({color: '#EBC36B', roughness: 0.45})
    );
    world.add(mesh);
    world.add(new THREE.AmbientLight(0xffffff, 1.2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 4, 5);
    world.add(light);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    return {update(frame) {
      mesh.rotation.y = frame.time * 0.5;
      mesh.rotation.x = frame.time * 0.2;
    }};
  }
</script>
<SceneCanvas background="#101D2F"><SceneThree {setup} /></SceneCanvas>
```

Adapt the starter to the actual story; it is an API pattern, not a universal design. SceneThree disposes world geometry/materials/textures; clean up custom external resources. Do not create another WebGLRenderer, call renderer.render or setAnimationLoop. Keep essential bounds inside 5% margins.

### Approved GLB models and PNG textures

`compile_scene.models` accepts at most two `{id:"model_1"|"model_2",file:"actual-uploaded.glb",name:"Subject"}` attachments. Upload approved files through the normal authenticated project-volume endpoint; GLB is API-only, not a new generic video/image asset kind. Never send local paths, arbitrary URLs or base64 to tools/YAML. The backend embeds validated bytes in the immutable source; `get_scene_source` returns only `modelIds`. `sourceFile` edits and parameter/handoff edits preserve these bytes. Browser preview, inspection, native rendering and cache identity receive the same models prop.

Use `loadSceneModel(models.model_1, resources)` from `@direction/scene-svelte` inside async setup. It returns a Three.js Group, not an animation mixer. Add it to `world`, frame it deliberately, and assign absolute transforms in update. `loadSceneTexture(images.image_1, resources)` accepts an approved embedded PNG (5 MiB / 4 million pixels), returns an sRGB Texture for a COLOR map, and waits for decoding. Other image types remain usable in DOM layers but are not supported by this texture helper. Dispose unattached/custom textures yourself; world materials/textures are cleaned on disposal, including late async completion and shared ImageBitmaps.

```svelte
<script>
  import { SceneCanvas, SceneThree, loadSceneModel, createStudioLighting } from '@direction/scene-svelte';
  let { models = {} } = $props();
  async function setup({ world, camera, resources }) {
    const subject = await loadSceneModel(models.model_1, resources);
    world.add(subject);
    createStudioLighting(world);
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
    return { update(frame) { subject.rotation.y = frame.time * 0.3; } };
  }
</script>
<SceneCanvas background="#101D2F"><SceneThree {setup} /></SceneCanvas>
```

This is an attachment API pattern, not a subject-specific finished storyboard. **Supported subset:** self-contained GLB v2, one scene, static uncompressed triangle meshes, embedded PNG textures only. Each file ≤4 MiB; metadata ≤256 KiB; ≤128 nodes, 64 meshes, 128 distinct primitives, 256 buffer views/accessors, 100000 elements per accessor and 1 million total accessor components. Expanded node instances are limited to 256 primitives / 500000 submitted vertices or indices. Up to eight textures/images; ≤4 million pixels per image / 8 million total. Packed unsigned indices are range-checked; vertex format/count, bounds, finite floats, material factors, samplers, UV sets and node hierarchy are checked before the loader.

External URIs (including data/file/http references), compression/extensions/decoders, imported animations, skins, morph targets, sparse accessors, cameras on nodes, animated PNG and non-triangle modes are refused. No network assets, decoder downloads, automatic model generation or format substitution. CSP permits blob connections only for embedded texture decoding; HTTP remains blocked. Go upload validation checks the bounded container/UTF-8/forbidden resource tree; complete geometry/material validation runs in scene-engine before loading. Passing upload checks alone does not guarantee a model will compile. Author scene motion from frame time; imported animation playback is not supported.
