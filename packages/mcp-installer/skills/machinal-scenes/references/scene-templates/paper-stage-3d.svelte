<script>
  import { SceneCanvas, SceneThree, useScene } from '@direction/scene-svelte';
  import { clamp } from '@direction/scene-runtime';

  const scene = useScene();
  const design = {
    paper: '#f0e4cb',
    facades: ['#d98764', '#4f918b', '#d6ac57'],
    spread: 0.9,
    label: 'O lume se deschide',
  };
  const safeHeight = $derived(Math.round(scene.frame.config.height * (1 - (scene.frame.config.captionSafeBottom ?? 0))));
  const labelSize = $derived(Math.min(scene.frame.config.width, safeHeight) * 0.045);

  function smooth(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  }

  function setup({ THREE, world, camera }) {
    const paper = new THREE.MeshStandardMaterial({ color: design.paper, roughness: 0.95, side: THREE.DoubleSide });
    const ink = new THREE.MeshStandardMaterial({ color: '#284d50', roughness: 0.9 });
    const leaves = [-1, 1].map(side => {
      const hinge = new THREE.Group();
      const page = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.1, 4.4), paper);
      page.position.x = side * 1.6;
      hinge.add(page);
      world.add(hinge);
      return { hinge, side };
    });
    const panels = [-1.7, 0, 1.7].map((x, index) => {
      const hinge = new THREE.Group();
      hinge.position.set(x, 0.08, index === 1 ? -0.7 : 0.6);
      const height = index === 1 ? 2 : 1.45;
      const outline = new THREE.Shape();
      outline.moveTo(-0.6, 0);
      outline.lineTo(0.6, 0);
      outline.lineTo(0.6, height - 0.45);
      outline.lineTo(0, height);
      outline.lineTo(-0.6, height - 0.45);
      outline.closePath();
      const material = new THREE.MeshStandardMaterial({ color: design.facades[index], roughness: 0.9, side: THREE.DoubleSide });
      const facade = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.045, bevelEnabled: false }), material);
      hinge.add(facade);
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.6, 0.025), ink);
      door.position.set(0, 0.3, 0.065);
      hinge.add(door);
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.025), paper);
      window.position.set(0, height - 0.58, 0.065);
      hinge.add(window);
      leaves[index === 0 ? 0 : 1].hinge.add(hinge);
      return { hinge, index };
    });
    world.add(new THREE.HemisphereLight(0xfff5dc, 0x315462, 2.8));
    const key = new THREE.DirectionalLight(0xffe2bb, 4);
    key.position.set(-3, 6, 5);
    world.add(key);
    const rim = new THREE.DirectionalLight(0xb5dedc, 2.2);
    rim.position.set(4, 3, -3);
    world.add(rim);

    return {
      update(frame) {
        const p = frame.progress;
        for (const { hinge, side } of leaves) hinge.rotation.z = side * design.spread * (1 - smooth(p / 0.24));
        for (const { hinge, index } of panels) hinge.rotation.x = -Math.PI / 2 * (1 - smooth((p - 0.25 - index * 0.08) / 0.24));
        const arc = smooth((p - 0.18) / 0.56);
        const distance = camera.aspect < 1 ? 13.8 : 10.4;
        camera.position.set(distance * (0.32 - arc * 0.16), distance * 0.5, distance * 0.84);
        camera.lookAt(0, 0.65, 0);
      },
    };
  }
</script>

<SceneCanvas background="#18363c">
  <SceneThree {setup} width={scene.frame.config.width} height={safeHeight} label="Paper pages unfold; three illustrated house panels rise independently" />
  <div class="label" style:top="{safeHeight * 0.07}px" style:left="{scene.frame.config.width * 0.08}px" style:font-size="{labelSize}px">{design.label}</div>
</SceneCanvas>

<style>
  .label { position: absolute; color: #f0e4cb; font-family: 'Direction Sans'; line-height: 1.2; max-width: 84%; }
</style>
