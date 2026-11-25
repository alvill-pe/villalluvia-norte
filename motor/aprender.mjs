// Corre cada madrugada en GitHub Actions. Así VillaLluvia se corrige sola:
// 1. Toma los reportes de la familia ("Está lloviendo" / "No llueve") y lo que midieron los
//    aeropuertos ayer.
// 2. Para cada uno busca lo que los modelos habían pronosticado para esa hora y lugar.
// 3. Vuelve a ajustar los pesos: parte de lo aprendido (2024-2026) y lo corrige con lo nuevo.
//    Además aprende una corrección propia por zona (celdas de ~55 km).
// 4. Publica los pesos nuevos (la app los descarga) y las estadísticas de aciertos.
//
// Prueba local: node motor/aprender.mjs
import { readFile, writeFile } from "node:fs/promises";
import { RASGOS, rasgos, claveZona, probabilidad } from "../app/js/motor.js";
import { AEROPUERTOS, observaciones, pronosticosPasados } from "./fuentes.mjs";
import { ajustar, predecir, umbralPorDeteccion, evaluar } from "./aprendizaje.mjs";
import { db } from "./db.mjs";

if (process.env.GITHUB_ACTIONS && !process.env.SUPABASE_URL) {
  console.log("Falta configurar Supabase (ver INSTRUCCIONES.md). Hoy no hay nada que aprender.");
  process.exit(0);
}

const DIAS = [1, 2, 3];
const PESO_FAMILIA = 2; // un reporte de la familia vale por dos horas de aeropuerto: es de su propio lugar
const L2_BASE = 100;    // cuánto "se resiste" a cambiar lo aprendido antes
const L2_ZONA = 20;
const dia = (d) => d.toISOString().slice(0, 10);
const masDias = (fecha, n) => dia(new Date(Date.parse(fecha + "T12:00:00Z") + n * 86400000));
const limaHora = (iso) => new Date(Date.parse(iso) - 5 * 3600000).toISOString().slice(0, 13) + ":00";

const base = JSON.parse(await readFile(new URL("./datos/calibracion-base.json", import.meta.url), "utf8"));
const actual = (await db.leerPublico("calibracion")) ?? base;
const estado = (await db.leerPublico("aprendizaje_estado")) ?? {};
const hoyLima = limaHora(new Date().toISOString()).slice(0, 10);
const nuevos = [];

// ---------- 1a. Aeropuertos: días completos que aún no se procesaron ----------
const ultimoDia = masDias(hoyLima, -2);
let desde = estado.ultimo_dia_aeropuertos ? masDias(estado.ultimo_dia_aeropuertos, 1) : masDias(ultimoDia, -2);
if (desde < masDias(ultimoDia, -10)) desde = masDias(ultimoDia, -10);
if (desde <= ultimoDia) {
  for (const [codigo, est] of Object.entries(AEROPUERTOS)) {
    try {
      const obs = await observaciones(codigo, masDias(desde, -1), masDias(ultimoDia, 2));
      const pron = await pronosticosPasados(est.lat, est.lon, desde, ultimoDia, DIAS);
      let n = 0;
      for (const d of DIAS) {
        for (let i = 0; i < pron.tiempos.length; i++) {
          const t = pron.tiempos[i];
          if (!obs.has(t)) continue;
          const base = Date.parse(t + ":00Z");
          const y = [-1, 0, 1].some((k) => obs.get(new Date(base + k * 3600000).toISOString().slice(0, 13) + ":00")) ? 1 : 0;
          const x = rasgos(pron.porDia[d], i, Number(t.slice(11, 13)), pron.elevacion, d);
          if (!x) continue;
          nuevos.push({ momento: t + ":00-05:00", zona: claveZona(est.lat, est.lon), x, y, peso: 1, fuente: "aeropuerto" });
          n++;
        }
      }
      console.log(`${est.nombre}: ${n} ejemplos nuevos (${desde} a ${ultimoDia})`);
    } catch (e) {
      console.log(`${est.nombre}: no se pudo (${e.message})`);
    }
  }
  estado.ultimo_dia_aeropuertos = ultimoDia;
}

