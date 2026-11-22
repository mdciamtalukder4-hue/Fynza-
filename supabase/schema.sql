-- =====================================================================
-- FYNZA database schema (Phase 3) for Supabase / PostgreSQL
-- Run this ONCE in: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to re-run: uses "if not exists" / "create or replace" / "drop policy if exists".
-- Security: Row Level Security (RLS) is ON for every table.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER: they read tables without RLS loops)
-- ---------------------------------------------------------------------
create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a));
$$;

-- ---------------------------------------------------------------------
-- Profiles + settings
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_.]{3,20}$'),
  name text not null check (char_length(name) between 2 and 60),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text not null default '',
  cover_url text not null default '',
  is_public boolean not null default true,
  role text not null default 'user' check (role in ('user','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  record_my_visits boolean not null default true,
  keep_visitors boolean not null default true,
  auto_delete_days int not null default 0 check (auto_delete_days in (0,7,30,90)),
  who_can_message text not null default 'everyone' check (who_can_message in ('everyone','friends')),
  post_audience text not null default 'public' check (post_audience in ('public','friends','me'))
);

-- Friends
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index if not exists friendships_pair_uq
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.friendships f where f.status = 'accepted'
    and ((f.requester_id = a and f.addressee_id = b) or (f.requester_id = b and f.addressee_id = a)));
$$;

create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('user','post','comment','group','page','message')),
  target_id text not null,
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

-- Auto-create profile + settings when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  uname text := lower(coalesce(new.raw_user_meta_data->>'username', ''));
  dname text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(coalesce(new.email,'user'), '@', 1));
begin
  if uname !~ '^[a-z0-9_.]{3,20}$' then
    uname := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10);
  end if;
  if char_length(dname) < 2 then dname := dname || '_'; end if;
  begin
    insert into public.profiles (id, username, name) values (new.id, uname, left(dname, 60));
  exception when unique_violation then
    insert into public.profiles (id, username, name)
    values (new.id, 'user_' || substr(replace(new.id::text, '-', ''), 1, 10), left(dname, 60));
  end;
  insert into public.user_settings (user_id) values (new.id);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Nobody can make themselves admin
create or replace function public.protect_profile_role() returns trigger
language plpgsql as $$
begin
  if new.role is distinct from old.role and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'role cannot be changed';
  end if;
  return new;
end $$;
drop trigger if exists protect_role on public.profiles;
create trigger protect_role before update on public.profiles
  for each row execute function public.protect_profile_role();

-- Username check usable before login (sign-up form)
create or replace function public.username_available(u text) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profiles where username = lower(u));
$$;

-- ---------------------------------------------------------------------
-- Groups & pages (needed by posts)
-- ---------------------------------------------------------------------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  description text not null default '' check (char_length(description) <= 300),
  privacy text not null default 'public' check (privacy in ('public','private')),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('member','admin','owner')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create or replace function public.is_group_member(g uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members where group_id = g and user_id = u);
$$;
create or replace function public.group_is_public(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select privacy = 'public' from public.groups where id = g), false);
$$;
create or replace function public.add_group_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;
drop trigger if exists group_owner_member on public.groups;
create trigger group_owner_member after insert on public.groups
  for each row execute function public.add_group_owner();

create table if not exists public.pages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 80),
  kind text not null default 'Creator' check (kind in ('Creator','Business')),
  description text not null default '' check (char_length(description) <= 300),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.page_followers (
  page_id uuid not null references public.pages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (page_id, user_id)
);

-- ---------------------------------------------------------------------
-- Posts, reactions, comments, saved
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 5000),
  media_url text not null default '',
  media_type text not null default '' check (media_type in ('','image','video')),
  audience text not null default 'public' check (audience in ('public','friends','me')),
  group_id uuid references public.groups(id) on delete cascade,
  page_id uuid references public.pages(id) on delete set null,
  shared_post_id uuid references public.posts(id) on delete set null,
  created_at timestamptz not null default now(),
  check (body <> '' or media_url <> '' or shared_post_id is not null)
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_author_idx on public.posts (author_id, created_at desc);

