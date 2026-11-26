import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* Кухня вокруг трассы. Масштаб «глазами робота»: 1 ед ≈ 7 см (столешница на высоте 13 ед ≈ 90 см).

   Стены с гарнитуром стоят вплотную к трассе (комната подогнана под её габариты), мебель внутри —
   как можно ближе к дороге. Камера смотрит сверху с юга (со стороны +z), поэтому:
     • южной стены нет — вид «как в кукольном домике»;
     • высокий предмет может стоять вплотную к трассе, если трасса проходит южнее него,
       а если трасса севернее — нужен зазор ≈ ¾ высоты, иначе предмет закроет робота.
   Это проверяет canPlace(); findSpot() ищет ближайшее к трассе место, где предмет ничего не закрывает. */

// Материалы с одинаковыми настройками — общие (так их детали можно склеить в один объект, см. mergeStatic)
const MATS = new Map();
const mat = (color, o = {}) => {
  const key = color + JSON.stringify(o);
  if (!MATS.has(key)) MATS.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o }));
  return MATS.get(key);
};
const COUNTER_H = 13, DEPTH = 9, GAP = 0.6;   // высота столешницы, глубина шкафов, зазор от гарнитура до трассы
const GAP_IN = 3;                               // зазор от мебели внутри комнаты до бортика

const M = {
  wall: mat('#efe7dc', { roughness: 0.95 }),
  base: mat('#2e3034', { roughness: 0.8 }),
  cab: mat('#3b3e43', { roughness: 0.6 }),           // фасады — матовый графит
  cabDark: mat('#2c2f33', { roughness: 0.6 }),
  handle: mat('#c9a25a', { metalness: 0.9, roughness: 0.3 }),   // латунные ручки
  top: mat('#c08d5e', { roughness: 0.5 }),           // столешница — тёплое дерево
  steel: mat('#cfd4d8', { metalness: 0.75, roughness: 0.3 }),
  black: mat('#1d1a1c', { roughness: 0.25, metalness: 0.2 }),
  glass: new THREE.MeshStandardMaterial({ color: '#cfe8ff', emissive: '#a9d6ff', emissiveIntensity: 0.55, roughness: 0.1 }),
  wood: mat('#a87448', { roughness: 0.55 }),
  woodDark: mat('#6e4a2b', { roughness: 0.6 }),
  white: mat('#f7f4ef', { roughness: 0.45 }),
  red: mat('#d9503f', { roughness: 0.5 }),
  green: mat('#4f8f56', { roughness: 0.8 }),
  pot: mat('#e9e4dc', { roughness: 0.6 }),
  soil: mat('#3d2a1d', { roughness: 1 }),
};

