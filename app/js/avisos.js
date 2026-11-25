// Avisos meteorológicos del SENAMHI.
// La página oficial permite que un navegador la lea (CORS abierto), así que cada celular la
// consulta directamente. Desde servidores del extranjero (como GitHub) SENAMHI no responde.

export const URL_LISTA = "https://www.senamhi.gob.pe/?p=aviso-meteorologico";
const BASE = "https://www.senamhi.gob.pe/";

const ES_LLUVIA = /PRECIPITAC|LLUVIA|LLOVIZNA|TORMENTA|CHUBASCO/;
const ES_NORTE = /NORTE|PIURA|TUMBES/;
const OTRA_ZONA = /CENTRO|SUR|SELVA|ORIENTE|ALTIPLANO/;

const limpiar = (s) =>
  s.replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&oacute;/g, "ó").replace(/&aacute;/g, "á").replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&Ntilde;/g, "Ñ").replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

// Lee la tabla oficial y devuelve los avisos de lluvia vigentes o por empezar que tocan el norte.
export function leerAvisos(html, hoy) {
  const avisos = [];
  const filas = html.match(/<tr[^>]*>\s*<td\s+class="(?:vigente|emitido)"[\s\S]*?<\/tr>/g) ?? [];
  for (const fila of filas) {
    const celdas = [...fila.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (celdas.length < 7) continue;
    const titulo = limpiar(celdas[0]).toUpperCase();
    const enlace = (celdas[0].match(/href="\.?\/?([^"]+)"/) ?? [])[1];
    const [inicio, fin] = [limpiar(celdas[3]), limpiar(celdas[4])];
    if (fin < hoy) continue;
    if (!ES_LLUVIA.test(titulo)) continue;
    if (!ES_NORTE.test(titulo) && OTRA_ZONA.test(titulo)) continue;
    avisos.push({
      numero: limpiar(celdas[1]).replace(/\D+$/, "").replace(/\s*\(.*$/, ""),
      titulo,
      inicio,
      fin,
      nivel: limpiar(celdas[6]).toUpperCase(),
      url: enlace ? BASE + enlace.replace(/&amp;/g, "&") : URL_LISTA,
    });
  }
  return avisos;
}

export function textoNivel(nivel) {
  return { AMARILLO: "amarillo", NARANJA: "naranja", ROJO: "rojo" }[nivel] ?? nivel.toLowerCase();
}
