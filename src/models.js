import * as THREE from 'three';

/* 3D-модель робота-пылесоса из простых фигур.
   Нос смотрит вдоль +X, низ на y = 0, R — радиус робота (для столкновений).
   eyeMat меняет цвет по состоянию; spinners — то, что вращается со скоростью робота (щётки). */

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.1, ...o });
const DARK = std('#2a2230', { roughness: 0.5 });

function add(g, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m;
}

export function buildModel(spec) {
  const g = new THREE.Group(), R = spec.radius;
  const shell = std(spec.color);
  const eye = new THREE.MeshBasicMaterial({ color: '#6ef0ff' });
  const spinners = [];

  add(g, new THREE.CylinderGeometry(R, R * 1.03, 0.55, 40), shell, 0, 0.38, 0);
  add(g, new THREE.CylinderGeometry(R * 0.78, R * 0.82, 0.12, 40), DARK, 0, 0.71, 0);
  add(g, new THREE.CylinderGeometry(0.32, 0.36, 0.22, 24), shell, -0.2, 0.86, 0);
  const bumper = add(g, new THREE.TorusGeometry(R * 1.02, 0.12, 8, 30, Math.PI * 0.9), DARK, 0, 0.3, 0);
  bumper.rotation.set(Math.PI / 2, 0, -Math.PI * 0.45);
  for (const s of [-1, 1]) add(g, new THREE.SphereGeometry(0.13, 12, 8), eye, R * 0.72, 0.76, s * 0.32);

  // Боковые щётки
  const brushMat = std('#ff5b3a');
  for (const s of [-1, 1]) {
    const b = new THREE.Group(); b.position.set(R * 0.75, 0.1, s * R * 0.75); g.add(b);
    for (let k = 0; k < 3; k++) {
      const h = new THREE.Group(); h.rotation.y = k * Math.PI * 2 / 3; b.add(h);
      add(h, new THREE.BoxGeometry(0.7, 0.04, 0.06), brushMat, 0.35, 0, 0);
    }
    spinners.push({ obj: b, axis: 'y', k: 1.2 * s, idle: 4 });
  }

  g.traverse(o => { if (o.isMesh && o.material !== eye) o.castShadow = true; });
  return { group: g, eyeMat: eye, spinners };
}
