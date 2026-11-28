import { ROBOTS } from './robots.js';
import { MAPS } from './maps.js';
import { settings } from './settings.js';

/* Симуляция для балансировки: index.html?sim=200
   Прогоняет N гонок только из ботов (соперников на автопилоте), без отрисовки и в виртуальном времени:
   шаг dt не ждёт кадров экрана, так что гонка в 3 круга считается за доли секунды.
   Параметры адреса (все необязательные):
     sim=N        — сколько гонок (по умолчанию 100)
     map=kitchen  — карта: kitchen | kids | garden | all (all — по кругу все карты); по умолчанию — из настроек
     field=5      — сколько роботов в гонке (как в игре: игрок + 4 соперника); 12 — все сразу
     laps=3       — кругов в гонке
     mode=race    — race (гонка) или arena (до последнего уцелевшего)
     diff=medium  — сложность ботов (их разброс скорости): easy | medium | hard
     seed=1       — зерно случайности: один и тот же seed даёт те же гонки (удобно сравнивать правки)
     dt=0.0167    — шаг физики, с
     out=name     — сохранить в sim/name.json вместо sim/results.json (для параллельных прогонов)
   Итог: таблица на экране, console.table, window.__sim и файл sim/results.json (его пишет serve.ps1). */

const q = new URLSearchParams(location.search);

