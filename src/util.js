export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const wrap = d => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
export const approach = (v, target, rate, dt) => v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt);
export function pick(list) {             // случайная фраза, не повторяя прошлую
  let s = list[Math.floor(Math.random() * list.length)];
  if (list.length > 1 && s === list._last) return pick(list);
  list._last = s; return s;
}
export const fmtTime = ms => { const s = ms / 1000; return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0'); };

// Убрать объект со сцены и освободить память видеокарты: геометрии, материалы и их текстуры.
// Общие (на несколько карт) материалы и текстуры тоже можно: three.js загрузит их заново при следующем показе.
export function disposeDeep(o) {
  if (!o) return;
  o.parent?.remove(o);
  const mats = new Set(), texs = new Set();
  o.traverse(c => {
    c.geometry?.dispose();
    if (c.isInstancedMesh) c.dispose();
    for (const m of [c.material].flat()) if (m) mats.add(m);
  });
  for (const m of mats) { for (const v of Object.values(m)) if (v?.isTexture) texs.add(v); if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value?.isTexture) texs.add(u.value); m.dispose(); }
  for (const t of texs) t.dispose();
}
