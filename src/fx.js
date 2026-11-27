import * as THREE from 'three';
import { C } from './config.js';

/* Визуальные эффекты трассы:
   - частицы: искры при ударе о стену, пыль из-под робота на скорости, мокрые следы после воды, брызги в дождь;
   - зрители вдоль трассы (по теме карты) — подпрыгивают и машут, когда мимо едет лидер;
   - арка над стартом со светофором (3 красных → зелёный) и салют с конфетти на финише;
   - дождь: косые капли вокруг камеры. Всё создаётся заново при смене карты. */

const rnd = (a, b) => a + Math.random() * (b - a);
const CONFETTI = ['#ff3b4e', '#ffca28', '#40e0ff', '#66bb6a', '#ab47bc', '#ffffff'];

export class Effects {
  constructor(scene, track, mapId, scenery) {
    this.track = track; this.mapId = mapId; this.scenery = scenery;
    this.group = new THREE.Group(); scene.add(this.group);
    this.parts = []; this.fans = []; this.rain = null;
    this.geo = { s: new THREE.SphereGeometry(0.18, 5, 4), puff: new THREE.SphereGeometry(0.6, 6, 5), flat: new THREE.CircleGeometry(0.7, 10), conf: new THREE.PlaneGeometry(0.5, 0.3) };
    this.mats = {
      spark: new THREE.MeshBasicMaterial({ color: '#ffd27a' }),
      dust: new THREE.MeshBasicMaterial({ color: '#d9cfc4', transparent: true, opacity: 0.5, depthWrite: false }),
      wet: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.25, depthWrite: false }),
      spray: new THREE.MeshBasicMaterial({ color: '#dceefa', transparent: true, opacity: 0.5, depthWrite: false }),
    };
    this.confMats = CONFETTI.map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    this.fireMats = CONFETTI.map(c => new THREE.MeshBasicMaterial({ color: c, transparent: true, depthWrite: false }));
    this.buildArch();
    this.placeFans();
  }

  // ── Частицы: один общий список, каждая — свой меш со скоростью и сроком жизни ─────
  emit(geo, m, x, y, z, vx, vy, vz, life, o = {}) {
    if (this.parts.length > 420) return;
    const mesh = new THREE.Mesh(geo, o.ownMat ? m.clone() : m);
    mesh.position.set(x, y, z); if (o.flat) mesh.rotation.x = -Math.PI / 2;
    if (o.scale) mesh.scale.setScalar(o.scale);
    this.group.add(mesh);
    this.parts.push({ mesh, vx, vy, vz, life, max: life, g: o.g ?? 0, grow: o.grow ?? 0, fade: o.fade, spin: o.spin, onDie: o.onDie });
  }

  // Искры при ударе о стену: со стороны удара, разлетаются и падают
  sparks(b, hit) {
    const [nx, nz] = b.hitN || [0, 0], r = b.s.radius, n = Math.min(14, 4 + Math.round(hit));
    const x = b.x - nx * r, z = b.z - nz * r, y = (b.mesh?.position.y || 0) + 0.6;
    for (let k = 0; k < n; k++) this.emit(this.geo.s, this.mats.spark, x, y, z, nx * rnd(2, 8) + rnd(-4, 4), rnd(3, 8), nz * rnd(2, 8) + rnd(-4, 4), rnd(0.25, 0.5), { g: 30 });
  }

  // Конфетти и салют на финише вокруг точки (x, z)
  celebrate(x, z) {
    for (let k = 0; k < 140; k++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(4, 14);
      this.emit(this.geo.conf, this.confMats[k % this.confMats.length], x, rnd(2, 4), z, Math.cos(a) * sp, rnd(10, 22), Math.sin(a) * sp, rnd(2.2, 3.4), { g: 14, spin: [rnd(-8, 8), rnd(-8, 8)] });
    }
    for (let k = 0; k < 5; k++) setTimeout(() => this.rocket(x + rnd(-25, 25), z + rnd(-30, 5)), k * 380);
  }

  rocket(x, z) {
    const m = this.fireMats[Math.floor(Math.random() * this.fireMats.length)];
    this.emit(this.geo.s, this.mats.spark, x, 1, z, rnd(-1, 1), 34, rnd(-1, 1), 0.85, { g: 18, scale: 2, onDie: p => {
      const { x: px, y: py, z: pz } = p.mesh.position;
      for (let k = 0; k < 40; k++) {
        const a = Math.random() * Math.PI * 2, e = Math.acos(rnd(-1, 1)), sp = rnd(9, 15);
        this.emit(this.geo.s, m, px, py, pz, Math.cos(a) * Math.sin(e) * sp, Math.cos(e) * sp, Math.sin(a) * Math.sin(e) * sp, rnd(0.9, 1.4), { g: 6, scale: 1.6, fade: true, ownMat: true });
      }
    } });
  }

  // ── Арка над стартом: столбы, клетчатый баннер, светофор из трёх огней ──────────────
  buildArch() {
    const t = this.track, p = t.p[0], tg = t.t[0], w = t.halfAt(0) + C.wallThick + 1.2, H = 11;
    const g = new THREE.Group(); g.position.set(p.x, 0, p.z); g.rotation.y = -Math.atan2(tg.z, tg.x); this.group.add(g);
    const post = new THREE.MeshStandardMaterial({ color: '#eeeeee', roughness: 0.5 });
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, H, 1.2), post); c.position.set(0, H / 2, s * w); c.castShadow = true; g.add(c); }
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32; const x = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i * 8, j * 8, 8, 8); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const chk = new THREE.MeshStandardMaterial({ map: tex });   // клетка — на обеих широких гранях и сверху (камера смотрит сверху)
    const banner = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, w * 2 + 1.2), [chk, chk, chk, post, post, post]);
    banner.position.y = H; banner.castShadow = true; g.add(banner);
    this.lights = [];
    const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1.6, 6), new THREE.MeshStandardMaterial({ color: '#1d1a1c' })); box.position.set(0.2, H + 2.2, 0); g.add(box);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.MeshBasicMaterial({ color: '#3a2a2a' }), l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 8), m);
      l.position.set(0.4, H + 2.2, -1.8 + k * 1.8); g.add(l); this.lights.push(m);
    }
  }

  // Светофор: n = 3, 2, 1 — зажигаются красные; 'go' — все зелёные; 0 — погасить
  startLights(n) {
    if (!this.lights) return;
    clearTimeout(this.lightsT);
    this.lights.forEach((m, k) => m.color.set(n === 'go' ? '#39ff6a' : typeof n === 'number' && n > 0 && k < 4 - n ? '#ff2d2d' : '#3a2a2a'));
    if (n === 'go') this.lightsT = setTimeout(() => this.startLights(0), 1500);
  }

  // ── Зрители по теме карты: стоят за бортиками, прыгают и машут лидеру ─────────────
  placeFans() {
    const t = this.track, S = this.scenery, n = 7;
    for (let k = 0; k < n; k++) {
      const i = t.at(Math.round((k + 0.5) / n * t.n));
      if (t.pitK(i) >= 0 || t.gap?.(i)) continue;
      for (const side of [1, -1]) {
        const [cx, , cz] = t.edge(i, side * (t.halfAt(i) + C.wallThick + 7));
        const spot = S?.findSpot ? S.findSpot(cx, cz, 8, 5, 3, 4, false) : { x: cx, z: cz };
        if (!spot) continue;
        for (let j = 0; j < 3; j++) this.fan(spot.x + rnd(-1.6, 1.6), spot.z + rnd(-1, 1), t.at(i + j));
        break;
      }
    }
  }

  fan(x, z, seg) {
    const theme = this.mapId, g = new THREE.Group(); g.position.set(x, 0, z); this.group.add(g);
    const col = CONFETTI[Math.floor(Math.random() * 5)];
    const M = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 });
    let body;
    if (theme === 'kitchen') {        // чашка с ручкой
      body = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.8, 2.2, 14), M('#fafafa')); body.position.y = 1.1;
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.15, 6, 12), M('#fafafa')); h.position.set(1.05, 1.2, 0); g.add(h);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.01, 0.95, 0.4, 14), M(col)); band.position.y = 1.5; g.add(band);
    } else if (theme === 'kids') {    // кубик с лицом
      body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 1.8), M(col)); body.position.y = 0.9;
    } else {                          // маленький гном
      body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 1.8, 10), M('#1e88e5')); body.position.y = 0.9;
      const hat = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 10), M(col)); hat.position.y = 3.1; g.add(hat);
      const beard = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.1, 8), M('#fafafa')); beard.rotation.x = Math.PI; beard.position.set(0, 1.7, 0.35); g.add(beard);
    }
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), M(theme === 'garden' ? '#ffccbc' : '#ffe0b2')); head.position.y = theme === 'kitchen' ? 2.6 : 2.3; g.add(head);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), M('#212121')); e.position.set(s * 0.22, head.position.y + 0.1, 0.52); g.add(e); }
    const arms = [-1, 1].map(s => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 5), M(col)); a.geometry.translate(0, 0.6, 0); a.position.set(s * 0.9, 1.6, 0); g.add(a); return a; });
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    // лицом к трассе
    const p = this.track.p[seg]; g.rotation.y = Math.atan2(p.x - x, p.z - z);
    this.fans.push({ g, arms, seg, x, z, ph: Math.random() * 6, cheer: 0 });
  }

  // ── Погода и время суток: rain — дождь, blackout — темно и фары, party — прожекторы и конфетти, bubbles — пузыри ──
  setMode(mode) {
    this.mode = mode;
    this.setRain(mode === 'rain');
    // фары: свет-«конус» на дороге перед каждым роботом и настоящий прожектор у игрока
    if (mode === 'blackout' && !this.spot) {
      // фара игрока — настоящий прожектор с тенью: стенки загораживают свет, за бортик он не попадает
      const sp = this.spot = new THREE.SpotLight('#fff1c9', 320, 48, 0.5, 0.6, 1.3);
      sp.castShadow = true; sp.shadow.mapSize.set(1024, 1024); sp.shadow.bias = -0.002; sp.shadow.camera.near = 0.5;
      this.group.add(sp, sp.target);
      this.runway();
    }
    if (mode !== 'blackout' && this.spot) { this.group.remove(this.spot, this.spot.target); this.spot = null; if (this.lightsRow) { this.group.remove(this.lightsRow); this.lightsRow = null; } }
    // лучи фар на дороге: в темноте — чёткий конус, вечером — тусклое рассеянное пятно
    const beam = mode === 'blackout' ? 'sharp' : mode === 'evening' ? 'soft' : null;
    if (beam !== this.beamMode) {
      for (const m of this.beams?.values() || []) this.group.remove(m);
      this.beams = new Map(); this.beamMode = beam;
      if (beam) {
        const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const x = cv.getContext('2d');
        if (beam === 'sharp') {
          const gr = x.createLinearGradient(0, 128, 0, 0); gr.addColorStop(0, 'rgba(255,240,200,.75)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
          x.fillStyle = gr; x.beginPath(); x.moveTo(26, 128); x.lineTo(38, 128); x.lineTo(64, 0); x.lineTo(0, 0); x.fill();
        } else {
          // вечерняя фара: узкий конус от робота (остриё внизу текстуры), тусклый и с размытыми краями —
          // рисуем несколько всё более узких треугольников с маленькой прозрачностью, свет гаснет к дальнему концу
          for (let k = 0; k < 7; k++) {
            const w = 30 - k * 4, gr = x.createLinearGradient(0, 128, 0, 0);
            gr.addColorStop(0, 'rgba(255,228,170,.16)'); gr.addColorStop(0.6, 'rgba(255,220,160,.08)'); gr.addColorStop(1, 'rgba(255,215,150,0)');
            x.fillStyle = gr; x.beginPath(); x.moveTo(31, 128); x.lineTo(33, 128); x.lineTo(32 + w, 0); x.lineTo(32 - w, 0); x.fill();
          }
        }
        this.beamTex = new THREE.CanvasTexture(cv);
      }
    }
    // вечеринка: три цветных прожектора кружат над камерой
    if (mode === 'party' && !this.party) {
      this.party = ['#ff3bd4', '#3bc8ff', '#ffe03b'].map(c => { const l = new THREE.PointLight(c, 160, 60, 1.6); this.group.add(l); return l; });
    }
    if (mode !== 'party' && this.party) { for (const l of this.party) this.group.remove(l); this.party = null; }
    // пузыри: летают над трассой вокруг камеры
    if (mode === 'bubbles' && !this.bubbles) {
      this.bubbles = [];
      const geo = new THREE.SphereGeometry(1, 16, 12);
      const shine = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
      for (let k = 0; k < 44; k++) {
        // плёнка пузыря: светлая, с переливом оттенка; сверху сбоку — яркий блик
        const h = Math.random(), m = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(h, 0.9, 0.75), emissive: new THREE.Color().setHSL((h + 0.3) % 1, 1, 0.55), emissiveIntensity: 0.45, roughness: 0.05, transparent: true, opacity: 0.42, depthWrite: false });
        const b = new THREE.Mesh(geo, m); b.scale.setScalar(rnd(1.1, 2.4)); this.group.add(b);
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), shine); hl.position.set(-0.45, 0.5, 0.45); b.add(hl);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL((h + 0.5) % 1, 1, 0.7), transparent: true, opacity: 0.6, depthWrite: false }));
        rim.rotation.x = -1.1; b.add(rim);
        this.bubbles.push({ m: b, ox: rnd(-60, 60), oz: rnd(-45, 45), y: rnd(1, 14), vy: rnd(0.6, 1.6), ph: Math.random() * 6 });
      }
    }
    if (mode !== 'bubbles' && this.bubbles) { for (const b of this.bubbles) this.group.remove(b.m); this.bubbles = null; }
  }

  // Огоньки вдоль бортиков, как на взлётной полосе: в темноте видно, куда поворачивает трасса
  runway() {
    const t = this.track, spots = [];
    for (let i = 0; i < t.n; i += 4) {
      if (t.gap?.(i)) continue;
      for (const s of [1, -1]) {
        const off = s > 0 ? Math.max(t.halfAt(i), t.pitOff(i) + t.ph) + C.wallThick / 2 : -(t.halfAt(i) + C.wallThick / 2);
        spots.push(t.edge(i, off, C.wallHeight + 0.15));
      }
    }
    const geo = new THREE.SphereGeometry(0.28, 6, 4), m = new THREE.MeshBasicMaterial({ color: '#ffb347' });
    const inst = new THREE.InstancedMesh(geo, m, spots.length), M4 = new THREE.Matrix4();
    spots.forEach(([x, y, z], k) => inst.setMatrixAt(k, M4.makeTranslation(x, y, z)));
    inst.computeBoundingSphere(); this.group.add(inst); this.lightsRow = inst; this.runwayMat = m;
  }

  // В темноте всё, что бросают и запускают (ракеты, мусор, пробки, кожуры, пена), светится и окружено ореолом —
  // иначе не видно, что летит в тебя. group — группа снарядов из weapons.js
  glowWeapons(group, now) {
    if (!group) return;
    if (!this.haloTex) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d');
      const g = x.createRadialGradient(32, 32, 2, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,190,120,.6)'); g.addColorStop(1, 'rgba(255,120,60,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); this.haloTex = new THREE.CanvasTexture(cv);
    }
    for (const c of group.children) {
      if (!c.userData.halo) {
        c.traverse(o => { if (o.isMesh && o.material?.emissive && !o.userData.glow) { o.material = o.material.clone(); o.material.emissive.copy(o.material.color); o.material.emissiveIntensity = 0.9; o.userData.glow = true; } });
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.haloTex, color: '#ffb36b', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        s.scale.setScalar(5); s.position.y = 1; c.add(s); c.userData.halo = s;
      }
      // ореол пульсирует — так летящее заметнее
      c.userData.halo.material.opacity = 0.65 + 0.35 * Math.sin(now * 10 + c.id);
    }
  }

  // Каждый кадр — части погоды, которые двигаются
  updateMode(dt, now, bots, cam) {
    if (this.mode === 'blackout') this.glowWeapons(this.weaponsGroup, now);
    if (this.spot) {
      const p = bots[0];
      if (p?.mesh.visible) {
        const y = p.mesh.position.y, c = Math.cos(p.a), s = Math.sin(p.a);
        this.spot.position.set(p.x + c * 0.5, y + 4, p.z + s * 0.5); this.spot.target.position.set(p.x + c * 16, y, p.z + s * 16);
      }
    }
    if (this.beamMode) {
      const soft = this.beamMode === 'soft', seen = new Set();
      for (const b of bots) {
        if (!b.mesh.visible) continue;
        let m = this.beams.get(b);
        if (!m) {
          // луч на дороге: короткий и узкий, чтобы не вылезал за бортики
          const [w, l] = soft ? [6, 13] : [5, 10];
          m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), new THREE.MeshBasicMaterial({ map: this.beamTex, transparent: true, opacity: soft ? 0.8 : 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
          m.geometry.rotateX(-Math.PI / 2); m.geometry.translate(0, 0, -l / 2); this.group.add(m); this.beams.set(b, m);
        }
        m.position.set(b.x + Math.cos(b.a) * b.s.radius, b.mesh.position.y + 0.12, b.z + Math.sin(b.a) * b.s.radius);
        m.rotation.y = -b.a - Math.PI / 2; seen.add(b);
      }
      for (const [b, m] of this.beams) if (!seen.has(b)) { this.group.remove(m); this.beams.delete(b); }
    }
    if (this.party && cam) {
      this.party.forEach((l, k) => { const a = now * (0.7 + k * 0.25) + k * 2.1; l.position.set(cam.x + Math.cos(a) * 26, 14, cam.z + Math.sin(a) * 20); });
      this.confT = (this.confT || 0) - dt;
      if (this.confT <= 0) { this.confT = 0.06; this.emit(this.geo.conf, this.confMats[Math.floor(Math.random() * this.confMats.length)], cam.x + rnd(-45, 45), 26, cam.z + rnd(-35, 35), rnd(-1, 1), -4, rnd(-1, 1), 5, { g: 0, spin: [rnd(-6, 6), rnd(-6, 6)] }); }
    }
    if (this.bubbles && cam) {
      for (const B of this.bubbles) {
        B.y += B.vy * dt; if (B.y > 12) { B.y = 0.5; B.ox = rnd(-60, 60); B.oz = rnd(-45, 45); B.m.visible = true; }
        const x = cam.x + B.ox + Math.sin(now * 0.7 + B.ph) * 3, z = cam.z + B.oz + Math.cos(now * 0.5 + B.ph) * 2;
        B.m.position.set(x, B.y, z);
        // робот задел пузырь — лопается брызгами
        if (B.m.visible && B.y < 4) for (const b of bots) if (Math.hypot(b.x - x, b.z - z) < b.s.radius + B.m.scale.x) {
          B.m.visible = false;
          for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28; this.emit(this.geo.s, this.mats.spray, x, B.y, z, Math.cos(a) * 5, rnd(1, 4), Math.sin(a) * 5, 0.35, { g: 10 }); }
          break;
        }
      }
    }
  }

  // ── Дождь: косые капли в коробке вокруг камеры ─────────────────────────────────
  setRain(on) {
    if (!on) { if (this.rain) { this.group.remove(this.rain.mesh); this.rain = null; } return; }
    if (this.rain) return;
    const N = 1400, pos = new Float32Array(N * 6), seeds = [];
    for (let k = 0; k < N; k++) seeds.push([rnd(-90, 90), rnd(0, 60), rnd(-70, 70), rnd(0.8, 1.2)]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mesh = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#cfe3f5', transparent: true, opacity: 0.45 }));
    mesh.frustumCulled = false; this.group.add(mesh);
    this.rain = { mesh, seeds, pos };
  }

  // Каждый кадр. bots — все роботы в гонке, leader — кто первый, cam — цель камеры, wet — дождь
  update(dt, now, bots, leader, cam) {
    this.updateMode(dt, now, bots, cam);
    // частицы
    this.parts = this.parts.filter(p => {
      p.life -= dt;
      if (p.life <= 0) { p.onDie?.(p); this.group.remove(p.mesh); if (p.mesh.material !== this.mats.spark && p.fade) p.mesh.material.dispose(); return false; }
      p.vy -= p.g * dt; p.mesh.position.x += p.vx * dt; p.mesh.position.y += p.vy * dt; p.mesh.position.z += p.vz * dt;
      if (p.mesh.position.y < 0.05 && p.g > 0) { p.mesh.position.y = 0.05; p.vx *= 0.6; p.vz *= 0.6; p.vy = 0; }
      if (p.grow) p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      if (p.spin) { p.mesh.rotation.x += p.spin[0] * dt; p.mesh.rotation.y += p.spin[1] * dt; p.vx *= 1 - dt; p.vz *= 1 - dt; if (p.vy < -3) p.vy = -3; }
      if (p.fade) p.mesh.material.opacity = Math.min(1, p.life / p.max * 1.5) * (p.op ?? 0.6);
      return true;
    });
    // пыль, брызги и мокрые следы из-под роботов
    for (const b of bots) {
      if (!b.mesh.visible || b.ditch) continue;
      const fast = Math.abs(b.v) > b.s.maxSpeed * 0.7, y = b.mesh.position.y;
      b.fxT = (b.fxT || 0) - dt;
      if (b.fxT > 0 || b.air) continue;
      const bx = b.x - Math.cos(b.a) * b.s.radius, bz = b.z - Math.sin(b.a) * b.s.radius;
      if (b.wetUntil > now) {
        b.fxT = 0.07;
        this.emit(this.geo.flat, this.mats.wet, bx, y + 0.06, bz, 0, 0, 0, 3.5, { flat: true, fade: true, ownMat: true, scale: b.s.radius * 0.6 });
        this.parts.at(-1) && (this.parts.at(-1).op = 0.3);
      } else if (fast && this.rain) {
        b.fxT = 0.05;
        this.emit(this.geo.s, this.mats.spray, bx, y + 0.3, bz, rnd(-2, 2), rnd(2, 4), rnd(-2, 2), 0.4, { g: 15, scale: 1.5 });
      } else if (fast && (!this.mode || this.mode === 'day' || this.mode === 'bubbles')) {   // пыль — только при дневном свете (в сумерках она серая)
        b.fxT = 0.09;
        this.emit(this.geo.puff, this.mats.dust, bx + rnd(-0.5, 0.5), y + 0.3, bz + rnd(-0.5, 0.5), rnd(-0.5, 0.5), 0.6, rnd(-0.5, 0.5), 0.6, { grow: 1.5, fade: true, ownMat: true });
        this.parts.at(-1) && (this.parts.at(-1).op = 0.35);
      }
    }
    // зрители: обычно покачиваются, когда рядом лидер — прыгают и машут
    for (const F of this.fans) {
      if (leader && Math.hypot(leader.x - F.x, leader.z - F.z) < 26) F.cheer = 1.2;
      F.cheer = Math.max(0, F.cheer - dt);
      const c = F.cheer > 0;
      F.g.position.y = c ? Math.abs(Math.sin(now * 9 + F.ph)) * 1.4 : 0;
      F.g.rotation.z = c ? 0 : Math.sin(now * 1.5 + F.ph) * 0.05;
      F.arms.forEach((a, k) => { a.rotation.z = (k ? -1 : 1) * (c ? 2.4 + Math.sin(now * 14 + k) * 0.5 : 0.25); });
    }
    // дождь: капли падают наискосок, по кругу возвращаются наверх
    if (this.rain && cam) {
      const { seeds, pos, mesh } = this.rain;
      for (let k = 0; k < seeds.length; k++) {
        const s = seeds[k]; s[1] -= 70 * s[3] * dt; if (s[1] < 0) s[1] += 60;
        const x = cam.x + s[0] + s[1] * 0.25, z = cam.z + s[2], o = k * 6;
        pos[o] = x; pos[o + 1] = s[1]; pos[o + 2] = z; pos[o + 3] = x - 0.5; pos[o + 4] = s[1] + 2.2; pos[o + 5] = z;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
    }
  }
}
