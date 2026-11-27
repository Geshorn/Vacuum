import * as THREE from 'three';
import { C } from './config.js';

/* Препятствия на трассе — на всех картах, у каждой свой вид:
   - катится поперёк дороги: апельсин (кухня), мяч (детская), яблоко (сад); перепрыгивает бортики;
   - переходит дорогу: кошка (кухня), заводная машинка (детская), ёжик (сад);
   - ускорители: светящиеся стрелки на прямых — наехал, и секунду едешь быстрее (как турбо).
   Мешают легко: сбивают с курса и тормозят, урона нет. */

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...o });

// Вид препятствий по карте
const LOOKS = {
  kitchen: { roller: 'orange', walker: 'cat' },
  kids: { roller: 'ball', walker: 'toycar' },
  garden: { roller: 'apple', walker: 'hedgehog' },
};

export class Hazards {
  constructor(scene, track, mapId) {
    this.track = track; this.group = new THREE.Group(); scene.add(this.group);
    this.look = LOOKS[mapId] || LOOKS.kitchen;
    this.movers = []; this.pads = [];
    const spots = this.freeSpots();
    // по одному месту для катящегося предмета и для животного, 3 ускорителя — на самых прямых участках
    // сначала места для катящегося предмета и животного (на поворотах — так интереснее), потом ускорители на самых прямых
    const byBend = [...spots].sort((a, b) => b.bend - a.bend);
    const take = s => { spots.splice(spots.indexOf(s), 1); return s; };
    if (byBend[1]) { this.spawnPoint('roller', take(byBend[1])); }
    if (byBend[3]) { this.spawnPoint('walker', take(byBend[3])); }
    for (const s of [...spots].sort((a, b) => a.bend - b.bend).slice(0, 3)) this.pad(take(s).i);
  }

