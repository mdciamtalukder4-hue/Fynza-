-- =====================================================================
-- Phase 10: FYNZA Messenger v2
-- replies, reactions, edit/delete, delivered/seen, typing, last seen,
-- voice/file/video/sticker messages, 1:1 voice/video calls (WebRTC signalling)
-- Safe to re-run.
-- =====================================================================

-- ---------- messages ----------
alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists kind text not null default 'text';
alter table public.messages add column if not exists file_name text not null default '';
alter table public.messages add column if not exists duration int not null default 0;
alter table public.messages add column if not exists edited_at timestamptz;
alter table public.messages add column if not exists deleted_at timestamptz;
do $$ begin
  alter table public.messages add constraint messages_kind_chk check (kind in ('text','image','video','file','voice','sticker'));
exception when duplicate_object then null; end $$;
alter table public.messages drop constraint if exists messages_check;
alter table public.messages drop constraint if exists messages_content_chk;
alter table public.messages add constraint messages_content_chk check (deleted_at is not null or body <> '' or media_url <> '');

-- ---------- settings: privacy for seen / last seen ----------
alter table public.user_settings add column if not exists show_last_seen boolean not null default true;
alter table public.user_settings add column if not exists show_read_receipts boolean not null default true;

-- ---------- receipts ----------
alter table public.conversation_members add column if not exists last_read_at timestamptz not null default now();
alter table public.conversation_members add column if not exists last_delivered_at timestamptz not null default now();

-- ---------- helpers ----------
create or replace function public.msg_conv(mid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select conversation_id from public.messages where id = mid;
$$;
create or replace function public.conv_blocked(c uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations cv
    join public.conversation_members m on m.conversation_id = cv.id and m.user_id <> u
    where cv.id = c and not cv.is_group and public.is_blocked(u, m.user_id));
$$;

-- blocked people cannot message each other in a 1:1 chat
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conv_member(conversation_id, auth.uid())
    and not public.conv_blocked(conversation_id, auth.uid())
    and (reply_to is null or public.msg_conv(reply_to) = conversation_id));

-- ---------- reactions ----------
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;
drop policy if exists mr_select on public.message_reactions;
create policy mr_select on public.message_reactions for select to authenticated
  using (public.is_conv_member(public.msg_conv(message_id), auth.uid()));
drop policy if exists mr_insert on public.message_reactions;
create policy mr_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_conv_member(public.msg_conv(message_id), auth.uid())
    and not public.conv_blocked(public.msg_conv(message_id), auth.uid()));
drop policy if exists mr_update on public.message_reactions;
create policy mr_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mr_delete on public.message_reactions;
create policy mr_delete on public.message_reactions for delete to authenticated using (user_id = auth.uid());

-- ---------- edit / delete (only your own messages) ----------
create or replace function public.edit_message(p_id uuid, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_body),'') = '' or char_length(p_body) > 4000 then raise exception 'invalid message'; end if;
  update public.messages set body = p_body, edited_at = now()
   where id = p_id and sender_id = auth.uid() and deleted_at is null and kind = 'text'
     and public.is_conv_member(conversation_id, auth.uid());
  if not found then raise exception 'cannot edit this message'; end if;
end $$;

create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.messages set body = '', media_url = '', file_name = '', duration = 0, deleted_at = now()
   where id = p_id and sender_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'cannot delete this message'; end if;
  delete from public.message_reactions where message_id = p_id;
end $$;

-- ---------- delivered / seen ----------
create or replace function public.mark_delivered() returns void
language sql security definer set search_path = public as $$
  update public.conversation_members set last_delivered_at = now() where user_id = auth.uid();
