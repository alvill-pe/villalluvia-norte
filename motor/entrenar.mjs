// Entrenamiento inicial. Se corre una vez (o cuando se quiera rehacer desde cero):
//   node motor/entrenar.mjs
// 1. Descarga lo que pronosticaron ECMWF, GFS e ICON con 1, 2 y 3 días de anticipación.
// 2. Descarga lo que de verdad pasó (reportes de aeropuertos del norte).
// 3. Aprende con 2024-2025 y se pone a prueba con 2026, que no vio.
// 4. Aprende con todo y guarda los pesos en app/datos/calibracion.json.

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { RASGOS, rasgos } from "../app/js/motor.js";
import { AEROPUERTOS, observaciones, pronosticosPasados } from "./fuentes.mjs";
import { ajustar, predecir, evaluar, umbralPorDeteccion } from "./aprendizaje.mjs";

const DESDE = "2024-01-01";
const HASTA = process.env.HASTA || new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const DIAS = [1, 2, 3];
const META_DETECCION = 0.75; // solo para el informe de comparación
// Decisión del usuario (2026-11-25): mostrar y avisar lluvia solo cuando sea probable (50 % o más).
// Prueba 2026: cuando la app marcó lluvia en un día, llovió 71 de cada 100 veces.
const UMBRAL_CERTEZA = 0.5;
const CACHE = new URL("./.cache/", import.meta.url);

async function conCache(nombre, fn) {
  const ruta = new URL(nombre, CACHE);
  if (existsSync(ruta)) return JSON.parse(await readFile(ruta, "utf8"));
  const v = await fn();
  await mkdir(CACHE, { recursive: true });
  await writeFile(ruta, JSON.stringify(v));
  return v;
}

function etiqueta(obs, t) {
  // ¿Llovió entre una hora antes y una hora después? Solo si hay reporte a esa hora.
  if (!obs.has(t)) return null;
  const base = Date.parse(t + ":00Z");
  for (const d of [-1, 0, 1]) {
    const k = new Date(base + d * 3600000).toISOString().slice(0, 13) + ":00";
    if (obs.get(k)) return 1;
  }
  return 0;
}

const filas = [];
for (const [codigo, est] of Object.entries(AEROPUERTOS)) {
  const obsArr = await conCache(`obs-${codigo}-${DESDE}-${HASTA}.json`, async () => [
    ...(await observaciones(codigo, DESDE, HASTA)),
  ]);
  const obs = new Map(obsArr);
  if (obs.size < 1000) {
    console.log(`${codigo} ${est.nombre}: muy pocos reportes (${obs.size}), se omite`);
    continue;
  }
  const pron = await conCache(`pron-${codigo}-${DESDE}-${HASTA}.json`, () =>
    pronosticosPasados(est.lat, est.lon, DESDE, HASTA, DIAS)
  );
  let n = 0, lluvias = 0;
  for (const dia of DIAS) {
    const serie = pron.porDia[dia];
    for (let i = 0; i < pron.tiempos.length; i++) {
      const t = pron.tiempos[i];
      const y = etiqueta(obs, t);
      if (y === null) continue;
      const x = rasgos(serie, i, Number(t.slice(11, 13)), pron.elevacion, dia);
      if (!x) continue;
      filas.push({ x, y, anio: Number(t.slice(0, 4)), estacion: codigo, dia });
      n++;
      lluvias += y;
    }
  }
  console.log(`${codigo} ${est.nombre}: ${obs.size} horas con reporte, ${n} ejemplos, ${lluvias} con lluvia`);
}

const nR = RASGOS.length;
const l2 = new Array(nR).fill(1);
l2[0] = 0.01;

// ---- Prueba honesta: aprende con 2024-2025, se evalúa con 2026 ----
const entreno = filas.filter((f) => f.anio < 2026);
const prueba = filas.filter((f) => f.anio === 2026);
const wPrueba = ajustar(entreno, nR, l2);
const umbralPrueba = umbralPorDeteccion(entreno.map((f) => predecir(wPrueba, f.x)), entreno.map((f) => f.y), META_DETECCION);

