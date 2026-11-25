// Corre cada 10 minutos en GitHub Actions.
// - Avisa 1 hora antes de que llueva en el lugar de cada persona.
// - Suena solo cuando la lluvia es probable (50 % o más), también de madrugada.
// - A las 6 a. m. envía el resumen del día.
// - Si el SENAMHI emite un aviso de lluvias para el norte, lo reenvía (si GitHub logra leerlo).
//
// Prueba sin enviar nada:  node motor/notificar.mjs --simular
import { readFile } from "node:fs/promises";
import {
  urlPronostico, procesar, horaLimaActual, porcentaje, palabraProb, nombreHora, frasePrincipal, textoFranja,
} from "../app/js/motor.js";
import { URL_LISTA, leerAvisos, textoNivel } from "../app/js/avisos.js";
import { db } from "./db.mjs";
import { traer } from "./fuentes.mjs";

const SIMULAR = process.argv.includes("--simular");
const HORAS_ENTRE_AVISOS = 3;
const URL_APP = process.env.URL_APP || "./";

// En GitHub, sin las claves configuradas todavía, no hay nada que hacer (y no es un error).
if (!SIMULAR && (!process.env.SUPABASE_URL || !process.env.VAPID_PRIVADA)) {
  console.log("Faltan las claves de Supabase o de notificaciones (ver INSTRUCCIONES.md). Nada que enviar por ahora.");
  process.exit(0);
}

let webpush = null;
if (!SIMULAR) {
  webpush = (await import("web-push")).default;
  webpush.setVapidDetails("mailto:avisos@villalluvia.invalid", process.env.VAPID_PUBLICA, process.env.VAPID_PRIVADA);
}

async function enviar(sub, mensaje) {
  if (SIMULAR) {
    console.log(`  → [${sub.lugar}] ${mensaje.titulo} | ${mensaje.cuerpo}`);
    return true;
  }
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify({ ...mensaje, url: URL_APP }),
      { TTL: 3600, urgency: "high" }
    );
    return true;
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) {
      await db.borrarSuscripcion(sub.endpoint); // el celular ya no existe o desinstaló la app
      console.log(`  suscripción vencida borrada (${sub.lugar})`);
    } else console.log(`  error al enviar a ${sub.lugar}: ${e.statusCode ?? ""} ${e.message}`);
    return false;
  }
}

async function calibracion() {
  return (await db.leerPublico("calibracion")) ??
    JSON.parse(await readFile(new URL("../app/datos/calibracion.json", import.meta.url), "utf8"));
}

const ahora = new Date();
const horaLima = horaLimaActual(ahora);
const hoy = horaLima.slice(0, 10);
const h = Number(horaLima.slice(11, 13));
const esMadrugada = h >= 22 || h < 6;
const calib = await calibracion();
const subs = await db.suscripciones();
console.log(`${horaLima} (Lima). ${subs.length} celulares suscritos. Base de datos: ${db.nombre}.`);

// Agrupar por lugar para pedir cada pronóstico una sola vez.
const grupos = new Map();
for (const s of subs) {
  const k = `${Number(s.lat).toFixed(2)},${Number(s.lon).toFixed(2)}`;
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(s);
}

