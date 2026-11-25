# VillaLluvia Norte · por Villalta

**¿Va a llover?** Pronóstico de lluvia hora por hora para Piura (costa y sierra) y Tumbes, hasta 3 días.
Se instala en la pantalla de inicio de cualquier celular, Android o iPhone, sin tiendas de apps.

## Qué hace

- Muestra a qué hora puede llover y con qué probabilidad, con íconos de sol, nubes y lluvia.
- Muestra los avisos de lluvia del SENAMHI para el norte.
- Avisa al celular **1 hora antes** de la lluvia, solo cuando es probable.
- Envía un **resumen a las 6 a. m.**
- Lee el pronóstico en voz alta.
- Funciona sin internet, mostrando el último pronóstico guardado.
- **Aprende sola:** cada madrugada se corrige con lo que de verdad pasó, según los aeropuertos y los reportes de la familia.

## Cómo pronostica

1. Toma la lluvia que esperan tres modelos mundiales: ECMWF (Europa), GFS (EE. UU.) e ICON (Alemania), vía [Open-Meteo](https://open-meteo.com/).
2. Un modelo estadístico, entrenado con lo que pronosticaron y lo que de verdad pasó entre 2024 y 2026 en 7 aeropuertos del norte, convierte eso en "probabilidad de lluvia alrededor de esa hora".
3. **Prueba con 2026, un año que el modelo no vio:** el error de su probabilidad es 3 veces menor que el del promedio simple de los modelos. Los detalles están en `motor/datos/informe-entrenamiento.json`.
4. Solo muestra y avisa lluvia cuando es **probable (50 % o más)**. En la prueba de 2026, cuando marcó lluvia en un día, llovió 71 de cada 100 veces. A cambio, no anuncia las lluvias más dudosas. A nivel de hora exacta ningún pronóstico es seguro: la lluvia puede adelantarse o atrasarse.

Ningún pronóstico es perfecto. Ante un peligro, sigue siempre a SENAMHI, INDECI y tu municipalidad.

## Partes

| Carpeta | Qué es |
|---|---|
| `app/` | La app que se instala en el celular. Se publica en GitHub Pages. |
| `motor/` | Entrenamiento, avisos y aprendizaje diario. Corren en GitHub Actions. |
| `supabase/esquema.sql` | Base de datos para reportes y suscripciones a avisos. |
| `.github/workflows/` | Tareas automáticas: avisos cada 10 min, aprendizaje diario y publicación. |

Para configurar la base de datos, ver [INSTRUCCIONES.md](INSTRUCCIONES.md).

Datos: Open-Meteo.com (CC BY 4.0), SENAMHI e Iowa Environmental Mesonet (reportes de aeropuertos).
