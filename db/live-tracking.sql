-- ============================================================
-- Korvgrund Runt — live-positioner
-- Kör en gång i Supabase: Dashboard → SQL Editor → klistra in → Run.
-- Idempotent: går bra att köra om.
-- ============================================================

-- 1. Hemlig delningskod per båt (ALDRIG publikt läsbar) --------------
create table if not exists public.boat_secrets (
  registration_id uuid primary key references public.registrations(id) on delete cascade,
  code text not null
);
-- Valfritt mobilnummer (endast arrangör läser det — för SMS-utskick av länken).
alter table public.boat_secrets add column if not exists phone text;
alter table public.boat_secrets enable row level security;
-- Inga anon-policies => anon kan varken läsa eller skriva direkt.
-- Inloggad arrangör får läsa koderna (för att hjälpa deltagare).
drop policy if exists "secrets readable by authenticated" on public.boat_secrets;
create policy "secrets readable by authenticated"
  on public.boat_secrets for select to authenticated using (true);

-- Slumpkod: 4 tecken ur ett förväxlingssäkert alfabet (ingen 0/O/1/I).
create or replace function public.gen_share_code() returns text
language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (floor(random() * 32)::int) + 1, 1), '')
  from generate_series(1, 4);
$$;

-- Skapa kod automatiskt för varje ny anmälan.
create or replace function public.ensure_boat_secret() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.boat_secrets(registration_id, code)
  values (new.id, public.gen_share_code())
  on conflict (registration_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_ensure_boat_secret on public.registrations;
create trigger trg_ensure_boat_secret
  after insert on public.registrations
  for each row execute function public.ensure_boat_secret();

-- Backfill koder för redan anmälda båtar.
insert into public.boat_secrets(registration_id, code)
select id, public.gen_share_code() from public.registrations
on conflict (registration_id) do nothing;

-- 2. Aktuell position per båt ---------------------------------------
create table if not exists public.boat_positions (
  registration_id uuid primary key references public.registrations(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy double precision,
  speed double precision,
  heading double precision,
  updated_at timestamptz not null default now()
);
alter table public.boat_positions enable row level security;
-- Alla får LÄSA positionerna (följa live). Ingen direkt skrivning för anon.
drop policy if exists "positions readable by all" on public.boat_positions;
create policy "positions readable by all"
  on public.boat_positions for select to anon, authenticated using (true);

-- Realtid på positionstabellen (idempotent).
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'boat_positions'
  ) then
    alter publication supabase_realtime add table public.boat_positions;
  end if;
end $$;

-- 3. Anmäl båt + få delningskod i retur -----------------------------
create or replace function public.register_boat(
  p_name text, p_boat_name text, p_category text,
  p_boat_model text, p_engine_model text,
  p_engine_power int, p_weight_kg int, p_speed_knots numeric
) returns table(id uuid, code text)
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.registrations(name, boat_name, category, boat_model,
    engine_model, engine_power, weight_kg, speed_knots)
  values (p_name, p_boat_name, p_category, p_boat_model, p_engine_model,
    p_engine_power, p_weight_kg, p_speed_knots)
  returning registrations.id into v_id;
  return query
    select v_id, bs.code from public.boat_secrets bs where bs.registration_id = v_id;
end $$;
grant execute on function
  public.register_boat(text, text, text, text, text, int, int, numeric) to anon;

-- 4. Dela position (kräver rätt kod) --------------------------------
create or replace function public.share_position(
  p_registration_id uuid, p_code text,
  p_lat double precision, p_lng double precision,
  p_accuracy double precision, p_speed double precision, p_heading double precision
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.boat_secrets
    where registration_id = p_registration_id and upper(code) = upper(p_code)
  ) then
    raise exception 'Fel delningskod';
  end if;
  insert into public.boat_positions(registration_id, lat, lng, accuracy, speed, heading, updated_at)
  values (p_registration_id, p_lat, p_lng, p_accuracy, p_speed, p_heading, now())
  on conflict (registration_id) do update
    set lat = excluded.lat, lng = excluded.lng, accuracy = excluded.accuracy,
        speed = excluded.speed, heading = excluded.heading, updated_at = now();
end $$;
grant execute on function
  public.share_position(uuid, text, double precision, double precision,
                        double precision, double precision, double precision) to anon;

-- 5. Spara mobilnummer (kräver rätt kod) ----------------------------
create or replace function public.save_phone(
  p_registration_id uuid, p_code text, p_phone text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.boat_secrets
    where registration_id = p_registration_id and upper(code) = upper(p_code)
  ) then
    raise exception 'Fel delningskod';
  end if;
  update public.boat_secrets set phone = nullif(trim(p_phone), '')
  where registration_id = p_registration_id;
end $$;
grant execute on function public.save_phone(uuid, text, text) to anon;
