-- =====================================================================
-- FYNZA security_v1 (part A): settings, admin 2FA, Blue Verification, security events,
-- login throttle, data export / account deletion.   Safe to re-run.
-- Run order: schema.sql -> messenger_v2.sql -> security_v1_a.sql -> security_v1_b.sql
-- =====================================================================

-- ---------- app settings (read by everyone signed in, written only through admin_set_setting) ----------
create table if not exists public.app_settings (
  key text primary key, value text not null default '', updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;
drop policy if exists app_settings_select on public.app_settings;
create policy app_settings_select on public.app_settings for select to authenticated using (true);
insert into public.app_settings (key, value) values ('verification_fee',''), ('verification_pay_info',''), ('require_admin_mfa','true')
  on conflict (key) do nothing;

-- ---------- admin session must be 2FA (aal2) unless the setting is switched off ----------
create or replace function public.is_admin_session() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin(auth.uid()) and (
    coalesce((select value from public.app_settings where key = 'require_admin_mfa'), 'true') <> 'true'
    or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2');
$$;
create or replace function public._admin_check() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
  if not public.is_admin_session() then raise exception 'admin needs 2fa'; end if;
end $$;
drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated using (public.is_admin_session());
drop policy if exists reports_admin_select on public.reports;
create policy reports_admin_select on public.reports for select to authenticated using (public.is_admin_session());

create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_key not in ('verification_fee','verification_pay_info','require_admin_mfa') then raise exception 'unknown setting'; end if;
  if char_length(coalesce(p_value,'')) > 500 then raise exception 'too long'; end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, coalesce(p_value,''), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public._admin_log('setting_' || p_key, p_key, case when p_key = 'verification_pay_info' then '' else left(coalesce(p_value,''), 100) end);
end $$;

-- ---------- Blue badge columns (nobody can edit them from the app) ----------
alter table public.profiles add column if not exists verified boolean not null default false;
alter table public.pages add column if not exists verified boolean not null default false;

create or replace function public.protect_profile_role() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.banned is distinct from old.banned or new.verified is distinct from old.verified)
     and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'role cannot be changed';
  end if;
  return new;
end $$;

create or replace function public.protect_page_verified() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if current_user not in ('postgres','service_role','supabase_admin') then new.verified := false; end if;
  else
    if new.verified is distinct from old.verified and current_user not in ('postgres','service_role','supabase_admin') then
      raise exception 'badge cannot be changed';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_page_verified on public.pages;
create trigger protect_page_verified before insert or update on public.pages
  for each row execute function public.protect_page_verified();

-- ---------- Verification applications (identity documents live in the private "verify" bucket) ----------
create table if not exists public.verification_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 80),
  doc_type text not null check (doc_type in ('nid','passport','driving_license','other')),
  doc_path text not null,
  selfie_path text not null,
  pay_method text not null check (pay_method in ('bkash','nagad','rocket','bank','other')),
  pay_ref text not null check (char_length(pay_ref) between 4 and 60),
  amount text not null default '' check (char_length(amount) <= 40),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  payment_confirmed boolean not null default false,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  admin_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists verif_one_pending on public.verification_applications
  (user_id, coalesce(page_id, '00000000-0000-0000-0000-000000000000'::uuid)) where status = 'pending';
create unique index if not exists verif_ref_once on public.verification_applications (lower(pay_ref)) where status <> 'rejected';
alter table public.verification_applications enable row level security;
drop policy if exists verif_select on public.verification_applications;
create policy verif_select on public.verification_applications for select to authenticated
  using (user_id = auth.uid() or public.is_admin_session());

