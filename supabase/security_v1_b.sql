-- =====================================================================
-- FYNZA security_v1 (part B): AI Community Guardian (rule-based, admin approval only),
-- upload limits, private "verify" bucket, privileges.   Safe to re-run.
-- The Guardian can only CREATE CASES. It has no function that bans, deletes or warns by itself:
-- every action goes through admin_decide_case(), which requires a signed-in admin (with 2FA).
-- =====================================================================

create table if not exists public.moderation_cases (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('report','auto')),
  kind text not null,
  target_id text not null,
  target_user uuid references public.profiles(id) on delete set null,
  risk text not null default 'low' check (risk in ('low','medium','high')),
  rule_violated text not null default '',
  recommended text not null default 'no_action' check (recommended in ('no_action','warn','remove_content','suspend_review')),
  draft_warning text not null default '',
  evidence jsonb not null default '{}',
  report_count int not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  decision text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists moderation_pending_uq on public.moderation_cases (kind, target_id) where status = 'pending';
alter table public.moderation_cases enable row level security;
drop policy if exists mcases_select on public.moderation_cases;
create policy mcases_select on public.moderation_cases for select to authenticated using (public.is_admin_session());

create table if not exists public.warnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  case_id uuid references public.moderation_cases(id) on delete set null,
  message text not null,
  content_snapshot text not null default '',
  rule text not null default '',
  approved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.warnings enable row level security;
drop policy if exists warnings_select on public.warnings;
create policy warnings_select on public.warnings for select to authenticated using (user_id = auth.uid() or public.is_admin_session());

