import * as THREE from 'three';
import { C, TRACK_POINTS } from './config.js';

// Замкнутая трасса: центральная линия разбита на сегменты, у каждого есть точка, направление и нормаль (влево).
export class Track {
  constructor(scene) {
    const curve = new THREE.CatmullRomCurve3(TRACK_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
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
    this.buildRoad(); this.buildCurbs(); this.buildWalls(); this.buildStart();
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
    for (const s of [1, -1]) {
      const inner = s * h, outer = s * (h + T);
      this.wallFace(inner, H, mat);
      this.wallFace(outer, H, mat);
      this.ribbon(s > 0 ? outer : inner, s > 0 ? inner : outer, H, H, top);
    }
    // Столбики с подсветкой — дают ощущение скорости
    const geo = new THREE.BoxGeometry(T * 1.6, H * 1.5, T * 1.6);
    const pm = new THREE.MeshStandardMaterial({ color: '#efe3e8', roughness: 0.6 });
    const lamp = new THREE.MeshBasicMaterial({ color: '#ffb36b' });
    const lg = new THREE.BoxGeometry(T * 1.7, 0.35, T * 1.7);
    for (let i = 0; i < this.n; i += C.pillarEvery) for (const s of [1, -1]) {
      const [x, , z] = this.edge(i, s * (h + T / 2));
      const p = new THREE.Mesh(geo, pm); p.position.set(x, H * 0.75, z); p.castShadow = true; this.group.add(p);
      const l = new THREE.Mesh(lg, lamp); l.position.set(x, H * 1.35, z); this.group.add(l);
    }
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

    // Зарядная площадка сразу за стартом
    const segs = Math.round(C.padLength / C.sampleStep);
    this.padFrom = 3; this.padTo = 3 + segs;
    const pad = new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.35, side: THREE.DoubleSide });
    const pos = [], idx = [];
    for (let k = 0; k <= segs; k++) { const i = this.padFrom + k; pos.push(...this.edge(i, this.half * 0.45, 0.04), ...this.edge(i, -this.half * 0.45, 0.04)); }
    for (let k = 0; k < segs; k++) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    this.padMesh = new THREE.Mesh(g, pad); this.group.add(this.padMesh);
  }

  onPad(i) { return i >= this.padFrom && i <= this.padTo; }

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
