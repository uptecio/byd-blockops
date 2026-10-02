// Procedural flags and base markers shared by solo and network renderers.
export class ObjectiveView {
  constructor(THREE, scene, map) {
    this.group = new THREE.Group(); this.group.name = 'Objectives';
    this.flags = {}; this.bases = {}; this.geometries = new Set(); this.materials = new Set();
    const mesh = (geometry, material) => {
      this.geometries.add(geometry); this.materials.add(material);
      return new THREE.Mesh(geometry, material);
    };
    for (const teamId of ['red', 'blue']) {
      const material = new THREE.MeshBasicMaterial({ color: teamId === 'red' ? '#ff4141' : '#3185ff' });
      const base = mesh(new THREE.RingGeometry(.8, 1.2, 24), material);
      base.rotation.x = -Math.PI / 2; base.position.set(map.bases[teamId].x, .025, map.bases[teamId].z);
      const flag = new THREE.Group(); flag.name = `${teamId}-flag`;
      const pole = mesh(new THREE.CylinderGeometry(.035, .035, 2, 6), new THREE.MeshBasicMaterial({ color: '#ffffff' })); pole.position.y = 1;
      const cloth = mesh(new THREE.BoxGeometry(.65, .4, .03), material); cloth.position.set(.325, 1.7, 0);
      flag.add(pole, cloth); this.flags[teamId] = flag; this.bases[teamId] = base;
    }
    scene.add(this.group);
  }
  update({ flags, actors, viewerId }) {
    this.group.clear();
    if (!flags) return;
    for (const teamId of ['red', 'blue']) {
      const state = flags[teamId]; if (!state) continue;
      const carrier = state.status === 'carried' ? actors.find(actor => actor.id === state.carrierId) : null;
      const flag = this.flags[teamId];
      flag.position.set(carrier?.x ?? state.x, carrier?.y ?? 0, carrier?.z ?? state.z);
      // First-person carrier gets a lower pole beside the camera, not a HUD asset.
      flag.rotation.y = carrier?.id === viewerId ? Math.PI : 0;
      this.group.add(this.bases[teamId], flag);
    }
  }
  dispose() {
    this.group.removeFromParent(); this.group.clear();
    this.geometries.forEach(geometry => geometry.dispose()); this.materials.forEach(material => material.dispose());
    this.geometries.clear(); this.materials.clear();
  }
}