create or replace function public.can_view_post(pid uuid, viewer uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.posts p
    join public.profiles a on a.id = p.author_id
    where p.id = pid
      and not public.is_blocked(viewer, p.author_id)
      and (
        p.author_id = viewer
        or (p.group_id is not null and (public.is_group_member(p.group_id, viewer) or public.group_is_public(p.group_id)))
        or (p.group_id is null and (
              (p.audience = 'public' and (a.is_public or public.is_friend(viewer, p.author_id)))
           or (p.audience = 'friends' and public.is_friend(viewer, p.author_id))))
      )
  );
$$;

create table if not exists public.post_reactions (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'like' check (type in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create table if not exists public.saved_posts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

-- ---------------------------------------------------------------------
-- Stories (24 hours) and reels
-- ---------------------------------------------------------------------
create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 140),
  media_url text not null default '',
  bg text not null default '',
  created_at timestamptz not null default now(),
  check (body <> '' or media_url <> '')
);
create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  video_url text not null,
  caption text not null default '' check (char_length(caption) <= 120),
  created_at timestamptz not null default now()
);
create table if not exists public.reel_likes (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (reel_id, user_id)
);

-- ---------------------------------------------------------------------
-- Profile visitors ("Who viewed my profile")
-- ---------------------------------------------------------------------
create table if not exists public.profile_visits (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  visitor_id uuid not null references public.profiles(id) on delete cascade,
  visited_at timestamptz not null default now(),
  check (profile_id <> visitor_id)
);
create index if not exists visits_profile_idx on public.profile_visits (profile_id, visited_at desc);

-- ---------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete cascade,
  type text not null check (type in ('like','comment','share','friend_request','friend_accept','visit','system')),
  post_id uuid references public.posts(id) on delete cascade,
  text text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notif_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Messenger
-- ---------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  is_group boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 4000),
  media_url text not null default '',
  created_at timestamptz not null default now(),
  check (body <> '' or media_url <> '')
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

create or replace function public.is_conv_member(c uuid, u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_members where conversation_id = c and user_id = u);
$$;

-- =====================================================================
-- Triggers that create notifications
-- =====================================================================
create or replace function public.notify_reaction() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id) values (owner, new.user_id, 'like', new.post_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_reaction on public.post_reactions;
create trigger trg_notify_reaction after insert on public.post_reactions
  for each row execute function public.notify_reaction();

create or replace function public.notify_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, post_id) values (owner, new.author_id, 'comment', new.post_id);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_comment on public.comments;
create trigger trg_notify_comment after insert on public.comments
  for each row execute function public.notify_comment();

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, actor_id, type) values (new.addressee_id, new.requester_id, 'friend_request');
  elsif tg_op = 'UPDATE' and new.status = 'accepted' and old.status = 'pending' then
    insert into public.notifications (user_id, actor_id, type) values (new.requester_id, new.addressee_id, 'friend_accept');
    delete from public.notifications where user_id = new.addressee_id and actor_id = new.requester_id and type = 'friend_request';
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_friendship on public.friendships;
create trigger trg_notify_friendship after insert or update on public.friendships
  for each row execute function public.notify_friendship();

