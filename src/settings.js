// Настройки гонки из меню. Сохраняются в браузере (localStorage) и читаются при старте каждой гонки.

// Уровни сложности: скорость соперников (доля от максимума их типа, разброс между ними),
// меткость (множитель доводки их снарядов), как часто замечают помехи и как быстро реагируют оружием
export const DIFFICULTY = {
  easy:   { name: 'Лёгкая',  speed: [0.77, 0.83], aim: 0.5,  notice: 0.45, react: 1.0 },
  medium: { name: 'Средняя', speed: [0.89, 0.95], aim: 1,    notice: 0.75, react: 0.4 },
  hard:   { name: 'Сложная', speed: [0.97, 1.0],  aim: 1.35, notice: 0.95, react: 0.15 },
};

export const RIVALS_RANGE = [0, 7];   // сколько соперников можно выбрать

// Режимы игры
export const MODES = {
  race:  { name: 'Гонка', hint: 'Кто первым проедет все круги' },
  arena: { name: 'Арена', hint: 'Побеждает последний уцелевший' },
  clean: { name: 'Уборка', hint: 'Кто больше соберёт мусора за время' },
};
// Палитра окраски робота игрока; null — родной цвет модели
export const PAINTS = [null, '#f1edf2', '#3a3a44', '#ff3b4e', '#ff8a2e', '#ffd166', '#4cd964', '#2ec4b6', '#5db2ff', '#3d5afe', '#b57bff', '#ff6fb5'];

// Погода и время суток
export const WEATHER = { day: 'День', evening: 'Вечер', rain: 'Дождь' };

export const LAPS = [3, 5, 10, 0];          // 0 — без конца
export const CLEAN_TIME = [60, 120, 180];   // секунды

const KEY = 'vacuum-rush-settings';
const DEFAULTS = { difficulty: 'medium', rivals: 4, mode: 'race', laps: 3, cleanTime: 120, colors: {}, map: 'kitchen', weather: 'day' };

export const settings = { ...DEFAULTS, ...load() };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* приватный режим — просто не сохраняем */ }
}

export const diff = () => DIFFICULTY[settings.difficulty] || DIFFICULTY.medium;

// Выбранный цвет для робота (свой у каждого) или null — родной
export const paintOf = id => (settings.colors || {})[id] || null;
export function setPaint(id, c) {
  settings.colors = { ...(settings.colors || {}) };
  if (c) settings.colors[id] = c; else delete settings.colors[id];
  saveSettings();
}
// Паспорт робота с учётом окраски
export const painted = spec => { const c = paintOf(spec.id); return c ? { ...spec, color: c } : spec; };
