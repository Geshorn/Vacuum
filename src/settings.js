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
export const LAPS = [3, 5, 10, 0];          // 0 — без конца
export const CLEAN_TIME = [60, 120, 180];   // секунды

const KEY = 'vacuum-rush-settings';
const DEFAULTS = { difficulty: 'medium', rivals: 4, mode: 'race', laps: 3, cleanTime: 120 };

export const settings = { ...DEFAULTS, ...load() };

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* приватный режим — просто не сохраняем */ }
}

export const diff = () => DIFFICULTY[settings.difficulty] || DIFFICULTY.medium;
