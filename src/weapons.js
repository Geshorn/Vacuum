import * as THREE from 'three';
import { C } from './config.js';

/* Оружие роботов.
   🧴 Моющее средство — лужа пены позади робота: кто наедет, того закручивает и почти лишает сцепления.
   🗑️ Залп мусором — за фиксированные 20% контейнера длинная очередь комков вперёд (2.5 с), комки слегка
      доводятся на ближайшего соперника впереди: урон и потеря скорости.
   🧽 Губка-щит — на несколько секунд защищает от любого урона: выстрелов, луж, столкновений и стен.
   Соперники применяют оружие сами (think). */
const W = () => C.weapons;
const rnd = (a, b) => a + Math.random() * (b - a);

export class Combat {
  constructor(scene, track) {
    this.scene = scene; this.track = track;
    this.puddles = []; this.pellets = []; this.queue = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.foamTex = foamTexture();
    this.pelletGeo = new THREE.DodecahedronGeometry(0.45, 0);
    this.pelletMats = ['#8a7a6a', '#c9a46a', '#6f6b77'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  }

  clear() {
    for (const p of [...this.puddles, ...this.pellets]) this.group.remove(p.mesh);
    this.puddles = []; this.pellets = []; this.queue = [];
  }

  // Применить оружие из слота. Возвращает false, если не получилось (например, пустой контейнер для залпа).
  fire(bot, now) {
    const w = bot.weapon; if (!w) return false;
    const fx = Math.cos(bot.a), fz = Math.sin(bot.a);
    if (w === 'soap') {
      const d = bot.s.radius + W().soap.radius + 0.8;
      this.addPuddle(bot.x - fx * d, bot.z - fz * d, bot, now);
    } else if (w === 'trash') {
      // фиксированная плата из контейнера, дальше — длинная очередь
      const T = W().trash;
      if (bot.bin < T.cost) return false;
      if (bot.bin > 0) bot.binValue *= (bot.bin - T.cost) / bot.bin;
      bot.bin -= T.cost;
      const n = Math.round(T.time * T.rate);
      for (let k = 0; k < n; k++) this.queue.push({ bot, at: now + k / T.rate });
      bot.firingUntil = now + T.time;
    } else if (w === 'sponge') {
      bot.shieldUntil = now + W().sponge.time; this.showShield(bot, true);
    }
    bot.weapon = null;
    return true;
  }

  // Губка защищает от любого урона всё время действия: true — урона не будет
  absorb(bot, now) { return bot.shieldUntil > now; }

  addPuddle(x, z, owner, now) {
    const R = W().soap.radius;
    const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshStandardMaterial({ map: this.foamTex, color: '#bfe6ff', transparent: true, opacity: 0.9, roughness: 0.1, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; m.position.set(x, 0.07, z); m.scale.setScalar(0.2);
    this.group.add(m);
    // пузыри над лужей
    for (let k = 0; k < 6; k++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.25, 0.5), 10, 8), new THREE.MeshStandardMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.6, roughness: 0.05, depthWrite: false }));
      const a = rnd(0, 6.3), r = rnd(0, R * 0.8); b.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.3); m.add(b);
    }
    this.puddles.push({ mesh: m, x, z, owner, born: now, until: now + W().soap.life });
  }

  showShield(bot, on) {
    if (on && !bot.shieldMesh) {
      const R = bot.s.radius + 0.6;
      const s = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), new THREE.MeshStandardMaterial({ color: '#ffe066', emissive: '#ffcc33', emissiveIntensity: 0.4, transparent: true, opacity: 0.35, roughness: 0.6, depthWrite: false }));
      s.scale.y = 0.6; s.position.y = 0.6; bot.mesh.add(s); bot.shieldMesh = s;
    }
    if (!on && bot.shieldMesh) { bot.mesh.remove(bot.shieldMesh); bot.shieldMesh = null; }
  }

  shoot(bot) {
    const fx = Math.cos(bot.a), fz = Math.sin(bot.a), sp = W().trash.speed;
    const spread = rnd(-0.06, 0.06), c = Math.cos(spread), s = Math.sin(spread);
    const dx = fx * c - fz * s, dz = fz * c + fx * s;
    const m = new THREE.Mesh(this.pelletGeo, this.pelletMats[Math.floor(Math.random() * 3)]);
    m.position.set(bot.x + dx * (bot.s.radius + 0.8), 1, bot.z + dz * (bot.s.radius + 0.8)); m.castShadow = true;
    this.group.add(m);
    this.pellets.push({ mesh: m, vx: dx * (sp + Math.max(0, bot.v)), vz: dz * (sp + Math.max(0, bot.v)), owner: bot, life: W().trash.life, seg: bot.seg });
  }

  // Доводка: ближайший робот в конусе перед снарядом
  target(p, bots) {
    const T = W().trash, m = p.mesh.position, v = Math.hypot(p.vx, p.vz) || 1;
    let best = null, bd = 60;
    for (const b of bots) {
      if (b === p.owner || !b.mesh.visible) continue;
      const dx = b.x - m.x, dz = b.z - m.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * p.vx + dz * p.vz) / (d * v) > T.cone) { bd = d; best = b; }
    }
    return best;
  }

  // onHit(target, dmg, attacker) — нанести урон (main решает, игрок это или соперник)
  update(now, dt, bots, onHit) {
    // очередь выстрелов залпа
    this.queue = this.queue.filter(q => { if (now < q.at) return true; if (q.bot.mesh.visible) this.shoot(q.bot); return false; });

    // лужи: растут при появлении, тают в конце; наехавших закручивает
    for (const p of this.puddles) {
      const age = now - p.born, left = p.until - now;
      p.mesh.scale.setScalar(Math.min(1, 0.2 + age * 3));
      p.mesh.material.opacity = Math.min(0.9, left / 1.5);
      p.mesh.rotation.z += dt * 0.2;
      for (const b of bots) {
        if (b === p.owner && age < 1.5) continue;
        if (b.slipUntil > now) continue;
        const r = W().soap.radius + b.s.radius * 0.5;
        if ((b.x - p.x) ** 2 + (b.z - p.z) ** 2 < r * r) {
          if (this.absorb(b, now)) continue;
          b.slipUntil = now + W().soap.slipTime;
          b.spin = (Math.random() < 0.5 ? -1 : 1) * W().soap.spin;
          onHit(b, W().soap.damage, p.owner, 'soap');
        }
      }
    }
    this.puddles = this.puddles.filter(p => { if (now < p.until) return true; this.group.remove(p.mesh); return false; });

    // скольжение: закручивает и почти нет сцепления, потом плавно отпускает
    for (const b of bots) {
      const sl = b.slipUntil > now;
      b.gripMul = sl ? 0.08 : 1;
      if (sl) { b.a += b.spin * dt; b.spin *= Math.exp(-1.5 * dt); }
    }

    // снаряды мусора: летят прямо, гаснут у стен
    const tr = this.track;
    for (const p of this.pellets) {
      p.life -= dt;
      const m = p.mesh;
      // слегка поворачиваем снаряд к цели (не больше homing рад/с) — не нужно целиться идеально
      const tg = this.target(p, bots);
      if (tg) {
        const sp = Math.hypot(p.vx, p.vz), cur = Math.atan2(p.vz, p.vx), want = Math.atan2(tg.z - m.position.z, tg.x - m.position.x);
        let da = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        da = Math.max(-W().trash.homing * dt, Math.min(W().trash.homing * dt, da));
        p.vx = Math.cos(cur + da) * sp; p.vz = Math.sin(cur + da) * sp;
      }
      m.position.x += p.vx * dt; m.position.z += p.vz * dt; m.rotation.x += dt * 9; m.rotation.y += dt * 7;
      p.seg = tr.nearest(m.position.x, m.position.z, p.seg);
      const lat = tr.lateral(p.seg, m.position.x, m.position.z), [lo, hi] = tr.bounds(p.seg, lat, 0.3);
      if (lat < lo || lat > hi) p.life = 0;
      for (const b of bots) {
        if (b === p.owner || p.life <= 0) continue;
        const r = b.s.radius + 0.5;
        if ((b.x - m.position.x) ** 2 + (b.z - m.position.z) ** 2 < r * r) {
          p.life = 0;
          if (this.absorb(b, now)) continue;
          b.v *= W().trash.slow; b.hitN = [-p.vx, -p.vz].map(v => v / Math.hypot(p.vx, p.vz));
          onHit(b, W().trash.damage, p.owner, 'trash');
        }
      }
    }
    this.pellets = this.pellets.filter(p => { if (p.life > 0) return true; this.group.remove(p.mesh); return false; });

    // губки: время вышло — убрать
    for (const b of bots) if (b.shieldMesh && !(b.shieldUntil > now)) this.showShield(b, false);
    for (const b of bots) if (b.shieldMesh) b.shieldMesh.rotation.y += dt * 2;
  }

  // Соперники решают, когда применить оружие
  think(rival, bots, now) {
    const b = rival.bot, w = b.weapon;
    if (!w || b.dead) return;
    if (!rival.gotAt) rival.gotAt = now;
    const held = now - rival.gotAt, fx = Math.cos(b.a), fz = Math.sin(b.a);
    const rel = o => { const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz); return { d, dot: (dx * fx + dz * fz) / (d || 1) }; };
    const others = bots.filter(o => o !== b && o.mesh.visible).map(rel);
    const A = C.rivals.aggro;
    let go = false;
    if (w === 'soap') go = others.some(o => o.dot < -0.3 && o.d < A.soapRange) || held > A.maxHold;
    if (w === 'trash') go = b.bin >= W().trash.cost && others.some(o => o.dot > 0.6 && o.d < A.shootRange);
    if (w === 'sponge') go = b.hp < b.s.hp * 0.8 || others.some(o => o.d < 14) || held > A.maxHold;
    if (go && held > A.react && this.fire(b, now)) { rival.gotAt = 0; return; }
    // оружие, которым никак не воспользоваться (залп без мусора), выбрасываем — чтобы взять новое из коробок
    if (held > A.maxHold + 2) { b.weapon = null; rival.gotAt = 0; }
  }

  // Таран: ближайший соперник прямо впереди и близко — бот смещается на его полосу.
  // Возвращает смещение от центра трассы, к которому рулить, или null.
  ramLane(rival, bots) {
    const b = rival.bot, fx = Math.cos(b.a), fz = Math.sin(b.a), A = C.rivals.aggro;
    if (b.inLane || rival.pitting) return null;
    let best = null, bd = A.ramRange;
    for (const o of bots) {
      if (o === b || !o.mesh.visible || o.inLane) continue;
      const dx = o.x - b.x, dz = o.z - b.z, d = Math.hypot(dx, dz);
      if (d < bd && (dx * fx + dz * fz) / d > 0.75) { bd = d; best = o; }
    }
    return best ? this.track.lateral(b.seg, best.x, best.z) : null;
  }
}

// Текстура пены: голубоватые пузырьки разного размера с бликами
function foamTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d'), c = S / 2;
  const g = x.createRadialGradient(c, c, 0, c, c, c); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.8, 'rgba(220,240,255,0.9)'); g.addColorStop(1, 'rgba(200,230,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, S, S);
  for (let k = 0; k < 120; k++) {
    const a = Math.random() * 6.3, r = Math.sqrt(Math.random()) * c * 0.85, s = 1 + Math.random() * 6;
    x.strokeStyle = 'rgba(140,190,230,0.6)'; x.lineWidth = 1; x.beginPath(); x.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, s, 0, 7); x.stroke();
    x.fillStyle = 'rgba(255,255,255,0.8)'; x.beginPath(); x.arc(c + Math.cos(a) * r - s * 0.3, c + Math.sin(a) * r - s * 0.3, s * 0.3, 0, 7); x.fill();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
