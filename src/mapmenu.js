import { MAPS } from './maps.js';
import { settings, saveSettings, DIFFICULTY, RIVALS_RANGE, MODES, LAPS, CLEAN_TIME, WEATHER, weatherFor } from './settings.js';

// Первый экран: выбор трассы и настройки гонки (режим, круги/время, сложность, соперники).
// «Дальше» ведёт к выбору робота. Карта загружается сразу при выборе — фон за меню меняется на неё.
const IDS = Object.keys(MAPS);

// Схема трассы по её опорным точкам (сглаженная, как в игре), линия старта — белая черта
function drawTrack(cv, points, active) {
  const x = cv.getContext('2d'), W = cv.width, H = cv.height, pad = W * 0.09;
  const xs = points.map(p => p[0]), zs = points.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const s = Math.min((W - pad * 2) / (maxX - minX), (H - pad * 2) / (maxZ - minZ));
  const ox = (W - (maxX - minX) * s) / 2, oz = (H - (maxZ - minZ) * s) / 2;
  const P = ([px, pz]) => [ox + (px - minX) * s, oz + (pz - minZ) * s];
  // Catmull-Rom по замкнутому контуру
  const n = points.length, path = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n], p1 = points[i], p2 = points[(i + 1) % n], p3 = points[(i + 2) % n];
    for (let t = 0; t < 1; t += 0.1) {
      const t2 = t * t, t3 = t2 * t, f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      path.push(P([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]));
    }
  }
  x.clearRect(0, 0, W, H);
  x.lineJoin = x.lineCap = 'round';
  const stroke = (w, c) => { x.lineWidth = w; x.strokeStyle = c; x.beginPath(); path.forEach(([a, b], i) => i ? x.lineTo(a, b) : x.moveTo(a, b)); x.closePath(); x.stroke(); };
  stroke(W * 0.06, active ? 'rgba(255,138,92,.9)' : 'rgba(255,255,255,.35)');
  stroke(W * 0.035, '#2b2230');
  stroke(W * 0.006, 'rgba(255,255,255,.35)');
  const [sx, sz] = path[0], [nx, nz] = path[2], a = Math.atan2(nz - sz, nx - sx);
  x.save(); x.translate(sx, sz); x.rotate(a); x.fillStyle = '#fff'; x.fillRect(-W * 0.006, -W * 0.03, W * 0.012, W * 0.06); x.restore();
}

export class MapMenu {
  // onSelect(id) — выбрана карта (загрузить её), onNext() — к выбору робота
  constructor(onSelect, onNext) {
    this.onSelect = onSelect; this.onNext = onNext;
    this.el = document.getElementById('maps');
    this.el.innerHTML = `
      <div class="m-panel">
        <h1>Выбери трассу</h1>
        <div class="mp-grid" id="mp-grid"></div>
        <div class="m-keys">←/→ — трасса · Enter — дальше · 1/2/3 — сложность · −/+ — соперники</div>
      </div>
      <div class="m-card">
        <div class="m-name"><b id="mp-name"></b><span id="mp-len"></span></div>
        <div class="mp-desc" id="mp-desc"></div>
        <div class="m-set">
          <div class="m-row"><span>Режим</span><div class="m-seg" id="m-mode"></div></div>
          <div class="m-row" id="m-laps-row"><span>Круги</span><div class="m-seg" id="m-laps"></div></div>
          <div class="m-row" id="m-time-row"><span>Время</span><div class="m-seg" id="m-time"></div></div>
          <div class="m-hint" id="m-mode-hint"></div>
          <div class="m-row"><span>Погода</span><div class="m-seg" id="m-weather"></div></div>
          <div class="m-row"><span>Сложность</span><div class="m-seg" id="m-diff"></div></div>
          <div class="m-row"><span>Соперники</span><div class="m-step"><button id="m-rminus">−</button><b id="m-rcount"></b><button id="m-rplus">+</button></div></div>
        </div>
        <div class="m-btns"><button id="mp-go" class="go">Дальше: выбор робота →</button></div>
      </div>`;
    this.grid = this.el.querySelector('#mp-grid');
    this.grid.innerHTML = IDS.map(id => `<button class="mp-cell" data-id="${id}"><canvas width="200" height="140"></canvas><span>${MAPS[id].name}</span></button>`).join('');
    this.grid.onclick = e => { const b = e.target.closest('.mp-cell'); if (b) this.select(b.dataset.id); };
    this.grid.ondblclick = e => { if (e.target.closest('.mp-cell')) this.onNext(); };
    this.el.querySelector('#mp-go').onclick = () => this.onNext();
    addEventListener('keydown', e => this.onKey(e));
    this.buildSettings();
  }

