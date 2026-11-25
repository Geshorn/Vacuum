import * as THREE from 'three';
import { ROBOTS } from './robots.js';
import { derive, spinAll } from './robot.js';
import { buildModel } from './models.js';

// Меню выбора робота: сетка портретов, крутящаяся 3D-модель и характеристики полосками.
const LIST = Object.values(ROBOTS);
const COLS = 4;   // ряд = класс: лёгкие, средние, тяжёлые

const klass = m => (m < 1 ? 'Лёгкий' : m < 1.8 ? 'Средний' : 'Тяжёлый');

// Характеристики 0..1 относительно самых сильных роботов в списке
function makeStats() {
  const d = LIST.map(r => ({ r, s: derive(r) }));
  const max = f => Math.max(...d.map(f));
  const accelOf = x => x.s.accel / x.s.maxSpeed;                 // 1 / время разгона
  const handOf = x => x.s.turn * x.s.steerAccel * x.s.grip;
  const mM = max(x => x.s.mass), mA = max(accelOf), mH = max(handOf), mHP = max(x => x.s.hp);
  const out = {};
  for (const x of d) out[x.r.id] = [
    ['Разгон', accelOf(x) / mA, `${(x.s.maxSpeed / x.s.accel).toFixed(1)} с`],
    ['Управляемость', handOf(x) / mH, ''],
    ['Масса', x.s.mass / mM, `${Math.round(x.s.mass * 4)} кг`],
    ['Прочность', x.s.hp / mHP, `${x.s.hp} ХП`],
  ];
  return out;
}

// Маленькая студия для портретов и превью
function studio() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffd2c2', '#3a0c22', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 2.4); key.position.set(3, 6, 4); scene.add(key);
  const rim = new THREE.DirectionalLight('#ff6a4d', 2); rim.position.set(-4, 3, -4); scene.add(rim);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  return { scene, cam };
}

// «Радиус» модели по её габаритам — чтобы любая модель (плоский пульт, высокий холодильник) вписывалась в кадр
function fit(obj) {
  const b = new THREE.Box3().setFromObject(obj), s = b.getSize(new THREE.Vector3());
  return Math.max(s.x, s.y * 1.3, s.z) / 2;
}
const midY = obj => { const b = new THREE.Box3().setFromObject(obj); return (b.min.y + b.max.y) / 2; };

function frame(cam, R, aspect, dist = 6.2, cy = 0.45) {
  cam.aspect = aspect; cam.updateProjectionMatrix();
  const d = R * dist;
  cam.position.set(d * 0.75, cy + d * 0.6, d * 0.75);
  cam.lookAt(0, cy, 0);
}

export class Menu {
  constructor(onPick) {
    this.onPick = onPick;
    this.stats = makeStats();
    this.el = document.getElementById('menu');
    this.el.innerHTML = `
      <div class="m-panel">
        <h1>Выбери робота</h1>
        <div class="m-grid" id="m-grid"></div>
        <div class="m-keys">Стрелки / WASD — выбор · Enter — поехали · R — случайный</div>
      </div>
      <div class="m-card">
        <canvas id="m-view" width="420" height="300"></canvas>
        <div class="m-name"><b id="m-name"></b><span id="m-class"></span></div>
        <div class="m-stats" id="m-stats"></div>
        <div class="m-btns">
          <button id="m-rand">Случайный</button>
          <button id="m-go" class="go">Поехали!</button>
        </div>
      </div>`;
    this.grid = this.el.querySelector('#m-grid');
    this.buildPortraits();
    this.buildPreview();
    this.el.querySelector('#m-go').onclick = () => this.pick();
    this.el.querySelector('#m-rand').onclick = () => this.random();
    addEventListener('keydown', e => this.onKey(e));
    this.index = 0;
  }

