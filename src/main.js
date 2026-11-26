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
import { Rival } from './rivals.js';
import { collideRobots } from './collide.js';
import { Pickups, WEAPONS } from './pickups.js';
import { Combat } from './weapons.js';

const world = new World(document.getElementById('game'));
const track = new Track(world.scene);
const kitchen = new Kitchen(world.scene, track);
const skids = new Skids(world.scene);
const smoke = new Smoke(world.scene);
const trash = new Trash(world.scene, track);
const pickups = new Pickups(world.scene, track);
const combat = new Combat(world.scene, track);
hud.initMap(track);
hud.clock(); setInterval(() => hud.clock(), 30000);

let bot = null, race = null, st = null, mode = 'menu', rivals = [];
window.__game = { track, skids, trash, world, kitchen, combat };   // для отладки из консоли

// Гонка с выбранным роботом: старт чуть позади линии, носом по ходу трассы
function startRace(id) {
  if (bot) world.scene.remove(bot.mesh);
  clearBoom(); hud.hideOut();
  bot = new Robot(world.scene, ROBOTS[id]);
  // Стартовая решётка: по два в ряд за линией старта; игрок — во втором ряду слева
  const slot = k => [-6 - Math.floor(k / 2) * 8, k % 2 ? -3.5 : 3.5];
  const [ps, pl] = slot(2), s0 = track.at(ps), [px, , pz] = track.edge(s0, pl);
  bot.x = px; bot.z = pz; bot.a = Math.atan2(track.t[s0].z, track.t[s0].x); bot.seg = s0;
  race = { lap: 0, lapStart: 0, best: 0, started: false, lastSeg: s0, tokens: 0, earned: 0, collected: 0, crossings: 0 };
  for (const r of rivals) r.dispose();
  const pool = Object.keys(ROBOTS).filter(k => k !== id).sort(() => Math.random() - 0.5);
  rivals = pool.slice(0, C.rivals.count).map((rid, k) => {
    const r = new Rival(world.scene, ROBOTS[rid], track), [s, l] = slot(k < 2 ? k : k + 1);
    r.place(s, l); return r;
  });
  trash.reset(); pickups.reset(); combat.clear(); hud.weapon(null); hud.blind(false);
  st = { pitting: false, wasManual: false, lastWallSay: 0, lastDriftSay: 0, lastChargeSay: 0, warned: false, wasDrift: false };
  input.keys = {}; input.lastKeyTime = 0;
  skids.clear(); smoke.clear();
  world.follow(bot, 0, true);
  hud.robot(bot.spec.name);
  Object.assign(window.__game, { bot, st, race, rivals });
  menu.hide(); mode = 'race';
  hud.showHint();
  setTimeout(() => hud.say(P.start, 2200), 600);
  clearTimeout(startRace.hintT); startRace.hintT = setTimeout(() => hud.hideHint(), 9000);
}

