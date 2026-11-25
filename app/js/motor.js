// Motor de pronóstico de VillaLluvia Norte.
// Lo usan la app (navegador) y los procesos automáticos (Node), para que ambos calculen igual.
//
// Idea: tres modelos mundiales (ECMWF de Europa, GFS de EE. UU. e ICON de Alemania) dicen
// cuántos milímetros caerán cada hora. Un modelo de regresión logística, entrenado con lo que
// de verdad pasó (aeropuertos y reportes de la familia), convierte esos milímetros en
// "probabilidad de que llueva alrededor de esa hora" (entre una hora antes y una hora después).

export const MODELOS = ["ecmwf_ifs025", "gfs_seamless", "icon_seamless"];
export const ZONA_HORARIA = "America/Lima";

// Rasgos que mira el modelo. El orden debe coincidir con los pesos de calibracion.json.
export const RASGOS = [
  "constante",
  "ecmwf",
  "gfs",
  "icon",
  "modelos_con_lluvia",
  "seno_hora",
  "coseno_hora",
  "altura_km",
  "dias_adelanto",
];

const LIMITE_MOJADO = 0.1; // mm en la ventana de 3 horas para decir que un modelo "ve lluvia"

export function sigmoide(z) {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

// Suma de lluvia de un modelo en la ventana [h-1, h+1]. Devuelve null si no hay datos.
function ventana(serie, i) {
  let suma = 0;
  let hay = false;
  for (let j = i - 1; j <= i + 1; j++) {
    const v = serie?.[j];
    if (v !== null && v !== undefined) {
      suma += v;
      hay = true;
    }
  }
  return hay ? suma : null;
}

// porModelo: { ecmwf_ifs025: [mm por hora], ... }; i: índice de la hora; hora: 0-23
export function rasgos(porModelo, i, hora, alturaM, diasAdelanto) {
  const vals = MODELOS.map((m) => ventana(porModelo[m], i));
  const conDato = vals.filter((v) => v !== null);
  if (conDato.length === 0) return null;
  const promedio = conDato.reduce((a, b) => a + b, 0) / conDato.length;
  const llenos = vals.map((v) => (v === null ? promedio : v));
  const angulo = (2 * Math.PI * hora) / 24;
  return [
    1,
    ...llenos.map((v) => Math.log1p(v)),
    llenos.filter((v) => v >= LIMITE_MOJADO).length / MODELOS.length,
    Math.sin(angulo),
    Math.cos(angulo),
    Math.max(0, alturaM || 0) / 1000,
    Math.min(3, Math.max(0, diasAdelanto)) / 3,
  ];
}

export function claveZona(lat, lon) {
  // Celdas de medio grado (~55 km). Cada zona aprende su propia corrección con los reportes.
  return `${(Math.floor(lat * 2) / 2).toFixed(1)}_${(Math.floor(lon * 2) / 2).toFixed(1)}`;
}

export function probabilidad(x, calib, lat, lon) {
  let z = 0;
  for (let k = 0; k < x.length; k++) z += x[k] * calib.pesos[k];
  z += calib.zonas?.[claveZona(lat, lon)] ?? 0;
  return sigmoide(z);
}

export function urlPronostico(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: "precipitation,cloud_cover,temperature_2m,is_day",
    models: MODELOS.join(","),
    forecast_days: "4",
    past_hours: "2",
    timezone: ZONA_HORARIA,
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

// Hora actual de Lima como "YYYY-MM-DDTHH:00" (Perú no usa horario de verano: UTC-5).
export function horaLimaActual(ahora = new Date()) {
  const lima = new Date(ahora.getTime() - 5 * 3600 * 1000);
  return lima.toISOString().slice(0, 13) + ":00";
}

function promedioModelos(h, variable, i) {
  const v = MODELOS.map((m) => h[`${variable}_${m}`]?.[i]).filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function icono(prob, nubes, esDia, umbral) {
  if (prob >= umbral) return "lluvia";
  if (nubes === null) return esDia ? "sol" : "luna";
  if (nubes >= 80) return "nube";
  if (nubes >= 35) return esDia ? "sol_nube" : "luna_nube";
  return esDia ? "sol" : "luna";
}

// Convierte la respuesta de Open-Meteo en horas listas para mostrar.
export function procesar(datos, calib, lat, lon, ahora = new Date()) {
  const h = datos.hourly;
  const porModelo = Object.fromEntries(MODELOS.map((m) => [m, h[`precipitation_${m}`]]));
  const actual = horaLimaActual(ahora);
  const umbral = calib.umbral_aviso;
  const horas = [];
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    if (t < actual) continue;
    const hora = Number(t.slice(11, 13));
    const dias = (Date.parse(t + ":00Z") - Date.parse(actual + ":00Z")) / 86400000;
    const x = rasgos(porModelo, i, hora, datos.elevation, dias);
    const prob = x ? probabilidad(x, calib, lat, lon) : 0;
    const nubes = promedioModelos(h, "cloud_cover", i);
    const temp = promedioModelos(h, "temperature_2m", i);
    const esDia = (promedioModelos(h, "is_day", i) ?? (hora >= 6 && hora < 18 ? 1 : 0)) >= 0.5;
    horas.push({ t, hora, prob, temp, nubes, esDia, icono: icono(prob, nubes, esDia, umbral) });
  }
  return { horas, dias: resumirDias(horas, umbral), umbral, generado: ahora.toISOString() };
}

export function resumirDias(horas, umbral) {
  const porDia = new Map();
  for (const x of horas) {
    const d = x.t.slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, []);
    porDia.get(d).push(x);
  }
  const dias = [];
  for (const [fecha, hs] of porDia) {
    const temps = hs.map((x) => x.temp).filter((v) => v !== null);
    const max = hs.reduce((a, b) => (b.prob > a.prob ? b : a), hs[0]);
    const lluviosas = hs.filter((x) => x.prob >= umbral);
    const diurnas = hs.filter((x) => x.esDia);
    const nubesProm = diurnas.length
      ? diurnas.reduce((a, b) => a + (b.nubes ?? 0), 0) / diurnas.length
      : 50;
    dias.push({
      fecha,
      probMax: max.prob,
      horaMax: max.hora,
      franjas: franjas(lluviosas),
      principal: lluviosas.length ? nucleo(hs, hs.indexOf(max), umbral) : null,
      tMax: temps.length ? Math.max(...temps) : null,
      tMin: temps.length ? Math.min(...temps) : null,
      icono: lluviosas.length ? "lluvia" : nubesProm >= 80 ? "nube" : nubesProm >= 35 ? "sol_nube" : "sol",
    });
  }
  return dias;
}

// Las horas más probables: alrededor del pico, mientras la probabilidad siga cerca del máximo.
// Responde "¿a qué hora?" sin dar franjas de medio día.
function nucleo(hs, i, umbral) {
  const pico = hs[i].prob;
  const corte = Math.max(umbral, pico * 0.75);
  let a = i, b = i;
  while (a > 0 && hs[a - 1].prob >= corte && hs[a - 1].hora === hs[a].hora - 1) a--;
  while (b < hs.length - 1 && hs[b + 1].prob >= corte && hs[b + 1].hora === hs[b].hora + 1) b++;
  // Nunca menos de 2 horas: la lluvia puede adelantarse o atrasarse.
  if (b === a) {
    if (b < hs.length - 1 && hs[b + 1].hora === hs[b].hora + 1) b++;
    else if (a > 0) a--;
  }
  return { desde: hs[a].hora, hasta: hs[b].hora + 1, prob: pico };
}

// Agrupa horas lluviosas seguidas en franjas: [{desde: 15, hasta: 18}]
export function franjas(lluviosas) {
  const out = [];
  for (const x of lluviosas) {
    const ult = out[out.length - 1];
    if (ult && x.hora === ult.hasta) ult.hasta = x.hora + 1;
    else out.push({ desde: x.hora, hasta: x.hora + 1, prob: x.prob });
    out[out.length - 1].prob = Math.max(out[out.length - 1].prob, x.prob);
  }
  return out;
}

// ---------- Textos sencillos ----------

export function nombreHora(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const parte = h < 12 ? "de la mañana" : h < 19 ? "de la tarde" : "de la noche";
  if (h === 0 || h === 24) return "12 de la noche";
  if (h === 12) return "12 del mediodía";
  return `${h12} ${h >= 0 && h < 5 ? "de la madrugada" : parte}`;
}

export function horaCorta(h) {
  if (h === 0 || h === 24) return "12 a. m.";
  if (h === 12) return "12 p. m.";
  return h < 12 ? `${h} a. m.` : `${h - 12} p. m.`;
}

export function palabraProb(p, umbral) {
  if (p < umbral) return "No se espera lluvia";
  if (p < 0.4) return "Puede llover";
  if (p < 0.7) return "Lluvia probable";
  return "Lluvia muy probable";
}

export function porcentaje(p) {
  // Como el clima del iPhone: redondeado de 10 en 10, nunca 0 % ni 100 %.
  return `${Math.min(90, Math.max(10, Math.round(p * 10) * 10))} %`;
}

export function textoFranja(f) {
  return f.hasta - f.desde <= 1
    ? `cerca de las ${nombreHora(f.desde)}`
    : `entre las ${nombreHora(f.desde)} y las ${nombreHora(Math.min(24, f.hasta))}`;
}

export function frasePrincipal(dia, umbral, esHoy) {
  const cuando = esHoy ? "Hoy" : "Ese día";
  if (!dia.principal) return { titulo: `${cuando} no se espera lluvia`, detalle: "" };
  const f = dia.principal;
  return {
    titulo: `${palabraProb(f.prob, umbral)} ${textoFranja(f)}`,
    detalle: `Probabilidad: ${porcentaje(f.prob)}`,
  };
}

export function textoParaVoz(lugar, pron, ahora = new Date()) {
  const hoy = pron.dias[0];
  const man = pron.dias[1];
  const saludoH = Number(horaLimaActual(ahora).slice(11, 13));
  const saludo = saludoH < 12 ? "Buenos días" : saludoH < 19 ? "Buenas tardes" : "Buenas noches";
  const pct = (p) => porcentaje(p).replace(" %", " por ciento");
  const partes = [`${saludo}. Este es el pronóstico para ${lugar}.`];
  if (hoy?.principal) {
    const f = hoy.principal;
    partes.push(
      `Hoy ${palabraProb(f.prob, pron.umbral).toLowerCase()} ${textoFranja(f)}. ` +
        `La probabilidad es de ${pct(f.prob)}. Ten tu paraguas a la mano.`
    );
  } else if (hoy) partes.push("Hoy no se espera lluvia.");
  if (man?.principal) {
    const f = man.principal;
    partes.push(`Mañana ${palabraProb(f.prob, pron.umbral).toLowerCase()} ${textoFranja(f)}, con ${pct(f.prob)}.`);
  } else if (man) partes.push(hoy?.principal ? "Mañana no se espera lluvia." : "Mañana tampoco se espera lluvia.");
  partes.push("Que tengas un lindo día.");
  return partes.join(" ");
}
