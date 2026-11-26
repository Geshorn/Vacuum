import { C } from './config.js';
import { clamp, approach, wrap } from './util.js';
import { buildModel } from './models.js';
import * as THREE from 'three';

const DENT_GEO = new THREE.SphereGeometry(1, 12, 8);
const DENT_MAT = new THREE.MeshStandardMaterial({ color: '#3b3238', roughness: 0.9, metalness: 0.3 });
const SCORCH = new THREE.Color('#2a2026');
const SCRATCH_GEO = new THREE.BoxGeometry(1, 1, 1);
// без освещения — царапины одинаково контрастны с любой стороны робота
const SCRATCH_LIGHT = new THREE.MeshBasicMaterial({ color: '#ffffff' });
const SCRATCH_DARK = new THREE.MeshBasicMaterial({ color: '#0a0709' });

// Вращение колёс, лопастей и щёток: от скорости робота плюс постоянное «холостое» вращение
export function spinAll(spinners, v, dt) {
  for (const s of spinners) s.obj.rotation[s.axis] += ((s.idle || 0) * Math.sign(s.k) + v * s.k) * dt;
}

// Ходовые характеристики из паспорта робота: силы делятся на массу (описание формул — в config.js)
export function derive(spec) {
  const m = spec.mass, sq = Math.sqrt(m);
  return {
    mass: m, radius: spec.radius, hp: spec.hp, maxSpeed: spec.maxSpeed, backMax: spec.backMax, turn: spec.turn,
    accel: spec.power / m,
    brake: spec.brakeForce / m,
    friction: spec.rollDrag / m,
    steerAccel: spec.steerTorque / m,
    grip: spec.grip,
    gripSlide: spec.slideGrip / sq,
    restitution: spec.bounce / sq,
    // во сколько раз робот тратит заряд быстрее эталона: растёт с массой, но мягко (Сейф ×1.55, Пульт ×0.73)
    drainMul: spec.drainMul ?? Math.pow(m, C.drainMassPow),
  };
}

export class Robot {
  constructor(scene, spec) {
    this.spec = spec;
    this.s = derive(spec);
    const m = buildModel(spec);   // модель — см. models.js
    this.hp = this.s.hp;   // текущее здоровье: падает от ударов о стены (main.js), чинится на пит-стопе
    this.mesh = m.group; this.eyeMat = m.eyeMat; this.spinners = m.spinners;
    this.shellMat = m.shellMat; this.shellColor = m.shellMat.color.clone();
    this.dents = []; this.scratches = [];
    this.mesh.rotation.order = 'YXZ';   // крен — вокруг собственной продольной оси
    scene.add(this.mesh);
    // Состояние: позиция на плоскости XZ, угол, скорость вдоль носа (v) и боком (lat)
    Object.assign(this, { x: 0, z: 0, a: 0, v: 0, lat: 0, drifting: false, seg: -1, bat: 100, dead: false, deadUntil: 0 });
    this.bin = 0; this.binMass = 0; this.binValue = 0;   // binValue — сколько жетонов дадут за содержимое   // заполнение контейнера, % (и при каком значении пересчитана физика)
  }

  // Мусор в контейнере утяжеляет робота: пересчитываем ходовые характеристики от новой массы
  // (размер и ХП не меняются). Пересчёт — когда заполнение изменилось хотя бы на 1%.
  updateLoad() {
    if (Math.abs(this.bin - this.binMass) < 1 && !(this.bin === 0 && this.binMass)) return;
    this.binMass = this.bin;
    const k = 1 + this.bin / 100 * C.bin.massAdd, sp = this.spec;
    // масса растёт, а сила двигателя, тормозов и руля — нет; расход заряда считаем от новой массы
    this.s = derive({ ...sp, mass: sp.mass * k, drainMul: (sp.drainMul ?? Math.pow(sp.mass, C.drainMassPow)) * Math.pow(k, C.drainMassPow) });
    this.s.radius = sp.radius; this.s.hp = sp.hp;
  }

  speed() { return Math.hypot(this.v, this.lat); }

  // Ручное управление: инерция; на скорости в крутом повороте робота немного сносит (см. integrate)
  manual(keys, dt) {
    // руль тоже с инерцией: скорость поворота набирается и спадает плавно
    const s = this.s;
    const want = ((keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0)) * s.turn;
    this.w = approach(this.w || 0, want, s.steerAccel, dt);
    this.a += this.w * dt;
    if (keys.ArrowUp) this.v = approach(this.v, s.maxSpeed, s.accel, dt);
    else if (keys.ArrowDown) this.v = approach(this.v, -s.backMax, s.brake, dt);
    else this.v = approach(this.v, 0, s.friction, dt);
  }

