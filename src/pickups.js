import * as THREE from 'three';
import { C } from './config.js';

/* Коробки-бонусы: ряды по три поперёк трассы в нескольких местах круга. Робот с пустым слотом,
   проехав через коробку, получает случайное оружие; коробка исчезает и через несколько секунд появляется снова. */

export const WEAPONS = {
  soap:   { name: 'Моющее средство', icon: '🧴' },
  trash:  { name: 'Залп мусором',    icon: '🗑️' },
  sponge: { name: 'Губка-щит',       icon: '🧽' },
  banana: { name: 'Банановая кожура', icon: '🍌' },
  cap:    { name: 'Пробка',          icon: '🍾' },
  rocket: { name: 'Пылевая ракета',  icon: '💨' },
  turbo:  { name: 'Турбо',           icon: '⚡' },
  magnet: { name: 'Магнит',          icon: '🧲' },
};

function boxTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 64, 64); g.addColorStop(0, '#ffb347'); g.addColorStop(1, '#ff6a3d');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#fff3d6'; x.lineWidth = 4; x.strokeRect(4, 4, 56, 56);
  x.fillStyle = '#fff'; x.font = 'bold 40px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 32, 35);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class Pickups {
  constructor(scene, track) {
    this.track = track; this.items = [];
    this.group = new THREE.Group(); scene.add(this.group);
    const mat = new THREE.MeshStandardMaterial({ map: boxTexture(), emissive: '#ff7a3d', emissiveIntensity: 0.35, roughness: 0.4 });
    const geo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.5, depthWrite: false });
    for (const f of C.pickups.rows) {
      const i = track.at(Math.round(track.n * f));
      for (const lat of C.pickups.lanes) {
        const [x, , z] = track.edge(i, lat);
        const g = new THREE.Group(); g.position.set(x, 0, z); this.group.add(g);
        const box = new THREE.Mesh(geo, mat); box.position.y = 1.6; box.castShadow = true; g.add(box);
        const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 24), ringMat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
        this.items.push({ g, box, x, z, alive: true, back: 0, ph: Math.random() * 6 });
      }
    }
  }

  reset() { for (const it of this.items) { it.alive = true; it.g.visible = true; } }

  // bots — роботы на трассе; onGet(bot, weapon) — кто что подобрал
  update(t, dt, bots, onGet) {
    for (const it of this.items) {
      if (!it.alive) { if (t > it.back) { it.alive = true; it.g.visible = true; } continue; }
      it.box.rotation.y += dt * 1.6; it.box.rotation.x = Math.sin(t * 1.3 + it.ph) * 0.3;
      it.box.position.y = 1.6 + Math.sin(t * 2.5 + it.ph) * 0.25;
      for (const b of bots) {
        if (b.weapon || !b.mesh.visible) continue;
        const r = b.s.radius + 1;
        if ((b.x - it.x) ** 2 + (b.z - it.z) ** 2 < r * r) {
          const keys = Object.keys(WEAPONS), w = keys[Math.floor(Math.random() * keys.length)];
          b.weapon = w; it.alive = false; it.g.visible = false; it.back = t + C.pickups.respawn;
          onGet(b, w); break;
        }
      }
    }
  }
}