// Фартук над столешницей — белая плитка «кабанчик»
function subwayTexture() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
  const x = cv.getContext('2d');
  x.fillStyle = '#d9d2c8'; x.fillRect(0, 0, 128, 64);
  for (let r = 0; r < 4; r++) for (let c = -1; c < 4; c++) {
    const v = 240 + Math.random() * 10;
    x.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
    x.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
  }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Kitchen {
  constructor(scene, track) {
    this.track = track; this.taken = []; this.anim = [];
    this.g = new THREE.Group(); scene.add(this.g);
    this.collectTrackPoints();
    this.fitRoom();
    this.floor(); this.walls();
    this.northRun(); this.westRun(); this.eastRun();
    this.placeInterior();
    if (!new URLSearchParams(location.search).has('nomerge')) this.mergeStatic();   // ?nomerge — для сравнения скорости
  }

  // Оптимизация: тысячи неподвижных деталей склеиваются в общие объекты — по одному на материал в каждом
  // участке комнаты 64×64 (участки нужны, чтобы невидимое за кадром по-прежнему не рисовалось).
  // Видеокарте так нужно в разы меньше отдельных вызовов отрисовки. Подвижное (помечено userData.dynamic)
  // и прозрачное (стекло, вода, пар) не склеиваются.
  mergeStatic() {
    this.g.updateMatrixWorld(true);
    const CELL = 64, buckets = new Map(), victims = [];
    const isDynamic = o => { for (let p = o; p && p !== this.g; p = p.parent) if (p.userData.dynamic) return true; return false; };
    this.g.traverse(o => {
      if (!o.isMesh || o.material.transparent || Array.isArray(o.material) || isDynamic(o)) return;
      const c = new THREE.Vector3(); o.getWorldPosition(c);
      const key = `${o.material.uuid}|${o.castShadow ? 1 : 0}|${Math.floor(c.x / CELL)}|${Math.floor(c.z / CELL)}`;
      let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      if (!geo.attributes.normal) geo.computeVertexNormals();
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(o.matrixWorld);
      if (!buckets.has(key)) buckets.set(key, { mat: o.material, shadow: o.castShadow, geos: [] });
      buckets.get(key).geos.push(geo); victims.push(o);
    });
    for (const o of victims) o.parent.remove(o);
    this.merged = new THREE.Group(); this.g.add(this.merged);
    for (const b of buckets.values()) {
      const geo = mergeGeometries(b.geos, false);
      if (!geo) continue;
      const m = new THREE.Mesh(geo, b.mat); m.castShadow = b.shadow; m.receiveShadow = true;
      this.merged.add(m);
    }
    this.mergeStats = { from: victims.length, to: this.merged.children.length };
  }

  // ── Геометрия трассы: точки, которые нельзя занимать и закрывать ─────────────────
  collectTrackPoints() {
    // каждая точка (не через одну) — иначе на изгибах углы мебели проскальзывают под бортик
    const t = this.track, T = 1, pts = [];
    for (let i = 0; i < t.n; i++) pts.push({ x: t.p[i].x, z: t.p[i].z, r: t.half + T, tx: t.t[i].x, tz: t.t[i].z });
    for (let k = 0; k <= t.pitLen; k++) {           // пит-лейн
      const i = t.at(t.pitStart + k), [x, , z] = t.edge(i, t.pitOff(i));
      pts.push({ x, z, r: t.ph + T, tx: t.t[i].x, tz: t.t[i].z });
    }
    this.pts = pts;
  }

  // Комната вплотную к трассе: стены с шкафами — сразу за дорогой
  fitRoom() {
    const xs = this.pts.map(p => [p.x - p.r, p.x + p.r]).flat(), zs = this.pts.map(p => [p.z - p.r, p.z + p.r]).flat();
    const m = DEPTH + GAP + 0.4;
    this.room = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + 30, wallH: 40 };
  }

  // Предмет w×d (w — вдоль своей оси x, d — вдоль z) с центром (x, z), повёрнутый на r вокруг вертикали.
  // Возвращает зазор до трассы (−1 — нельзя: наезжает на трассу, закрывает её от камеры или задевает другую мебель).
  clearance(x, z, w, d, h, r) {
    const R = this.room, c = Math.cos(r), s = Math.sin(r);
    const hw = Math.abs(c) * w / 2 + Math.abs(s) * d / 2, hd = Math.abs(s) * w / 2 + Math.abs(c) * d / 2;   // габарит по осям мира
    if (x - hw < R.x0 + DEPTH + 1 || x + hw > R.x1 - DEPTH - 1 || z - hd < R.z0 + DEPTH + 1) return -1;
    let m = Infinity;
    for (const p of this.pts) {
      const ex = p.x - x, ez = p.z - z;
      const lx = ex * c - ez * s, lz = ex * s + ez * c;                     // точка трассы в осях предмета
      const gap = Math.hypot(Math.max(Math.abs(lx) - w / 2, 0), Math.max(Math.abs(lz) - d / 2, 0)) - p.r;
      if (gap < GAP_IN) return -1;                                           // слишком близко к бортику
      const north = (z - hd) - p.z;                                          // трасса севернее предмета?
      if (north > 0 && Math.abs(ex) < hw + p.r && north < h * 0.75 + p.r) return -1;   // закроет её от камеры
      m = Math.min(m, gap);
    }
    if (this.taken.some(t => Math.abs(t.x - x) < t.hw + hw + 2 && Math.abs(t.z - z) < t.hd + hd + 2)) return -1;
    return m;
  }

  // Поворот, при котором предмет стоит длинной стороной вдоль ближайшего участка трассы и «лицом» (+z) к ней
  facing(x, z) {
    let best = null, bd = Infinity;
    for (const p of this.pts) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } }
    let r = Math.atan2(-best.tz, best.tx);                                   // локальная x → касательная трассы
    if (Math.sin(r) * (best.x - x) + Math.cos(r) * (best.z - z) < 0) r += Math.PI;   // локальная +z → к трассе
    return r;
  }

  // Ближайшее к трассе подходящее место в круге радиуса R вокруг (cx, cz); align — разворачивать вдоль трассы
  findSpot(cx, cz, R, w, d, h, align = true) {
    let best = null, bd = Infinity;
    for (let x = cx - R; x <= cx + R; x += 2) for (let z = cz - R; z <= cz + R; z += 2) {
      if ((x - cx) ** 2 + (z - cz) ** 2 > R * R) continue;
      const r = align ? this.facing(x, z) : 0, m = this.clearance(x, z, w, d, h, r);
      if (m >= 0 && m < bd) { bd = m; best = { x, z, r }; }
    }
    if (best) {
      const c = Math.abs(Math.cos(best.r)), s = Math.abs(Math.sin(best.r));
      this.taken.push({ x: best.x, z: best.z, hw: c * w / 2 + s * d / 2, hd: s * w / 2 + c * d / 2, flat: h < 0.5 });   // flat — ковёр, по нему можно ходить
    }
    return best;
  }

  // ── Примитивы ───────────────────────────────────────────────────────────────
  box(w, h, d, m, x, y, z, parent = this.g, shadow = true) {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
  }
  cyl(rt, rb, h, m, x, y, z, parent = this.g, seg = 24) {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
    o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
  }
  group(x, z, rotY = 0) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rotY; this.g.add(g); return g; }

  // ── Пол и стены ─────────────────────────────────────────────────────────────
  // Пол — тёмный ореховый паркет: доски разного оттенка со смещёнными стыками и прожилками
  floor() {
    const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const x = cv.getContext('2d'), rows = 8, h = S / rows, len = S / 2;
    for (let r = 0; r < rows; r++) {
      const shift = (r * 0.37 % 1) * len;
      for (let c = -1; c < 3; c++) {
        const x0 = c * len + shift, v = Math.random();
        x.fillStyle = `rgb(${68 + v * 22},${44 + v * 14},${30 + v * 9})`; x.fillRect(x0, r * h, len, h);
        for (let k = 0; k < 14; k++) {                         // прожилки вдоль доски
          x.strokeStyle = `rgba(${Math.random() < 0.5 ? '30,18,10' : '120,85,55'},${0.12 + Math.random() * 0.15})`;
          x.lineWidth = 0.6 + Math.random(); x.beginPath();
          const y = r * h + Math.random() * h; x.moveTo(x0, y);
          x.bezierCurveTo(x0 + len * 0.3, y + (Math.random() - 0.5) * 6, x0 + len * 0.7, y + (Math.random() - 0.5) * 6, x0 + len, y + (Math.random() - 0.5) * 4);
          x.stroke();
        }
        x.fillStyle = 'rgba(15,8,4,0.7)'; x.fillRect(x0, r * h, 2, h);    // стык
      }
      x.fillStyle = 'rgba(15,8,4,0.75)'; x.fillRect(0, r * h, S, 2);      // шов между рядами
    }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const W = 1400, tileW = 34, tileH = 24;          // одна текстура = 2 доски по длине (≈ 1.2 м), 8 рядов по ≈ 20 см
    tex.repeat.set(W / tileW, W / tileH);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(W, W), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45 }));
    fl.rotation.x = -Math.PI / 2; fl.position.y = -0.02; fl.receiveShadow = true; this.g.add(fl);
  }

  walls() {
    const { x0, x1, z0, z1, wallH: H } = this.room;
    this.box(x1 - x0 + 4, H, 2, M.wall, (x0 + x1) / 2, H / 2, z0 - 1, this.g, false);
    this.box(2, H, z1 - z0, M.wall, x0 - 1, H / 2, (z0 + z1) / 2, this.g, false);
    this.box(2, H, z1 - z0, M.wall, x1 + 1, H / 2, (z0 + z1) / 2, this.g, false);
  }

  // ── Гарнитур ────────────────────────────────────────────────────────────────
  // Ряд вдоль стены. Локальная ось x — вдоль стены, +z — в комнату, z = 0 — середина глубины шкафов.
  // items: особые места {x, w, kind} (плита, мойка, холодильник…); всё остальное — шкафчики.
  run(parent, from, to, items, uppers = true) {
    const special = items.slice().sort((a, b) => a.x - b.x);
    let x = from;
    for (const it of [...special, { x: to, w: 0 }]) {
      const end = it.x - it.w / 2;
      const n = Math.max(0, Math.round((end - x) / 9));         // ровные дверцы одинаковой ширины
      for (let k = 0; k < n; k++) { const w = (end - x) / n; this.cabinet(parent, x + w * (k + 0.5), w, k % 3 === 1); }
      if (it.kind) this[it.kind](parent, it.x, it.w);
      x = it.x + it.w / 2;
    }
    // столешница и фартук — везде, кроме высоких колонн
    let s = from;
    for (const it of [...special.filter(i => i.tall), { x: to, w: 0 }]) {
      const e = it.x - it.w / 2;
      if (e > s + 0.5) {
        this.box(e - s, 0.9, DEPTH + 0.6, M.top, (s + e) / 2, COUNTER_H + 0.45, 0.3, parent);
        const tex = subwayTexture(); tex.repeat.set((e - s) / 8, 2.5);
        const bs = new THREE.Mesh(new THREE.PlaneGeometry(e - s, 10), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.3 }));
        bs.position.set((s + e) / 2, COUNTER_H + 5.9, -DEPTH / 2 + 0.05); parent.add(bs);
        if (uppers) this.uppers(parent, s, e, special.filter(i => i.noUpper));
      }
      s = it.x + it.w / 2;
    }
  }

  cabinet(p, x, w, drawers) {
    this.box(w - 0.15, COUNTER_H - 1.5, DEPTH - 0.4, M.cab, x, (COUNTER_H - 1.5) / 2 + 1, -0.2, p);
    this.box(w - 0.15, 1, DEPTH - 1.2, M.black, x, 0.5, -0.4, p, false);                       // цоколь
    const f = DEPTH / 2 - 0.35;
    if (drawers) {
      for (let k = 1; k < 3; k++) this.box(w - 0.5, 0.1, 0.06, M.cabDark, x, 1 + k * (COUNTER_H - 2) / 3, f, p, false);
      for (let k = 0; k < 3; k++) this.box(w * 0.4, 0.25, 0.25, M.handle, x, 1 + (k + 0.75) * (COUNTER_H - 2) / 3, f + 0.1, p, false);
    } else {
      this.box(0.25, 3.2, 0.25, M.handle, x + w / 2 - 1, COUNTER_H - 3.6, f + 0.1, p, false);
    }
  }

  uppers(p, from, to, gaps) {
    const n = Math.max(1, Math.round((to - from) / 9)), w = (to - from) / n;
    for (let k = 0; k < n; k++) {
      const x = from + w * (k + 0.5);
      if (gaps.some(g => Math.abs(g.x - x) < (g.w + w) / 2 - 0.5)) continue;
      this.box(w - 0.15, 9, 5.5, M.cab, x, COUNTER_H + 15.5, -DEPTH / 2 + 2.75, p);
      this.box(0.25, 2.6, 0.25, M.handle, x + w / 2 - 1, COUNTER_H + 12.3, -DEPTH / 2 + 5.6, p, false);
    }
    // подсветка под навесными шкафами
    const strip = new THREE.Mesh(new THREE.BoxGeometry(to - from, 0.15, 0.6), new THREE.MeshBasicMaterial({ color: '#fff4d6' }));
    strip.position.set((from + to) / 2, COUNTER_H + 10.9, -DEPTH / 2 + 4.5); p.add(strip);
  }

  sink(p, x, w) {
    this.cabinet(p, x, w, false);
    this.box(w * 0.75, 0.3, DEPTH * 0.6, M.steel, x, COUNTER_H + 0.95, 0, p);
    this.box(w * 0.65, 0.2, DEPTH * 0.5, M.black, x, COUNTER_H + 1.05, 0, p, false);           // чаша
    this.cyl(0.3, 0.4, 5, M.steel, x, COUNTER_H + 3.4, -DEPTH / 2 + 1.3, p, 12);
    this.box(0.5, 0.5, 3.2, M.steel, x, COUNTER_H + 5.8, -DEPTH / 2 + 2.6, p);
    this.water(p, x, COUNTER_H + 5.55, -DEPTH / 2 + 4, COUNTER_H + 1.16);
    // окно над мойкой вместо навесных шкафов
    const W = w * 1.8;
    this.box(W, 13, 0.3, M.glass, x, COUNTER_H + 15, -DEPTH / 2 - 0.1, p, false);
    for (const dx of [-0.5, 0, 0.5]) this.box(0.6, 13.6, 0.8, M.white, x + dx * W, COUNTER_H + 15, -DEPTH / 2 + 0.1, p, false);
    for (const y of [8.2, 21.8]) this.box(W + 0.6, 0.7, 0.8, M.white, x, COUNTER_H + y, -DEPTH / 2 + 0.1, p, false);
  }

  // Вода из крана: струя от носика (top) до дна мойки (bottom), «текущая» текстура и круги на воде
  water(p, x, top, z, bottom) {
    if (!this.waterTex) {
      const cv = document.createElement('canvas'); cv.width = 16; cv.height = 64;
      const c = cv.getContext('2d');
      for (let y = 0; y < 64; y++) { const v = 200 + Math.random() * 55; c.fillStyle = `rgb(${v - 40},${v - 10},255)`; c.fillRect(0, y, 16, 1); }
      for (let k = 0; k < 10; k++) { c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(Math.random() * 12, Math.random() * 64, 2, 4 + Math.random() * 8); }   // блики
      this.waterTex = new THREE.CanvasTexture(cv); this.waterTex.wrapS = this.waterTex.wrapT = THREE.RepeatWrapping;
    }
    const tex = this.waterTex.clone(); tex.needsUpdate = true; tex.repeat.set(1, 2);
    const h = top - bottom;
    const stream = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, h, 10, 1, true),
      new THREE.MeshStandardMaterial({ map: tex, color: '#cfeaff', emissive: '#4a90d9', emissiveIntensity: 0.25, transparent: true, opacity: 0.75, roughness: 0.05, depthWrite: false }));
    stream.position.set(x, bottom + h / 2, z); p.add(stream);
    // лужица воды в мойке и расходящиеся круги
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshStandardMaterial({ color: '#9fd0ff', transparent: true, opacity: 0.45, roughness: 0.05, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2; pool.position.set(x, bottom + 0.02, z); p.add(pool);
    const rings = [0, 1, 2].map(() => {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 28), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      r.rotation.x = -Math.PI / 2; r.position.set(x, bottom + 0.04, z); p.add(r); return r;
    });
    const ph = Math.random() * 3;
    this.anim.push(t => {
      tex.offset.y = (t * 2.2 + ph) % 1;                                    // вода бежит вниз
      const s = 1 + Math.sin(t * 23) * 0.06; stream.scale.set(s, 1, 1 / s);   // струя чуть дрожит
      rings.forEach((r, k) => { const f = (t * 0.9 + k / 3 + ph) % 1; r.scale.setScalar(0.3 + f * 1.8); r.material.opacity = 0.5 * (1 - f); });
    });
  }

  stove(p, x, w) {
    this.box(w - 0.15, COUNTER_H - 1, DEPTH - 0.4, M.black, x, (COUNTER_H - 1) / 2 + 1, -0.2, p);
    this.box(w * 0.82, COUNTER_H * 0.45, 0.15, mat('#2c2a2e', { roughness: 0.1, metalness: 0.4 }), x, COUNTER_H * 0.4, DEPTH / 2 - 0.3, p, false);
    this.box(w * 0.7, 0.3, 0.5, M.steel, x, COUNTER_H * 0.7, DEPTH / 2 - 0.05, p, false);
    for (let k = 0; k < 4; k++) { const r = this.cyl(0.38, 0.38, 0.5, M.steel, x - w * 0.3 + k * w * 0.2, COUNTER_H * 0.86, DEPTH / 2 - 0.15, p, 12); r.rotation.x = Math.PI / 2; }
    this.box(w - 0.15, 0.35, DEPTH, M.black, x, COUNTER_H + 0.18, 0.3, p);
    const on = new THREE.MeshBasicMaterial({ color: '#ff5a2e' }), off = mat('#3a3638');
    for (const [dx, dz, r, hot] of [[-1, -1, 1.4, 0], [1, -1, 1.1, 0], [-1, 1, 1.1, 1], [1, 1, 1.4, 0]]) {
      const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.75, r, 28), hot ? on : off);
      m.rotation.x = -Math.PI / 2; m.position.set(x + dx * w * 0.22, COUNTER_H + 0.37, 0.3 + dz * DEPTH * 0.2); p.add(m);
    }
    this.box(w + 1, 2.5, DEPTH * 0.75, M.steel, x, COUNTER_H + 17.5, -DEPTH * 0.12, p);       // вытяжка
    this.box(w * 0.4, 14, DEPTH * 0.4, M.steel, x, COUNTER_H + 25, -DEPTH * 0.3, p);
    // сковорода на горячей конфорке
    this.cyl(1.4, 1.2, 0.5, mat('#2b2a2c', { metalness: 0.5, roughness: 0.4 }), x - w * 0.22, COUNTER_H + 0.65, 0.3 + DEPTH * 0.2, p);
    this.box(0.4, 0.3, 3, mat('#2b2a2c'), x - w * 0.22, COUNTER_H + 0.75, 0.3 + DEPTH * 0.2 + 2.6, p);
    this.steam(p, x - w * 0.22, COUNTER_H + 1.2, 0.3 + DEPTH * 0.2, 1.2);
  }

  dishwasher(p, x, w) {
    this.box(w - 0.15, COUNTER_H - 1.5, DEPTH - 0.4, M.steel, x, (COUNTER_H - 1.5) / 2 + 1, -0.2, p);
    this.box(w - 1, 0.35, 0.4, M.black, x, COUNTER_H - 1.8, DEPTH / 2 - 0.1, p, false);
    this.box(1.2, 0.3, 0.1, new THREE.MeshBasicMaterial({ color: '#58d68d' }), x + w / 2 - 1.5, COUNTER_H - 1.8, DEPTH / 2 + 0.12, p, false);
  }

  fridge(p, x, w) {
    const H = 28;
    this.box(w, H, DEPTH + 1, M.steel, x, H / 2, 0.3, p);
    this.box(w - 0.3, 0.15, 0.1, M.black, x, H * 0.62, DEPTH / 2 + 0.85, p, false);
    for (const [y, h] of [[H * 0.8, 6], [H * 0.36, 9]]) this.box(0.4, h, 0.5, M.handle, x - w / 2 + 1.2, y, DEPTH / 2 + 1.1, p, false);
    this.box(3, 4, 0.1, mat('#283038', { roughness: 0.2 }), x + w * 0.2, H * 0.78, DEPTH / 2 + 0.85, p, false);   // дисплей
  }

  // Колонна со встроенной духовкой и микроволновкой
  ovens(p, x, w) {
    const H = 28;
    this.box(w, H, DEPTH, M.cab, x, H / 2, 0, p);
    for (const [y, h] of [[COUNTER_H - 2.5, 6.5], [COUNTER_H + 5.5, 4.5]]) {
      this.box(w - 1.2, h, 0.2, M.black, x, y, DEPTH / 2 + 0.05, p, false);
      this.box(w - 2.5, h - 2, 0.1, mat('#3a3a40', { roughness: 0.05, metalness: 0.5 }), x, y - 0.3, DEPTH / 2 + 0.2, p, false);
      this.box(w - 2, 0.3, 0.4, M.steel, x, y + h / 2 - 0.6, DEPTH / 2 + 0.3, p, false);
    }
  }

  // Открытая полка с банками и посудой (вместо навесного шкафа)
  shelf(p, x, w) {
    this.cabinet(p, x, w, true);
    for (const y of [COUNTER_H + 11, COUNTER_H + 17]) {
      this.box(w, 0.5, 4, M.wood, x, y, -DEPTH / 2 + 2, p);
      for (let k = 0; k < 3; k++) {
        const jx = x - w * 0.32 + k * w * 0.32;
        if (y < COUNTER_H + 15) this.cyl(0.9, 0.9, 2.6, M.glass, jx, y + 1.55, -DEPTH / 2 + 2, p, 14);
        else this.box(2.2, 2.4, 0.4, [M.white, mat('#f0d9b5'), M.green][k], jx, y + 1.45, -DEPTH / 2 + 1, p);
      }
    }
  }

  // Вещи на столешнице (в координатах ряда)
  counterProps(p, list) {
    const Y = COUNTER_H + 0.9;
    for (const [kind, x] of list) {
      if (kind === 'kettle') { this.cyl(1.4, 1.8, 3.4, M.white, x, Y + 1.7, 0, p); this.cyl(0.9, 1.3, 0.5, M.black, x, Y + 0.25, 0, p); this.steam(p, x + 0.8, Y + 3.6, 0, 0.6); }
      if (kind === 'coffee') { this.box(3.4, 5, 3.6, M.black, x, Y + 2.5, -1, p); this.cyl(0.7, 0.6, 1.2, M.white, x, Y + 0.6, 1, p); }
      if (kind === 'toaster') { this.box(3.6, 2.6, 2.2, M.red, x, Y + 1.3, 0, p); }
      if (kind === 'board') { this.box(7, 0.5, 4.5, M.wood, x, Y + 0.25, 0.5, p); this.box(3, 1.4, 1.6, mat('#d9a45a'), x + 0.5, Y + 1.2, 0.5, p); }
      if (kind === 'knives') { this.box(2, 3.4, 2, M.woodDark, x, Y + 1.7, -1.5, p); for (let k = 0; k < 3; k++) this.box(0.3, 1.5, 0.3, M.black, x - 0.5 + k * 0.5, Y + 4, -1.5, p); }
      if (kind === 'fruit') { this.cyl(2.4, 1.4, 1.2, M.white, x, Y + 0.6, 0.5, p); for (const [a, m] of [[0, M.red], [2.1, mat('#f4b400')], [4.2, M.green]]) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), m); f.position.set(x + Math.cos(a) * 0.8, Y + 1.6, 0.5 + Math.sin(a) * 0.8); p.add(f); } }
      if (kind === 'oil') { for (const [dx, c, h] of [[0, '#d8b23a', 4.2], [1.3, '#5b7d3a', 3.6], [2.4, '#f2efe8', 2]]) { this.cyl(0.55, 0.55, h, mat(c, { roughness: 0.15, transparent: true, opacity: 0.85 }), x + dx, Y + h / 2, -2.2, p, 12); this.cyl(0.25, 0.25, 0.8, M.black, x + dx, Y + h + 0.4, -2.2, p, 8); } }
      if (kind === 'towel') { this.cyl(0.15, 0.15, 4.6, M.handle, x, Y + 2.3, -2, p, 8); this.cyl(1.1, 1.1, 3.8, M.white, x, Y + 2.2, -2, p, 16); this.cyl(1.2, 1.2, 0.2, M.woodDark, x, Y + 0.1, -2, p, 16); }
      if (kind === 'crock') { this.cyl(1.2, 1, 2.8, mat('#e9e4dc', { roughness: 0.4 }), x, Y + 1.4, -2, p, 14); for (let k = 0; k < 4; k++) { const u = this.cyl(0.12, 0.12, 4, k % 2 ? M.woodDark : M.steel, x + (k - 1.5) * 0.4, Y + 4, -2, p, 6); u.rotation.z = (k - 1.5) * 0.15; } }
      if (kind === 'mugs') { for (let k = 0; k < 3; k++) { this.cyl(0.75, 0.7, 1.5, [M.white, mat('#c9a25a'), M.cab][k], x + k * 1.9, Y + 0.75, 1, p, 14); } }
      if (kind === 'books') { for (let k = 0; k < 4; k++) this.box(0.7, 3.4 - k * 0.3, 2.6, [M.red, mat('#e9e1d3'), mat('#3b5a7a'), mat('#c9a25a')][k], x + k * 0.75, Y + (3.4 - k * 0.3) / 2, -2.4, p); }
      if (kind === 'wine') { for (let k = 0; k < 2; k++) { this.cyl(0.6, 0.6, 3.6, mat('#2a1a1e', { roughness: 0.15 }), x + k * 1.4, Y + 1.8, -2.2, p, 12); this.cyl(0.25, 0.3, 1.4, mat('#2a1a1e', { roughness: 0.15 }), x + k * 1.4, Y + 4.3, -2.2, p, 8); } }
      if (kind === 'herbs') { for (let k = 0; k < 3; k++) { this.cyl(0.9, 0.7, 1.6, M.pot, x + k * 2.2, Y + 0.8, -2, p, 12); const h = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), M.green); h.scale.y = 0.8; h.position.set(x + k * 2.2, Y + 2.3, -2); p.add(h); } }
    }
  }

  northRun() {
    const R = this.room, p = this.group(0, R.z0 + DEPTH / 2);
    const a = R.x0 + DEPTH, b = R.x1 - DEPTH, L = b - a;
    const at = f => a + L * f;
    this.run(p, a, b, [
      { x: at(0.06), w: 14, kind: 'fridge', tall: true },
      { x: at(0.13), w: 10, kind: 'ovens', tall: true },
      { x: at(0.33), w: 10, kind: 'shelf', noUpper: true },
      { x: at(0.5), w: 12, kind: 'sink', noUpper: true },
      { x: at(0.58), w: 9, kind: 'dishwasher' },
      { x: at(0.76), w: 11, kind: 'stove', noUpper: true },
      { x: at(0.93), w: 10, kind: 'shelf', noUpper: true },
    ]);
    this.counterProps(p, [['coffee', at(0.19)], ['mugs', at(0.215)], ['knives', at(0.25)], ['towel', at(0.28)], ['board', at(0.4)], ['oil', at(0.44)],
      ['herbs', at(0.61)], ['kettle', at(0.67)], ['crock', at(0.7)], ['books', at(0.82)], ['toaster', at(0.86)], ['fruit', at(0.89)], ['wine', at(0.98)]]);
    this.rail(p, at(0.76) + 10, 12);
    this.clock(p, at(0.33), COUNTER_H + 24);
  }

  // Рейлинг на фартуке с половниками и сковородкой
  rail(p, x, w) {
    const y = COUNTER_H + 9, z = -DEPTH / 2 + 0.6;
    const r = this.cyl(0.2, 0.2, w, M.handle, x, y, z, p, 8); r.rotation.z = Math.PI / 2;
    for (let k = 0; k < 4; k++) {
      const hx = x - w / 2 + 1.5 + k * 2.6;
      this.cyl(0.08, 0.08, 3, M.steel, hx, y - 1.5, z, p, 6);
      if (k === 3) { const pan = this.cyl(1.6, 1.4, 0.4, mat('#2b2a2c', { metalness: 0.5 }), hx, y - 4.5, z + 0.3, p, 18); pan.rotation.x = Math.PI / 2; }
      else this.box(0.9, 0.5, 0.4, k === 1 ? M.woodDark : M.steel, hx, y - 3.2, z, p);
    }
  }

  // Настенные часы
  clock(p, x, y) {
    const z = -DEPTH / 2 + 0.3;
    const c = this.cyl(2.6, 2.6, 0.5, M.white, x, y, z, p, 32); c.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.25, 8, 32), M.handle); rim.position.set(x, y, z + 0.25); p.add(rim);
    for (const [len, a] of [[1.6, 0.6], [2.1, 2.4]]) { const h = this.box(0.18, len, 0.1, M.black, x, y, z + 0.35, p, false); h.geometry.translate(0, len / 2, 0); h.rotation.z = -a; }
  }

  westRun() {
    const R = this.room, p = this.group(R.x0 + DEPTH / 2, 0, Math.PI / 2);   // локальная +x → мировая −z, +z → в комнату
    const a = -(R.z1 - 25), b = -(R.z0 + DEPTH);
    this.run(p, a, b, [{ x: a + (b - a) * 0.35, w: 10, kind: 'shelf', noUpper: true }]);
    this.counterProps(p, [['herbs', a + (b - a) * 0.12], ['books', a + (b - a) * 0.22], ['wine', a + (b - a) * 0.5], ['fruit', a + (b - a) * 0.6], ['oil', a + (b - a) * 0.75], ['mugs', a + (b - a) * 0.88]]);
    this.clock(p, a + (b - a) * 0.35, COUNTER_H + 24);
  }

  eastRun() {
    const R = this.room, p = this.group(R.x1 - DEPTH / 2, 0, -Math.PI / 2);   // локальная +x → мировая +z
    const a = R.z0 + DEPTH, b = R.z1 - 25;
    this.run(p, a, b, [{ x: a + (b - a) * 0.4, w: 12, kind: 'sink', noUpper: true }, { x: a + (b - a) * 0.75, w: 10, kind: 'shelf', noUpper: true }]);
    this.counterProps(p, [['kettle', a + (b - a) * 0.12], ['crock', a + (b - a) * 0.2], ['towel', a + (b - a) * 0.3], ['board', a + (b - a) * 0.55], ['herbs', a + (b - a) * 0.62], ['coffee', a + (b - a) * 0.9]]);
  }

  // ── Мебель внутри и около трассы: ставим как можно ближе к дороге ───────────────
  placeInterior() {
    // (-36, 62) и (95, 48) — центры свободных «островов» внутри трассы
    // Каждый предмет: [что строим, точка поиска x, z, радиус поиска, ширина, глубина, высота, разворачивать ли вдоль трассы].
    // Ставим в ближайшее к трассе место вокруг точки, длинной стороной вдоль дороги и лицом к ней.
    const R = this.room;
    const list = [
      ['island', -36, 62, 50, 32, 24, COUNTER_H + 2],
      ['dining', -36, 62, 50, 36, 26, 14],
      ['catCorner', 95, 48, 32, 24, 14, 6],
      ['sideboard', -36, 20, 40, 24, 7, 15],
      ['sideboard', 100, 80, 30, 24, 7, 15],
      ['barCart', -85, 95, 30, 9, 6, 12],
      ['bench', -36, 110, 30, 18, 5, 6],
      ['floorLamp', 10, 70, 40, 5, 5, 30],
      ['basket', 120, 150, 30, 6, 6, 5],
      ['basket', -110, 150, 30, 6, 6, 5],
      ['plant', R.x0 + 22, R.z1 - 40, 25, 8, 8, 18],
      ['plant', R.x1 - 22, R.z1 - 40, 25, 8, 8, 18],
      ['plant', 60, 30, 25, 8, 8, 18],
      ['trashCan', R.x0 + 30, R.z0 + 20, 20, 7, 7, 9],
      ['rugRound', -36, 55, 40, 34, 34, 0.2, false],   // круглый — поворот не нужен
    ];
    for (const [fn, cx, cz, rad, w, d, h, align = true] of list) this.put(fn, this.findSpot(cx, cz, rad, w, d, h, align));
    this.placeVignettes();
    // коты гуляют вдоль трассы: в большом «острове» внутри, во втором и снаружи у южного края
    this.wanderingCat(-36, 62, 60);
    this.wanderingCat(95, 48, 40);
    this.wanderingCat(-60, 165, 50);
  }

  // Построить предмет fn в найденном месте s и развернуть его (каждый строитель создаёт одну группу в (x, z))
  put(fn, s) {
    if (!s) return false;
    const n = this.g.children.length;
    this[fn](s.x, s.z);
    for (const c of this.g.children.slice(n)) c.rotation.y = s.r;
    return true;
  }

  // Небольшие уютные сценки по всему кругу: идём вдоль трассы и через каждые ~40 ед пробуем поставить
  // что-нибудь то с одной, то с другой стороны дороги
  placeVignettes() {
    const t = this.track, V = Object.entries(VIGNETTES);
    let k = Math.floor(Math.random() * V.length);
    for (let i = 0; i < t.n; i += 16) for (const sd of (i / 16) % 2 ? [1, -1] : [-1, 1]) {
      // пробуем несколько сценок по очереди, пока какая-нибудь не влезет
      for (let tries = 0; tries < 3; tries++) {
        const [fn, [w, d, h]] = V[k % V.length]; k++;
        const base = sd > 0 && t.pitK(i) >= 0 ? t.pitFull + t.ph : t.half;   // со стороны пит-лейна — за ним
        const [cx, , cz] = t.edge(t.at(i + (sd > 0 ? 0 : 8)), sd * (base + 1 + GAP_IN + d / 2 + 2));
        if (this.put(fn, this.findSpot(cx, cz, 10, w, d, h))) break;
      }
    }
  }

  // Анимации окружения (дыхание животных, листья, пар); вызывается каждый кадр
  update(t) { for (const f of this.anim) f(t); }

  trashCan(x, z) {
    const g = this.group(x, z);
    this.cyl(3, 3, 8.5, M.steel, 0, 4.25, 0, g); this.cyl(3.1, 3.1, 0.5, M.black, 0, 8.6, 0, g); this.box(2, 0.4, 1.4, M.black, 0, 0.3, 3, g);
  }

  // Кухонный остров: шкафчики с одной стороны, столешница с выносом и барные стулья с другой
  island(x, z) {
    const root = this.group(x, z), W = 30, D = 10;
    const g = new THREE.Group(); g.position.z = -5; root.add(g);                 // шкафы — в северной половине места
    for (let k = 0; k < 3; k++) this.cabinet(g, -W / 2 + W / 6 * (2 * k + 1), W / 3, k === 1);
    this.box(W + 1, 1, D + 3, mat('#f4f1ec', { roughness: 0.25 }), 0, COUNTER_H + 0.5, 1.5, g);   // светлая каменная столешница с выносом
    for (let k = 0; k < 3; k++) this.stool(g, -W / 3 + k * W / 3, 9);
    this.counterProps(g, [['fruit', -6], ['board', 6]]);
  }

  stool(parent, x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); parent.add(g);
    this.cyl(2, 2, 0.8, M.woodDark, 0, 9.4, 0, g);
    for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { const l = this.cyl(0.2, 0.25, 9.2, M.black, dx * 1.3, 4.6, dz * 1.3, g, 6); l.rotation.set(dz * 0.08, 0, -dx * 0.08); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.15, 6, 20), M.black); ring.rotation.x = -Math.PI / 2; ring.position.y = 3.5; g.add(ring);
  }

  dining(x, z) {
    const g = this.group(x, z);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(36, 26), mat('#c9b79c', { roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.05; rug.receiveShadow = true; g.add(rug);
    const T = 11;
    this.box(22, 0.9, 12, M.wood, 0, T, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.9, T, 0.9, M.woodDark, sx * 9.8, T / 2, sz * 5, g);
    for (const [cx, cz, r] of [[-5.5, -9, 0], [5.5, -9, 0], [-5.5, 9, Math.PI], [5.5, 9, Math.PI]]) this.chair(g, cx, cz, r);
    this.cyl(1.2, 0.9, 3, M.white, 0, T + 1.9, 0, g, 16);                                         // ваза с веткой
    const twig = this.cyl(0.08, 0.08, 6, M.woodDark, 0, T + 5.5, 0, g, 4); twig.rotation.z = 0.2;
    // сервировка: салфетки, тарелки, стаканы напротив каждого стула
    for (const [px, pz] of [[-5.5, -3.2], [5.5, -3.2], [-5.5, 3.2], [5.5, 3.2]]) {
      this.box(4.2, 0.1, 3, mat('#d8cfc0', { roughness: 1 }), px, T + 0.5, pz, g, false);
      this.cyl(1.3, 1.1, 0.25, M.white, px, T + 0.65, pz, g, 20);
      this.cyl(0.45, 0.4, 1.4, M.glass, px + 1.8, T + 1.2, pz * 0.7, g, 12);
    }
    this.box(22, 0.08, 3, mat('#3b3e43', { roughness: 1 }), 0, T + 0.47, 0, g, false);              // дорожка по центру стола
  }

  chair(parent, x, z, r) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = r; parent.add(g);
    this.box(5.6, 0.6, 5.2, M.wood, 0, 6.5, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.5, 6.5, 0.5, M.woodDark, sx * 2.4, 3.25, sz * 2.2, g);
    this.box(5.6, 5, 0.5, M.wood, 0, 10, -2.4, g);
    this.box(4.8, 0.6, 4.4, mat('#8a8f96', { roughness: 1 }), 0, 7.1, 0.2, g);   // подушка
  }

  // Большой круглый ковёр из джута с концентрическими кольцами
  rugRound(x, z) {
    const g = this.group(x, z);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    for (let r = 128; r > 0; r -= 6) { const v = (r / 6) % 2 ? 0 : 14; c.fillStyle = `rgb(${176 - v},${150 - v},${112 - v})`; c.beginPath(); c.arc(128, 128, r, 0, 7); c.fill(); }
    c.strokeStyle = '#3b3e43'; c.lineWidth = 6; c.beginPath(); c.arc(128, 128, 110, 0, 7); c.stroke();
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const rug = new THREE.Mesh(new THREE.CircleGeometry(17, 48), new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    rug.rotation.x = -Math.PI / 2; rug.position.y = 0.04; rug.receiveShadow = true; g.add(rug);
  }

  // Низкий комод: графит с деревом, сверху лампа, ваза и книги
  sideboard(x, z) {
    const g = this.group(x, z), W = 22, H = 9;
    this.box(W, H, 6, M.cab, 0, H / 2 + 1.2, 0, g);
    this.box(W + 0.4, 0.6, 6.4, M.top, 0, H + 1.5, 0, g);
    for (let k = 0; k < 3; k++) { this.box(W / 3 - 0.3, H - 1, 0.1, M.cabDark, -W / 3 + k * W / 3, H / 2 + 1.2, 3.05, g, false); this.box(2, 0.25, 0.25, M.handle, -W / 3 + k * W / 3, H - 1, 3.2, g, false); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.box(0.5, 1.2, 0.5, M.handle, sx * (W / 2 - 1), 0.6, sz * 2.4, g);
    const Y = H + 1.8;
    this.cyl(0.9, 1.4, 1, M.handle, -7, Y + 0.5, 0, g, 16); this.cyl(0.15, 0.15, 4, M.handle, -7, Y + 3, 0, g, 6);   // лампа
    this.cyl(1.2, 2.2, 2.4, mat('#efe7dc', { roughness: 0.9, emissive: '#ffd9a0', emissiveIntensity: 0.4 }), -7, Y + 5.6, 0, g, 18);
    this.cyl(1.1, 0.8, 3.2, mat('#8a4b3a', { roughness: 0.5 }), 0, Y + 1.6, 0, g, 14);                                // ваза
    for (let k = 0; k < 3; k++) { const s = this.cyl(0.07, 0.07, 4, M.woodDark, 0, Y + 4.5, 0, g, 4); s.rotation.z = (k - 1) * 0.35; }
    for (let k = 0; k < 3; k++) this.box(3, 0.6, 2.2, [mat('#e9e1d3'), M.red, mat('#3b5a7a')][k], 7, Y + 0.3 + k * 0.6, 0, g);  // стопка книг
  }

  // Барная тележка с бутылками и бокалами
  barCart(x, z) {
    const g = this.group(x, z), W = 8, D = 5;
    for (const y of [2, 9]) this.box(W, 0.4, D, M.wood, 0, y, 0, g);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.cyl(0.18, 0.18, 10, M.handle, sx * (W / 2 - 0.3), 5.5, sz * (D / 2 - 0.3), g, 6);
    for (const sx of [-1, 1]) { const w = this.cyl(0.9, 0.9, 0.4, M.black, sx * (W / 2 - 0.6), 0.9, D / 2 + 0.1, g, 14); w.rotation.x = Math.PI / 2; }
    for (const [bx, c] of [[-2.5, '#2a1a1e'], [-1, '#c9a25a'], [0.6, '#5b7d3a']]) { this.cyl(0.55, 0.55, 3.2, mat(c, { roughness: 0.15 }), bx, 10.8, -0.8, g, 12); this.cyl(0.22, 0.25, 1.2, mat(c, { roughness: 0.15 }), bx, 13, -0.8, g, 8); }
    for (let k = 0; k < 3; k++) this.cyl(0.5, 0.3, 1.6, M.glass, 1.8 + k * 0.1, 10, 1 - k * 1.1, g, 10);
    this.box(4, 2, 3, mat('#c9a25a', { metalness: 0.6 }), 1, 3.2, 0, g);                                 // ведёрко для льда
  }

  // Торшер с латунной ножкой и тканевым абажуром
  floorLamp(x, z) {
    const g = this.group(x, z);
    this.cyl(2, 2.2, 0.5, M.black, 0, 0.25, 0, g, 20);
    this.cyl(0.2, 0.2, 24, M.handle, 0, 12.5, 0, g, 8);
    this.cyl(2.2, 3.4, 4, mat('#efe7dc', { roughness: 0.9, emissive: '#ffd9a0', emissiveIntensity: 0.5 }), 0, 26, 0, g, 22);
  }

  // Скамья с подушкой
  bench(x, z) {
    const g = this.group(x, z), W = 18;
    this.box(W, 0.8, 4.5, M.wood, 0, 5.6, 0, g);
    for (const sx of [-1, 1]) this.box(0.8, 5.2, 4, M.woodDark, sx * (W / 2 - 1.5), 2.6, 0, g);
    this.box(W - 2, 0.8, 4, mat('#6f747b', { roughness: 1 }), 0, 6.4, 0, g);
    for (const sx of [-1, 1]) { const p = this.box(3, 2.6, 0.9, mat(sx < 0 ? '#c9a25a' : '#8a4b3a', { roughness: 1 }), sx * 5, 8.1, -1.2, g); p.rotation.x = -0.25; }
  }

  // Плетёная корзина с овощами
  basket(x, z) {
    const g = this.group(x, z);
    this.cyl(2.8, 2.2, 3, mat('#b58a52', { roughness: 1 }), 0, 1.5, 0, g, 18);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.25, 6, 24), mat('#8f6a3c', { roughness: 1 })); rim.rotation.x = -Math.PI / 2; rim.position.y = 3; g.add(rim);
    for (const [vx, vz, c, s] of [[-0.8, 0.5, '#e8843c', 1], [0.9, -0.4, '#d9503f', 0.9], [0.2, 1.2, '#c9b36a', 0.8], [-0.2, -1, '#6b3d5a', 0.85]]) {
      const v = new THREE.Mesh(new THREE.SphereGeometry(s, 12, 10), mat(c, { roughness: 0.6 })); v.position.set(vx, 3.1, vz); v.castShadow = true; g.add(v);
    }
  }

  // Листва, которая слегка покачивается (как от сквозняка)
  sway(obj, amp = 0.04, speed = 1) {
    obj.userData.dynamic = true;   // двигается — не склеивать с неподвижными деталями
    const ph = Math.random() * 6, rx = obj.rotation.x, rz = obj.rotation.z;
    this.anim.push(t => { obj.rotation.x = rx + Math.sin(t * speed + ph) * amp; obj.rotation.z = rz + Math.cos(t * speed * 0.8 + ph) * amp; });
  }

  pot(g, r, h, color = '#e9e4dc') {
    this.cyl(r, r * 0.8, h, mat(color, { roughness: 0.6 }), 0, h / 2, 0, g, 20);
    this.cyl(r * 0.92, r * 0.92, 0.3, M.soil, 0, h - 0.1, 0, g, 20);
  }

  leaf(parent, x, y, z, len, wid, rx, ry, rz, m = M.green) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), m);
    l.scale.set(wid, len, wid * 0.35); l.position.set(x, y, z); l.rotation.set(rx, ry, rz); l.castShadow = true; parent.add(l); return l;
  }

  plant(x, z) {   // высокое растение с длинными листьями (сансевиерия)
    const g = this.group(x, z);
    this.pot(g, 3, 6);
    const crown = new THREE.Group(); crown.position.y = 6; g.add(crown);
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; this.leaf(crown, Math.cos(a) * 1.2, 4 + (k % 2) * 1.5, Math.sin(a) * 1.2, 4.5, 0.8, Math.sin(a) * 0.35, -a, -Math.cos(a) * 0.35); }
    this.sway(crown, 0.035, 0.9);
  }

  // Кот на лежанке: дышит и подёргивает хвостом
  catCorner(x, z) {
    const g = this.group(x, z);
    const bed = new THREE.Mesh(new THREE.TorusGeometry(4.5, 1.6, 10, 28), mat('#8a9bbf', { roughness: 1 }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = 1.4; bed.castShadow = true; g.add(bed);
    this.cyl(4.5, 4.5, 0.8, mat('#b5c1db', { roughness: 1 }), 0, 0.5, 0, g);
    this.cat(g, 0, 0, '#e8913f', true);
    for (const [bx, color] of [[9, '#d9503f'], [12.5, '#5b8fd1']]) { this.cyl(1.6, 1.3, 1.1, mat(color), bx, 0.55, 2, g); }
  }

  cat(parent, x, z, color, curled) {
    const fur = mat(color, { roughness: 1 }), c = new THREE.Group(); c.position.set(x, 0, z); parent.add(c);
    c.userData.dynamic = true;
    const body = new THREE.Mesh(new THREE.SphereGeometry(2.8, 16, 12), fur); body.scale.set(1.2, 0.6, 1); body.position.y = 2.2; body.castShadow = true; c.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 10), fur); head.position.set(2.8, 2.6, 1.1); c.add(head);
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), fur); e.position.set(3, 4, 1.1 + s * 0.8); c.add(e); }
    const tail = new THREE.Group(); tail.position.set(-3, 1.2, 0); c.add(tail);
    const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 3.2, 4, 8), fur); tm.rotation.z = Math.PI / 2; tm.position.x = -1.6; tail.add(tm);
    tail.rotation.y = curled ? -1.2 : 0.4;
    const ph = Math.random() * 6, ty = tail.rotation.y;
    this.anim.push(t => {
      body.scale.y = 0.6 + Math.sin(t * 1.6 + ph) * 0.025;                                // дыхание
      tail.rotation.y = ty + Math.max(0, Math.sin(t * 0.7 + ph)) ** 8 * 0.6;              // иногда дёргает хвостом
    });
    return c;
  }
}