-- complete audit of every badge (paid approvals and special admin grants)
create table if not exists public.badge_grants (
  id uuid primary key default gen_random_uuid(),
  granted_by uuid references public.profiles(id) on delete set null,
  granted_by_username text not null default '',
  user_id uuid references public.profiles(id) on delete cascade,
  page_id uuid references public.pages(id) on delete cascade,
  kind text not null check (kind in ('paid','special')),
  reason text not null check (char_length(reason) >= 3),
  application_id uuid references public.verification_applications(id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  revoke_reason text not null default '',
  check (num_nonnulls(user_id, page_id) = 1)
);
alter table public.badge_grants enable row level security;
drop policy if exists badge_grants_select on public.badge_grants;
create policy badge_grants_select on public.badge_grants for select to authenticated
  using (public.is_admin_session() or user_id = auth.uid());

create or replace function public.submit_verification(p_page uuid, p_full_name text, p_doc_type text, p_doc_path text,
  p_selfie_path text, p_pay_method text, p_pay_ref text, p_amount text) returns uuid
language plpgsql security definer set search_path = public as $$
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
  insert into public.verification_applications (user_id, page_id, full_name, doc_type, doc_path, selfie_path, pay_method, pay_ref, amount)
    values (me, p_page, trim(p_full_name), p_doc_type, p_doc_path, p_selfie_path, p_pay_method, trim(p_pay_ref), left(coalesce(p_amount,''), 40))
    returning id into aid;
  return aid;
exception when unique_violation then
  raise exception 'already pending or this payment reference was already used';
end $$;

create or replace function public.admin_verifications(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, account_name text, page_id uuid, page_name text, full_name text, doc_type text,
  doc_path text, selfie_path text, pay_method text, pay_ref text, amount text, status text, payment_confirmed boolean,
  admin_note text, created_at timestamptz, name_clash boolean, account_age_days int)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select a.id, a.user_id, p.username, p.name, a.page_id, pg.name, a.full_name, a.doc_type, a.doc_path, a.selfie_path, a.pay_method,
    a.pay_ref, a.amount, a.status, a.payment_confirmed, a.admin_note, a.created_at,
    exists (select 1 from public.profiles v where v.verified and v.id <> a.user_id and lower(trim(v.name)) = lower(trim(a.full_name))),
    extract(day from now() - p.created_at)::int
  from public.verification_applications a join public.profiles p on p.id = a.user_id left join public.pages pg on pg.id = a.page_id
  where p_status = 'all' or a.status = p_status
  order by a.created_at desc limit 100;
end $$;

create or replace function public.admin_review_verification(p_id uuid, p_approve boolean, p_note text default '', p_payment_ok boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare a public.verification_applications;
begin
  perform public._admin_check();
  select * into a from public.verification_applications where id = p_id for update;
  if not found or a.status <> 'pending' then raise exception 'application not pending'; end if;
  if a.user_id = auth.uid() then raise exception 'you cannot review your own application (use a special grant with a reason)'; end if;
  if p_approve then
    if not coalesce(p_payment_ok, false) then raise exception 'confirm the payment first'; end if;
    update public.verification_applications set status = 'approved', payment_confirmed = true, reviewed_by = auth.uid(), reviewed_at = now(),
      admin_note = coalesce(p_note,'') where id = p_id;
    if a.page_id is null then update public.profiles set verified = true where id = a.user_id;
    else update public.pages set verified = true where id = a.page_id; end if;
    insert into public.badge_grants (granted_by, granted_by_username, user_id, page_id, kind, reason, application_id)
      values (auth.uid(), coalesce((select username from public.profiles where id = auth.uid()), ''),
        case when a.page_id is null then a.user_id end, a.page_id, 'paid', 'verified application', a.id);
    insert into public.notifications (user_id, type, text) values (a.user_id, 'system', 'আপনার ব্লু ব্যাজ আবেদন অনুমোদিত হয়েছে ✔');
    perform public._admin_log('verify_approve', p_id::text, p_note);
  else
    if coalesce(trim(p_note),'') = '' then raise exception 'write a reason for rejecting'; end if;
    update public.verification_applications set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), admin_note = p_note where id = p_id;
    insert into public.notifications (user_id, type, text) values (a.user_id, 'system', 'আপনার ব্লু ব্যাজ আবেদন বাতিল হয়েছে: ' || left(p_note, 150));
    perform public._admin_log('verify_reject', p_id::text, p_note);
  end if;
end $$;

-- special grants: no payment, but a written reason and a permanent audit record are mandatory
create or replace function public.admin_grant_badge(p_user uuid, p_page uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  perform public._admin_check();
  if coalesce(trim(p_reason),'') = '' or char_length(trim(p_reason)) < 10 then raise exception 'a clear reason (10+ characters) is required'; end if;
  if num_nonnulls(p_user, p_page) <> 1 then raise exception 'choose exactly one: a person or a page'; end if;
  select username into uname from public.profiles where id = auth.uid();
  if p_user is not null then
    if not exists (select 1 from public.profiles where id = p_user) then raise exception 'person not found'; end if;
    update public.profiles set verified = true where id = p_user;
    if p_user <> auth.uid() then insert into public.notifications (user_id, actor_id, type, text) values (p_user, null, 'system', 'আপনাকে FYNZA ব্লু ব্যাজ দেওয়া হয়েছে ✔'); end if;
  else
    if not exists (select 1 from public.pages where id = p_page) then raise exception 'page not found'; end if;
    update public.pages set verified = true where id = p_page;
  end if;
  insert into public.badge_grants (granted_by, granted_by_username, user_id, page_id, kind, reason)
    values (auth.uid(), coalesce(uname,''), p_user, p_page, 'special', trim(p_reason));
  perform public._admin_log('badge_special_grant', coalesce(p_user::text, p_page::text), p_reason);
end $$;

create or replace function public.admin_revoke_badge(p_user uuid, p_page uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if coalesce(trim(p_reason),'') = '' then raise exception 'write a reason'; end if;
  if num_nonnulls(p_user, p_page) <> 1 then raise exception 'choose exactly one: a person or a page'; end if;
  if p_user is not null then update public.profiles set verified = false where id = p_user;
  else update public.pages set verified = false where id = p_page; end if;
  update public.badge_grants set revoked_at = now(), revoked_by = auth.uid(), revoke_reason = trim(p_reason)
    where revoked_at is null and ((p_user is not null and user_id = p_user) or (p_page is not null and page_id = p_page));
  perform public._admin_log('badge_revoke', coalesce(p_user::text, p_page::text), p_reason);
end $$;

create or replace function public.admin_badge_history(p_limit int default 100)
returns table (id uuid, kind text, reason text, granted_by_username text, recipient text, recipient_kind text, created_at timestamptz, revoked_at timestamptz, revoke_reason text)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select g.id, g.kind, g.reason, g.granted_by_username, coalesce('@' || p.username, pg.name, '?'), case when g.page_id is null then 'user' else 'page' end,
    g.created_at, g.revoked_at, g.revoke_reason
  from public.badge_grants g left join public.profiles p on p.id = g.user_id left join public.pages pg on pg.id = g.page_id
  order by g.created_at desc limit least(greatest(p_limit,1), 300);
end $$;

-- ---------- login / device history, new-device alerts ----------
create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('login','login_new_device','password_changed','mfa_enabled','mfa_disabled','logout_all','password_reset')),
  device text not null default '' check (char_length(device) <= 120),
  device_id text not null default '' check (char_length(device_id) <= 64),
  created_at timestamptz not null default now()
);
create index if not exists security_events_user_idx on public.security_events (user_id, created_at desc);
alter table public.security_events enable row level security;
drop policy if exists sec_events_select on public.security_events;
create policy sec_events_select on public.security_events for select to authenticated using (user_id = auth.uid());

create or replace function public.log_security_event(p_kind text, p_device text, p_device_id text) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); k text := p_kind; had_login boolean; known boolean;
begin
  if me is null then return 'no'; end if;
  if p_kind not in ('login','password_changed','mfa_enabled','mfa_disabled','logout_all','password_reset') then raise exception 'bad event'; end if;
  if (select count(*) from public.security_events where user_id = me and created_at > now() - interval '1 hour') >= 60 then return 'limit'; end if;
  if p_kind = 'login' then
    select exists (select 1 from public.security_events where user_id = me and kind in ('login','login_new_device')) into had_login;
    select exists (select 1 from public.security_events where user_id = me and kind in ('login','login_new_device') and device_id = left(coalesce(p_device_id,''),64)) into known;
    if had_login and not known then
      k := 'login_new_device';
      insert into public.notifications (user_id, type, text) values (me, 'system',
        'নতুন ডিভাইস থেকে লগইন: ' || left(coalesce(p_device,''), 60) || '। আপনি না হলে এখনই পাসওয়ার্ড বদলান ও "সব ডিভাইস থেকে লগআউট" করুন।');
    end if;
  end if;
  insert into public.security_events (user_id, kind, device, device_id) values (me, k, left(coalesce(p_device,''),120), left(coalesce(p_device_id,''),64));
  return case when k = 'login_new_device' then 'new_device' else 'ok' end;
