<script>
  import { SceneCanvas, SceneThree, createStudioLighting, setCameraOrbit } from '@direction/scene-svelte';
  import { createChoreography, easing, resolveSceneObject } from '@direction/scene-runtime';

  let { parameters = {} } = $props();
  const collarSettings = $derived(resolveSceneObject(parameters, 'collar', { color: '#e8b556', delay: 2, duration: 2 }));

  function setup({ THREE, world, camera }) {
    const cues = createChoreography([
      { id: 'engage', start: collarSettings.delay, duration: collarSettings.duration },
      { id: 'drive', start: collarSettings.delay + collarSettings.duration, duration: 4 },
      { id: 'camera', start: 0, duration: 8 },
    ]);
    createStudioLighting(world);
    const input = new THREE.Group();
    const output = new THREE.Group();
    input.name = 'input-shaft';
    output.name = 'output-shaft';
    const metal = new THREE.MeshStandardMaterial({ color: '#9aa9ba', metalness: 0.7, roughness: 0.28 });
    const accent = new THREE.MeshStandardMaterial({ color: '#e8b556', metalness: 0.35, roughness: 0.3 });
    const shaft = group => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.2, 40), metal);
      mesh.rotation.z = Math.PI / 2;
      group.add(mesh);
      const indicator = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.12), accent);
      indicator.position.y = 0.32;
      group.add(indicator);
    };
    shaft(input);
    shaft(output);
    input.position.x = -1.2;
    output.position.x = 1.2;
    const collarMaterial = new THREE.MeshStandardMaterial({ color: collarSettings.color, metalness: 0.35, roughness: 0.3, opacity: collarSettings.opacity, transparent: collarSettings.opacity < 1 });
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.53, 0.53, 0.9, 48), collarMaterial);
    collar.name = 'coupling-collar';
    collar.rotation.z = Math.PI / 2 + collarSettings.rotation;
    collar.position.y = collarSettings.y;
    collar.position.z = collarSettings.z;
    collar.scale.set(collarSettings.scaleX, collarSettings.scaleY, 1);
    world.add(input, output, collar);
    return {
      update(frame) {
        const engaged = cues.at('engage', frame.time, easing.inOutCubic).progress;
        const drive = cues.at('drive', frame.time).progress * Math.PI * 4;
        collar.position.x = collarSettings.x - 1.15 * (1 - engaged);
        input.rotation.x = drive;
        output.rotation.x = drive;
        const view = cues.at('camera', frame.time, easing.smooth).progress;
        setCameraOrbit(camera, { radius: 7.5, azimuth: -0.22 + view * 0.35, elevation: 0.2 });
      },
    };
  }
</script>

<SceneCanvas background="#101b29">
  <div data-scene-object="coupling" style="position:absolute;inset:0">
    <SceneThree {setup} />
  </div>
  <h1 style="position:absolute;left:6%;top:5%;margin:0;font-family:'Direction Sans';font-size:42px;line-height:1.2;color:#f4eee3">Shaft coupling</h1>
  <p style="position:absolute;left:6%;bottom:7%;margin:0;font-family:'Direction Sans';font-size:24px;line-height:1.3;color:#c4d0df">Schematic · engage → transfer rotation → hold</p>
</SceneCanvas>
