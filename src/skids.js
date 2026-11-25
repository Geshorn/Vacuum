import * as THREE from 'three';
import { C } from './config.js';
import { clamp } from './util.js';

// Следы заноса: тёмные полосы от колёс, остаются на трассе.
// Хранятся в кольцевом буфере на C.skidMax отрезков — когда он заполнится, исчезают самые старые.
export class Skids {
  constructor(scene) {
    const max = this.max = C.skidMax;
    this.pos = new Float32Array(max * 4 * 3);
    this.col = new Float32Array(max * 4 * 4);
    const idx = new Uint32Array(max * 6);
    for (let i = 0; i < max; i++) { const v = i * 4, o = i * 6; idx.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], o); }
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 1;
    scene.add(mesh);
    this.next = 0; this.count = 0;
    this.last = [null, null];   // последняя точка каждого колеса (null — след прерван)
  }

  clear() {
    this.next = 0; this.count = 0; this.last = [null, null];
    this.geo.setDrawRange(0, 0);
  }

  // Вызывается каждый кадр
  update(bot) {
    const lat = Math.abs(bot.lat);
    const on = !bot.dead && lat > C.skidLat && bot.speed() > 3;
    const fx = Math.cos(bot.a), fz = Math.sin(bot.a), sx = -fz, sz = fx;
    const alpha = clamp((lat - C.skidLat) / 5 + 0.4, 0.4, 0.85);
    const R = bot.s.radius, s = R * 0.75, back = -R * 0.2;
    let dirty = false;
    [-1, 1].forEach((side, w) => {
      const x = bot.x + fx * back + sx * s * side, z = bot.z + fz * back + sz * s * side;
      const p = this.last[w];
      if (!on) { this.last[w] = null; return; }
      if (!p) { this.last[w] = { x, z }; return; }
      if (Math.hypot(x - p.x, z - p.z) < C.skidStep) return;
      this.add(p.x, p.z, x, z, alpha);
      this.last[w] = { x, z }; dirty = true;
    });
    if (dirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
      this.geo.setDrawRange(0, this.count * 6);
    }
  }

  add(x0, z0, x1, z1, a) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, h = C.skidWidth / 2;
    const nx = -dz / l * h, nz = dx / l * h, y = 0.035, i = this.next;
    this.pos.set([x0 - nx, y, z0 - nz, x0 + nx, y, z0 + nz, x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz], i * 12);
    for (let k = 0; k < 4; k++) this.col.set([0.01, 0.005, 0.01, a], i * 16 + k * 4);
    this.next = (i + 1) % this.max;
    this.count = Math.min(this.count + 1, this.max);
  }
}
