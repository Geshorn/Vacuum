import * as THREE from 'three';
import { C } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Мусор на трассе: пыль, крошки, скрепки, монетки (виды и их вес/ценность — в C.trash.kinds).
// Робот собирает мусор, проезжая по нему (если контейнер не полон): мусор затягивается в робота,
// а через некоторое время появляется в другом месте трассы.
// Где лежит: «any» — где угодно на дороге, «risky» — у стены, чаще на внешней стороне поворотов.
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

const SHADE_MAT = new THREE.MeshBasicMaterial({ color: '#1a1216', transparent: true, opacity: 0.25, depthWrite: false });
const SHADE_GEO = new THREE.CircleGeometry(0.5, 16);
function shade(g, s) {
  const m = new THREE.Mesh(SHADE_GEO, SHADE_MAT);
  m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.scale.setScalar(s); g.add(m);
}

// ── Пыль ──────────────────────────────────────────────────────────────────────
// Текстура пушистого клубка: мягкое пятно с размытыми краями, пух по краю и тонкие волокна
function fluffTexture() {
  const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d'), c = S / 2;
  const grad = x.createRadialGradient(c, c, 0, c, c, c * 0.62);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = grad; x.fillRect(0, 0, S, S);
  // пух: много мелких полупрозрачных точек, гуще к центру
  for (let i = 0; i < 900; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * c * 0.8;
    x.fillStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.18})`;
    x.beginPath(); x.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, 0.8 + Math.random() * 2.2, 0, 7); x.fill();
  }
  // волокна: тонкие изогнутые нитки, выбивающиеся наружу
  x.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2, r0 = c * rnd(0.1, 0.45), r1 = c * rnd(0.6, 0.95), bend = rnd(-0.6, 0.6);
    x.strokeStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.4})`; x.lineWidth = rnd(0.6, 1.4);
    x.beginPath(); x.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    x.quadraticCurveTo(c + Math.cos(a + bend) * (r0 + r1) / 2, c + Math.sin(a + bend) * (r0 + r1) / 2, c + Math.cos(a + bend * 0.5) * r1, c + Math.sin(a + bend * 0.5) * r1);
    x.stroke();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const FLUFF_TEX = [fluffTexture(), fluffTexture(), fluffTexture()];
const FLUFF_COLORS = ['#a9a5b2', '#96929f', '#bcb8c4'];   // светло-серая: заметна на тёмном асфальте

// Пыль — мягкий пушистый комок «как под диваном»: несколько слоёв пуха разного оттенка и размера + тень под ним
function makeDust() {
  const g = new THREE.Group();
  shade(g, rnd(0.9, 1.2));
  const n = 3 + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const mat = new THREE.SpriteMaterial({ map: FLUFF_TEX[i % 3], color: FLUFF_COLORS[i % 3], transparent: true, depthWrite: false, rotation: rnd(0, Math.PI * 2) });
    const sp = new THREE.Sprite(mat), s = rnd(0.9, 1.4) * (i === 0 ? 1.15 : 0.85);
    sp.scale.set(s, s, 1);
    sp.position.set(rnd(-0.25, 0.25), 0.2 + i * 0.06, rnd(-0.25, 0.25));
    g.add(sp);
  }
  return g;
}

// ── Крошки ────────────────────────────────────────────────────────────────────
// Обломок с неровным краем: многоугольник со случайными «откусами», выдавленный в толщину с фаской
function chunkGeo(r, h) {
  const sh = new THREE.Shape(), n = 7 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * Math.PI * 2, rr = r * rnd(0.6, 1.05);
    i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: true, bevelThickness: h * 0.35, bevelSize: r * 0.12, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2); g.translate(0, h * 0.35, 0);
  return g;
}
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
// варианты крошек: печенье с шоколадом, хлебная корка, крекер
const CRUMB_KINDS = [
  { body: std('#d9a45a'), dots: std('#4a2a1a', { roughness: 0.6 }), dotN: 4, crumbs: std('#e8bb72') },   // печенье
  { body: std('#c77f3a'), dots: std('#f2dfb5'), dotN: 3, crumbs: std('#e9c99a') },                       // хлеб: корка и мякиш
  { body: std('#efce82'), dots: std('#b8893f'), dotN: 5, crumbs: std('#f6dc9c') },                       // крекер с дырочками
];
const DOT_GEO = new THREE.SphereGeometry(1, 8, 6), BIT_GEO = new THREE.DodecahedronGeometry(1, 0);

