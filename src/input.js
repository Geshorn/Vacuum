// Клавиатура: стрелки или WASD (по физической клавише, работает и в русской раскладке)
const MAP = {
  ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  KeyA: 'ArrowLeft', KeyD: 'ArrowRight', KeyW: 'ArrowUp', KeyS: 'ArrowDown',
};

export const input = { keys: {}, lastKeyTime: 0 };

function onKey(e, down) {
  const k = MAP[e.code];
  if (!k || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  input.keys[k] = down;
  input.lastKeyTime = performance.now();
}
window.addEventListener('keydown', e => onKey(e, true));
window.addEventListener('keyup', e => onKey(e, false));
window.addEventListener('blur', () => { input.keys = {}; });
