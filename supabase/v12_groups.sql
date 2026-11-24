-- =====================================================================
-- FYNZA v12 groups (migrations fynza_20_groups_*): Facebook-like, server-enforced groups
-- Roles: owner > admin > moderator > member
-- =====================================================================

-- ---------- columns ----------
alter table public.groups add column if not exists cover_url text not null default '';
alter table public.groups add column if not exists avatar_url text not null default '';
alter table public.groups add column if not exists rules text not null default '';
alter table public.groups add column if not exists approval_required boolean not null default false;
alter table public.groups add column if not exists post_approval boolean not null default false;
do $$ begin
  begin alter table public.groups add constraint groups_rules_len check (char_length(rules) <= 1000); exception when duplicate_object then null; end;
  begin alter table public.groups add constraint groups_img_len check (char_length(cover_url) <= 500 and char_length(avatar_url) <= 500); exception when duplicate_object then null; end;
end $$;

do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'public.group_members'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%' loop
    execute format('alter table public.group_members drop constraint %I', c);
  end loop;
  alter table public.group_members add constraint group_members_role_check check (role in ('owner','admin','moderator','member'));
end $$;
alter table public.group_members add column if not exists muted_until timestamptz;

alter table public.posts add column if not exists pinned_in_group boolean not null default false;
alter table public.posts add column if not exists group_pending boolean not null default false;

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz not null default now(),
  decided_by uuid references public.profiles(id) on delete set null,
  unique (group_id, user_id)
);
create index if not exists gjr_group_idx on public.group_join_requests (group_id, status);
create table if not exists public.group_bans (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id) on delete set null,
  reason text not null default '' check (char_length(reason) <= 200),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
alter table public.group_join_requests enable row level security;
alter table public.group_bans enable row level security;

-- ---------- helpers ----------
create or replace function public.group_role(g uuid, u uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.group_members where group_id = g and user_id = u;
$$;
create or replace function public.group_rank(r text) returns int
language sql immutable as $$
  select case r when 'owner' then 4 when 'admin' then 3 when 'moderator' then 2 when 'member' then 1 else 0 end;
$$;
create or replace function public.is_group_mod(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.group_role(g, u) in ('owner','admin','moderator'), false);
$$;
create or replace function public.is_group_admin(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.group_role(g, u) in ('owner','admin'), false);
$$;
create or replace function public.is_group_banned(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_bans where group_id = g and user_id = u);
$$;
create or replace function public.group_open_join(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select privacy = 'public' and not approval_required from public.groups where id = g), false);
$$;
create or replace function public.group_is_muted(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select muted_until > now() from public.group_members where group_id = g and user_id = u), false);
$$;

-- private groups ALWAYS require approval
create or replace function public.groups_force_approval() returns trigger
language plpgsql as $$
begin
  if new.privacy = 'private' then new.approval_required := true; end if;
  return new;
end $$;
drop trigger if exists groups_force_approval on public.groups;
create trigger groups_force_approval before insert or update on public.groups
  for each row execute function public.groups_force_approval();
update public.groups set approval_required = true where privacy = 'private';

-- ---------- posts: pinned / pending can only be changed by group staff ----------
create or replace function public.posts_group_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare g public.groups%rowtype;
begin
  if tg_op = 'INSERT' then
    new.pinned_in_group := false; new.group_pending := false;
    if new.group_id is not null then
      select * into g from public.groups where id = new.group_id;
      if g.post_approval and not public.is_group_mod(new.group_id, new.author_id) then new.group_pending := true; end if;
    end if;
    return new;
  end if;
  if new.group_id is distinct from old.group_id then raise exception 'a post cannot be moved to another group'; end if;
  if auth.uid() is not null then
    if new.pinned_in_group is distinct from old.pinned_in_group and not public.is_group_admin(old.group_id, auth.uid()) then
      raise exception 'only group admins can pin posts';
    end if;
    if new.group_pending is distinct from old.group_pending and not public.is_group_mod(old.group_id, auth.uid()) then
      raise exception 'only group staff can approve posts';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists posts_group_guard on public.posts;
create trigger posts_group_guard before insert or update on public.posts
  for each row execute function public.posts_group_guard();

