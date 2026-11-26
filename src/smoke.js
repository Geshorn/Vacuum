import * as THREE from 'three';
import { C } from './config.js';

// Дым от повреждённого робота. Клубы вылетают из корпуса и остаются в мире (тянутся шлейфом за роботом).
// Ниже C.wear.whiteSmoke % ХП — редкий белый дымок, ниже C.wear.blackSmoke % — густой чёрный дым с искрами.
const PUFF = new THREE.SphereGeometry(1, 10, 8);
const SPARK = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const WHITE = new THREE.Color('#e8e4e6'), BLACK = new THREE.Color('#1c1719');

export class Smoke {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group);
    this.pool = [];
    for (let i = 0; i < 90; i++) {
      const m = new THREE.Mesh(PUFF, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
      m.visible = false; this.group.add(m); this.pool.push({ m, age: 0, life: 0 });
    }
    this.sparks = [];
    const sm = new THREE.MeshBasicMaterial({ color: '#ffd27a' });
    for (let i = 0; i < 20; i++) { const m = new THREE.Mesh(SPARK, sm); m.visible = false; this.group.add(m); this.sparks.push({ m, age: 1, life: 0 }); }
    this.acc = 0; this.sparkAcc = 0; this.next = 0;
  }

  clear() { for (const p of [...this.pool, ...this.sparks]) { p.m.visible = false; p.age = p.life = 0; } }

  emit(bot, black) {
    const p = this.pool[this.next++ % this.pool.length], m = p.m, R = bot.s.radius;
    m.visible = true; p.age = 0; p.life = black ? 1.0 : 1.1;
    p.black = black;
    m.position.set(bot.x + (Math.random() - 0.5) * R, 0.9 + Math.random() * 0.2, bot.z + (Math.random() - 0.5) * R);
    p.vy = black ? 2 : 1.8; p.vx = (Math.random() - 0.5) * 0.8; p.vz = (Math.random() - 0.5) * 0.8;
    p.s0 = (black ? 0.35 : 0.3) * R;
    m.scale.setScalar(p.s0);
    m.material.color.copy(black ? BLACK : WHITE);
  }

  spark(bot) {
    const s = this.sparks.find(s => s.age >= s.life); if (!s) return;
    const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 4;
    s.m.visible = true; s.age = 0; s.life = 0.35 + Math.random() * 0.25;
    s.m.position.set(bot.x, 0.7, bot.z); s.vx = Math.cos(a) * v; s.vz = Math.sin(a) * v; s.vy = 3 + Math.random() * 4;
  }

  update(dt, bot) {
    const W = C.wear, pct = bot && bot.mesh.visible ? bot.hp / bot.s.hp * 100 : 100;
    if (pct < W.whiteSmoke) {
      const black = pct < W.blackSmoke;
      // чем меньше ХП, тем гуще дым
      const rate = black ? 10 + (W.blackSmoke - pct) * 0.4 : 5 + (W.whiteSmoke - pct) * 0.3;
      this.acc += rate * dt;
      while (this.acc > 1) { this.acc--; this.emit(bot, black); }
      if (black) { this.sparkAcc += 3 * dt; while (this.sparkAcc > 1) { this.sparkAcc--; if (Math.random() < 0.6) this.spark(bot); } }
    }
    for (const p of this.pool) {
      if (!p.m.visible) continue;
      p.age += dt;
      if (p.age > p.life) { p.m.visible = false; continue; }
      const k = p.age / p.life, m = p.m;
      m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
      p.vy *= Math.exp(-0.8 * dt);
      m.scale.setScalar(p.s0 * (1 + k * (p.black ? 1.8 : 2.2)));
      m.material.opacity = (p.black ? 0.75 : 0.7) * (1 - k) * Math.min(1, p.age * 8);
    }
    for (const s of this.sparks) {
      if (s.age >= s.life) { s.m.visible = false; continue; }
      s.age += dt; s.vy -= 20 * dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
    }
  }
}