end $$;

-- ---------- login attempt limit (works with a hashed e-mail, no passwords ever) ----------
create table if not exists public.login_attempts (
  key text primary key, fails int not null default 0, first_fail timestamptz not null default now(), locked_until timestamptz);
alter table public.login_attempts enable row level security;

create or replace function public.login_status(p_email text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select greatest(ceil(extract(epoch from (locked_until - now())))::int, 0) from public.login_attempts
    where key = encode(sha256(convert_to(lower(trim(left(coalesce(p_email,''),200))), 'UTF8')), 'hex')), 0);
$$;
create or replace function public.login_failed(p_email text) returns int
language plpgsql security definer set search_path = public as $$
declare k text; r public.login_attempts; n int;
begin
  if coalesce(trim(p_email),'') = '' then return 0; end if;
  k := encode(sha256(convert_to(lower(trim(left(p_email,200))), 'UTF8')), 'hex');
  delete from public.login_attempts where first_fail < now() - interval '1 day' and coalesce(locked_until, 'epoch') < now();
  select * into r from public.login_attempts where key = k;
  if not found or (r.first_fail < now() - interval '15 minutes' and coalesce(r.locked_until, 'epoch') < now()) then
    insert into public.login_attempts (key, fails, first_fail, locked_until) values (k, 1, now(), null)
      on conflict (key) do update set fails = 1, first_fail = now(), locked_until = null;
  else
    n := r.fails + 1;
    update public.login_attempts set fails = n,
      locked_until = case when n >= 10 then now() + interval '60 minutes' when n >= 5 then now() + interval '15 minutes' else locked_until end
      where key = k;
  end if;
  return public.login_status(p_email);
