import { C } from './config.js';
import { ROBOTS, PLAYER_ROBOT } from './robots.js';
import { P } from './phrases.js';
import { input } from './input.js';
import { World } from './world.js';
import { Track } from './track.js';
import { Robot } from './robot.js';
import { hud } from './hud.js';
import { Skids } from './skids.js';
import { Menu } from './menu.js';

const world = new World(document.getElementById('game'));
const track = new Track(world.scene);
const skids = new Skids(world.scene);
hud.initMap(track);
hud.clock(); setInterval(() => hud.clock(), 30000);

let bot = null, race = null, st = null, mode = 'menu';
window.__game = { track, skids };   // для отладки из консоли

// Гонка с выбранным роботом: старт чуть позади линии, носом по ходу трассы
function startRace(id) {
  if (bot) world.scene.remove(bot.mesh);
  bot = new Robot(world.scene, ROBOTS[id]);
  const s0 = track.at(-6);
  bot.x = track.p[s0].x; bot.z = track.p[s0].z; bot.a = Math.atan2(track.t[s0].z, track.t[s0].x); bot.seg = s0;
  race = { lap: 0, lapStart: 0, best: 0, started: false, lastSeg: s0 };
  st = { pitting: false, wasManual: false, lastWallSay: 0, lastDriftSay: 0, lastChargeSay: 0, warned: false, wasDrift: false };
  input.keys = {}; input.lastKeyTime = 0;
  skids.clear();
  world.follow(bot, 0, true);
  hud.robot(bot.spec.name);
  Object.assign(window.__game, { bot, st, race });
  menu.hide(); mode = 'race';
  hud.showHint();
  setTimeout(() => hud.say(P.start, 2200), 600);
  clearTimeout(startRace.hintT); startRace.hintT = setTimeout(() => hud.hideHint(), 9000);
}

const menu = new Menu(startRace);
menu.show(PLAYER_ROBOT);
addEventListener('keydown', e => { if (e.code === 'Escape' && mode === 'race') { mode = 'menu'; menu.show(bot.spec.id); } });

// Пока открыто меню, камера медленно едет вдоль трассы
const ghost = { x: 0, z: 0, a: 0, v: 0, lat: 0, i: 0 };
function menuCamera(dt) {
  ghost.i = (ghost.i + dt * 8) % track.n;
  const p = track.p[Math.floor(ghost.i)];
  ghost.x = p.x; ghost.z = p.z;
  world.follow(ghost, dt);
}

function update(t, dt) {
  // Пока игрок стоит на пит-стопе, автопилот не перехватывает управление
  if (st.wasManual && bot.onPad && bot.speed() < 2) input.lastKeyTime = t;
  const manual = !bot.dead && input.lastKeyTime > 0 && t - input.lastKeyTime < C.manualTimeoutMs;
  if (manual !== st.wasManual) { st.wasManual = manual; hud.say(manual ? P.manualOn : P.manualOff); }

  const a0 = bot.a;
  if (bot.dead) {
    bot.v *= Math.exp(-3 * dt); bot.drifting = false;
    if (t > bot.deadUntil) { bot.dead = false; bot.bat = Math.max(bot.bat, C.battEmergency); hud.say(P.batRevive, 2400); }
  } else if (manual) { bot.manual(input.keys, dt); st.pitting = st.pitCommit = false; }
  else {
    // Автопилот заезжает на пит-стоп только при низком заряде: сворачивает в пит-лейн, тормозит у станции
    // и стоит до полной зарядки. Если решение пришло, когда съезд уже проехан, — заедет на следующем круге.
    if (!st.pitting && bot.bat < Math.min(80, C.autoPitBelow * bot.s.drainMul)) st.pitting = true;
    const k = track.pitK(bot.seg);
    // решение «еду в боксы» принимается до середины съезда и дальше не меняется
    if (k < 0 || k < track.pitRamp * 0.4) st.pitCommit = st.pitting;
    const usePit = bot.inLane || st.pitCommit;
    bot.auto(track, dt, usePit ? i => track.pitOff(i) : null);
    // перед съездом сбрасываем скорость, чтобы аккуратно вписаться
    if (usePit && !bot.inLane) {
      const toEntry = ((track.pitStart - bot.seg + track.n) % track.n) * C.sampleStep;
      if (k >= 0 || toEntry < 30) bot.v = Math.min(bot.v, C.pit.speedLimit + 4 + Math.max(0, toEntry) * 0.3);
    }
    if (st.pitting && bot.inLane) {
      const ahead = (track.padMid - bot.seg + track.n) % track.n * C.sampleStep;   // расстояние до центра площадки
      if (bot.onPad) bot.v = Math.max(0, bot.v - bot.s.brake * dt);
      else if (ahead < 40) bot.v = Math.min(bot.v, 3 + ahead * 0.45);
      if (bot.bat >= 100) st.pitting = false;
    }
  }

  // Ограничитель скорости в пит-лейне: плавно тормозит до лимита
  if (bot.inLane && bot.v > C.pit.speedLimit) bot.v = Math.max(C.pit.speedLimit, bot.v - bot.s.brake * dt);

  const hit = bot.integrate(track, a0, dt);
  if (bot.inLane && !st.wasLane) hud.say(P.pitIn, 1600);
  st.wasLane = bot.inLane;
  if (hit > 6) {
    bot.bat = Math.max(0, bot.bat - C.drain.wall * bot.s.drainMul);
    if (t - st.lastWallSay > 2500) { st.lastWallSay = t; hud.say(P.wall); }
  }
  if (bot.drifting && !st.wasDrift && t - st.lastDriftSay > 3500) { st.lastDriftSay = t; hud.say(P.drift, 1500); }
  st.wasDrift = bot.drifting;

  // Круги: пересечение старта вперёд
  const seg = bot.seg, n = track.n;
  bot.onPad = track.onPad(seg, track.lateral(seg, bot.x, bot.z));
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
  // На площадке заряд только растёт до 100% и не тратится — иначе значение дёргается у 100%
  const charging = bot.onPad && bot.bat < 100;
  if (bot.onPad) {
    bot.bat = Math.min(100, bot.bat + C.padCharge * dt);
    if (charging && t - st.lastChargeSay > 8000) { st.lastChargeSay = t; hud.say(P.charging, 1400); }
  } else if (!bot.dead) bot.bat = Math.max(0, bot.bat - (C.drain.base + spd * C.drain.speed + (bot.drifting ? C.drain.drift : 0)) * bot.s.drainMul * dt);
  if (bot.bat > 30) st.warned = false;
  if (bot.bat < 20 && !st.warned) { st.warned = true; hud.say(P.batWarn, 2400); }
  if (bot.bat <= 0 && !bot.dead) { bot.dead = true; bot.deadUntil = t + C.deadMs; hud.say(P.batDead, 3000); }
  hud.battery(bot.bat, charging);
  track.update(t, charging);
  hud.speed(spd);
  hud.health(bot.hp, bot.s.hp);
}

let last = 0;
function loop(t) {
  const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
  if (mode === 'race') {
    update(t, dt);
    bot.render(dt, t);
    skids.update(bot);
    world.follow(bot, dt);
    hud.drawMap(bot);
    hud.placeSay(bot, world.camera);
  } else {
    menuCamera(dt);
    menu.render(t);
  }
  world.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
