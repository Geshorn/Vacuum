// Игровые часы с паузой. Вся игра берёт время из performance.now() — подменяем его так,
// что на паузе время стоит, а после паузы идёт дальше без скачка (таймеры оружия, щиты, круги не «съедаются»).
const real = performance.now.bind(performance);
let offset = 0, since = 0;

performance.now = () => (since || real()) - offset;

export const isPaused = () => since > 0;
export function pauseClock() { if (!since) since = real(); }
export function resumeClock() { if (since) { offset += real() - since; since = 0; } }