function makeCrumbs() {
  const g = new THREE.Group(), K = pick(CRUMB_KINDS);
  shade(g, rnd(1.1, 1.4));
  // 1–2 крупных обломка
  const big = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < big; i++) {
    const r = rnd(0.45, 0.6) * (i ? 0.7 : 1), h = rnd(0.12, 0.2);
    const m = new THREE.Mesh(chunkGeo(r, h), K.body);
    m.position.set(i ? rnd(-0.6, 0.6) : 0, 0, i ? rnd(-0.6, 0.6) : 0);
    m.rotation.set(rnd(-0.15, 0.15), rnd(0, 6.3), rnd(-0.15, 0.15)); m.castShadow = true; g.add(m);
    // кусочки шоколада / мякиша / дырочки сверху
    for (let k = 0; k < K.dotN; k++) {
      const d = new THREE.Mesh(DOT_GEO, K.dots), a = rnd(0, 6.3), rr = r * rnd(0, 0.6), s = r * rnd(0.12, 0.2);
      d.scale.set(s, s * 0.5, s); d.position.set(Math.cos(a) * rr, h * 1.3 + 0.02, Math.sin(a) * rr); m.add(d);
    }
  }
  // мелкие крошки вокруг
  for (let i = 0; i < 11; i++) {
    const s = rnd(0.05, 0.12), m = new THREE.Mesh(BIT_GEO, i % 3 ? K.crumbs : K.body), a = rnd(0, 6.3), rr = rnd(0.5, 1.05);
    m.scale.set(s, s * 0.7, s); m.position.set(Math.cos(a) * rr, s * 0.5, Math.sin(a) * rr); m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    g.add(m);
  }
  return g;
}

// ── Скрепка ───────────────────────────────────────────────────────────────────
// Настоящая форма: проволока из трёх прямых и трёх полукруглых загибов, лежит на боку
const CLIP_MATS = ['#e7edf5', '#7fc4ff', '#ff8a8a', '#ffd166'].map((c, i) =>
  new THREE.MeshStandardMaterial({ color: c, metalness: i ? 0.3 : 0.9, roughness: i ? 0.4 : 0.2, emissive: i ? '#000' : '#3a4048' }));
function clipCurve() {
  const p = new THREE.CurvePath(), V = (x, y) => new THREE.Vector3(x, y, 0);
  const W = 1.0, R1 = 0.22, R2 = 0.16, R3 = 0.1;   // длина и радиусы загибов
  const arcCurve = (cx, cy, r, a0, a1) => { const pts = []; for (let i = 0; i <= 10; i++) { const a = a0 + (a1 - a0) * i / 10; pts.push(V(cx + Math.cos(a) * r, cy + Math.sin(a) * r)); } return new THREE.CatmullRomCurve3(pts); };
  // внешняя петля → средняя → внутренняя
  p.add(new THREE.LineCurve3(V(-W * 0.35, -R1 + 0.06), V(W * 0.5, -R1 + 0.06)));
  p.add(arcCurve(W * 0.5, 0.06, R1, -Math.PI / 2, Math.PI / 2));
  p.add(new THREE.LineCurve3(V(W * 0.5, R1 + 0.06), V(-W * 0.5, R1 + 0.06)));
  p.add(arcCurve(-W * 0.5, R1 + 0.06 - R2, R2, Math.PI / 2, Math.PI * 1.5));
  p.add(new THREE.LineCurve3(V(-W * 0.5, R1 + 0.06 - 2 * R2), V(W * 0.36, R1 + 0.06 - 2 * R2)));
  p.add(arcCurve(W * 0.36, R1 + 0.06 - 2 * R2 + R3, R3, -Math.PI / 2, Math.PI / 2));
  p.add(new THREE.LineCurve3(V(W * 0.36, R1 + 0.06 - 2 * R2 + 2 * R3), V(-W * 0.2, R1 + 0.06 - 2 * R2 + 2 * R3)));
  return p;
}
const CLIP_GEO = new THREE.TubeGeometry(clipCurve(), 90, 0.045, 6, false);
CLIP_GEO.rotateX(-Math.PI / 2);

