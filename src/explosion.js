import * as THREE from 'three';

// Взрыв робота: вспышка света, огненный шар, искры, разлетающиеся обломки корпуса и дым.
// Создаётся в точке робота, обновляется каждый кадр через update(dt), сам удаляет себя по окончании.
export class Explosion {
  constructor(scene, x, z, color = '#f1edf2', size = 1) {
    this.scene = scene; this.t = 0; this.done = false;
    this.group = new THREE.Group(); this.group.position.set(x, 0, z);
    scene.add(this.group);
    const S = size;

    this.light = new THREE.PointLight('#ffb36b', 60, 40 * S, 1.5);
    this.light.position.y = 2; this.group.add(this.light);

    this.fire = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 1, depthWrite: false }));
    this.fire.position.y = 1; this.group.add(this.fire);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40),
      new THREE.MeshBasicMaterial({ color: '#ff8a5c', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.1; this.group.add(this.ring);
    this.size = S;

    // частицы: искры (быстрые, яркие), обломки (цвет корпуса, крутятся, отскакивают от пола), дым (медленно растёт)
    this.parts = [];
    const spark = new THREE.BoxGeometry(0.18, 0.18, 0.18), chunk = new THREE.BoxGeometry(0.5, 0.25, 0.4), puff = new THREE.SphereGeometry(1, 10, 8);
    const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffe08a' });
    const chunkMats = [new THREE.MeshStandardMaterial({ color, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: '#2b2b33', roughness: 0.8 })];
    const rnd = (a, b) => a + Math.random() * (b - a);
    const add = (geo, mat, kind, speed, up, life, scale) => {
      const m = new THREE.Mesh(geo, mat); m.scale.setScalar(scale); m.position.y = 1;
      const ang = Math.random() * Math.PI * 2;
      this.group.add(m);
      this.parts.push({ m, kind, life, age: 0, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed, vy: up, rx: rnd(-8, 8), rz: rnd(-8, 8) });
    };
    for (let i = 0; i < 60; i++) add(spark, sparkMat, 'spark', rnd(8, 22) * S, rnd(4, 14), rnd(0.4, 1.0), rnd(0.6, 1.4));
    for (let i = 0; i < 16; i++) add(chunk, chunkMats[i % 2], 'chunk', rnd(4, 11) * S, rnd(6, 13), Infinity, rnd(0.6, 1.3) * S);   // обломки не исчезают
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#3a2a30', transparent: true, opacity: 0.6, depthWrite: false });
      add(puff, mat, 'smoke', rnd(0.5, 2.5) * S, rnd(1.5, 3.5), rnd(2, 3.2), rnd(0.6, 1.1) * S);
    }
  }

  // Сила тряски камеры сейчас (0..1)
  shake() { return Math.max(0, 1 - this.t / 0.6); }

  update(dt) {
    if (this.done) return;
    this.t += dt; const t = this.t, S = this.size;
    // огненный шар: быстро раздувается и гаснет, меняя цвет с жёлтого на красный
    const f = Math.min(1, t / 0.35);
    this.fire.scale.setScalar((1 + f * 4) * S);
    this.fire.material.opacity = Math.max(0, 1 - t / 0.55);
    this.fire.material.color.setHSL(0.12 - f * 0.1, 1, 0.65 - f * 0.2);
    this.ring.scale.setScalar(1 + t * 18 * S);
    this.ring.material.opacity = Math.max(0, 0.9 - t * 1.8);
    this.light.intensity = Math.max(0, 60 * (1 - t / 0.5));

    for (const p of this.parts) {
      if (p.age > p.life) { p.m.visible = false; continue; }
      p.age += dt;
      const m = p.m;
      if (p.kind === 'smoke') {
        p.vx *= Math.exp(-1.5 * dt); p.vz *= Math.exp(-1.5 * dt);
        m.scale.multiplyScalar(1 + dt * 0.9);
        m.material.opacity = 0.6 * Math.max(0, 1 - p.age / p.life);
      } else {
        p.vy -= 25 * dt;
        m.rotation.x += p.rx * dt; m.rotation.z += p.rz * dt;
        if (p.kind === 'spark') m.scale.multiplyScalar(Math.exp(-2 * dt));
      }
      m.position.x += p.vx * dt; m.position.y += p.vy * dt; m.position.z += p.vz * dt;
      // обломки отскакивают от пола и затихают
      if (p.kind === 'chunk' && m.position.y < 0.15) { m.position.y = 0.15; p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; p.rx *= 0.5; p.rz *= 0.5; }
      if (p.kind === 'spark' && m.position.y < 0) p.age = p.life + 1;
    }
    // обломки остаются лежать на трассе — убираем только огонь, свет и дым
    if (t > 3.5 && !this.cleaned) {
      this.cleaned = true;
      for (const o of [this.fire, this.ring, this.light]) this.group.remove(o);
      this.done = true;
    }
  }

  dispose() { this.scene.remove(this.group); }
}