-- =====================================================================
-- RPC functions (called from the app)
-- =====================================================================
-- Record a profile visit, respecting both people's privacy settings
create or replace function public.record_visit(p_profile uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or me = p_profile then return; end if;
  if public.is_blocked(me, p_profile) then return; end if;
  if not coalesce((select record_my_visits from public.user_settings where user_id = me), true) then return; end if;
  if not coalesce((select keep_visitors from public.user_settings where user_id = p_profile), true) then return; end if;
  if exists (select 1 from public.profile_visits where profile_id = p_profile and visitor_id = me and visited_at > now() - interval '30 minutes') then return; end if;
  insert into public.profile_visits (profile_id, visitor_id) values (p_profile, me);
  insert into public.notifications (user_id, actor_id, type) values (p_profile, me, 'visit');
end $$;

-- My visitors (hides entries older than my auto-delete setting)
create or replace function public.my_visitors() returns table (id uuid, visitor_id uuid, visited_at timestamptz)
language sql stable security definer set search_path = public as $$
  select v.id, v.visitor_id, v.visited_at
  from public.profile_visits v
  where v.profile_id = auth.uid()
    and not public.is_blocked(auth.uid(), v.visitor_id)
    and (coalesce((select auto_delete_days from public.user_settings where user_id = auth.uid()), 0) = 0
         or v.visited_at > now() - make_interval(days => (select auto_delete_days from public.user_settings where user_id = auth.uid())))
  order by v.visited_at desc;
$$;

-- Start (or reuse) a 1:1 chat, respecting "who can message me" and blocks
create or replace function public.start_chat(p_other uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; pref text;
begin
  if me is null or p_other is null or me = p_other then raise exception 'invalid chat'; end if;
  if public.is_blocked(me, p_other) then raise exception 'blocked'; end if;
  select who_can_message into pref from public.user_settings where user_id = p_other;
  if coalesce(pref,'everyone') = 'friends' and not public.is_friend(me, p_other) then raise exception 'only friends can message this user'; end if;
  select c.id into cid from public.conversations c
    where not c.is_group
      and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = me)
      and exists (select 1 from public.conversation_members m where m.conversation_id = c.id and m.user_id = p_other)
    limit 1;
  if cid is null then
    insert into public.conversations (created_by) values (me) returning id into cid;
    insert into public.conversation_members values (cid, me), (cid, p_other);
  end if;
  return cid;
end $$;

-- Group owner/admin adds one of THEIR friends to a group (needed for private groups)
create or replace function public.add_group_member(p_group uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null or p_group is null or p_user is null then raise exception 'invalid request'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = me and role in ('owner','admin')) then
    raise exception 'only the group owner or an admin can add members';
  end if;
  if not public.is_friend(me, p_user) then raise exception 'you can only add friends'; end if;
  insert into public.group_members (group_id, user_id, role) values (p_group, p_user, 'member') on conflict do nothing;
end $$;

-- Create a group chat with friends only
create or replace function public.create_group_chat(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); cid uuid; m uuid;
begin
  if me is null or coalesce(trim(p_title),'') = '' or coalesce(array_length(p_members,1),0) = 0 then raise exception 'invalid group chat'; end if;
  foreach m in array p_members loop
    if m <> me and not public.is_friend(me, m) then raise exception 'you can only add friends'; end if;
  end loop;
  insert into public.conversations (title, is_group, created_by) values (left(trim(p_title),80), true, me) returning id into cid;
  insert into public.conversation_members values (cid, me);
  insert into public.conversation_members select cid, x from unnest(p_members) x where x <> me on conflict do nothing;
  return cid;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.friendships enable row level security;
alter table public.follows enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.pages enable row level security;
alter table public.page_followers enable row level security;
alter table public.posts enable row level security;
alter table public.post_reactions enable row level security;
alter table public.comments enable row level security;
alter table public.saved_posts enable row level security;
alter table public.stories enable row level security;
alter table public.reels enable row level security;
alter table public.reel_likes enable row level security;
alter table public.profile_visits enable row level security;
alter table public.notifications enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (not public.is_blocked(auth.uid(), id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- user_settings (private)
drop policy if exists settings_select on public.user_settings;
create policy settings_select on public.user_settings for select to authenticated using (user_id = auth.uid());
drop policy if exists settings_update on public.user_settings;
create policy settings_update on public.user_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- friendships
drop policy if exists friends_select on public.friendships;
create policy friends_select on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());
drop policy if exists friends_insert on public.friendships;
create policy friends_insert on public.friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending' and not public.is_blocked(requester_id, addressee_id));
drop policy if exists friends_update on public.friendships;
create policy friends_update on public.friendships for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (addressee_id = auth.uid() and status = 'accepted');
drop policy if exists friends_delete on public.friendships;
create policy friends_delete on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- follows
drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows for select to authenticated using (true);
drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows for insert to authenticated
  with check (follower_id = auth.uid() and not public.is_blocked(follower_id, following_id));
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- blocks (private to the blocker)
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks for select to authenticated using (blocker_id = auth.uid());
drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- reports (users can only create them; admins read/handle via the admin_* functions)
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- groups
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (privacy = 'public' or owner_id = auth.uid() or public.is_group_member(id, auth.uid()));
drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated using (owner_id = auth.uid());

drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select to authenticated
  using (public.group_is_public(group_id) or public.is_group_member(group_id, auth.uid()));
drop policy if exists gm_insert on public.group_members;
create policy gm_insert on public.group_members for insert to authenticated
  with check (user_id = auth.uid() and role = 'member' and public.group_is_public(group_id));
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members for delete to authenticated
  using (user_id = auth.uid() and role <> 'owner');

-- pages
drop policy if exists pages_select on public.pages;
create policy pages_select on public.pages for select to authenticated using (true);
drop policy if exists pages_insert on public.pages;
create policy pages_insert on public.pages for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists pages_update on public.pages;
create policy pages_update on public.pages for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists pages_delete on public.pages;
create policy pages_delete on public.pages for delete to authenticated using (owner_id = auth.uid());
drop policy if exists pf_select on public.page_followers;
create policy pf_select on public.page_followers for select to authenticated using (true);
drop policy if exists pf_insert on public.page_followers;
create policy pf_insert on public.page_followers for insert to authenticated with check (user_id = auth.uid());
drop policy if exists pf_delete on public.page_followers;
create policy pf_delete on public.page_followers for delete to authenticated using (user_id = auth.uid());

-- posts
drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts for select to authenticated using (public.can_view_post(id, auth.uid()));
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated
  with check (author_id = auth.uid()
    and (group_id is null or public.is_group_member(group_id, auth.uid()))
    and (page_id is null or exists (select 1 from public.pages pg where pg.id = page_id and pg.owner_id = auth.uid()))
    and (shared_post_id is null or public.can_view_post(shared_post_id, auth.uid())));
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (author_id = auth.uid());

-- reactions / comments / saved
drop policy if exists react_select on public.post_reactions;
create policy react_select on public.post_reactions for select to authenticated using (public.can_view_post(post_id, auth.uid()));
drop policy if exists react_insert on public.post_reactions;
create policy react_insert on public.post_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_post(post_id, auth.uid()));
drop policy if exists react_update on public.post_reactions;
create policy react_update on public.post_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists react_delete on public.post_reactions;
create policy react_delete on public.post_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists comments_select on public.comments;
create policy comments_select on public.comments for select to authenticated using (public.can_view_post(post_id, auth.uid()));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (author_id = auth.uid() and public.can_view_post(post_id, auth.uid()));
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (author_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

drop policy if exists saved_select on public.saved_posts;
create policy saved_select on public.saved_posts for select to authenticated using (user_id = auth.uid());
drop policy if exists saved_insert on public.saved_posts;
create policy saved_insert on public.saved_posts for insert to authenticated
  with check (user_id = auth.uid() and public.can_view_post(post_id, auth.uid()));
drop policy if exists saved_delete on public.saved_posts;
create policy saved_delete on public.saved_posts for delete to authenticated using (user_id = auth.uid());

-- stories (visible 24h) and reels
drop policy if exists stories_select on public.stories;
create policy stories_select on public.stories for select to authenticated
  using (created_at > now() - interval '24 hours' and not public.is_blocked(auth.uid(), author_id));
drop policy if exists stories_insert on public.stories;
create policy stories_insert on public.stories for insert to authenticated with check (author_id = auth.uid());
drop policy if exists stories_delete on public.stories;
create policy stories_delete on public.stories for delete to authenticated using (author_id = auth.uid());

drop policy if exists reels_select on public.reels;
create policy reels_select on public.reels for select to authenticated using (not public.is_blocked(auth.uid(), author_id));
drop policy if exists reels_insert on public.reels;
create policy reels_insert on public.reels for insert to authenticated with check (author_id = auth.uid());
drop policy if exists reels_delete on public.reels;
create policy reels_delete on public.reels for delete to authenticated using (author_id = auth.uid());
drop policy if exists rl_select on public.reel_likes;
create policy rl_select on public.reel_likes for select to authenticated using (true);
drop policy if exists rl_insert on public.reel_likes;
create policy rl_insert on public.reel_likes for insert to authenticated with check (user_id = auth.uid());
drop policy if exists rl_delete on public.reel_likes;
create policy rl_delete on public.reel_likes for delete to authenticated using (user_id = auth.uid());

-- profile visits: only the profile owner can read or delete (insert happens via record_visit())
drop policy if exists visits_select on public.profile_visits;
create policy visits_select on public.profile_visits for select to authenticated using (profile_id = auth.uid());
drop policy if exists visits_delete on public.profile_visits;
create policy visits_delete on public.profile_visits for delete to authenticated using (profile_id = auth.uid());

-- notifications: only the recipient (rows are created by triggers)
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (user_id = auth.uid());

-- messenger
drop policy if exists conv_select on public.conversations;
create policy conv_select on public.conversations for select to authenticated using (public.is_conv_member(id, auth.uid()));
drop policy if exists cm_select on public.conversation_members;
create policy cm_select on public.conversation_members for select to authenticated using (public.is_conv_member(conversation_id, auth.uid()));
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select to authenticated using (public.is_conv_member(conversation_id, auth.uid()));
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conv_member(conversation_id, auth.uid()));

-- =====================================================================
-- Phase 9: admin tools, bans, report handling, rate limits
-- To make YOURSELF the first admin, run this once in the SQL Editor (change the username):
--   update public.profiles set role = 'admin' where username = 'your_username';
-- =====================================================================
alter table public.profiles add column if not exists banned boolean not null default false;
alter table public.reports add column if not exists status text not null default 'open';
alter table public.reports add column if not exists handled_by uuid references public.profiles(id) on delete set null;
alter table public.reports add column if not exists handled_at timestamptz;
alter table public.reports add column if not exists admin_note text not null default '';
do $$ begin
  alter table public.reports add constraint reports_status_chk check (status in ('open','resolved','dismissed'));
exception when duplicate_object then null; end $$;
-- one report per person per item (stops report spam)
delete from public.reports a using public.reports b where a.ctid > b.ctid and a.reporter_id = b.reporter_id and a.kind = b.kind and a.target_id = b.target_id;
create unique index if not exists reports_once on public.reports (reporter_id, kind, target_id);

-- nobody can ban/unban themselves or change their role (only the SQL editor / admin functions can)
create or replace function public.protect_profile_role() returns trigger
language plpgsql as $$
begin
  if (new.role is distinct from old.role or new.banned is distinct from old.banned)
     and current_user not in ('postgres','service_role','supabase_admin') then
    raise exception 'role cannot be changed';
  end if;
  return new;
end $$;

create or replace function public.is_admin(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and not banned from public.profiles where id = u), false);
$$;
create or replace function public.is_banned(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select banned from public.profiles where id = u), false);
$$;