  // Места на трассе без пит-лейна, моста, трамплина, пруда и тоннеля; straight — почти прямой участок
  freeSpots() {
    const t = this.track, out = [];
    const near = (o, i, d) => o && Math.abs(((i - o.at + t.n * 1.5) % t.n) - t.n / 2) < d;
    const bend = i => { const a = t.t[t.at(i - 6)], b = t.t[t.at(i + 6)]; return Math.abs(Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z)); };
    for (let i = 20; i < t.n - 20; i += 5) {
      if (t.pitK(i) >= 0 || t.pitK(t.at(i - 15)) >= 0 || t.pitK(t.at(i + 15)) >= 0) continue;
      if (near(t.bridge, i, 40) || near(t.jump, i, 35) || near(t.tunnel, i, 30)) continue;
      if (t.halfAt(i) < t.half - 0.1) continue;
      out.push({ i, bend: bend(i) });
    }
    // разносим по кругу: не ближе 40 сегментов друг к другу
    const res = [];
    for (const s of out) if (!res.some(o => Math.abs(o.i - s.i) < 30)) res.push(s);
    return res;
  }

  // ── Ускоритель: три светящиеся стрелки по ходу трассы ─────────────────────────
  pad(i) {
    const t = this.track, p = t.p[i], tg = t.t[i], g = new THREE.Group();
    g.position.set(p.x, t.heightAt(i) + 0.05, p.z); g.rotation.y = -Math.atan2(tg.z, tg.x); this.group.add(g);
    const sh = new THREE.Shape(); sh.moveTo(-1.2, -2.6); sh.lineTo(1.2, 0); sh.lineTo(-1.2, 2.6); sh.lineTo(-2.4, 2.6); sh.lineTo(0, 0); sh.lineTo(-2.4, -2.6);
    const geo = new THREE.ShapeGeometry(sh); geo.rotateX(-Math.PI / 2);
    const mats = [];
    for (let k = 0; k < 3; k++) {
      const m = new THREE.MeshBasicMaterial({ color: '#40e0ff', transparent: true, opacity: 0.8, depthWrite: false });
      const a = new THREE.Mesh(geo, m); a.position.x = -3 + k * 3; g.add(a); mats.push(m);
    }
    const base = new THREE.Mesh(new THREE.PlaneGeometry(10, 6.4), new THREE.MeshBasicMaterial({ color: '#0d3b4f', transparent: true, opacity: 0.55, depthWrite: false }));
    base.rotation.x = -Math.PI / 2; base.position.y = -0.01; g.add(base);
    this.pads.push({ i, x: p.x, z: p.z, fx: tg.x, fz: tg.z, mats });
  }

  // ── Точка появления: катящийся предмет или животное переходит дорогу поперёк в сегменте i ──
  spawnPoint(kind, s) {
    if (!s) return;
    this.movers.push({ kind, i: s.i, next: 3 + Math.random() * 6, obj: null });
  }

  makeMesh(kind) {
    const g = new THREE.Group(), L = this.look[kind];
    if (L === 'orange') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), mat('#fb8c00', { roughness: 0.7 })); g.add(b);
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), mat('#43a047')); lf.scale.set(1.4, 0.3, 0.8); lf.position.y = 1.7; b.add(lf);
      g.userData = { r: 1.7, roll: b };
    } else if (L === 'ball') {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32; const x = cv.getContext('2d');
      ['#e53935', '#fff', '#1e88e5', '#fff', '#fdd835', '#fff'].forEach((c, k) => { x.fillStyle = c; x.fillRect(k * 64 / 6, 0, 64 / 6 + 1, 32); });
      const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.9, 18, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4 })); g.add(b);
      g.userData = { r: 1.9, roll: b };
    } else if (L === 'apple') {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1.5, 16, 12), mat('#e53935', { roughness: 0.35 })); b.scale.y = 0.92; g.add(b);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.8, 5), mat('#5d4037')); st.position.y = 1.6; b.add(st);
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat('#43a047')); lf.scale.set(1.5, 0.25, 0.7); lf.position.set(0.4, 1.7, 0); b.add(lf);
      g.userData = { r: 1.5, roll: b };
    } else if (L === 'cat') {
      const fur = mat('#8d6e63', { roughness: 1 }), body = new THREE.Mesh(new THREE.CapsuleGeometry(1, 2.4, 6, 10), fur);
      body.rotation.z = Math.PI / 2; body.position.y = 1.6; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), fur); head.position.set(2.2, 2.4, 0); g.add(head);
      for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.7, 4), fur); e.position.set(2.2, 3.3, s * 0.45); g.add(e); const ey = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), mat('#c6ff00')); ey.position.set(3.0, 2.55, s * 0.35); g.add(ey); }
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 2.6, 6), fur); tail.position.set(-2.4, 2.6, 0); tail.rotation.z = 0.7; g.add(tail);
      const legs = [];
      for (const [lx, s] of [[-1, 1], [-1, -1], [1, 1], [1, -1]]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.4, 6), fur); l.position.set(lx, 0.7, s * 0.6); g.add(l); legs.push(l); }
      g.userData = { r: 2.2, legs, tail };
    } else if (L === 'toycar') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(4, 1.5, 2.4), mat('#8e24aa')); body.position.y = 1.2; g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 2.2), mat('#bbdefb', { roughness: 0.2 })); cab.position.set(-0.3, 2.5, 0); g.add(cab);
      const key = new THREE.Group(); key.position.set(-2.3, 2.4, 0); g.add(key);
      for (const s of [-1, 1]) { const k = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.12, 6, 10), mat('#ffd54f', { metalness: 0.6 })); k.position.z = s * 0.5; key.add(k); }
      const wheels = [];
      for (const [wx, s] of [[-1.3, 1], [1.3, 1], [-1.3, -1], [1.3, -1]]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.4, 10), mat('#212121')); w.rotation.x = Math.PI / 2; w.position.set(wx, 0.6, s * 1.3); g.add(w); wheels.push(w); }
      g.userData = { r: 2.3, key, wheels };
    } else {   // ёжик
      const body = new THREE.Mesh(new THREE.SphereGeometry(1.4, 14, 10), mat('#6d4c41', { roughness: 1 })); body.scale.set(1.3, 0.85, 1); body.position.y = 1.1; g.add(body);
      const spike = mat('#3e2723', { roughness: 1 });
      for (let k = 0; k < 26; k++) { const a = Math.random() * Math.PI * 2, b = Math.random() * 1.2; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 4), spike);
        const dir = new THREE.Vector3(Math.cos(a) * Math.sin(b) * 1.3 - 0.3, Math.cos(b) * 0.85, Math.sin(a) * Math.sin(b)).normalize();
        sp.position.set(dir.x * 1.6 - 0.2, 1.1 + dir.y * 1.2, dir.z * 1.4); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(sp); }
      const face = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.3, 10), mat('#d7ccc8')); face.rotation.z = -Math.PI / 2; face.position.set(1.9, 1, 0); g.add(face);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), mat('#212121')); nose.position.set(2.55, 1, 0); g.add(nose);
      g.userData = { r: 1.9, legs: [] };
    }
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  // Каждый кадр: движение, удары по роботам, ускорители. onHit(kind, robot) — для реплик
  update(now, dt, bots, onHit) {
    const t = this.track;
    for (const p of this.pads) {
      p.mats.forEach((m, k) => { m.opacity = 0.35 + 0.55 * Math.max(0, Math.sin(now * 6 - k * 0.9)); });
      for (const b of bots) {
        const dx = b.x - p.x, dz = b.z - p.z, along = dx * p.fx + dz * p.fz, side = -dx * p.fz + dz * p.fx;
        if (Math.abs(along) < 5 && Math.abs(side) < 3.6 && !((b.padCool || 0) > now)) {
          // мягкий разовый толчок вперёд (+30% к максимуму), дальше робот сам сбрасывает до своей скорости
          b.padCool = now + 1.2; if (!b.inLane) b.v = Math.max(b.v, b.s.maxSpeed * 1.3);
          onHit?.('boost', b);
        }
      }
    }
    for (const M of this.movers) {
      if (!M.obj) {
        if ((M.next -= dt) > 0) continue;
        const dir = Math.random() < 0.5 ? 1 : -1, w = t.halfAt(M.i) + C.wallThick + 6;
        const mesh = this.makeMesh(M.kind); this.group.add(mesh);
        M.obj = { mesh, d: -dir * w, dir, w, speed: M.kind === 'roller' ? 9 + Math.random() * 3 : 3.5, r: mesh.userData.r, scared: 0, hits: new Map() };
      }
      const O = M.obj, i = M.i, nrm = t.nrm[i], tg = t.t[i], p = t.p[i];
      O.d += O.dir * O.speed * dt;
      const x = p.x + nrm.x * O.d, z = p.z + nrm.z * O.d, wall = t.halfAt(i);
      let y = t.heightAt(i);
      const ad = Math.abs(O.d);
      if (ad > wall - 1.2 && ad < wall + C.wallThick + 2.2) { const u = (ad - (wall - 1.2)) / (C.wallThick + 3.4); y += Math.sin(u * Math.PI) * 3.2; }   // перепрыгивает бортик
      if (O.scared > 0) { O.scared -= dt; y += Math.sin((1 - O.scared / 0.5) * Math.PI) * 1.5; }
      O.mesh.position.set(x, y, z);
      const ang = Math.atan2(nrm.z * O.dir, nrm.x * O.dir);
      O.mesh.rotation.y = -ang;
      const U = O.mesh.userData;
      if (U.roll) U.roll.rotation.z -= O.speed * dt / O.r;
      if (U.legs) U.legs.forEach((l, k) => { l.rotation.z = Math.sin(now * 10 + k * Math.PI / 2) * 0.5; });
      if (U.tail) U.tail.rotation.x = Math.sin(now * 3) * 0.4;
      if (U.key) U.key.rotation.x += dt * 8;
      if (U.wheels) U.wheels.forEach(w => { w.rotation.y += dt * 6; });
      // удар: катящийся толкает робота по своему ходу, животное отбрасывает робота назад; урона нет
      for (const b of bots) {
        if (!b.mesh.visible || b.air) continue;
        const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
        if (d > O.r + b.s.radius || (O.hits.get(b) || 0) > now) continue;
        O.hits.set(b, now + 1.2);
        const c = Math.cos(b.a), s = Math.sin(b.a), kick = M.kind === 'roller' ? [nrm.x * O.dir, nrm.z * O.dir, 14] : [dx / (d || 1), dz / (d || 1), 10];
        const p0 = kick[2] / Math.sqrt(b.s.mass);
        const wx = c * b.v - s * b.lat + kick[0] * p0, wz = s * b.v + c * b.lat + kick[1] * p0;
        b.v = (wx * c + wz * s) * (M.kind === 'roller' ? 0.8 : 0.35); b.lat = -wx * s + wz * c;
        b.slipUntil = Math.max(b.slipUntil || 0, now + 0.35); b.spin = (Math.random() < 0.5 ? -1 : 1) * 2;
        b.hitN = [-dx / (d || 1), -dz / (d || 1)];
        if (M.kind === 'walker') O.scared = 0.5;
        onHit?.(M.kind, b);
      }
      if (Math.abs(O.d) > O.w + 0.5) {              // ушёл за дорогу — исчезает, через время появится снова
        this.group.remove(O.mesh); M.obj = null; M.next = M.kind === 'roller' ? 7 + Math.random() * 6 : 10 + Math.random() * 8;
      }
    }
  }
}
