import { C } from './config.js';
import { clamp, approach, wrap } from './util.js';
import { buildModel } from './models.js';

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
    this.hp = this.s.hp;   // текущее здоровье; урон пока не наносится — это задел под бои
    this.mesh = m.group; this.eyeMat = m.eyeMat; this.spinners = m.spinners;
    this.mesh.rotation.order = 'YXZ';   // крен — вокруг собственной продольной оси
    scene.add(this.mesh);
    // Состояние: позиция на плоскости XZ, угол, скорость вдоль носа (v) и боком (lat)
    Object.assign(this, { x: 0, z: 0, a: 0, v: 0, lat: 0, drifting: false, seg: -1, bat: 100, dead: false, deadUntil: 0 });
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
  auto(track, dt, offFn = null) {
    // в пит-лейн смотрим ближе вперёд, чтобы не срезать угол на съезде
    const look = Math.round(offFn ? 4 + this.speed() * 0.2 : 6 + this.speed() * 0.45);
    const i = track.at(this.seg + look);
    const [px, , pz] = track.edge(i, offFn ? offFn(i) : 0);
    const diff = wrap(Math.atan2(pz - this.z, px - this.x) - this.a);
    this.a += clamp(diff, -C.autoTurn * dt, C.autoTurn * dt);
    this.w = 0;
    const want = C.autoSpeed * this.s.maxSpeed * (Math.abs(diff) > 0.5 ? 0.6 : 1);
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
    this.lat *= Math.exp(-(s.grip + (s.gripSlide - s.grip) * slide) * dt);
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
    if (d > hi) { this.x -= m.x * (d - hi); this.z -= m.z * (d - hi); hit = this.bounce(-m.x, -m.z, s.restitution); }
    else if (d < lo) { this.x += m.x * (lo - d); this.z += m.z * (lo - d); hit = this.bounce(m.x, m.z, s.restitution); }
    return hit;
  }

  render(dt, t) {
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = -this.a;
    // лёгкий крен в заносе
    this.mesh.rotation.x = clamp(-this.lat * 0.012, -0.15, 0.15);
    spinAll(this.spinners, this.v, dt);
    this.eyeMat.color.set(this.dead ? '#333' : this.bat < 20 ? (Math.floor(t / 300) % 2 ? '#ff3b30' : '#551010') : this.drifting ? '#ffcc00' : '#6ef0ff');
  }
}