function makeClip() {
  const g = new THREE.Group();
  shade(g, 0.8);
  const m = new THREE.Mesh(CLIP_GEO, Math.random() < 0.6 ? CLIP_MATS[0] : pick(CLIP_MATS));
  m.scale.setScalar(1.3); m.position.y = 0.08; m.castShadow = true; g.add(m);
  g.userData.spin = m;
  return g;
}

// ── Монетка ───────────────────────────────────────────────────────────────────
const COIN_MAT = new THREE.MeshStandardMaterial({ color: '#ffc93c', metalness: 0.85, roughness: 0.25, emissive: '#6a4200' });
const COIN_EDGE = new THREE.MeshStandardMaterial({ color: '#d99a1e', metalness: 0.85, roughness: 0.3, emissive: '#4a2c00' });
const COIN_GEO = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 28);
function makeCoin() {
  const g = new THREE.Group();
  shade(g, 0.7);
  const c = new THREE.Mesh(COIN_GEO, [COIN_EDGE, COIN_MAT, COIN_MAT]);
  c.rotation.x = Math.PI / 2; c.position.y = 0.6; c.castShadow = true;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.035, 6, 24), COIN_EDGE);   // ободок-рельеф
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.05; c.add(ring);       // в плоскости лицевой стороны
  const ring2 = ring.clone(); ring2.position.y = -0.05; c.add(ring2);
  const pivot = new THREE.Group(); pivot.add(c); g.add(pivot);
  g.userData.spin = pivot; g.userData.bob = c;
  return g;
}

// Склеить непрозрачные детали группы в один объект на материал (крошка из ~13 деталей → 2–3 объекта):
// меньше вызовов отрисовки, а сама группа по-прежнему двигается и прячется целиком
function flatten(g) {
  g.updateMatrixWorld(true);
  const by = new Map(), drop = [];
  g.traverse(o => {
    if (!o.isMesh || o.material.transparent) return;
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const n of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(n)) geo.deleteAttribute(n);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    geo.applyMatrix4(o.matrixWorld);
    if (!by.has(o.material)) by.set(o.material, []);
    by.get(o.material).push(geo); drop.push(o);
  });
  for (const o of drop) o.parent.remove(o);
  for (const [m, geos] of by) { const mesh = new THREE.Mesh(mergeGeometries(geos, false), m); mesh.castShadow = true; g.add(mesh); }
  return g;
}

// ── Батарейка ────────────────────────────────────────────────────────────────
// Пальчиковая батарейка лежит на боку, медленно крутится и светится зелёным
const BAT_BODY = new THREE.MeshStandardMaterial({ color: '#2b2a2c', metalness: 0.4, roughness: 0.35 });
const BAT_BAND = new THREE.MeshStandardMaterial({ color: '#d9a43a', metalness: 0.8, roughness: 0.25, emissive: '#5a3c00' });
const BAT_TIP = new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 0.9, roughness: 0.2 });
const BAT_GLOW = new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.45, depthWrite: false });
function makeBattery() {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.6, 24), BAT_GLOW); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.05; g.add(glow);
  const spin = new THREE.Group(); spin.position.y = 0.9; g.add(spin);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 16), BAT_BODY); body.rotation.z = Math.PI / 2; body.castShadow = true; spin.add(body);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.9, 16), BAT_BAND); band.rotation.z = Math.PI / 2; band.position.x = 0.55; spin.add(band);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 10), BAT_TIP); tip.rotation.z = Math.PI / 2; tip.position.x = 1.22; spin.add(tip);
  g.userData.spin = spin; g.userData.bob = spin; g.userData.bobBase = 0.9;
  return g;
}

const MAKERS = { battery: makeBattery, dust: makeDust, crumb: () => flatten(makeCrumbs()), clip: makeClip, coin: makeCoin };

export class Trash {
  constructor(scene, track) {
    this.track = track; this.items = [];
    this.group = new THREE.Group(); scene.add(this.group);
    this.findRiskySpots();
    for (const [kind, K] of Object.entries(C.trash.kinds)) for (let i = 0; i < K.count; i++) {
      const mesh = MAKERS[kind](); this.group.add(mesh);
      const it = { kind, mesh, alive: true, back: 0, phase: Math.random() * 6 };
      this.place(it); this.items.push(it);
    }
  }

