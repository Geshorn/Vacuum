import * as THREE from 'three';

/* 3D-модели роботов-пылесосов из простых фигур.
   Нос смотрит вдоль +X, низ на y = 0, R — радиус робота (для столкновений).
   У всех общее шасси высотой ~0.66 (на нём вмятины и царапины, см. robot.js), но своя форма корпуса
   и своя «надстройка» по типу робота. Основной цвет — spec.color (его меняет окраска из меню).
   eyeMat меняет цвет по состоянию; spinners — то, что вращается со скоростью робота. */

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, ...o });
const DARK = std('#2a2230', { roughness: 0.5 });
const METAL = std('#c3c7cf', { metalness: 0.7, roughness: 0.3 });
const RUBBER = std('#1a161a', { roughness: 0.9 });
const ACCENT = std('#ff5b3a');
const GLASS = new THREE.MeshStandardMaterial({ color: '#bfe6ff', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
const WATER = new THREE.MeshStandardMaterial({ color: '#4aa8ff', roughness: 0.1, transparent: true, opacity: 0.6 });
const SCREEN = new THREE.MeshBasicMaterial({ color: '#7dffb0' });
const BULB = new THREE.MeshBasicMaterial({ color: '#fff3c4' });

const H = 0.55, Y0 = 0.1, TOP = Y0 + H;   // шасси: от 0.1 до 0.65

function add(g, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
}

// Контуры корпуса в плане: r(θ) как доля R; θ = 0 — нос
const OUTLINES = {
  round: () => 1,
  // D-образный: плоский нос
  d: t => Math.min(1, 0.86 / Math.max(0.01, Math.cos(t))),
  // скруглённый квадрат (суперэллипс)
  square: t => { const n = 3.5, c = Math.abs(Math.cos(t)) ** n, s = Math.abs(Math.sin(t)) ** n; return 0.94 * (c + s) ** (-1 / n) / 1.1; },
  // капля утюга: острый нос
  drop: t => 0.9 + 0.22 * Math.max(0, Math.cos(t)) ** 4 - 0.04 * Math.max(0, -Math.cos(t)),
};

// Призма по контуру: от y0 вверх на h, со скруглённой фаской
function prism(R, outline, h, k = 1, bevel = 0.06) {
  const f = OUTLINES[outline], sh = new THREE.Shape(), N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N * Math.PI * 2, r = R * k * (outline === 'round' ? 1 : f(t)) - bevel;
    // форма рисуется в XY, после поворота Y → −Z
    const x = Math.cos(t) * r, y = -Math.sin(t) * r;
    i ? sh.lineTo(x, y) : sh.moveTo(x, y);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth: h - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 });
  geo.rotateX(-Math.PI / 2); geo.translate(0, bevel, 0);
  return geo;
}

// Боковые щётки — у всех, кроме тех, у кого своя «уборочная» часть
function brushes(g, R, spinners, mat = ACCENT, len = 0.7) {
  for (const s of [-1, 1]) {
    const b = new THREE.Group(); b.position.set(R * 0.75, 0.1, s * R * 0.75); g.add(b);
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Group(); h.rotation.y = k * Math.PI * 2 / 3; b.add(h);
      add(h, new THREE.BoxGeometry(len, 0.04, 0.06), mat, len / 2, 0, 0);
    }
    spinners.push({ obj: b, axis: 'y', k: 1.2 * s, idle: 4 });
  }
}

function eyes(g, eye, x, y, z = 0.32, r = 0.13) {
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(r, 12, 8), eye, x, y, s * z);
}

// Общий бампер спереди
function bumper(g, R, k = 1.02) {
  const b = add(g, new THREE.TorusGeometry(R * k, 0.12, 8, 30, Math.PI * 0.9), DARK, 0, 0.3, 0);
  b.rotation.set(Math.PI / 2, 0, -Math.PI * 0.45);
}

