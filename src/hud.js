import { fmtTime, pick } from './util.js';

const $ = id => document.getElementById(id);
const D = { lap: $('lap'), time: $('time'), best: $('best'), batt: $('batt'), fill: $('battfill'), pct: $('battpct'),
  clock: $('clock'), rname: $('rname'), hpfill: $('hpfill'), hpval: $('hpval'), say: $('say'), hint: $('hint'), map: $('minimap'), spd: $('spd') };

export const hud = {
  // Мини-карта: трасса вписывается в canvas один раз, затем рисуем точку робота
  initMap(track) {
    const xs = track.p.map(p => p.x), zs = track.p.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const W = D.map.width, H = D.map.height, pad = 14;
    const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
    const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
    this.toMap = (x, z) => [ox + (x - minX) * s, oz + (z - minZ) * s];
    this.track = track;
  },

  drawMap(robot) {
    const c = D.map.getContext('2d'), t = this.track;
    c.clearRect(0, 0, D.map.width, D.map.height);
    c.lineJoin = 'round'; c.beginPath();
    t.p.forEach((p, i) => { const [x, y] = this.toMap(p.x, p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.closePath();
    c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 7; c.stroke();
    c.strokeStyle = '#4a3a48'; c.lineWidth = 4; c.stroke();
    // пит-лейн, зарядка и старт
    c.beginPath();
    for (let k = 0; k <= t.pitLen; k++) { const i = t.at(t.pitStart + k), [ex, , ez] = t.edge(i, t.pitOff(i)), [x, y] = this.toMap(ex, ez); k ? c.lineTo(x, y) : c.moveTo(x, y); }
    c.strokeStyle = 'rgba(255,204,51,.8)'; c.lineWidth = 2; c.stroke();
    const [mx, , mz] = t.edge(t.padMid, t.pitFull), [px, py] = this.toMap(mx, mz);
    c.fillStyle = '#4cd964'; c.fillRect(px - 3, py - 3, 6, 6);
    const [sx, sy] = this.toMap(t.p[0].x, t.p[0].z);
    c.fillStyle = '#fff'; c.fillRect(sx - 2, sy - 5, 4, 10);
    // робот — стрелка
    const [rx, ry] = this.toMap(robot.x, robot.z);
    c.save(); c.translate(rx, ry); c.rotate(robot.a);
    c.fillStyle = '#ff5b3a'; c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(7, 0); c.lineTo(-5, 5); c.lineTo(-2, 0); c.lineTo(-5, -5); c.closePath(); c.fill(); c.stroke();
    c.restore();
  },

  race(lap, ms, best) {
    D.lap.textContent = lap; D.time.textContent = fmtTime(ms); D.best.textContent = best ? fmtTime(best) : '—';
  },

  battery(bat, charging) {
    const pct = Math.round(bat);
    D.fill.style.width = pct + '%'; D.pct.textContent = pct + '%';
    D.batt.className = (pct < 20 ? 'low' : pct < 40 ? 'mid' : '') + (charging ? ' chg' : '');
  },

  robot(name) { D.rname.textContent = name; },

  health(hp, max) {
    D.hpfill.style.width = Math.max(0, hp / max * 100) + '%';
    D.hpval.textContent = Math.ceil(hp) + ' ХП';
  },

  speed(v) { D.spd.textContent = Math.round(v * 6); },   // условные «км/ч»

  clock() { const d = new Date(); D.clock.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); },

  say(list, ms = 1800) {
    D.say.textContent = pick(list); D.say.classList.add('on');
    clearTimeout(this.sayT); this.sayT = setTimeout(() => D.say.classList.remove('on'), ms);
  },

  // Пузырь с репликой висит над роботом
  placeSay(robot, camera) {
    const v = this.tmp || (this.tmp = new camera.position.constructor());
    v.set(robot.x, 2.6, robot.z).project(camera);
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    D.say.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
  },

  hideHint() { D.hint.style.opacity = 0; },
  showHint() { D.hint.style.opacity = 1; },
};
