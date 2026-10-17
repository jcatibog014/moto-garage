-- Moto Garage database schema.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste this file -> Run.

-- Units: each motorcycle or car the business buys.
create table public.units (
  id             uuid primary key default gen_random_uuid(),
  type           text not null check (type in ('motorcycle', 'car')),
  brand          text not null,
  model          text not null,
  year           int check (year between 1950 and 2100),
  plate_no       text,
  color          text,
  purchase_date  date not null,
  purchase_price numeric(12, 2) not null check (purchase_price >= 0),
  bought_from    text,
  status         text not null default 'in_stock' check (status in ('in_stock', 'sold')),
  sale_date      date,
  sale_price     numeric(12, 2) check (sale_price >= 0),
  sold_to        text,
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  constraint sold_unit_has_sale check (
    status <> 'sold' or (sale_date is not null and sale_price is not null)
  )
);

-- Expenses spent on a unit (transport, repair, parts, ...). Deleted with their unit.
create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references public.units (id) on delete cascade,
  date        date not null default current_date,
  category    text not null check (category in ('transport', 'repair', 'parts', 'documents', 'cleaning', 'other')),
  amount      numeric(12, 2) not null check (amount >= 0),
  description text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null
);

create index expenses_unit_id_idx on public.expenses (unit_id);

-- Each unit with its totals. Profit is only set once the unit is sold.
create view public.unit_summary with (security_invoker = true) as
select
  u.*,
  coalesce(e.total, 0)                               as total_expenses,
  u.purchase_price + coalesce(e.total, 0)            as total_cost,
  case when u.status = 'sold'
       then u.sale_price - u.purchase_price - coalesce(e.total, 0)
  end                                                as profit,
  coalesce(u.sale_date, current_date) - u.purchase_date as days_in_stock
from public.units u
left join (
  select unit_id, sum(amount) as total
  from public.expenses
  group by unit_id
) e on e.unit_id = u.id;

-- Row level security: any logged-in team member can read and change everything.
-- Turn off public sign-ups in Supabase so only people you add can log in.
alter table public.units enable row level security;
alter table public.expenses enable row level security;

create policy "Team members manage units" on public.units
  for all to authenticated using (true) with check (true);

create policy "Team members manage expenses" on public.expenses
  for all to authenticated using (true) with check (true);
