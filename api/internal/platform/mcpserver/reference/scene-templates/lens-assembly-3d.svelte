<script>
  import { SceneCanvas, SceneThree, useScene } from '@direction/scene-svelte';
  import { clamp, easeOutCubic } from '@direction/scene-runtime';

  const scene = useScene();
  const design = { spread: 1.15, metal: '#729c91', glass: '#a7d9e1', label: 'Elemente în echilibru' };
  const safeHeight = $derived(Math.round(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0))));
  const labelSize = $derived(Math.min(scene.frame.config.width, safeHeight) * 0.045);

  function setup({ THREE, world, camera }) {
    const barrel = new THREE.MeshStandardMaterial({ color: design.metal, metalness: 0.65, roughness: 0.3 });
    const glass = new THREE.MeshStandardMaterial({ color: design.glass, metalness: 0.25, roughness: 0.16 });
    const parts = [-2, -1, 0, 1, 2].map((offset, index) => {
      const isGlass = index % 2 === 1;
      const geometry = isGlass
        ? new THREE.CylinderGeometry(0.93, 0.93, 0.12, 64)
        : new THREE.TorusGeometry(1.05, 0.13, 16, 64);
      const mesh = new THREE.Mesh(geometry, isGlass ? glass : barrel);
      if (isGlass) mesh.rotation.x = Math.PI / 2;
      world.add(mesh);
      return { mesh, offset, index };
    });

    world.add(new THREE.HemisphereLight(0xe2faf1, 0x172b35, 2.4));
    const key = new THREE.DirectionalLight(0xffe2b5, 4);
    key.position.set(4, 5, 7);
    world.add(key);
    const rim = new THREE.DirectionalLight(0x83c7e6, 3);
    rim.position.set(-4, 1, -3);
    world.add(rim);

    return {
      update(frame) {
        const progress = frame.progress;
        const arc = easeOutCubic(clamp((progress - 0.08) / 0.62, 0, 1));
        for (const { mesh, offset, index } of parts) {
          const assemble = easeOutCubic(clamp((progress - 0.18 - index * 0.025) / 0.42, 0, 1));
          mesh.position.set(0, 0, offset * (0.27 + design.spread * (1 - assemble)));
          mesh.rotation.z = (1 - assemble) * offset * 0.12;
        }
        const distance = camera.aspect < 1 ? 11.5 : 8.5;
        const angle = 0.78 - arc * 0.28;
        camera.position.set(distance * Math.sin(angle), 2.8 - arc * 0.7, distance * Math.cos(angle));
        camera.lookAt(0, 0, 0);
      },
    };
  }
</script>

<SceneCanvas background="#101d26">
  <SceneThree {setup} width={scene.frame.config.width} height={safeHeight} label="Schematic optical assembly" />
  <div class="label" style:top="{safeHeight * 0.08}px" style:left="{scene.frame.config.width * 0.08}px" style:font-size="{labelSize}px">{design.label}</div>
</SceneCanvas>

<style>
  .label { position: absolute; color: #e9eee4; font-family: 'Direction Sans'; line-height: 1.2; max-width: 84%; }
</style>
