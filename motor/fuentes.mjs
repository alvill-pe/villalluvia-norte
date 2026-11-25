// Descarga de datos: lo que pronosticaron los modelos y lo que de verdad pasó.
import { MODELOS, ZONA_HORARIA } from "../app/js/motor.js";

export const AEROPUERTOS = {
  SPUR: { nombre: "Piura", lat: -5.2058, lon: -80.6164 },
  SPME: { nombre: "Tumbes", lat: -3.5525, lon: -80.3811 },
  SPYL: { nombre: "Talara", lat: -4.5766, lon: -81.2541 },
  SPHI: { nombre: "Chiclayo", lat: -6.7875, lon: -79.8281 },
  SPJE: { nombre: "Jaén", lat: -5.5925, lon: -78.774 },
  SPJR: { nombre: "Cajamarca", lat: -7.1392, lon: -78.4894 },
  SPPY: { nombre: "Chachapoyas", lat: -6.2018, lon: -77.8561 },
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

export async function traer(url, { json = false, intentos = 8 } = {}) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "VillaLluviaNorte/1.0" }, signal: AbortSignal.timeout(60000) });
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return json ? await r.json() : await r.text();
    } catch (e) {
      if (i === intentos - 1) throw e;
      await espera(5000 * (i + 1));
    }
  }
}

// Lluvia (RA) o llovizna (DZ) en el reporte, sin contar "en las cercanías" (VC).
const LLUVIA = /(^|\s)[-+]?(TS|SH)?(TS)?(RA|DZ)(?=\s|=|$)/;

export function hayLluviaEnMetar(metar) {
  return LLUVIA.test(metar.split(" RMK")[0]);
}

// Devuelve Map "YYYY-MM-DDTHH:00" (hora de Lima) -> true/false
export async function observaciones(estacion, desde, hasta) {
  const [y1, m1, d1] = desde.split("-").map(Number);
  const [y2, m2, d2] = hasta.split("-").map(Number);
  const url =
    "https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?" +
    `station=${estacion}&data=metar&year1=${y1}&month1=${m1}&day1=${d1}` +
    `&year2=${y2}&month2=${m2}&day2=${d2}&tz=Etc/UTC&format=onlycomma&report_type=3&report_type=4`;
  const texto = await traer(url);
  const obs = new Map();
  for (const linea of texto.split("\n").slice(1)) {
    const partes = linea.split(",");
    if (partes.length < 3) continue;
    const utc = Date.parse(partes[1].replace(" ", "T") + ":00Z");
    if (Number.isNaN(utc)) continue;
    const lima = new Date(utc - 5 * 3600 * 1000).toISOString().slice(0, 13) + ":00";
    const metar = partes.slice(2).join(",");
    obs.set(lima, (obs.get(lima) ?? false) || hayLluviaEnMetar(metar));
  }
  return obs;
}

// Lo que cada modelo pronosticó con `dias` de anticipación, hora por hora.
export async function pronosticosPasados(lat, lon, desde, hasta, dias) {
  const variables = dias.map((d) => `precipitation_previous_day${d}`).join(",");
  const url =
    "https://previous-runs-api.open-meteo.com/v1/forecast?" +
    `latitude=${lat}&longitude=${lon}&hourly=${variables}&start_date=${desde}&end_date=${hasta}` +
    `&models=${MODELOS.join(",")}&timezone=${encodeURIComponent(ZONA_HORARIA)}`;
  const d = await traer(url, { json: true });
  const porDia = {};
  for (const dia of dias) {
    porDia[dia] = Object.fromEntries(
      MODELOS.map((m) => [m, d.hourly[`precipitation_previous_day${dia}_${m}`] ?? []])
    );
  }
  return { tiempos: d.hourly.time, elevacion: d.elevation, porDia };
}
