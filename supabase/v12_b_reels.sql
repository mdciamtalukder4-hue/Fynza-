-- v12_b: Reels v2 - reactions, comments with replies, share counter
create table if not exists public.reel_reactions (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'like' check (type in ('like','love','haha','wow','sad','angry')),
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);
create table if not exists public.reel_comments (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid references public.reel_comments(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists reel_comments_reel on public.reel_comments(reel_id, created_at);
create table if not exists public.reel_shares (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- carry old likes over as "like" reactions
insert into public.reel_reactions (reel_id, user_id, type) select reel_id, user_id, 'like' from public.reel_likes on conflict do nothing;

alter table public.reel_reactions enable row level security;
alter table public.reel_comments enable row level security;
alter table public.reel_shares enable row level security;

drop policy if exists rr_select on public.reel_reactions;
create policy rr_select on public.reel_reactions for select to authenticated using (not public.is_blocked(auth.uid(), user_id));
drop policy if exists rr_insert on public.reel_reactions;
create policy rr_insert on public.reel_reactions for insert to authenticated with check (user_id = auth.uid());
drop policy if exists rr_update on public.reel_reactions;
create policy rr_update on public.reel_reactions for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists rr_delete on public.reel_reactions;
create policy rr_delete on public.reel_reactions for delete to authenticated using (user_id = auth.uid());

drop policy if exists rc_select on public.reel_comments;
create policy rc_select on public.reel_comments for select to authenticated using (not public.is_blocked(auth.uid(), author_id));
drop policy if exists rc_insert on public.reel_comments;
create policy rc_insert on public.reel_comments for insert to authenticated with check (author_id = auth.uid());
drop policy if exists rc_delete on public.reel_comments;
create policy rc_delete on public.reel_comments for delete to authenticated using (
  author_id = auth.uid() or exists (select 1 from public.reels r where r.id = reel_id and r.author_id = auth.uid()));

drop policy if exists rs_select on public.reel_shares;
create policy rs_select on public.reel_shares for select to authenticated using (true);
drop policy if exists rs_insert on public.reel_shares;
create policy rs_insert on public.reel_shares for insert to authenticated with check (user_id = auth.uid());

drop trigger if exists ban_guard on public.reel_comments;
create trigger ban_guard before insert on public.reel_comments for each row execute function public.ban_guard();
drop trigger if exists ban_guard on public.reel_reactions;
create trigger ban_guard before insert on public.reel_reactions for each row execute function public.ban_guard();
drop trigger if exists rate_guard on public.reel_comments;
create trigger rate_guard before insert on public.reel_comments for each row execute function public.rate_guard('author_id', '120');
drop trigger if exists rate_guard on public.reel_shares;
create trigger rate_guard before insert on public.reel_shares for each row execute function public.rate_guard('user_id', '60');

-- AI Guardian only creates a CASE for admins (it never acts on its own)
create or replace function public.guardian_on_reel_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.reel_comments where author_id = new.author_id and body = new.body and created_at > now() - interval '1 hour';
  perform public._guardian_case('auto', 'comment', new.id::text, new.author_id, new.body, null, '',
    case when n >= 3 then 3 else 0 end, case when n >= 3 then 'spam' end);
  return new;
exception when others then return new;
end $$;
drop trigger if exists guardian_reel_comment on public.reel_comments;
create trigger guardian_reel_comment after insert on public.reel_comments for each row execute function public.guardian_on_reel_comment();

-- notify the reel owner about comments (text only)
create or replace function public.notify_reel_comment() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid; parent_owner uuid; nm text;
begin
  select left(name, 40) into nm from public.profiles where id = new.author_id;
  select author_id into owner from public.reels where id = new.reel_id;
  if owner is not null and owner <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, text) values (owner, new.author_id, 'system', coalesce(nm,'Someone') || ' commented on your reel.');
  end if;
  if new.parent_id is not null then
    select author_id into parent_owner from public.reel_comments where id = new.parent_id;
    if parent_owner is not null and parent_owner <> new.author_id and parent_owner is distinct from owner then
      insert into public.notifications (user_id, actor_id, type, text) values (parent_owner, new.author_id, 'system', coalesce(nm,'Someone') || ' replied to your comment on a reel.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_reel_comment on public.reel_comments;
create trigger trg_notify_reel_comment after insert on public.reel_comments for each row execute function public.notify_reel_comment();

revoke execute on function public.guardian_on_reel_comment(), public.notify_reel_comment() from public, anon, authenticated;