for (const [k, lista] of grupos) {
  const [lat, lon] = k.split(",").map(Number);
  let pron;
  try {
    pron = procesar(await traer(urlPronostico(lat, lon), { json: true, intentos: 3 }), calib, lat, lon, ahora);
  } catch (e) {
    console.log(`Sin pronóstico para ${lista[0].lugar}: ${e.message}`);
    continue;
  }
  const [actual, sig1, sig2] = pron.horas;
  const proxima = [sig1, sig2].filter(Boolean).reduce((a, b) => (b.prob > a.prob ? b : a), { prob: 0 });
  const minimo = Math.max(pron.umbral, esMadrugada ? calib.umbral_madrugada ?? 0.25 : calib.umbral_notificacion ?? 0.1);
  const llegaLluvia = proxima.prob >= minimo && (actual?.prob ?? 0) < proxima.prob;
  console.log(`${lista[0].lugar}: ahora ${porcentaje(actual?.prob ?? 0)}, próximas 2 h ${porcentaje(proxima.prob)} (aviso desde ${Math.round(minimo * 100)} %)`);

  for (const sub of lista) {
    // 1) Aviso 1 hora antes
    const ultimo = sub.ultimo_aviso ? Date.parse(sub.ultimo_aviso) : 0;
    if (llegaLluvia && ahora - ultimo > HORAS_ENTRE_AVISOS * 3600000) {
      const ok = await enviar(sub, {
        titulo: `🌧️ Lluvia en ${sub.lugar} en 1 hora aprox.`,
        cuerpo: `${palabraProb(proxima.prob, pron.umbral)} cerca de las ${nombreHora(proxima.hora)} (${porcentaje(proxima.prob)}). Ten tu paraguas a la mano.`,
        etiqueta: "lluvia",
      });
      if (ok && !SIMULAR) await db.actualizarSuscripcion(sub.endpoint, { ultimo_aviso: ahora.toISOString() });
    }

    // 2) Resumen de las 6 a. m. (si GitHub se retrasa, sale apenas pueda, hasta las 10 a. m.)
    if (h >= 6 && h < 10 && sub.ultimo_resumen !== hoy) {
      const dHoy = pron.dias.find((d) => d.fecha === hoy);
      const dMan = pron.dias.find((d) => d.fecha > hoy);
      const fh = dHoy ? frasePrincipal(dHoy, pron.umbral, true) : { titulo: "", detalle: "" };
      const man = dMan?.principal
        ? `Mañana: ${palabraProb(dMan.principal.prob, pron.umbral).toLowerCase()} ${textoFranja(dMan.principal)}.`
        : "Mañana no se espera lluvia.";
      const ok = await enviar(sub, {
        titulo: `☀️ Buenos días. ${sub.lugar} hoy`,
        cuerpo: `${fh.titulo}${fh.detalle ? ` (${fh.detalle.replace("Probabilidad: ", "")})` : ""}. ${man}`,
        etiqueta: "resumen",
      });
      if (ok && !SIMULAR) await db.actualizarSuscripcion(sub.endpoint, { ultimo_resumen: hoy });
    }
  }
}

// 3) Avisos del SENAMHI. Puede fallar: SENAMHI suele bloquear servidores del extranjero.
try {
  const html = await Promise.race([
    traer(URL_LISTA, { intentos: 1 }),
    new Promise((_, no) => setTimeout(() => no(new Error("tiempo agotado")), 25000)),
  ]);
  const avisos = leerAvisos(html, hoy);
  const yaEnviados = (await db.leerPublico("avisos_enviados")) ?? [];
  const nuevos = avisos.filter((a) => !yaEnviados.includes(`${a.numero}-${a.inicio}`));
  for (const a of nuevos) {
    console.log(`Aviso nuevo del SENAMHI: ${a.numero} ${a.nivel}`);
    for (const sub of subs) {
      await enviar(sub, {
        titulo: `⚠️ Aviso ${textoNivel(a.nivel)} del SENAMHI`,
        cuerpo: `${a.titulo.charAt(0) + a.titulo.slice(1).toLowerCase()}. Del ${a.inicio} al ${a.fin}.`,
        etiqueta: `senamhi-${a.numero}`,
      });
    }
  }
  if (nuevos.length && !SIMULAR) {
    await db.guardarPublico("avisos_enviados", [...yaEnviados, ...nuevos.map((a) => `${a.numero}-${a.inicio}`)].slice(-50));
  }
  await db.guardarPublico("senamhi_estado", { ok: true, revisado: ahora.toISOString(), avisos: avisos.length });
} catch (e) {
  console.log(`No se pudo leer el SENAMHI desde aquí (${e.message}). La app lo lee directamente desde cada celular.`);
}