// ── Дизайны по типам. Каждый получает (g, R, shell, eye, spinners) и возвращает форму шасси ──
const DESIGNS = {
  // Классический круглый пылесос: панель и кнопка-«лидар»
  vacuum(g, R, shell, eye, sp) {
    add(g, new THREE.CylinderGeometry(R * 0.78, R * 0.82, 0.12, 40), DARK, 0, TOP + 0.06, 0);
    add(g, new THREE.CylinderGeometry(0.32, 0.36, 0.22, 24), shell, -0.2, TOP + 0.21, 0);
    bumper(g, R); eyes(g, eye, R * 0.72, TOP + 0.11);
    brushes(g, R, sp);
    return 'round';
  },

  // Пульт: плоский D-корпус, сетка кнопок, ИК-окошко на носу
  remote(g, R, shell, eye, sp) {
    add(g, prism(R, 'd', 0.06, 0.82, 0.02), DARK, 0, TOP, 0);
    const btn = new THREE.CylinderGeometry(0.09, 0.09, 0.08, 12);
    const cols = ['#ff3b4e', '#4cd964', '#ffd166', '#5db2ff'];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++)
      add(g, btn, i === 0 ? std(cols[j]) : std('#8a8592'), -R * 0.45 + i * R * 0.27, TOP + 0.08, (j - 1.5) * R * 0.22);
    add(g, new THREE.CylinderGeometry(0.16, 0.16, 0.1, 16), ACCENT, R * 0.38, TOP + 0.09, 0);
    add(g, new THREE.BoxGeometry(0.08, 0.22, R * 0.9), std('#550a12', { emissive: '#ff2030', emissiveIntensity: 0.6 }), R * 0.84, 0.4, 0);
    eyes(g, eye, R * 0.62, TOP + 0.08, 0.38, 0.1);
    brushes(g, R, sp, DARK, 0.55);
    return 'd';
  },

  // Мышка: горб-купол, колёсико прокрутки, провод-хвост
  mouse(g, R, shell, eye, sp) {
    const dome = add(g, new THREE.SphereGeometry(R * 0.82, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), shell, -R * 0.08, TOP - 0.02, 0);
    dome.scale.set(1.05, 0.45, 0.85);
    add(g, new THREE.BoxGeometry(R * 0.9, 0.04, 0.04), DARK, R * 0.35, TOP + R * 0.3, 0);   // шов между кнопками
    const wheel = new THREE.Group(); wheel.position.set(R * 0.38, TOP + R * 0.3, 0); g.add(wheel);
    const w = add(wheel, new THREE.CylinderGeometry(0.17, 0.17, 0.12, 16), RUBBER); w.rotation.x = Math.PI / 2;
    for (let k = 0; k < 6; k++) { const r = add(wheel, new THREE.BoxGeometry(0.05, 0.36, 0.13), DARK); r.rotation.z = k * Math.PI / 6; }
    sp.push({ obj: wheel, axis: 'z', k: -0.8, idle: 2 });
    const tail = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-R * 0.95, 0.35, 0), new THREE.Vector3(-R * 1.25, 0.25, 0.25),
      new THREE.Vector3(-R * 1.5, 0.15, -0.15), new THREE.Vector3(-R * 1.8, 0.1, 0.2)]);
    add(g, new THREE.TubeGeometry(tail, 20, 0.05, 6), DARK);
    eyes(g, eye, R * 0.78, TOP - 0.02, 0.3, 0.11);
    brushes(g, R, sp);
    return 'round';
  },

  // Вентилятор: решётка-клетка и пропеллер, дует вперёд
  fan(g, R, shell, eye, sp) {
    add(g, new THREE.CylinderGeometry(0.12, 0.18, 0.45, 12), METAL, -0.1, TOP + 0.22, 0);
    const head = new THREE.Group(); head.position.set(-0.1, TOP + 0.75, 0); g.add(head);
    const cage = add(head, new THREE.TorusGeometry(R * 0.62, 0.04, 6, 32), METAL); cage.rotation.y = Math.PI / 2;
    for (let k = 0; k < 8; k++) {
      const s = add(head, new THREE.TorusGeometry(R * 0.62, 0.015, 4, 24, Math.PI), METAL);
      s.rotation.set(0, 0, k * Math.PI / 8); s.scale.set(1, 1, 0.35);
    }
    add(head, new THREE.SphereGeometry(0.16, 12, 8), shell, -0.08, 0, 0);
    const prop = new THREE.Group(); prop.position.x = 0.05; head.add(prop);
    for (let k = 0; k < 3; k++) {
      const b = add(prop, new THREE.BoxGeometry(0.03, R * 0.52, 0.22), std('#9fe3ff', { transparent: true, opacity: 0.85 }), 0, R * 0.28, 0);
      const h = new THREE.Group(); h.rotation.x = k * Math.PI * 2 / 3; h.add(b); prop.add(h); b.rotation.y = 0.4;
    }
    sp.push({ obj: prop, axis: 'x', k: 3, idle: 10 });
    bumper(g, R); eyes(g, eye, R * 0.72, TOP + 0.02);
    brushes(g, R, sp);
    return 'round';
  },

  // Настольная лампа: суставчатая ножка и абажур с лампочкой
  lamp(g, R, shell, eye, sp) {
    add(g, new THREE.CylinderGeometry(R * 0.5, R * 0.6, 0.1, 32), DARK, -0.2, TOP + 0.05, 0);
    const arm = new THREE.Group(); arm.position.set(-0.3, TOP + 0.1, 0); g.add(arm);
    const a1 = add(arm, new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8), METAL, 0, 0.42, 0); a1.rotation.z = -0.5;
    add(arm, new THREE.SphereGeometry(0.09, 10, 8), shell, 0.21, 0.8, 0);
    const a2 = add(arm, new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), METAL, 0.45, 0.95, 0); a2.rotation.z = 1.1;
    const shade = add(arm, new THREE.ConeGeometry(0.38, 0.45, 20, 1, true), std(shell.color, { side: THREE.DoubleSide }), 0.85, 0.95, 0);
    shade.rotation.z = -2.2; shade.material = shell;
    shell.side = THREE.DoubleSide;
    add(arm, new THREE.SphereGeometry(0.14, 12, 8), BULB, 0.95, 0.85, 0);
    bumper(g, R); eyes(g, eye, R * 0.75, TOP + 0.02, 0.36);
    brushes(g, R, sp);
    return 'round';
  },

  // Блендер: прозрачная колба с крутящимися ножами на крыше
  blender(g, R, shell, eye, sp) {
    add(g, new THREE.CylinderGeometry(R * 0.55, R * 0.7, 0.25, 6), shell, -0.15, TOP + 0.12, 0);
    for (let k = 0; k < 3; k++) add(g, new THREE.CylinderGeometry(0.06, 0.06, 0.06, 10), [SCREEN, ACCENT, METAL][k], R * 0.45, TOP + 0.2, (k - 1) * 0.2);
    add(g, new THREE.CylinderGeometry(R * 0.5, R * 0.38, 0.95, 20, 1, true), GLASS, -0.15, TOP + 0.72, 0);
    add(g, new THREE.CylinderGeometry(R * 0.53, R * 0.53, 0.08, 20), DARK, -0.15, TOP + 1.22, 0);
    const blades = new THREE.Group(); blades.position.set(-0.15, TOP + 0.38, 0); g.add(blades);
    for (let k = 0; k < 4; k++) { const b = add(blades, new THREE.BoxGeometry(R * 0.6, 0.03, 0.1), METAL); b.rotation.set(k % 2 ? 0.3 : -0.3, k * Math.PI / 4, 0); }
    sp.push({ obj: blades, axis: 'y', k: 4, idle: 14 });
    bumper(g, R); eyes(g, eye, R * 0.78, TOP + 0.0, 0.34);
    brushes(g, R, sp);
    return 'round';
  },

  // Робот-мойщик: бак с водой на крыше, две вращающиеся швабры спереди снизу
  mop(g, R, shell, eye, sp) {
    add(g, new THREE.CylinderGeometry(R * 0.8, R * 0.84, 0.1, 40), DARK, 0, TOP + 0.05, 0);
    const tank = add(g, new THREE.CapsuleGeometry(0.3, R * 0.8, 6, 12), GLASS, -R * 0.25, TOP + 0.38, 0); tank.rotation.x = Math.PI / 2;
    const water = add(g, new THREE.CapsuleGeometry(0.24, R * 0.75, 6, 12), WATER, -R * 0.25, TOP + 0.33, 0); water.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      const pad = new THREE.Group(); pad.position.set(R * 0.55, 0.06, s * R * 0.42); g.add(pad);
      add(pad, new THREE.CylinderGeometry(R * 0.42, R * 0.42, 0.08, 20), std('#e9f4ff', { roughness: 1 }));
      for (let k = 0; k < 10; k++) { const f = add(pad, new THREE.BoxGeometry(0.1, 0.06, 0.1), std('#bcd7f0', { roughness: 1 }), Math.cos(k / 10 * 6.28) * R * 0.43, -0.02, Math.sin(k / 10 * 6.28) * R * 0.43); f.rotation.y = k; }
      sp.push({ obj: pad, axis: 'y', k: 1.5 * s, idle: 5 });
    }
    eyes(g, eye, R * 0.72, TOP + 0.11);
    return 'round';
  },

  // Утюг: корпус-капля с острым носом, ручка сверху, дырочки для пара
  iron(g, R, shell, eye, sp) {
    add(g, prism(R, 'drop', 0.12, 0.92), METAL, 0, 0, 0);   // подошва
    const handle = new THREE.Group(); handle.position.set(-R * 0.15, TOP, 0); g.add(handle);
    for (const x of [-R * 0.45, R * 0.35]) add(handle, new THREE.BoxGeometry(0.14, 0.4, 0.2), shell, x, 0.2, 0);
    add(handle, new THREE.BoxGeometry(R * 1.0, 0.14, 0.24), DARK, -R * 0.05, 0.45, 0);
    add(handle, new THREE.CylinderGeometry(0.1, 0.1, 0.08, 12), ACCENT, -R * 0.4, 0.55, 0);
    const holes = new THREE.CylinderGeometry(0.04, 0.04, 0.02, 8);
    for (let k = 0; k < 7; k++) add(g, holes, RUBBER, R * (0.2 + (k % 3) * 0.2), TOP + 0.01, (k - 3) * 0.12);
    eyes(g, eye, R * 0.82, TOP - 0.02, 0.26, 0.11);
    brushes(g, R, sp, METAL, 0.6);
    return 'drop';
  },

  // Газонокосилка: квадратный корпус, большие задние колёса, мешок для травы, нож снизу
  mower(g, R, shell, eye, sp) {
    add(g, prism(R, 'square', 0.08, 0.8), DARK, 0, TOP, 0);
    add(g, new THREE.BoxGeometry(0.06, 0.06, 0.4), METAL, R * 0.2, TOP + 0.1, 0);
    // ручка-дуга назад
    const bar = new THREE.CatmullRomCurve3([new THREE.Vector3(-R * 0.5, TOP, R * 0.5), new THREE.Vector3(-R * 1.1, TOP + 0.9, R * 0.45),
      new THREE.Vector3(-R * 1.15, TOP + 1.0, 0), new THREE.Vector3(-R * 1.1, TOP + 0.9, -R * 0.45), new THREE.Vector3(-R * 0.5, TOP, -R * 0.5)]);
    add(g, new THREE.TubeGeometry(bar, 24, 0.05, 6), METAL);
    const bag = add(g, new THREE.BoxGeometry(0.6, 0.55, R * 0.9), std('#3d5a2a', { roughness: 1 }), -R * 1.05, 0.45, 0); bag.rotation.z = -0.2;
    for (const [x, s] of [[-R * 0.55, 1], [-R * 0.55, -1]]) {
      const wh = new THREE.Group(); wh.position.set(x, 0.32, s * R * 0.98); g.add(wh);
      const t = add(wh, new THREE.CylinderGeometry(0.34, 0.34, 0.18, 16), RUBBER); t.rotation.x = Math.PI / 2;
      add(wh, new THREE.BoxGeometry(0.5, 0.08, 0.2), METAL);
      sp.push({ obj: wh, axis: 'z', k: -1.5, idle: 0 });
    }
    const blade = new THREE.Group(); blade.position.set(R * 0.1, 0.04, 0); g.add(blade);
    add(blade, new THREE.BoxGeometry(R * 1.4, 0.03, 0.14), METAL);
    sp.push({ obj: blade, axis: 'y', k: 3, idle: 12 });
    eyes(g, eye, R * 0.75, TOP + 0.08, 0.36);
    return 'square';
  },

  // Микроволновка: коробка с тёмным окошком, дисплеем и крутилкой
  microwave(g, R, shell, eye, sp) {
    add(g, new THREE.BoxGeometry(R * 1.2, 0.85, R * 1.4), shell, -R * 0.15, TOP + 0.42, 0);
    add(g, new THREE.BoxGeometry(0.04, 0.6, R * 0.9), std('#15121a', { roughness: 0.1, metalness: 0.4 }), R * 0.46, TOP + 0.42, -R * 0.18);
    add(g, new THREE.BoxGeometry(0.04, 0.16, R * 0.32), SCREEN, R * 0.46, TOP + 0.65, R * 0.5);
    const dial = new THREE.Group(); dial.position.set(R * 0.48, TOP + 0.32, R * 0.5); g.add(dial);
    const d = add(dial, new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), METAL); d.rotation.z = Math.PI / 2;
    add(dial, new THREE.BoxGeometry(0.1, 0.18, 0.04), DARK, 0.03, 0.03, 0);
    sp.push({ obj: dial, axis: 'x', k: 0.3, idle: 1 });
    // крутящаяся тарелка видна сквозь окошко
    const plate = new THREE.Group(); plate.position.set(R * 0.05, TOP + 0.12, -R * 0.18); g.add(plate);
    add(plate, new THREE.CylinderGeometry(R * 0.38, R * 0.38, 0.03, 20), GLASS);
    sp.push({ obj: plate, axis: 'y', k: 0.4, idle: 1.2 });
    bumper(g, R); eyes(g, eye, R * 0.8, TOP - 0.06, 0.4, 0.11);
    brushes(g, R, sp);
    return 'square';
  },

  // Холодильник: высокий двухдверный шкаф с ручками и магнитиком
  fridge(g, R, shell, eye, sp) {
    const w = R * 1.15, d = R * 1.3;
    add(g, new THREE.BoxGeometry(w, 0.95, d), shell, -R * 0.1, TOP + 0.48, 0);
    add(g, new THREE.BoxGeometry(w, 0.55, d), shell, -R * 0.1, TOP + 1.25, 0);
    add(g, new THREE.BoxGeometry(w + 0.02, 0.04, d + 0.02), DARK, -R * 0.1, TOP + 0.96, 0);
    for (const y of [TOP + 0.6, TOP + 1.2]) add(g, new THREE.BoxGeometry(0.08, 0.32, 0.08), METAL, -R * 0.1 + w / 2 + 0.05, y, -d * 0.35);
    add(g, new THREE.BoxGeometry(0.03, 0.2, 0.2), std('#ff6fb5'), -R * 0.1 + w / 2 + 0.02, TOP + 0.45, d * 0.15);
    add(g, new THREE.BoxGeometry(0.03, 0.16, 0.16), std('#ffd166'), -R * 0.1 + w / 2 + 0.02, TOP + 0.7, d * 0.28);
    bumper(g, R); eyes(g, eye, R * 0.82, TOP - 0.05, 0.42, 0.12);
    brushes(g, R, sp);
    return 'round';
  },

  // Сейф: тяжёлый квадратный корпус в заклёпках, кодовый диск и рычаг спереди
  safe(g, R, shell, eye, sp) {
    add(g, new THREE.BoxGeometry(R * 1.3, 0.6, R * 1.3), shell, -R * 0.1, TOP + 0.3, 0);
    add(g, new THREE.BoxGeometry(0.04, 0.45, R * 1.0), DARK, R * 0.56, TOP + 0.3, 0);
    const rivet = new THREE.SphereGeometry(0.05, 6, 4);
    for (let i = 0; i < 4; i++) for (const z of [-1, 1]) add(g, rivet, METAL, -R * 0.65 + i * R * 0.4, TOP + 0.62, z * R * 0.55);
    const dial = new THREE.Group(); dial.position.set(R * 0.6, TOP + 0.3, -R * 0.15); g.add(dial);
    const dd = add(dial, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20), METAL); dd.rotation.z = Math.PI / 2;
    for (let k = 0; k < 8; k++) add(dial, new THREE.BoxGeometry(0.04, 0.05, 0.02), DARK, 0.04, Math.cos(k * 0.785) * 0.16, Math.sin(k * 0.785) * 0.16);
    sp.push({ obj: dial, axis: 'x', k: 0.5, idle: 0.6 });
    const lever = add(g, new THREE.BoxGeometry(0.06, 0.06, 0.35), METAL, R * 0.62, TOP + 0.3, R * 0.3); lever.rotation.x = 0.5;
    eyes(g, eye, R * 0.86, 0.42, 0.42, 0.11);
    brushes(g, R, sp, DARK, 0.6);
    return 'square';
  },
};

export function buildModel(spec) {
  const g = new THREE.Group(), R = spec.radius;
  const shell = std(spec.color);
  const eye = new THREE.MeshBasicMaterial({ color: '#6ef0ff' });
  const spinners = [];
  const design = DESIGNS[spec.id] || DESIGNS.vacuum;
  const outline = design(g, R, shell, eye, spinners);
  // шасси — общее для всех, своего контура
  add(g, outline === 'round' ? new THREE.CylinderGeometry(R, R * 1.03, H, 40) : prism(R, outline, H, 1.0), shell, 0, outline === 'round' ? Y0 + H / 2 : Y0, 0);
  g.traverse(o => { if (o.isMesh && o.material !== eye && o.material !== GLASS) o.castShadow = true; });
  return { group: g, eyeMat: eye, spinners, shellMat: shell };
}
