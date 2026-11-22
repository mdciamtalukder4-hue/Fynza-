-- =====================================================================
-- FYNZA security_v1 (part D): FYNZA Verified + Global Monetization structure.
-- ALL REAL PAYMENT PROCESSING IS DISABLED. No function here charges money, activates a subscription,
-- creates earnings or pays out. Those only become possible when (a) the global switch
-- app_settings.payments_enabled = 'true' (SQL editor only), (b) a method has integration_ready = true
-- (set by a developer after a provider integration exists) and (c) an admin enabled the method.
-- Safe to re-run. Run after parts A, B, C.
-- =====================================================================

alter table public.profiles add column if not exists country text check (country ~ '^[A-Z]{2}$');
alter table public.profiles add column if not exists currency text check (currency ~ '^[A-Z]{3}$');

insert into public.app_settings (key, value) values
  ('payments_enabled','false'), ('creator_min_followers','1000'), ('creator_min_account_days','30'), ('creator_min_posts','10'),
  ('creator_revenue_share_percent','')
  on conflict (key) do nothing;

create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_key not in ('require_admin_mfa','creator_min_followers','creator_min_account_days','creator_min_posts','creator_revenue_share_percent') then
    raise exception 'unknown setting'; end if;
  if char_length(coalesce(p_value,'')) > 100 then raise exception 'too long'; end if;
  if p_key like 'creator_%' and coalesce(p_value,'') <> '' and p_value !~ '^[0-9]{1,6}$' then raise exception 'numbers only'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, coalesce(p_value,''), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public._admin_log('setting_' || p_key, p_key, left(coalesce(p_value,''), 100));
end $$;

-- ---------- payment method registry ----------
create table if not exists public.payment_methods (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('card','wallet','mobile_money','bank','local')),
  direction text not null check (direction in ('pay','payout','both')),
  countries text[] not null default '{}',          -- empty = worldwide
  currencies text[] not null default '{}',         -- empty = any
  provider text not null default '',
  config_required text not null default '',
  enabled boolean not null default false,          -- admin switch
  integration_ready boolean not null default false,-- true only after a real provider integration is installed
  sort int not null default 100
);
alter table public.payment_methods enable row level security;
drop policy if exists pm_select on public.payment_methods;
create policy pm_select on public.payment_methods for select to authenticated using (true);

