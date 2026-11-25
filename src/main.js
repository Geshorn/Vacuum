import { C } from './config.js';
import { P } from './phrases.js';
import { input } from './input.js';
import { World } from './world.js';
import { Track } from './track.js';
import { Robot } from './robot.js';
import { hud } from './hud.js';

const world = new World(document.getElementById('game'));
const track = new Track(world.scene);
const bot = new Robot(world.scene);

// Старт: чуть позади линии, носом по ходу трассы
const s0 = track.at(-6);
bot.x = track.p[s0].x; bot.z = track.p[s0].z; bot.a = Math.atan2(track.t[s0].z, track.t[s0].x); bot.seg = s0;
world.follow(bot, 0, true);
hud.initMap(track);
hud.clock(); setInterval(() => hud.clock(), 30000);
setTimeout(() => hud.say(P.start, 2200), 600);
setTimeout(() => hud.hideHint(), 9000);

const race = { lap: 0, lapStart: 0, best: 0, started: false, lastSeg: s0 };
const st = { wasManual: false, lastWallSay: 0, lastDriftSay: 0, lastChargeSay: 0, warned: false, wasDrift: false };

function update(t, dt) {
  const manual = !bot.dead && input.lastKeyTime > 0 && t - input.lastKeyTime < C.manualTimeoutMs;
  if (manual !== st.wasManual) { st.wasManual = manual; hud.say(manual ? P.manualOn : P.manualOff); }

  const a0 = bot.a;
  if (bot.dead) {
    bot.v *= Math.exp(-3 * dt); bot.drifting = false;
    if (t > bot.deadUntil) { bot.dead = false; bot.bat = Math.max(bot.bat, C.battEmergency); hud.say(P.batRevive, 2400); }
  } else if (manual) bot.manual(input.keys, dt);
  else bot.auto(track, dt);

  const hit = bot.integrate(track, a0, dt);
  if (hit > 6) {
    bot.bat = Math.max(0, bot.bat - C.drain.wall);
    if (t - st.lastWallSay > 2500) { st.lastWallSay = t; hud.say(P.wall); }
  }
  if (bot.drifting && !st.wasDrift && t - st.lastDriftSay > 3500) { st.lastDriftSay = t; hud.say(P.drift, 1500); }
  st.wasDrift = bot.drifting;

  // Круги: пересечение старта вперёд
  const seg = bot.seg, n = track.n;
  if (race.lastSeg > n * 0.8 && seg < n * 0.2) {
    if (race.started) {
      const lapMs = t - race.lapStart;
      const isBest = !race.best || lapMs < race.best;
      if (isBest) race.best = lapMs;
      race.lap++; hud.say(isBest && race.lap > 1 ? P.best : P.lap, 2000);
    }
    race.started = true; race.lapStart = t;
  }
  race.lastSeg = seg;
  hud.race(race.lap, race.started ? t - race.lapStart : 0, race.best);

  // Батарея: заряжается на зелёной площадке, иначе расходуется
  const spd = bot.speed();
  const charging = track.onPad(seg) && Math.abs(track.lateral(seg, bot.x, bot.z)) < track.half * 0.45 && bot.bat < 100;
  if (charging) {
    bot.bat = Math.min(100, bot.bat + C.padCharge * dt);
    if (t - st.lastChargeSay > 8000) { st.lastChargeSay = t; hud.say(P.charging, 1400); }
  } else if (!bot.dead) bot.bat = Math.max(0, bot.bat - (C.drain.base + spd * C.drain.speed + (bot.drifting ? C.drain.drift : 0)) * dt);
  if (bot.bat > 30) st.warned = false;
  if (bot.bat < 20 && !st.warned) { st.warned = true; hud.say(P.batWarn, 2400); }
  if (bot.bat <= 0 && !bot.dead) { bot.dead = true; bot.deadUntil = t + C.deadMs; hud.say(P.batDead, 3000); }
  hud.battery(bot.bat, charging);
  hud.speed(spd);
}

let last = 0;
function loop(t) {
  const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
  update(t, dt);
  bot.render(dt, t);
  world.follow(bot, dt);
  hud.drawMap(bot);
  hud.placeSay(bot, world.camera);
  world.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
