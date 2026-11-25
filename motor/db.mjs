// Acceso a la base de datos (Supabase). Sin configuración, usa un archivo local para pruebas.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const URL_DB = process.env.SUPABASE_URL;
const CLAVE = process.env.SUPABASE_SECRET;

function cabeceras(extra = {}) {
  const h = { apikey: CLAVE, "Content-Type": "application/json", ...extra };
  // Las claves nuevas de Supabase (sb_...) van solo en "apikey"; las antiguas (JWT) también como Bearer.
  if (!CLAVE.startsWith("sb_")) h.Authorization = `Bearer ${CLAVE}`;
  return h;
}

async function rest(ruta, { metodo = "GET", cuerpo, extra } = {}) {
  const r = await fetch(`${URL_DB}/rest/v1/${ruta}`, {
    method: metodo,
    headers: cabeceras(extra),
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  if (!r.ok) throw new Error(`Supabase ${metodo} ${ruta.split("?")[0]}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

async function todo(ruta) {
  const out = [];
  for (let desde = 0; ; desde += 1000) {
    const lote = await rest(`${ruta}${ruta.includes("?") ? "&" : "?"}limit=1000&offset=${desde}`);
    out.push(...lote);
    if (lote.length < 1000) return out;
  }
}

const supabase = {
  nombre: "Supabase",
  suscripciones: () => todo("suscripciones?select=*"),
  actualizarSuscripcion: (endpoint, campos) =>
    rest(`suscripciones?endpoint=eq.${encodeURIComponent(endpoint)}`, { metodo: "PATCH", cuerpo: campos }),
  borrarSuscripcion: (endpoint) =>
    rest(`suscripciones?endpoint=eq.${encodeURIComponent(endpoint)}`, { metodo: "DELETE" }),
  reportesPendientes: () => todo("reportes?select=*&procesado=eq.false&order=momento.asc"),
  reportesDesde: (iso) => todo(`reportes?select=*&momento=gte.${iso}`),
  marcarReportes: async (ids, prob) => {
    for (const id of ids) await rest(`reportes?id=eq.${id}`, { metodo: "PATCH", cuerpo: { procesado: true, prob_anunciada: prob[id] ?? null } });
  },
  agregarEjemplos: async (filas) => {
    for (let i = 0; i < filas.length; i += 500) await rest("ejemplos", { metodo: "POST", cuerpo: filas.slice(i, i + 500) });
  },
  ejemplos: () => todo("ejemplos?select=x,y,peso,zona,fuente,momento"),
  podarEjemplos: (iso) => rest(`ejemplos?fuente=eq.aeropuerto&momento=lt.${iso}`, { metodo: "DELETE" }),
  leerPublico: async (clave) => (await rest(`publico?select=valor&clave=eq.${clave}`))[0]?.valor ?? null,
  guardarPublico: (clave, valor) =>
    rest("publico", {
      metodo: "POST",
      cuerpo: { clave, valor, actualizado: new Date().toISOString() },
      extra: { Prefer: "resolution=merge-duplicates" },
    }),
};

// ---- Versión local (para probar sin internet ni cuentas) ----
const ARCHIVO = new URL("./.local/db.json", import.meta.url);
async function cargar() {
  if (!existsSync(ARCHIVO)) return { suscripciones: [], reportes: [], ejemplos: [], publico: {} };
  return JSON.parse(await readFile(ARCHIVO, "utf8"));
}
async function salvar(d) {
  await mkdir(new URL("./.local/", import.meta.url), { recursive: true });
  await writeFile(ARCHIVO, JSON.stringify(d));
}
const local = {
  nombre: "archivo local de prueba",
  suscripciones: async () => (await cargar()).suscripciones,
  actualizarSuscripcion: async (endpoint, campos) => {
    const d = await cargar();
    d.suscripciones = d.suscripciones.map((s) => (s.endpoint === endpoint ? { ...s, ...campos } : s));
    await salvar(d);
  },
  borrarSuscripcion: async (endpoint) => {
    const d = await cargar();
    d.suscripciones = d.suscripciones.filter((s) => s.endpoint !== endpoint);
    await salvar(d);
  },
  reportesPendientes: async () => (await cargar()).reportes.filter((r) => !r.procesado),
  reportesDesde: async (iso) => (await cargar()).reportes.filter((r) => r.momento >= iso),
  marcarReportes: async (ids, prob) => {
    const d = await cargar();
    d.reportes = d.reportes.map((r) => (ids.includes(r.id) ? { ...r, procesado: true, prob_anunciada: prob[r.id] ?? null } : r));
    await salvar(d);
  },
  agregarEjemplos: async (filas) => {
    const d = await cargar();
    d.ejemplos.push(...filas);
    await salvar(d);
  },
  ejemplos: async () => (await cargar()).ejemplos,
  podarEjemplos: async (iso) => {
    const d = await cargar();
    d.ejemplos = d.ejemplos.filter((e) => e.fuente !== "aeropuerto" || e.momento >= iso);
    await salvar(d);
  },
  leerPublico: async (clave) => (await cargar()).publico[clave] ?? null,
  guardarPublico: async (clave, valor) => {
    const d = await cargar();
    d.publico[clave] = valor;
    await salvar(d);
  },
};

export const db = URL_DB && CLAVE ? supabase : local;