// Повторяемая случайность: подменяем Math.random генератором mulberry32
function seedRandom(seed) {
  let a = seed >>> 0;
  Math.random = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Честное перемешивание (sort со случайным сравнением даёт перекос — одни типы попадали в гонки в 6 раз чаще)
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const MAX_RACE_S = 600;   // гонка дольше 10 виртуальных минут — считаем зависшей и обрываем

export function runSim({ n, loadMap, setSimTime, startSimRace, simStep, simDone }) {
  const field = Math.max(2, Math.min(Object.keys(ROBOTS).length, +q.get('field') || 5));
  const dt = +q.get('dt') || 1 / 60;
  const seed = +q.get('seed') || 1;
  const mapArg = q.get('map') || settings.map;
  const maps = mapArg === 'all' ? Object.keys(MAPS) : [MAPS[mapArg] ? mapArg : 'kitchen'];
  if (q.get('laps')) settings.laps = +q.get('laps');
  if (q.get('mode')) settings.mode = q.get('mode');
  if (q.get('diff')) settings.difficulty = q.get('diff');
  settings.laps = settings.laps || 3;
  seedRandom(seed);

  // экран вместо игры
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:999;background:#15171c;color:#e8e8ee;font:14px/1.4 system-ui,sans-serif;padding:24px;overflow:auto';
  box.innerHTML = '<h2 style="margin:0 0 8px">Симуляция баланса</h2><div id="sim-st"></div><div id="sim-tab"></div>';
  document.body.appendChild(box);
  const status = box.querySelector('#sim-st');

  const ids = Object.keys(ROBOTS);
  const stat = Object.fromEntries(ids.map(id => [id, { starts: 0, wins: 0, places: 0, podiums: 0, outs: 0, finishes: 0, finishTime: 0, perMap: {} }]));
  const races = [];
  let k = 0, curMap = null, timeouts = 0;
  const realT0 = Date.now();

  function oneRace() {
    const map = maps[Math.floor(k * maps.length / n)];   // блоками: сборка карты дорогая, не меняем её каждую гонку
    if (map !== curMap) { loadMap(map); curMap = map; }
    // кто едет: случайная выборка из всех типов; сетка — в случайном порядке
    const pick = shuffle([...ids]).slice(0, field);
    let t = 1000;
    setSimTime(t);
    const rivals = startSimRace(pick);
    const t0 = t;
    while (!simDone() && t - t0 < MAX_RACE_S * 1000) {
      t += dt * 1000; setSimTime(t);
      simStep(t, dt);
    }
    const timedOut = !simDone();
    if (timedOut) timeouts++;
    // места: финишировавшие по времени, потом едущие по пройденному, потом выбывшие (кто позже выбыл — выше)
    const key = r => r.finishedAt ? 1e15 - r.finishedAt : r.out ? -1e15 + (r.outAt || 0) : r.progress();
    const order = [...rivals].sort((a, b) => key(b) - key(a));
    order.forEach((r, i) => {
      const s = stat[r.simId], m = s.perMap[map] || (s.perMap[map] = { starts: 0, wins: 0 });
      s.starts++; m.starts++; s.places += i + 1;
      if (i === 0) { s.wins++; m.wins++; }
      if (i < 3) s.podiums++;
      if (r.out) s.outs++;
      if (r.finishedAt) { s.finishes++; s.finishTime += (r.finishedAt - t0) / 1000; }
    });
    races.push({ map, order: order.map(r => r.simId), out: order.filter(r => r.out).map(r => r.simId), seconds: +((t - t0) / 1000).toFixed(1), timedOut });
    k++;
  }

  function chunk() {
    const until = Date.now() + 250;   // считаем порциями, чтобы страница не «висла» и было видно ход
    while (k < n && Date.now() < until) oneRace();
    status.textContent = `Гонок: ${k} / ${n} · карта: ${maps.join(', ')} · в гонке ${field} · ${settings.mode === 'arena' ? 'арена' : settings.laps + ' кр.'} · ${((Date.now() - realT0) / 1000).toFixed(0)} с`;
    if (k < n) next(); else report();
  }

  function report() {
    const fair = 1 / field;
    const rows = ids.map(id => {
      const s = stat[id], R = ROBOTS[id];
      return {
        id, name: R.name, mass: R.mass, hp: R.hp, accelTime: R.accelTime, maxSpeed: +R.maxSpeed.toFixed(2),
        starts: s.starts, wins: s.wins,
        winRate: s.starts ? +(s.wins / s.starts).toFixed(3) : 0,
        winVsFair: s.starts ? +(s.wins / s.starts / fair).toFixed(2) : 0,   // 1.0 — ровно «честная» доля побед
        avgPlace: s.starts ? +(s.places / s.starts).toFixed(2) : 0,
        podiumRate: s.starts ? +(s.podiums / s.starts).toFixed(3) : 0,
        outRate: s.starts ? +(s.outs / s.starts).toFixed(3) : 0,
        avgFinishS: s.finishes ? +(s.finishTime / s.finishes).toFixed(1) : null,
        perMap: Object.fromEntries(Object.entries(s.perMap).map(([m, v]) => [m, +(v.wins / v.starts).toFixed(3)])),
      };
    }).sort((a, b) => b.winRate - a.winRate);
    const result = {
      when: new Date().toISOString(), params: { races: n, maps, field, laps: settings.laps, mode: settings.mode, difficulty: settings.difficulty, seed, dt },
      fairWinRate: +fair.toFixed(3), timeouts, realSeconds: (Date.now() - realT0) / 1000, robots: rows, races,
    };
    window.__sim = result;
    console.table(rows.map(({ perMap, ...r }) => r));
    // таблица на экране; цвет — насколько доля побед отличается от честной
    const col = v => v >= 1.5 ? '#ff6b6b' : v >= 1.2 ? '#ffb86b' : v <= 0.5 ? '#6bb6ff' : v <= 0.8 ? '#9fd0ff' : '#e8e8ee';
    const th = 'style="text-align:right;padding:4px 10px;border-bottom:1px solid #333"', td = 'style="text-align:right;padding:3px 10px"';
    box.querySelector('#sim-tab').innerHTML = `<p>Честная доля побед: ${(fair * 100).toFixed(0)}% · зависших гонок: ${timeouts}</p>
      <table style="border-collapse:collapse"><tr>${['Робот', 'масса', 'ХП', 'стартов', 'побед', '% побед', '× честной', 'ср. место', 'подиум', 'выбыл', 'ср. время'].map(h => `<th ${th}>${h}</th>`).join('')}</tr>
      ${rows.map(r => `<tr style="color:${col(r.winVsFair)}"><td style="padding:3px 10px">${r.name}</td><td ${td}>${r.mass}</td><td ${td}>${r.hp}</td><td ${td}>${r.starts}</td><td ${td}>${r.wins}</td>
        <td ${td}>${(r.winRate * 100).toFixed(1)}%</td><td ${td}>${r.winVsFair}</td><td ${td}>${r.avgPlace}</td><td ${td}>${(r.podiumRate * 100).toFixed(0)}%</td>
        <td ${td}>${(r.outRate * 100).toFixed(0)}%</td><td ${td}>${r.avgFinishS ?? '—'}</td></tr>`).join('')}</table>
      <p id="sim-save" style="opacity:.7">Сохраняю sim/results.json…</p>`;
    fetch('/sim-results' + (q.get('out') ? '?out=' + encodeURIComponent(q.get('out')) : ''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result, null, 2) })
      .then(r => { box.querySelector('#sim-save').textContent = r.ok ? 'Сохранено: sim/results.json' : 'Не сохранилось (запущен не serve.ps1?) — результат в window.__sim'; })
      .catch(() => { box.querySelector('#sim-save').textContent = 'Не сохранилось — результат в window.__sim'; });
    document.title = 'SIM DONE';
  }

  // следующая порция — через MessageChannel: setTimeout в фоновой вкладке браузер замедляет до раза в секунду
  const ch = new MessageChannel(); ch.port1.onmessage = chunk;
  const next = () => ch.port2.postMessage(0);
  next();
}
