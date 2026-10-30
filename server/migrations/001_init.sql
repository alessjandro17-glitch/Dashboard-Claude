-- Mundo Curioso Analytics: esquema inicial.
-- Compatible con PostgreSQL 14+ y Supabase. Todas las tablas usan UUID y marcas de tiempo con zona horaria.

create extension if not exists pgcrypto;

create table accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique,
  display_name text,
  instagram_user_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Métricas a nivel de cuenta, por día. Todas opcionales: lo que no se registra queda NULL ("no registrado").
create table account_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  date date not null,
  followers_count integer check (followers_count >= 0),
  new_followers integer,
  reach integer check (reach >= 0),
  impressions integer check (impressions >= 0),
  views integer check (views >= 0),
  profile_visits integer check (profile_visits >= 0),
  source text not null default 'manual' check (source in ('manual','csv','instagram')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, date)
);

create table content_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  parent_id uuid references content_categories(id) on delete cascade,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index content_categories_name_parent on content_categories (lower(name), coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table videos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  instagram_url text,
  instagram_media_id text,
  published_at timestamptz,
  duration_seconds numeric(8,2) check (duration_seconds > 0),
  category_id uuid references content_categories(id) on delete set null,
  subcategory_id uuid references content_categories(id) on delete set null,
  status text not null default 'publicado' check (status in ('idea','borrador','programado','publicado','archivado')),
  thumbnail_url text,
  description text,
  script text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index videos_instagram_url_uq on videos (lower(instagram_url)) where instagram_url is not null;
create unique index videos_media_id_uq on videos (instagram_media_id) where instagram_media_id is not null;
create index videos_published_at_idx on videos (published_at);

create table video_creative_attributes (
  video_id uuid primary key references videos(id) on delete cascade,
  hook_type text,
  narrative_style text,
  storytelling_structure text,
  visual_style text,
  animation_type text,
  uses_code_art boolean,
  dimension text check (dimension in ('2D','3D','2D+3D','ninguno')),
  music_type text,
  has_voiceover boolean,
  narrative_pace text,
  scene_count integer check (scene_count >= 0),
  production_complexity smallint check (production_complexity between 1 and 5),
  color_composition text,
  updated_at timestamptz not null default now()
);

-- Cada medición de un video en un momento concreto. Nunca se sobrescribe: se agrega una nueva.
create table video_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references videos(id) on delete cascade,
  captured_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual','csv','instagram')),
  views integer check (views >= 0),
  reach integer check (reach >= 0),
  impressions integer check (impressions >= 0),
  total_watch_time_seconds numeric(14,2) check (total_watch_time_seconds >= 0),
  avg_watch_time_seconds numeric(10,2) check (avg_watch_time_seconds >= 0),
  likes integer check (likes >= 0),
  comments integer check (comments >= 0),
  shares integer check (shares >= 0),
  saves integer check (saves >= 0),
  profile_visits integer check (profile_visits >= 0),
  follows integer check (follows >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, captured_at)
);
create index snapshots_video_idx on video_metrics_snapshots (video_id, captured_at desc);

create table production_notes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id) on delete cascade,
  note text not null check (length(trim(note)) > 0),
  created_at timestamptz not null default now()
);

create table content_experiments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  hypothesis text not null,
  variable text not null check (variable in ('hook','duracion','tematica','ritmo','animacion','color_composicion','musica','storytelling','otro')),
  primary_metric text not null,
  control_description text,
  variant_description text,
  controlled_factors text,
  uncontrolled_factors text,
  status text not null default 'planificado' check (status in ('planificado','en_curso','concluido','descartado')),
  verdict text check (verdict in ('respaldada','no_respaldada','no_concluyente')),
  conclusion text,
  concluded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table experiment_videos (
  experiment_id uuid not null references content_experiments(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  arm text not null check (arm in ('control','variante')),
  primary key (experiment_id, video_id)
);

create table experiment_results (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null references content_experiments(id) on delete cascade,
  computed_at timestamptz not null default now(),
  metric text not null,
  control_n integer not null,
  variant_n integer not null,
  control_median numeric,
  variant_median numeric,
  control_mean numeric,
  variant_mean numeric,
  diff_pct numeric,
  p_value numeric,
  suggested_verdict text,
  details jsonb not null default '{}'::jsonb
);

-- Ejecuciones del motor de análisis (memoria de "análisis realizados").
create table analysis_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  run_at timestamptz not null default now(),
  videos_considered integer not null default 0,
  summary jsonb not null default '{}'::jsonb
);

create table historical_patterns (
  id uuid primary key default gen_random_uuid(),
  dimension text not null,
  value text not null,
  metric text not null,
  direction text not null check (direction in ('superior','inferior')),
  group_n integer not null,
  rest_n integer not null,
  group_median numeric,
  rest_median numeric,
  lift_pct numeric,
  p_value numeric,
  q_value numeric,
  confidence text not null check (confidence in ('media','alta')),
  status text not null default 'activo' check (status in ('activo','no_confirmado')),
  statement text not null,
  first_detected_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  last_run_id uuid references analysis_runs(id) on delete set null,
  unique (dimension, value, metric)
);

create table recommendations (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  evidence jsonb not null default '{}'::jsonb,
  source text not null check (source in ('patrones','experimento','ai','manual')),
  pattern_id uuid references historical_patterns(id) on delete set null,
  experiment_id uuid references content_experiments(id) on delete set null,
  status text not null default 'pendiente' check (status in ('pendiente','aceptada','descartada','aplicada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table decisions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  recommendation_id uuid references recommendations(id) on delete set null,
  experiment_id uuid references content_experiments(id) on delete set null,
  decided_at timestamptz not null default now(),
  outcome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ai_insights (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'pregunta',
  question text not null,
  answer text not null,
  model text,
  context_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table integrations (
  provider text primary key,
  status text not null default 'no_configurada',
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

-- Historial de cambios de todos los registros editables.
create table audit_log (
  id bigserial primary key,
  entity text not null,
  entity_id text not null,
  action text not null check (action in ('crear','editar','eliminar','importar')),
  changes jsonb,
  at timestamptz not null default now()
);
create index audit_log_entity_idx on audit_log (entity, entity_id, at desc);
