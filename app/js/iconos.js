// Íconos del clima, dibujados a mano en SVG para que se vean igual en Android y iPhone.

const SOL = (cx, cy, r) => {
  let rayos = "";
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9);
    rayos += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="#FFC93C" stroke-width="3.5" stroke-linecap="round">${rayos}</g><circle cx="${cx}" cy="${cy}" r="${r}" fill="#FFC93C"/>`;
};

const LUNA = (cx, cy, r) =>
  `<path d="M${cx + r * 0.35} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.75} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 -${r * 0.75} -${r * 1.55}z" fill="#F3EFC8"/>`;

const NUBE = (dx = 0, dy = 0, color = "#FFFFFF") =>
  `<path transform="translate(${dx} ${dy})" d="M17 50h31a10.5 10.5 0 0 0 1.2-20.9A15 15 0 0 0 20.6 25 12.5 12.5 0 0 0 17 50z" fill="${color}"/>`;

const GOTAS = `<g stroke="#5AC8FA" stroke-width="3.5" stroke-linecap="round">
  <line x1="22" y1="52" x2="19" y2="60"/><line x1="32" y1="52" x2="29" y2="60"/><line x1="42" y1="52" x2="39" y2="60"/></g>`;

const DIBUJOS = {
  sol: SOL(32, 32, 12),
  luna: LUNA(28, 32, 15),
  nube: NUBE(0, 2, "#F2F4F7"),
  sol_nube: SOL(24, 22, 9) + NUBE(4, 6),
  luna_nube: LUNA(20, 20, 10) + NUBE(4, 6),
  lluvia: NUBE(0, -6, "#E9EDF2") + GOTAS,
};

const NOMBRES = {
  sol: "Soleado",
  luna: "Despejado",
  nube: "Nublado",
  sol_nube: "Parcialmente nublado",
  luna_nube: "Parcialmente nublado",
  lluvia: "Lluvia",
};

export function svgIcono(nombre, tam = 40) {
  return `<svg class="icono" width="${tam}" height="${tam}" viewBox="0 0 64 64" role="img" aria-label="${NOMBRES[nombre] ?? ""}">${DIBUJOS[nombre] ?? DIBUJOS.nube}</svg>`;
}

export function nombreCielo(nombre) {
  return NOMBRES[nombre] ?? "";
}
