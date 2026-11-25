import * as THREE from 'three';
import { C } from './config.js';
import { clamp, approach, wrap } from './util.js';

// Модель робота-пылесоса. Нос смотрит вдоль локальной +X.
function buildMesh() {
  const g = new THREE.Group();
  const R = C.botR;
  const shell = new THREE.MeshStandardMaterial({ color: '#f1edf2', roughness: 0.35, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2230', roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 1.03, 0.55, 40), shell);
  body.position.y = 0.38; body.castShadow = true; g.add(body);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.82, 0.12, 40), dark);
  lid.position.y = 0.71; g.add(lid);
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.22, 24), shell);
  tower.position.set(-0.2, 0.86, 0); tower.castShadow = true; g.add(tower);
  // Бампер спереди
  const bumper = new THREE.Mesh(new THREE.TorusGeometry(R * 1.02, 0.12, 8, 30, Math.PI * 0.9), dark);
  bumper.rotation.set(Math.PI / 2, 0, -Math.PI * 0.45); bumper.position.y = 0.3; g.add(bumper);
  // Глаза-светодиоды (меняют цвет по состоянию)
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#6ef0ff' });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), eyeMat);
    e.position.set(R * 0.72, 0.76, s * 0.32); g.add(e);
  }
  // Боковые щётки
  const brushMat = new THREE.MeshStandardMaterial({ color: '#ff5b3a' });
  const brushes = [];
  for (const s of [-1, 1]) {
    const b = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const bristle = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.06), brushMat);
      bristle.position.x = 0.35; bristle.rotation.y = k * Math.PI * 2 / 3;
      const holder = new THREE.Group(); holder.rotation.y = k * Math.PI * 2 / 3; holder.add(bristle); b.add(holder);
    }
    b.position.set(R * 0.75, 0.1, s * R * 0.75); g.add(b); brushes.push({ obj: b, dir: s });
  }
  return { group: g, eyeMat, brushes };
}

export class Robot {
  constructor(scene) {
    const m = buildMesh();
    this.mesh = m.group; this.eyeMat = m.eyeMat; this.brushes = m.brushes;
    this.mesh.rotation.order = 'YXZ';   // крен — вокруг собственной продольной оси
    scene.add(this.mesh);
    // Состояние: позиция на плоскости XZ, угол, скорость вдоль носа (v) и боком (lat)
    Object.assign(this, { x: 0, z: 0, a: 0, v: 0, lat: 0, drifting: false, seg: -1, bat: 100, dead: false, deadUntil: 0 });
  }

  speed() { return Math.hypot(this.v, this.lat); }

  // Ручное управление: инерция и дрифт
  manual(keys, dt) {
    const sp = this.speed();
    this.drifting = !!(keys[' '] || keys.Shift) && sp > C.driftMinSpeed;
    const tr = C.turn * (this.drifting ? 1.6 : 1);
    if (keys.ArrowLeft) this.a -= tr * dt;
    if (keys.ArrowRight) this.a += tr * dt;
    if (keys.ArrowUp) this.v = approach(this.v, C.maxSpeed, C.accel * (this.drifting ? 0.7 : 1), dt);
    else if (keys.ArrowDown) this.v = approach(this.v, -C.backMax, C.brake, dt);
    else this.v = approach(this.v, 0, C.friction, dt);
  }

  // Автопилот: едет к точке впереди по центру трассы, на крутых поворотах сбрасывает скорость
  auto(track, dt) {
    const look = Math.round(6 + this.speed() * 0.45);
    const p = track.p[track.at(this.seg + look)];
    const diff = wrap(Math.atan2(p.z - this.z, p.x - this.x) - this.a);
    this.a += clamp(diff, -C.autoTurn * dt, C.autoTurn * dt);
    const want = C.autoSpeed * (Math.abs(diff) > 0.5 ? 0.6 : 1);
    this.v = approach(this.v, want, C.accel, dt);
    this.drifting = false;
  }

  // Отражение скорости от поверхности с нормалью (nx, nz); возвращает силу удара
  bounce(nx, nz, restit) {
    const fx = Math.cos(this.a), fz = Math.sin(this.a);
    let wx = fx * this.v - fz * this.lat, wz = fz * this.v + fx * this.lat;
    const vn = wx * nx + wz * nz;
    if (vn >= 0) return 0;
    wx -= (1 + restit) * vn * nx; wz -= (1 + restit) * vn * nz;
    this.v = wx * fx + wz * fz; this.lat = -wx * fz + wz * fx;
    return -vn;
  }

  // Физика шага: занос, движение, стены трассы. Возвращает силу удара о стену (0 — не было).
  integrate(track, a0, dt) {
    // поворот носа не поворачивает скорость: часть уходит в боковую — это и есть занос
    const da = this.a - a0;
    if (da) { const c = Math.cos(da), s = Math.sin(da), v2 = this.v * c + this.lat * s; this.lat = -this.v * s + this.lat * c; this.v = v2; }
    this.lat *= Math.exp(-(this.drifting ? C.gripDrift : C.grip) * dt);

    const fx = Math.cos(this.a), fz = Math.sin(this.a);
    this.x += (fx * this.v - fz * this.lat) * dt;
    this.z += (fz * this.v + fx * this.lat) * dt;

    // стены: держим робота в пределах ширины дороги
    this.seg = track.nearest(this.x, this.z, this.seg);
    const d = track.lateral(this.seg, this.x, this.z), lim = track.half - C.botR;
    let hit = 0;
    if (Math.abs(d) > lim) {
      const m = track.nrm[this.seg], s = Math.sign(d);
      this.x -= m.x * s * (Math.abs(d) - lim); this.z -= m.z * s * (Math.abs(d) - lim);
      hit = this.bounce(-m.x * s, -m.z * s, C.restitution);
    }
    return hit;
  }

  render(dt, t) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = -this.a;
    // лёгкий крен в заносе
    this.mesh.rotation.x = clamp(-this.lat * 0.012, -0.15, 0.15);
    const spin = (4 + this.speed() * 1.2) * dt;
    for (const b of this.brushes) b.obj.rotation.y += spin * b.dir;
    this.eyeMat.color.set(this.dead ? '#333' : this.bat < 20 ? (Math.floor(t / 300) % 2 ? '#ff3b30' : '#551010') : this.drifting ? '#ffcc00' : '#6ef0ff');
  }
}