  // Опасные места: у стены на внешней стороне поворотов (чем круче поворот, тем чаще туда кладём)
  findRiskySpots() {
    const t = this.track, n = t.n, k = 6;
    this.risky = [];
    for (let i = 0; i < n; i++) {
      if (t.pitK(i) >= 0) continue;   // у пит-лейна не кладём — там стенка с проёмом
      const a = t.t[t.at(i - k)], b = t.t[t.at(i + k)];
      const turn = a.x * b.z - a.z * b.x;                 // > 0 — поворот вправо по ходу (в сторону −нормали)
      const outside = turn > 0 ? 1 : -1;                  // внешняя сторона поворота
      const w = Math.min(1, Math.abs(turn) * 4);          // насколько крутой поворот
      this.risky.push({ i, side: outside, w: 0.15 + w });
    }
    this.riskyW = this.risky.reduce((s, r) => s + r.w, 0);
  }

  pickRisky() {
    let x = Math.random() * this.riskyW;
    for (const r of this.risky) { x -= r.w; if (x <= 0) return r; }
    return this.risky[0];
  }

  // Новое место для мусора
  place(it) {
    const t = this.track, K = C.trash.kinds[it.kind];
    let i, off;
    if (K.spot === 'risky') { const r = this.pickRisky(); i = r.i; off = r.side * (t.half - rnd(1.2, 1.7)); }
    else { i = Math.floor(Math.random() * t.n); off = rnd(-1, 1) * (t.half - 1.5); }
    const [x, , z] = t.edge(i, off);
    it.x = x; it.z = z; it.alive = true; it.anim = null;
    it.mesh.position.set(x, 0, z); it.mesh.rotation.y = rnd(0, Math.PI * 2); it.mesh.scale.setScalar(1); it.mesh.visible = true;
  }

  reset() { for (const it of this.items) this.place(it); }

  // bots — роботы, которые собирают мусор (у кого контейнер полон или кто выбыл — не собирают).
  // Возвращает собранное за кадр: [{ bot, kind }].
  update(t, dt, bots = []) {
    const got = [], A = C.trash.suckTime;
    const active = bots.filter(b => b && b.mesh.visible);
    for (const it of this.items) {
      // анимация затягивания: мусор летит к роботу, который его собрал, уменьшается и чуть подлетает
      if (it.anim) {
        const a = it.anim; a.t += dt;
        const k = Math.min(1, a.t / A), e = k * k, who = a.bot;
        if (who && who.mesh.visible) { a.x = who.x; a.z = who.z; }
        const tx = a.x, tz = a.z;
        it.mesh.position.set(a.x0 + (tx - a.x0) * e, Math.sin(k * Math.PI) * 0.8, a.z0 + (tz - a.z0) * e);
        it.mesh.scale.setScalar(1 - k * 0.9);
        it.mesh.rotation.y += dt * 12;
        if (k >= 1) { it.anim = null; it.mesh.visible = false; }
        continue;
      }
      if (!it.alive) { if (t > it.back) this.place(it); continue; }
      const u = it.mesh.userData;
      if (u.spin) u.spin.rotation.y += dt * (it.kind === 'coin' ? 2.5 : 0.8);   // монетки крутятся, скрепки поблёскивают
      if (u.bob) u.bob.position.y = (u.bobBase ?? 0.6) + Math.sin(t * 3 + it.phase) * 0.12;
      for (const bot of active) {
        if (bot.bin >= 100 && it.kind !== 'battery') continue;   // полный контейнер — мусор не берёт (батарейки — можно)
        const r = bot.magnetUntil > t ? C.weapons.magnet.radius : bot.s.radius + 0.4;   // магнит тянет издалека
        if ((it.x - bot.x) ** 2 + (it.z - bot.z) ** 2 < r * r) {
          it.alive = false;
          it.anim = { t: 0, x0: it.x, z0: it.z, x: bot.x, z: bot.z, bot };
          it.back = t + rnd(C.trash.respawn[0], C.trash.respawn[1]);
          got.push({ bot, kind: it.kind });
          break;
        }
      }
    }
    return got;
  }
}