const yPrueba = prueba.map((f) => f.y);
const informe = { desde: DESDE, hasta: HASTA, ejemplos: filas.length, prueba_2026: {} };
for (const dia of DIAS) {
  const idx = prueba.map((f, i) => (f.dia === dia ? i : -1)).filter((i) => i >= 0);
  const ys = idx.map((i) => yPrueba[i]);
  const aprendido = evaluar(idx.map((i) => predecir(wPrueba, prueba[i].x)), ys, umbralPrueba);
  // Referencia: promedio simple, "llueve si 2 de 3 modelos ven lluvia".
  const promedio = evaluar(idx.map((i) => prueba[i].x[4]), ys, 0.6);
  const europeo = evaluar(idx.map((i) => (Math.expm1(prueba[i].x[1]) >= 0.1 ? 1 : 0)), ys, 0.5);
  informe.prueba_2026[`${dia}_dia`] = { horas_con_lluvia: ys.reduce((a, b) => a + b, 0), horas: ys.length, aprendido, promedio, europeo };
}
informe.umbral_prueba = umbralPrueba;

// ---- Modelo final: aprende con todo ----
const pesos = ajustar(filas, nR, l2);
const umbral = UMBRAL_CERTEZA;
const calib = {
  version: 1,
  actualizado: new Date().toISOString(),
  rasgos: RASGOS,
  pesos: pesos.map((w) => Number(w.toFixed(5))),
  zonas: {},
  umbral_aviso: umbral,
  meta_deteccion: META_DETECCION,
  umbral_notificacion: UMBRAL_CERTEZA, // el celular suena solo si la lluvia es probable
  umbral_madrugada: UMBRAL_CERTEZA,
  origen: `Aeropuertos ${Object.keys(AEROPUERTOS).join(", ")}, ${DESDE} a ${HASTA}`,
};
await mkdir(new URL("../app/datos/", import.meta.url), { recursive: true });
await writeFile(new URL("../app/datos/calibracion.json", import.meta.url), JSON.stringify(calib, null, 2));
await mkdir(new URL("./datos/", import.meta.url), { recursive: true });
await writeFile(new URL("./datos/calibracion-base.json", import.meta.url), JSON.stringify(calib, null, 2));
await writeFile(new URL("./datos/informe-entrenamiento.json", import.meta.url), JSON.stringify(informe, null, 2));

const f = (r) => `detecta ${r.acierto}/${r.acierto + r.seEscapa} (${Math.round(r.deteccion * 100)} %), falsas alarmas ${r.falsa}, error ${r.error.toFixed(4)}`;
for (const [k, v] of Object.entries(informe.prueba_2026)) {
  console.log(`\nPrueba 2026, ${k} de anticipación (${v.horas_con_lluvia} horas con lluvia de ${v.horas}):`);
  console.log(`  Solo europeo : ${f(v.europeo)}`);
  console.log(`  Promedio 2/3 : ${f(v.promedio)}`);
  console.log(`  APRENDIDO    : ${f(v.aprendido)}`);
}
console.log("\nPesos finales:", Object.fromEntries(RASGOS.map((r, i) => [r, calib.pesos[i]])));
console.log("Umbral de aviso:", umbral);

// Tabla para elegir el umbral de las notificaciones (prueba 2026, 1 día de anticipación).
const p1 = prueba.filter((f) => f.dia === 1);
const probs1 = p1.map((f) => predecir(wPrueba, f.x));
const ys1 = p1.map((f) => f.y);
console.log("\nUmbral | detecta | falsas alarmas | horas marcadas por día");
const tabla = [];
for (const u of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5]) {
  const r = evaluar(probs1, ys1, u);
  const marcadas = (r.acierto + r.falsa) / (p1.length / 24);
  tabla.push({ umbral: u, deteccion: r.deteccion, precision: r.precision, horas_por_dia: marcadas });
  console.log(`${String(u).padEnd(6)} | ${Math.round(r.deteccion * 100)} %    | ${r.falsa} (${Math.round((1 - r.precision) * 100)} %) | ${marcadas.toFixed(1)}`);
}
informe.tabla_umbrales_2026 = tabla;
await writeFile(new URL("./datos/informe-entrenamiento.json", import.meta.url), JSON.stringify(informe, null, 2));
