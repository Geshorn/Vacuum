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
import { Explosion } from './explosion.js';
import { Smoke } from './smoke.js';
import { Trash } from './trash.js';
import { Kitchen } from './kitchen.js';

const world = new World(document.getElementById('game'));
const track = new Track(world.scene);
const kitchen = new Kitchen(world.scene, track);
const skids = new Skids(world.scene);
const smoke = new Smoke(world.scene);
const trash = new Trash(world.scene, track);
hud.initMap(track);
hud.clock(); setInterval(() => hud.clock(), 30000);

let bot = null, race = null, st = null, mode = 'menu';
window.__game = { track, skids, trash, world, kitchen };   // для отладки из консоли

// Гонка с выбранным роботом: старт чуть позади линии, носом по ходу трассы
function startRace(id) {
  if (bot) world.scene.remove(bot.mesh);
  clearBoom(); hud.hideOut();
  bot = new Robot(world.scene, ROBOTS[id]);
  const s0 = track.at(-6);
  bot.x = track.p[s0].x; bot.z = track.p[s0].z; bot.a = Math.atan2(track.t[s0].z, track.t[s0].x); bot.seg = s0;
  race = { lap: 0, lapStart: 0, best: 0, started: false, lastSeg: s0, tokens: 0, earned: 0, collected: 0 };
  trash.reset();
  st = { pitting: false, wasManual: false, lastWallSay: 0, lastDriftSay: 0, lastChargeSay: 0, warned: false, wasDrift: false };
  input.keys = {}; input.lastKeyTime = 0;
  skids.clear(); smoke.clear();
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
function toMenu() { clearBoom(); hud.hideOut(); mode = 'menu'; menu.show(bot.spec.id); }
addEventListener('keydown', e => {
  if (e.code === 'Escape' && (mode === 'race' || mode === 'out')) toMenu();
  else if (e.code === 'Enter' && mode === 'out' && boom?.t > 1) startRace(bot.spec.id);
});
hud.onOut(() => startRace(bot.spec.id), toMenu);

// ХП кончились: робот взрывается и выбывает из гонки
let boom = null;
function clearBoom() { if (boom) { boom.dispose(); boom = null; } clearTimeout(explode.outT); }
function explode(t) {
  mode = 'out';
  bot.v = bot.lat = 0; bot.mesh.visible = false;
  boom = new Explosion(world.scene, bot.x, bot.z, bot.spec.color, bot.s.radius / 1.3);
  hud.say(P.broken, 1500);
  hud.battery(bot.bat, false); hud.health(0, bot.s.hp); hud.speed(0);
  explode.outT = setTimeout(() => hud.showOut({ robot: bot.spec.name, laps: race.lap, best: race.best, collected: race.collected, earned: race.earned }), 1800);
}

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
    // Автопилот заезжает на пит-стоп при низком заряде, низком ХП или почти полном контейнере: сворачивает в пит-лейн,
    // тормозит у станции и стоит до конца обслуживания. Если решение пришло, когда съезд уже проехан, — заедет на следующем круге.
    const hpPct = bot.hp / bot.s.hp * 100;
    if (!st.pitting && (bot.bat < Math.min(80, C.autoPitBelow * bot.s.drainMul) || hpPct < C.autoPitHp || bot.bin >= C.bin.autoPitAt)) st.pitting = true;
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
      // уезжает, когда заряжен, мусор сдан и робот починен и отполирован (или на ремонт не хватает жетонов)
      const fixed = bot.hp >= bot.s.hp && !bot.dents.length && !bot.scratches.length;
      if (bot.bat >= 100 && bot.bin <= 0 && (fixed || race.tokens < 0.01)) st.pitting = false;
    }
  }

  // Ограничитель скорости в пит-лейне: плавно тормозит до лимита
  if (bot.inLane && bot.v > C.pit.speedLimit) bot.v = Math.max(C.pit.speedLimit, bot.v - bot.s.brake * dt);

  const hit = bot.integrate(track, a0, dt);
  if (bot.inLane && !st.wasLane) hud.say(P.pitIn, 1600);
  st.wasLane = bot.inLane;
  // Царапины: когда робот трётся о стену, примерно каждые 6 единиц пути вдоль неё появляется новая
  if (hit > 0.05 && !bot.dead) {
    st.scrape = (st.scrape || 0) + bot.speed() * dt;
    if (st.scrape > 6) { st.scrape = 0; bot.scratch(); }
  }
  if (hit > 6) bot.bat =Math.max(0, bot.bat - C.drain.wall * bot.s.drainMul);
  // Урон корпусу: растёт с силой удара и массой робота; лёгкие касания стены не вредят
  const dmg = bot.dead ? 0 : Math.max(0, hit - C.damage.threshold) * C.damage.k * bot.s.mass;
  if (dmg > 0) {
    bot.hp = Math.max(0, bot.hp - dmg);
    if (dmg > 3) bot.dent(dmg);
    bot.scratch(); if (dmg > 6) bot.scratch();
    hud.hurt();
    if (bot.hp <= 0) { explode(t); return; }
    else if (bot.hp < bot.s.hp * 0.3 && !st.hpWarned) { st.hpWarned = true; hud.say(P.hpWarn, 2400); }
    else if (t - st.lastWallSay > 2500) { st.lastWallSay = t; hud.say(dmg > 8 ? P.hurt : P.wall); }
  }
  if (bot.hp > bot.s.hp * 0.5) st.hpWarned = false;
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

  // Мусор: робот собирает его в контейнер, пока тот не полон. Скрепки ещё и царапают корпус.
  for (const kind of trash.update(t / 1000, dt, bot, bot.bin >= 100)) {
    const K = C.trash.kinds[kind];
    bot.bin = Math.min(100, bot.bin + K.fill); bot.binValue += K.value; race.collected++;
    if (kind === 'coin' && t - (st.lastCoinSay || 0) > 4000) { st.lastCoinSay = t; hud.say(P.coin, 1200); }
    if (K.damage) {
      bot.hp = Math.max(0, bot.hp - K.damage);
      const q = Math.random() * Math.PI * 2; bot.hitN = [Math.cos(q), Math.sin(q)]; bot.scratch();
      hud.hurt();
      if (bot.hp <= 0) { explode(t); return; }
      if (t - st.lastWallSay > 2500) { st.lastWallSay = t; hud.say(P.clip, 1400); }
    }
  }
  if (bot.bin >= 100 && !st.binFullSaid) { st.binFullSaid = true; hud.say(P.binFull, 2400); }
  if (bot.bin >= 50 && !st.binHalfSaid) { st.binHalfSaid = true; hud.say(P.binHalf, 1600); }
  if (bot.bin < 40) st.binFullSaid = st.binHalfSaid = false;
  bot.updateLoad();

  // Батарея: заряжается на зелёной площадке, иначе расходуется
  const spd = bot.speed();
  // На площадке заряд только растёт до 100% и не тратится — иначе значение дёргается у 100%
  const charging = bot.onPad && bot.bat < 100;
  let repairing = false, unloading = false;
  if (bot.onPad) {
    bot.bat = Math.min(100, bot.bat + C.padCharge * dt);   // зарядка бесплатная
    // Сдача мусора: контейнер пустеет, за каждый сданный % — жетоны утилизации
    if (bot.bin > 0) {
      // жетоны выдаются пропорционально ценности того, что лежит в контейнере
      const amt = Math.min(bot.bin, C.bin.unloadRate * dt), pay = bot.binValue * amt / bot.bin;
      bot.bin -= amt; bot.binValue -= pay; race.tokens += pay; race.earned += pay;
      if (bot.bin <= 0.001) { bot.bin = 0; bot.binValue = 0; }
      unloading = true;
      if (!st.unloadSaid) { st.unloadSaid = true; hud.say(P.unload, 1600); }
    }
    // Ремонт платный: чиним, пока хватает жетонов
    if (bot.hp < bot.s.hp) {
      const perHp = C.bin.repairCost * 100 / bot.s.hp;                          // жетонов за 1 ХП
      const gain = Math.min(bot.s.hp - bot.hp, bot.s.hp * C.repairRate / 100 * dt, race.tokens / perHp);
      if (gain > 0) { bot.hp += gain; race.tokens = Math.max(0, race.tokens - gain * perHp); repairing = true; }
      else if (!unloading && !st.noTokSaid) { st.noTokSaid = true; st.lastChargeSay = t; hud.say(P.noTokens, 2000); }
    }
    // Вмятины и царапины исчезают по одной так, чтобы последняя пропала к концу ремонта
    // (если ХП уже полное, а царапины есть — полируем не меньше 0.8 с; без жетонов на ремонт метки остаются)
    const marks = bot.dents.length + bot.scratches.length;
    if (marks && (repairing || bot.hp >= bot.s.hp)) {
      const rem = (bot.s.hp - bot.hp) / (bot.s.hp * C.repairRate / 100);   // сколько секунд ремонта осталось
      const left = rem > 0 ? Math.max(0.3, rem) : 0.8;
      st.polish = (st.polish || 0) + marks / left * dt;
      while (st.polish >= 1 && bot.removeMark()) st.polish--;
    } else st.polish = 0;
    if (!unloading && (charging || repairing) && t - st.lastChargeSay > 8000) { st.lastChargeSay = t; hud.say(repairing ? P.repairing : P.charging, 1400); }
  } else { st.unloadSaid = st.noTokSaid = false; }
  if (!bot.onPad && !bot.dead) bot.bat = Math.max(0, bot.bat - (C.drain.base + spd * C.drain.speed + (bot.drifting ? C.drain.drift : 0)) * bot.s.drainMul * dt);
  if (bot.bat > 30) st.warned = false;
  if (bot.bat < 20 && !st.warned) { st.warned = true; hud.say(P.batWarn, 2400); }
  if (bot.bat <= 0 && !bot.dead) { bot.dead = true; bot.deadUntil = t + C.deadMs; hud.say(P.batDead, 3000); }
  hud.battery(bot.bat, charging);
  track.update(t, charging || repairing || unloading);
  hud.speed(spd);
  hud.health(bot.hp, bot.s.hp, repairing);
  hud.bin(bot.bin, unloading);
  hud.tokens(race.tokens);
}

let last = 0;
function loop(t) {
  const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
  if (mode === 'race') {
    update(t, dt);
    if (mode === 'race') bot.render(dt, t);
    skids.update(bot);
    smoke.update(dt, bot);
    world.follow(bot, dt);
    hud.drawMap(bot);
    hud.placeSay(bot, world.camera);
  } else if (mode === 'out') {
    // робот взорвался: камера стоит на месте взрыва и трясётся
    boom.update(dt);
    smoke.update(dt, null);   // старый дым досыпает, новый не идёт
    trash.update(t / 1000, dt, null);
    world.follow(bot, dt);
    const k = boom.shake() * 1.2;
    world.camera.position.x += (Math.random() - 0.5) * k; world.camera.position.y += (Math.random() - 0.5) * k;
    hud.drawMap(bot);
    hud.placeSay(bot, world.camera);
  } else {
    menuCamera(dt);
    menu.render(t);
  }
  kitchen.update(t / 1000);
  world.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
