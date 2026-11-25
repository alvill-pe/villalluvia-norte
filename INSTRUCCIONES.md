# Configurar la base de datos (una sola vez, unos 5 minutos)

La base de datos gratuita **Supabase** guarda los reportes de la familia y los celulares que pidieron avisos.
Sin ella, la app igual muestra el pronóstico y los avisos del SENAMHI, pero **no** envía notificaciones ni aprende de los reportes.

## 1. Crear la cuenta y el proyecto

1. Entra a <https://supabase.com> y toca **Start your project**.
2. Elige **Continue with GitHub** y acepta con tu cuenta `alvill-pe`.
3. Toca **New project**:
   - **Name:** `villalluvia`
   - **Database password:** toca **Generate a password**. No necesitas recordarla.
   - **Region:** *South America (São Paulo)*
   - **Plan:** *Free*
4. Toca **Create new project** y espera 1 o 2 minutos.

## 2. Crear las tablas

1. En el menú de la izquierda entra a **SQL Editor** y toca **New query**.
2. Copia todo el contenido de [`supabase/esquema.sql`](supabase/esquema.sql), pégalo y toca **Run**.
3. Debe aparecer *Success. No rows returned*.

## 3. Copiar las claves

Entra a **Project Settings → API Keys** (o **Data API**). Vas a necesitar 3 cosas:

| Dato | Dónde está | ¿Es secreto? |
|---|---|---|
| **Project URL** | `https://xxxx.supabase.co` | No |
| **Publishable key** (o *anon public*) | empieza con `sb_publishable_` o `eyJ` | No: va dentro de la app |
| **Secret key** (o *service_role*) | empieza con `sb_secret_` o `eyJ` | **Sí. No la compartas con nadie, ni en el chat.** |

## 4. Guardar las claves

- **Project URL** y **Publishable key:** pégalas en el chat con Claude. Son públicas y se ponen dentro de la app.
- **Secret key:** guárdala directamente en GitHub, sin mostrarla. Abre PowerShell en esta carpeta y ejecuta:

```powershell
.\configurar-secretos.ps1
```

El programa guarda las claves de notificaciones y te pide la **Project URL** y la **Secret key**. La clave secreta no se ve en pantalla mientras la pegas.

## 5. Probar

En GitHub, entra a **Actions → Avisos de lluvia → Run workflow**. Si termina en verde, ya funciona.

---

## Cómo se usa en el celular

**Android (Chrome):** abre el enlace de la app y toca **Instalar VillaLluvia**, o elige ⋮ → *Agregar a pantalla de inicio*.

**iPhone (Safari):** abre el enlace, toca **Compartir** (cuadrito con flecha) y luego **Agregar a inicio**. Abre la app desde el nuevo ícono y toca **Activar avisos**. En iPhone, los avisos solo funcionan con iOS 16.4 o superior y la app instalada en la pantalla de inicio.

## Cosas que conviene saber

- **Las tareas automáticas de GitHub pueden retrasarse**, a veces de 5 a 20 minutos. Por eso el aviso "1 hora antes" mira las próximas 2 horas, y el resumen de las 6 a. m. puede llegar 6:10 o 6:20.
- **SENAMHI bloquea a los servidores del extranjero.** Por eso cada celular lee los avisos directamente. Si GitHub no logra leerlos, no llegará la notificación del aviso, pero la app lo mostrará al abrirla.
- **Volver a entrenar desde cero** (opcional, una vez al año): `npm run entrenar`.