  select(id) {
    if (!MAPS[id]) id = IDS[0];
    settings.map = id; saveSettings();
    const M = MAPS[id];
    // погода — только та, что бывает на этой карте (дождь — на улице)
    this.segOf('#m-weather', (M.weathers || ['day']).map(w => [w, WEATHER[w]]), 'weather');
    this.refreshSettings();
    this.onSelect(id);
    // превью в карточке: снимок загруженной карты сверху, пока снимка нет — схема трассы
    this.shots ||= {};
    if (this.snapshot) this.shots[id] = this.snapshot();
    const paint = (cv, mid) => {
      const sh = this.shots[mid];
      if (sh) cv.getContext('2d').drawImage(sh, 0, 0, cv.width, cv.height); else drawTrack(cv, MAPS[mid].points, mid === id);
    };
    [...this.grid.children].forEach(b => { b.classList.toggle('on', b.dataset.id === id); paint(b.querySelector('canvas'), b.dataset.id); });
    this.el.querySelector('#mp-name').textContent = M.name;
    this.el.querySelector('#mp-desc').textContent = M.desc;
    // длина круга — у загруженной трассы (в «метрах»: 1 ед ≈ 2.5 см, как в описании скоростей)
    this.el.querySelector('#mp-len').textContent = this.lengthOf ? `Круг ${Math.round(this.lengthOf())} ед` : '';
  }

  // Настройки гонки: режим, круги/время, сложность (3 кнопки) и число соперников (−/+); сохраняются сразу
  buildSettings() {
    const segOf = (id, items, key) => {
      const el = this.el.querySelector(id);
      el.innerHTML = items.map(([v, label]) => `<button data-v="${v}">${label}</button>`).join('');
      el.onclick = e => { const v = e.target.dataset.v; if (v == null) return; settings[key] = isNaN(+v) ? v : +v; saveSettings(); this.refreshSettings(); if (key === 'weather') { this.onWeather?.(); this.select(settings.map); } };
    };
    segOf('#m-mode', Object.entries(MODES).map(([k, m]) => [k, m.name]), 'mode');
    segOf('#m-laps', LAPS.map(n => [n, n ? n : '∞']), 'laps');
    segOf('#m-time', CLEAN_TIME.map(s => [s, s / 60 + ' мин']), 'cleanTime');
    this.segOf = segOf;
    segOf('#m-diff', Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), 'difficulty');
    this.el.querySelector('#m-rminus').onclick = () => this.setRivals(settings.rivals - 1);
    this.el.querySelector('#m-rplus').onclick = () => this.setRivals(settings.rivals + 1);
    this.refreshSettings();
  }

  setRivals(n) { settings.rivals = Math.max(RIVALS_RANGE[0], Math.min(RIVALS_RANGE[1], n)); saveSettings(); this.refreshSettings(); }

  refreshSettings() {
    for (const [id, key] of [['#m-mode', 'mode'], ['#m-laps', 'laps'], ['#m-time', 'cleanTime'], ['#m-weather', 'weather'], ['#m-diff', 'difficulty']])
      [...this.el.querySelectorAll(id + ' button')].forEach(b => b.classList.toggle('on', String(key === 'weather' ? weatherFor(MAPS[settings.map]) : settings[key]) === b.dataset.v));
    this.el.querySelector('#m-laps-row').style.display = settings.mode === 'race' ? '' : 'none';
    this.el.querySelector('#m-time-row').style.display = settings.mode === 'clean' ? '' : 'none';
    this.el.querySelector('#m-mode-hint').textContent = MODES[settings.mode].hint;
    this.el.querySelector('#m-rcount').textContent = settings.rivals === 0 ? 'нет' : settings.rivals;
  }

  onKey(e) {
    if (!this.open) return;
    const c = e.code, i = IDS.indexOf(settings.map);
    if (c === 'Enter' || c === 'Space') { e.preventDefault(); this.onNext(); }
    else if (c === 'ArrowLeft' || c === 'KeyA' || c === 'ArrowUp' || c === 'KeyW') this.select(IDS[(i - 1 + IDS.length) % IDS.length]);
    else if (c === 'ArrowRight' || c === 'KeyD' || c === 'ArrowDown' || c === 'KeyS') this.select(IDS[(i + 1) % IDS.length]);
    else if (c === 'Digit1' || c === 'Digit2' || c === 'Digit3') { settings.difficulty = Object.keys(DIFFICULTY)[+c.slice(-1) - 1]; saveSettings(); this.refreshSettings(); }
    else if (c === 'Minus' || c === 'NumpadSubtract') this.setRivals(settings.rivals - 1);
    else if (c === 'Equal' || c === 'NumpadAdd') this.setRivals(settings.rivals + 1);
  }

  // Снимки всех карт для карточек: по очереди загружаем каждую и фотографируем (один раз, при первом показе)
  prefetch() {
    if (this.prefetched || !this.snapshot) return;
    this.prefetched = true; this.shots ||= {};
    for (const id of IDS) if (id !== settings.map) { this.onSelect(id); this.shots[id] = this.snapshot(); }
  }

  show() {
    this.prefetch();
    this.open = true;
    document.body.classList.add('in-menu', 'in-maps');
    this.select(settings.map);
  }

  hide() { this.open = false; document.body.classList.remove('in-maps'); }
}