  buildPortraits() {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(128, 128); r.toneMapping = THREE.ACESFilmicToneMapping;
    const { scene, cam } = studio();
    LIST.forEach((spec, i) => {
      const m = buildModel(spec);
      m.group.rotation.y = -0.5;
      const k = fit(m.group);
      scene.add(m.group);
      frame(cam, k, 1, 3.4, midY(m.group));
      r.render(scene, cam);
      scene.remove(m.group);
      const b = document.createElement('button');
      b.className = 'm-cell';
      b.title = spec.name;
      b.innerHTML = `<img src="${r.domElement.toDataURL()}" alt=""><span>${spec.name}</span><i class="w w${klass(spec.mass)[0]}"></i>`;
      b.onclick = () => this.select(i);
      b.ondblclick = () => { this.select(i); this.pick(); };
      this.grid.appendChild(b);
    });
    r.dispose();
  }

  buildPreview() {
    const cv = this.el.querySelector('#m-view');
    this.view = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
    this.view.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.view.toneMapping = THREE.ACESFilmicToneMapping;
    this.view.setSize(cv.width, cv.height, false);
    const s = studio();
    this.vScene = s.scene; this.vCam = s.cam;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.8, 0.2, 48),
      new THREE.MeshStandardMaterial({ color: '#3a0c22', emissive: '#5a1408', roughness: 0.6 }));
    disc.position.y = -0.1; this.vScene.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.7, 0.05, 8, 64), new THREE.MeshBasicMaterial({ color: '#ff8a5c' }));
    ring.rotation.x = Math.PI / 2; this.vScene.add(ring);
    this.disc = disc; this.ring = ring;
  }

  select(i) {
    this.index = (i + LIST.length) % LIST.length;
    const spec = LIST[this.index];
    [...this.grid.children].forEach((c, k) => c.classList.toggle('on', k === this.index));
    this.el.querySelector('#m-name').textContent = spec.name;
    this.el.querySelector('#m-class').textContent = klass(spec.mass);
    this.el.querySelector('#m-stats').innerHTML = this.stats[spec.id].map(([label, v, txt]) =>
      `<div class="m-stat"><span>${label}</span><i><b style="width:${Math.max(6, v * 100)}%"></b></i><em>${txt}</em></div>`).join('');
    if (this.model) this.vScene.remove(this.model);
    const m = buildModel(spec);
    this.model = m.group; this.spinners = m.spinners;
    // модель вписана в подиум одного размера, сам размер видно по цифрам
    this.model.scale.setScalar(1.9 / fit(this.model));
    this.vScene.add(this.model);
    frame(this.vCam, 2.4, 420 / 300, 3.6, Math.max(0.45, midY(this.model)));
  }

  random() {
    let i; do i = Math.floor(Math.random() * LIST.length); while (i === this.index && LIST.length > 1);
    this.select(i);
  }

  pick() { this.onPick(LIST[this.index].id); }

  onKey(e) {
    if (!this.open) return;
    const c = e.code;
    if (c === 'Enter' || c === 'Space') { e.preventDefault(); this.pick(); }
    else if (c === 'KeyR') this.random();
    else if (c === 'ArrowLeft' || c === 'KeyA') this.select(this.index - 1);
    else if (c === 'ArrowRight' || c === 'KeyD') this.select(this.index + 1);
    else if (c === 'ArrowUp' || c === 'KeyW') this.select(this.index - COLS);
    else if (c === 'ArrowDown' || c === 'KeyS') this.select(this.index + COLS);
  }

  show(id) {
    this.open = true;
    document.body.classList.add('in-menu');
    this.select(Math.max(0, LIST.findIndex(r => r.id === id)));
  }

  hide() { this.open = false; document.body.classList.remove('in-menu'); }

  render(t) {
    if (!this.open || !this.model) return;
    this.model.rotation.y = t * 0.0008;
    spinAll(this.spinners, 3, 1 / 60);   // в витрине колёса и лопасти слегка крутятся
    this.view.render(this.vScene, this.vCam);
  }
}