const menu = new Menu(startRace);
menu.show(PLAYER_ROBOT);
function toMenu() { clearBoom(); hud.hideOut(); mode = 'menu'; menu.show(bot.spec.id); }
addEventListener('keydown', e => {
  if (e.code === 'Space' && mode === 'race') {      // применить оружие
    e.preventDefault();
    const w = bot.weapon;
    if (!w) return;
    if (combat.fire(bot, performance.now() / 1000)) { hud.weapon(null); hud.say(P['fire_' + w], 1200); }
    else hud.say(P.binEmpty, 1600);
  }
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
  const [pl, tot] = placeOf();
  explode.outT = setTimeout(() => hud.showOut({ robot: bot.spec.name, laps: race.lap, best: race.best, collected: race.collected, earned: race.earned, place: pl + '/' + tot, kills: race.kills || 0 }), 1800);
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
  if (bot.stunUntil > t / 1000) {                   // поскользнулся на банане: руль и газ не работают, скользит юзом
    bot.v *= Math.exp(-0.9 * dt);
  } else if (bot.dead) {
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
  const shielded = combat.absorb(bot, t / 1000);   // губка-щит: от стен тоже защищает
  const dmg = bot.dead || shielded ? 0 : Math.max(0, hit - C.damage.threshold) * C.damage.k * bot.s.mass;
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
  if (race.lastSeg < n * 0.2 && seg > n * 0.8) race.crossings--;   // откатился назад через старт
  if (race.lastSeg > n * 0.8 && seg < n * 0.2) {
    race.crossings++;
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

  // Мусор: роботы собирают его в контейнер, пока тот не полон. Скрепки ещё и царапают корпус.
  for (const { bot: who, kind } of trash.update(t / 1000, dt, [bot, ...rivals.filter(r => !r.out).map(r => r.bot)])) {
    const K = C.trash.kinds[kind];
    if (K.charge) {                                 // батарейка: сразу в заряд, не в контейнер
      who.bat = Math.min(100, who.bat + K.charge);
      if (who === bot) hud.say(P.battery, 1200);
      continue;
    }
    if (who !== bot) {                              // соперник
      who.bin = Math.min(100, who.bin + K.fill); who.binValue += K.value;
      if (K.damage) who.rival.hurt(K.damage);
      continue;
    }
    bot.bin = Math.min(100, bot.bin + K.fill); bot.binValue += K.value; race.collected++;
    if (kind === 'coin' && t - (st.lastCoinSay || 0) > 4000) { st.lastCoinSay = t; hud.say(P.coin, 1200); }
    if (K.damage && !combat.absorb(bot, t / 1000)) {
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
  hud.place(...placeOf());
  hud.blind(bot.blindUntil > t / 1000);
}

// Место игрока в гонке: сколько ещё в гонке и сколько из них проехали больше
function placeOf() {
  const me = race.crossings * track.n + bot.seg, alive = rivals.filter(r => !r.out);
  return [1 + alive.filter(r => r.progress() > me).length, alive.length + 1];
}

function updateRivals(t, dt) {
  for (const r of rivals) r.update(t / 1000, dt, t);
  const list = rivals.filter(r => !r.out).map(r => r.bot);
  if (mode === 'race') list.push(bot);
  pickups.update(t / 1000, dt, list, (who, w) => {
    if (who === bot) { hud.weapon(w); hud.say([WEAPONS[w].icon + ' ' + WEAPONS[w].name + '!'], 1400); }
  }, chooseWeapon);
  const now = t / 1000;
  // соперники: применяют оружие, таранят того, кто впереди, а с пустым слотом рулят к ближайшей коробке
  for (const r of rivals) if (!r.out) {
    combat.think(r, list, now);
    // уклонение от помех важнее тарана и поездки за коробкой
    const dodge = combat.dodgeLane(r, now);
    r.dodging = dodge != null;                       // при объезде чуть сбрасывает газ, а не прибавляет, как на таран
    r.ram = dodge ?? (r.bot.weapon ? combat.ramLane(r, list) : boxLane(r));
  }
  combat.update(now, dt, list, (who, dmg, by, kind) => damage(who, dmg, by, t, kind));
}

// Подтягивание: кто отстал от робота прямо впереди больше чем на экран (C.catchUp.gap) дольше delay —
// переносится на C.catchUp.to позади него. Не трогаем лидера, тех, кто в пит-лейне, «мёртвых» и выбывших.
function catchUp(t) {
  const now = t / 1000, Cc = C.catchUp, step = C.sampleStep, n = track.n;
  const field = rivals.filter(r => !r.out).map(r => ({ b: r.bot, r }));
  if (mode === 'race') field.push({ b: bot, r: null });
  const prog = e => e.r ? e.r.progress() : race.crossings * n + bot.seg;
  field.sort((a, b) => prog(b) - prog(a));
  for (let i = 1; i < field.length; i++) {
    const e = field[i], ahead = field[i - 1], b = e.b;
    const gap = (prog(ahead) - prog(e)) * step;
    const busy = b.inLane || b.dead || b.stunUntil > now || (e.r && e.r.pitting) || ahead.b.inLane;
    if (gap < Cc.gap || busy) { b.behindSince = 0; continue; }
    if (!b.behindSince) { b.behindSince = now; continue; }
    if (now - b.behindSince < Cc.delay) continue;
    // переносим: на трассу за роботом впереди, носом по ходу, с приличной скоростью
    const target = prog(ahead) - Math.round(Cc.to / step), seg = track.at(target), cross = Math.floor(target / n);
    combat.poof(b.x, b.z);
    const lat = Math.max(-track.half + 2, Math.min(track.half - 2, track.lateral(b.seg, b.x, b.z)));
    const [x, , z] = track.edge(seg, lat);
    b.x = x; b.z = z; b.seg = seg; b.a = Math.atan2(track.t[seg].z, track.t[seg].x); b.lat = 0;
    b.v = Math.max(b.v, b.s.maxSpeed * 0.6); b.behindSince = 0;
    combat.poof(x, z);
    if (e.r) { e.r.race.crossings = cross; e.r.race.lastSeg = seg; }
    else {
      const crossed = cross - race.crossings;
      if (crossed > 0 && race.started) { race.lap += crossed; race.lapStart = t; }   // перескочил старт — круг засчитан, время круга заново
      race.crossings = cross; race.lastSeg = seg;
      hud.say(P.catchUp, 1600);
    }
  }
}

// Какое оружие выдать из коробки: отстающим чаще атакующее, лидеру — защитное.
// rank: 0 — лидер, 1 — последний; вес атакующего растёт к хвосту, защитного — к голове.
function chooseWeapon(who) {
  const prog = b => b === bot ? race.crossings * track.n + bot.seg : b.rival.progress();
  const field = [bot, ...rivals.filter(r => !r.out).map(r => r.bot)].filter(b => mode === 'race' || b !== bot);
  const me = prog(who), ahead = field.filter(b => b !== who && prog(b) > me).length;
  const rank = field.length > 1 ? ahead / (field.length - 1) : 0.5;
  const { attack, defend, bias } = C.weapons.catchUp;
  const wa = 1 + (bias - 1) * rank, wd = 1 + (bias - 1) * (1 - rank);
  const pool = [...attack.map(w => [w, wa]), ...defend.map(w => [w, wd])];
  let x = Math.random() * pool.reduce((s, [, k]) => s + k, 0);
  for (const [w, k] of pool) { x -= k; if (x <= 0) return w; }
  return pool[0][0];
}

// Смещение к ближайшей целой коробке впереди (или null)
function boxLane(r) {
  const b = r.bot, fx = Math.cos(b.a), fz = Math.sin(b.a);
  if (b.inLane || r.pitting) return null;
  let best = null, bd = C.rivals.aggro.boxRange;
  for (const it of pickups.items) {
    if (!it.alive) continue;
    const dx = it.x - b.x, dz = it.z - b.z, d = Math.hypot(dx, dz);
    if (d < bd && (dx * fx + dz * fz) / d > 0.7) { bd = d; best = it; }
  }
  return best ? track.lateral(b.seg, best.x, best.z) : null;
}

// Урон от оружия или удара: игроку — с репликами и полоской ХП, соперникам — через их hurt().
// Если соперника подбил игрок — награда жетонами.
function damage(who, dmg, by, t, kind) {
  // урон оружия: часть — в процентах от максимального ХП (для эталона с 100 ХП ничего не меняется),
  // так что живучим тяжёлым тоже ощутимо, а хрупким лёгким — чуть легче
  if (kind === 'trash' || kind === 'cap' || kind === 'rocket') {
    const f = C.weapons.hpScale;
    dmg *= 1 - f + f * who.s.hp / 100;
  }
  if (who.rival) {
    if (dmg <= 0) return;
    const wasOut = who.rival.out;
    who.rival.hurt(dmg);
    if (!wasOut && who.rival.out && by === bot) {
      race.tokens += C.weapons.killReward; race.earned += C.weapons.killReward; race.kills = (race.kills || 0) + 1;
      hud.say(P.kill, 1800);
    }
    return;
  }
  if (mode !== 'race') return;
  if (kind === 'soap') { hud.say(P.slip, 1400); return; }
  if (kind === 'banana') { hud.say(P.banana, 1400); return; }
  if (kind === 'rocket') hud.say(P.rocket, 1600);
  who.hp = Math.max(0, who.hp - dmg);
  if (dmg > 3) who.dent(dmg);
  who.scratch(); hud.hurt();
  if (who.hp <= 0) explode(t);
  else if (t - st.lastWallSay > 2000) { st.lastWallSay = t; hud.say(kind === 'trash' ? P.shot : kind === 'cap' ? P.cap : P.bump, 1400); }
}

// Роботы толкаются; урон игроку — с репликами и полоской ХП, соперникам — через их hurt()
function bumps(t) {
  const list = rivals.filter(r => !r.out).map(r => r.bot);
  if (mode === 'race') list.push(bot);
  collideRobots(list, (who, dmg, nx, nz, other) => {
    who.hitN = [nx, nz];
    if (combat.absorb(who, t / 1000)) return;        // губка-щит приняла удар
    damage(who, dmg, other, t, 'bump');
  }, t / 1000);
}

let last = 0;
function loop(t) {
  const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
  if (mode === 'race') {
    update(t, dt);
    updateRivals(t, dt);
    if (mode === 'race') bumps(t);
    if (mode === 'race') catchUp(t);
    if (mode === 'race') bot.render(dt, t);
    skids.update(bot);
    smoke.update(dt, bot);
    world.follow(bot, dt);
    hud.drawMap(bot, rivals);
    hud.placeSay(bot, world.camera);
  } else if (mode === 'out') {
    // робот взорвался: камера стоит на месте взрыва и трясётся
    boom.update(dt);
    smoke.update(dt, null);   // старый дым досыпает, новый не идёт
    trash.update(t / 1000, dt, rivals.filter(r => !r.out).map(r => r.bot));
    updateRivals(t, dt);                            // соперники продолжают гонку
    bumps(t);
    world.follow(bot, dt);
    const k = boom.shake() * 1.2;
    world.camera.position.x += (Math.random() - 0.5) * k; world.camera.position.y += (Math.random() - 0.5) * k;
    hud.drawMap(bot, rivals);
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
