import { MAPS } from './maps.js';
import { ROBOTS } from './robots.js';

/* Замер производительности без участия человека: index.html?perf=1
   На каждой карте запускает гонку из одних ботов, рисует её как в игре (камера едет за лидером)
   и меряет кадры, вызовы отрисовки, треугольники, геометрии, текстуры, шейдеры и память.
   Параметры: perf=секунд на карту (по умолчанию 6), map=kitchen|...|all (по умолчанию all), field=5, warm=2 (с прогрева).
   Итог: window.__perf и файл perf/results.json (его пишет serve.ps1). Запуск без окна: scripts/perf.ps1 */

const q = new URLSearchParams(location.search);

export function runPerf({ world, loadMap, startSimRace, simStep, frame }) {
  const secs = +q.get('perf') > 1 ? +q.get('perf') : 6;
  const warm = +(q.get('warm') ?? 2);
  const field = +q.get('field') || 5;
  const mapArg = q.get('map') || 'all';
  const maps = mapArg === 'all' ? Object.keys(MAPS) : [mapArg];
  const r = world.renderer, info = r.info;
  info.autoReset = false;
  const out = { when: new Date().toISOString(), ua: navigator.userAgent, gpu: gpuName(r), params: { secs, warm, field, maps }, maps: {} };
  let mi = 0;

  function runMap() {
    const id = maps[mi];
    loadMap(id);
    startSimRace(Object.keys(ROBOTS).slice(0, field));
    const frames = [], cpu = [], calls = [], tris = [], sh = [];
    const t0 = performance.now();
    let last = t0;
    const tick = () => {
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      const fdt = now - last; last = now;
      info.reset();
      const c0 = performance.now();
      simStep(now, dt);
      frame(dt, now);
      world.render();
      const c1 = performance.now();
      if (now - t0 > warm * 1000) { frames.push(fdt); cpu.push(c1 - c0); calls.push(info.render.calls); tris.push(info.render.triangles); sh.push(!!world.lastShadow); }
      if (now - t0 < (warm + secs) * 1000) return requestAnimationFrame(tick);
      out.maps[id] = summary(frames, cpu, calls, tris, info, sh);
      if (++mi < maps.length) runMap(); else finish();
    };
    requestAnimationFrame(tick);
  }

  function finish() {
    const all = Object.values(out.maps);
    out.worst = {
      fps: Math.min(...all.map(m => m.fps)),
      cpuMsP95: Math.max(...all.map(m => m.cpuMsP95)),
      drawCallsMax: Math.max(...all.map(m => m.drawCalls.max)),
      triangles: Math.max(...all.map(m => m.triangles)),
      geometries: Math.max(...all.map(m => m.geometries)),
      textures: Math.max(...all.map(m => m.textures)),
      programs: Math.max(...all.map(m => m.programs)),
      heapMB: Math.max(...all.map(m => m.heapMB ?? 0)) || null,
    };
    window.__perf = out;
    console.log('PERF', JSON.stringify(out));
    fetch('/perf-results', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out, null, 2) })
      .finally(() => { document.title = 'PERF DONE'; });
  }
  runMap();
}

function summary(frames, cpu, calls, tris, info, sh) {
  const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
  const p95 = a => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)];
  return {
    frames: frames.length,
    fps: +(1000 / avg(frames)).toFixed(1),
    longFrames: frames.filter(f => f > 25).length,
    cpuMsAvg: +avg(cpu).toFixed(2), cpuMsP95: +p95(cpu).toFixed(2),
    drawCalls: { min: Math.min(...calls), max: Math.max(...calls), avg: Math.round(avg(calls)) },
    // вызовы в кадрах без перерисовки карты теней и с ней (карта теней обновляется не каждый кадр — см. world.js)
    drawCallsNoShadow: Math.max(0, ...calls.filter((c, i) => !sh[i])) || null,
    shadowFrames: +(sh.filter(Boolean).length / sh.length).toFixed(2),
    triangles: Math.max(...tris),
    geometries: info.memory.geometries, textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  };
}

function gpuName(r) {
  try { const gl = r.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }
  catch { return null; }
}
