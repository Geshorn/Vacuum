// Клавиатура. Стрелки — руль и газ, пробел или Shift — дрифт.
const TRACKED = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Shift']);
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

export const input = { keys: {}, lastKeyTime: 0 };

window.addEventListener('keydown', e => {
  if (!TRACKED.has(e.key)) return;
  if (e.key !== 'Shift') e.preventDefault();
  input.keys[e.key] = true;
  if (ARROWS.has(e.key)) input.lastKeyTime = performance.now();
});
window.addEventListener('keyup', e => {
  if (!TRACKED.has(e.key)) return;
  input.keys[e.key] = false;
  if (ARROWS.has(e.key)) input.lastKeyTime = performance.now();
});
window.addEventListener('blur', () => { input.keys = {}; });
