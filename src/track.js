import * as THREE from 'three';
import { C } from './config.js';

// Замкнутая трасса: центральная линия разбита на сегменты, у каждого есть точка, направление и нормаль (влево).
export class Track {
  // points — опорные точки центральной линии [x, z] (из maps.js), трасса замкнута
  constructor(scene, points) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
    this.length = curve.getLength();
    const n = Math.round(this.length / C.sampleStep);
    const pts = curve.getSpacedPoints(n).slice(0, n);   // последняя точка совпадает с первой
    this.n = n;
    this.half = C.trackWidth / 2;
    this.p = pts.map(v => ({ x: v.x, z: v.z }));
    this.t = []; this.nrm = []; this.dist = [];
    for (let i = 0; i < n; i++) {
      const a = this.p[(i - 1 + n) % n], b = this.p[(i + 1) % n];
      const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      this.t.push({ x: dx / l, z: dz / l });
      this.nrm.push({ x: dz / l, z: -dx / l });       // левая сторона по ходу движения
      this.dist.push(i * (this.length / n));
    }
    this.group = new THREE.Group();
    scene.add(this.group);
    this.setupPit();
    this.buildRoad(); this.buildCurbs(); this.buildWalls(); this.buildStart(); this.buildPit();
  }

  // --- Пит-лейн ---------------------------------------------------------------
  // Пит-лейн идёт по левой (+нормаль) стороне трассы. Его центр смещён от центра дороги на pitOff(i):
  // на съезде плавно растёт от 0, дальше постоянный, на выезде плавно уходит в 0.
  setupPit() {
    const P = C.pit;
    this.pitStart = this.at(P.start); this.pitLen = P.length; this.pitRamp = P.ramp;
    this.ph = P.laneWidth / 2;
    this.pitFull = this.half + C.wallThick + this.ph;      // между дорогой и пит-лейном — стенка толщиной wallThick
    const segs = Math.round(P.padLength / C.sampleStep);
    this.padK0 = Math.round((P.length - segs) / 2); this.padK1 = this.padK0 + segs;
    this.padFrom = this.at(this.pitStart + this.padK0); this.padTo = this.at(this.pitStart + this.padK1);
    this.padMid = this.at(this.pitStart + Math.round((this.padK0 + this.padK1) / 2));
  }

  // Номер сегмента внутри пит-лейна (0..pitLen) или -1, если сегмент вне его
  pitK(i) { const k = (i - this.pitStart + this.n) % this.n; return k <= this.pitLen ? k : -1; }

  pitOff(i) {
    const k = this.pitK(i); if (k < 0) return 0;
    const r = this.pitRamp, u = k < r ? k / r : k > this.pitLen - r ? (this.pitLen - k) / r : 1;
    return u * u * (3 - 2 * u) * this.pitFull;
  }

  // Толщина стенки между дорогой и пит-лейном в сегменте i (0 — стенки нет, проезд открыт)
  sepGap(i) { const D = this.pitOff(i); return D > 0 ? D - this.ph - this.half : -1; }

  // Допустимое смещение центра робота радиуса r от центра трассы: [от, до, в пит-лейне ли]
  bounds(i, d, r) {
    const h = this.half, D = this.pitOff(i);
    if (D <= 0) return [-h + r, h - r, false];
    const gap = this.sepGap(i);
    if (gap < 0.3) return [-h + r, Math.max(h, D + this.ph) - r, d > h];      // съезд/выезд: дорога и пит-лейн слиты
    if (d > h + gap / 2) return [D - this.ph + r, D + this.ph - r, true];       // за разделительной стенкой
    return [-h + r, h - r, false];
  }

  onPad(i, d) { const k = this.pitK(i); return k >= this.padK0 && k <= this.padK1 && Math.abs(d - this.pitFull) < this.ph * 0.8; }

  // Полоса на участке i0..i0+cnt; смещения fa/fb — числа или функции от сегмента
  band(i0, cnt, fa, fb, ya, yb, mat) {
    const F = f => (typeof f === 'function' ? f : () => f);
    const A = F(fa), B = F(fb), pos = [], idx = [];
    for (let k = 0; k <= cnt; k++) { const i = this.at(i0 + k); pos.push(...this.edge(i, A(i), ya), ...this.edge(i, B(i), yb)); }
    for (let k = 0; k < cnt; k++) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  // Стена на участке: две вертикальные грани по смещениям fin и fout и крышка сверху
  wallRange(i0, cnt, fin, fout, side, top) {
    const H = C.wallHeight;
    for (const f of [fin, fout]) { const m = this.band(i0, cnt, f, f, 0, H, side); m.castShadow = true; }
    this.band(i0, cnt, fout, fin, H, H, top);
  }

  buildPit() {
    const h = this.half, ph = this.ph, s0 = this.pitStart, L = this.pitLen;
    const outer = i => Math.max(h, this.pitOff(i) + ph);
    // покрытие пит-лейна
    this.band(s0, L, outer, h, 0.021, 0.021, new THREE.MeshStandardMaterial({ color: '#3a2e3c', roughness: 0.9 }));
    // белые линии ограничителя скорости в начале и конце прямого участка
    const lineMat = new THREE.MeshBasicMaterial({ color: '#f4eef2' });
    for (const k of [this.pitRamp, L - this.pitRamp - 1]) this.band(s0 + k, 1, this.pitFull - ph, this.pitFull + ph, 0.035, 0.035, lineMat);
    // жёлтая разметка вдоль разделительной стенки
    const yel = new THREE.MeshBasicMaterial({ color: '#ffcc33' });
    this.band(s0 + this.pitRamp, L - this.pitRamp * 2, this.pitFull - ph + 0.35, this.pitFull - ph + 0.6, 0.03, 0.03, yel);

    // зарядная площадка
    this.padMat = new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    this.band(this.padFrom, this.padK1 - this.padK0, this.pitFull - ph * 0.8, this.pitFull + ph * 0.8, 0.04, 0.04, this.padMat);

    // зарядная станция у внешней стенки
    const st = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: '#e9e2e6', roughness: 0.5 });
    this.chargerMat = new THREE.MeshStandardMaterial({ color: '#1d4d27', emissive: '#4cd964', emissiveIntensity: 0.6 });
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; st.add(m); return m; };
    add(new THREE.BoxGeometry(2.6, 3.2, 1.2), body, 0, 1.6, 0);                       // корпус
    add(new THREE.BoxGeometry(1.8, 1.2, 0.1), this.chargerMat, 0, 2.2, 0.65);         // экран
    add(new THREE.BoxGeometry(0.3, 0.3, 2.2), body, 0, 0.6, 1.6);                     // штанга с разъёмом
    add(new THREE.BoxGeometry(0.6, 0.5, 0.6), this.chargerMat, 0, 0.5, 2.7);          // разъём
    add(new THREE.BoxGeometry(2.8, 0.3, 1.4), new THREE.MeshStandardMaterial({ color: '#ff8a5c', emissive: '#5a1408' }), 0, 3.35, 0);
    const i = this.padMid, [x, , z] = this.edge(i, this.pitFull + ph - 0.7), t = this.t[i];
    st.position.set(x, 0, z);
    st.rotation.y = -Math.atan2(t.z, t.x);   // локальная ось x — вдоль трассы, +z — к центру пит-лейна
    this.group.add(st);
  }

  // Анимация станции: пульсирует, пока идёт зарядка
  update(t, charging) {
    const k = charging ? 0.8 + 0.6 * Math.sin(t / 120) : 0.5;
    this.chargerMat.emissiveIntensity = k;
    this.padMat.opacity = charging ? 0.4 + 0.2 * Math.sin(t / 120) : 0.35;
  }

  at(i) { return (i % this.n + this.n) % this.n; }
  edge(i, off, y = 0) { const p = this.p[i], m = this.nrm[i]; return [p.x + m.x * off, y, p.z + m.z * off]; }

  // Лента между двумя смещениями от центра (повторяет форму трассы)
  ribbon(offA, offB, yA, yB, material, colorFn) {
    const pos = [], col = [], uv = [], idx = [];
    const n = this.n, seg = colorFn ? n : n + 1;
    for (let k = 0; k < seg; k++) {
      const i = k % n, j = (k + 1) % n;
      if (colorFn) {                                  // отдельные квадраты, чтобы красить полосками
        const c = colorFn(i), base = pos.length / 3;
        for (const [ii, off, y] of [[i, offA, yA], [i, offB, yB], [j, offA, yA], [j, offB, yB]]) { pos.push(...this.edge(ii, off, y)); col.push(c.r, c.g, c.b); }
        idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      } else {
        pos.push(...this.edge(i, offA, yA), ...this.edge(i, offB, yB));
        const v = k * C.sampleStep / C.trackWidth;
        uv.push(0, v, 1, v);
        if (k < n) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    else g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    this.group.add(m);
    return m;
  }

  buildRoad() {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
    const x = cv.getContext('2d');
    x.fillStyle = '#4a3a48'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 1400; i++) { const v = 50 + Math.random() * 40; x.fillStyle = `rgba(${v},${v - 10},${v},0.35)`; x.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
    x.fillStyle = 'rgba(255,255,255,.35)'; x.fillRect(62, 0, 4, 48);          // пунктир по центру
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.ribbon(this.half, -this.half, 0.02, 0.02, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  }

  buildCurbs() {
    const red = new THREE.Color('#ff3b4e'), white = new THREE.Color('#f4eef2');
    const stripe = i => (Math.floor(this.dist[i] / C.curbStripe) % 2 ? red : white);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const h = this.half, w = C.curbWidth;
    this.ribbon(h, h - w, 0.06, 0.06, mat, stripe);
    this.ribbon(-h + w, -h, 0.06, 0.06, mat, stripe);
  }

  buildWalls() {
    const mat = new THREE.MeshStandardMaterial({ color: '#d9c7cf', roughness: 0.7, side: THREE.DoubleSide });
    const top = new THREE.MeshStandardMaterial({ color: '#ff8a5c', roughness: 0.5, emissive: '#5a1408' });
    const H = C.wallHeight, T = C.wallThick, h = this.half;
    // правая сторона — сплошная по всему кругу
    this.wallFace(-h, H, mat); this.wallFace(-h - T, H, mat);
    this.ribbon(-h, -h - T, H, H, top);
    // левая: вне пит-лейна — обычная стена, на пит-лейне — внешняя стена отодвигается, а между дорогой и
    // пит-лейном появляется разделительная стенка
    const s0 = this.pitStart, L = this.pitLen;
    this.wallRange(s0 + L, this.n - L, h, h + T, mat, top);
    const outer = i => Math.max(h, this.pitOff(i) + this.ph);
    this.wallRange(s0, L, outer, i => outer(i) + T, mat, top);
    let k0 = 0; while (k0 < L && this.sepGap(this.at(s0 + k0)) < 0.3) k0++;
    let k1 = L; while (k1 > k0 && this.sepGap(this.at(s0 + k1)) < 0.3) k1--;
    if (k1 > k0) this.wallRange(s0 + k0, k1 - k0, h, i => this.pitOff(i) - this.ph, mat, top);
    // Столбики с подсветкой — дают ощущение скорости
    const geo = new THREE.BoxGeometry(T * 1.6, H * 1.5, T * 1.6);
    const pm = new THREE.MeshStandardMaterial({ color: '#efe3e8', roughness: 0.6 });
    const lamp = new THREE.MeshBasicMaterial({ color: '#ffb36b' });
    const lg = new THREE.BoxGeometry(T * 1.7, 0.35, T * 1.7);
    // все столбики — один «размноженный» объект (InstancedMesh): 2 вызова отрисовки вместо ~120
    const spots = [];
    for (let i = 0; i < this.n; i += C.pillarEvery) for (const s of [1, -1]) spots.push(this.edge(i, s > 0 ? Math.max(h, this.pitOff(i) + this.ph) + T / 2 : -(h + T / 2)));
    const pillars = new THREE.InstancedMesh(geo, pm, spots.length), lamps = new THREE.InstancedMesh(lg, lamp, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, , z], k) => { pillars.setMatrixAt(k, m.makeTranslation(x, H * 0.75, z)); lamps.setMatrixAt(k, m.makeTranslation(x, H * 1.35, z)); });
    pillars.castShadow = true; pillars.receiveShadow = true;
    pillars.computeBoundingSphere(); lamps.computeBoundingSphere();
    this.group.add(pillars, lamps);
  }

  // Вертикальная стенка вдоль трассы на смещении off (материал двусторонний)
  wallFace(off, H, mat) {
    const pos = [], idx = [], n = this.n;
    for (let k = 0; k <= n; k++) { const i = k % n; pos.push(...this.edge(i, off, 0), ...this.edge(i, off, H)); }
    for (let k = 0; k < n; k++) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true;
    this.group.add(m);
  }

  buildStart() {
    // Клетчатая линия старта
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 2;
    const x = cv.getContext('2d');
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#111' : '#fff'; x.fillRect(i, j, 1, 1); }
    const tex = new THREE.CanvasTexture(cv); tex.magFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    const line = new THREE.Mesh(new THREE.PlaneGeometry(C.trackWidth, 1.6), new THREE.MeshStandardMaterial({ map: tex }));
    const p = this.p[0], t = this.t[0];
    line.rotation.order = 'YXZ';
    line.rotation.y = Math.atan2(t.x, t.z);   // ширина плоскости — поперёк трассы
    line.rotation.x = -Math.PI / 2;
    line.position.set(p.x, 0.05, p.z);
    this.group.add(line);
  }

  // Ближайший сегмент к точке; ищем рядом с прошлым, чтобы не перепрыгивать на соседний участок трассы
  nearest(x, z, hint = -1) {
    let best = 0, bd = Infinity;
    const from = hint < 0 ? 0 : hint - 25, to = hint < 0 ? this.n : hint + 25;
    for (let k = from; k < to; k++) {
      const i = this.at(k), p = this.p[i], d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  // Смещение точки от центра (знак: + влево)
  lateral(i, x, z) { const p = this.p[i], m = this.nrm[i]; return (x - p.x) * m.x + (z - p.z) * m.z; }
}
