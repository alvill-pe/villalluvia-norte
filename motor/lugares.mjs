// Genera app/datos/lugares.json: los 78 distritos de Piura y Tumbes con coordenadas.
//   node motor/lugares.mjs
import { writeFile } from "node:fs/promises";
import { traer } from "./fuentes.mjs";

const DISTRITOS = {
  Tumbes: {
    Tumbes: ["Tumbes", "Corrales", "La Cruz", "Pampas de Hospital", "San Jacinto", "San Juan de la Virgen"],
    "Contralmirante Villar": ["Zorritos", "Casitas", "Canoas de Punta Sal"],
    Zarumilla: ["Zarumilla", "Aguas Verdes", "Matapalo", "Papayal"],
  },
  Piura: {
    Piura: ["Piura", "Castilla", "Catacaos", "Cura Mori", "El Tallán", "La Arena", "La Unión", "Las Lomas", "Tambo Grande", "Veintiséis de Octubre"],
    Ayabaca: ["Ayabaca", "Frías", "Jililí", "Lagunas", "Montero", "Pacaipampa", "Paimas", "Sapillica", "Sicchez", "Suyo"],
    Huancabamba: ["Huancabamba", "Canchaque", "El Carmen de la Frontera", "Huarmaca", "Lalaquiz", "San Miguel de El Faique", "Sondor", "Sondorillo"],
    Morropón: ["Chulucanas", "Buenos Aires", "Chalaco", "La Matanza", "Morropón", "Salitral", "San Juan de Bigote", "Santa Catalina de Mossa", "Santo Domingo", "Yamango"],
    Paita: ["Paita", "Amotape", "Arenal", "Colán", "La Huaca", "Tamarindo", "Vichayal"],
    Sullana: ["Sullana", "Bellavista", "Ignacio Escudero", "Lancones", "Marcavelica", "Miguel Checa", "Querecotillo", "Salitral"],
    Talara: ["Talara", "El Alto", "Negritos", "Lobitos", "Los Órganos", "Máncora"],
    Sechura: ["Sechura", "Bellavista de la Unión", "Bernal", "Cristo Nos Valga", "Rinconada Llicuar", "Vice"],
  },
};

// Nombres con que GeoNames conoce algunos pueblos (capital del distrito).
const ALIAS = {
  "Tambo Grande": ["Tambogrande"],
  "Veintiséis de Octubre": ["Veintiseis de Octubre", "Piura"],
  "El Tallán": ["Sinchao", "Chatito"],
  "Cura Mori": ["Cucungara", "Cura Mori"],
  "Canoas de Punta Sal": ["Canoas de Punta Sal", "Cancas"],
  "Contralmirante Villar": [],
  "Rinconada Llicuar": ["Rinconada Llicuar", "Llicuar"],
  "Bellavista de la Unión": ["Bellavista de la Union", "Bellavista"],
  "Cristo Nos Valga": ["Cristo Nos Valga", "San Cristo"],
  "Ignacio Escudero": ["Ignacio Escudero", "San Jacinto"],
  "Miguel Checa": ["Sojo", "Miguel Checa"],
  "Santa Catalina de Mossa": ["Paltashaco", "Santa Catalina de Mossa"],
  "San Juan de Bigote": ["Bigote", "San Juan de Bigote"],
  "San Miguel de El Faique": ["El Faique", "San Miguel de El Faique"],
  "El Carmen de la Frontera": ["Sapalache", "El Carmen de la Frontera"],
  "La Matanza": ["La Matanza"],
  "Pampas de Hospital": ["Pampas de Hospital"],
  "San Juan de la Virgen": ["San Juan de la Virgen"],
  Jililí: ["Jilili"],
  Frías: ["Frias"],
  Lagunas: ["Lagunas"],
};

// Caja que cubre Tumbes y Piura.
const dentro = (r) => r.latitude > -6.45 && r.latitude < -3.35 && r.longitude > -81.4 && r.longitude < -79.1;

const lugares = [];
const fallas = [];
for (const [region, provincias] of Object.entries(DISTRITOS)) {
  for (const [provincia, distritos] of Object.entries(provincias)) {
    for (const d of distritos) {
      let hallado = null;
      for (const nombre of [...(ALIAS[d] ?? []), d]) {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nombre)}&count=20&language=es&countryCode=PE`;
        const r = await traer(url, { json: true });
        const cands = (r.results ?? []).filter((c) => dentro(c) && (c.admin1 ?? "").includes(region));
        // Preferir el que esté en la provincia correcta y sea capital o centro poblado.
        cands.sort((a, b) => {
          const pa = (a.admin2 ?? "").includes(provincia) ? 0 : 1;
          const pb = (b.admin2 ?? "").includes(provincia) ? 0 : 1;
          const fa = (a.feature_code ?? "").startsWith("PPL") ? 0 : 1;
          const fb = (b.feature_code ?? "").startsWith("PPL") ? 0 : 1;
          return pa - pb || fa - fb || (b.population ?? 0) - (a.population ?? 0);
        });
        const mejor = cands.find((c) => (c.admin2 ?? "").includes(provincia)) ?? null;
        if (mejor) {
          hallado = mejor;
          break;
        }
      }
      if (!hallado) {
        fallas.push(`${d} (${provincia})`);
        continue;
      }
      lugares.push({
        nombre: d === "Veintiséis de Octubre" ? "Veintiséis de Octubre" : d === "Tambo Grande" ? "Tambogrande" : d,
        provincia,
        region,
        lat: Number(hallado.latitude.toFixed(4)),
        lon: Number(hallado.longitude.toFixed(4)),
        alt: hallado.elevation ?? null,
        fuente: hallado.name,
      });
    }
  }
}
lugares.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
await writeFile(new URL("../app/datos/lugares.json", import.meta.url), JSON.stringify(lugares, null, 1));
console.log(`Encontrados ${lugares.length}. Sin encontrar: ${fallas.join(", ") || "ninguno"}`);
for (const l of lugares) console.log(`${l.nombre.padEnd(26)} ${l.provincia.padEnd(22)} ${l.lat}, ${l.lon}  alt ${l.alt}  (${l.fuente})`);