create or replace function public.can_view_post(pid uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.profiles a on a.id = p.author_id
    where p.id = pid
      and not public.is_blocked(viewer, p.author_id)
      and (
        p.author_id = viewer
        or (p.group_id is not null and (public.is_group_member(p.group_id, viewer) or public.group_is_public(p.group_id))
            and (not p.group_pending or public.is_group_mod(p.group_id, viewer)))
        or (p.group_id is null and (
              (p.audience = 'public' and (a.is_public or public.is_friend(viewer, p.author_id)))
           or (p.audience = 'friends' and public.is_friend(viewer, p.author_id))))
      )
  );
$$;

-- ---------- RLS ----------
drop policy if exists groups_update on public.groups;           -- edits go through update_group()
drop policy if exists gm_insert on public.group_members;        -- direct self-join only for open public groups
create policy gm_insert on public.group_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member' and public.group_open_join(group_id) and not public.is_group_banned(group_id, auth.uid()));
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');
drop policy if exists gjr_select on public.group_join_requests;
create policy gjr_select on public.group_join_requests for select to authenticated
  using (user_id = auth.uid() or public.is_group_mod(group_id, auth.uid()));
drop policy if exists gb_select on public.group_bans;
create policy gb_select on public.group_bans for select to authenticated using (public.is_group_admin(group_id, auth.uid()));

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = auth.uid()
    and (group_id is null or (public.is_group_member(group_id, auth.uid()) and not public.group_is_muted(group_id, auth.uid())))
    and (page_id is null or exists (select 1 from public.pages pg where pg.id = page_id and pg.owner_id = auth.uid()))
    and (shared_post_id is null or public.can_view_post(shared_post_id, auth.uid())));

drop trigger if exists ban_guard on public.group_join_requests;
create trigger ban_guard before insert on public.group_join_requests for each row execute function public.ban_guard();
drop trigger if exists rate_guard on public.group_join_requests;
create trigger rate_guard before insert on public.group_join_requests for each row execute function public.rate_guard('user_id', '20');

-- friends can still be added by owner/admin, but never banned users
create or replace function public.add_group_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or p_group is null or p_user is null then raise exception 'invalid request'; end if;
  if not public.is_group_admin(p_group, me) then raise exception 'only the group owner or an admin can add members'; end if;
  if not public.is_friend(me, p_user) then raise exception 'you can only add friends'; end if;
  if public.is_group_banned(p_group, p_user) then raise exception 'this user is banned from the group'; end if;
  insert into public.group_members (group_id, user_id, role) values (p_group, p_user, 'member') on conflict do nothing;
  delete from public.group_join_requests where group_id = p_group and user_id = p_user;
end $$;

-- ---------- RPCs ----------
create or replace function public._gname(g uuid) returns text
language sql stable security definer set search_path = public as $$ select name from public.groups where id = g; $$;

create or replace function public.request_join_group(p_group uuid, p_message text default '') returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); g public.groups%rowtype; r record;
begin
  if me is null then raise exception 'not logged in'; end if;
  if public.is_banned(me) then raise exception 'account suspended'; end if;
  select * into g from public.groups where id = p_group;
  if not found then raise exception 'group not found'; end if;
  if public.is_group_member(p_group, me) then return 'joined'; end if;
  if public.is_group_banned(p_group, me) then raise exception 'you cannot join this group'; end if;
  if public.is_blocked(me, g.owner_id) then raise exception 'you cannot join this group'; end if;
  if g.privacy = 'public' and not g.approval_required then
    insert into public.group_members (group_id, user_id, role) values (p_group, me, 'member') on conflict do nothing;
    return 'joined';
  end if;
  if exists (select 1 from public.group_join_requests where group_id = p_group and user_id = me and status = 'pending') then return 'requested'; end if;
  delete from public.group_join_requests where group_id = p_group and user_id = me;
  insert into public.group_join_requests (group_id, user_id, message) values (p_group, me, left(coalesce(p_message,''), 300));
  for r in select user_id from public.group_members where group_id = p_group and role in ('owner','admin') loop
    insert into public.notifications (user_id, actor_id, type, text)
    values (r.user_id, me, 'system', 'asked to join "' || g.name || '". Review the request in the group.');
  end loop;
  return 'requested';
end $$;

