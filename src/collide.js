import { C } from './config.js';
let uidSeq = 0;
const uid = b => b.uid || (b.uid = ++uidSeq);

/* Столкновения роботов друг с другом: круги радиусом робота.
   Расталкиваем пропорционально массе (тяжёлый почти не сдвигается), обмениваемся импульсом
   с небольшой упругостью; урон от удара — как от стены, но лёгкому достаётся больше, чем тяжёлому. */

// скорость робота в мировых осях и обратно (у робота — продольная v и боковая lat)
function velOf(b) { const c = Math.cos(b.a), s = Math.sin(b.a); return [c * b.v - s * b.lat, s * b.v + c * b.lat]; }
function setVel(b, wx, wz) { const c = Math.cos(b.a), s = Math.sin(b.a); b.v = wx * c + wz * s; b.lat = -wx * s + wz * c; }

// bots — активные роботы; onHit(bot, dmg, nx, nz, other) вызывается для каждого пострадавшего
// now — время в секундах: одна и та же пара наносит урон не чаще раза в C.bump.cooldown с
const lastHit = new WeakMap();
export function collideRobots(bots, onHit, now) {
  for (let i = 0; i < bots.length; i++) for (let j = i + 1; j < bots.length; j++) {
    const a = bots[i], b = bots[j]; uid(a); uid(b);
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), R = a.s.radius + b.s.radius;
    if (d >= R || d < 1e-6) continue;
    const nx = dx / d, nz = dz / d, ma = a.s.mass, mb = b.s.mass, M = ma + mb;
    // разводим, чтобы не пересекались
    const over = R - d;
    a.x -= nx * over * mb / M; a.z -= nz * over * mb / M;
    b.x += nx * over * ma / M; b.z += nz * over * ma / M;
    // импульс вдоль линии центров
    const [ax, az] = velOf(a), [bx, bz] = velOf(b);
    const vn = (bx - ax) * nx + (bz - az) * nz;
    if (vn >= 0) continue;                          // уже расходятся
    const e = C.bump.restitution, jimp = -(1 + e) * vn / (1 / ma + 1 / mb);
    setVel(a, ax - jimp / ma * nx, az - jimp / ma * nz);
    setVel(b, bx + jimp / mb * nx, bz + jimp / mb * nz);
    // урон: сила удара минус порог; лёгкому достаётся больше
    const base = Math.max(0, -vn - C.bump.threshold) * C.bump.k;
    const pa = lastHit.get(a) || {}, ready = !(pa[b.uid] > now - C.bump.cooldown);
    if (base > 0 && ready) {
      pa[b.uid] = now; lastHit.set(a, pa);
      onHit(a, base * 2 * mb / M * C.bump.damageMul, -nx, -nz, b);
      onHit(b, base * 2 * ma / M * C.bump.damageMul, nx, nz, a);
    }
  }
}
