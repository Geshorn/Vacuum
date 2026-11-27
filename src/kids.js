import * as THREE from 'three';
import { Kitchen, mat, DEPTH, rnd2 } from './kitchen.js';

/* Детская комната: та же расстановка, что у кухни (мебель — вплотную к трассе, не закрывая её от камеры,
   сценки — вдоль дороги), но своя обстановка: светлый пол, обои со звёздами, кровать, шкафы с игрушками,
   кубики, мишки, железная дорога. Все габариты — в тех же единицах, что и кухня (робот ≈ 2.6 ед). */

const K = {
  wall: mat('#cfe0f2', { roughness: 0.95 }),
  white: mat('#f8f6f2', { roughness: 0.5 }),
  wood: mat('#e2b98a', { roughness: 0.55 }),
  woodDark: mat('#b0825a', { roughness: 0.6 }),
  red: mat('#ef5350', { roughness: 0.45 }), blue: mat('#42a5f5', { roughness: 0.45 }), yellow: mat('#ffca28', { roughness: 0.45 }),
  green: mat('#66bb6a', { roughness: 0.45 }), purple: mat('#ab47bc', { roughness: 0.45 }), orange: mat('#ffa726', { roughness: 0.45 }),
  pink: mat('#f48fb1', { roughness: 0.7 }), teal: mat('#26a69a', { roughness: 0.45 }),
  fur: mat('#b9814f', { roughness: 1 }), furLight: mat('#e3c39b', { roughness: 1 }),
  black: mat('#1d1a1c', { roughness: 0.3 }), steel: mat('#cfd4d8', { metalness: 0.7, roughness: 0.3 }),
  leaf: mat('#4f9a52', { roughness: 0.8 }),
};
const BRIGHT = [K.red, K.blue, K.yellow, K.green, K.purple, K.orange, K.teal];
const pickC = () => BRIGHT[Math.floor(Math.random() * BRIGHT.length)];

// Сценки вдоль трассы: имя метода → габарит [ширина, глубина, высота]
const KID_VIGNETTES = {
  blockPile: [10, 8, 7], ball: [6, 6, 6], teddy: [8, 7, 10], toyCar: [9, 5, 5], bookStackKids: [7, 6, 6],
  bunny: [6, 6, 9], crayons: [8, 6, 3], xylophone: [10, 5, 3], toyRobot: [6, 5, 11], stacker: [6, 6, 10],
  spinTop: [5, 5, 5], drum: [7, 7, 6], duck: [6, 5, 6], plantKids: [8, 8, 16],
};

export class KidsRoom extends Kitchen {
  constructor(scene, track) {
    // свой набор сценок нужен ещё до сборки (родитель сразу вызывает placeInterior)
    KidsRoom.prototype.vignettes = KID_VIGNETTES;
    super(scene, track);
  }

