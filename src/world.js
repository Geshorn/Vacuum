import * as THREE from 'three';
import { C } from './config.js';

const SHADOW_STEP = 8;    // на сколько сдвигается окно теней за раз (единиц мира)
const SHADOW_EVERY = 4;   // карта теней перерисовывается минимум раз в столько кадров (подвижные декорации)

// Рендерер, сцена в закатной гамме, свет и камера, которая едет за роботом под фиксированным наклоном.
export class World {
  constructor(container) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    // на экранах высокой плотности (4K, Retina) не рисуем больше 1.5 пикселя на точку — разница почти
    // не видна, а нагрузка на видеокарту растёт с квадратом этого числа
    r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    // Карта теней перерисовывается не каждый кадр (это больше половины вызовов отрисовки), а:
    // когда окно теней сдвинулось, раз в SHADOW_EVERY кадров (для подвижных декораций, оружия, бонусов)
    // и каждый кадр, пока есть подвижный свет с тенью (фара игрока в темноте — shadowEveryFrame).
    // У роботов своих теней в карте нет — под ними мягкое пятно (robot.js), оно не отстаёт.
    r.shadowMap.autoUpdate = false;
    this.shadowTick = 0; this.shadowDirty = true; this.shadowEveryFrame = false;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    container.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    // тёплый дневной свет кухни; дальние края комнаты растворяются в мягкой дымке
    s.background = new THREE.Color('#e6d8c6');
    s.fog = new THREE.Fog('#e6d8c6', 140, 330);