// Сценки вокруг трассы: имя метода → габарит [ширина, глубина, высота]
const VIGNETTES = {
  dogBed: [14, 10, 6], lemonTree: [8, 8, 20], monstera: [9, 9, 14], cacti: [10, 5, 9], floorVase: [5, 5, 18],
  veggieCrate: [9, 6, 6], groceryBag: [8, 6, 10], potCluster: [12, 6, 9], scratchPost: [10, 7, 14],
  catYarn: [12, 8, 5], stepStool: [6, 6, 13], bookStack: [7, 6, 6], plant: [8, 8, 18], basket: [6, 6, 5],
};

Object.assign(Kitchen.prototype, {
  // Спящая собака на лежанке с косточкой
  dogBed(x, z) {
    const g = this.group(x, z);
    // бортики разной высоты и чуть разной ширины, чтобы на стыках не совпадали грани (иначе мерцают)
    this.box(10.4, 1.4, 7.4, mat('#6f5a4a', { roughness: 1 }), 0, 0.7, 0, g);
    this.box(11, 2.4, 1.4, mat('#5a4738', { roughness: 1 }), 0, 1.6, -3.3, g);
    for (const s of [-1, 1]) this.box(1.3, 2.2, 7.8, mat('#5a4738', { roughness: 1 }), s * 4.75, 1.5, 0.1, g);
    const fur = mat('#d8c3a0', { roughness: 1 }), dark = mat('#8a6b4a', { roughness: 1 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), fur); body.scale.set(1.5, 0.6, 0.85); body.position.set(-0.5, 2.6, 0); body.castShadow = true; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(1.6, 14, 10), fur); head.position.set(3.6, 2.4, 0.8); g.add(head);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), fur); snout.scale.set(1.3, 0.7, 0.8); snout.position.set(5, 2.1, 0.9); g.add(snout);
    for (const s of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), dark); ear.scale.set(0.5, 1, 0.3); ear.position.set(3.4, 2.6, 0.8 + s * 1.4); ear.rotation.x = s * 0.6; g.add(ear); }
    for (const s of [-1, 1]) { const paw = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2, 4, 8), fur); paw.rotation.z = Math.PI / 2; paw.position.set(4.2, 1.6, 0.8 + s * 0.9 + 0.6); g.add(paw); }
    const bone = new THREE.Group(); bone.position.set(7.5, 0.4, 2.5); bone.rotation.y = 0.6; g.add(bone);
    this.cyl(0.3, 0.3, 2.4, M.white, 0, 0, 0, bone, 8).rotation.z = Math.PI / 2;
    for (const s of [-1, 1]) for (const t of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), M.white); b.position.set(s * 1.2, 0, t * 0.3); bone.add(b); }
    const ph = Math.random() * 6; body.userData.dynamic = true;
    this.anim.push(t => { body.scale.y = 0.6 + Math.sin(t * 1.2 + ph) * 0.03; });
  },

  // Лимонное деревце в кадке
  lemonTree(x, z) {
    const g = this.group(x, z);
    this.pot(g, 3.2, 5, '#c8693f');
    this.cyl(0.35, 0.5, 9, M.woodDark, 0, 9, 0, g, 8);
    const crown = new THREE.Group(); crown.position.y = 15; g.add(crown);
    for (let k = 0; k < 9; k++) {
      const a = k / 9 * Math.PI * 2, r = 2 + (k % 3) * 0.6;
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(2.3, 1), mat(k % 2 ? '#3f7d45' : '#4f9a52', { roughness: 0.8, flatShading: true }));
      b.position.set(Math.cos(a) * r, (k % 3) * 1.2 - 1, Math.sin(a) * r); b.castShadow = true; crown.add(b);
    }
    for (let k = 0; k < 6; k++) { const a = k * 1.1; const l = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), mat('#f4d03f', { roughness: 0.4 })); l.scale.set(1, 1.2, 1); l.position.set(Math.cos(a) * 3.6, rnd2(-1, 1.5), Math.sin(a) * 3.6); crown.add(l); }
    this.sway(crown, 0.03, 0.7);
  },

  // Монстера с крупными резными листьями
  monstera(x, z) {
    const g = this.group(x, z);
    this.pot(g, 3, 4.5, '#2f3236');
    const crown = new THREE.Group(); crown.position.y = 4.5; g.add(crown);
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2 + 0.3, stem = this.cyl(0.12, 0.15, 6, M.green, Math.cos(a) * 1.2, 3, Math.sin(a) * 1.2, crown, 6);
      stem.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      const l = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14, 0, Math.PI * 1.75), mat('#2f7a3a', { roughness: 0.6, side: THREE.DoubleSide }));
      l.position.set(Math.cos(a) * 3.4, 6 + (k % 2), Math.sin(a) * 3.4); l.rotation.set(-Math.PI / 2 + 0.5, 0, -a); l.castShadow = true; crown.add(l);
    }
    this.sway(crown, 0.04, 1.1);
  },

  // Три кактуса в горшочках разной высоты
  cacti(x, z) {
    const g = this.group(x, z);
    for (const [dx, h, c] of [[-3, 6, '#c8693f'], [0, 8, '#e9e4dc'], [3, 4.5, '#2f3236']]) {
      const p = new THREE.Group(); p.position.x = dx; g.add(p);
      this.pot(p, 1.4, 2, c);
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, h - 3, 6, 10), mat('#5f9a5a', { roughness: 0.8 })); body.position.y = 2 + h / 2 - 0.5; body.castShadow = true; p.add(body);
      if (h > 5) { const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 1.6, 4, 8), mat('#5f9a5a')); arm.position.set(1, 2 + h * 0.55, 0); arm.rotation.z = -0.5; p.add(arm); }
      if (h < 5) { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mat('#ff6f91')); fl.position.y = 2 + h - 0.2; p.add(fl); }
    }
  },

  // Высокая напольная ваза с сухоцветами
  floorVase(x, z) {
    const g = this.group(x, z);
    this.cyl(1.6, 2.2, 9, mat('#d9cbb3', { roughness: 0.5 }), 0, 4.5, 0, g, 18);
    this.cyl(1, 1.6, 1.5, mat('#d9cbb3', { roughness: 0.5 }), 0, 9.7, 0, g, 18);
    const bunch = new THREE.Group(); bunch.position.y = 10; g.add(bunch);
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, s = this.cyl(0.06, 0.06, 7, M.woodDark, Math.cos(a) * 0.6, 3.5, Math.sin(a) * 0.6, bunch, 4);
      s.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      const plume = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), mat('#efe2c8', { roughness: 1 })); plume.scale.set(0.6, 1.8, 0.6);
      plume.position.set(Math.cos(a) * 2.2, 7.5, Math.sin(a) * 2.2); plume.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); bunch.add(plume);
    }
    this.sway(bunch, 0.05, 1.3);
  },

  // Деревянный ящик с овощами
  veggieCrate(x, z) {
    const g = this.group(x, z), W = 8, D = 5;
    // боковые планки чуть ниже и короче передних — грани на углах не совпадают
    for (const y of [0.8, 2.6, 4.4]) { this.box(W + 0.3, 1.2, 0.3, M.wood, 0, y, D / 2, g); this.box(W + 0.3, 1.2, 0.3, M.wood, 0, y, -D / 2, g); this.box(0.3, 1.1, D - 0.35, M.wood, W / 2, y - 0.03, 0, g); this.box(0.3, 1.1, D - 0.35, M.wood, -W / 2, y - 0.03, 0, g); }
    this.box(W - 0.4, 0.3, D - 0.4, M.woodDark, 0, 0.3, 0, g);
    for (let k = 0; k < 8; k++) {
      const kind = k % 4, v = new THREE.Mesh(kind === 1 ? new THREE.ConeGeometry(0.5, 2.6, 8) : new THREE.SphereGeometry(kind === 3 ? 0.8 : 1, 12, 10), mat(['#d9503f', '#e8843c', '#7a3b6a', '#e9e1c0'][kind], { roughness: 0.6 }));
      v.position.set(-3 + (k % 4) * 2, 4.6 + (k > 3 ? 0.6 : 0), k > 3 ? 1 : -1); if (kind === 1) v.rotation.z = Math.PI / 2; v.castShadow = true; g.add(v);
      if (kind === 1) { const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 6), M.green); top.position.set(v.position.x + 1.6, v.position.y, v.position.z); top.rotation.z = -Math.PI / 2; g.add(top); }
    }
  },

  // Бумажный пакет с покупками: багет, зелень, бутылка молока
  groceryBag(x, z) {
    const g = this.group(x, z);
    this.box(5, 7, 3.4, mat('#c9a87a', { roughness: 1 }), 0, 3.5, 0, g);
    this.box(5.1, 0.5, 3.5, mat('#b8966a', { roughness: 1 }), 0, 6.9, 0, g);
    const bag = this.cyl(0.6, 0.6, 7, mat('#d9a45a', { roughness: 0.9 }), -1.2, 8.5, 0, g, 10); bag.rotation.z = 0.25;
    this.cyl(0.8, 0.8, 4, M.white, 1.2, 8.5, 0.4, g, 12); this.cyl(0.5, 0.5, 0.6, M.red, 1.2, 10.7, 0.4, g, 10);
    const greens = new THREE.Group(); greens.position.set(0.2, 7, -0.8); g.add(greens);
    for (let k = 0; k < 5; k++) this.leaf(greens, (k - 2) * 0.4, 2, 0, 2, 0.4, 0, 0, (k - 2) * 0.25);
    this.sway(greens, 0.06, 1.5);
    const apple = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), M.red); apple.position.set(4, 0.9, 1.5); g.add(apple);   // выкатилось яблоко
  },

  // Группа горшков разной высоты с лейкой
  potCluster(x, z) {
    const g = this.group(x, z);
    for (const [dx, r, h, c, kind] of [[-4, 2, 4, '#e9e4dc', 'round'], [0, 1.6, 3, '#c8693f', 'spiky'], [3.5, 2.2, 5, '#2f3236', 'round']]) {
      const p = new THREE.Group(); p.position.x = dx; g.add(p);
      this.pot(p, r, h, c);
      const crown = new THREE.Group(); crown.position.y = h; p.add(crown);
      if (kind === 'round') for (let k = 0; k < 6; k++) { const b = new THREE.Mesh(new THREE.SphereGeometry(r * 0.6, 10, 8), mat(k % 2 ? '#4f9a52' : '#5fae5f', { roughness: 0.8 })); b.position.set(Math.cos(k) * r * 0.5, r * 0.4 + (k % 3) * 0.5, Math.sin(k) * r * 0.5); crown.add(b); }
      else for (let k = 0; k < 7; k++) { const a = k / 7 * 6.28; this.leaf(crown, Math.cos(a) * 0.4, 1.8, Math.sin(a) * 0.4, 2.2, 0.3, Math.sin(a) * 0.5, -a, -Math.cos(a) * 0.5); }
      this.sway(crown, 0.04, 1 + dx * 0.05);
    }
    const can = new THREE.Group(); can.position.set(0, 0, 4); can.rotation.y = 0.5; g.add(can);   // лейка
    this.cyl(1.4, 1.6, 2.6, mat('#5b8fd1', { metalness: 0.4, roughness: 0.4 }), 0, 1.3, 0, can, 16);
    const spout = this.cyl(0.2, 0.35, 3, mat('#5b8fd1', { metalness: 0.4 }), 1.8, 2, 0, can, 8); spout.rotation.z = -0.9;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(1, 0.15, 6, 16, Math.PI), mat('#5b8fd1')); handle.position.set(0, 2.6, 0); can.add(handle);
  },

  // Когтеточка с игрушечной мышкой
  scratchPost(x, z) {
    const g = this.group(x, z);
    this.box(7, 0.8, 6, mat('#b5a48a', { roughness: 1 }), 0, 0.4, 0, g);
    this.cyl(0.9, 0.9, 10, mat('#c9b087', { roughness: 1 }), -1.5, 5.8, 0, g, 12);
    this.box(5, 0.8, 5, mat('#b5a48a', { roughness: 1 }), -1.5, 11.2, 0, g);
    const toy = new THREE.Group(); toy.position.set(1.5, 9, 0); g.add(toy);
    this.cyl(0.04, 0.04, 2, M.white, 0, 0, 0, toy, 4);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), mat('#ff6f91')); ball.position.y = -1.2; toy.add(ball);
    toy.userData.dynamic = true;
    const ph = Math.random() * 6; this.anim.push(t => { toy.rotation.z = Math.sin(t * 2.2 + ph) * 0.35; });   // покачивается
    const mouse = new THREE.Group(); mouse.position.set(5, 0, 2); mouse.rotation.y = 2.4; g.add(mouse);
    const mb = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), mat('#9a9aa2', { roughness: 1 })); mb.scale.set(1.5, 0.8, 1); mb.position.y = 0.55; mouse.add(mb);
    const mt = this.cyl(0.06, 0.06, 1.8, mat('#ff9fb0'), -1.8, 0.2, 0, mouse, 4); mt.rotation.z = Math.PI / 2;
  },

  // Котёнок играет с клубком ниток
  catYarn(x, z) {
    const g = this.group(x, z);
    const kitten = this.cat(g, -2, 0, '#8a8f96', false); kitten.scale.setScalar(0.75);
    const yarn = new THREE.Mesh(new THREE.SphereGeometry(1.2, 14, 12), mat('#d9503f', { roughness: 1 })); yarn.position.set(3.5, 1.2, 1); yarn.castShadow = true; g.add(yarn);
    for (let k = 0; k < 3; k++) { const r = new THREE.Mesh(new THREE.TorusGeometry(1.22, 0.06, 4, 24), mat('#b8403a')); r.rotation.set(k, k * 1.3, 0); yarn.add(r); }
    yarn.userData.dynamic = true;
    const thread = this.cyl(0.05, 0.05, 6, mat('#d9503f'), 6, 0.08, 2, g, 4); thread.rotation.set(Math.PI / 2, 0, 0.8);
    // Игра по кругу: припадает к полу и виляет задом → прыжок на клубок → клубок откатывается → котёнок отходит назад
    const P = 3.6, ph = Math.random() * P, sm = k => k * k * (3 - 2 * k), seg = (f, a, b) => Math.min(1, Math.max(0, (f - a) / (b - a)));
    this.anim.push(t => {
      const f = ((t + ph) % P) / P;
      const crouch = seg(f, 0, 0.45) * (1 - seg(f, 0.5, 0.55));
      const jump = seg(f, 0.5, 0.64), back = seg(f, 0.72, 1);
      kitten.position.x = -2 + sm(jump) * 3 - sm(back) * 3;
      kitten.position.y = Math.sin(jump * Math.PI) * 1.4;
      kitten.scale.set(0.75, 0.75 * (1 - crouch * 0.18), 0.75);
      kitten.rotation.y = Math.sin(t * 9) * 0.06 * crouch;                    // виляет перед прыжком
      const push = seg(f, 0.6, 0.8);
      yarn.position.x = 3.5 + sm(push) * 2.6 - sm(back) * 2.6;
      yarn.rotation.z = -(yarn.position.x - 3.5) / 1.2;                       // катится, а не скользит
    });
  },

  // Кот, который гуляет по свободному полу: идёт к случайной точке, садится, оглядывается и идёт дальше
  wanderingCat(cx, cz, R) {
    const g = this.group(cx, cz);
    (this.walkers || (this.walkers = [])).push(g); g.userData.dynamic = true;
    const fur = mat('#2b2a2c', { roughness: 1 }), white = mat('#f2efe8', { roughness: 1 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 3.2, 6, 12), fur); body.rotation.z = Math.PI / 2; body.position.y = 3; body.castShadow = true; g.add(body);
    const head = new THREE.Group(); head.position.set(2.9, 4, 0); g.add(head);
    head.add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 14, 10), fur));
    const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), white); muzzle.position.set(1, -0.35, 0); head.add(muzzle);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 4), fur); e.position.set(0, 1.2, s * 0.65); head.add(e);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ color: '#d4e157' })); eye.position.set(1.1, 0.2, s * 0.45); head.add(eye);
    }
    const legs = [];
    for (const [lx, lz] of [[1.6, 0.7], [1.6, -0.7], [-1.6, 0.7], [-1.6, -0.7]]) {
      const pivot = new THREE.Group(); pivot.position.set(lx, 2.6, lz); g.add(pivot);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.8, 4, 8), fur); leg.position.y = -1.3; leg.castShadow = true; pivot.add(leg);
      const paw = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 6), white); paw.position.y = -2.4; pivot.add(paw);
      legs.push(pivot);
    }
    const tail = new THREE.Group(); tail.position.set(-2.8, 3.4, 0); g.add(tail);
    const tm = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 3.6, 4, 8), fur); tm.position.y = 2; tail.add(tm);
    tail.rotation.z = 0.5;

    // где можно ходить: подальше от трассы и не сквозь мебель (ковры не мешают)
    const ok = (x, z) => this.pts.every(p => (p.x - x) ** 2 + (p.z - z) ** 2 > (p.r + GAP_IN + 3) ** 2)
      && !this.taken.some(t => !t.flat && Math.abs(t.x - x) < t.hw + 2.5 && Math.abs(t.z - z) < t.hd + 2.5);
    const pathOk = (x0, z0, x1, z1) => { for (let k = 0; k <= 12; k++) if (!ok(x0 + (x1 - x0) * k / 12, z0 + (z1 - z0) * k / 12)) return false; return true; };
    // у трассы: не дальше 10 ед от полосы, где ходить можно
    const near = (x, z) => this.pts.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + GAP_IN + 13) ** 2);
    // стартовая точка — первая свободная у трассы
    let sx = cx, sz = cz;
    for (let k = 0; k < 400 && !(ok(sx, sz) && near(sx, sz)); k++) { const a = Math.random() * 6.28, r = Math.random() * R; sx = cx + Math.cos(a) * r; sz = cz + Math.sin(a) * r; }
    if (!ok(sx, sz) || !near(sx, sz)) { this.g.remove(g); return; }
    const st = { x: sx, z: sz, a: 0, tx: sx, tz: sz, mode: 'sit', until: 0, last: 0 };
    this.anim.push(t => {
      const dt = Math.min(0.05, t - st.last || 0); st.last = t;
      if (st.mode === 'sit' && t > st.until) {
        // следующая точка — недалеко (до 25 ед) и у самой трассы, чтобы кота было видно из игры
        for (let tries = 0; tries < 150; tries++) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 27, x = st.x + Math.cos(a) * r, z = st.z + Math.sin(a) * r;
          if ((x - cx) ** 2 + (z - cz) ** 2 < R * R && ok(x, z) && near(x, z) && pathOk(st.x, st.z, x, z)) { st.tx = x; st.tz = z; st.mode = 'walk'; break; }
        }
        if (st.mode === 'sit') st.until = t + 1;
      }
      let walk = 0;
      if (st.mode === 'walk') {
        const dx = st.tx - st.x, dz = st.tz - st.z, d = Math.hypot(dx, dz);
        const want = Math.atan2(-dz, dx); let da = want - st.a; da = Math.atan2(Math.sin(da), Math.cos(da));
        st.a += Math.max(-3 * dt, Math.min(3 * dt, da));                    // плавно поворачивает
        if (Math.abs(da) < 0.6) { const v = Math.min(d, 4.5 * dt); st.x += Math.cos(st.a) * v; st.z -= Math.sin(st.a) * v; walk = 1; }
        if (d < 0.3) { st.mode = 'sit'; st.until = t; }   // не садится: в следующем кадре сразу выбирает новую точку
      }
      g.position.set(st.x, 0, st.z); g.rotation.y = st.a;
      // Поза «буханка»: на остановке кот плавно ложится — тело опускается, лапы подгибаются под себя,
      // хвост ложится на пол, голова оглядывается. sit плавно идёт от 0 (стоит) до 1 (лежит).
      // ложится, только если некуда идти дольше полсекунды (обычно коты всё время гуляют)
      st.stuck = st.mode === 'sit' ? (st.stuck || 0) + dt : 0;
      st.sit = (st.sit || 0) + ((st.stuck > 0.5 ? 1 : 0) - (st.sit || 0)) * Math.min(1, dt * 4);
      const sit = st.sit, stand = 1 - sit;
      legs.forEach((l, k) => {
        l.rotation.z = walk ? Math.sin(t * 9 + (k === 0 || k === 3 ? 0 : Math.PI)) * 0.5 * stand : 0;
        l.position.y = 2.6 - sit * 1.3;                  // плечи и бёдра опускаются вместе с телом
        l.scale.y = 1 - sit * 0.75;                      // лапы «подогнуты» под туловище
      });
      body.position.y = 3 - sit * 1.3;
      head.position.y = 4 - sit * 1.1 + walk * Math.sin(t * 18) * 0.08;
      head.rotation.y = sit * Math.sin(t * 0.6) * 0.7;
      tail.position.y = 3.4 - sit * 2.6;
      tail.rotation.z = 0.5 + sit * 1.05;                // лёжа хвост вытянут по полу
      tail.rotation.x = Math.sin(t * (sit > 0.5 ? 1.5 : 4)) * (sit > 0.5 ? 0.5 : 0.25);
    });
  },

  // Табурет-стремянка с цветком в горшке
  stepStool(x, z) {
    const g = this.group(x, z);
    // ножки снаружи ступенек и чуть ниже их верха — чтобы грани не совпадали (иначе мерцают)
    for (const [y, dz] of [[5, 1], [10, -1]]) this.box(5, 0.6, 3, M.wood, 0, y, dz, g);
    for (const sx of [-1, 1]) { this.box(0.6, 10, 0.6, M.woodDark, sx * 2.85, 5, -2.1, g); this.box(0.6, 5, 0.6, M.woodDark, sx * 2.85, 2.5, 2.1, g); }
    const p = new THREE.Group(); p.position.set(0, 10.3, -1); g.add(p);
    this.pot(p, 1.3, 2, '#c8693f');
    const crown = new THREE.Group(); crown.position.y = 2; p.add(crown);
    for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; this.leaf(crown, Math.cos(a) * 1, 0.8, Math.sin(a) * 1, 1.4, 0.6, Math.sin(a) * 1.1, -a, -Math.cos(a) * 1.1); }   // свисающие листья
    this.sway(crown, 0.05, 1.2);
  },

  // Стопка кулинарных книг с чашкой и пледом
  bookStack(x, z) {
    const g = this.group(x, z);
    const cols = ['#3b5a7a', '#d9503f', '#e9e1d3', '#4f8f56', '#c9a25a'];
    for (let k = 0; k < 5; k++) { const b = this.box(5 - k * 0.3, 0.8, 3.8 - k * 0.2, mat(cols[k], { roughness: 0.8 }), 0, 0.4 + k * 0.8, 0, g); b.rotation.y = (k % 2 ? 1 : -1) * 0.12; }
    this.cyl(0.8, 0.7, 1.6, M.white, 0.5, 4.8, 0.3, g, 14);
    this.cyl(0.62, 0.62, 0.1, mat('#5a3a24'), 0.5, 5.66, 0.3, g, 14);   // кофе — чуть выше края чашки
    const steam = this.steam(g, 0.5, 5.8, 0.3, 0.5);
  },

  // Пар: полупрозрачные клубки поднимаются и тают
  steam(parent, x, y, z, scale = 1) {
    const puffs = [];
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.6 * scale, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
      m.position.set(x, y, z); parent.add(m); puffs.push(m);
    }
    this.anim.push(t => puffs.forEach((m, k) => {
      const f = (t * 0.4 + k / puffs.length) % 1;
      m.position.y = y + f * 5 * scale; m.position.x = x + Math.sin(f * 6 + k) * 0.4 * scale;
      m.scale.setScalar(0.6 + f * 1.6); m.material.opacity = 0.35 * Math.sin(f * Math.PI);
    }));
  },
});

function rnd2(a, b) { return a + Math.random() * (b - a); }