$$;
create or replace function public.mark_chat_read(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.conversation_members set last_delivered_at = now(),
    last_read_at = case when coalesce((select show_read_receipts from public.user_settings where user_id = auth.uid()), true) then now() else last_read_at end
   where conversation_id = p_conv and user_id = auth.uid();
end $$;

-- ---------- typing ----------
create table if not exists public.typing (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.typing enable row level security;
drop policy if exists typing_select on public.typing;
create policy typing_select on public.typing for select to authenticated
  using (user_id <> auth.uid() and at > now() - interval '6 seconds' and public.is_conv_member(conversation_id, auth.uid()));
create or replace function public.set_typing(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conv_member(p_conv, auth.uid()) then return; end if;
  insert into public.typing (conversation_id, user_id, at) values (p_conv, auth.uid(), now())
  on conflict (conversation_id, user_id) do update set at = now();
end $$;

-- ---------- presence / last seen ----------
create table if not exists public.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.presence enable row level security;   -- no policies: only the functions below can read/write
create or replace function public.touch_presence() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.presence (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();
end $$;
-- Only friends / people you chat with, only if THEY and YOU both share last seen, never blocked people
create or replace function public.get_presence(p_ids uuid[]) returns table (user_id uuid, last_seen_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.user_id, p.last_seen_at from public.presence p
  where p.user_id = any(p_ids) and auth.uid() is not null
    and not public.is_blocked(auth.uid(), p.user_id)
    and coalesce((select show_last_seen from public.user_settings where user_id = p.user_id), true)
    and coalesce((select show_last_seen from public.user_settings where user_id = auth.uid()), true)
    and (public.is_friend(auth.uid(), p.user_id) or exists (
      select 1 from public.conversation_members a join public.conversation_members b on b.conversation_id = a.conversation_id
      where a.user_id = auth.uid() and b.user_id = p.user_id));
$$;

-- ---------- leave a group chat ----------
create or replace function public.leave_chat(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.conversations where id = p_conv and is_group) then raise exception 'not a group chat'; end if;
  delete from public.conversation_members where conversation_id = p_conv and user_id = auth.uid();
end $$;

-- ---------- 1:1 calls (WebRTC signalling) ----------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','ended','missed')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz,
  check (caller_id <> callee_id)
);
create index if not exists calls_callee_idx on public.calls (callee_id, created_at desc);
create table if not exists public.call_signals (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('offer','answer','ice')),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists call_signals_call_idx on public.call_signals (call_id, id);
alter table public.calls enable row level security;
alter table public.call_signals enable row level security;
drop policy if exists calls_select on public.calls;
create policy calls_select on public.calls for select to authenticated using (caller_id = auth.uid() or callee_id = auth.uid());
drop policy if exists signals_select on public.call_signals;
create policy signals_select on public.call_signals for select to authenticated using (to_id = auth.uid());
drop policy if exists signals_insert on public.call_signals;
create policy signals_insert on public.call_signals for insert to authenticated
  with check (from_id = auth.uid() and exists (
    select 1 from public.calls c where c.id = call_id and c.status in ('ringing','accepted')
      and ((c.caller_id = auth.uid() and c.callee_id = to_id) or (c.callee_id = auth.uid() and c.caller_id = to_id))));

create or replace function public.start_call(p_conv uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); other uuid; cid uuid;
begin
  if me is null or p_kind not in ('audio','video') then raise exception 'invalid call'; end if;
  if public.is_banned(me) then raise exception 'account suspended'; end if;
  select m.user_id into other from public.conversations cv
    join public.conversation_members m on m.conversation_id = cv.id and m.user_id <> me
    where cv.id = p_conv and not cv.is_group and public.is_conv_member(cv.id, me);
  if other is null then raise exception 'calls work only in one-to-one chats'; end if;
  if public.is_blocked(me, other) then raise exception 'blocked'; end if;
  update public.calls set status = 'missed', ended_at = now() where status = 'ringing' and created_at < now() - interval '45 seconds';
  if exists (select 1 from public.calls where status in ('ringing','accepted') and ended_at is null
             and (caller_id in (me, other) or callee_id in (me, other)) and created_at > now() - interval '4 hours') then
    raise exception 'line busy';
  end if;
  insert into public.calls (conversation_id, caller_id, callee_id, kind) values (p_conv, me, other, p_kind) returning id into cid;
  return cid;
end $$;

create or replace function public.set_call_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare c public.calls;
begin
  select * into c from public.calls where id = p_id and (caller_id = auth.uid() or callee_id = auth.uid());
  if not found then raise exception 'call not found'; end if;
  if p_status = 'accepted' and c.callee_id = auth.uid() and c.status = 'ringing' then
    update public.calls set status = 'accepted', answered_at = now() where id = p_id;
  elsif p_status = 'declined' and c.callee_id = auth.uid() and c.status = 'ringing' then
    update public.calls set status = 'declined', ended_at = now() where id = p_id;
  elsif p_status = 'ended' and c.status in ('ringing','accepted') then
    update public.calls set status = case when c.status = 'ringing' then 'missed' else 'ended' end, ended_at = now() where id = p_id;
  end if;
end $$;

drop trigger if exists ban_guard on public.message_reactions;
create trigger ban_guard before insert on public.message_reactions for each row execute function public.ban_guard();

-- ---------- storage: chat files are readable only by chat members (and the uploader) ----------
update storage.buckets set file_size_limit = 26214400 where id = 'chat';
drop policy if exists fynza_chat_select on storage.objects;
create policy fynza_chat_select on storage.objects for select to authenticated
  using (bucket_id = 'chat' and ((storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.messages m where m.media_url = name and public.is_conv_member(m.conversation_id, auth.uid()))));

-- ---------- search_path hardening ----------
alter function public.protect_profile_role() set search_path = public;

-- ---------- privileges ----------
revoke all on public.presence, public.typing, public.message_reactions, public.calls, public.call_signals from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.username_available(text) to anon;
revoke execute on function public.handle_new_user(), public.notify_reaction(), public.notify_comment(),
  public.notify_friendship(), public.add_group_owner(), public.protect_profile_role() from authenticated;
revoke execute on function public.ban_guard(), public.rate_guard(), public._admin_check(), public._admin_log(text, text, text) from authenticated;
-- presence/typing/calls are written only through the functions above
revoke insert, update, delete on public.presence, public.typing, public.calls from authenticated;
revoke select on public.presence from authenticated;
revoke update, delete on public.call_signals from authenticated;

-- ---------- realtime publication (optional; the app also polls) ----------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.message_reactions; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.calls; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.call_signals; exception when duplicate_object then null; end;
  end if;
end $$;