    this.hemi = new THREE.HemisphereLight('#fff3e2', '#8a7462', 1.25); s.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight('#fff0dc', 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    // окно теней чуть шире видимого (±68): оно сдвигается шагами по SHADOW_STEP, а не плавно
    Object.assign(sun.shadow.camera, { left: -68, right: 68, top: 68, bottom: -68, near: 1, far: 200 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;   // normalBias убирает «полосатые» тени на гранях
    s.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(-40, 70, 30);

    // Пол и вся обстановка кухни — в kitchen.js

    this.camera = new THREE.PerspectiveCamera(C.cam.fov, 1, 0.5, 600);
    this.camTarget = new THREE.Vector3();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  // Цвет неба/дымки под карту (у каждой комнаты своя гамма)
  setSky(color) { this.scene.background.set(color); this.scene.fog.color.set(color); }

  // Погода и время суток: day — как задумано картой, evening — сумерки (светятся лампы и глаза роботов),
  // rain — пасмурно и серо (сами капли — в fx.js)
  setAtmosphere(mode, sky) {
    const A = {
      day: { bg: sky, hemi: ['#fff3e2', '#8a7462', 1.25], sun: ['#fff0dc', 2.2], exp: 1.1, fog: [140, 330] },
      evening: { bg: '#2b2a4a', hemi: ['#8f9bff', '#3a2a3a', 0.55], sun: ['#ffae6b', 0.9], exp: 0.95, fog: [120, 300] },
      rain: { bg: '#9aa6b2', hemi: ['#d0dbe6', '#5a6470', 0.95], sun: ['#e8f0ff', 0.7], exp: 1.0, fog: [90, 250] },
      // свет отключили: почти темно — видно фары роботов, лампы на столбиках и окна
      blackout: { bg: '#0b0d16', hemi: ['#5a6cb0', '#14141e', 0.42], sun: ['#a9bcff', 0.4], exp: 1.05, fog: [110, 280] },   // лунный свет из окна
      // вечеринка: приглушённый фиолетовый свет, цветные прожекторы — в fx.js
      party: { bg: '#1a0f2e', hemi: ['#b48cff', '#2a1036', 0.45], sun: ['#ff7ad9', 0.35], exp: 1.05, fog: [120, 300] },
      // пузыри: обычный день, чуть мягче
      bubbles: { bg: sky, hemi: ['#fff6fb', '#8a7f9a', 1.3], sun: ['#fff4fa', 2.0], exp: 1.1, fog: [140, 330] },
    }[mode] || null;
    const a = A || { bg: sky, hemi: ['#fff3e2', '#8a7462', 1.25], sun: ['#fff0dc', 2.2], exp: 1.1, fog: [140, 330] };
    this.setSky(a.bg);
    this.scene.fog.near = a.fog[0]; this.scene.fog.far = a.fog[1];
    this.hemi.color.set(a.hemi[0]); this.hemi.groundColor.set(a.hemi[1]); this.hemi.intensity = a.hemi[2];
    this.sun.color.set(a.sun[0]); this.sun.intensity = a.sun[1];
    this.renderer.toneMappingExposure = a.exp;
    this.shadowDirty = true;
  }

  // Снимок карты сверху для превью в меню: камера над серединой трассы, вся трасса в кадре.
  // Рендерим во временную камеру и сразу копируем картинку (до следующего кадра буфер ещё не очищен).
  snapshot(track, w = 420, h = 300) {
    const xs = track.p.map(p => p.x), zs = track.p.map(p => p.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, cam = new THREE.PerspectiveCamera(38, w / h, 1, 1200);
    const t = Math.tan(THREE.MathUtils.degToRad(19));
    const dist = Math.max((x1 - x0 + 30) / (w / h), z1 - z0 + 30) / (2 * t) * 1.25;
    cam.position.set(cx, dist * 0.92, cz + dist * 0.4); cam.lookAt(cx, 0, cz);
    const fog = this.scene.fog; this.scene.fog = null;
    this.sun.position.set(cx - 40, 120, cz + 30); this.sun.target.position.set(cx, 0, cz);
    this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = true;   // после снимка окно теней вернётся к камере
    this.renderer.render(this.scene, cam);
    this.scene.fog = fog;
    const src = this.renderer.domElement, out = document.createElement('canvas'); out.width = w; out.height = h;
    const sa = src.width / src.height, da = w / h;
    const sw = sa > da ? src.height * da : src.width, sh = sa > da ? src.height : src.width / da;
    out.getContext('2d').drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    return out;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // на узких экранах отодвигаем камеру, чтобы трасса влезала
    this.camScale = w < h ? 1.35 : 1;
    this.camera.updateProjectionMatrix();
  }

  // Камера смотрит чуть вперёд по ходу движения и плавно догоняет цель
  follow(robot, dt, snap = false) {
    const fx = Math.cos(robot.a), fz = Math.sin(robot.a);
    const vx = fx * robot.v - fz * robot.lat, vz = fz * robot.v + fx * robot.lat;
    const tx = robot.x + vx * C.cam.lead, tz = robot.z + vz * C.cam.lead;
    const k = snap ? 1 : 1 - Math.exp(-C.cam.smooth * dt);
    this.camTarget.x += (tx - this.camTarget.x) * k;
    this.camTarget.z += (tz - this.camTarget.z) * k;
    const s = this.camScale;
    this.camera.position.set(this.camTarget.x, C.cam.height * s, this.camTarget.z + C.cam.back * s);
    this.camera.lookAt(this.camTarget);
    // Тень следует за камерой шагами по ~8 единиц, кратными пикселю карты теней: шаг в пиксель убирает
    // дрожание краёв теней, а крупный шаг — чтобы карту теней не приходилось перерисовывать каждый кадр.
    const L = this.lightBasis || (this.lightBasis = this.makeLightBasis());
    const p = this.camTarget, step = L.texel * Math.max(1, Math.round(SHADOW_STEP / L.texel));
    const u = Math.round(p.dot(L.right) / step) * step, v = Math.round(p.dot(L.up) / step) * step, w = Math.round(p.dot(L.fwd) / step) * step;   // вдоль луча тоже шагами — иначе окно «сдвигается» каждый кадр
    const snapped = this.tmpV || (this.tmpV = new THREE.Vector3());
    snapped.copy(L.right).multiplyScalar(u).addScaledVector(L.up, v).addScaledVector(L.fwd, w);
    if (!this.sun.target.position.equals(snapped)) this.shadowDirty = true;
    this.sun.position.copy(snapped).add(this.sunOffset);
    this.sun.target.position.copy(snapped);
  }

  // Оси «экрана» источника света и размер одного пикселя карты теней
  makeLightBasis() {
    const fwd = this.sunOffset.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const cam = this.sun.shadow.camera;
    return { fwd, right, up, texel: (cam.right - cam.left) / this.sun.shadow.mapSize.x };
  }

  render() {
    if (this.shadowDirty || this.shadowEveryFrame || ++this.shadowTick >= SHADOW_EVERY) {
      this.renderer.shadowMap.needsUpdate = true; this.shadowDirty = false; this.shadowTick = 0;
      this.lastShadow = true;
    } else this.lastShadow = false;
    this.renderer.render(this.scene, this.camera);
  }
}
