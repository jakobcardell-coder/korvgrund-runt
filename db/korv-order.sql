-- ============================================================
-- Korvgrund Runt — förbeställning av korv & dryck
-- Kör en gång i Supabase: Dashboard → SQL Editor → klistra in → Run.
-- Idempotent: går bra att köra om.
-- ============================================================

-- 1. Beställningstabell ---------------------------------------------
create table if not exists public.korv_orders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sausages int not null default 0,
  drinks int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.korv_orders enable row level security;

-- Namnen är inte publika. Endast inloggad arrangör får läsa listan;
-- allmänheten ser bara aggregerade summor via korv_totals() nedan.
drop policy if exists "korv readable by authenticated" on public.korv_orders;
create policy "korv readable by authenticated"
  on public.korv_orders for select to authenticated using (true);

-- 2. Publik aggregerad summa (exponerar inga namn) ------------------
create or replace function public.korv_totals()
  returns table(total_sausages bigint, total_drinks bigint, total_orders bigint)
language sql security definer set search_path = public stable as $$
  select coalesce(sum(sausages), 0)::bigint,
         coalesce(sum(drinks), 0)::bigint,
         count(*)::bigint
  from public.korv_orders;
$$;
grant execute on function public.korv_totals() to anon, authenticated;

-- 3. Lägg en förbeställning + få nya summan i retur -----------------
create or replace function public.order_korv(
  p_name text, p_sausages int, p_drinks int
) returns table(total_sausages bigint, total_drinks bigint, total_orders bigint)
language plpgsql security definer set search_path = public as $$
declare v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null then
    raise exception 'Namn krävs';
  end if;
  -- Rimlighetsspärr: 0–50 per post, och minst något beställt.
  p_sausages := least(greatest(coalesce(p_sausages, 0), 0), 50);
  p_drinks   := least(greatest(coalesce(p_drinks, 0), 0), 50);
  if p_sausages = 0 and p_drinks = 0 then
    raise exception 'Ange minst en korv eller en dryck';
  end if;
  insert into public.korv_orders(name, sausages, drinks)
  values (left(v_name, 60), p_sausages, p_drinks);
  return query select * from public.korv_totals();
end $$;
grant execute on function public.order_korv(text, int, int) to anon, authenticated;

-- 4. Realtid på beställningstabellen (idempotent) -------------------
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'korv_orders'
  ) then
    alter publication supabase_realtime add table public.korv_orders;
  end if;
end $$;