insert into public.payment_methods (id, name, kind, direction, countries, currencies, provider, config_required, sort) values
 ('card','Visa / Mastercard','card','pay','{}','{}','payment processor (e.g. Stripe, Adyen)','Merchant account with a card processor, business verification, API keys, webhook endpoint, PCI-safe hosted checkout',10),
 ('google_pay','Google Pay','wallet','pay','{}','{}','payment processor','Processor account + Google Pay merchant registration',11),
 ('apple_pay','Apple Pay','wallet','pay','{}','{}','payment processor','Processor account + Apple Developer account + domain verification',12),
 ('amazon_pay','Amazon Pay','wallet','pay','{US,GB,DE,FR,IT,ES,JP,IN}','{}','Amazon Pay','Amazon Pay merchant account (available only in some countries)',13),
 ('paypal','PayPal','wallet','both','{}','{}','PayPal','PayPal Business account, REST app credentials, webhook',14),
 ('payoneer','Payoneer','wallet','payout','{}','{}','Payoneer','Payoneer partner / mass-payout program approval',15),
 ('bank_wire','International bank transfer (SWIFT)','bank','both','{}','{}','bank / payout provider','Business bank account or payout provider; compliance (KYC/AML) process',16),
 ('bkash','bKash','mobile_money','both','{BD}','{BDT}','bKash','bKash merchant (payment gateway) agreement, App key/secret',30),
 ('nagad','Nagad','mobile_money','both','{BD}','{BDT}','Nagad','Nagad merchant agreement and API credentials',31),
 ('rocket','Rocket','mobile_money','both','{BD}','{BDT}','Dutch-Bangla Rocket','Rocket merchant agreement and API credentials',32),
 ('bd_bank_cards','Bangladesh bank cards','card','pay','{BD}','{BDT}','local gateway (e.g. SSLCommerz)','Local gateway merchant account and trade license',33),
 ('bd_bank_transfer','Bangladesh bank transfer','bank','both','{BD}','{BDT}','bank','Business bank account and trade license',34),
 ('upi','UPI','local','pay','{IN}','{INR}','payment processor','Processor account with UPI enabled (India business entity usually required)',50),
 ('pix','Pix','local','pay','{BR}','{BRL}','payment processor','Processor account with Pix enabled (Brazil requirements)',51),
 ('ideal','iDEAL','local','pay','{NL}','{EUR}','payment processor','Processor account with iDEAL enabled',52),
 ('sepa_debit','SEPA Direct Debit','bank','pay','{AT,BE,DE,ES,FR,IE,IT,NL,PT,FI}','{EUR}','payment processor','Processor account with SEPA enabled and mandate handling',53),
 ('bancontact','Bancontact','local','pay','{BE}','{EUR}','payment processor','Processor account with Bancontact enabled',54),
 ('blik','BLIK','local','pay','{PL}','{PLN}','payment processor','Processor account with BLIK enabled',55),
 ('alipay','Alipay','wallet','pay','{CN,HK,SG,MY}','{}','payment processor','Processor account with Alipay enabled',56),
 ('wechat_pay','WeChat Pay','wallet','pay','{CN,HK}','{}','payment processor','Processor account with WeChat Pay enabled',57),
 ('gcash','GCash','mobile_money','pay','{PH}','{PHP}','payment processor / GCash','Provider merchant agreement',58),
 ('paynow','PayNow','local','pay','{SG}','{SGD}','payment processor','Processor account with PayNow enabled',59),
 ('mpesa','M-Pesa','mobile_money','both','{KE,TZ}','{KES,TZS}','Safaricom / aggregator','M-Pesa merchant (Daraja API) approval',60),
 ('easypaisa','Easypaisa','mobile_money','both','{PK}','{PKR}','Easypaisa','Merchant agreement and API credentials',61),
 ('jazzcash','JazzCash','mobile_money','both','{PK}','{PKR}','JazzCash','Merchant agreement and API credentials',62),
 ('konbini','Konbini','local','pay','{JP}','{JPY}','payment processor','Processor account with Konbini enabled',63),
 ('twint','TWINT','local','pay','{CH}','{CHF}','payment processor','Processor account with TWINT enabled',64),
 ('swish','Swish','local','pay','{SE}','{SEK}','payment processor','Swedish merchant requirements',65),
 ('vipps','Vipps / MobilePay','local','pay','{NO,DK,FI}','{NOK,DKK,EUR}','Vipps MobilePay','Merchant agreement',66)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, direction = excluded.direction, countries = excluded.countries,
  currencies = excluded.currencies, provider = excluded.provider, config_required = excluded.config_required, sort = excluded.sort;

create or replace function public.payments_live(p_method text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = 'payments_enabled'), 'false') = 'true'
     and coalesce((select enabled and integration_ready from public.payment_methods where id = p_method), false);
$$;

create or replace function public.payment_options(p_country text default null, p_direction text default 'pay')
returns table (id text, name text, kind text, direction text, countries text[], currencies text[], provider text, config_required text,
  enabled boolean, integration_ready boolean, live boolean, status_note text)
language sql stable security definer set search_path = public as $$
  select m.id, m.name, m.kind, m.direction, m.countries, m.currencies, m.provider, m.config_required, m.enabled, m.integration_ready,
    public.payments_live(m.id),
    case when coalesce((select value from public.app_settings where key = 'payments_enabled'), 'false') <> 'true' then 'Coming soon — payments are temporarily disabled'
         when not m.integration_ready then 'Coming soon — provider not connected yet'
         when not m.enabled then 'Temporarily unavailable' else 'Available' end
  from public.payment_methods m
  where (m.direction = p_direction or m.direction = 'both')
    and (p_country is null or cardinality(m.countries) = 0 or upper(p_country) = any (m.countries))
  order by m.sort;
$$;