create or replace function public.cancel_join_request(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  delete from public.group_join_requests where group_id = p_group and user_id = auth.uid() and status = 'pending';
end $$;

create or replace function public.decide_join_request(p_request uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); q public.group_join_requests%rowtype; nm text;
begin
  if me is null then raise exception 'not logged in'; end if;
  select * into q from public.group_join_requests where id = p_request for update;
  if not found or q.status <> 'pending' then raise exception 'request not found or already decided'; end if;
  if not public.is_group_mod(q.group_id, me) then raise exception 'only group staff can review requests'; end if;
  nm := public._gname(q.group_id);
  if p_approve then
    if public.is_group_banned(q.group_id, q.user_id) then raise exception 'this user is banned from the group'; end if;
    insert into public.group_members (group_id, user_id, role) values (q.group_id, q.user_id, 'member') on conflict do nothing;
    update public.group_join_requests set status = 'approved', decided_by = me where id = p_request;
    insert into public.notifications (user_id, actor_id, type, text) values (q.user_id, me, 'system', 'approved your request to join "' || nm || '".');
  else
    update public.group_join_requests set status = 'declined', decided_by = me where id = p_request;
    insert into public.notifications (user_id, actor_id, type, text) values (q.user_id, me, 'system', 'declined your request to join "' || nm || '".');
  end if;
end $$;

create or replace function public.set_member_role(p_group uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mr text; tr text;
begin
  if me is null then raise exception 'not logged in'; end if;
  if p_role not in ('admin','moderator','member') then raise exception 'invalid role'; end if;
  mr := public.group_role(p_group, me); tr := public.group_role(p_group, p_user);
  if tr is null then raise exception 'not a member'; end if;
  if tr = 'owner' or p_user = me then raise exception 'cannot change this member''s role'; end if;
  if mr = 'owner' then null;
  elsif mr = 'admin' then
    if p_role = 'admin' or tr = 'admin' then raise exception 'only the owner can manage admins'; end if;
  else raise exception 'not allowed'; end if;
  update public.group_members set role = p_role where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.remove_group_member(p_group uuid, p_user uuid, p_ban boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mr text; tr text;
begin
  if me is null then raise exception 'not logged in'; end if;
  mr := public.group_role(p_group, me); tr := public.group_role(p_group, p_user);
  if mr not in ('owner','admin') then raise exception 'only admins can remove members'; end if;
  if p_user = me or tr = 'owner' or public.group_rank(tr) >= public.group_rank(mr) then raise exception 'you cannot remove this member'; end if;
  delete from public.group_members where group_id = p_group and user_id = p_user;
  if p_ban then
    insert into public.group_bans (group_id, user_id, banned_by) values (p_group, p_user, me) on conflict do nothing;
  end if;
  delete from public.group_join_requests where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.unban_group_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(p_group, auth.uid()) then raise exception 'only admins can unban'; end if;
  delete from public.group_bans where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.mute_group_member(p_group uuid, p_user uuid, p_hours int) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); mr text; tr text;
begin
  if me is null then raise exception 'not logged in'; end if;
  mr := public.group_role(p_group, me); tr := public.group_role(p_group, p_user);
  if mr not in ('owner','admin','moderator') then raise exception 'only group staff can mute members'; end if;
  if tr is null or p_user = me or public.group_rank(tr) >= public.group_rank(mr) then raise exception 'you cannot mute this member'; end if;
  update public.group_members set muted_until = case when coalesce(p_hours,0) <= 0 then null else now() + make_interval(hours => least(p_hours, 24*30)) end
   where group_id = p_group and user_id = p_user;
end $$;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if public.group_role(p_group, auth.uid()) = 'owner' then raise exception 'the owner cannot leave the group'; end if;
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
end $$;

create or replace function public.update_group(p_group uuid, p_name text default null, p_description text default null, p_rules text default null,
  p_privacy text default null, p_cover text default null, p_avatar text default null, p_approval boolean default null, p_post_approval boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not logged in'; end if;
  if not public.is_group_admin(p_group, auth.uid()) then raise exception 'only group admins can edit the group'; end if;
  if p_privacy is not null and p_privacy not in ('public','private') then raise exception 'invalid privacy'; end if;
  if p_name is not null and char_length(trim(p_name)) < 3 then raise exception 'name must be at least 3 characters'; end if;
  update public.groups set
    name = coalesce(left(trim(p_name), 80), name),
    description = coalesce(left(p_description, 300), description),
    rules = coalesce(left(p_rules, 1000), rules),
    privacy = coalesce(p_privacy, privacy),
    cover_url = coalesce(p_cover, cover_url),
    avatar_url = coalesce(p_avatar, avatar_url),
    approval_required = coalesce(p_approval, approval_required),
    post_approval = coalesce(p_post_approval, post_approval)
  where id = p_group;
end $$;

create or replace function public.delete_group_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p record; mr text;
begin
  if me is null then raise exception 'not logged in'; end if;
  select id, author_id, group_id into p from public.posts where id = p_post;
  if not found or p.group_id is null then raise exception 'not a group post'; end if;
  mr := public.group_role(p.group_id, me);
  if mr not in ('owner','admin','moderator') then raise exception 'only group staff can remove posts'; end if;
  if p.author_id <> me and public.group_rank(public.group_role(p.group_id, p.author_id)) >= public.group_rank(mr) then raise exception 'you cannot remove this post'; end if;
  delete from public.posts where id = p_post;
end $$;

create or replace function public.pin_group_post(p_post uuid, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select group_id into g from public.posts where id = p_post;
  if g is null then raise exception 'not a group post'; end if;
  if not public.is_group_admin(g, auth.uid()) then raise exception 'only group admins can pin posts'; end if;
  if p_pinned then update public.posts set pinned_in_group = false where group_id = g and pinned_in_group; end if;
  update public.posts set pinned_in_group = p_pinned where id = p_post;
end $$;

create or replace function public.decide_group_post(p_post uuid, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p record; me uuid := auth.uid(); nm text;
begin
  select id, author_id, group_id, group_pending into p from public.posts where id = p_post;
  if not found or p.group_id is null or not p.group_pending then raise exception 'post is not waiting for approval'; end if;
  if not public.is_group_mod(p.group_id, me) then raise exception 'only group staff can review posts'; end if;
  nm := public._gname(p.group_id);
  if p_approve then
    update public.posts set group_pending = false where id = p_post;
    insert into public.notifications (user_id, actor_id, type, post_id, text) values (p.author_id, me, 'system', p_post, 'approved your post in "' || nm || '".');
  else
    delete from public.posts where id = p_post;
    insert into public.notifications (user_id, actor_id, type, text) values (p.author_id, me, 'system', 'declined your post in "' || nm || '".');
  end if;
end $$;

-- discovery / details (private groups expose ONLY name, privacy, description, images, member count)
create or replace function public.list_groups(p_scope text default 'mine') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
begin
  if me is null then raise exception 'not logged in'; end if;
  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) into out from (
    select jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'privacy', g.privacy,
      'avatar_url', g.avatar_url, 'cover_url', g.cover_url, 'owner_id', g.owner_id, 'created_at', g.created_at,
      'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
      'my_role', public.group_role(g.id, me),
      'request_status', (select r.status from public.group_join_requests r where r.group_id = g.id and r.user_id = me)) as x
    from public.groups g
    where case when p_scope = 'mine' then public.is_group_member(g.id, me)
               else not public.is_group_member(g.id, me) and not public.is_group_banned(g.id, me) end
    order by g.created_at desc limit 100
  ) s;
  return out;
end $$;

create or replace function public.group_detail(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); g public.groups%rowtype; seeing boolean;
begin
  if me is null then raise exception 'not logged in'; end if;
  select * into g from public.groups where id = p_group;
  if not found or public.is_group_banned(p_group, me) then return null; end if;
  seeing := g.privacy = 'public' or public.is_group_member(p_group, me);
  return jsonb_build_object('id', g.id, 'name', g.name, 'description', g.description, 'privacy', g.privacy,
    'avatar_url', g.avatar_url, 'cover_url', g.cover_url, 'owner_id', g.owner_id, 'created_at', g.created_at,
    'member_count', (select count(*) from public.group_members m where m.group_id = g.id),
    'my_role', public.group_role(p_group, me),
    'muted_until', (select muted_until from public.group_members where group_id = p_group and user_id = me),
    'request_status', (select r.status from public.group_join_requests r where r.group_id = p_group and r.user_id = me),
    'can_see', seeing,
    'rules', case when seeing then g.rules else '' end,
    'approval_required', g.approval_required, 'post_approval', g.post_approval);
end $$;

-- grants
do $$ declare f text; begin
  foreach f in array array[
    'request_join_group(uuid,text)','cancel_join_request(uuid)','decide_join_request(uuid,boolean)','set_member_role(uuid,uuid,text)',
    'remove_group_member(uuid,uuid,boolean)','unban_group_member(uuid,uuid)','mute_group_member(uuid,uuid,int)','leave_group(uuid)',
    'update_group(uuid,text,text,text,text,text,text,boolean,boolean)','delete_group_post(uuid)','pin_group_post(uuid,boolean)',
    'decide_group_post(uuid,boolean)','list_groups(text)','group_detail(uuid)','add_group_member(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public._gname(uuid), public.posts_group_guard(), public.groups_force_approval() from public, anon, authenticated;