-- keyword/pattern rules. This is NOT a language model: it only flags text for a human admin to read.
create or replace function public.guardian_eval(p text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare t text := lower(coalesce(p, '')); m jsonb := '[]'::jsonb; score int := 0; n int;
begin
  select count(*) into n from regexp_matches(t, 'https?://|www\.', 'g');
  if n >= 3 then m := m || jsonb_build_array(jsonb_build_object('rule','spam','why','একাধিক লিংক (' || n || 'টি)')); score := score + 2; end if;
  if t ~ '(bit\.ly|tinyurl\.com|cutt\.ly|shorturl)' then m := m || jsonb_build_array(jsonb_build_object('rule','spam','why','সংক্ষিপ্ত/লুকানো লিংক')); score := score + 1; end if;
  if t ~ '(double your money|guaranteed profit|investment guaranteed|you have won|lottery winner|send (me )?(your )?(otp|pin|password)|টাকা পাঠান|ওটিপি|পিন নম্বর|আপনি বিজয়ী|লটারি|নিশ্চিত লাভ|দ্বিগুণ টাকা)' then
    m := m || jsonb_build_array(jsonb_build_object('rule','scam','why','প্রতারণামূলক বাক্য/প্রলোভন')); score := score + 3; end if;
  if t ~ '(i will kill|i''ll kill you|kill you|মেরে ফেলব|খুন করব|কেটে ফেলব|জানে মেরে)' then
    m := m || jsonb_build_array(jsonb_build_object('rule','threat','why','হুমকির ভাষা')); score := score + 4; end if;
  if t ~ '(kill all (muslims|hindus|christians|jews|buddhists)|সব (হিন্দু|মুসলিম|মুসলমান|খ্রিস্টান|বৌদ্ধ)(দের|কে) (মেরে|শেষ|খুন))' then
    m := m || jsonb_build_array(jsonb_build_object('rule','hate','why','ধর্মীয় গোষ্ঠীর বিরুদ্ধে সহিংস আহ্বান')); score := score + 4; end if;
  if t ~ '(fuck you|motherfucker|bitch|asshole|মাগি|খানকি|হারামজাদা|শুয়োরের বাচ্চা)' then
    m := m || jsonb_build_array(jsonb_build_object('rule','abuse','why','গালিগালাজ/হয়রানির ভাষা')); score := score + 2; end if;
  if t ~ '(porn|xxx|nude pics|sex video|নগ্ন ছবি)' then
    m := m || jsonb_build_array(jsonb_build_object('rule','sexual','why','অশ্লীল কনটেন্টের ইঙ্গিত')); score := score + 2; end if;
  return jsonb_build_object('score', score, 'matches', m);
end $$;

create or replace function public._guardian_case(p_source text, p_kind text, p_target text, p_user uuid, p_text text,
  p_report uuid, p_reason text, p_bonus int default 0, p_bonus_rule text default null) returns void
language plpgsql security definer set search_path = public as $$
declare ev jsonb; score int; rules text[]; top text := ''; label text := ''; rec text; rsk text; draft text := ''; kindbn text; priors int;
begin
  ev := public.guardian_eval(p_text);
  score := (ev ->> 'score')::int + coalesce(p_bonus, 0);
  if p_source = 'auto' and score < 3 then return; end if;
  select array_agg(distinct x ->> 'rule') into rules from jsonb_array_elements(ev -> 'matches') x;
  if p_bonus_rule is not null then rules := coalesce(rules, '{}') || p_bonus_rule; end if;
  top := case when 'hate' = any(coalesce(rules,'{}')) then 'hate' when 'threat' = any(coalesce(rules,'{}')) then 'threat'
              when 'scam' = any(coalesce(rules,'{}')) then 'scam' when 'sexual' = any(coalesce(rules,'{}')) then 'sexual'
              when 'abuse' = any(coalesce(rules,'{}')) then 'abuse' when 'spam' = any(coalesce(rules,'{}')) then 'spam' else '' end;
  label := case top when 'hate' then 'বিদ্বেষমূলক বক্তব্য' when 'threat' then 'হুমকি' when 'scam' then 'প্রতারণা/স্ক্যাম'
                    when 'sexual' then 'অশ্লীল কনটেন্ট' when 'abuse' then 'হয়রানি/গালিগালাজ' when 'spam' then 'স্প্যাম' else '' end;
  rsk := case when score >= 4 then 'high' when score >= 2 then 'medium' else 'low' end;
  rec := case when score = 0 then 'no_action' when score >= 4 and p_kind in ('post','comment','message') then 'remove_content' else 'warn' end;
  kindbn := case p_kind when 'post' then 'পোস্ট' when 'comment' then 'মন্তব্য' when 'message' then 'মেসেজ' else 'কার্যক্রম' end;
  if top <> '' then
    draft := 'FYNZA কমিউনিটি নিয়ম লঙ্ঘন (' || label || '): আপনার একটি ' || kindbn || ' আমাদের নিয়ম ভঙ্গ করেছে। সংশ্লিষ্ট কনটেন্ট: "' ||
             left(coalesce(p_text,''), 200) || '"। অনুগ্রহ করে নিয়ম মেনে চলুন; পুনরাবৃত্তি হলে অ্যাকাউন্টে ব্যবস্থা নেওয়া হতে পারে।';
  end if;
  select count(*) into priors from public.warnings where user_id = p_user;
  insert into public.moderation_cases (source, kind, target_id, target_user, risk, rule_violated, recommended, draft_warning, evidence, report_count)
  values (p_source, p_kind, p_target, p_user, rsk, label, rec, draft,
    jsonb_build_object('text', left(coalesce(p_text,''), 500), 'score', score, 'matches', ev -> 'matches', 'prior_warnings', priors,
      'reporter_reason', left(coalesce(p_reason,''), 300),
      'note', case when score = 0 then 'স্বয়ংক্রিয় যাচাইয়ে নিয়ম-ভঙ্গের স্পষ্ট প্রমাণ মেলেনি; Admin নিজে দেখে সিদ্ধান্ত নিন।' else '' end),
    case when p_source = 'report' then 1 else 0 end)
  on conflict (kind, target_id) where status = 'pending'
  do update set report_count = public.moderation_cases.report_count + (case when p_source = 'report' then 1 else 0 end);
end $$;

create or replace function public.guardian_on_report() returns trigger
language plpgsql security definer set search_path = public as $$
declare txt text; uid uuid;
begin
  if new.kind = 'post' then select body, author_id into txt, uid from public.posts where id::text = new.target_id;
  elsif new.kind = 'comment' then select body, author_id into txt, uid from public.comments where id::text = new.target_id;
  elsif new.kind = 'message' then select body, sender_id into txt, uid from public.messages where id::text = new.target_id and deleted_at is null;
  elsif new.kind = 'user' then select coalesce(name,'') || ' ' || coalesce(bio,''), id into txt, uid from public.profiles where id::text = new.target_id;
  elsif new.kind = 'group' then select coalesce(name,'') || ' ' || coalesce(description,''), owner_id into txt, uid from public.groups where id::text = new.target_id;
  elsif new.kind = 'page' then select coalesce(name,'') || ' ' || coalesce(description,''), owner_id into txt, uid from public.pages where id::text = new.target_id;
  end if;
  if uid is not null then perform public._guardian_case('report', new.kind, new.target_id, uid, txt, new.id, new.reason); end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists guardian_report on public.reports;
create trigger guardian_report after insert on public.reports for each row execute function public.guardian_on_report();

create or replace function public.guardian_on_post() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if new.body <> '' then
    select count(*) into n from public.posts where author_id = new.author_id and body = new.body and created_at > now() - interval '1 hour';
  end if;
  perform public._guardian_case('auto', 'post', new.id::text, new.author_id, new.body, null, '',
    case when n >= 3 then 3 else 0 end, case when n >= 3 then 'spam' end);
  return new;
exception when others then return new;
end $$;
drop trigger if exists guardian_post on public.posts;
create trigger guardian_post after insert on public.posts for each row execute function public.guardian_on_post();

create or replace function public.guardian_on_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.comments where author_id = new.author_id and body = new.body and created_at > now() - interval '1 hour';
  perform public._guardian_case('auto', 'comment', new.id::text, new.author_id, new.body, null, '',
    case when n >= 3 then 3 else 0 end, case when n >= 3 then 'spam' end);
  return new;
exception when others then return new;
end $$;
drop trigger if exists guardian_comment on public.comments;
create trigger guardian_comment after insert on public.comments for each row execute function public.guardian_on_comment();

create or replace function public.admin_cases(p_status text default 'pending')
returns table (id uuid, source text, kind text, target_id text, target_user uuid, target_username text, risk text, rule_violated text,
  recommended text, draft_warning text, evidence jsonb, report_count int, status text, decision text, decision_note text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select c.id, c.source, c.kind, c.target_id, c.target_user, u.username, c.risk, c.rule_violated, c.recommended, c.draft_warning,
    c.evidence, c.report_count, c.status, c.decision, c.decision_note, c.created_at
  from public.moderation_cases c left join public.profiles u on u.id = c.target_user
  where p_status = 'all' or c.status = p_status
  order by (c.risk = 'high') desc, c.created_at desc limit 100;
end $$;

-- the ONLY way an action happens: a signed-in admin (with 2FA) chooses it
create or replace function public.admin_decide_case(p_id uuid, p_decision text, p_message text default '', p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c public.moderation_cases; msg text;
begin
  perform public._admin_check();
  select * into c from public.moderation_cases where id = p_id for update;
  if not found or c.status <> 'pending' then raise exception 'case not pending'; end if;
  if p_decision not in ('reject','warn','remove','suspend') then raise exception 'bad decision'; end if;
  if p_decision = 'reject' then
    update public.moderation_cases set status = 'rejected', decision = 'reject', decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(p_note,'') where id = p_id;
    update public.reports set status = 'dismissed', handled_by = auth.uid(), handled_at = now(), admin_note = 'AI সুপারিশ বাতিল'
      where kind = c.kind and target_id = c.target_id and status = 'open';
  else
    if c.target_user is null then raise exception 'no user to act on'; end if;
    if p_decision = 'warn' then
      msg := coalesce(nullif(trim(p_message), ''), nullif(c.draft_warning, ''));
      if msg is null then raise exception 'write the warning message'; end if;
      insert into public.warnings (user_id, case_id, message, content_snapshot, rule, approved_by)
        values (c.target_user, c.id, left(msg, 1000), left(coalesce(c.evidence ->> 'text',''), 300), c.rule_violated, auth.uid());
      insert into public.notifications (user_id, type, text) values (c.target_user, 'system', '⚠ সতর্কবার্তা: ' || left(msg, 300));
    elsif p_decision = 'remove' then
      if c.kind not in ('post','comment','message') then raise exception 'this kind cannot be removed'; end if;
      perform public.admin_remove_content(c.kind, c.target_id, coalesce(p_note,''));
      insert into public.notifications (user_id, type, text) values (c.target_user, 'system',
        '⚠ আপনার একটি কনটেন্ট কমিউনিটি নিয়ম ভাঙার কারণে সরানো হয়েছে' || case when c.rule_violated <> '' then ' (' || c.rule_violated || ')' else '' end || '।');
    else
      perform public.admin_set_ban(c.target_user, true, coalesce(p_note,''));
    end if;
    update public.moderation_cases set status = 'approved', decision = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = coalesce(p_note,'') where id = p_id;
    update public.reports set status = 'resolved', handled_by = auth.uid(), handled_at = now(), admin_note = 'Admin approved: ' || p_decision
      where kind = c.kind and target_id = c.target_id and status = 'open';
  end if;
  perform public._admin_log('case_' || p_decision, p_id::text, p_note);
end $$;

create or replace function public.admin_warnings(p_user uuid default null)
returns table (id uuid, user_id uuid, username text, message text, rule text, content_snapshot text, created_at timestamptz, approved_by_username text)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select w.id, w.user_id, u.username, w.message, w.rule, w.content_snapshot, w.created_at, a.username
  from public.warnings w join public.profiles u on u.id = w.user_id left join public.profiles a on a.id = w.approved_by
  where p_user is null or w.user_id = p_user order by w.created_at desc limit 100;
end $$;

-- signals for human review; never a verdict ("fake") and never an automatic action
create or replace function public.admin_suspicious_accounts()
returns table (id uuid, username text, name text, created_at timestamptz, signals text[])
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select s.id, s.username, s.name, s.created_at, s.signals from (
    select p.id, p.username, p.name, p.created_at, array_remove(array[
      case when p.created_at > now() - interval '2 days' and (select count(*) from public.posts x where x.author_id = p.id) >= 15 then 'নতুন অ্যাকাউন্টে অস্বাভাবিক বেশি পোস্ট' end,
      case when (select count(*) from public.friendships f where f.requester_id = p.id and f.created_at > now() - interval '1 day') >= 30 then '২৪ ঘণ্টায় অনেক ফ্রেন্ড রিকোয়েস্ট' end,
      case when (select count(distinct r.reporter_id) from public.reports r where r.kind = 'user' and r.target_id = p.id::text) >= 3 then 'একাধিক ব্যক্তি রিপোর্ট করেছে' end
    ], null) as signals
    from public.profiles p where not p.banned) s
  where coalesce(array_length(s.signals, 1), 0) > 0 order by s.created_at desc limit 50;
end $$;

create or replace function public.admin_security_summary()
returns table (active_lockouts bigint, new_device_logins_24h bigint, open_cases bigint, pending_verifications bigint, admins_without_2fa bigint)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query select
    (select count(*) from public.login_attempts la where la.locked_until > now()),
    (select count(*) from public.security_events se where se.kind = 'login_new_device' and se.created_at > now() - interval '1 day'),
    (select count(*) from public.moderation_cases mc where mc.status = 'pending'),
    (select count(*) from public.verification_applications va where va.status = 'pending'),
    (select count(*) from public.profiles p where p.role = 'admin' and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'));
end $$;

-- ---------- storage: private identity bucket + server-enforced size / type limits ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('verify', 'verify', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
update storage.buckets set file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'] where id in ('avatars','covers');
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime'] where id in ('posts','stories');
update storage.buckets set file_size_limit = 52428800, allowed_mime_types = array['video/mp4','video/webm','video/quicktime'] where id = 'reels';
update storage.buckets set file_size_limit = 26214400, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
  'audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav','audio/x-m4a','application/pdf','text/plain','application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'] where id = 'chat';

drop policy if exists fynza_verify_insert on storage.objects;
create policy fynza_verify_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'verify' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists fynza_verify_select on storage.objects;
create policy fynza_verify_select on storage.objects for select to authenticated
  using (bucket_id = 'verify' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_session()));
drop policy if exists fynza_verify_delete on storage.objects;
create policy fynza_verify_delete on storage.objects for delete to authenticated
  using (bucket_id = 'verify' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin_session()));

-- ---------- privileges (least privilege) ----------
revoke truncate, references, trigger on all tables in schema public from authenticated, anon;
revoke all on public.app_settings, public.verification_applications, public.badge_grants, public.security_events,
  public.login_attempts, public.moderation_cases, public.warnings from anon;
revoke insert, update, delete on public.app_settings, public.verification_applications, public.badge_grants, public.security_events,
  public.moderation_cases, public.warnings from authenticated;
revoke all on public.login_attempts from authenticated;

do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('is_admin_session','_admin_check','admin_set_setting','protect_page_verified','submit_verification',
      'admin_verifications','admin_review_verification','admin_grant_badge','admin_revoke_badge','admin_badge_history','log_security_event',
      'login_status','login_failed','login_reset','export_my_data','delete_my_account','guardian_eval','_guardian_case','guardian_on_report',
      'guardian_on_post','guardian_on_comment','admin_cases','admin_decide_case','admin_warnings','admin_suspicious_accounts','admin_security_summary')
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname in ('protect_page_verified','_guardian_case','guardian_on_report','guardian_on_post','guardian_on_comment','_admin_check') then
      execute format('revoke all on function %s from authenticated', f.sig);
    else
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if f.proname in ('login_status','login_failed') then execute format('grant execute on function %s to anon', f.sig); end if;
  end loop;
end $$;