-- suspended accounts cannot create anything
create or replace function public.ban_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and public.is_banned(auth.uid()) then raise exception 'account suspended'; end if;
  return new;
end $$;
-- simple abuse limits per user per hour
create or replace function public.rate_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null then return new; end if;
  execute format('select count(*) from public.%I where %I = $1 and created_at > now() - interval ''1 hour''', TG_TABLE_NAME, TG_ARGV[0]) into n using auth.uid();
  if n >= TG_ARGV[1]::int then raise exception 'too many requests, try again later'; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['posts','comments','messages','stories','reels','friendships','follows','post_reactions','groups','pages','group_members','page_followers','reports'] loop
    execute format('drop trigger if exists ban_guard on public.%I', t);
    execute format('create trigger ban_guard before insert on public.%I for each row execute function public.ban_guard()', t);
  end loop;
end $$;
drop trigger if exists rate_guard on public.posts;     create trigger rate_guard before insert on public.posts       for each row execute function public.rate_guard('author_id', '60');
drop trigger if exists rate_guard on public.comments;  create trigger rate_guard before insert on public.comments    for each row execute function public.rate_guard('author_id', '120');
drop trigger if exists rate_guard on public.messages;  create trigger rate_guard before insert on public.messages    for each row execute function public.rate_guard('sender_id', '600');
drop trigger if exists rate_guard on public.stories;   create trigger rate_guard before insert on public.stories     for each row execute function public.rate_guard('author_id', '30');
drop trigger if exists rate_guard on public.reels;     create trigger rate_guard before insert on public.reels       for each row execute function public.rate_guard('author_id', '20');
drop trigger if exists rate_guard on public.friendships; create trigger rate_guard before insert on public.friendships for each row execute function public.rate_guard('requester_id', '60');
drop trigger if exists rate_guard on public.reports;   create trigger rate_guard before insert on public.reports     for each row execute function public.rate_guard('reporter_id', '20');

