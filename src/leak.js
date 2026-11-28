import { MAPS } from './maps.js';
import { ROBOTS } from './robots.js';

/* Проверка утечек при смене карт: index.html?leak=10
   N раз подряд грузит все карты по кругу (на каждой — короткая гонка ботов с отрисовкой),
   после каждого круга чистит мусор (window.gc — есть, если браузер запущен с --js-flags=--expose-gc)
   и записывает память JS и счётчики видеокарты (геометрии, текстуры, шейдеры).
   Растёт от круга к кругу — утечка. Итог: window.__leak и perf/leak.json. Запуск без окна: scripts/perf.ps1 -Leak 10 */

const q = new URLSearchParams(location.search);
const frames = n => new Promise(done => { let k = 0; const f = () => ++k >= n ? done() : requestAnimationFrame(f); requestAnimationFrame(f); });

export async function runLeak({ world, loadMap, startSimRace, simStep, frame }) {
  const cycles = +q.get('leak') || 10;
  const maps = Object.keys(MAPS);
  const info = world.renderer.info;
  const gc = async () => { if (window.gc) { for (let i = 0; i < 3; i++) { window.gc(); await frames(2); } } else await frames(30); };
  const snap = async (label) => {
    await gc();
    let objects = 0; world.scene.traverse(() => objects++);
    return { label, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0,
      sceneObjects: objects, sceneChildren: world.scene.children.length };
  };
  const rows = [await snap('start')];
  for (let c = 1; c <= cycles; c++) {
    for (const id of maps) {
      loadMap(id);
      startSimRace(Object.keys(ROBOTS).slice(0, 5));
      let t = performance.now();
      for (let k = 0; k < 20; k++) {           // 20 кадров гонки, чтобы создались эффекты, следы, снаряды
        await frames(1); const now = performance.now(), dt = Math.min((now - t) / 1000, 0.05); t = now;
        simStep(now, dt); frame(dt, now); world.render();
      }
    }
    rows.push(await snap('cycle ' + c));
    document.title = `LEAK ${c}/${cycles}`;
  }
  const a = rows[1], b = rows[rows.length - 1], n = rows.length - 2 || 1;
  const perCycle = k => +(((b[k] ?? 0) - (a[k] ?? 0)) / n).toFixed(2);
  const out = { when: new Date().toISOString(), gcForced: !!window.gc, cycles, maps, rows,
    growthPerCycle: { heapMB: perCycle('heapMB'), geometries: perCycle('geometries'), textures: perCycle('textures'), programs: perCycle('programs'), sceneObjects: perCycle('sceneObjects') } };
  window.__leak = out;
  await fetch('/perf-results?leak=1', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) }).catch(() => {});
  document.title = 'PERF DONE';
}
