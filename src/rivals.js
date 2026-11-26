import { C } from './config.js';
import { Robot } from './robot.js';
import { Smoke } from './smoke.js';
import { Explosion } from './explosion.js';

/* Соперники: роботы на автопилоте. Едут каждый со своей скоростью и «своей» полосой (слегка виляют),
   собирают мусор, тратят батарею, бьются о стены, заезжают в боксы (у них зарядка, сдача мусора и ремонт
   бесплатные — экономика только у игрока) и взрываются при 0 ХП, выбывая из гонки. */
const rnd = (a, b) => a + Math.random() * (b - a);

export class Rival {
  constructor(scene, spec, track) {
    this.scene = scene; this.track = track;
    this.bot = new Robot(scene, spec);
    this.bot.rival = this;
    this.smoke = new Smoke(scene);
    this.speedMul = rnd(...C.rivals.speed) / C.autoSpeed;
    this.lane = rnd(-1, 1); this.laneT = rnd(0, 6);
    this.pitting = false; this.pitCommit = false;
    this.out = false; this.boom = null;
    this.race = { crossings: 0, lastSeg: 0 };
  }

  place(seg, lat) {
    const t = this.track, b = this.bot, i = t.at(seg);
    const [x, , z] = t.edge(i, lat);
    b.x = x; b.z = z; b.a = Math.atan2(t.t[i].z, t.t[i].x); b.seg = i;
    this.race.lastSeg = i;
  }

  update(t, dt, now) {
    const b = this.bot, tr = this.track;
    if (this.out) { if (this.boom) this.boom.update(dt); this.smoke.update(dt, null); return; }
    const a0 = b.a;
    if (b.dead) {                                   // села батарея — постоит и оживёт
      b.v *= Math.exp(-3 * dt);
      if (now > b.deadUntil) { b.dead = false; b.bat = Math.max(b.bat, C.battEmergency); }
    } else {
      if (!this.pitting && (b.bat < 30 || b.hp < b.s.hp * 0.35 || b.bin >= C.bin.autoPitAt)) this.pitting = true;
      const k = tr.pitK(b.seg);
      if (k < 0 || k < tr.pitRamp * 0.4) this.pitCommit = this.pitting;
      const usePit = b.inLane || this.pitCommit;
      // своя «полоса»: смещение от центра медленно гуляет — соперники не едут гуськом
      this.laneT += dt * 0.3;
      let lane = Math.sin(this.laneT) * C.rivals.laneWobble + this.lane * 2;
      if (this.ram != null) lane = Math.max(-tr.half + 2, Math.min(tr.half - 2, this.ram));   // таран: на полосу соперника впереди
      const blind = b.blindUntil > t;                 // ослеплён пылевой ракетой: виляет и сбрасывает газ
      if (blind) lane += Math.sin(t * 6) * 4;
      // на таран чуть прибавляет газу, чтобы догнать
      b.auto(tr, dt, usePit ? i => tr.pitOff(i) : () => lane, this.speedMul * (this.ram != null ? 1.12 : 1) * (blind ? 0.75 : 1));
      if (usePit && !b.inLane) {
        const toEntry = ((tr.pitStart - b.seg + tr.n) % tr.n) * C.sampleStep;
        if (k >= 0 || toEntry < 30) b.v = Math.min(b.v, C.pit.speedLimit + 4 + Math.max(0, toEntry) * 0.3);
      }
      if (this.pitting && b.inLane) {
        const ahead = (tr.padMid - b.seg + tr.n) % tr.n * C.sampleStep;
        if (b.onPad) b.v = Math.max(0, b.v - b.s.brake * dt);
        else if (ahead < 40) b.v = Math.min(b.v, 3 + ahead * 0.45);
        if (b.bat >= 100 && b.bin <= 0 && b.hp >= b.s.hp) this.pitting = false;
      }
    }
    if (b.inLane && b.v > C.pit.speedLimit) b.v = Math.max(C.pit.speedLimit, b.v - b.s.brake * dt);

    const hit = b.integrate(tr, a0, dt);
    this.wallDamage(hit);
    if (this.out) return;

    // круги: считаем пересечения линии старта вперёд
    const seg = b.seg, n = tr.n;
    if (this.race.lastSeg > n * 0.8 && seg < n * 0.2) this.race.crossings++;
    if (this.race.lastSeg < n * 0.2 && seg > n * 0.8) this.race.crossings--;
    this.race.lastSeg = seg;

    // пит-стоп: бесплатная зарядка, сдача мусора и ремонт
    b.onPad = tr.onPad(seg, tr.lateral(seg, b.x, b.z));
    if (b.onPad) {
      b.bat = Math.min(100, b.bat + C.padCharge * dt);
      b.bin = Math.max(0, b.bin - C.bin.unloadRate * dt); if (!b.bin) b.binValue = 0;
      b.hp = Math.min(b.s.hp, b.hp + b.s.hp * C.repairRate / 100 * dt);
      if (b.hp >= b.s.hp) while (b.removeMark());
    } else if (!b.dead) {
      b.bat = Math.max(0, b.bat - (C.drain.base + b.speed() * C.drain.speed + (b.drifting ? C.drain.drift : 0)) * b.s.drainMul * dt);
      if (b.bat <= 0) { b.dead = true; b.deadUntil = now + C.deadMs; }
    }
    b.updateLoad();
    b.render(dt, now);
    this.smoke.update(dt, b);
  }

  // Урон от стен — как у игрока
  wallDamage(hit) {
    const b = this.bot;
    if (hit > 6) b.bat = Math.max(0, b.bat - C.drain.wall * b.s.drainMul);
    const dmg = Math.max(0, hit - C.damage.threshold) * C.damage.k * b.s.mass;
    if (dmg > 0) this.hurt(dmg);
  }

  hurt(dmg) {
    const b = this.bot;
    if (this.out || b.shieldUntil > performance.now() / 1000) return;   // губка-щит: любой урон мимо
    b.hp = Math.max(0, b.hp - dmg);
    if (dmg > 3) b.dent(dmg);
    b.scratch();
    if (b.hp <= 0) this.explode();
  }

  explode() {
    const b = this.bot;
    this.out = true; b.v = b.lat = 0; b.mesh.visible = false;
    this.boom = new Explosion(this.scene, b.x, b.z, b.spec.color, b.s.radius / 1.3);
  }

  // Сколько проехано: полные круги × длина + сегмент (для мест в гонке)
  progress() { return this.race.crossings * this.track.n + this.bot.seg; }

  dispose() {
    this.scene.remove(this.bot.mesh); this.scene.remove(this.smoke.group);
    if (this.boom) this.boom.dispose();
  }
}
