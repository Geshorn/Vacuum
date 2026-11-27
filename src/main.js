import { isPaused, pauseClock, resumeClock } from './clock.js';   // первым: подменяет performance.now
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
import { settings, painted } from './settings.js';

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
  bot = new Robot(world.scene, painted(ROBOTS[id]));   // с выбранной в меню окраской
  // Стартовая решётка: все в колонну по центру трассы за линией старта, игрок — третьим.
  // Шаг 3 сегмента ≈ 5.2 ед: даже два самых больших (Сейф, R ≈ 2) стоят не касаясь
  const slot = k => [-4 - k * 3, 0];
  const [ps, pl] = slot(2), s0 = track.at(ps), [px, , pz] = track.edge(s0, pl);
  bot.x = px; bot.z = pz; bot.a = Math.atan2(track.t[s0].z, track.t[s0].x); bot.seg = s0;
  race = { lap: 0, lapStart: 0, best: 0, started: false, lastSeg: s0, tokens: 0, earned: 0, collected: 0, crossings: 0,
    // режим игры из меню: гонка на laps кругов (0 — без конца), арена или уборка на время
    mode: settings.mode, laps: settings.laps, cleanTime: settings.cleanTime, t0: performance.now(), score: 0, finishedAt: 0 };
  hud.hideResults();
  for (const r of rivals) r.dispose();
  const pool = Object.keys(ROBOTS).filter(k => k !== id).sort(() => Math.random() - 0.5);
  rivals = pool.slice(0, settings.rivals).map((rid, k) => {
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
  resetHud();
  stopCountdown(); hud.pause(false); runCountdown('Вперёд!');   // старт — после отсчёта
  hud.showHint();
  setTimeout(() => hud.say(P.start, 2200), 600);
  clearTimeout(startRace.hintT); startRace.hintT = setTimeout(() => hud.hideHint(), 9000);
}

const menu = new Menu(startRace);
menu.show(PLAYER_ROBOT);
function toMenu() { clearBoom(); hud.hideOut(); hud.hideResults(); mode = 'menu'; menu.show(bot.spec.id); }
// ── Пауза: Esc в гонке или окно ушло в фон. На паузе M — в меню ──
// Продолжение — не сразу, а после отсчёта 3-2-1 (часы всё это время стоят)
let countdown = null;
const COUNT_STEP = 600;   // мс на каждую цифру отсчёта (в css — анимация #count той же длины)
function setPause(on) {
  if (on) {
    if (mode !== 'race') return;   // только в гонке: на экране «Выбыл», итогах и в меню пауза не нужна
    stopCountdown();
    if (!isPaused()) pauseClock();
    hud.pause(true);
    return;
  }
  if (!isPaused() || countdown) return;
  hud.pause(false);
  runCountdown();
}
// Отсчёт 3-2-1 при замершей игре; после него игра идёт. go — надпись после «1» (на старте гонки)
function runCountdown(go) {
  if (!isPaused()) pauseClock();
  let n = 3; hud.countdown(n);
  countdown = setInterval(() => {
    if (--n > 0) { hud.countdown(n); return; }
    stopCountdown(); resumeClock(); input.keys = {};
    if (go) hud.countdown(go);
  }, COUNT_STEP);
}
function stopCountdown() { clearInterval(countdown); countdown = null; hud.countdown(0); }
function quitPause() { stopCountdown(); resumeClock(); hud.pause(false); toMenu(); }
addEventListener('blur', () => setPause(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) setPause(true); });
hud.onPause(() => setPause(false), quitPause);

addEventListener('keydown', e => {
  // Esc — пауза и обратно (во время отсчёта — снова пауза); вне гонки Esc работает как раньше
  const toggle = e.code === 'Escape' && (mode === 'race' || isPaused());
  if (toggle) { e.preventDefault(); setPause(!isPaused() || !!countdown); return; }
  if (isPaused()) {
    if (e.code === 'KeyM') quitPause();
    else if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); setPause(false); }
    return;
  }
  if (mode === 'done') {                            // экран итогов
    if (e.code === 'Escape') toMenu();
    else if (e.code === 'Enter' && performance.now() - race.doneAt > 800) startRace(bot.spec.id);
    return;
  }
  if (e.code === 'Space' && mode === 'race') {      // применить оружие
    e.preventDefault();
    const w = bot.weapon;
    if (!w) return;
    if (combat.fire(bot, performance.now() / 1000)) { hud.weapon(null); hud.say(P['fire_' + w], 1200); }
    else hud.say(P.binEmpty, 1600);
  }
  if (e.code === 'Escape' && mode === 'out') toMenu();
  else if (e.code === 'Enter' && mode === 'out' && boom?.t > 1) startRace(bot.spec.id);
});
combat.onRocket = tg => { if (tg && tg === bot) hud.say(P.rocketWarn, 1800); };
hud.onOut(() => startRace(bot.spec.id), toMenu);
hud.onResults(() => startRace(bot.spec.id), toMenu);