  // ── Пол: светлый клён ─────────────────────────────────────────────────────────
  floor() {
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d'), rows = 8, h = S / rows, len = S / 2;
    for (let r = 0; r < rows; r++) {
      const shift = (r * 0.37 % 1) * len;
      for (let c = -1; c < 3; c++) {
        const x0 = c * len + shift, v = Math.random();
        x.fillStyle = `rgb(${214 + v * 18},${178 + v * 16},${134 + v * 14})`; x.fillRect(x0, r * h, len, h);
        for (let k = 0; k < 10; k++) {
          x.strokeStyle = `rgba(150,105,65,${0.08 + Math.random() * 0.1})`; x.lineWidth = 0.6 + Math.random(); x.beginPath();
          const y = r * h + Math.random() * h; x.moveTo(x0, y); x.bezierCurveTo(x0 + len * 0.3, y + 3, x0 + len * 0.7, y - 3, x0 + len, y); x.stroke();
        }
        x.fillStyle = 'rgba(120,80,45,0.45)'; x.fillRect(x0, r * h, 2, h);
      }
      x.fillStyle = 'rgba(120,80,45,0.5)'; x.fillRect(0, r * h, S, 2);
    }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const W = 1400; tex.repeat.set(W / 34, W / 24);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }));
    fl.rotation.x = -Math.PI / 2; fl.position.y = -0.02; fl.receiveShadow = true; this.g.add(fl);
  }

  // ── Стены: голубые обои со звёздами и облаками, белый плинтус ──────────────────
  walls() {
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d');
    x.fillStyle = '#cfe0f2'; x.fillRect(0, 0, S, S);
    const star = (cx, cy, r, c) => {
      x.fillStyle = c; x.beginPath();
      for (let k = 0; k < 10; k++) { const a = k * Math.PI / 5 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
      x.fill();
    };
    for (let k = 0; k < 9; k++) star(Math.random() * S, Math.random() * S, 6 + Math.random() * 8, ['#ffe082', '#fff8e1', '#f8bbd0'][k % 3]);
    x.fillStyle = 'rgba(255,255,255,.85)';
    for (const [cx, cy] of [[60, 70], [190, 180]]) for (const [dx, dy, r] of [[0, 0, 16], [16, -6, 14], [32, 0, 15], [16, 6, 14]]) { x.beginPath(); x.arc(cx + dx, cy + dy, r, 0, 7); x.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const { x0, x1, z0, z1, wallH: H } = this.room;
    const wallMat = (w) => { const t = tex.clone(); t.needsUpdate = true; t.repeat.set(w / 40, H / 40); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }); };
    this.box(x1 - x0 + 4, H, 2, wallMat(x1 - x0), (x0 + x1) / 2, H / 2, z0 - 1, this.g, false);
    this.box(2, H, z1 - z0, wallMat(z1 - z0), x0 - 1, H / 2, (z0 + z1) / 2, this.g, false);
    this.box(2, H, z1 - z0, wallMat(z1 - z0), x1 + 1, H / 2, (z0 + z1) / 2, this.g, false);
    this.box(x1 - x0, 2, 0.6, K.white, (x0 + x1) / 2, 1, z0 + 0.3, this.g, false);
    this.box(0.6, 2, z1 - z0, K.white, x0 + 0.3, 1, (z0 + z1) / 2, this.g, false);
    this.box(0.6, 2, z1 - z0, K.white, x1 - 0.3, 1, (z0 + z1) / 2, this.g, false);
  }

  // ── Вдоль стен: шкафы, полки, комод, стол. Локальная x — вдоль стены, +z — в комнату ──
  wallRun(parent, from, to, kinds) {
    let x = from, k = 0;
    while (x < to - 6) {
      const kind = kinds[k++ % kinds.length], w = Math.min({ wardrobe: 16, shelf: 14, dresser: 14, desk: 16, toyShelf: 18 }[kind], to - x);
      if (w < 8) break;
      this[kind](parent, x + w / 2, w);
      x += w + 1;
    }
  }

  wardrobe(p, x, w) {
    this.box(w, 30, DEPTH - 1, K.white, x, 15, 0, p);
    for (const s of [-1, 1]) {
      this.box(w / 2 - 0.6, 27, 0.3, s < 0 ? K.blue : K.white, x + s * w / 4, 15.5, DEPTH / 2 - 0.3, p);
      this.cyl(0.35, 0.35, 0.6, K.yellow, x + s * 0.9, 15, DEPTH / 2, p, 10).rotation.x = Math.PI / 2;
    }
    this.box(w + 0.6, 0.8, DEPTH, K.wood, x, 30.4, 0, p);
    // на шкафу — коробка с игрушками и мяч
    this.box(5, 3, 4, K.red, x - 3, 32.3, 0, p);
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 12), K.yellow); b.position.set(x + 3, 32.4, 0); b.castShadow = true; p.add(b);
  }

  shelf(p, x, w) {
    for (const s of [-1, 1]) this.box(0.6, 22, DEPTH - 1, K.wood, x + s * (w / 2 - 0.3), 11, 0, p);
    for (let k = 0; k < 4; k++) {
      const y = 0.5 + k * 7;
      this.box(w, 0.6, DEPTH - 1, K.wood, x, y, 0, p);
      if (k === 3) continue;
      let bx = x - w / 2 + 1;
      while (bx < x + w / 2 - 1.5) {                   // разноцветные книжки
        const bw = 0.6 + Math.random() * 0.6, bh = 4 + Math.random() * 2;
        const b = this.box(bw, bh, 4, pickC(), bx + bw / 2, y + 0.3 + bh / 2, 0, p);
        if (Math.random() < 0.1) b.rotation.z = 0.25;
        bx += bw + 0.08;
      }
    }
  }

  dresser(p, x, w) {
    this.box(w, 11, DEPTH - 1, K.white, x, 5.5, 0, p);
    for (let r = 0; r < 3; r++) {
      const m = [K.pink, K.teal, K.yellow][r];
      this.box(w - 1, 2.8, 0.3, m, x, 2 + r * 3.3, DEPTH / 2 - 0.3, p);
      this.cyl(0.3, 0.3, 0.5, K.white, x, 2 + r * 3.3, DEPTH / 2, p, 8).rotation.x = Math.PI / 2;
    }
    this.box(w + 0.4, 0.6, DEPTH, K.wood, x, 11.3, 0, p);
    // ночник-гриб и рамка
    this.cyl(0.6, 0.8, 2.5, K.white, x - 3, 12.8, 0, p, 10);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ff8a80', emissive: '#ff5252', emissiveIntensity: 0.35 }));
    cap.position.set(x - 3, 14, 0); p.add(cap);
    this.box(3, 4, 0.4, K.wood, x + 3, 13.8, -1, p).rotation.x = -0.15;
  }

  desk(p, x, w) {
    this.box(w, 0.8, DEPTH - 1, K.wood, x, 10, 0, p);
    for (const s of [-1, 1]) this.box(0.8, 10, DEPTH - 2, K.white, x + s * (w / 2 - 0.6), 5, 0, p);
    // лампа, кружка с карандашами, глобус
    this.cyl(1.2, 1.4, 0.4, K.blue, x - w / 2 + 3, 10.6, -1, p, 14);
    const arm = this.cyl(0.15, 0.15, 5, K.steel, x - w / 2 + 3, 13, -1, p, 6); arm.rotation.z = 0.3;
    const sh = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.8, 14, 1, true), K.blue); sh.position.set(x - w / 2 + 4.2, 15.2, -1); sh.rotation.z = -1; p.add(sh);
    this.cyl(0.7, 0.7, 2, K.red, x + 1, 11.4, 0, p, 12);
    for (let k = 0; k < 4; k++) { const c = this.cyl(0.12, 0.12, 3, BRIGHT[k], x + 0.8 + (k % 2) * 0.4, 12.8, -0.2 + (k >> 1) * 0.4, p, 6); c.rotation.z = (k - 1.5) * 0.15; }
    this.cyl(0.4, 0.8, 0.5, K.woodDark, x + w / 2 - 3, 10.6, -1, p, 10);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), mat('#4fc3f7', { roughness: 0.4 })); gl.position.set(x + w / 2 - 3, 13, -1); gl.castShadow = true; p.add(gl);
    gl.userData.dynamic = true; this.anim.push(t => { gl.rotation.y = t * 0.4; });
  }

  toyShelf(p, x, w) {
    for (const s of [-1, 1]) this.box(0.6, 14, DEPTH - 1, K.white, x + s * (w / 2 - 0.3), 7, 0, p);
    for (let k = 0; k < 3; k++) this.box(w, 0.6, DEPTH - 1, K.white, x, 0.5 + k * 6.6, 0, p);
    // ящики-корзины внизу и плюшевые игрушки сверху
    for (let k = 0; k < 3; k++) this.box(w / 3 - 1, 4.5, DEPTH - 2, BRIGHT[k + 2], x - w / 3 + k * w / 3, 3.2, 0, p);
    const g = new THREE.Group(); g.position.set(x - w / 4, 7.5, 0); p.add(g); this.plush(g, 0.55, K.fur);
    const g2 = new THREE.Group(); g2.position.set(x + w / 4, 7.5, 0); p.add(g2); this.plush(g2, 0.5, K.pink);
    for (let k = 0; k < 3; k++) this.box(2, 2, 2, BRIGHT[k], x - 2 + k * 2.2, 15.2, 0, p);
  }

  northRun() {
    const R = this.room, p = this.group(0, R.z0 + DEPTH / 2);
    this.wallRun(p, R.x0 + DEPTH, R.x1 - DEPTH, ['wardrobe', 'shelf', 'dresser', 'toyShelf', 'desk', 'shelf', 'wardrobe', 'toyShelf']);
    // окно с занавесками над серединой
    const mid = (R.x0 + R.x1) / 2, z = -DEPTH / 2 + 0.2;
    this.box(26, 18, 0.4, new THREE.MeshStandardMaterial({ color: '#bfe3ff', emissive: '#9fd4ff', emissiveIntensity: 0.6 }), mid, 26, z, p, false);
    this.box(27, 1, 1, K.white, mid, 17, z + 0.4, p, false); this.box(27, 1, 1, K.white, mid, 35, z + 0.4, p, false);
    this.box(1, 18, 1, K.white, mid, 26, z + 0.4, p, false);
    for (const s of [-1, 1]) this.box(5, 22, 0.6, K.pink, mid + s * 16, 25, z + 1, p, false);
  }

  westRun() {
    const R = this.room, p = this.group(R.x0 + DEPTH / 2, 0, Math.PI / 2);
    this.wallRun(p, -(R.z1 - 25), -(R.z0 + DEPTH), ['toyShelf', 'shelf', 'dresser', 'shelf']);
  }

  eastRun() {
    const R = this.room, p = this.group(R.x1 - DEPTH / 2, 0, -Math.PI / 2);
    this.wallRun(p, R.z0 + DEPTH, R.z1 - 25, ['shelf', 'toyShelf', 'desk', 'dresser']);
  }

  // ── Внутри и вокруг трассы ──────────────────────────────────────────────────
  placeInterior() {
    const R = this.room, t = this.track;
    // центры свободных «островов» внутри трассы — по средней точке
    const cx = t.p.reduce((s, p) => s + p.x, 0) / t.n, cz = t.p.reduce((s, p) => s + p.z, 0) / t.n;
    const list = [
      ['bed', cx, cz, 60, 34, 20, 9],
      ['playRug', cx, cz, 60, 30, 30, 0.2, false],
      ['trainSet', cx - 20, cz + 10, 60, 30, 20, 4],
      ['kidsTable', cx + 20, cz - 10, 60, 22, 18, 9],
      ['teepee', R.x0 + 30, R.z1 - 40, 40, 16, 16, 20],
      ['rockingHorse', R.x1 - 30, R.z1 - 40, 40, 14, 6, 12],
      ['dollhouse', cx, cz + 40, 50, 16, 10, 16],
      ['beanbag', cx - 40, cz, 50, 10, 10, 7],
      ['blockTower', cx + 40, cz, 50, 6, 6, 16],
      ['toyBox', R.x0 + 30, R.z0 + 20, 25, 12, 8, 8],
      ['dino', R.x1 - 30, R.z0 + 30, 30, 14, 6, 12],
      ['plantKids', R.x0 + 22, cz, 30, 8, 8, 16],
      ['plantKids', R.x1 - 22, cz, 30, 8, 8, 16],
    ];
    for (const [fn, x, z, rad, w, d, h, align = true] of list) this.put(fn, this.findSpot(x, z, rad, w, d, h, align));
    this.placeVignettes();
  }

  // ── Предметы (каждый — одна группа в (x, z); +z смотрит на трассу) ─────────────
  // Плюшевый мишка: s — масштаб, m — цвет меха
  plush(g, s, m) {
    const sp = (r, x, y, z, mm = m, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r * s, 14, 10), mm); o.position.set(x * s, y * s, z * s); o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
    sp(3, 0, 3, 0, m, 1, 1.1, 0.9);
    const head = sp(2.3, 0, 7.2, 0.3);
    for (const sd of [-1, 1]) { sp(0.9, sd * 1.8, 9, 0); sp(0.5, sd * 1.8, 9, 0.4, K.furLight); sp(1.1, sd * 2.6, 3.8, 1.2); sp(1.2, sd * 1.6, 0.9, 2.2); }
    sp(1, 0, 6.6, 2.2, K.furLight, 1, 0.8, 0.8);
    sp(0.35, 0, 7, 3.1, K.black);
    for (const sd of [-1, 1]) sp(0.3, sd * 0.9, 7.9, 2.2, K.black);
    sp(1.6, 0, 3, 2, K.furLight, 1, 1.1, 0.4);
    return head;
  }

  teddy(x, z) {
    const g = this.group(x, z); this.plush(g, 1, K.fur);
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.35, 8, 12), K.red); bow.position.set(0, 5.4, 2.1); g.add(bow);
  }

  bunny(x, z) {
    const g = this.group(x, z), w = mat('#f5f5f5', { roughness: 1 });
    this.plush(g, 0.8, w);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CapsuleGeometry(0.6, 3, 4, 8), w); e.position.set(s * 0.8, 9.5, 0); e.rotation.z = s * -0.25; e.castShadow = true; g.add(e); }
  }

  bed(x, z) {
    const g = this.group(x, z), L = 32, W = 18;
    this.box(L, 3, W, K.white, 0, 2.5, 0, g);
    for (const s of [-1, 1]) { this.box(1.4, s < 0 ? 12 : 8, W + 1, K.wood, s * (L / 2 + 0.7), s < 0 ? 6 : 4, 0, g); }
    this.box(L - 1, 2.2, W - 1, mat('#ffffff', { roughness: 0.9 }), 0, 5.1, 0, g);
    // одеяло в клетку
    const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    c.fillStyle = '#90caf9'; c.fillRect(0, 0, S, S); c.fillStyle = 'rgba(255,255,255,.55)';
    for (let k = 0; k < S; k += 16) { c.fillRect(k, 0, 6, S); c.fillRect(0, k, S, 6); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(4, 3); tex.colorSpace = THREE.SRGBColorSpace;
    this.box(L * 0.65, 1.4, W + 0.4, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), L * 0.15, 6.6, 0, g);
    const pil = new THREE.Mesh(new THREE.CapsuleGeometry(2, 9, 6, 12), K.white); pil.rotation.x = Math.PI / 2; pil.scale.set(1, 1, 0.5); pil.position.set(-L / 2 + 4.5, 7, 0); pil.castShadow = true; g.add(pil);
    const t = new THREE.Group(); t.position.set(-L / 2 + 6, 6.2, 4); t.rotation.y = 0.6; g.add(t); this.plush(t, 0.35, K.fur);
  }

  playRug(x, z) {
    const g = this.group(x, z), S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    // ковёр-город: зелёные кварталы, серые дороги с разметкой
    c.fillStyle = '#7cb342'; c.fillRect(0, 0, S, S);
    c.fillStyle = '#616161'; for (const k of [60, 180]) { c.fillRect(k - 14, 0, 28, S); c.fillRect(0, k - 14, S, 28); }
    c.strokeStyle = '#fff'; c.setLineDash([10, 10]); c.lineWidth = 2;
    for (const k of [60, 180]) { c.beginPath(); c.moveTo(k, 0); c.lineTo(k, S); c.moveTo(0, k); c.lineTo(S, k); c.stroke(); }
    c.setLineDash([]);
    for (const [bx, by, col] of [[10, 10, '#ef5350'], [90, 10, '#ffca28'], [210, 90, '#42a5f5'], [100, 210, '#ab47bc'], [10, 100, '#ffa726']]) { c.fillStyle = col; c.fillRect(bx, by, 30, 30); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 30), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    rug.position.y = 0.1; rug.receiveShadow = true; g.add(rug);
  }

  // Железная дорога: овал рельсов и паровозик с вагонами, который ездит по кругу
  trainSet(x, z) {
    const g = this.group(x, z), a = 13, b = 7;
    const ring = (r1, r2, m) => { const curve = new THREE.EllipseCurve(0, 0, r1, r2); const pts = curve.getPoints(64).map(p => new THREE.Vector3(p.x, 0.25, p.y)); const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 64, 0.18, 4, true), m); g.add(tube); };
    ring(a - 0.6, b - 0.6, K.steel); ring(a + 0.6, b + 0.6, K.steel);
    for (let k = 0; k < 28; k++) { const t = k / 28 * Math.PI * 2; const s = this.box(0.5, 0.2, 2, K.woodDark, Math.cos(t) * a, 0.1, Math.sin(t) * b, g, false); s.rotation.y = -Math.atan2(Math.cos(t) * b, -Math.sin(t) * a); }
    const train = []; const mk = k => {
      const c = new THREE.Group(); g.add(c); c.userData.dynamic = true;
      if (k === 0) { this.box(3, 2, 1.8, K.red, 0, 1.4, 0, c); this.cyl(0.8, 0.8, 2.2, K.black, 1, 2.2, 0, c, 12).rotation.z = Math.PI / 2; this.cyl(0.3, 0.4, 1.2, K.black, 1.6, 3.2, 0, c, 8); this.box(1.4, 1.6, 1.9, K.blue, -0.9, 3, 0, c); }
      else { this.box(2.6, 1.6, 1.7, BRIGHT[k + 1], 0, 1.2, 0, c); for (let j = 0; j < 2; j++) this.box(0.8, 0.8, 0.8, BRIGHT[(k + j) % 7], -0.5 + j, 2.4, 0, c); }
      for (const s of [-1, 1]) for (const w of [-0.9, 0.9]) { const wh = this.cyl(0.45, 0.45, 0.3, K.black, w, 0.5, s * 0.85, c, 10); wh.rotation.x = Math.PI / 2; }
      train.push(c);
    };
    for (let k = 0; k < 3; k++) mk(k);
    this.anim.push(t => train.forEach((c, k) => {
      const u = t * 0.35 - k * 0.24, px = Math.cos(u) * a, pz = Math.sin(u) * b;
      c.position.set(px, 0.3, pz); c.rotation.y = -Math.atan2(Math.cos(u) * b, -Math.sin(u) * a);
    }));
  }

  kidsTable(x, z) {
    const g = this.group(x, z);
    this.cyl(6, 6, 0.6, K.white, 0, 7, 0, g, 28);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; this.cyl(0.4, 0.4, 7, BRIGHT[k], Math.cos(a) * 4, 3.5, Math.sin(a) * 4, g, 8); }
    for (let k = 0; k < 3; k++) {                                // стульчики
      const a = k * 2.1 + 0.3, cx = Math.cos(a) * 9, cz = Math.sin(a) * 9, m = BRIGHT[k + 2];
      this.box(4, 0.5, 4, m, cx, 4, cz, g);
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) this.cyl(0.25, 0.25, 4, m, cx + dx, 2, cz + dz, g, 6);
      const back = this.box(4, 3.5, 0.5, m, cx + Math.cos(a) * 1.8, 6, cz + Math.sin(a) * 1.8, g); back.rotation.y = -a + Math.PI / 2;
    }
    // чашки чайного сервиза и пирамидка
    for (let k = 0; k < 3; k++) { const a = k * 2.1; this.cyl(0.6, 0.5, 0.9, K.pink, Math.cos(a) * 3, 7.8, Math.sin(a) * 3, g, 12); }
    this.cyl(1.4, 1.2, 1.6, K.white, 0, 8.1, 0, g, 14);
  }

  teepee(x, z) {
    const g = this.group(x, z), S = 128, cv = document.createElement('canvas'); cv.width = cv.height = S; const c = cv.getContext('2d');
    c.fillStyle = '#fff3e0'; c.fillRect(0, 0, S, S);
    for (let k = 0; k < 4; k++) { c.fillStyle = ['#ffab91', '#80cbc4', '#ffe082', '#ce93d8'][k]; for (let j = 0; j < 8; j++) { c.beginPath(); c.moveTo(j * 16, 30 + k * 22); c.lineTo(j * 16 + 8, 18 + k * 22); c.lineTo(j * 16 + 16, 30 + k * 22); c.fill(); } }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = THREE.RepeatWrapping; tex.repeat.x = 3;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 17, 6, 1, true, 0.6, Math.PI * 2 - 1.2), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.9 }));
    cone.position.y = 8.5; cone.rotation.y = Math.PI / 2; cone.castShadow = true; g.add(cone);
    for (let k = 0; k < 5; k++) { const a = k * 1.26; const st = this.cyl(0.2, 0.25, 21, K.woodDark, Math.cos(a) * 3, 10, Math.sin(a) * 3, g, 6); st.rotation.set(Math.sin(a) * -0.4, 0, Math.cos(a) * 0.4); }
    this.cyl(5.5, 5.5, 0.3, K.pink, 0, 0.15, 0, g, 20);
    const p = new THREE.Group(); p.position.set(1, 0.3, 1); g.add(p); this.plush(p, 0.4, K.furLight);
  }

  rockingHorse(x, z) {
    const g = this.group(x, z), body = new THREE.Group(); g.add(body); body.userData.dynamic = true;
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(7, 0.4, 6, 24, Math.PI * 0.6), K.red); r.rotation.z = Math.PI * 1.2; r.position.set(0, 7, s * 1.6); body.add(r); }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 5, 6, 12), K.white); torso.rotation.z = Math.PI / 2; torso.position.y = 5.5; torso.castShadow = true; body.add(torso);
    const neck = this.box(1.6, 4, 1.8, K.white, 3.4, 7.6, 0, body); neck.rotation.z = -0.4;
    const head = this.box(3.4, 1.8, 1.6, K.white, 5, 9.4, 0, body); head.rotation.z = -0.3;
    this.box(1, 4.5, 0.6, K.yellow, 2.8, 8.5, 0, body).rotation.z = -0.4;   // грива
    for (const [lx, s] of [[-2.5, 1], [2.5, 1], [-2.5, -1], [2.5, -1]]) this.cyl(0.4, 0.4, 3.5, K.white, lx, 2.8, s * 1.4, body, 8);
    this.box(2.4, 0.6, 3.6, K.blue, -0.5, 7.3, 0, body);
    const tail = this.cyl(0.4, 0.1, 3, K.yellow, -4.8, 5.5, 0, body, 6); tail.rotation.z = 0.8;
    const ph = Math.random() * 6; this.anim.push(t => { body.rotation.z = Math.sin(t * 1.6 + ph) * 0.12; });
  }

  dollhouse(x, z) {
    const g = this.group(x, z);
    this.box(14, 11, 8, mat('#fce4ec', { roughness: 0.7 }), 0, 5.5, -1, g);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 6, 6, 4, 1), K.red); roof.rotation.y = Math.PI / 4; roof.scale.set(1.7, 1, 1.05); roof.position.set(0, 14, -1); roof.castShadow = true; g.add(roof);
    for (const [wx, wy] of [[-4, 3.5], [4, 3.5], [-4, 8], [4, 8]]) { this.box(2.4, 2.4, 0.3, new THREE.MeshStandardMaterial({ color: '#fff59d', emissive: '#ffee58', emissiveIntensity: 0.3 }), wx, wy, 3.1, g, false); this.box(2.8, 0.3, 0.6, K.white, wx, wy - 1.4, 3.2, g); }
    this.box(2.4, 4.5, 0.3, K.teal, 0, 2.3, 3.1, g);
    this.box(1.6, 3, 1.6, K.white, 4.5, 15, -2, g);   // труба
  }

  beanbag(x, z) {
    const g = this.group(x, z), b = new THREE.Mesh(new THREE.SphereGeometry(5, 20, 14), mat('#7e57c2', { roughness: 0.95 }));
    b.scale.set(1, 0.65, 1); b.position.y = 3.2; b.castShadow = true; g.add(b);
    const d = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 10), mat('#9575cd', { roughness: 0.95 })); d.scale.set(1.2, 0.5, 1); d.position.set(0, 5.3, 1); g.add(d);
  }

  blockTower(x, z) {
    const g = this.group(x, z);
    for (let k = 0; k < 7; k++) { const b = this.box(3.6 - k * 0.15, 2.2, 3.6 - k * 0.15, BRIGHT[k % 7], (Math.random() - 0.5) * 0.4, 1.1 + k * 2.2, (Math.random() - 0.5) * 0.4, g); b.rotation.y = (Math.random() - 0.5) * 0.5; this.letter(b, k); }
  }

  // Буква на грани кубика
  letter(box, k) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
    c.fillStyle = '#fff'; c.fillRect(6, 6, 52, 52); c.fillStyle = '#333'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('АБВГДЕЁЖЗИК'[k % 11], 32, 35);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6 }));
    p.position.z = box.geometry.parameters.depth / 2 + 0.02; box.add(p);
  }

  blockPile(x, z) {
    const g = this.group(x, z);
    for (let k = 0; k < 9; k++) { const s = 2 + Math.random() * 0.6, b = this.box(s, s, s, BRIGHT[k % 7], rnd2(-3.5, 3.5), s / 2 + (k > 6 ? s : 0), rnd2(-2.5, 2.5), g); b.rotation.y = Math.random() * 3; this.letter(b, k); }
  }

  ball(x, z) {
    const g = this.group(x, z), S = 64, cv = document.createElement('canvas'); cv.width = S; cv.height = S; const c = cv.getContext('2d');
    ['#ef5350', '#fff', '#42a5f5', '#fff', '#ffca28', '#fff'].forEach((col, k) => { c.fillStyle = col; c.fillRect(k * S / 6, 0, S / 6 + 1, S); });
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
    const b = new THREE.Mesh(new THREE.SphereGeometry(2.6, 20, 14), new THREE.MeshStandardMaterial({ map: t, roughness: 0.4 }));
    b.position.y = 2.6; b.rotation.z = 0.5; b.castShadow = true; g.add(b);
  }

  toyCar(x, z) {
    const g = this.group(x, z), m = pickC();
    this.box(7, 1.6, 3.4, m, 0, 1.6, 0, g);
    this.box(3.6, 1.6, 3, mat('#bbdefb', { roughness: 0.2 }), -0.4, 3.2, 0, g);
    this.box(3.8, 0.3, 3.2, m, -0.4, 4.1, 0, g);
    for (const s of [-1, 1]) for (const w of [-2.3, 2.3]) { const wh = this.cyl(0.9, 0.9, 0.6, K.black, w, 0.9, s * 1.8, g, 12); wh.rotation.x = Math.PI / 2; }
    for (const s of [-1, 1]) this.box(0.2, 0.5, 0.7, K.yellow, 3.5, 1.9, s * 1.1, g);
  }

  bookStackKids(x, z) {
    const g = this.group(x, z);
    for (let k = 0; k < 4; k++) { const b = this.box(5.4 - k * 0.4, 0.9, 4 - k * 0.2, BRIGHT[k + 1], 0, 0.45 + k * 0.9, 0, g); b.rotation.y = (k % 2 ? 1 : -1) * 0.15; }
    const open = this.box(6, 0.3, 4, K.white, 3, 0.15, 3, g); open.rotation.y = 0.4;
  }

  crayons(x, z) {
    const g = this.group(x, z);
    this.box(6, 0.15, 4.5, K.white, 0, 0.08, 0, g);
    for (let k = 0; k < 7; k++) { const c = this.cyl(0.25, 0.25, 3, BRIGHT[k], rnd2(-2.5, 2.5), 0.3, rnd2(-1.8, 1.8), g, 6); c.rotation.set(Math.PI / 2, 0, Math.random() * 3); }
  }

  xylophone(x, z) {
    const g = this.group(x, z);
    for (const s of [-1, 1]) this.box(9, 0.6, 0.5, K.woodDark, 0, 0.5, s * 1.6, g);
    for (let k = 0; k < 7; k++) this.box(0.9, 0.4, 3.6 - k * 0.25, BRIGHT[k], -3.6 + k * 1.2, 1, 0, g);
    for (const s of [-1, 1]) { const st = this.cyl(0.12, 0.12, 3.5, K.wood, 1 + s, 0.3, 3.2, g, 6); st.rotation.set(Math.PI / 2, 0, s * 0.3); const hd = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), K.red); hd.position.set(1 + s * 1.5, 0.3, 4.8); g.add(hd); }
  }

  toyRobot(x, z) {
    const g = this.group(x, z);
    this.box(3, 4, 2.4, K.steel, 0, 4.5, 0, g);
    this.box(2.4, 2.2, 2, K.steel, 0, 7.7, 0, g);
    for (const s of [-1, 1]) { this.box(1, 2.5, 1, K.blue, s * 0.8, 1.3, 0, g); this.box(0.8, 3, 0.8, K.red, s * 2, 4.8, 0, g); const e = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), new THREE.MeshBasicMaterial({ color: '#76ff03' })); e.position.set(s * 0.6, 7.9, 1.02); g.add(e); }
    this.cyl(0.1, 0.1, 1.6, K.black, 0, 9.5, 0, g, 6);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff1744' })); tip.position.set(0, 10.4, 0); g.add(tip);
    this.box(1.6, 1, 0.2, K.yellow, 0, 5, 1.25, g);
  }

  stacker(x, z) {
    const g = this.group(x, z);
    this.cyl(2.6, 2.8, 0.8, K.wood, 0, 0.4, 0, g, 16);
    this.cyl(0.3, 0.3, 8, K.wood, 0, 4.5, 0, g, 8);
    for (let k = 0; k < 6; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(2.2 - k * 0.3, 0.6, 8, 20), BRIGHT[k]); r.rotation.x = Math.PI / 2; r.position.y = 1.4 + k * 1.15; r.castShadow = true; g.add(r); }
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), K.red); top.position.y = 8.6; g.add(top);
  }

  spinTop(x, z) {
    const g = this.group(x, z), t = new THREE.Group(); g.add(t); t.userData.dynamic = true;
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.5, 16), K.red); c1.rotation.x = Math.PI; c1.position.y = 1.3; t.add(c1);
    const c2 = this.cyl(2.2, 2.2, 0.6, K.yellow, 0, 2.8, 0, t, 16);
    const c3 = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.2, 16), K.blue); c3.position.y = 3.7; t.add(c3);
    this.cyl(0.25, 0.25, 1.5, K.wood, 0, 4.8, 0, t, 6);
    t.children.forEach(o => { o.castShadow = true; });
    this.anim.push(time => { t.rotation.y = time * 9; t.rotation.z = Math.sin(time * 2) * 0.08; });
  }

  drum(x, z) {
    const g = this.group(x, z);
    this.cyl(3, 3, 4, K.red, 0, 2, 0, g, 20);
    for (const y of [0.3, 3.7]) { const r = new THREE.Mesh(new THREE.TorusGeometry(3.05, 0.25, 6, 24), K.yellow); r.rotation.x = Math.PI / 2; r.position.y = y; g.add(r); }
    this.cyl(2.9, 2.9, 0.1, K.white, 0, 4.02, 0, g, 20);
    for (const s of [-1, 1]) { const st = this.cyl(0.15, 0.15, 4, K.wood, s * 1.2, 4.4, 0.5, g, 6); st.rotation.set(0.2, 0, s * 1.2); }
  }

  duck(x, z) {
    const g = this.group(x, z), y = mat('#ffeb3b', { roughness: 0.35 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(2.5, 16, 12), y); b.scale.set(1.3, 0.9, 1); b.position.y = 2.2; b.castShadow = true; g.add(b);
    const h = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), y); h.position.set(1.8, 4.6, 0); g.add(h);
    const beak = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), K.orange); beak.scale.set(1.3, 0.5, 0.9); beak.position.set(3.3, 4.4, 0); g.add(beak);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), K.black); e.position.set(2.8, 5, s * 0.8); g.add(e); }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 10), y); tail.position.set(-3, 3.4, 0); tail.rotation.z = 1; g.add(tail);
  }

  toyBox(x, z) {
    const g = this.group(x, z);
    this.box(11, 6, 7, K.blue, 0, 3, 0, g);
    for (const s of [-1, 1]) this.box(0.4, 6.2, 7.2, K.yellow, s * 3, 3, 0, g);
    const lid = this.box(11.2, 0.6, 7.2, K.red, 0, 7.8, -3.3, g); lid.geometry.translate(0, 0, 3.6); lid.rotation.x = -1.1; lid.position.z = -3.6;
    for (let k = 0; k < 4; k++) this.box(1.8, 1.8, 1.8, BRIGHT[k], -3 + k * 2, 6.6, rnd2(-1, 1), g).rotation.y = k;
    const b = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), K.green); b.position.set(3.5, 7, 1); g.add(b);
  }

  dino(x, z) {
    const g = this.group(x, z), m = mat('#66bb6a', { roughness: 0.6 }), sp = mat('#ffa726', { roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), m); body.scale.set(1.5, 1, 0.9); body.position.y = 5; body.castShadow = true; g.add(body);
    const neck = this.cyl(0.9, 1.3, 5, m, 4.2, 8, 0, g, 10); neck.rotation.z = -0.5;
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 10), m); head.scale.set(1.4, 1, 1); head.position.set(6, 10.2, 0); g.add(head);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(1.4, 6, 10), m); tail.rotation.z = Math.PI / 2 + 0.3; tail.position.set(-6.5, 4.2, 0); g.add(tail);
    for (const [lx, s] of [[-2, 1], [2, 1], [-2, -1], [2, -1]]) this.cyl(0.8, 0.9, 3.5, m, lx, 1.75, s * 1.6, g, 10);
    for (let k = 0; k < 5; k++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.4, 6), sp); s.position.set(-3 + k * 1.5, 8 - Math.abs(k - 2) * 0.4, 0); g.add(s); }
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), K.black); e.position.set(7, 10.6, s * 0.9); g.add(e); }
  }

  plantKids(x, z) {
    const g = this.group(x, z);
    this.pot(g, 2.6, 4, '#4fc3f7');
    const crown = new THREE.Group(); crown.position.y = 4; g.add(crown);
    for (let k = 0; k < 9; k++) { const a = k / 9 * 6.28; this.leaf(crown, Math.cos(a) * 0.8, 1 + (k % 3), Math.sin(a) * 0.8, 4 + (k % 3), 1.4, Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5, K.leaf); }
    this.sway(crown, 0.04, 0.9);
  }
}
