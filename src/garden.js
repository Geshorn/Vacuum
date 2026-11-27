import * as THREE from 'three';
import { Kitchen, mat, DEPTH, rnd2 } from './kitchen.js';
import { C } from './config.js';

/* Сад: газон, деревянный забор с живой изгородью, сарай, теплица, пруд с рыбками, яблони, грядки, гномы.
   На трассе — тоннель сквозь травяной холм (робот пропадает из виду) и дождеватели: крутящаяся струя
   воды сбивает сцепление — кого окатило, того заносит. Расстановка — как у кухни (наследуем Kitchen). */

const G = {
  grass: mat('#6dbb4f', { roughness: 1 }), grassDark: mat('#4e9a3a', { roughness: 1 }), hedge: mat('#3f8a3a', { roughness: 1, flatShading: true }),
  fence: mat('#f1e6d3', { roughness: 0.8 }), wood: mat('#a8743f', { roughness: 0.8 }), woodDark: mat('#6e4a2b', { roughness: 0.85 }),
  stone: mat('#b9b3a8', { roughness: 0.9, flatShading: true }), soil: mat('#5a3d27', { roughness: 1 }),
  red: mat('#e53935', { roughness: 0.5 }), white: mat('#fafafa', { roughness: 0.5 }), blue: mat('#1e88e5', { roughness: 0.4 }),
  yellow: mat('#fdd835', { roughness: 0.5 }), orange: mat('#fb8c00', { roughness: 0.5 }), pink: mat('#f06292', { roughness: 0.6 }),
  purple: mat('#8e24aa', { roughness: 0.6 }), steel: mat('#b0bec5', { metalness: 0.6, roughness: 0.35 }), black: mat('#212121', { roughness: 0.4 }),
  leaf: mat('#43a047', { roughness: 0.8, flatShading: true }), trunk: mat('#795548', { roughness: 0.9 }),
  skin: mat('#ffccbc', { roughness: 0.7 }), beard: mat('#fafafa', { roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: '#4fc3f7', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 }),
  spray: new THREE.MeshBasicMaterial({ color: '#e1f5fe', transparent: true, opacity: 0.55, depthWrite: false }),
};
const FLOWERS = [G.red, G.yellow, G.pink, G.purple, G.white, G.orange];
const pickF = () => FLOWERS[Math.floor(Math.random() * FLOWERS.length)];

const GARDEN_VIGNETTES = {
  flowerClump: [7, 6, 4], mushrooms: [6, 6, 4], gnome: [5, 5, 8], pumpkins: [9, 7, 5], rocks: [8, 6, 4],
  wateringCan: [7, 5, 5], flowerPot: [5, 5, 7], snail: [5, 4, 3], bucket: [5, 5, 5], bush: [8, 8, 7], birdBath: [6, 6, 8],
};

export class Garden extends Kitchen {
  constructor(scene, track) {
    Garden.prototype.vignettes = GARDEN_VIGNETTES;
    super(scene, track);
    this.sprinklers = this.sprinklers || [];
  }

  // ── Газон: полосы стрижки ──────────────────────────────────────────────────
  floor() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    for (let k = 0; k < 4; k++) { x.fillStyle = k % 2 ? '#6cbf4c' : '#7bcb58'; x.fillRect(k * S / 4, 0, S / 4, S); }
    for (let k = 0; k < 2600; k++) { const v = Math.random(); x.fillStyle = `rgba(${40 + v * 40},${110 + v * 60},${30 + v * 30},0.45)`; x.fillRect(Math.random() * S, Math.random() * S, 1.5, 3); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const W = 1400; tex.repeat.set(W / 60, W / 60);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    fl.rotation.x = -Math.PI / 2; fl.position.y = -0.02; fl.receiveShadow = true; this.g.add(fl);
  }

