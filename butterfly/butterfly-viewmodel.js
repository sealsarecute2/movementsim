import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ButterflyController } from './butterfly-controller.js';
import { createButterflyAudio } from './butterfly-audio.js';

export async function createButterflyViewmodel({
  worldCanvas,
  assetUrl = new URL('./assets/butterfly.glb', import.meta.url).href,
  isActive = () => document.pointerLockElement === worldCanvas,
  rareChance = 0.15,
  sound = true,
} = {}) {
  if (!worldCanvas) throw new TypeError('worldCanvas is required');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'fixed', pointerEvents: 'none', display: 'none' });
  worldCanvas.insertAdjacentElement('afterend', canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(67.380135, 1, 0.001, 10);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xe6ecff, 0x24252b, 1.5));
  const key = new THREE.DirectionalLight(0xfff5e8, 2.2);key.position.set(-1, 2, 1);scene.add(key);
  const fill = new THREE.DirectionalLight(0xcbdcff, 1);fill.position.set(1, 0, -1);scene.add(fill);
  let gltf;
  try { gltf = await new GLTFLoader().loadAsync(assetUrl); }
  catch (error) { environment.dispose();renderer.dispose();canvas.remove();throw error; }
  const root = gltf.scene;
  // Tuck the arms slightly down and back toward the player to clear the view.
  root.position.set(0, -0.015, 0.025);
  root.traverse(node => { if (node.isMesh) node.frustumCulled = false; });
  scene.add(root);
  const controller = new ButterflyController(root, gltf.animations, { rareChance });
  let audio;
  try { if (sound) { audio = await createButterflyAudio(controller);audio.bindActivation(); } }
  catch (error) { dispose();throw error; }
  controller.bindControls({ canvas: worldCanvas, isActive });
  controller.equip();
  let width = 0, height = 0, ratio = 0;
  function draw(deltaSeconds) {
    const active = !!isActive();canvas.style.display = active ? 'block' : 'none';controller.enabled = active;
    if (!active) { audio?.update();return; }
    const rect = worldCanvas.getBoundingClientRect();
    const nextRatio = Math.min(devicePixelRatio || 1, 2);
    if (rect.width !== width || rect.height !== height || nextRatio !== ratio) {
      width = rect.width;height = rect.height;ratio = nextRatio;
      renderer.setPixelRatio(ratio);renderer.setSize(width, height, false);
      canvas.style.width = `${width}px`;canvas.style.height = `${height}px`;
      camera.aspect = width / Math.max(height, 1);camera.updateProjectionMatrix();
    }
    canvas.style.left = `${rect.left}px`;canvas.style.top = `${rect.top}px`;
    controller.update(deltaSeconds);audio?.update();renderer.render(scene, camera);
  }
  function dispose() {
    controller.dispose();
    audio?.dispose();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(node => {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const value of [...textures, ...materials, ...geometries]) value.dispose();
    environment.dispose();renderer.dispose();canvas.remove();
  }
  return { controller, audio, root, canvas, draw, dispose, equip: options => controller.equip(options) };
}
