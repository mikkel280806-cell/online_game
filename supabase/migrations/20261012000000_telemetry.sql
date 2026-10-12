-- Telemetry and playtest feedback written by the game client.
-- The browser (anon role) may only insert; the developer reads with the service role.

create table public.telemetry (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id text not null check (char_length(session_id) between 1 and 64),
  room text check (char_length(room) <= 8),
  role text check (role in ('host', 'guest', 'solo')),
  build text check (char_length(build) <= 64),
  kind text not null check (kind in ('session', 'perf', 'error')),
  data jsonb not null default '{}'::jsonb check (octet_length(data::text) <= 16384)
);

create index telemetry_created_at_idx on public.telemetry (created_at desc);

alter table public.telemetry enable row level security;

create policy "game can insert telemetry"
  on public.telemetry for insert to anon
  with check (kind in ('session', 'perf', 'error'));

create table public.feedback (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  session_id text not null check (char_length(session_id) between 1 and 64),
  room text check (char_length(room) <= 8),
  role text check (role in ('host', 'guest', 'solo')),
  build text check (char_length(build) <= 64),
  note text not null check (char_length(note) between 1 and 2000),
  -- JPEG data URL of the game view, downscaled in the client.
  screenshot text check (octet_length(screenshot) <= 400000),
  context jsonb not null default '{}'::jsonb check (octet_length(context::text) <= 16384)
);

create index feedback_created_at_idx on public.feedback (created_at desc);

alter table public.feedback enable row level security;

create policy "game can insert feedback"
  on public.feedback for insert to anon
  with check (char_length(note) > 0);