  // ── Забор: штакетник по трём сторонам, за ним — стена дома с окнами (север) ─────────
  walls() {
    const { x0, x1, z0, z1 } = this.room;
    const fenceRun = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.floor(L / 2.2), ang = Math.atan2(bz - az, bx - ax);
      const g = new THREE.Group(); g.position.set(ax, 0, az); g.rotation.y = -ang; this.g.add(g);
      for (let k = 0; k <= n; k++) {
        const p = this.box(1.4, 8, 0.4, G.fence, k * 2.2, 4, 0, g);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1, 4), G.fence); tip.rotation.y = Math.PI / 4; tip.position.set(k * 2.2, 8.5, 0); g.add(tip);
      }
      for (const y of [2.5, 6]) this.box(L, 0.8, 0.3, G.fence, L / 2, y, -0.35, g);
    };
    fenceRun(x0, z0, x1, z0); fenceRun(x0, z1, x0, z0); fenceRun(x1, z0, x1, z1);
    // стена дома за северным забором
    const H = 40, house = this.box(x1 - x0 + 60, H, 4, mat('#f3d9b1', { roughness: 0.9 }), (x0 + x1) / 2, H / 2, z0 - 14, this.g, false);
    for (let k = 0; k < 5; k++) {
      const wx = x0 + (x1 - x0) * (k + 0.5) / 5;
      this.box(14, 14, 0.6, new THREE.MeshStandardMaterial({ color: '#a7d8ff', emissive: '#7ec4ff', emissiveIntensity: 0.25 }), wx, 22, z0 - 11.8, this.g, false);
      this.box(15.5, 1.2, 1.2, G.white, wx, 14.6, z0 - 11.6, this.g, false);
      for (const s of [-1, 1]) this.box(3, 15, 0.5, G.blue, wx + s * 9, 22, z0 - 11.6, this.g, false);   // ставни
    }
    this.box(x1 - x0 + 60, 2, 8, mat('#8d6e63', { roughness: 0.9 }), (x0 + x1) / 2, H + 1, z0 - 14, this.g, false);
  }

  // ── Вдоль забора: живая изгородь, клумбы, сарай, теплица, поленница, компост ─────
  wallRun(parent, from, to, kinds) {
    let x = from, k = 0;
    while (x < to - 6) {
      const kind = kinds[k++ % kinds.length], w = Math.min({ hedgeRow: 16, flowerBed: 14, shed: 18, greenhouse: 20, woodpile: 12, compost: 10, sunflowers: 12 }[kind], to - x);
      if (w < 8) break;
      this[kind](parent, x + w / 2, w);
      x += w + 1;
    }
  }

  hedgeRow(p, x, w) {
    for (let k = 0; k < Math.ceil(w / 4); k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(3 + Math.random(), 1), G.hedge);
      b.position.set(x - w / 2 + 2 + k * 4, 3.4 + Math.random(), -0.5); b.scale.set(1, 0.95, 0.8); b.castShadow = true; p.add(b);
    }
  }

  flowerBed(p, x, w) {
    this.box(w, 1.2, DEPTH - 2, G.wood, x, 0.6, 0, p);
    this.box(w - 0.8, 0.4, DEPTH - 2.8, G.soil, x, 1.3, 0, p);
    for (let k = 0; k < w * 1.2; k++) this.flower(p, x + rnd2(-w / 2 + 1, w / 2 - 1), 1.4, rnd2(-2.5, 2.5), pickF(), rnd2(1.5, 3));
  }

  flower(p, x, y, z, m, h = 2) {
    this.cyl(0.08, 0.08, h, G.leaf, x, y + h / 2, z, p, 4);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), m); head.position.set(x, y + h + 0.2, z); head.scale.y = 0.6; p.add(head);
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), G.yellow); c.position.set(x, y + h + 0.38, z); p.add(c);
  }

  sunflowers(p, x, w) {
    for (let k = 0; k < 4; k++) {
      const fx = x - w / 2 + 1.5 + k * (w - 3) / 3, h = 12 + Math.random() * 5;
      this.cyl(0.25, 0.3, h, G.leaf, fx, h / 2, 0, p, 6);
      const head = this.cyl(1.8, 1.8, 0.5, G.yellow, fx, h, 1, p, 16); head.rotation.x = 1.2;
      const c = this.cyl(0.9, 0.9, 0.6, G.woodDark, fx, h + 0.1, 1.2, p, 12); c.rotation.x = 1.2;
      for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), G.leaf); l.scale.set(1.4, 0.2, 0.7); l.position.set(fx + s * 1.2, h * 0.5, 0); l.rotation.z = s * 0.5; p.add(l); }
    }
  }

  shed(p, x, w) {
    this.box(w, 16, DEPTH - 1, mat('#8d6e63', { roughness: 0.9 }), x, 8, 0, p);
    for (let k = 0; k < w / 1.6; k++) this.box(0.15, 16, 0.2, G.woodDark, x - w / 2 + k * 1.6, 8, DEPTH / 2 - 0.4, p);
    const roof = this.box(w + 2, 0.8, DEPTH + 2, mat('#5d4037'), x, 16.8, 0, p); roof.rotation.x = 0.15;
    this.box(5, 11, 0.4, G.woodDark, x, 5.5, DEPTH / 2 - 0.2, p);
    this.cyl(0.3, 0.3, 0.5, G.yellow, x + 1.8, 5.5, DEPTH / 2, p, 8).rotation.x = Math.PI / 2;
    this.box(4, 4, 0.3, mat('#b3e5fc', { emissive: '#81d4fa', emissiveIntensity: 0.3 }), x + w / 2 - 3.5, 10, DEPTH / 2 - 0.2, p, false);
    // у сарая — грабли и лопата
    for (const [dx, m] of [[-w / 2 - 1, G.wood], [-w / 2 - 2.5, G.steel]]) { const st = this.cyl(0.15, 0.15, 11, G.wood, x + dx, 5.5, DEPTH / 2 - 1, p, 6); st.rotation.x = -0.15; this.box(2, 0.4, 0.4, m, x + dx, 11, DEPTH / 2 - 1.9, p); }
  }

  greenhouse(p, x, w) {
    const glass = new THREE.MeshStandardMaterial({ color: '#e0f7fa', transparent: true, opacity: 0.35, roughness: 0.05, depthWrite: false });
    this.box(w, 10, DEPTH - 1, glass, x, 5, 0, p, false);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.01, (DEPTH - 1) / 1.4, w, 4, 1, true), glass);
    roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 4; roof.scale.set(1, 1, 0.5); roof.position.set(x, 12, 0); p.add(roof);
    for (let k = 0; k <= 5; k++) { this.box(0.3, 10, 0.3, G.white, x - w / 2 + k * w / 5, 5, DEPTH / 2 - 0.6, p); this.box(0.3, 10, 0.3, G.white, x - w / 2 + k * w / 5, 5, -DEPTH / 2 + 0.6, p); }
    this.box(w, 0.3, 0.3, G.white, x, 10, DEPTH / 2 - 0.6, p);
    for (let k = 0; k < 6; k++) {                           // помидоры внутри
      const tx = x - w / 2 + 2 + k * (w - 4) / 5;
      this.cyl(0.15, 0.15, 6, G.leaf, tx, 3, 0, p, 4);
      for (let j = 0; j < 3; j++) { const t = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), G.red); t.position.set(tx + rnd2(-0.6, 0.6), 2 + j * 1.5, rnd2(-0.6, 0.6)); p.add(t); }
    }
  }

  woodpile(p, x, w) {
    for (let r = 0; r < 4; r++) for (let k = 0; k < Math.floor(w / 1.6) - r; k++) {
      const l = this.cyl(0.75, 0.75, DEPTH - 2, k % 2 ? G.wood : G.trunk, x - w / 2 + 1 + k * 1.6 + r * 0.8, 0.75 + r * 1.35, 0, p, 8); l.rotation.x = Math.PI / 2;
    }
  }

  compost(p, x, w) {
    this.box(w, 7, DEPTH - 2, mat('#2e7d32', { roughness: 0.7 }), x, 3.5, 0, p);
    for (let k = 0; k < 4; k++) this.box(w + 0.2, 0.3, DEPTH - 1.8, mat('#1b5e20'), x, 1 + k * 1.7, 0, p);
    this.box(w - 1, 0.4, DEPTH - 3, G.soil, x, 7.2, 0, p);
  }

  northRun() {
    const R = this.room, p = this.group(0, R.z0 + DEPTH / 2);
    this.wallRun(p, R.x0 + DEPTH, R.x1 - DEPTH, ['shed', 'flowerBed', 'hedgeRow', 'greenhouse', 'sunflowers', 'flowerBed', 'woodpile', 'hedgeRow']);
  }
  westRun() {
    const R = this.room, p = this.group(R.x0 + DEPTH / 2, 0, Math.PI / 2);
    this.wallRun(p, -(R.z1 - 25), -(R.z0 + DEPTH), ['hedgeRow', 'flowerBed', 'compost', 'sunflowers', 'hedgeRow']);
  }
  eastRun() {
    const R = this.room, p = this.group(R.x1 - DEPTH / 2, 0, -Math.PI / 2);
    this.wallRun(p, R.z0 + DEPTH, R.z1 - 25, ['flowerBed', 'hedgeRow', 'woodpile', 'sunflowers', 'flowerBed']);
  }

  // ── Внутри: холм с тоннелем, дождеватели, пруд, деревья, мебель для отдыха ─────
  placeInterior() {
    const R = this.room, t = this.track;
    if (t.tunnel) this.tunnelLog(t.tunnel);
    if (t.jump?.ditch) this.gapPond(t.jump);
    this.sprinklers = [];
    const cx = t.p.reduce((s, p) => s + p.x, 0) / t.n, cz = t.p.reduce((s, p) => s + p.z, 0) / t.n;
    const list = [
      ['pond', cx, cz, 70, 30, 22, 1, false],
      ['appleTree', cx - 40, cz - 10, 60, 16, 16, 26, false],
      ['appleTree', cx + 40, cz + 20, 60, 16, 16, 26, false],
      ['picnic', cx, cz + 30, 60, 22, 16, 8],
      ['wheelbarrow', cx + 30, cz - 30, 50, 12, 7, 6],
      ['hoseReel', cx - 30, cz + 40, 50, 6, 6, 6],
      ['sunLounger', R.x0 + 30, R.z1 - 40, 40, 18, 8, 12],
      ['bbq', R.x1 - 30, R.z1 - 40, 40, 8, 8, 10],
      ['birdBath', cx + 10, cz - 40, 50, 6, 6, 8],
      ['gnomeFamily', cx - 20, cz - 40, 50, 12, 6, 8],
      ['appleTree', R.x0 + 25, cz, 30, 16, 16, 26, false],
      ['appleTree', R.x1 - 25, cz + 30, 30, 16, 16, 26, false],
    ];
    for (const [fn, x, z, rad, w, d, h, align = true] of list) this.put(fn, this.findSpot(x, z, rad, w, d, h, align));
    this.placeSprinklers();
    this.placeVignettes();
  }

  // Тоннель — поваленный ствол дерева: полый, кора снаружи, светлая древесина внутри, годовые кольца на торцах,
  // мох и грибы сверху. Когда игрок внутри — ствол становится полупрозрачным (см. focus)
  tunnelLog(T) {
    const t = this.track, half = Math.floor(T.len / 2), Rr = t.half + C.wallThick + 1.8, yc = Rr - 1.4;
    const pts = [];
    for (let k = -half - 2; k <= half + 2; k++) { const p = t.p[t.at(T.at + k)]; pts.push(new THREE.Vector3(p.x, yc, p.z)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
    x.fillStyle = '#6d4c33'; x.fillRect(0, 0, S, S);
    for (let k = 0; k < 40; k++) { x.strokeStyle = `rgba(${30 + Math.random() * 30},${18 + Math.random() * 15},10,0.55)`; x.lineWidth = 1 + Math.random() * 3; x.beginPath(); const y = Math.random() * S; x.moveTo(0, y); x.bezierCurveTo(S * 0.3, y + rnd2(-6, 6), S * 0.7, y + rnd2(-6, 6), S, y + rnd2(-3, 3)); x.stroke(); }
    const bark = new THREE.CanvasTexture(cv); bark.wrapS = bark.wrapT = THREE.RepeatWrapping; bark.repeat.set(T.len / 6, 4); bark.colorSpace = THREE.SRGBColorSpace;
    const mats = [];
    const M = o => { const m = new THREE.MeshStandardMaterial({ roughness: 0.95, transparent: true, opacity: 1, ...o }); mats.push(m); return m; };
    const lg = new THREE.Group(); lg.userData.dynamic = true; this.g.add(lg);   // не склеивать — материалы меняют прозрачность
    const outer = new THREE.Mesh(new THREE.TubeGeometry(curve, T.len * 2, Rr, 24, false), M({ map: bark, flatShading: true }));
    outer.castShadow = true; lg.add(outer);
    lg.add(new THREE.Mesh(new THREE.TubeGeometry(curve, T.len * 2, Rr - 1.1, 24, false), M({ color: '#d7b488', side: THREE.BackSide })));
    // торцы: кольцо с годовыми кольцами
    const rc = document.createElement('canvas'); rc.width = rc.height = 128; const r = rc.getContext('2d');
    for (let k = 0; k < 10; k++) { r.fillStyle = k % 2 ? '#c9a172' : '#b08550'; r.beginPath(); r.arc(64, 64, 64 - k * 2.4, 0, 7); r.fill(); }
    const ringTex = new THREE.CanvasTexture(rc); ringTex.colorSpace = THREE.SRGBColorSpace;
    for (const u of [0, 1]) {
      const p = curve.getPointAt(u), tg = curve.getTangentAt(u);
      const ring = new THREE.Mesh(new THREE.RingGeometry(Rr - 1.1, Rr + 0.05, 32), M({ map: ringTex, side: THREE.DoubleSide }));
      ring.position.copy(p); ring.lookAt(p.clone().add(tg)); lg.add(ring);
    }
    // мох, грибы и сучок с листьями сверху
    const moss = M({ color: '#7cb342', flatShading: true }), cap = M({ color: '#ff7043' }), stem = M({ color: '#fff3e0' }), leaf = M({ color: '#43a047', flatShading: true });
    for (let k = 0; k < 9; k++) {
      const p = curve.getPointAt(0.08 + k / 10 * 0.84), m = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd2(1.5, 2.6), 0), moss);
      m.position.set(p.x + rnd2(-2, 2), p.y + Rr - 0.6, p.z + rnd2(-2, 2)); m.scale.y = 0.4; lg.add(m);
      if (k % 3 === 1) for (let j = 0; j < 3; j++) {
        const sx = p.x + rnd2(-3, 3), sz = p.z + rnd2(-3, 3), sy = p.y + Rr - 0.2;
        const st = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 1.4, 6), stem); st.position.set(sx, sy + 0.7, sz); lg.add(st);
        const c = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), cap); c.position.set(sx, sy + 1.3, sz); lg.add(c);
      }
    }
    const mid = curve.getPointAt(0.55), br = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, 9, 8), M({ map: bark }));
    br.position.set(mid.x + 2, mid.y + Rr + 3, mid.z); br.rotation.z = -0.6; lg.add(br);
    for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), leaf); l.position.set(mid.x + 5 + rnd2(-1.5, 1.5), mid.y + Rr + 7 + rnd2(-1, 1), mid.z + rnd2(-2, 2)); lg.add(l); }
    this.log = { mats, op: 1, from: t.at(T.at - half - 2), len: half * 2 + 4 };
    const c0 = t.p[t.at(T.at)];
    this.taken.push({ x: c0.x, z: c0.z, hw: T.len * C.sampleStep / 2 + 8, hd: T.len * C.sampleStep / 2 + 8, flat: false });
  }

  // Пруд в разрыве трассы за трамплином: вода шире дороги (край трамплина нависает над ней), камни по берегу,
  // камыш, кувшинки, лягушка на листе. Локальные оси: x — вдоль трассы, z — поперёк
  gapPond(J) {
    const t = this.track, step = C.sampleStep, a0 = t.at(J.at), a1 = t.at(J.at + J.ditch + 1);
    const pa = t.p[a0], pb = t.p[a1], cx = (pa.x + pb.x) / 2, cz = (pa.z + pb.z) / 2;
    const ang = Math.atan2(pb.z - pa.z, pb.x - pa.x), L = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const g = this.group(cx, cz, -ang);
    const AX = L / 2 + 2.5, AZ = t.half + C.wallThick + 7;      // вдоль: под краем трамплина и чуть под дальний берег
    const shape = new THREE.Shape(), pts = [];
    for (let k = 0; k <= 48; k++) {
      const u = k / 48 * Math.PI * 2, c = Math.cos(u), sn = Math.sin(u), n = 3.2;   // суперэллипс: почти прямоугольный пруд со скруглениями
      const r = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(sn), n), -1 / n) * (1 + Math.sin(u * 5) * 0.04);
      const px = c * r * AX, pz = sn * r * AZ; pts.push([px, pz]);
      k ? shape.lineTo(px, -pz) : shape.moveTo(px, -pz);
    }
    const S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const x = cv.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 10, 64, 64, 70); gr.addColorStop(0, '#1f6f99'); gr.addColorStop(1, '#3fa3c9'); x.fillStyle = gr; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1.5;
    for (let k = 0; k < 10; k++) { x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 6 + Math.random() * 14, 0, Math.PI * 0.8); x.stroke(); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(0.05, 0.05);
    const water = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.08, metalness: 0.15 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.06; water.receiveShadow = true; g.add(water);
    // тёмный край у берега
    const rim = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#3d2b1f', roughness: 1 }));
    rim.rotation.x = -Math.PI / 2; rim.position.y = 0.03; rim.scale.set(1.06, 1.08, 1); g.add(rim);
    // камни по берегу — кроме мест, где к пруду подходит дорога
    const road = t.half + C.wallThick + 0.5;
    pts.forEach(([px, pz], k) => {
      if (k % 2 || (Math.abs(pz) < road && Math.abs(px) > AX - 4)) return;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd2(0.9, 1.7), 0), G.stone);
      st.position.set(px * 1.04, 0.45, pz * 1.04); st.scale.y = 0.55; st.rotation.y = Math.random() * 3; st.castShadow = true; g.add(st);
    });
    // камыш по бокам
    for (const sd of [-1, 1]) for (let k = 0; k < 9; k++) {
      const rx = rnd2(-AX + 2, AX - 2), rz = sd * (AZ - rnd2(0.5, 2.5)), h = rnd2(4, 7);
      this.cyl(0.12, 0.15, h, G.leaf, rx, h / 2, rz, g, 4).rotation.z = rnd2(-0.15, 0.15);
      if (k % 2) this.cyl(0.35, 0.35, 1.4, G.woodDark, rx, h + 0.2, rz, g, 6);
    }
    // кувшинки и лягушка
    for (let k = 0; k < 6; k++) {
      const lx = rnd2(-AX + 2, AX - 2), lz = (k % 2 ? 1 : -1) * rnd2(road + 1, AZ - 2.5);
      const pad = this.cyl(1.3, 1.3, 0.08, G.leaf, lx, 0.12, lz, g, 14);
      if (k === 1) {
        const fr = new THREE.Group(); fr.position.set(lx, 0.2, lz); g.add(fr);
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), mat('#7cb342')); b.scale.set(1.2, 0.7, 1); b.position.y = 0.4; fr.add(b);
        for (const e of [-1, 1]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), G.white); eye.position.set(0.5, 0.9, e * 0.35); fr.add(eye); }
      } else if (k % 3 === 0) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.45, 8, 6), G.pink); f.position.set(lx, 0.45, lz); g.add(f); }
    }
    // круги на воде от капель
    const ringMat = new THREE.MeshBasicMaterial({ color: '#e1f5fe', transparent: true, opacity: 0.4, depthWrite: false });
    const rings = [0, 1, 2].map(k => { const r = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.7, 20), ringMat.clone()); r.rotation.x = -Math.PI / 2; r.position.set(rnd2(-AX + 3, AX - 3), 0.09, rnd2(-road, road)); r.userData.dynamic = true; g.add(r); return r; });
    this.anim.push(time => rings.forEach((r, k) => { const f = (time * 0.5 + k / 3) % 1; r.scale.setScalar(0.5 + f * 4); r.material.opacity = 0.45 * (1 - f); }));
    this.taken.push({ x: cx, z: cz, hw: AX + AZ, hd: AX + AZ, flat: false });
  }

  // Каждый кадр из main.js: игрок в стволе — ствол прозрачнеет, выехал — снова плотный
  focus(bot, dt) {
    const L = this.log; if (!L || !bot) return;
    const inside = bot.mesh.visible && ((bot.seg - L.from + this.track.n) % this.track.n) <= L.len;
    const want = inside ? 0.22 : 1;
    if (Math.abs(L.op - want) < 0.005) return;
    L.op += (want - L.op) * Math.min(1, dt * 6);
    for (const m of L.mats) { m.opacity = L.op; m.depthWrite = L.op > 0.95; }
  }

  // ── Дождеватели: стоят у бортика, струя крутится и заливает дорогу ──────────────
  placeSprinklers() {
    const t = this.track, want = 3;
    for (let k = 0; k < want; k++) {
      // ровно по кругу, не в пит-лейне, не у тоннеля и трамплина
      let i = Math.floor((k + 0.35) / want * t.n);
      for (let tries = 0; tries < 40; tries++, i = t.at(i + 7)) {
        const near = o => o && Math.abs(((i - o.at + t.n * 1.5) % t.n) - t.n / 2) < 40;
        if (t.pitK(i) < 0 && !near(t.tunnel) && !near(t.jump) && !near(t.bridge)) break;
      }
      const side = k % 2 ? 1 : -1, [x, , z] = t.edge(i, side * (t.half + C.wallThick + 2.5));
      this.sprinkler(x, z, i, side);
    }
  }

  sprinkler(x, z, seg, side) {
    const g = this.group(x, z);
    this.cyl(1.2, 1.4, 0.6, G.green || G.leaf, 0, 0.3, 0, g, 12);
    this.cyl(0.25, 0.25, 2, G.steel, 0, 1.3, 0, g, 8);
    const head = new THREE.Group(); head.position.y = 2.4; g.add(head); head.userData.dynamic = true;
    this.box(0.5, 0.5, 2.4, G.yellow, 0, 0, 0, head);
    // струя: тонкая прозрачная дуга воды, по ней бегут мелкие капли, на дороге — брызги и расходящиеся круги
    const reach = 14, arcY = f => 3 * Math.sin(f * Math.PI) * (1 - 0.3 * f) - 2.3 * f;
    const arcPts = []; for (let k = 0; k <= 20; k++) { const f = k / 20; arcPts.push(new THREE.Vector3(0, arcY(f), f * reach)); }
    const jetMat = new THREE.MeshBasicMaterial({ color: '#d6f1ff', transparent: true, opacity: 0.55, depthWrite: false });
    head.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts), 30, 0.22, 6), jetMat));
    const dropMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    const dropGeo = new THREE.SphereGeometry(0.22, 5, 4), drops = [];
    for (let k = 0; k < 26; k++) { const d = new THREE.Mesh(dropGeo, dropMat); d.userData.j = [rnd2(-0.25, 0.25), rnd2(-0.2, 0.2), Math.random()]; head.add(d); drops.push(d); }
    const splashMat = new THREE.MeshBasicMaterial({ color: '#e3f6ff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const rings = [0, 1, 2].map(() => { const r = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.85, 20), splashMat.clone()); r.rotation.x = -Math.PI / 2; head.add(r); return r; });
    const bits = []; for (let k = 0; k < 8; k++) { const b = new THREE.Mesh(dropGeo, dropMat); head.add(b); bits.push({ m: b, a: k / 8 * 6.28, ph: Math.random() }); }
    const S = { x, z, seg, head, a: 0, reach, swing: Math.random() * 6 };
    // струя качается туда-сюда поперёк трассы (как у осциллирующей поливалки)
    const t = this.track, nrm = t.nrm[seg];
    S.base = Math.atan2(-side * nrm.z, -side * nrm.x);
    const endY = arcY(1);
    this.anim.push(time => {
      S.a = S.base + Math.sin(time * 0.9 + S.swing) * 0.9;
      head.rotation.y = -S.a + Math.PI / 2;
      drops.forEach(d => {
        const [jx, jy, ph] = d.userData.j, f = (time * 1.1 + ph) % 1;
        d.position.set(jx * f * 3, arcY(f) + jy * f * 2, f * reach); d.visible = f > 0.03;
      });
      rings.forEach((r, k) => { const f = (time * 1.3 + k / 3) % 1; r.position.set(0, endY + 0.05, reach); r.scale.setScalar(0.6 + f * 2.6); r.material.opacity = 0.55 * (1 - f); });
      bits.forEach(b => { const f = (time * 2.2 + b.ph) % 1; b.m.position.set(Math.cos(b.a) * f * 1.6, endY + Math.sin(f * Math.PI) * 1.1, reach + Math.sin(b.a) * f * 1.6); });
    });
    this.sprinklers.push(S);
  }

  // Каждый кадр из main.js: кого окатило струёй — того заносит (как на пене, но слабее и без урона)
  affect(bots, now, onWet) {
    for (const S of this.sprinklers || []) {
      const fx = Math.cos(S.a), fz = Math.sin(S.a);
      for (const b of bots) {
        if (b.slipUntil + 1.2 > now) continue;                       // ещё скользит или только что выскользнул
        const dx = b.x - S.x, dz = b.z - S.z, along = dx * fx + dz * fz;
        if (along < 3 || along > S.reach + 1) continue;
        if (Math.abs(-dx * fz + dz * fx) > 2.2 + b.s.radius * 0.5) continue;   // мимо струи
        b.slipUntil = now + 0.55; b.spin = (Math.random() < 0.5 ? -1 : 1) * 2.4;
        onWet?.(b);
      }
    }
  }

  // ── Предметы ────────────────────────────────────────────────────────────────
  pond(x, z) {
    const g = this.group(x, z);
    const shape = new THREE.Shape(); for (let k = 0; k <= 24; k++) { const a = k / 24 * 6.283, r = 1 + Math.sin(a * 3) * 0.08; shape[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 13 * r, Math.sin(a) * 9 * r); }
    const water = new THREE.Mesh(new THREE.ShapeGeometry(shape), G.water); water.rotation.x = -Math.PI / 2; water.position.y = 0.15; g.add(water);
    for (let k = 0; k < 22; k++) { const a = k / 22 * 6.283, r = 1 + Math.sin(a * 3) * 0.08; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd2(1, 1.8), 0), G.stone); s.position.set(Math.cos(a) * 13.5 * r, 0.5, Math.sin(a) * 9.5 * r); s.scale.y = 0.6; s.castShadow = true; g.add(s); }
    for (let k = 0; k < 4; k++) { const l = this.cyl(1.4, 1.4, 0.1, G.leaf, rnd2(-8, 8), 0.25, rnd2(-5, 5), g, 12); if (k % 2) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), G.pink); f.position.copy(l.position); f.position.y += 0.4; g.add(f); } }
    // рыбки плавают по кругу
    const fish = [];
    for (let k = 0; k < 3; k++) { const f = new THREE.Group(); f.userData.dynamic = true; g.add(f); const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), G.orange); b.scale.set(1.6, 0.6, 0.7); f.add(b); const tl = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 4), G.orange); tl.rotation.z = Math.PI / 2; tl.position.x = -1.3; f.add(tl); fish.push(f); }
    this.anim.push(t => fish.forEach((f, k) => { const a = t * (0.5 + k * 0.15) + k * 2; f.position.set(Math.cos(a) * (5 + k * 1.5), 0.05, Math.sin(a) * (3 + k)); f.rotation.y = -a - Math.PI / 2; }));
  }

  appleTree(x, z) {
    const g = this.group(x, z);
    this.cyl(1, 1.5, 12, G.trunk, 0, 6, 0, g, 10);
    const crown = new THREE.Group(); crown.position.y = 16; g.add(crown);
    for (let k = 0; k < 10; k++) { const a = k / 10 * 6.283, r = 3 + (k % 3); const b = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 1), k % 2 ? G.leaf : G.hedge); b.position.set(Math.cos(a) * r, (k % 3) * 2 - 1.5, Math.sin(a) * r); b.castShadow = true; crown.add(b); }
    for (let k = 0; k < 10; k++) { const a = k * 0.7; const ap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), G.red); ap.position.set(Math.cos(a) * 6.5, rnd2(-2, 3), Math.sin(a) * 6.5); crown.add(ap); }
    for (let k = 0; k < 3; k++) { const ap = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), G.red); ap.position.set(rnd2(-5, 5), 0.6, rnd2(-5, 5)); g.add(ap); }   // упавшие
    this.sway(crown, 0.02, 0.6);
  }

  picnic(x, z) {
    const g = this.group(x, z), S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(0, 0, S, S); c.fillStyle = 'rgba(229,57,53,.85)'; for (let k = 0; k < S; k += 16) { c.fillRect(k, 0, 8, S); c.fillRect(0, k, S, 8); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(3, 2); tex.colorSpace = THREE.SRGBColorSpace;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(18, 0.1, 13), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 })); cloth.position.y = 0.05; cloth.receiveShadow = true; g.add(cloth);
    const basket = this.box(5, 3, 3.5, G.wood, -4, 1.6, -2, g);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.2, 6, 16, Math.PI), G.woodDark); handle.position.set(-4, 3.1, -2); g.add(handle);
    for (let k = 0; k < 3; k++) { this.cyl(1.2, 1.2, 0.2, G.white, 2 + k * 3, 0.2, 2, g, 16); const fr = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), [G.red, G.yellow, G.orange][k]); fr.position.set(2 + k * 3, 0.6, 2); g.add(fr); }
    this.cyl(0.5, 0.5, 2.6, mat('#7b1fa2', { roughness: 0.2 }), 5, 1.4, -3, g, 10);
  }

  wheelbarrow(x, z) {
    const g = this.group(x, z);
    const tub = this.box(7, 2.6, 5, G.red, 0, 3, 0, g); tub.rotation.z = 0.12;
    this.box(6.4, 0.5, 4.4, G.soil, 0, 4.1, 0, g);
    const w = this.cyl(1.4, 1.4, 0.6, G.black, 4.2, 1.4, 0, g, 14); w.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) { const h = this.cyl(0.18, 0.18, 6, G.steel, -3.5, 2.6, s * 1.8, g, 6); h.rotation.z = Math.PI / 2 - 0.3; this.cyl(0.2, 0.2, 2.6, G.steel, -1.5, 1.3, s * 1.8, g, 6); }
    for (let k = 0; k < 3; k++) { const pl = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), G.leaf); pl.position.set(-1.5 + k * 1.5, 4.8, rnd2(-1, 1)); g.add(pl); }
  }

  hoseReel(x, z) {
    const g = this.group(x, z);
    for (const s of [-1, 1]) this.box(0.4, 5, 4, G.steel, 0, 2.5, s * 1.6, g);
    const reel = this.cyl(1.8, 1.8, 3, mat('#43a047', { roughness: 0.5 }), 0, 3, 0, g, 16); reel.rotation.x = Math.PI / 2;
    const hose = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 1.5, 1.5), new THREE.Vector3(3, 0.3, 3), new THREE.Vector3(6, 0.3, 1), new THREE.Vector3(8, 0.3, 4)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(hose, 20, 0.3, 6), mat('#43a047', { roughness: 0.5 })));
  }

  sunLounger(x, z) {
    const g = this.group(x, z);
    this.box(14, 0.5, 6, G.white, 0, 2.5, 0, g);
    const back = this.box(5, 0.5, 6, G.white, -7.5, 4.5, 0, g); back.rotation.z = -0.8;
    for (let k = 0; k < 6; k++) this.box(1.6, 0.1, 6.1, G.blue, -5 + k * 2.2, 2.8, 0, g);
    for (const [lx, lz] of [[-6, -2.6], [-6, 2.6], [6, -2.6], [6, 2.6]]) this.cyl(0.2, 0.2, 2.5, G.steel, lx, 1.25, lz, g, 6);
    this.cyl(0.25, 0.25, 14, G.white, 4, 7, -5, g, 8);
    const umb = new THREE.Mesh(new THREE.ConeGeometry(8, 2.5, 8, 1, true), mat('#ff7043', { side: THREE.DoubleSide })); umb.position.set(4, 14, -5); umb.castShadow = true; g.add(umb);
  }

  bbq(x, z) {
    const g = this.group(x, z);
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), G.black); bowl.position.y = 7; g.add(bowl);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), G.black); lid.position.set(0, 7.6, -1.5); lid.rotation.x = -1.2; g.add(lid);
    for (let k = 0; k < 3; k++) { const a = k * 2.1; const l = this.cyl(0.2, 0.2, 7, G.steel, Math.cos(a) * 1.8, 3.4, Math.sin(a) * 1.8, g, 6); l.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
    for (let k = 0; k < 3; k++) { const s = this.cyl(0.35, 0.35, 3, mat('#a1452b', { roughness: 0.6 }), -1 + k, 7.2, 0, g, 8); s.rotation.z = Math.PI / 2; }
    this.steam(g, 0, 7.6, 0, 0.7);
  }

  birdBath(x, z) {
    const g = this.group(x, z);
    this.cyl(1.5, 2, 0.8, G.stone, 0, 0.4, 0, g, 12); this.cyl(0.6, 0.9, 5, G.stone, 0, 3.2, 0, g, 10);
    this.cyl(3, 2, 1, G.stone, 0, 6, 0, g, 16); this.cyl(2.6, 2.6, 0.1, G.water, 0, 6.5, 0, g, 16);
    const bird = new THREE.Group(); bird.position.set(1.8, 7, 0); g.add(bird); bird.userData.dynamic = true;
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), G.blue); b.scale.set(1.3, 1, 1); bird.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), G.blue); h.position.set(0.7, 0.5, 0); bird.add(h);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 6), G.orange); beak.rotation.z = -Math.PI / 2; beak.position.set(1.15, 0.5, 0); bird.add(beak);
    const ph = Math.random() * 6; this.anim.push(t => { bird.rotation.z = Math.max(0, Math.sin(t * 3 + ph)) * 0.5; });
  }

  // Садовый гном: колпак, борода, кирка или фонарь
  gnomeAt(parent, x, z, s, hat) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent.add(g);
    this.cyl(1.1, 1.3, 2.6, G.blue, 0, 1.3, 0, g, 12);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), G.skin); head.position.y = 3.3; g.add(head);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 10), G.beard); beard.position.set(0, 2.5, 0.5); beard.rotation.x = Math.PI; g.add(beard);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1, 2.6, 12), hat); cap.position.y = 5; cap.rotation.z = 0.15; g.add(cap);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), G.pink); nose.position.set(0, 3.3, 0.9); g.add(nose);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  }
  gnome(x, z) { const g = this.group(x, z); this.gnomeAt(g, 0, 0, 1.2, Math.random() < 0.5 ? G.red : G.purple); }
  gnomeFamily(x, z) { const g = this.group(x, z); this.gnomeAt(g, -3.5, 0, 1.3, G.red); this.gnomeAt(g, 0, 1, 1, G.yellow); this.gnomeAt(g, 3.5, 0, 1.15, G.purple); }

  flowerClump(x, z) { const g = this.group(x, z); for (let k = 0; k < 12; k++) this.flower(g, rnd2(-3, 3), 0, rnd2(-2.5, 2.5), pickF(), rnd2(1.2, 3)); }
  mushrooms(x, z) {
    const g = this.group(x, z);
    for (let k = 0; k < 4; k++) { const s = rnd2(0.6, 1.2), mx = rnd2(-2.5, 2.5), mz = rnd2(-2, 2); this.cyl(0.35 * s, 0.45 * s, 2 * s, G.white, mx, s, mz, g, 8); const cap = new THREE.Mesh(new THREE.SphereGeometry(1.2 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), G.red); cap.position.set(mx, 2 * s, mz); g.add(cap); for (let j = 0; j < 3; j++) { const d = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 6, 4), G.white); d.position.set(mx + rnd2(-0.6, 0.6) * s, 2.8 * s, mz + rnd2(-0.6, 0.6) * s); g.add(d); } }
  }
  pumpkins(x, z) {
    const g = this.group(x, z);
    for (let k = 0; k < 3; k++) { const s = rnd2(1.4, 2.4), p = new THREE.Mesh(new THREE.SphereGeometry(s, 14, 10), G.orange); p.scale.y = 0.75; p.position.set(-3 + k * 3, s * 0.75, rnd2(-1.5, 1.5)); p.castShadow = true; g.add(p); this.cyl(0.2, 0.25, 0.8, G.leaf, p.position.x, s * 1.5, p.position.z, g, 6); }
  }
  rocks(x, z) { const g = this.group(x, z); for (let k = 0; k < 5; k++) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rnd2(0.8, 2), 0), G.stone); r.position.set(rnd2(-3, 3), 0.6, rnd2(-2, 2)); r.scale.y = 0.6; r.castShadow = true; g.add(r); } }
  wateringCan(x, z) {
    const g = this.group(x, z), m = mat('#26a69a', { roughness: 0.4 });
    this.cyl(1.8, 2, 3.5, m, 0, 1.75, 0, g, 16);
    const sp = this.cyl(0.25, 0.4, 4, m, 2.8, 3, 0, g, 8); sp.rotation.z = -0.9;
    this.cyl(0.6, 0.3, 0.4, m, 4.4, 4.2, 0, g, 8).rotation.z = -0.9;
    const h = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.2, 6, 14, Math.PI), m); h.position.set(-0.3, 3.5, 0); g.add(h);
  }
  flowerPot(x, z) { const g = this.group(x, z); this.pot(g, 1.8, 3, '#d84315'); for (let k = 0; k < 6; k++) this.flower(g, rnd2(-1, 1), 3, rnd2(-1, 1), pickF(), rnd2(1.5, 3)); }
  snail(x, z) {
    const g = this.group(x, z), body = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 2.4, 4, 8), mat('#d7ccc8')); body.rotation.z = Math.PI / 2; body.position.y = 0.6; g.add(body);
    const shell = new THREE.Mesh(new THREE.TorusGeometry(1, 0.55, 8, 16), mat('#a1887f')); shell.position.set(-0.3, 1.6, 0); g.add(shell);
    for (const s of [-1, 1]) { const e = this.cyl(0.07, 0.07, 1, G.black, 1.7, 1.3, s * 0.25, g, 4); e.rotation.z = -0.3; }
  }
  bucket(x, z) { const g = this.group(x, z); this.cyl(1.8, 1.4, 3.2, mat('#ffb300', { roughness: 0.4 }), 0, 1.6, 0, g, 14); const h = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.1, 4, 16, Math.PI), G.steel); h.position.y = 3.2; h.rotation.y = 0.3; g.add(h); const sp = this.box(0.4, 4, 1.2, G.steel, 1.6, 3, 0.5, g); sp.rotation.z = -0.4; }
  bush(x, z) { const g = this.group(x, z); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(rnd2(2, 3), 1), G.hedge); b.position.set(rnd2(-2, 2), 2.4, rnd2(-1.5, 1.5)); b.castShadow = true; g.add(b); } for (let k = 0; k < 5; k++) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.4, 6, 4), G.pink); f.position.set(rnd2(-3, 3), rnd2(2.5, 4.5), rnd2(-2.5, 2.5)); g.add(f); } }
}
