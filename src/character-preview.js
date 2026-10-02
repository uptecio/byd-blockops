import * as THREE from 'three';
import { createAvatarModel } from './avatar.js';
import { disposeModel } from './game.js';

export class CharacterPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#e1f7ff', '#32445b', 3));
    const light = new THREE.DirectionalLight('#fff7d1', 3.5); light.position.set(-2, 5, 3); this.scene.add(light);
    this.camera = new THREE.PerspectiveCamera(34, 1, .01, 20);
    this.camera.position.set(0, 1.18, 4.6); this.camera.lookAt(0, .95, 0);
    this.pivot = new THREE.Group(); this.scene.add(this.pivot);
  }
  equip(selection) {
    disposeModel(this.model);
    this.model = createAvatarModel(THREE, selection); this.pivot.add(this.model);
    this.canvas.setAttribute('aria-label', `${this.model.name} holding selected weapon${selection.teamId ? `, ${selection.teamId} team` : ''}`);
  }
  render(time) {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    if (w !== this.width || h !== this.height) {
      this.width = w; this.height = h; this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }
    this.pivot.rotation.y = -.38 + Math.sin(time * .32) * .55;
    this.renderer.render(this.scene, this.camera);
  }
  dispose() { disposeModel(this.model); this.renderer.dispose(); }
}
