import {
  urlPronostico, procesar, frasePrincipal, porcentaje, horaCorta, textoFranja, palabraProb,
  textoParaVoz, horaLimaActual,
} from "./motor.js";
import { svgIcono, nombreCielo } from "./iconos.js";
import { URL_LISTA, leerAvisos, textoNivel } from "./avisos.js";
import { CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
const guardado = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const guardar = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const hayServidor = () => Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnon);

let lugares = [];            // los 78 distritos
let pronActual = null;
const estado = {
  misLugares: guardado("vl_lugares", []),
  actual: guardado("vl_actual", 0),
  dispositivo: guardado("vl_dispositivo", null) ?? (() => {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);
    guardar("vl_dispositivo", id);
    return id;
  })(),
};

// ---------------- Servidor (Supabase) ----------------

async function supabase(ruta, cuerpo) {
  const r = await fetch(`${CONFIG.supabaseUrl}/rest/v1/${ruta}`, {
    method: cuerpo ? "POST" : "GET",
    headers: {
      apikey: CONFIG.supabaseAnon,
      "Content-Type": "application/json",
      // Las claves nuevas de Supabase (sb_publishable_...) van solo en "apikey".
      ...(CONFIG.supabaseAnon.startsWith("sb_") ? {} : { Authorization: `Bearer ${CONFIG.supabaseAnon}` }),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (!r.ok) throw new Error(`Servidor: ${r.status}`);
  const texto = await r.text();
  return texto ? JSON.parse(texto) : null;
}

// Lo que aprendió la app (pesos) y sus estadísticas de aciertos.
async function cargarCalibracion() {
  if (hayServidor()) {
    try {
      const filas = await supabase("publico?select=clave,valor");
      const datos = Object.fromEntries(filas.map((f) => [f.clave, f.valor]));
      if (datos.calibracion?.pesos) {
        guardar("vl_calib", datos.calibracion);
        if (datos.aciertos) guardar("vl_aciertos", datos.aciertos);
        return datos.calibracion;
      }
    } catch { /* se usa la copia local */ }
  }
  try {
    const c = await (await fetch("datos/calibracion.json", { cache: "no-cache" })).json();
    const previa = guardado("vl_calib", null);
    return previa && previa.actualizado > c.actualizado ? previa : c;
  } catch {
    return guardado("vl_calib", null);
  }
}

// ---------------- Lugares ----------------

function lugarActual() {
  if (!estado.misLugares.length) return null;
  if (estado.actual >= estado.misLugares.length) estado.actual = 0;
  return estado.misLugares[estado.actual];
}

function distanciaKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function masCercano(lat, lon) {
  let mejor = null, d = Infinity;
  for (const l of lugares) {
    const dd = distanciaKm({ lat, lon }, l);
    if (dd < d) { d = dd; mejor = l; }
  }
  return { lugar: mejor, km: d };
}

function agregarLugar(l) {
  const i = estado.misLugares.findIndex((x) => x.nombre === l.nombre && Math.abs(x.lat - l.lat) < 0.01);
  if (i >= 0) estado.actual = i;
  else {
    estado.misLugares.push({ nombre: l.nombre, detalle: l.detalle ?? "", lat: l.lat, lon: l.lon, gps: !!l.gps });
    if (estado.misLugares.length > 8) estado.misLugares.shift();
    estado.actual = estado.misLugares.length - 1;
  }
  guardar("vl_lugares", estado.misLugares);
  guardar("vl_actual", estado.actual);
}

function usarGps(silencioso = false) {
  return new Promise((resolver) => {
    if (!navigator.geolocation) return resolver(false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const { lugar, km } = masCercano(lat, lon);
        const nombre = lugar && km < 25 ? lugar.nombre : "Mi ubicación";
        estado.misLugares = estado.misLugares.filter((x) => !x.gps);
        agregarLugar({ nombre, detalle: "Donde estoy ahora", lat, lon, gps: true });
        resolver(true);
      },
      () => {
        if (!silencioso) alert("No pudimos saber dónde estás. Revisa que la ubicación esté activada o elige un lugar de la lista.");
        resolver(false);
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

// ---------------- Pronóstico ----------------

const claveCache = (l) => `vl_pron_${l.lat.toFixed(2)}_${l.lon.toFixed(2)}`;

async function actualizar() {
  const lugar = lugarActual();
  if (!lugar) return abrirHoja();
  $("lugar-nombre").textContent = lugar.nombre;

  const copia = guardado(claveCache(lugar), null);
  if (copia) mostrar(copia.pron, lugar, copia.cuando, true);

  try {
    const calib = await cargarCalibracion();
    const r = await fetch(urlPronostico(lugar.lat, lugar.lon));
    if (!r.ok) throw new Error("pronóstico");
    const pron = procesar(await r.json(), calib, lugar.lat, lugar.lon);
    const cuando = new Date().toISOString();
    guardar(claveCache(lugar), { pron, cuando });
    mostrar(pron, lugar, cuando, false);
    actualizarSuscripcion(); // si cambió de lugar, el servidor avisa para el lugar nuevo
  } catch {
    const aviso = $("sin-internet");
    aviso.hidden = false;
    aviso.textContent = copia
      ? `Sin internet. Te mostramos el pronóstico guardado de ${horaLegible(copia.cuando)}.`
      : "Sin internet y aún no hay un pronóstico guardado para este lugar. Conéctate un momento.";
  }
  cargarAvisosSenamhi();
}

function horaLegible(iso) {
  const d = new Date(iso);
  const hoy = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("es-PE", { hour: "numeric", minute: "2-digit", timeZone: "America/Lima" });
  return hoy ? `hoy a las ${hora}` : `${d.toLocaleDateString("es-PE", { weekday: "long", day: "numeric", timeZone: "America/Lima" })} a las ${hora}`;
}

function nombreDia(fecha, i) {
  if (i === 0) return "Hoy";
  if (i === 1) return "Mañana";
  return DIAS_SEMANA[new Date(fecha + "T12:00:00").getDay()];
}

function mostrar(pron, lugar, cuando, esCopia) {
  pronActual = { pron, lugar };
  // Quitar horas ya pasadas de una copia antigua.
  const ahora = horaLimaActual();
  const horas = pron.horas.filter((h) => h.t >= ahora);
  const dias = pron.dias.filter((d) => d.fecha >= ahora.slice(0, 10));
  if (!horas.length || !dias.length) return;
  const h0 = horas[0];
  const hoy = dias[0];

  if (!esCopia) $("sin-internet").hidden = true;
  $("lugar-nombre").textContent = lugar.nombre;
  $("temp-actual").textContent = h0.temp !== null ? `${Math.round(h0.temp)}°` : "--°";
  $("cielo-actual").textContent = nombreCielo(h0.icono);
  $("max-min").textContent = hoy.tMax !== null ? `Máx. ${Math.round(hoy.tMax)}°  Mín. ${Math.round(hoy.tMin)}°` : "";

  document.body.className =
    h0.icono === "lluvia" ? "cielo-lluvia" : !h0.esDia ? "cielo-noche" : h0.icono === "nube" ? "cielo-nube" : "cielo-sol";

  // Tarjeta principal: ¿va a llover hoy?
  const frase = frasePrincipal(hoy, pron.umbral, true);
  $("icono-principal").innerHTML = svgIcono(hoy.principal ? "lluvia" : hoy.icono, 64);
  $("frase-titulo").textContent = frase.titulo;
  $("frase-detalle").textContent = frase.detalle;
  const man = dias[1];
  if (man) {
    const fm = frasePrincipal(man, pron.umbral, false);
    $("frase-manana").textContent = man.principal
      ? `Mañana: ${fm.titulo.charAt(0).toLowerCase() + fm.titulo.slice(1)} (${porcentaje(man.principal.prob)})`
      : "Mañana: no se espera lluvia";
  }

  // Hora por hora (24 horas)
  $("horas").innerHTML = horas.slice(0, 25).map((h, i) => `
    <div class="hora${i === 0 ? " ahora" : ""}">
      <span class="h">${i === 0 ? "Ahora" : horaCorta(h.hora)}</span>
      ${svgIcono(h.icono, 40)}
      <span class="p">${h.prob >= pron.umbral ? porcentaje(h.prob) : ""}</span>
      <span class="t">${h.temp !== null ? Math.round(h.temp) + "°" : ""}</span>
    </div>`).join("");

  // Días
  const tMin = Math.min(...dias.map((d) => d.tMin ?? 99));
  const tMax = Math.max(...dias.map((d) => d.tMax ?? -99));
  const esc = (v) => ((v - tMin) / Math.max(1, tMax - tMin)) * 100;
  $("dias").innerHTML = dias.slice(0, 4).map((d, i) => {
    const fr = d.principal;
    return `
    <div class="dia">
      <span class="nombre">${nombreDia(d.fecha, i)}</span>
      ${svgIcono(d.icono, 38)}
      <span class="p">${fr ? porcentaje(fr.prob) : ""}</span>
      <span class="rango">
        <span class="min">${d.tMin !== null ? Math.round(d.tMin) + "°" : ""}</span>
        <span class="barra"><i style="left:${esc(d.tMin)}%;right:${100 - esc(d.tMax)}%"></i></span>
        <span>${d.tMax !== null ? Math.round(d.tMax) + "°" : ""}</span>
      </span>
      ${fr ? `<span class="franja">${palabraProb(fr.prob, pron.umbral)} ${textoFranja(fr)}</span>` : ""}
    </div>`;
  }).join("");

  $("actualizado").textContent = `Actualizado ${horaLegible(cuando)} · Se actualiza sola cada 15 minutos`;
}

// ---------------- Avisos del SENAMHI ----------------

async function cargarAvisosSenamhi() {
  const hoy = horaLimaActual().slice(0, 10);
  let cache = guardado("vl_senamhi", null);
  const viejo = !cache || Date.now() - cache.ts > 30 * 60 * 1000;
  if (viejo) {
    try {
      const html = await (await fetch(URL_LISTA)).text();
      cache = { ts: Date.now(), avisos: leerAvisos(html, hoy) };
      guardar("vl_senamhi", cache);
    } catch { /* se muestra lo último que se leyó */ }
  }
  const avisos = (cache?.avisos ?? []).filter((a) => a.fin >= hoy);
  $("avisos-senamhi").innerHTML = avisos.map((a) => `
    <a class="senamhi ${a.nivel}" href="${a.url}" target="_blank" rel="noopener">
      <strong>Aviso ${textoNivel(a.nivel)} del SENAMHI</strong>
      <span>${a.titulo.charAt(0) + a.titulo.slice(1).toLowerCase()}. Del ${fechaCorta(a.inicio)} al ${fechaCorta(a.fin)}. Toca para leerlo.</span>
    </a>`).join("");
}

function fechaCorta(f) {
  return new Date(f + "T12:00:00").toLocaleDateString("es-PE", { weekday: "long", day: "numeric" });
}

// ---------------- Voz amigable ----------------

function elegirVoz() {
  const voces = speechSynthesis.getVoices().filter((v) => v.lang?.toLowerCase().startsWith("es"));
  const preferidas = [/paulina/i, /m[oó]nica/i, /google.*(estados unidos|united states)/i, /es-(us|mx|419|pe)/i, /google.*español/i, /natural/i];
  for (const p of preferidas) {
    const v = voces.find((x) => p.test(x.name) || p.test(x.lang));
    if (v) return v;
  }
  return voces[0] ?? null;
}

function escuchar() {
  if (!("speechSynthesis" in window)) return alert("Este celular no puede leer en voz alta.");
  if (!pronActual) return;
  speechSynthesis.cancel();
  const texto = textoParaVoz(pronActual.lugar.nombre, pronActual.pron);
  const u = new SpeechSynthesisUtterance(texto);
  u.lang = "es-PE";
  const voz = elegirVoz();
  if (voz) { u.voice = voz; u.lang = voz.lang; }
  u.rate = 0.92;   // un poco más lento, para que se entienda bien
  u.pitch = 1.08;  // un tono un poco más cálido
  speechSynthesis.speak(u);
}

// ---------------- Reportes de la familia ----------------

async function reportar(llueve) {
  const lugar = lugarActual();
  if (!lugar) return;
  const ultimo = guardado("vl_ultimo_reporte", 0);
  const gracias = $("reporte-gracias");
  gracias.hidden = false;
  if (Date.now() - ultimo < 20 * 60 * 1000) {
    gracias.textContent = "Ya recibimos tu reporte hace poco. Puedes enviar otro en unos minutos.";
    return;
  }
  const reporte = {
    p_lat: Number(lugar.lat.toFixed(2)),
    p_lon: Number(lugar.lon.toFixed(2)),
    p_lugar: lugar.nombre,
    p_llueve: llueve,
    p_dispositivo: estado.dispositivo,
    p_momento: new Date().toISOString(),
  };
  const pendientes = guardado("vl_reportes_pendientes", []);
  pendientes.push(reporte);
  guardar("vl_reportes_pendientes", pendientes);
  guardar("vl_ultimo_reporte", Date.now());
  const enviados = await enviarPendientes();
  gracias.textContent = enviados
    ? `¡Gracias! Tu reporte ayuda a que el pronóstico de ${lugar.nombre} sea más exacto para todos.`
    : `¡Gracias! Guardamos tu reporte y lo enviaremos cuando haya internet.`;
}

async function enviarPendientes() {
  if (!hayServidor()) return false;
  const pendientes = guardado("vl_reportes_pendientes", []);
  const quedan = [];
  for (const r of pendientes) {
    try { await supabase("rpc/guardar_reporte", r); } catch { quedan.push(r); }
  }
  guardar("vl_reportes_pendientes", quedan);
  return quedan.length === 0;
}

function mostrarEstadisticas() {
  const a = guardado("vl_aciertos", null);
  $("estadisticas").textContent = a?.reportes
    ? `En los últimos 30 días la familia envió ${a.reportes} reportes. Cuando llovió, VillaLluvia lo había anunciado ${a.lluvias_anunciadas} de ${a.lluvias} veces. Última corrección: ${horaLegible(a.actualizado)}.`
    : "Aún no hay suficientes reportes para medir los aciertos. ¡El tuyo puede ser el primero!";
}

// ---------------- Avisos al celular (notificaciones) ----------------

const esIphone = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const estaInstalada = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function base64AUint8(b64) {
  const p = "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob((b64 + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function actualizarSuscripcion() {
  try {
    const sub = await suscripcionActual();
    const lugar = lugarActual();
    if (!sub || !lugar || !hayServidor()) return;
    const j = sub.toJSON();
    await supabase("rpc/guardar_suscripcion", {
      p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth,
      p_lat: Number(lugar.lat.toFixed(2)), p_lon: Number(lugar.lon.toFixed(2)),
      p_lugar: lugar.nombre, p_dispositivo: estado.dispositivo,
    });
  } catch { /* se reintenta en la próxima actualización */ }
}

async function pintarBotonAvisos() {
  const sub = await suscripcionActual().catch(() => null);
  $("txt-avisos").textContent = sub ? "Avisos activos" : "Activar avisos";
}

async function activarAvisos() {
  if (esIphone() && !estaInstalada()) {
    mostrarInstalar(true);
    return alert("En iPhone, primero agrega VillaLluvia a tu pantalla de inicio (abajo te explicamos cómo). Luego ábrela desde su ícono y activa los avisos.");
  }
  if (!("PushManager" in window) || !("serviceWorker" in navigator)) {
    return alert("Este celular o navegador no permite avisos. Prueba con Chrome en Android o instalando la app en iPhone.");
  }
  if (!hayServidor() || !CONFIG.vapidPublica) {
    return alert("Los avisos se activarán cuando termine la configuración del servidor.");
  }
  const actual = await suscripcionActual();
  if (actual) {
    if (confirm("¿Quieres dejar de recibir avisos de lluvia?")) {
      await supabase("rpc/borrar_suscripcion", { p_endpoint: actual.endpoint }).catch(() => {});
      await actual.unsubscribe();
    }
    return pintarBotonAvisos();
  }
  const permiso = await Notification.requestPermission();
  if (permiso !== "granted") return alert("Para recibir avisos, permite las notificaciones de VillaLluvia en los ajustes del celular.");
  const reg = await navigator.serviceWorker.ready;
  await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64AUint8(CONFIG.vapidPublica) });
  await actualizarSuscripcion();
  await pintarBotonAvisos();
  alert("¡Listo! Te avisaremos 1 hora antes de que llueva y cada mañana a las 6 con el resumen del día.");
}

// ---------------- Instalar en la pantalla de inicio ----------------

let eventoInstalar = null;
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  eventoInstalar = e;
  mostrarInstalar();
});

function mostrarInstalar(forzar = false) {
  if (estaInstalada()) return;
  const t = $("instalar");
  if (esIphone()) {
    t.innerHTML = `<h2 class="titulo-tarjeta">Ponla en tu pantalla de inicio</h2>
      <p class="nota">1. Toca el botón <strong>Compartir</strong> (el cuadrito con flecha hacia arriba).<br>
      2. Elige <strong>"Agregar a inicio"</strong>.<br>3. Abre VillaLluvia desde su nuevo ícono.</p>`;
    t.hidden = false;
  } else if (eventoInstalar) {
    t.innerHTML = `<h2 class="titulo-tarjeta">Ponla en tu pantalla de inicio</h2>
      <button class="boton boton-ancho" id="btn-instalar">Instalar VillaLluvia</button>`;
    t.hidden = false;
    $("btn-instalar").onclick = async () => { eventoInstalar.prompt(); await eventoInstalar.userChoice; t.hidden = true; };
  } else if (forzar) {
    t.innerHTML = `<p class="nota">Abre el menú del navegador (⋮) y elige <strong>"Agregar a pantalla de inicio"</strong>.</p>`;
    t.hidden = false;
  }
}

// ---------------- Hoja de lugares ----------------

function abrirHoja() {
  pintarMisLugares();
  $("buscar").value = "";
  pintarResultados("");
  $("hoja-lugares").hidden = false;
}
function cerrarHoja() {
  if (!estado.misLugares.length) return; // la primera vez hay que elegir un lugar
  $("hoja-lugares").hidden = true;
}

function pintarMisLugares() {
  const ul = $("mis-lugares");
  if (!estado.misLugares.length) {
    ul.innerHTML = `<li><span style="padding:14px">Aún no tienes lugares guardados.</span></li>`;
    return;
  }
  ul.innerHTML = estado.misLugares.map((l, i) => `
    <li class="${i === estado.actual ? "activo" : ""}">
      <button class="elegir" data-i="${i}">${l.nombre}<small>${l.detalle || ""}</small></button>
      <button class="quitar" data-quitar="${i}" aria-label="Quitar ${l.nombre}">Quitar</button>
    </li>`).join("");
}

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
let temporizadorBusqueda = null;

function pintarResultados(texto) {
  const q = sinTildes(texto.trim());
  const locales = lugares.filter((l) => !q || sinTildes(l.nombre).includes(q) || sinTildes(l.provincia).includes(q));
  const ul = $("resultados");
  ul.innerHTML = locales.slice(0, q ? 30 : 78).map((l) => `
    <li><button class="elegir" data-lugar='${JSON.stringify({ nombre: l.nombre, detalle: `${l.provincia}, ${l.region}`, lat: l.lat, lon: l.lon })}'>
      ${l.nombre}<small>Provincia de ${l.provincia}, ${l.region}</small></button></li>`).join("");
  clearTimeout(temporizadorBusqueda);
  if (q.length >= 3) temporizadorBusqueda = setTimeout(() => buscarEnInternet(texto.trim(), locales.length), 500);
}

// Caseríos y centros poblados que no están en la lista de distritos.
async function buscarEnInternet(texto, yaHay) {
  try {
    const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(texto)}&count=20&language=es&countryCode=PE`)).json();
    const extra = (r.results ?? [])
      .filter((c) => /Piura|Tumbes/.test(c.admin1 ?? ""))
      .filter((c) => !lugares.some((l) => sinTildes(l.nombre) === sinTildes(c.name) && Math.abs(l.lat - c.latitude) < 0.05));
    if ($("buscar").value.trim() !== texto || !extra.length) return;
    $("resultados").insertAdjacentHTML("beforeend", extra.slice(0, 10).map((c) => `
      <li><button class="elegir" data-lugar='${JSON.stringify({ nombre: c.name, detalle: [c.admin3, c.admin2, c.admin1].filter(Boolean).join(", "), lat: c.latitude, lon: c.longitude }).replace(/'/g, "&#39;")}'>
        ${c.name}<small>${[c.admin3, c.admin2, c.admin1].filter(Boolean).join(", ")}</small></button></li>`).join(""));
  } catch { /* sin internet: solo la lista local */ }
}

// ---------------- Arranque ----------------

async function iniciar() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  try { lugares = await (await fetch("datos/lugares.json")).json(); } catch { lugares = []; }

  $("btn-lugar").onclick = abrirHoja;
  $("btn-cerrar-hoja").onclick = cerrarHoja;
  $("hoja-lugares").onclick = (e) => { if (e.target.id === "hoja-lugares") cerrarHoja(); };
  $("btn-escuchar").onclick = escuchar;
  $("btn-avisos").onclick = () => activarAvisos().catch(() => alert("No se pudo activar los avisos. Inténtalo de nuevo."));
  $("buscar").oninput = (e) => pintarResultados(e.target.value);
  $("btn-gps").onclick = async () => { if (await usarGps()) { $("hoja-lugares").hidden = true; actualizar(); } };
  document.querySelectorAll(".boton-reporte").forEach((b) => (b.onclick = () => reportar(b.dataset.llueve === "1")));
  document.addEventListener("click", (e) => {
    const elegir = e.target.closest("button.elegir");
    const quitar = e.target.closest("button.quitar");
    if (quitar) {
      estado.misLugares.splice(Number(quitar.dataset.quitar), 1);
      estado.actual = 0;
      guardar("vl_lugares", estado.misLugares);
      guardar("vl_actual", 0);
      return pintarMisLugares();
    }
    if (!elegir) return;
    if (elegir.dataset.i !== undefined) {
      estado.actual = Number(elegir.dataset.i);
      guardar("vl_actual", estado.actual);
    } else agregarLugar(JSON.parse(elegir.dataset.lugar));
    $("hoja-lugares").hidden = true;
    actualizar();
  });
  if ("speechSynthesis" in window) speechSynthesis.getVoices();

  if (!estado.misLugares.length) {
    // Primera vez: intentar con el GPS; si no, que elija de la lista.
    const ok = await usarGps(true);
    if (!ok) return abrirHoja();
  }
  await actualizar();
  mostrarInstalar();
  mostrarEstadisticas();
  pintarBotonAvisos();
  enviarPendientes();

  // Se actualiza solo: cada 15 minutos y cada vez que vuelves a abrir la app.
  setInterval(actualizar, 15 * 60 * 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) actualizar(); });
  addEventListener("online", () => { actualizar(); enviarPendientes(); });
}

iniciar();