// ── Режимы игры: финиш, конец арены и уборки, итоговая таблица ──────────────────
const fmt = ms => { const s = ms / 1000; return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };

// Проверка конца игры по режиму; вызывается каждый кадр гонки
function checkEnd(t) {
  const R = race, alive = rivals.filter(r => !r.out);
  if (R.mode === 'race' && R.laps) {
    for (const r of rivals) if (!r.finishedAt && !r.out && r.race.crossings >= R.laps + 1) r.finishedAt = t;
    if (R.lap >= R.laps) { R.finishedAt = t; finish(t, 'Финиш!'); }
  } else if (R.mode === 'arena') {
    if (rivals.length && !alive.length) finish(t, 'Победа!');
  } else if (R.mode === 'clean') {
    if (t - R.t0 >= R.cleanTime * 1000) finish(t, 'Время вышло!');
  }
}

// Таблица мест: строки { name, me, info, out }
function standings(t) {
  const R = race, me = { name: bot.spec.name, me: true, out: false, bot };
  const all = [me, ...rivals.map(r => ({ name: r.bot.spec.name, me: false, out: r.out, r, bot: r.bot }))];
  const prog = e => e.me ? R.crossings * track.n + bot.seg : e.r.progress();
  const lapOf = e => Math.max(0, (e.me ? R.crossings : e.r.race.crossings) - 1);
  if (R.mode === 'clean') {
    all.forEach(e => { e.key = e.me ? R.score : e.r.score || 0; e.info = Math.round(e.key) + ' ♻️'; });
    all.sort((a, b) => b.key - a.key);
  } else if (R.mode === 'arena') {
    all.forEach(e => { e.key = e.out ? (e.r ? e.r.outAt : 0) : Infinity; e.info = e.out ? 'выбыл' : 'уцелел'; });
    all.sort((a, b) => b.key - a.key);
  } else {
    all.forEach(e => {
      const fin = e.me ? R.finishedAt : e.r.finishedAt;
      e.key = fin ? 1e12 - fin : e.out ? -1e12 + (e.r.outAt || 0) : prog(e);
      e.info = fin ? fmt(fin - R.t0) : e.out ? 'выбыл' : R.laps ? `круг ${Math.min(lapOf(e) + 1, R.laps)}/${R.laps}` : `круг ${lapOf(e) + 1}`;
    });
    all.sort((a, b) => b.key - a.key);
  }
  return all;
}

function finish(t, title) {
  if (mode !== 'race') return;
  mode = 'done'; race.doneAt = performance.now();
  input.keys = {}; input.lastKeyTime = 0;           // дальше робот едет сам на автопилоте
  const rows = standings(t), mine = rows.findIndex(e => e.me) + 1;
  const sub = race.mode === 'clean' ? `Ты собрал ${Math.round(race.score)} ♻️ — ${mine}-е место из ${rows.length}`
    : race.mode === 'arena' ? 'Все соперники выбыли — ты последний уцелевший!'
    : `Ты ${mine}-й из ${rows.length}`;
  hud.showResults({ title: mine === 1 ? (race.mode === 'race' ? 'Победа!' : title) : title, sub, rows });
  hud.say(mine === 1 ? P.win : P.finish, 2500);
}

