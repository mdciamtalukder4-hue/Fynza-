-- v12 Marketplace (already applied to the project; kept here for reference / re-creation)
create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 100),
  description text not null default '' check (char_length(description) <= 2000),
  price_minor bigint not null default 0 check (price_minor >= 0 and price_minor <= 100000000000),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  category text not null default 'Other' check (category in ('Vehicles','Property','Electronics','Home & Garden','Clothing','Hobbies','Family','Services','Free stuff','Other')),
  condition text not null default 'used' check (condition in ('new','like_new','used','for_parts')),
  location text not null default '' check (char_length(location) <= 100),
  photos text[] not null default '{}' check (cardinality(photos) <= 8),
  status text not null default 'active' check (status in ('active','sold','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.listing_saves (
  listing_id uuid not null references public.listings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
alter table public.listings enable row level security;
alter table public.listing_saves enable row level security;
create policy li_select on public.listings for select using (seller_id = auth.uid() or (status in ('active','sold') and not is_blocked(auth.uid(), seller_id)));
create policy li_insert on public.listings for insert with check (seller_id = auth.uid());
create policy li_update on public.listings for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());
create policy li_delete on public.listings for delete using (seller_id = auth.uid());
create policy ls_select on public.listing_saves for select using (user_id = auth.uid());
create policy ls_insert on public.listing_saves for insert with check (user_id = auth.uid() and exists (select 1 from public.listings l where l.id = listing_id));
create policy ls_delete on public.listing_saves for delete using (user_id = auth.uid());
create or replace function public.listing_photo_check() returns trigger language plpgsql as $$
declare ph text; begin
  foreach ph in array new.photos loop
    if ph not like new.seller_id::text || '/%' then raise exception 'invalid photo path'; end if;
  end loop; return new; end $$;
create or replace function public.touch_listing() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create trigger ban_guard before insert on public.listings for each row execute function ban_guard();
create trigger rate_guard before insert on public.listings for each row execute function rate_guard('seller_id','20');
create trigger listing_photo_check before insert or update on public.listings for each row execute function listing_photo_check();
create trigger touch_listing before update on public.listings for each row execute function touch_listing();
-- private storage bucket: 8MB, jpeg/png/webp; folder = seller id
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('market','market',false,8388608,array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing;
create policy fynza_market_insert on storage.objects for insert with check (bucket_id='market' and (storage.foldername(name))[1] = auth.uid()::text);
create policy fynza_market_delete on storage.objects for delete using (bucket_id='market' and (storage.foldername(name))[1] = auth.uid()::text);
create policy fynza_market_select on storage.objects for select using (bucket_id='market');
-- reports.kind check includes 'listing'