  // Автопилот: едет к точке впереди по центру трассы, на крутых поворотах сбрасывает скорость
  // offFn(i) — смещение линии, по которой ехать (например, в пит-лейн); без него — по центру
  // speedMul — доля от обычной скорости автопилота (у соперников своя)
  auto(track, dt, offFn = null, speedMul = 1) {
    // в пит-лейн смотрим ближе вперёд, чтобы не срезать угол на съезде
    const look = Math.round(offFn ? 4 + this.speed() * 0.2 : 6 + this.speed() * 0.45);
    const i = track.at(this.seg + look);
    const [px, , pz] = track.edge(i, offFn ? offFn(i) : 0);
    const diff = wrap(Math.atan2(pz - this.z, px - this.x) - this.a);
    this.a += clamp(diff, -C.autoTurn * dt, C.autoTurn * dt);
    this.w = 0;
    const want = C.autoSpeed * speedMul * this.s.maxSpeed * (Math.abs(diff) > 0.5 ? 0.6 : 1);
    this.v = approach(this.v, want, this.s.accel, dt);
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
    // Сцепление падает, когда резко поворачиваем на скорости — получается лёгкий снос
    const s = this.s;
    const turnRate = Math.abs(da) / (dt || 1), fast = clamp((this.v - C.slideMinSpeed) / (s.maxSpeed - C.slideMinSpeed), 0, 1);
    const slide = clamp(turnRate / s.turn, 0, 1) * fast;
    // gripMul < 1 — робот на скользком (лужа моющего средства, см. weapons.js)
    this.lat *= Math.exp(-(s.grip + (s.gripSlide - s.grip) * slide) * (this.gripMul ?? 1) * dt);
    this.drifting = Math.abs(this.lat) > C.slideShowLat;   // для эффектов и реплик

    const fx = Math.cos(this.a), fz = Math.sin(this.a);
    this.x += (fx * this.v - fz * this.lat) * dt;
    this.z += (fz * this.v + fx * this.lat) * dt;

    // стены: держим робота в пределах дороги или пит-лейна (границы даёт трасса)
    this.seg = track.nearest(this.x, this.z, this.seg);
    const d = track.lateral(this.seg, this.x, this.z);
    const [lo, hi, lane] = track.bounds(this.seg, d, s.radius);
    this.inLane = lane; this.latPos = d;
    const m = track.nrm[this.seg];
    let hit = 0;
    if (d > hi) { this.x -= m.x * (d - hi); this.z -= m.z * (d - hi); hit = this.bounce(-m.x, -m.z, s.restitution); this.hitN = [-m.x, -m.z]; }
    else if (d < lo) { this.x += m.x * (lo - d); this.z += m.z * (lo - d); hit = this.bounce(m.x, m.z, s.restitution); this.hitN = [m.x, m.z]; }
    return hit;
  }

  // Вмятина на корпусе с той стороны, которой робот ударился (hitN — нормаль стены, от неё к роботу)
  dent(dmg) {
    if (!this.hitN || this.dents.length >= 14) return;
    const [nx, nz] = this.hitN, dx = -nx, dz = -nz, a = this.a;
    const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);   // в координатах модели
    const ang = Math.atan2(lz, lx) + (Math.random() - 0.5) * 0.6, R = this.s.radius;
    const size = clamp(0.25 + dmg * 0.02, 0.25, 0.6);
    const m = new THREE.Mesh(DENT_GEO, DENT_MAT);
    m.scale.set(0.12, size * 0.7, size);
    m.position.set(Math.cos(ang) * R * 1.0, 0.28 + Math.random() * 0.2, Math.sin(ang) * R * 1.0);
    m.rotation.y = -ang;
    this.mesh.add(m); this.dents.push(m);
  }

  // Царапина на корпусе: светлая полоска (видно металл под краской) с той стороны, которой робот трётся о стену.
  // Тянется вдоль борта, с небольшим наклоном; часть царапин заходит на верх корпуса.
  scratch() {
    if (!this.hitN || this.scratches.length >= 40) return;
    const [nx, nz] = this.hitN, dx = -nx, dz = -nz, a = this.a;
    const lx = dx * Math.cos(a) + dz * Math.sin(a), lz = -dx * Math.sin(a) + dz * Math.cos(a);
    const ang = Math.atan2(lz, lx) + (Math.random() - 0.5) * 0.9, R = this.s.radius;
    const len = 0.5 + Math.random() * 0.6;
    // цвет — контрастный корпусу: на светлом роботе в основном тёмные царапины, на тёмном — светлые
    const light = this.shellColor.getHSL({}).l < 0.5;
    const m = new THREE.Mesh(SCRATCH_GEO, Math.random() < 0.9 ? (light ? SCRATCH_LIGHT : SCRATCH_DARK) : (light ? SCRATCH_DARK : SCRATCH_LIGHT));
    if (Math.random() < 0.25) {      // на крышке
      const r = R * (0.82 + Math.random() * 0.15);
      m.position.set(Math.cos(ang) * r, 0.66, Math.sin(ang) * r);
      m.rotation.set(0, -ang - Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0);
      m.scale.set(len, 0.03, 0.11);
    } else {                         // на борту
      m.position.set(Math.cos(ang) * R * 1.005, 0.2 + Math.random() * 0.36, Math.sin(ang) * R * 1.005);
      m.rotation.set(0, -ang - Math.PI / 2, (Math.random() - 0.5) * 0.5);
      m.scale.set(len, 0.08, 0.05);
    }
    this.mesh.add(m); this.scratches.push(m);
  }

  // Состояние корпуса по ХП: темнеет от повреждений
  updateWear() {
    const wear = 1 - this.hp / this.s.hp;
    this.shellMat.color.copy(this.shellColor).lerp(SCORCH, clamp(wear * 0.6, 0, 0.6));
  }

  // Убрать одну случайную вмятину или царапину (ремонт на пит-стопе); false — убирать нечего
  removeMark() {
    const total = this.dents.length + this.scratches.length;
    if (!total) return false;
    const list = Math.random() * total < this.dents.length ? this.dents : this.scratches;
    const [m] = list.splice(Math.floor(Math.random() * list.length), 1);
    this.mesh.remove(m);
    return true;
  }

  render(dt, t) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = -this.a;
    // лёгкий крен в заносе
    this.mesh.rotation.x = clamp(-this.lat * 0.012, -0.15, 0.15);
    spinAll(this.spinners, this.v, dt);
    this.updateWear();
    this.eyeMat.color.set(this.dead ? '#333' : this.bat < 20 ? (Math.floor(t / 300) % 2 ? '#ff3b30' : '#551010') : this.drifting ? '#ffcc00' : '#6ef0ff');
  }
}