// ХП кончились: робот взрывается и выбывает из гонки
let boom = null;
function clearBoom() { if (boom) { boom.dispose(); boom = null; } clearTimeout(explode.outT); }
function explode(t) {
  if (mode !== 'race') { bot.hp = Math.max(bot.hp, 1); return; }   // после финиша робота уже не взрываем
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
  const manual = mode === 'race' && !bot.dead && input.lastKeyTime > 0 && t - input.lastKeyTime < C.manualTimeoutMs;
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
  // главный счётчик в панели — по режиму
  if (race.mode === 'race') hud.lapInfo('Круг', race.laps ? `${Math.min(race.lap + 1, race.laps)}/${race.laps}` : race.lap + 1);
  else if (race.mode === 'arena') hud.lapInfo('Соперников', rivals.filter(r => !r.out).length);
  else hud.lapInfo('Осталось', fmt(Math.max(0, race.cleanTime * 1000 - (t - race.t0))).replace(/\.\d$/, ''));

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
      who.rival.score = (who.rival.score || 0) + K.value;   // очки «Уборки»
      if (K.damage) who.rival.hurt(K.damage);
      continue;
    }
    bot.bin = Math.min(100, bot.bin + K.fill); bot.binValue += K.value; race.collected++; race.score += K.value;
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

// Верхняя панель и спидометр для новой гонки — сразу, ещё во время стартового отсчёта
// (иначе до первого кадра гонки висят цифры прошлой)
function resetHud() {
  hud.race(0, 0, 0);
  if (race.mode === 'race') hud.lapInfo('Круг', race.laps ? `1/${race.laps}` : 1);
  else if (race.mode === 'arena') hud.lapInfo('Соперников', rivals.length);
  else hud.lapInfo('Осталось', fmt(race.cleanTime * 1000).replace(/\.\d$/, ''));
  hud.speed(0); hud.battery(bot.bat, false); hud.health(bot.hp, bot.s.hp, false);
  hud.bin(bot.bin, false); hud.tokens(race.tokens); hud.place(...placeOf());
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

// Подтягивание: только последний в гонке, если отстал от предпоследнего больше чем на экран (C.catchUp.gap)
// дольше delay, переносится на C.catchUp.to позади предпоследнего. Не в пит-лейне, не «мёртвым» и не выбывшим.
function catchUp(t) {
  const now = t / 1000, Cc = C.catchUp, step = C.sampleStep, n = track.n;
  const field = rivals.filter(r => !r.out).map(r => ({ b: r.bot, r }));
  if (mode === 'race') field.push({ b: bot, r: null });
  const prog = e => e.r ? e.r.progress() : race.crossings * n + bot.seg;
  field.sort((a, b) => prog(b) - prog(a));
  // переносим только последнего — к предпоследнему; у остальных счётчик отставания сбрасываем
  for (let i = 0; i < field.length - 1; i++) field[i].b.behindSince = 0;
  for (let i = field.length - 1; i >= 1 && i === field.length - 1; i--) {
    const e = field[i], ahead = field[i - 1], b = e.b;
    const gap = (prog(ahead) - prog(e)) * step;
    // нужен пит-стоп и съезд в пит-лейн уже близко (≤ 2 экранов) — не переносим, иначе проскочит зарядку
    const needPit = b.bat < Cc.lowBat || (e.r ? e.r.pitting : st.pitting);
    const toPit = ((track.pitStart - b.seg + n) % n) * step;
    const busy = b.inLane || b.dead || b.stunUntil > now || ahead.b.inLane || (needPit && toPit < Cc.pitNear);
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
  if (mode === 'race' || mode === 'done') list.push(bot);
  collideRobots(list, (who, dmg, nx, nz, other) => {
    who.hitN = [nx, nz];
    if (combat.absorb(who, t / 1000)) return;        // губка-щит приняла удар
    damage(who, dmg, other, t, 'bump');
  }, t / 1000);
}

let last = 0;
function loop() {
  const t = performance.now();   // игровое время (стоит на паузе), см. clock.js
  if (isPaused()) {
    // игра стоит, но модели ставим на их места — иначе на старте (до первого кадра гонки) роботов не видно
    if (mode === 'race') { bot.render(0, t); for (const r of rivals) if (!r.out) r.bot.render(0, t); }
    world.render(); requestAnimationFrame(loop); return;
  }
  const dt = Math.min((t - last) / 1000 || 0, 0.05); last = t;
  if (mode === 'race' || mode === 'done') {          // done — экран итогов, а гонка вокруг продолжается
    update(t, dt);
    updateRivals(t, dt);
    if (mode === 'race' || mode === 'done') bumps(t);
    if (mode === 'race') catchUp(t);
    if (mode === 'race') checkEnd(t);
    if (mode === 'race' || mode === 'done') bot.render(dt, t);
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
