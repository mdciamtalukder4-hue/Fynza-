-- FYNZA security_v1 (part C): global payments (any country / currency / provider). Safe to re-run.
-- Run after security_v1_a.sql and security_v1_b.sql.
alter table public.verification_applications drop constraint if exists verification_applications_pay_method_check;
alter table public.verification_applications add constraint verification_applications_pay_method_check check (pay_method in ('stripe','paypal','manual','other'));
alter table public.verification_applications add column if not exists currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$');
alter table public.verification_applications add column if not exists payment_id uuid;

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  purpose text not null default 'verification' check (purpose in ('verification')),
  provider text not null check (provider in ('stripe','paypal','other')),
  provider_ref text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor int not null check (amount_minor > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  unique (provider, provider_ref)
);
alter table public.payments enable row level security;
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments for select to authenticated using (user_id = auth.uid() or public.is_admin_session());
revoke all on public.payments from anon;
revoke insert, update, delete, truncate, references, trigger on public.payments from authenticated;
create unique index if not exists verif_payment_once on public.verification_applications (payment_id) where payment_id is not null and status <> 'rejected';

insert into public.app_settings (key, value) values ('verification_prices',''), ('payment_providers',''), ('manual_pay_info','')
  on conflict (key) do nothing;

create or replace function public.admin_set_setting(p_key text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_key not in ('verification_prices','payment_providers','manual_pay_info','require_admin_mfa') then raise exception 'unknown setting'; end if;
  if char_length(coalesce(p_value,'')) > 800 then raise exception 'too long'; end if;
  if p_key = 'verification_prices' and coalesce(p_value,'') <> '' then perform (p_value::jsonb); end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, coalesce(p_value,''), now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public._admin_log('setting_' || p_key, p_key, case when p_key = 'manual_pay_info' then '' else left(coalesce(p_value,''), 200) end);
end $$;

drop function if exists public.submit_verification(uuid,text,text,text,text,text,text,text);
create or replace function public.submit_verification(p_page uuid, p_full_name text, p_doc_type text, p_doc_path text,
  p_selfie_path text, p_payment uuid, p_manual_ref text, p_currency text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); aid uuid; pay public.payments; m text; ref text; amt text; cur text; confirmed boolean := false;
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
  if p_payment is not null then
    select * into pay from public.payments where id = p_payment and user_id = me and purpose = 'verification' and status = 'paid';
    if not found then raise exception 'payment not found or not paid'; end if;
    m := pay.provider; ref := pay.provider_ref; cur := pay.currency; amt := to_char(pay.amount_minor / 100.0, 'FM999999990.00') || ' ' || pay.currency; confirmed := true;
  else
    if char_length(trim(coalesce(p_manual_ref,''))) < 4 then raise exception 'payment reference missing'; end if;
    cur := upper(coalesce(p_currency, 'USD'));
    if cur !~ '^[A-Z]{3}$' then raise exception 'bad currency'; end if;
    m := 'manual'; ref := trim(p_manual_ref); amt := cur;
  end if;
  insert into public.verification_applications (user_id, page_id, full_name, doc_type, doc_path, selfie_path, pay_method, pay_ref, amount, currency, payment_id, payment_confirmed)
    values (me, p_page, trim(p_full_name), p_doc_type, p_doc_path, p_selfie_path, m, left(ref, 60), left(amt, 40), cur, p_payment, confirmed)
    returning id into aid;
  return aid;
exception when unique_violation then
  raise exception 'already pending or this payment was already used';
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
    if not (a.payment_confirmed or coalesce(p_payment_ok, false)) then raise exception 'confirm the payment first'; end if;
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

revoke all on function public.submit_verification(uuid,text,text,text,text,uuid,text,text) from public, anon;
grant execute on function public.submit_verification(uuid,text,text,text,text,uuid,text,text) to authenticated;
revoke all on function public.admin_set_setting(text,text) from public, anon;
grant execute on function public.admin_set_setting(text,text) to authenticated;
revoke all on function public.admin_review_verification(uuid,boolean,text,boolean) from public, anon;
grant execute on function public.admin_review_verification(uuid,boolean,text,boolean) to authenticated;
