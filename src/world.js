import * as THREE from 'three';
import { C } from './config.js';

// Рендерер, сцена в закатной гамме, свет и камера, которая едет за роботом под фиксированным наклоном.
export class World {
  constructor(container) {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
    container.appendChild(r.domElement);

    const s = this.scene = new THREE.Scene();
    s.fog = new THREE.Fog('#6a1230', 90, 230);

    s.add(new THREE.HemisphereLight('#ffb59a', '#2a0614', 1.1));
    const sun = this.sun = new THREE.DirectionalLight('#ffc29a', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
    sun.shadow.bias = -0.0005;
    s.add(sun, sun.target);
    this.sunOffset = new THREE.Vector3(-40, 70, 30);

    // Пол — тёмный «рабочий стол» с сеткой, чтобы чувствовалась скорость
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: '#3a0c22', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    s.add(ground);
    const grid = new THREE.GridHelper(1200, 240, '#ff6a4d', '#ff6a4d');
    grid.material.transparent = true; grid.material.opacity = 0.08; grid.position.y = -0.01;
    s.add(grid);

    this.camera = new THREE.PerspectiveCamera(C.cam.fov, 1, 0.5, 600);
    this.camTarget = new THREE.Vector3();
    this.resize();
    addEventListener('resize', () => this.resize());
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
    // тень следует за камерой
    this.sun.position.copy(this.camTarget).add(this.sunOffset);
    this.sun.target.position.copy(this.camTarget);
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