// ---------- 1b. Reportes de la familia ----------
const pendientes = await db.reportesPendientes();
// Un reporte por celular y hora (el último), para que nadie pese más por tocar muchas veces.
const unicos = new Map();
for (const r of pendientes) unicos.set(`${r.dispositivo}|${limaHora(r.momento)}`, r);
const probAnunciada = {};
const fallidos = new Set(); // claves celular|hora que se reintentarán mañana
const grupos = new Map();
for (const r of unicos.values()) {
  const t = limaHora(r.momento);
  const k = `${Number(r.lat).toFixed(2)},${Number(r.lon).toFixed(2)},${t.slice(0, 10)}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push({ ...r, t });
}
for (const [k, reps] of grupos) {
  const [lat, lon, fecha] = k.split(",");
  try {
    const pron = await pronosticosPasados(Number(lat), Number(lon), masDias(fecha, -1), masDias(fecha, 1), DIAS);
    for (const r of reps) {
      const i = pron.tiempos.indexOf(r.t);
      if (i < 0) continue;
      for (const d of DIAS) {
        const x = rasgos(pron.porDia[d], i, Number(r.t.slice(11, 13)), pron.elevacion, d);
        if (!x) continue;
        nuevos.push({ momento: r.momento, zona: claveZona(Number(lat), Number(lon)), x, y: r.llueve ? 1 : 0, peso: PESO_FAMILIA, fuente: "familia" });
        if (d === 1) probAnunciada[r.id] = probabilidad(x, actual, Number(lat), Number(lon));
      }
    }
  } catch (e) {
    console.log(`Reportes de ${reps[0].lugar}: se reintentará mañana (${e.message})`);
    for (const r of reps) fallidos.add(`${r.dispositivo}|${r.t}`);
  }
}
const procesados = pendientes
  .filter((r) => !fallidos.has(`${r.dispositivo}|${limaHora(r.momento)}`))
  .map((r) => r.id);
console.log(`Reportes de la familia: ${pendientes.length} recibidos, ${unicos.size - fallidos.size} usados.`);

if (nuevos.length) await db.agregarEjemplos(nuevos);
await db.marcarReportes(procesados, probAnunciada);
await db.podarEjemplos(new Date(Date.now() - 400 * 86400000).toISOString());

// ---------- 2. Volver a ajustar ----------
const ejemplos = await db.ejemplos();
const zonas = [...new Set(ejemplos.map((e) => e.zona))].sort();
const nB = RASGOS.length;
const ext = (e) => [...e.x, ...zonas.map((z) => (z === e.zona ? 1 : 0))];
const filas = ejemplos.map((e) => ({ x: ext(e), y: e.y, w: e.peso ?? 1 }));
let nueva = actual;
if (filas.length >= 50) {
  const l2 = [...new Array(nB).fill(L2_BASE), ...zonas.map(() => L2_ZONA)];
  const centro = [...base.pesos, ...zonas.map(() => 0)];
  const w = ajustar(filas, nB + zonas.length, l2, centro);
  const probs = filas.map((f) => predecir(w, f.x));
  const ys = filas.map((f) => f.y);
  const positivos = ys.reduce((a, b) => a + b, 0);
  const umbral = positivos >= 300 ? umbralPorDeteccion(probs, ys, base.meta_deteccion) : base.umbral_aviso;
  nueva = {
    ...base,
    version: (actual.version ?? 1) + 1,
    actualizado: new Date().toISOString(),
    pesos: w.slice(0, nB).map((v) => Number(v.toFixed(5))),
    zonas: Object.fromEntries(zonas.map((z, i) => [z, Number(w[nB + i].toFixed(4))])),
    umbral_aviso: umbral,
    ejemplos_nuevos: filas.length,
    origen: `${base.origen} + ${filas.length} ejemplos recientes (aeropuertos y familia)`,
  };
  const r = evaluar(probs, ys, umbral);
  console.log(`Reajuste con ${filas.length} ejemplos (${positivos} con lluvia): detecta ${Math.round(r.deteccion * 100)} %, error ${r.error.toFixed(4)}`);
  console.log("Correcciones por zona:", nueva.zonas);
} else {
  console.log(`Solo ${filas.length} ejemplos nuevos: se mantienen los pesos actuales.`);
}
await db.guardarPublico("calibracion", nueva);

// ---------- 3. Aciertos de los últimos 30 días (según la familia) ----------
const recientes = (await db.reportesDesde(new Date(Date.now() - 30 * 86400000).toISOString())).filter((r) => r.procesado || probAnunciada[r.id] !== undefined);
const conProb = recientes.map((r) => ({ ...r, prob: r.prob_anunciada ?? probAnunciada[r.id] })).filter((r) => r.prob !== null && r.prob !== undefined);
const lluvias = conProb.filter((r) => r.llueve);
const secos = conProb.filter((r) => !r.llueve);
const aciertos = {
  actualizado: new Date().toISOString(),
  reportes: recientes.length,
  lluvias: lluvias.length,
  lluvias_anunciadas: lluvias.filter((r) => r.prob >= nueva.umbral_aviso).length,
  secos: secos.length,
  secos_acertados: secos.filter((r) => r.prob < nueva.umbral_aviso).length,
};
await db.guardarPublico("aciertos", aciertos);
estado.ultima_ejecucion = new Date().toISOString();
await db.guardarPublico("aprendizaje_estado", estado);

// Archivo pequeño en el repositorio: deja constancia y mantiene activo el proyecto en GitHub.
await writeFile(
  new URL("./datos/estado.json", import.meta.url),
  JSON.stringify({ ultima_correccion: nueva.actualizado, version: nueva.version, ejemplos: filas.length, aciertos }, null, 2)
);
console.log("Aciertos (30 días):", aciertos);
