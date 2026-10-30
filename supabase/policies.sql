-- Activa Row Level Security en todas las tablas de la app sin crear políticas públicas.
-- Resultado: la API REST pública de Supabase (roles anon/authenticated) no puede leer ni escribir nada.
-- La aplicación se conecta con la cadena de conexión de Postgres (rol propietario), que no está sujeta a RLS.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
