/* =====================================================================
   ТИПЫ РОБОТОВ
   =====================================================================
   Масса (mass) — главный параметр. «Силы» делятся на неё (см. derive() в robot.js):
     разгон         = power       / mass
     торможение     = brakeForce  / mass
     накат          = rollDrag    / mass
     набор поворота = steerTorque / mass
     сцепление в заносе = slideGrip / √mass
     отскок от стен     = bounce    / √mass
     расход заряда от скорости и ударов × mass

   В паспорте робота обязательны только: name, mass, maxSpeed, power, hp.
   Остальное, если не указано, берётся из defaultsFor(mass): тормоз, руль и т. д. растут
   с массой медленнее, чем она сама, — поэтому тяжёлые роботы ощутимо тяжелее, но остаются
   управляемыми. Любой параметр можно задать вручную, чтобы сделать робота особенным.

   Ориентиры баланса (пылесос = эталон):
     время разгона до максимума ~ 1.0 … 2.5 с — лёгкие стартуют резче
     макс. скорость             ~ 15 … 31
     ХП                     ~ 40 … 400  — примерно 100 × масса
   ===================================================================== */

export function defaultsFor(mass) {
  return {
    radius: 1.3 * Math.cbrt(mass),          // размер растёт с массой
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

// Паспорта. Колонки: масса, макс. скорость, сила двигателя, ХП + особенности.
// Время разгона до максимума = maxSpeed / (power / mass) — указано в комментарии справа.
const LIST = {
  // ── Лёгкие: быстрые и вёрткие, но хрупкие ──
  remote:     { name: 'Пульт',             mass: 0.4, maxSpeed: 31, power: 12, hp: 40,  color: '#3a3a44' },                          // 1.0 с, самый быстрый
  mouse:      { name: 'Мышка',             mass: 0.5, maxSpeed: 30, power: 14, hp: 50,  color: '#d8dde6', grip: 12 },                // 1.1 с, цепкая
  fan:        { name: 'Вентилятор',        mass: 0.7, maxSpeed: 28, power: 17, hp: 70,  color: '#9fe3ff', bounce: 0.6 },             // 1.15 с, упругий
  lamp:       { name: 'Настольная лампа',  mass: 0.8, maxSpeed: 27, power: 18, hp: 75,  color: '#ffd166', turn: 3.8 },               // 1.2 с, самая вёрткая

  // ── Средние: сбалансированные ──
  vacuum:     { name: 'Пылесос',           mass: 1.0, maxSpeed: 24, power: 18, hp: 100 },                                            // 1.3 с, эталон
  blender:    { name: 'Блендер',           mass: 1.1, maxSpeed: 25, power: 23, hp: 100, color: '#ff5b3a' },                          // 1.2 с, резкий старт
  mop:        { name: 'Робот-мойщик',      mass: 1.3, maxSpeed: 22, power: 19, hp: 130, color: '#5db2ff', grip: 8, slideGrip: 1.5 }, // 1.5 с, скользкий
  iron:       { name: 'Утюг',              mass: 1.5, maxSpeed: 25, power: 27, hp: 125, color: '#b57bff', slideGrip: 3 },            // 1.4 с, тяжёлый, но резвый

  // ── Тяжёлые: медленно разгоняются, много ХП, расталкивают лёгких ──
  mower:      { name: 'Газонокосилка',     mass: 1.8, maxSpeed: 21, power: 21, hp: 180, color: '#4cd964', grip: 12 },                // 1.8 с, цепкая
  microwave:  { name: 'Микроволновка',     mass: 2.2, maxSpeed: 19, power: 21, hp: 220, color: '#dcdce2' },                          // 2.0 с
  fridge:     { name: 'Холодильник',       mass: 3.0, maxSpeed: 17, power: 22, hp: 300, color: '#e9f1f7' },                          // 2.3 с
  safe:       { name: 'Сейф',              mass: 3.5, maxSpeed: 15, power: 21, hp: 400, color: '#4a4f58', bounce: 0.2 },             // 2.5 с, танк
};

// Пылесос сохраняет настройки, подобранные вручную
LIST.vacuum = { ...LIST.vacuum, radius: 1.3, turn: 3.2, brakeForce: 24, rollDrag: 5, steerTorque: 11, grip: 10, slideGrip: 2, bounce: 0.45 };

export const ROBOTS = Object.fromEntries(
  Object.entries(LIST).map(([id, spec]) => [id, { id, ...defaultsFor(spec.mass), ...spec }])
);

// Робот игрока: по умолчанию пылесос; для теста можно открыть игру с ?robot=fridge
const wanted = new URLSearchParams(location.search).get('robot');
export const PLAYER_ROBOT = ROBOTS[wanted] ? wanted : 'vacuum';