end $$;
create or replace function public.login_reset() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.login_attempts where key = encode(sha256(convert_to(lower(trim((select email from auth.users where id = auth.uid()))), 'UTF8')), 'hex');
end $$;

-- ---------- your data: export and delete ----------
create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'login required'; end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) from public.profiles p where p.id = me),
    'settings', (select to_jsonb(s) from public.user_settings s where s.user_id = me),
    'posts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, body, media_url, audience, created_at from public.posts where author_id = me order by created_at desc limit 5000) x),
    'comments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, post_id, body, created_at from public.comments where author_id = me order by created_at desc limit 5000) x),
    'messages_sent', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, conversation_id, body, kind, created_at from public.messages where sender_id = me and deleted_at is null order by created_at desc limit 5000) x),
    'friendships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from public.friendships where requester_id = me or addressee_id = me limit 5000) x),
    'follows', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from public.follows where follower_id = me limit 5000) x),
    'blocks', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from public.blocks where blocker_id = me limit 5000) x),
    'saved_posts', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from public.saved_posts where user_id = me limit 5000) x),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, type, text, read, created_at from public.notifications where user_id = me order by created_at desc limit 2000) x),
    'security_events', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select kind, device, created_at from public.security_events where user_id = me order by created_at desc limit 500) x),
    'verification_applications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select id, full_name, doc_type, pay_method, pay_ref, amount, status, created_at from public.verification_applications where user_id = me) x));
end $$;

create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  delete from auth.users where id = auth.uid();
end $$;
