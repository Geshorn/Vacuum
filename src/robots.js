/* =====================================================================
   ТИПЫ РОБОТОВ
   =====================================================================
   Максимальная скорость у всех одинаковая (MAX_SPEED). Роботы отличаются:
     • разгоном  — accelTime: за сколько секунд робот набирает максимум;
     • массой    — тяжёлый дольше тормозит и катится, лениво входит в поворот,
                   сильнее уходит в занос, меньше отскакивает, крупнее;
     • управляемостью — turn, steerTorque, grip (по умолчанию считаются от массы);
     • прочностью — hp.

   Как масса влияет на физику (derive() в robot.js):
     торможение     = brakeForce  / mass
     накат          = rollDrag    / mass
     набор поворота = steerTorque / mass
     сцепление в заносе = slideGrip / √mass
     отскок от стен     = bounce    / √mass
     расход заряда от скорости и ударов × mass
   Сила двигателя (power) вычисляется сама: power = mass × MAX_SPEED / accelTime.

   В паспорте обязательны: name, mass, accelTime, hp. Остальное — из defaultsFor(mass),
   любой параметр можно переопределить, чтобы сделать робота особенным.

   Ориентиры баланса (пылесос = эталон):
     accelTime ~ 1.0 … 2.5 с — лёгкие стартуют резче
     hp        ~ 60 … 400   — тяжёлые ~100 × масса, лёгким и средним добавлен запас
   ===================================================================== */

export const MAX_SPEED = 24;   // ед/с, одна для всех

export function defaultsFor(mass) {
  return {
    radius: 1.3 * Math.cbrt(mass),          // размер растёт с массой
    maxSpeed: MAX_SPEED,
    backMax: 6,
    turn: 3.2 / Math.pow(mass, 0.25),       // лёгкие поворачивают резче
    brakeForce: 24 * Math.pow(mass, 0.6),
    rollDrag: 5 * Math.pow(mass, 0.5),
    steerTorque: 11 * Math.pow(mass, 0.6),
    grip: 10,
    slideGrip: 2,
    bounce: 0.45,
    color: '#f1edf2',
  };
}

// Паспорта. Колонки: масса, время разгона до максимума (с), ХП + особенности.
const LIST = {
  // ── Лёгкие: резкий старт и вёрткость, но хрупкие ──
  remote:     { name: 'Пульт',             mass: 0.4, accelTime: 1.0,  hp: 60,  color: '#3a3a44' },                          // самый резкий
  mouse:      { name: 'Мышка',             mass: 0.5, accelTime: 1.1,  hp: 70,  color: '#d8dde6', grip: 12 },                // цепкая
  fan:        { name: 'Вентилятор',        mass: 0.7, accelTime: 1.15, hp: 85,  color: '#9fe3ff', bounce: 0.6 },             // упругий
  lamp:       { name: 'Настольная лампа',  mass: 0.8, accelTime: 1.2,  hp: 90,  color: '#ffd166', turn: 3.8 },               // самая вёрткая

  // ── Средние: сбалансированные ──
  vacuum:     { name: 'Пылесос',           mass: 1.0, accelTime: 1.33, hp: 120 },                                            // эталон
  blender:    { name: 'Блендер',           mass: 1.1, accelTime: 1.2,  hp: 120, color: '#ff5b3a' },                          // резкий старт
  mop:        { name: 'Робот-мойщик',      mass: 1.3, accelTime: 1.5,  hp: 145, color: '#5db2ff', grip: 8, slideGrip: 1.5 }, // скользкий
  iron:       { name: 'Утюг',              mass: 1.5, accelTime: 1.4,  hp: 140, color: '#b57bff', slideGrip: 3 },            // тяжёлый, но резвый

  // ── Тяжёлые: медленно разгоняются, много ХП, расталкивают лёгких ──
  mower:      { name: 'Газонокосилка',     mass: 1.8, accelTime: 1.8,  hp: 180, color: '#4cd964', grip: 12 },                // цепкая
  microwave:  { name: 'Микроволновка',     mass: 2.2, accelTime: 2.0,  hp: 220, color: '#dcdce2' },
  fridge:     { name: 'Холодильник',       mass: 3.0, accelTime: 2.3,  hp: 300, color: '#e9f1f7' },
  safe:       { name: 'Сейф',              mass: 3.5, accelTime: 2.5,  hp: 400, color: '#4a4f58', bounce: 0.2 },             // танк
};

// Пылесос сохраняет настройки, подобранные вручную
LIST.vacuum = { ...LIST.vacuum, radius: 1.3, turn: 3.2, brakeForce: 24, rollDrag: 5, steerTorque: 11, grip: 10, slideGrip: 2, bounce: 0.45 };

export const ROBOTS = Object.fromEntries(Object.entries(LIST).map(([id, spec]) => {
  const r = { id, ...defaultsFor(spec.mass), ...spec };
  r.power = r.power ?? r.mass * r.maxSpeed / r.accelTime;
  return [id, r];
}));

// Робот игрока: по умолчанию пылесос; для теста можно открыть игру с ?robot=fridge
const wanted = new URLSearchParams(location.search).get('robot');
export const PLAYER_ROBOT = ROBOTS[wanted] ? wanted : 'vacuum';
