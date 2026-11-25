-- Base de datos de VillaLluvia Norte (Supabase).
-- Copiar y pegar todo en Supabase > SQL Editor > Run. Se puede correr más de una vez sin problema.

create table if not exists suscripciones (
  endpoint text primary key,
  p256dh text not null,
  auth text not null,
  lat double precision not null,
  lon double precision not null,
  lugar text,
  dispositivo text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  ultimo_aviso timestamptz,
  ultimo_resumen date
);

create table if not exists reportes (
  id bigserial primary key,
  momento timestamptz not null default now(),
  lat double precision not null,
  lon double precision not null,
  lugar text,
  llueve boolean not null,
  dispositivo text,
  procesado boolean not null default false,
  prob_anunciada double precision
);
create index if not exists reportes_pendientes on reportes (procesado, momento);

create table if not exists ejemplos (
  id bigserial primary key,
  momento timestamptz,
  zona text,
  x double precision[] not null,
  y smallint not null,
  peso real not null default 1,
  fuente text
);

create table if not exists publico (
  clave text primary key,
  valor jsonb not null,
  actualizado timestamptz not null default now()
);

-- Seguridad: nadie de afuera puede leer ni cambiar las tablas directamente.
alter table suscripciones enable row level security;
alter table reportes enable row level security;
alter table ejemplos enable row level security;
alter table publico enable row level security;

-- Lo único que la app puede leer: los pesos aprendidos y las estadísticas de aciertos.
drop policy if exists "app lee lo publico" on publico;
create policy "app lee lo publico" on publico for select to anon
  using (clave in ('calibracion', 'aciertos'));

-- La app solo puede escribir a través de estas funciones, que revisan los datos.
create or replace function guardar_reporte(
  p_lat double precision, p_lon double precision, p_lugar text, p_llueve boolean,
  p_dispositivo text, p_momento timestamptz default now()
) returns void language plpgsql security definer set search_path = public as $$
begin
  -- Solo Tumbes y Piura (con un margen).
  if p_lat not between -6.6 and -3.2 or p_lon not between -81.5 and -79.0 then
    raise exception 'Fuera de la zona de VillaLluvia';
  end if;
  -- No más de 6 reportes por celular en una hora.
  if (select count(*) from reportes where dispositivo = p_dispositivo and momento > now() - interval '1 hour') >= 6 then
    raise exception 'Demasiados reportes';
  end if;
  insert into reportes (momento, lat, lon, lugar, llueve, dispositivo)
  values (
    least(now(), greatest(coalesce(p_momento, now()), now() - interval '2 days')),
    round(p_lat::numeric, 2), round(p_lon::numeric, 2), left(p_lugar, 80), p_llueve, left(p_dispositivo, 64)
  );
end $$;

create or replace function guardar_suscripcion(
  p_endpoint text, p_p256dh text, p_auth text, p_lat double precision, p_lon double precision,
  p_lugar text, p_dispositivo text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_endpoint !~ '^https://' then raise exception 'Suscripción no válida'; end if;
  insert into suscripciones (endpoint, p256dh, auth, lat, lon, lugar, dispositivo)
  values (p_endpoint, p_p256dh, p_auth, round(p_lat::numeric, 2), round(p_lon::numeric, 2), left(p_lugar, 80), left(p_dispositivo, 64))
  on conflict (endpoint) do update set
    p256dh = excluded.p256dh, auth = excluded.auth, lat = excluded.lat, lon = excluded.lon,
    lugar = excluded.lugar, dispositivo = excluded.dispositivo, actualizado = now();
end $$;

create or replace function borrar_suscripcion(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from suscripciones where endpoint = p_endpoint;
$$;

revoke all on function guardar_reporte, guardar_suscripcion, borrar_suscripcion from public;
grant execute on function guardar_reporte, guardar_suscripcion, borrar_suscripcion to anon;
