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
    this.extras = [];   // прочие объекты оружия: { mesh, update(now, dt, bots, onHit) → жив ли ещё }
    this.group = new THREE.Group(); scene.add(this.group);
    this.foamTex = foamTexture();
    this.pelletGeo = new THREE.DodecahedronGeometry(0.45, 0);
    this.pelletMats = ['#8a7a6a', '#c9a46a', '#6f6b77'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
  }

  clear() {
    for (const p of [...this.puddles, ...this.pellets, ...this.extras]) this.group.remove(p.mesh);
    this.puddles = []; this.pellets = []; this.queue = []; this.extras = [];
  }

  // Общая проверка попадания по роботу (кроме владельца): круг радиуса робота + r
  touching(x, z, r, bots, except) {
    for (const b of bots) {
      if (b === except || !b.mesh.visible) continue;
      const R = b.s.radius + r;
      if ((b.x - x) ** 2 + (b.z - z) ** 2 < R * R) return b;
    }
    return null;
  }

  // 💨 Пылевая ракета: комок пыли летит над бортиками к ближайшему сопернику впереди (самонаводится)
  // и взрывается при попадании (или в конце полёта), отбрасывая всех вокруг — см. blast()
  shootRocket(bot, now, bots) {
    const P = W().rocket, fx = Math.cos(bot.a), fz = Math.sin(bot.a);
    // цель: ближайший впереди в широком конусе, иначе просто ближайший
    let tg = null, bd = Infinity, any = null, ad = Infinity;
    for (const o of bots) {
      if (o === bot || !o.mesh.visible) continue;
      const dx = o.x - bot.x, dz = o.z - bot.z, d = Math.hypot(dx, dz);
      if (d < ad) { ad = d; any = o; }
      if ((dx * fx + dz * fz) / d > 0.2 && d < bd) { bd = d; tg = o; }
    }
    tg = tg || any;
    // всё, что относится к ракете (сам комок и шлейф), — в одной группе holder: при удалении уходит целиком,
    // в том числе при перезапуске гонки (раньше шлейф оставался висеть в воздухе)
    const holder = new THREE.Group(); this.group.add(holder);
    const m = new THREE.Group(); holder.add(m);
    const mat = new THREE.MeshStandardMaterial({ color: '#9a96a2', roughness: 1, transparent: true, opacity: 0.9 });
    for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.5, 0.8), 10, 8), mat); s.position.set(rnd(-0.4, 0.4), rnd(-0.3, 0.3), rnd(-0.4, 0.4)); m.add(s); }
    const trail = [];
    for (let k = 0; k < 8; k++) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#c9c5d0', transparent: true, opacity: 0, depthWrite: false })); holder.add(s); trail.push(s); }
    const st = { x: bot.x + fx * (bot.s.radius + 1), z: bot.z + fz * (bot.s.radius + 1), a: bot.a, until: now + P.life, k: 0 };
    const cleanup = () => {};
    this.extras.push({ mesh: holder, update: (now, dt, bots, onHit) => {
      if (tg && !tg.mesh.visible) tg = null;          // цель выбыла — летит прямо и взорвётся в конце
      if (tg) {                                      // доворот к цели
        const want = Math.atan2(tg.z - st.z, tg.x - st.x);
        let da = Math.atan2(Math.sin(want - st.a), Math.cos(want - st.a));
        st.a += Math.max(-P.turn * dt, Math.min(P.turn * dt, da));
      }
      st.x += Math.cos(st.a) * P.speed * dt; st.z += Math.sin(st.a) * P.speed * dt;
      m.position.set(st.x, 3, st.z); m.rotation.y += dt * 6; m.rotation.x += dt * 4;
      // шлейф пыли
      const s = trail[st.k++ % trail.length]; s.position.copy(m.position); s.material.opacity = 0.6; s.scale.setScalar(1);
      for (const t of trail) { t.material.opacity = Math.max(0, t.material.opacity - dt * 1.5); t.scale.multiplyScalar(1 + dt * 1.5); }
      if (!this.touching(st.x, st.z, 1.2, bots, bot) && now < st.until - 0.05) return true;
      cleanup();
      this.blast(st.x, st.z, bot, now, bots, onHit);   // попала или кончилось время — взрыв
      return false;
    } });
  }

  // Облачко-«поф» на месте телепорта (только эффект, никого не трогает)
  poof(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); this.group.add(g);
    const puffs = [];
    for (let k = 0; k < 10; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.6, 1.1), 10, 8), new THREE.MeshBasicMaterial({ color: '#cfe6ff', transparent: true, opacity: 0.8, depthWrite: false }));
      const a = k / 10 * Math.PI * 2; m.position.set(Math.cos(a) * 0.8, 0.8, Math.sin(a) * 0.8); g.add(m);
      puffs.push({ m, vx: Math.cos(a) * 6, vz: Math.sin(a) * 6 });
    }
    const born = performance.now() / 1000;
    this.extras.push({ mesh: g, update: now => {
      const f = (now - born) / 0.6;
      if (f >= 1) return false;
      for (const p of puffs) { p.m.position.x += p.vx / 60; p.m.position.z += p.vz / 60; p.m.position.y += 0.05; p.m.material.opacity = 0.8 * (1 - f); p.m.scale.setScalar(1 + f); }
      return true;
    } });
  }

  // Толчок роботу в мировом направлении (nx, nz) с силой power (лёгких отбрасывает дальше)
  push(b, nx, nz, power) {
    const p = power / Math.sqrt(b.s.mass), c = Math.cos(b.a), s = Math.sin(b.a);
    const wx = c * b.v - s * b.lat + nx * p, wz = s * b.v + c * b.lat + nz * p;
    b.v = wx * c + wz * s; b.lat = -wx * s + wz * c;
  }

  // 💥 Взрыв пылевой ракеты: всех, кроме стрелявшего, в радиусе отбрасывает от центра;
  // толчок и урон слабеют к краю
  blast(x, z, owner, now, bots, onHit) {
    const P = W().rocket;
    for (const b of bots) {
      if (b === owner || !b.mesh.visible) continue;
      const dx = b.x - x, dz = b.z - z, d = Math.hypot(dx, dz);
      if (d > P.radius) continue;
      if (this.absorb(b, now)) continue;
      const k = 1 - d / P.radius, nx = d > 0.01 ? dx / d : Math.cos(b.a), nz = d > 0.01 ? dz / d : Math.sin(b.a);
      this.push(b, nx, nz, P.push * (0.4 + 0.6 * k));
      b.slipUntil = now + 0.6; b.spin = (Math.random() < 0.5 ? -1 : 1) * 4;
      b.hitN = [-nx, -nz];
      onHit(b, P.damage * (0.4 + 0.6 * k), owner, 'rocket');
    }
    // облако пыли: расширяющееся кольцо и клубы
    const g = new THREE.Group(); g.position.set(x, 0, z); this.group.add(g);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.2, 40), new THREE.MeshBasicMaterial({ color: '#d8d4dc', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.15; g.add(ring);
    const puffs = [];
    for (let k = 0; k < 14; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(rnd(0.8, 1.6), 10, 8), new THREE.MeshStandardMaterial({ color: '#a8a4b0', roughness: 1, transparent: true, opacity: 0.85, depthWrite: false }));
      const a = rnd(0, 6.3); m.position.set(0, 1, 0); g.add(m); puffs.push({ m, vx: Math.cos(a) * rnd(8, 16), vz: Math.sin(a) * rnd(8, 16), vy: rnd(2, 6) });
    }
    const born = now;
    this.extras.push({ mesh: g, update: (now, dt) => {
      const f = (now - born) / 0.9;
      if (f >= 1) return false;
      ring.scale.setScalar(1 + f * P.radius); ring.material.opacity = 0.8 * (1 - f);
      for (const p of puffs) { p.m.position.x += p.vx * dt; p.m.position.z += p.vz * dt; p.m.position.y += p.vy * dt; p.vx *= 0.9; p.vz *= 0.9; p.m.scale.setScalar(1 + f * 1.5); p.m.material.opacity = 0.85 * (1 - f); }
      return true;
    } });
  }

  // 🍾 Пробка: летит вперёд и отскакивает от бортиков, как бильярдный шар (до bounces раз)
  shootCap(bot, now) {
    const P = W().cap, fx = Math.cos(bot.a), fz = Math.sin(bot.a), tr = this.track;
    const m = new THREE.Group(); this.group.add(m);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.45, 18), new THREE.MeshStandardMaterial({ color: '#d9503f', metalness: 0.5, roughness: 0.3 }));
    body.castShadow = true; m.add(body);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.1, 6, 18), new THREE.MeshStandardMaterial({ color: '#f2efe8', metalness: 0.6 })); rim.rotation.x = Math.PI / 2; m.add(rim);
    const st = { x: bot.x + fx * (bot.s.radius + 1), z: bot.z + fz * (bot.s.radius + 1), vx: fx * (P.speed + Math.max(0, bot.v)), vz: fz * (P.speed + Math.max(0, bot.v)), seg: bot.seg, bounces: 0, until: now + P.life };
    m.position.set(st.x, 0.8, st.z);
    this.extras.push({ mesh: m, missile: st, owner: bot, update: (now, dt, bots, onHit) => {
      if (now > st.until) return false;
      // лёгкая доводка на ближайшего робота перед пробкой (кроме стрелявшего)
      const sp0 = Math.hypot(st.vx, st.vz);
      let tg = null, td = 35;
      for (const o of bots) {
        if (o === bot || !o.mesh.visible) continue;
        const dx = o.x - st.x, dz = o.z - st.z, d = Math.hypot(dx, dz);
        if (d < td && (dx * st.vx + dz * st.vz) / (d * sp0) > 0.6) { td = d; tg = o; }
      }
      if (tg) {
        const cur = Math.atan2(st.vz, st.vx), want = Math.atan2(tg.z - st.z, tg.x - st.x);
        let da = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        da = Math.max(-P.homing * dt, Math.min(P.homing * dt, da));
        st.vx = Math.cos(cur + da) * sp0; st.vz = Math.sin(cur + da) * sp0;
      }
      st.x += st.vx * dt; st.z += st.vz * dt;
      st.seg = tr.nearest(st.x, st.z, st.seg);
      const lat = tr.lateral(st.seg, st.x, st.z), [lo, hi] = tr.bounds(st.seg, lat, 0.8);
      if (lat < lo || lat > hi) {                    // рикошет от бортика: отражаем скорость по нормали стены
        if (++st.bounces > P.bounces) return false;
        const n = tr.nrm[st.seg], s = lat > hi ? -1 : 1, nx = n.x * s, nz = n.z * s;
        const vn = st.vx * nx + st.vz * nz;
        if (vn < 0) { st.vx -= 2 * vn * nx; st.vz -= 2 * vn * nz; }
        const back = lat > hi ? hi - lat : lo - lat; st.x += n.x * back; st.z += n.z * back;
      }
      m.position.set(st.x, 0.8, st.z); m.rotation.y += dt * 14;
      const b = this.touching(st.x, st.z, 0.8, bots, now < st.until - P.life + 0.25 ? bot : null);
      if (!b) return true;
      if (!this.absorb(b, now)) {
        // толчок по направлению полёта пробки (как удар бильярдного шара); лёгкий робот улетает дальше
        const sp = Math.hypot(st.vx, st.vz), nx = st.vx / sp, nz = st.vz / sp;
        b.hitN = [-nx, -nz];
        const push = P.push / Math.sqrt(b.s.mass), c = Math.cos(b.a), s = Math.sin(b.a);
        const wx = c * b.v - s * b.lat + nx * push, wz = s * b.v + c * b.lat + nz * push;
        b.v = wx * c + wz * s; b.lat = -wx * s + wz * c;
        b.slipUntil = now + 0.4; b.spin = (Math.random() < 0.5 ? -1 : 1) * 3;   // ненадолго теряет сцепление и закручивается
        onHit(b, P.damage, bot, 'cap');
      }
      return false;
    } });
  }

  // 🍌 Банановая кожура позади: кто наедет, того разворачивает на 360° и сильно тормозит
  dropPeel(bot, now) {
    const fx = Math.cos(bot.a), fz = Math.sin(bot.a), d = bot.s.radius + 2;
    const x = bot.x - fx * d, z = bot.z - fz * d;
    const m = new THREE.Group(); m.position.set(x, 0, z); m.rotation.y = Math.random() * 6; this.group.add(m);
    const yel = new THREE.MeshStandardMaterial({ color: '#f2cf3a', roughness: 0.6 }), tip = new THREE.MeshStandardMaterial({ color: '#5a4126' });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 2.2, 4, 8), yel), a = i / 3 * Math.PI * 2 + 0.3;
      p.rotation.set(Math.PI / 2, 0, a); p.scale.set(1, 1, 0.35); p.position.set(Math.cos(a + Math.PI / 2) * 1.1, 0.18, Math.sin(a + Math.PI / 2) * 1.1); p.castShadow = true; m.add(p);
    }
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.8, 8), tip); t.position.y = 0.4; m.add(t);
    const born = now, until = now + W().banana.life;
    this.extras.push({ mesh: m, hazard: { x, z, r: 1.4 }, update: (now, dt, bots, onHit) => {
      if (now > until) return false;
      const b = this.touching(x, z, 0.9, bots, now - born < 1 ? bot : null);
      if (!b) return true;
      if (!this.absorb(b, now)) {
        // 1.5 оборота (плюс-минус) за stun секунд, руль и газ не слушаются — робот скользит юзом
        const B = W().banana;
        b.twirl = Math.PI * 2 * B.turns + rnd(-1, 1); b.twirlRate = b.twirl / B.stun; b.stunUntil = now + B.stun;
        b.v *= B.slow; this.showStars(b, true);
        onHit(b, 0, bot, 'banana');
      }
      return false;                                  // кожура использована
    } });
  }

  // Применить оружие из слота. Возвращает false, если не получилось (например, пустой контейнер для залпа).
  fire(bot, now, bots = this.lastBots || []) {
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
    } else if (w === 'magnet') {
      this.magnet(bot, now, bots);
    } else if (w === 'turbo') {
      // ⚡ Турбо: рывок за счёт батареи
      bot.boostUntil = now + W().turbo.time;
      bot.bat = Math.max(1, bot.bat - W().turbo.battery);
      this.showFlame(bot, true);
    } else if (w === 'rocket') {
      this.shootRocket(bot, now, bots);
    } else if (w === 'cap') {
      this.shootCap(bot, now);
    } else if (w === 'banana') {
      this.dropPeel(bot, now);
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

  // 🧲 Магнит: несколько секунд мусор затягивается с большого радиуса (см. trash.update — bot.magnetUntil),
  // а у соседей сразу вытягивается часть мусора из контейнера
  magnet(bot, now, bots) {
    const P = W().magnet;
    bot.magnetUntil = now + P.time;
    let stolen = 0;
    for (const o of bots) {
      if (o === bot || !o.mesh.visible || o.bin <= 0 || this.absorb(o, now)) continue;
      if (Math.hypot(o.x - bot.x, o.z - bot.z) > P.stealRange) continue;
      const take = Math.min(o.bin * P.stealPct, 100 - bot.bin), val = o.binValue * take / o.bin;
      o.bin -= take; o.binValue -= val; bot.bin += take; bot.binValue += val; stolen += take;
    }
    bot.stolen = stolen;
    this.showMagnet(bot, true);
  }

  // Кольца поля магнита: сходятся к роботу (видно, что тянет). Живут, пока действует магнит (см. update)
  showMagnet(bot, on) {
    if (on && !bot.magnetMesh) {
      const g = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.1, 6, 40), new THREE.MeshBasicMaterial({ color: k % 2 ? '#ff5b5b' : '#6fa8ff', transparent: true, opacity: 0.7, depthWrite: false }));
        r.rotation.x = Math.PI / 2; r.position.y = 0.3; g.add(r);
      }
      bot.mesh.add(g); bot.magnetMesh = g;
    }
    if (!on && bot.magnetMesh) { bot.mesh.remove(bot.magnetMesh); bot.magnetMesh = null; }
  }

  // Звёздочки над оглушённым роботом (после банана)
  showStars(bot, on) {
    if (on && !bot.starsMesh) {
      const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: '#ffd84a' });
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 0), mat), a = k / 4 * Math.PI * 2;
        s.position.set(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3); s.scale.y = 0.5; g.add(s);
      }
      g.position.y = 2.4; bot.mesh.add(g); bot.starsMesh = g;
    }
    if (!on && bot.starsMesh) { bot.mesh.remove(bot.starsMesh); bot.starsMesh = null; }
  }

  // Пламя турбо: два голубых конуса позади робота
  showFlame(bot, on) {
    if (on && !bot.flameMesh) {
      const g = new THREE.Group(), R = bot.s.radius;
      for (const s of [-1, 1]) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.6, 10), new THREE.MeshBasicMaterial({ color: '#8fd4ff', transparent: true, opacity: 0.85, depthWrite: false }));
        f.rotation.z = Math.PI / 2; f.position.set(-R - 1.2, 0.5, s * R * 0.45); g.add(f);
        const core = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
        core.rotation.z = Math.PI / 2; core.position.set(-R - 0.8, 0.5, s * R * 0.45); g.add(core);
      }
      bot.mesh.add(g); bot.flameMesh = g;
    }
    if (!on && bot.flameMesh) { bot.mesh.remove(bot.flameMesh); bot.flameMesh = null; }
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
    this.lastBots = bots;
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
        if (b.slipUntil + W().soap.immune > now) continue;   // ещё скользит или только что выскользнул — даём выехать
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
      b.gripMul = sl ? W().soap.grip : 1;
      if (sl) { b.a += b.spin * dt; b.spin *= Math.exp(-1.5 * dt); }
      // банан: крутится юзом, пока не кончится оборот; над головой звёздочки
      if (b.twirl > 0) { const d = Math.min(b.twirl, (b.twirlRate || 9) * dt); b.a += d; b.twirl -= d; b.gripMul = 0.15; }
      if (b.starsMesh) {
        if (b.stunUntil > now) { b.starsMesh.rotation.y += dt * 6; b.starsMesh.position.y = 2.4 + Math.sin(now * 8) * 0.15; }
        else this.showStars(b, false);
      }
    }
    // объекты, созданные прямо во время обновления (например, взрыв ракеты), не должны потеряться:
    // обновляем старый список, а новые добавляем к оставшимся
    const cur = this.extras; this.extras = [];
    const keep = cur.filter(e => { const alive = e.update(now, dt, bots, onHit); if (!alive) this.group.remove(e.mesh); return alive; });
    this.extras = keep.concat(this.extras);

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

    // магнит: тянет соперников в радиусе к себе (сильнее вблизи, лёгких — сильнее); кольца сходятся к роботу
    for (const m of bots) {
      if (!(m.magnetUntil > now) || !m.mesh.visible) { if (m.magnetMesh) this.showMagnet(m, false); continue; }
      const P = W().magnet;
      for (const o of bots) {
        if (o === m || !o.mesh.visible || o.inLane || this.absorb(o, now)) continue;
        const dx = m.x - o.x, dz = m.z - o.z, d = Math.hypot(dx, dz);
        if (d > P.pullRange || d < m.s.radius + o.s.radius + 0.5) continue;
        this.push(o, dx / d, dz / d, P.pull * (1 - d / P.pullRange * 0.6) * dt);
      }
      if (m.magnetMesh) m.magnetMesh.children.forEach((r, k) => {
        const f = (now * 0.9 + k / 3) % 1;
        r.scale.setScalar(1 + (1 - f) * P.pullRange * 0.9); r.material.opacity = 0.75 * f;
      });
    }

    // турбо: держим скорость выше обычного максимума, пламя мерцает
    for (const b of bots) {
      if (b.boostUntil > now) {
        if (!b.inLane) b.v = Math.max(b.v, b.s.maxSpeed * W().turbo.speed);
        if (b.flameMesh) b.flameMesh.scale.x = 0.8 + Math.random() * 0.5;
      } else if (b.flameMesh) this.showFlame(b, false);
    }

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
    if (w === 'soap' || w === 'banana') go = others.some(o => o.dot < -0.3 && o.d < A.soapRange) || held > A.maxHold;
    if (w === 'trash') go = b.bin >= W().trash.cost && others.some(o => o.dot > 0.6 && o.d < A.shootRange);
    if (w === 'magnet') go = others.some(o => o.d < W().magnet.pullRange) || (b.bin < 80 && held > A.react + 1);
    if (w === 'turbo') go = (rival.ram != null && !b.inLane) || (held > A.maxHold && !b.inLane);
    if (w === 'rocket') go = others.some(o => o.dot > 0.2 && o.d < 90) || held > A.maxHold;
    if (w === 'cap') go = others.some(o => o.dot > 0.7 && o.d < 55) || held > A.maxHold;
    if (w === 'sponge') go = b.hp < b.s.hp * 0.8 || others.some(o => o.d < 14) || held > A.maxHold;
    if (go && held > A.react && this.fire(b, now)) { rival.gotAt = 0; return; }
    // оружие, которым никак не воспользоваться (залп без мусора), выбрасываем — чтобы взять новое из коробок
    if (held > A.maxHold + 2) { b.weapon = null; rival.gotAt = 0; }
  }

  // Уклонение: лужа или кожура на пути впереди — объехать с той стороны, где больше места;
  // пробка летит прямо на бота — уйти вбок. Замечает помеху не всегда (C.rivals.dodge.notice).
  // Возвращает смещение от центра трассы, к которому рулить, или null.
  dodgeLane(rival, now) {
    const b = rival.bot, D = C.rivals.dodge, tr = this.track;
    if (b.inLane) return null;
    const fx = Math.cos(b.a), fz = Math.sin(b.a), seen = rival.seen || (rival.seen = new WeakMap());
    const notices = key => { if (!seen.has(key)) seen.set(key, Math.random() < D.notice); return seen.get(key); };
    // летящие пробки: если приближается и пройдёт рядом — шаг в сторону
    for (const e of this.extras) {
      const s = e.missile; if (!s || e.owner === b || !notices(e)) continue;
      const dx = b.x - s.x, dz = b.z - s.z, d = Math.hypot(dx, dz), sp = Math.hypot(s.vx, s.vz) || 1;
      if (d > D.missileRange || (dx * s.vx + dz * s.vz) / (d * sp) < 0.8) continue;
      // уходим дальше от линии полёта: в ту сторону, с которой бот уже от неё
      const px = -s.vz / sp, pz = s.vx / sp, side = dx * px + dz * pz > 0 ? 1 : -1;
      const n = tr.nrm[b.seg], toLat = Math.sign((px * n.x + pz * n.z) * side) || 1;
      return tr.lateral(b.seg, b.x, b.z) + toLat * D.step;
    }
    // лужи и кожура впереди на пути — считаем вдоль трассы (на поворотах «прямо по курсу» не годится):
    // помеха в пределах lookAhead по трассе и на той же полосе, что и бот
    const cur = tr.lateral(b.seg, b.x, b.z), step = C.sampleStep;
    let best = null, bestAhead = D.lookAhead;
    const hz = [...this.puddles.map(p => ({ key: p, x: p.x, z: p.z, r: W().soap.radius })), ...this.extras.filter(e => e.hazard).map(e => ({ key: e, ...e.hazard }))];
    for (const h of hz) {
      if ((h.x - b.x) ** 2 + (h.z - b.z) ** 2 > (D.lookAhead + 10) ** 2) continue;
      const hs = tr.nearest(h.x, h.z, b.seg), ahead = ((hs - b.seg + tr.n) % tr.n) * step;
      if (ahead > bestAhead) continue;
      h.lat = tr.lateral(hs, h.x, h.z);
      if (Math.abs(h.lat - cur) > h.r + b.s.radius + D.margin || !notices(h.key)) continue;
      best = h; bestAhead = ahead;
    }
    if (!best) return null;
    const hl = best.lat, clear = best.r + b.s.radius + D.margin;
    const left = hl + clear, right = hl - clear, lim = tr.half - b.s.radius - 0.5;
    // объезжаем с той стороны, где хватает места (если обе — ближайшей к текущей полосе)
    const okL = left < lim, okR = right > -lim;
    if (okL && okR) return Math.abs(left - cur) < Math.abs(right - cur) ? left : right;
    return okL ? left : okR ? right : null;
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
