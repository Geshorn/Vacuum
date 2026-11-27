import { pick } from './util.js';

// Реплики соперников: у каждого свой пузырь над головой (цветная рамка — цвет робота, сверху — имя).
// Чтобы не было гомона: говорят только те, кто рядом с игроком и в кадре; у каждого пауза между репликами,
// одновременно — не больше двух пузырей. Время — игровое (performance.now() из clock.js), на паузе пузыри не гаснут.

export const RP = {
  start: ['Ну что, погнали!', 'Сейчас всех обгоню!', 'Пыль столбом!', 'Удачи… она тебе понадобится'],
  overtake: ['Пока-пока!', 'Подвинься, медленный!', 'Видишь мою щётку? Больше не увидишь!', 'Догоняй!'],
  overtaken: ['Эй, так нечестно!', 'Ещё посмотрим!', 'Я тебя догоню!', 'Ну ты и шустрый…'],
  bump: ['Получи!', 'С дороги!', 'Это мой поворот!', 'Бум! Извини… нет, не извини'],
  bumped: ['Эй, не толкайся!', 'Осторожнее, я хрупкий!', 'Ты мне царапину оставил!'],
  shot: ['Фу, крошки!', 'Кто стреляет мусором?!', 'Ай, в глаз!'],
  cap: ['Ой, пробка!', 'Бдыщь! Ну погоди!'],
  rocket: ['Апчхи! Пыль!', 'Меня сдуло!', 'Кто запустил ракету?!'],
  banana: ['Банан?! Уииии!', 'Кто бросил кожуру?!'],
  soap: ['Скользко!', 'Ааа, пена!', 'Я кручусь!'],
  fire: ['Лови!', 'Подарочек!', 'Это тебе!', 'Пли!'],
  lowHp: ['Я разваливаюсь…', 'Мне нужен ремонт!', 'Корпус трещит!'],
  out: ['Не-е-ет!', 'Я вернусь!', 'БА-БАХ!', 'Запомните меня чистым…'],
  playerOut: ['Ха! Минус один!', 'Покойся с миром, пылесборник', 'Это было громко!'],
  catchUp: ['Срезал!', 'Я снова тут!'],
  win: ['Я первый! 🏆', 'Чемпион!'],
};

const COOLDOWN = 5000;   // мс между репликами одного робота
const GLOBAL = 1200;     // мс между любыми репликами соперников
const MAX_ON = 2;        // пузырей одновременно
const NEAR = 55;         // дальше от игрока — молчат (их не слышно)

export class Chatter {
  constructor() { this.items = new Map(); this.lastAny = 0; }

  el(rival) {
    let e = this.items.get(rival);
    if (!e) {
      const d = document.createElement('div'); d.className = 'rsay';
      d.style.setProperty('--c', rival.bot.spec.color);
      document.body.appendChild(d);
      e = { d, until: 0, last: 0 }; this.items.set(rival, e);
    }
    return e;
  }

  // list — массив фраз (RP.*); force — сказать, даже если недавно говорил (важные события: выбыл, подбили)
  say(rival, list, player, { ms = 1800, force = false } = {}) {
    if (!rival || !list) return;
    const now = performance.now(), e = this.el(rival), b = rival.bot;
    if (player && Math.hypot(b.x - player.x, b.z - player.z) > NEAR) return;
    if (!force && (now - e.last < COOLDOWN || now - this.lastAny < GLOBAL)) return;
    const on = [...this.items.values()].filter(x => x.until > now && x !== e).length;
    if (on >= MAX_ON && !force) return;
    e.d.innerHTML = `<small>${b.spec.name}</small>${pick(list)}`;
    e.d.classList.add('on'); e.until = now + ms; e.last = this.lastAny = now;
    e.x = b.x; e.z = b.z;
  }

  // Каждый кадр: пузыри — над своими роботами (выбывший — над местом взрыва), за кадром прячем
  update(camera) {
    const now = performance.now(), v = this.tmp || (this.tmp = new camera.position.constructor());
    for (const [rival, e] of this.items) {
      if (e.until <= now) { e.d.classList.remove('on'); continue; }
      if (!rival.out) { e.x = rival.bot.x; e.z = rival.bot.z; }
      v.set(e.x, 3.2, e.z).project(camera);
      const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      e.d.classList.toggle('on', vis);
      e.d.style.transform = `translate(${(v.x + 1) / 2 * innerWidth}px,${(1 - v.y) / 2 * innerHeight}px) translate(-50%,-100%)`;
    }
  }

  clear() { for (const e of this.items.values()) e.d.remove(); this.items.clear(); this.lastAny = 0; }
}