create or replace function public.admin_set_payment_method(p_id text, p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  update public.payment_methods set enabled = coalesce(p_enabled, false) where id = p_id;
  if not found then raise exception 'unknown payment method'; end if;
  perform public._admin_log('payment_method_' || case when p_enabled then 'enable' else 'disable' end, p_id, '');
end $$;

-- ---------- FYNZA Verified: plans, subscriptions (nothing can activate them yet) ----------
create table if not exists public.verified_plans (
  id uuid primary key default gen_random_uuid(),
  currency text not null unique check (currency ~ '^[A-Z]{3}$'),
  amount_minor int not null check (amount_minor > 0),
  interval text not null default 'month' check (interval = 'month'),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.verified_plans enable row level security;
drop policy if exists vplans_select on public.verified_plans;
create policy vplans_select on public.verified_plans for select to authenticated using (active or public.is_admin_session());

create table if not exists public.verified_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  plan_id uuid references public.verified_plans(id) on delete set null,
  status text not null default 'incomplete' check (status in ('incomplete','active','past_due','canceled','expired')),
  current_period_end timestamptz,
  auto_renew boolean not null default true,
  provider text not null default '',
  provider_ref text not null default '',
  reminded boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.verified_subscriptions enable row level security;
drop policy if exists vsubs_select on public.verified_subscriptions;
create policy vsubs_select on public.verified_subscriptions for select to authenticated using (user_id = auth.uid() or public.is_admin_session());

create or replace function public.admin_upsert_plan(p_currency text, p_amount_minor int, p_active boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if upper(p_currency) !~ '^[A-Z]{3}$' or coalesce(p_amount_minor, 0) <= 0 then raise exception 'bad plan'; end if;
  insert into public.verified_plans (currency, amount_minor, active) values (upper(p_currency), p_amount_minor, coalesce(p_active, true))
    on conflict (currency) do update set amount_minor = excluded.amount_minor, active = excluded.active;
  perform public._admin_log('plan_upsert', upper(p_currency), p_amount_minor::text);
end $$;

create or replace function public.start_verified_subscription(p_app uuid, p_method text, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.payments_live(p_method) then raise exception 'payments are disabled'; end if;
  raise exception 'payment provider not connected';   -- no provider integration is installed yet
end $$;

-- identity-only applications (payment comes later, when payments are enabled)
alter table public.verification_applications alter column pay_method drop not null;
alter table public.verification_applications alter column pay_ref drop not null;
alter table public.verification_applications add column if not exists country text check (country ~ '^[A-Z]{2}$');
alter table public.verification_applications drop constraint if exists verification_applications_pay_method_check;
alter table public.verification_applications add constraint verification_applications_pay_method_check check (pay_method is null or pay_method in ('stripe','paypal','manual','other'));
alter table public.verification_applications drop constraint if exists verification_applications_status_check;
alter table public.verification_applications add constraint verification_applications_status_check check (status in ('pending','identity_approved','approved','rejected','expired'));
drop index if exists public.verif_one_pending;
create unique index verif_one_pending on public.verification_applications
  (user_id, coalesce(page_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status in ('pending','identity_approved');

drop function if exists public.submit_verification(uuid,text,text,text,text,uuid,text,text);
create or replace function public.submit_verification(p_page uuid, p_full_name text, p_doc_type text, p_doc_path text, p_selfie_path text, p_country text)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid;
begin
  if me is null then raise exception 'login required'; end if;
  if public.is_banned(me) then raise exception 'account suspended'; end if;
  if p_page is not null then
    if not exists (select 1 from public.pages where id = p_page and owner_id = me) then raise exception 'not your page'; end if;
    if exists (select 1 from public.pages where id = p_page and verified) then raise exception 'already verified'; end if;
  elsif exists (select 1 from public.profiles where id = me and verified) then raise exception 'already verified';
  end if;
  if coalesce(p_doc_path,'') = '' or split_part(p_doc_path, '/', 1) <> me::text
     or not exists (select 1 from storage.objects where bucket_id = 'verify' and name = p_doc_path) then raise exception 'document missing'; end if;
  if coalesce(p_selfie_path,'') = '' or split_part(p_selfie_path, '/', 1) <> me::text
     or not exists (select 1 from storage.objects where bucket_id = 'verify' and name = p_selfie_path) then raise exception 'selfie missing'; end if;
  if (select count(*) from public.verification_applications where user_id = me and created_at > now() - interval '1 day') >= 3 then
    raise exception 'too many requests, try again later'; end if;
  insert into public.verification_applications (user_id, page_id, full_name, doc_type, doc_path, selfie_path, country)
    values (me, p_page, trim(p_full_name), p_doc_type, p_doc_path, p_selfie_path, nullif(upper(coalesce(p_country,'')), ''))
    returning id into aid;
  return aid;
exception when unique_violation then
  raise exception 'already pending or this payment was already used';
end $$;

drop function if exists public.admin_review_verification(uuid,boolean,text,boolean);
create or replace function public.admin_review_verification(p_id uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare a public.verification_applications;
begin
  perform public._admin_check();
  select * into a from public.verification_applications where id = p_id for update;
  if not found or a.status <> 'pending' then raise exception 'application not pending'; end if;
  if a.user_id = auth.uid() then raise exception 'you cannot review your own application (use a special grant with a reason)'; end if;
  if p_approve then
    update public.verification_applications set status = 'identity_approved', reviewed_by = auth.uid(), reviewed_at = now(), admin_note = coalesce(p_note,'') where id = p_id;
    insert into public.notifications (user_id, type, text) values (a.user_id, 'system',
      'আপনার FYNZA Verified পরিচয় যাচাই সম্পন্ন হয়েছে ✔ পেমেন্ট চালু হলে ব্লু ব্যাজ সক্রিয় করা যাবে।');
    perform public._admin_log('verify_identity_approve', p_id::text, p_note);
  else
    if coalesce(trim(p_note),'') = '' then raise exception 'write a reason for rejecting'; end if;
    update public.verification_applications set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), admin_note = p_note where id = p_id;
    insert into public.notifications (user_id, type, text) values (a.user_id, 'system', 'আপনার FYNZA Verified আবেদন বাতিল হয়েছে: ' || left(p_note, 150));
    perform public._admin_log('verify_reject', p_id::text, p_note);
  end if;
end $$;

-- only the future payment webhook (service role / SQL editor) can turn a paid subscription into a badge
create or replace function public.grant_paid_verification(p_sub uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.verified_subscriptions;
begin
  select * into s from public.verified_subscriptions where id = p_sub and status = 'active' and current_period_end > now();
  if not found then raise exception 'no active subscription'; end if;
  if s.page_id is null then update public.profiles set verified = true where id = s.user_id; else update public.pages set verified = true where id = s.page_id; end if;
  insert into public.badge_grants (granted_by_username, user_id, page_id, kind, reason)
    values ('system', case when s.page_id is null then s.user_id end, s.page_id, 'paid', 'active FYNZA Verified subscription');
end $$;

-- scheduled later (e.g. pg_cron) once subscriptions exist: expiry + renewal reminders
create or replace function public.expire_verified() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from public.verified_subscriptions where status in ('active','past_due') and current_period_end < now() loop
    update public.verified_subscriptions set status = 'expired' where id = r.id;
    if r.page_id is null then update public.profiles set verified = false where id = r.user_id; else update public.pages set verified = false where id = r.page_id; end if;
    update public.badge_grants set revoked_at = now(), revoke_reason = 'subscription expired'
      where revoked_at is null and kind = 'paid' and ((r.page_id is null and user_id = r.user_id) or (r.page_id is not null and page_id = r.page_id));
    insert into public.notifications (user_id, type, text) values (r.user_id, 'system', 'আপনার FYNZA Verified মেয়াদ শেষ হয়েছে।');
    n := n + 1;
  end loop;
  for r in select * from public.verified_subscriptions where status = 'active' and not reminded and current_period_end between now() and now() + interval '3 days' loop
    insert into public.notifications (user_id, type, text) values (r.user_id, 'system', 'আপনার FYNZA Verified শীঘ্রই শেষ হবে। রিনিউয়াল নিশ্চিত করুন।');
    update public.verified_subscriptions set reminded = true where id = r.id;
  end loop;
  return n;
end $$;

-- ---------- Advertising (campaigns can be drafted and reviewed; they cannot be funded or run while payments are off) ----------
create table if not exists public.ad_accounts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  balance_minor bigint not null default 0 check (balance_minor >= 0)
);
create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  page_id uuid references public.pages(id) on delete set null,
  name text not null check (char_length(name) between 3 and 80),
  objective text not null default 'awareness' check (objective in ('awareness','traffic','engagement')),
  headline text not null default '' check (char_length(headline) <= 80),
  body text not null default '' check (char_length(body) <= 300),
  image_path text not null default '',
  link_url text not null default '' check (link_url = '' or link_url ~ '^https://'),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  budget_minor bigint not null default 0 check (budget_minor >= 0),
  daily_budget_minor bigint not null default 0 check (daily_budget_minor >= 0),
  start_date date, end_date date,
  targeting jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft','pending_review','approved','rejected','paused','active','ended')),
  reject_reason text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.ad_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.ad_campaigns(id) on delete cascade,
  kind text not null check (kind in ('impression','click')),
  cost_minor int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ad_events_campaign_idx on public.ad_events (campaign_id, created_at);
alter table public.ad_accounts enable row level security;
alter table public.ad_campaigns enable row level security;
alter table public.ad_events enable row level security;
drop policy if exists adacc_select on public.ad_accounts;
create policy adacc_select on public.ad_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists adc_select on public.ad_campaigns;
create policy adc_select on public.ad_campaigns for select to authenticated using (owner_id = auth.uid() or public.is_admin_session());
drop policy if exists adc_update on public.ad_campaigns;
create policy adc_update on public.ad_campaigns for update to authenticated
  using (owner_id = auth.uid() and status in ('draft','rejected')) with check (owner_id = auth.uid() and status in ('draft','rejected'));
drop policy if exists adc_delete on public.ad_campaigns;
create policy adc_delete on public.ad_campaigns for delete to authenticated using (owner_id = auth.uid() and status in ('draft','rejected'));
drop policy if exists ade_select on public.ad_events;
create policy ade_select on public.ad_events for select to authenticated
  using (exists (select 1 from public.ad_campaigns c where c.id = campaign_id and (c.owner_id = auth.uid() or public.is_admin_session())));

create or replace function public.create_campaign(p_name text, p_objective text, p_headline text, p_body text, p_link text, p_currency text,
  p_budget_minor bigint, p_daily_minor bigint, p_start date, p_end date, p_targeting jsonb, p_page uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid;
begin
  if me is null then raise exception 'login required'; end if;
  if public.is_banned(me) then raise exception 'account suspended'; end if;
  if p_page is not null and not exists (select 1 from public.pages where id = p_page and owner_id = me) then raise exception 'not your page'; end if;
  if (select count(*) from public.ad_campaigns where owner_id = me and created_at > now() - interval '1 day') >= 20 then raise exception 'too many requests, try again later'; end if;
  insert into public.ad_campaigns (owner_id, page_id, name, objective, headline, body, link_url, currency, budget_minor, daily_budget_minor, start_date, end_date, targeting)
    values (me, p_page, trim(p_name), coalesce(p_objective,'awareness'), coalesce(p_headline,''), coalesce(p_body,''), coalesce(p_link,''), upper(coalesce(p_currency,'USD')),
      greatest(coalesce(p_budget_minor,0),0), greatest(coalesce(p_daily_minor,0),0), p_start, p_end, coalesce(p_targeting,'{}'::jsonb))
    returning id into cid;
  return cid;
end $$;

create or replace function public.submit_campaign_for_review(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c public.ad_campaigns;
begin
  select * into c from public.ad_campaigns where id = p_id and owner_id = auth.uid() and status in ('draft','rejected');
  if not found then raise exception 'campaign not found'; end if;
  if c.headline = '' or c.body = '' or c.link_url = '' or c.budget_minor <= 0 then raise exception 'complete headline, text, https link and budget first'; end if;
  update public.ad_campaigns set status = 'pending_review', reject_reason = '' where id = p_id;
end $$;

create or replace function public.activate_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not exists (select 1 from public.payment_methods m where public.payments_live(m.id) and m.direction in ('pay','both')) then
    raise exception 'payments are disabled'; end if;
  raise exception 'payment provider not connected';
end $$;

create or replace function public.admin_ad_campaigns(p_status text default 'pending_review')
returns table (id uuid, owner_username text, name text, objective text, headline text, body text, link_url text, currency text, budget_minor bigint, targeting jsonb, status text, reject_reason text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query select c.id, p.username, c.name, c.objective, c.headline, c.body, c.link_url, c.currency, c.budget_minor, c.targeting, c.status, c.reject_reason, c.created_at
    from public.ad_campaigns c join public.profiles p on p.id = c.owner_id where p_status = 'all' or c.status = p_status order by c.created_at desc limit 100;
end $$;
create or replace function public.admin_review_campaign(p_id uuid, p_approve boolean, p_reason text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.ad_campaigns;
begin
  perform public._admin_check();
  select * into c from public.ad_campaigns where id = p_id and status = 'pending_review' for update;
  if not found then raise exception 'campaign not pending'; end if;
  if not p_approve and coalesce(trim(p_reason),'') = '' then raise exception 'write a reason for rejecting'; end if;
  update public.ad_campaigns set status = case when p_approve then 'approved' else 'rejected' end, reject_reason = case when p_approve then '' else p_reason end where id = p_id;
  insert into public.notifications (user_id, type, text) values (c.owner_id, 'system',
    case when p_approve then 'আপনার বিজ্ঞাপন "' || c.name || '" রিভিউয়ে অনুমোদিত হয়েছে। পেমেন্ট চালু হলে এটি চালু করা যাবে।' else 'আপনার বিজ্ঞাপন "' || c.name || '" বাতিল: ' || left(p_reason,150) end);
  perform public._admin_log('ad_' || case when p_approve then 'approve' else 'reject' end, p_id::text, p_reason);
end $$;

create or replace function public.campaign_stats(p_id uuid) returns table (impressions bigint, clicks bigint, ctr numeric, spend_minor bigint)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where e.kind = 'impression'), count(*) filter (where e.kind = 'click'),
    case when count(*) filter (where e.kind = 'impression') = 0 then 0 else round(100.0 * count(*) filter (where e.kind = 'click') / count(*) filter (where e.kind = 'impression'), 2) end,
    coalesce(sum(e.cost_minor), 0)::bigint
  from public.ad_events e join public.ad_campaigns c on c.id = e.campaign_id
  where e.campaign_id = p_id and (c.owner_id = auth.uid() or public.is_admin_session());
$$;

-- sponsored posts: only ACTIVE campaigns are returned (none can be active while payments are off)
create or replace function public.feed_ads(p_country text default null)
returns table (id uuid, headline text, body text, link_url text, owner_username text)
language sql stable security definer set search_path = public as $$
  select c.id, c.headline, c.body, c.link_url, p.username from public.ad_campaigns c join public.profiles p on p.id = c.owner_id
  where c.status = 'active' and (c.start_date is null or c.start_date <= current_date) and (c.end_date is null or c.end_date >= current_date)
    and (coalesce(c.targeting -> 'countries', '[]'::jsonb) = '[]'::jsonb or p_country is null or jsonb_exists(c.targeting -> 'countries', upper(p_country)))
  order by random() limit 1;
$$;

-- ---------- Business / creator page analytics (real numbers, page owner only) ----------
create or replace function public.page_analytics(p_page uuid)
returns table (followers bigint, posts bigint, reactions bigint, comments bigint, shares bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.page_followers f where f.page_id = p_page),
    (select count(*) from public.posts x where x.page_id = p_page),
    (select count(*) from public.post_reactions r join public.posts x on x.id = r.post_id where x.page_id = p_page),
    (select count(*) from public.comments c join public.posts x on x.id = c.post_id where x.page_id = p_page),
    (select count(*) from public.posts s join public.posts x on x.id = s.shared_post_id where x.page_id = p_page)
  where exists (select 1 from public.pages g where g.id = p_page and g.owner_id = auth.uid());
$$;

-- ---------- Creator monetization (eligibility is real; earnings, gifts and payouts are OFF) ----------
create table if not exists public.creator_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  country text check (country ~ '^[A-Z]{2}$'),
  note text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('reel','video','post','gift','live_gift','ads_share','adjustment')),
  amount_minor bigint not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending' check (status in ('pending','available','paid')),
  created_at timestamptz not null default now()
);
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  method_id text not null references public.payment_methods(id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'requested' check (status in ('requested','processing','paid','failed','canceled')),
  created_at timestamptz not null default now()
);
create table if not exists public.gift_catalog (
  id text primary key, name text not null, emoji text not null, stars int not null check (stars > 0), active boolean not null default true
);
insert into public.gift_catalog (id, name, emoji, stars) values ('heart','Heart','❤️',10), ('star','Star','⭐',50), ('crown','Crown','👑',200), ('rocket','Rocket','🚀',500)
  on conflict (id) do nothing;
create table if not exists public.star_balances (user_id uuid primary key references public.profiles(id) on delete cascade, balance bigint not null default 0 check (balance >= 0));
alter table public.creator_applications enable row level security;
alter table public.earnings_ledger enable row level security;
alter table public.withdrawals enable row level security;
alter table public.gift_catalog enable row level security;
alter table public.star_balances enable row level security;
drop policy if exists capp_select on public.creator_applications;
create policy capp_select on public.creator_applications for select to authenticated using (user_id = auth.uid() or public.is_admin_session());
drop policy if exists earn_select on public.earnings_ledger;
create policy earn_select on public.earnings_ledger for select to authenticated using (user_id = auth.uid());
drop policy if exists wd_select on public.withdrawals;
create policy wd_select on public.withdrawals for select to authenticated using (user_id = auth.uid());
drop policy if exists gifts_select on public.gift_catalog;
create policy gifts_select on public.gift_catalog for select to authenticated using (active);
drop policy if exists stars_select on public.star_balances;
create policy stars_select on public.star_balances for select to authenticated using (user_id = auth.uid());

create or replace function public.creator_eligibility() returns table (key text, label text, need bigint, have bigint, ok boolean)
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); mf bigint; md bigint; mp bigint; f bigint; d bigint; p bigint; idv boolean; w bigint;
begin
  if me is null then raise exception 'login required'; end if;
  mf := coalesce(nullif((select st.value from public.app_settings st where st.key = 'creator_min_followers'), '')::bigint, 1000);
  md := coalesce(nullif((select st.value from public.app_settings st where st.key = 'creator_min_account_days'), '')::bigint, 30);
  mp := coalesce(nullif((select st.value from public.app_settings st where st.key = 'creator_min_posts'), '')::bigint, 10);
  f := (select count(*) from public.follows where following_id = me);
  d := coalesce((select extract(day from now() - created_at)::bigint from public.profiles where id = me), 0);
  p := (select count(*) from public.posts where author_id = me);
  idv := exists (select 1 from public.profiles where id = me and verified) or exists (select 1 from public.verification_applications where user_id = me and status in ('identity_approved','approved'));
  w := (select count(*) from public.warnings where user_id = me and created_at > now() - interval '90 days');
  return query values
    ('followers'::text, 'ফলোয়ার'::text, mf, f, f >= mf),
    ('age', 'অ্যাকাউন্টের বয়স (দিন)', md, d, d >= md),
    ('posts', 'পোস্ট সংখ্যা', mp, p, p >= mp),
    ('identity', 'পরিচয় যাচাই (FYNZA Verified আবেদন অনুমোদিত)', 1::bigint, case when idv then 1::bigint else 0::bigint end, idv),
    ('clean', 'গত ৯০ দিনে কোনো সতর্কবার্তা নেই', 0::bigint, w, w = 0),
    ('country', 'দেশ সেট করা আছে', 1::bigint, case when (select country from public.profiles where id = me) is null then 0::bigint else 1::bigint end, (select country from public.profiles where id = me) is not null);
end $$;

create or replace function public.apply_creator() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c text;
begin
  if me is null then raise exception 'login required'; end if;
  if exists (select 1 from public.creator_eligibility() e where not e.ok) then raise exception 'not eligible yet'; end if;
  select country into c from public.profiles where id = me;
  insert into public.creator_applications (user_id, country) values (me, c)
    on conflict (user_id) do update set status = 'pending', country = excluded.country, created_at = now() where public.creator_applications.status = 'rejected';
end $$;

create or replace function public.admin_creator_applications(p_status text default 'pending')
returns table (user_id uuid, username text, name text, country text, status text, note text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query select a.user_id, p.username, p.name, a.country, a.status, a.note, a.created_at from public.creator_applications a
    join public.profiles p on p.id = a.user_id where p_status = 'all' or a.status = p_status order by a.created_at desc limit 100;
end $$;
create or replace function public.admin_review_creator(p_user uuid, p_approve boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if not p_approve and coalesce(trim(p_note),'') = '' then raise exception 'write a reason for rejecting'; end if;
  update public.creator_applications set status = case when p_approve then 'approved' else 'rejected' end, note = coalesce(p_note,''), decided_by = auth.uid(), decided_at = now()
    where user_id = p_user and status = 'pending';
  if not found then raise exception 'application not pending'; end if;
  insert into public.notifications (user_id, type, text) values (p_user, 'system',
    case when p_approve then 'আপনি FYNZA Creator হিসেবে অনুমোদিত হয়েছেন। আয়ের সুবিধা পেমেন্ট চালু হলে সক্রিয় হবে।' else 'Creator আবেদন বাতিল: ' || left(p_note,150) end);
  perform public._admin_log('creator_' || case when p_approve then 'approve' else 'reject' end, p_user::text, p_note);
end $$;

create or replace function public.creator_summary() returns table (pending_minor bigint, available_minor bigint, paid_minor bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount_minor) filter (where status = 'pending'), 0)::bigint, coalesce(sum(amount_minor) filter (where status = 'available'), 0)::bigint,
         coalesce(sum(amount_minor) filter (where status = 'paid'), 0)::bigint from public.earnings_ledger where user_id = auth.uid();
$$;

create or replace function public.request_withdrawal(p_method text, p_amount_minor bigint, p_currency text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.payments_live(p_method) then raise exception 'payments are disabled'; end if;
  raise exception 'payment provider not connected';
end $$;
create or replace function public.buy_stars(p_method text, p_stars int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  if not public.payments_live(p_method) then raise exception 'payments are disabled'; end if;
  raise exception 'payment provider not connected';
end $$;
create or replace function public.send_gift(p_to uuid, p_gift text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  raise exception 'payments are disabled';
end $$;

-- ---------- privileges ----------
revoke all on public.payment_methods, public.verified_plans, public.verified_subscriptions, public.ad_accounts, public.ad_campaigns, public.ad_events,
  public.creator_applications, public.earnings_ledger, public.withdrawals, public.gift_catalog, public.star_balances from anon;
revoke insert, update, delete, truncate, references, trigger on public.payment_methods, public.verified_plans, public.verified_subscriptions,
  public.ad_accounts, public.ad_events, public.creator_applications, public.earnings_ledger, public.withdrawals, public.gift_catalog, public.star_balances from authenticated;
revoke insert, truncate, references, trigger on public.ad_campaigns from authenticated;
revoke update on public.ad_campaigns from authenticated;
grant update (name, objective, headline, body, link_url, budget_minor, daily_budget_minor, start_date, end_date, targeting) on public.ad_campaigns to authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('payments_live','payment_options','admin_set_payment_method','admin_upsert_plan','start_verified_subscription',
      'submit_verification','admin_review_verification','grant_paid_verification','expire_verified','create_campaign','submit_campaign_for_review','activate_campaign',
      'admin_ad_campaigns','admin_review_campaign','campaign_stats','feed_ads','page_analytics','creator_eligibility','apply_creator','admin_creator_applications',
      'admin_review_creator','creator_summary','request_withdrawal','buy_stars','send_gift','admin_set_setting')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('grant_paid_verification','expire_verified') then execute format('revoke all on function %s from authenticated', f.sig);
    else execute format('grant execute on function %s to authenticated', f.sig); end if;
  end loop;
end $$;
