// Regresión logística con regularización L2, resuelta por el método de Newton.
// Pocos rasgos (9 + zonas), así que es exacta y rápida incluso con cientos de miles de filas.

import { sigmoide } from "../app/js/motor.js";

function resolver(A, b) {
  const n = b.length;
  const M = A.map((fila, i) => [...fila, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((fila, i) => fila[n] / fila[i]);
}

// filas: [{x: [...], y: 0|1, w: peso}]; l2: penalización por rasgo (array)
// centro: pesos hacia los que se "jala" (lo aprendido antes). Así, los datos nuevos corrigen
// lo aprendido en vez de empezar de cero.
export function ajustar(filas, nRasgos, l2, centro = null) {
  const c = centro ? [...centro] : new Array(nRasgos).fill(0);
  let w = [...c];
  for (let iter = 0; iter < 30; iter++) {
    const g = w.map((wi, k) => l2[k] * (wi - c[k]));
    const H = Array.from({ length: nRasgos }, (_, i) =>
      Array.from({ length: nRasgos }, (_, j) => (i === j ? l2[i] : 0))
    );
    for (const { x, y, w: peso = 1 } of filas) {
      let z = 0;
      for (let k = 0; k < nRasgos; k++) z += x[k] * w[k];
      const p = sigmoide(z);
      const e = (p - y) * peso;
      const s = p * (1 - p) * peso;
      for (let i = 0; i < nRasgos; i++) {
        if (x[i] === 0) continue;
        g[i] += e * x[i];
        for (let j = i; j < nRasgos; j++) H[i][j] += s * x[i] * x[j];
      }
    }
    for (let i = 0; i < nRasgos; i++) for (let j = 0; j < i; j++) H[i][j] = H[j][i];
    const paso = resolver(H, g);
    w = w.map((wi, k) => wi - paso[k]);
    if (Math.max(...paso.map(Math.abs)) < 1e-6) break;
  }
  return w;
}

export function predecir(w, x) {
  let z = 0;
  for (let k = 0; k < w.length; k++) z += (x[k] ?? 0) * w[k];
  return sigmoide(z);
}

// Cuántas lluvias detecta y cuántas falsas alarmas da con un umbral.
export function evaluar(probs, ys, umbral) {
  let acierto = 0, seEscapa = 0, falsa = 0, brier = 0;
  for (let i = 0; i < ys.length; i++) {
    brier += (probs[i] - ys[i]) ** 2;
    if (probs[i] >= umbral) ys[i] ? acierto++ : falsa++;
    else if (ys[i]) seEscapa++;
  }
  return {
    error: brier / ys.length,
    acierto,
    seEscapa,
    falsa,
    deteccion: acierto / Math.max(1, acierto + seEscapa),
    precision: acierto / Math.max(1, acierto + falsa),
  };
}

// El umbral más alto que todavía detecta al menos `meta` de las lluvias.
// "Avisar aunque haya falsas alarmas": priorizamos no dejar escapar lluvias.
export function umbralPorDeteccion(probs, ys, meta) {
  const conLluvia = probs.filter((_, i) => ys[i]).sort((a, b) => b - a);
  if (!conLluvia.length) return 0.1;
  const idx = Math.min(conLluvia.length - 1, Math.ceil(meta * conLluvia.length) - 1);
  return Math.max(0.03, Math.floor(conLluvia[idx] * 1000) / 1000);
}