-- audit log of every admin action
create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references public.profiles(id) on delete set null,
  admin_username text not null default '',
  action text not null,
  target text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.admin_actions enable row level security;
drop policy if exists admin_actions_select on public.admin_actions;
create policy admin_actions_select on public.admin_actions for select to authenticated using (public.is_admin(auth.uid()));
drop policy if exists reports_admin_select on public.reports;
create policy reports_admin_select on public.reports for select to authenticated using (public.is_admin(auth.uid()));

create or replace function public._admin_check() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'admin only'; end if;
end $$;
create or replace function public._admin_log(p_action text, p_target text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.admin_actions (admin_id, admin_username, action, target, note)
  values (auth.uid(), coalesce((select username from public.profiles where id = auth.uid()), ''), p_action, coalesce(p_target, ''), coalesce(p_note, ''));
end $$;

create or replace function public.admin_stats() returns table (users bigint, posts bigint, open_reports bigint, banned bigint, new_users_7d bigint, reports_total bigint)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query select (select count(*) from public.profiles), (select count(*) from public.posts),
    (select count(*) from public.reports where status = 'open'), (select count(*) from public.profiles pb where pb.banned),
    (select count(*) from public.profiles where created_at > now() - interval '7 days'), (select count(*) from public.reports);
end $$;

-- reports together with a snapshot of the reported item (admins only see what was reported)
create or replace function public.admin_reports(p_status text default 'open', p_limit int default 50)
returns table (id uuid, kind text, target_id text, reason text, status text, created_at timestamptz, reporter_name text, reporter_username text, target jsonb, admin_note text)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query
  select r.id, r.kind, r.target_id, r.reason, r.status, r.created_at, rp.name, rp.username,
    coalesce(case r.kind
      when 'post' then (select jsonb_build_object('exists', true, 'author_id', p.author_id, 'author_username', a.username, 'text', p.body, 'has_media', p.media_url <> '') from public.posts p join public.profiles a on a.id = p.author_id where p.id::text = r.target_id)
      when 'comment' then (select jsonb_build_object('exists', true, 'author_id', c.author_id, 'author_username', a.username, 'text', c.body) from public.comments c join public.profiles a on a.id = c.author_id where c.id::text = r.target_id)
      when 'message' then (select jsonb_build_object('exists', true, 'author_id', m.sender_id, 'author_username', a.username, 'text', m.body) from public.messages m join public.profiles a on a.id = m.sender_id where m.id::text = r.target_id)
      when 'user' then (select jsonb_build_object('exists', true, 'author_id', u.id, 'author_username', u.username, 'text', u.bio, 'banned', u.banned) from public.profiles u where u.id::text = r.target_id)
      when 'group' then (select jsonb_build_object('exists', true, 'author_id', g.owner_id, 'author_username', a.username, 'text', g.name) from public.groups g join public.profiles a on a.id = g.owner_id where g.id::text = r.target_id)
      when 'page' then (select jsonb_build_object('exists', true, 'author_id', g.owner_id, 'author_username', a.username, 'text', g.name) from public.pages g join public.profiles a on a.id = g.owner_id where g.id::text = r.target_id)
    end, jsonb_build_object('exists', false)),
    r.admin_note
  from public.reports r join public.profiles rp on rp.id = r.reporter_id
  where (p_status = 'all' or r.status = p_status)
  order by r.created_at desc limit least(greatest(p_limit, 1), 200);
end $$;

create or replace function public.admin_resolve_report(p_id uuid, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_status not in ('resolved','dismissed','open') then raise exception 'bad status'; end if;
  update public.reports set status = p_status, admin_note = coalesce(p_note, ''), handled_by = auth.uid(), handled_at = now() where id = p_id;
  perform public._admin_log('report_' || p_status, p_id::text, p_note);
end $$;

create or replace function public.admin_remove_content(p_kind text, p_target text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_kind = 'post' then delete from public.posts where id::text = p_target;
  elsif p_kind = 'comment' then delete from public.comments where id::text = p_target;
  elsif p_kind = 'message' then delete from public.messages where id::text = p_target;
  elsif p_kind = 'group' then delete from public.groups where id::text = p_target;
  elsif p_kind = 'page' then delete from public.pages where id::text = p_target;
  else raise exception 'this kind cannot be removed (use ban for users)'; end if;
  update public.reports set status = 'resolved', handled_by = auth.uid(), handled_at = now(), admin_note = coalesce(nullif(p_note, ''), 'content removed')
    where kind = p_kind and target_id = p_target and status = 'open';
  perform public._admin_log('remove_' || p_kind, p_target, p_note);
end $$;

create or replace function public.admin_set_ban(p_user uuid, p_banned boolean, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  if p_user = auth.uid() then raise exception 'you cannot ban yourself'; end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then raise exception 'cannot ban an admin'; end if;
  update public.profiles set banned = p_banned where id = p_user;
  perform public._admin_log(case when p_banned then 'ban' else 'unban' end, p_user::text, p_note);
end $$;

create or replace function public.admin_users(p_q text default '') returns table (id uuid, name text, username text, role text, banned boolean, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_check();
  return query select p.id, p.name, p.username, p.role, p.banned, p.created_at from public.profiles p
   where p_q = '' or p.username ilike '%' || replace(replace(p_q, '%', ''), '_', '\_') || '%' or p.name ilike '%' || replace(p_q, '%', '') || '%'
   order by p.created_at desc limit 30;
end $$;

-- =====================================================================
-- Privileges: anonymous visitors get NOTHING except username_available()
-- =====================================================================
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
grant execute on function public.username_available(text) to anon;
-- trigger-only functions should not be callable from the app
revoke execute on function public.handle_new_user(), public.notify_reaction(), public.notify_comment(),
  public.notify_friendship(), public.add_group_owner(), public.protect_profile_role() from authenticated;
revoke execute on function public.ban_guard(), public.rate_guard(), public._admin_check(), public._admin_log(text, text, text) from authenticated;

-- =====================================================================
-- Storage buckets (photos / videos)
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('avatars','avatars', true), ('covers','covers', true),
  ('posts','posts', false), ('stories','stories', false), ('reels','reels', false), ('chat','chat', false)
on conflict (id) do nothing;

-- Files must live in a folder named after the user's id:  <user-id>/<file>
do $$
declare b text;
begin
  foreach b in array array['avatars','covers','posts','stories','reels','chat'] loop
    execute format('drop policy if exists %I on storage.objects', 'fynza_'||b||'_insert');
    execute format($p$create policy %I on storage.objects for insert to authenticated
      with check (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$p$, 'fynza_'||b||'_insert', b);
    execute format('drop policy if exists %I on storage.objects', 'fynza_'||b||'_delete');
    execute format($p$create policy %I on storage.objects for delete to authenticated
      using (bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text)$p$, 'fynza_'||b||'_delete', b);
    execute format('drop policy if exists %I on storage.objects', 'fynza_'||b||'_select');
    execute format($p$create policy %I on storage.objects for select to authenticated
      using (bucket_id = %L)$p$, 'fynza_'||b||'_select', b);
  end loop;
end $$;

-- =====================================================================
-- Realtime (live messages and notifications)
-- =====================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  end if;
end $$;

-- ====== Phase 10 (Messenger v2) is in messenger_v2.sql: run it AFTER this file ======
