\set ON_ERROR_STOP on
\set QUIET on
-- helpers
create or replace function t_as(u uuid) returns void language plpgsql as $$ begin execute 'reset role'; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function t_su() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'TEST FAILED: %', m; end if; raise notice 'PASS  %', m; end $$;
create or replace function t_fails(q text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS  % (blocked: %)', m, left(sqlerrm, 60); return; end;
  raise exception 'TEST FAILED (was allowed): %', m;
end $$;
create or replace function t_rows(q text) returns int language plpgsql as $$ declare n int; begin execute 'select count(*) from (' || q || ') x' into n; return n; end $$;

-- fixed users
\set A '''aaaaaaaa-0000-0000-0000-000000000001'''
\set B '''bbbbbbbb-0000-0000-0000-000000000002'''
\set C '''cccccccc-0000-0000-0000-000000000003'''

do $$ begin
  insert into auth.users (id,email,raw_user_meta_data) values
   ('aaaaaaaa-0000-0000-0000-000000000001','alice@t.co','{"name":"Alice Ann","username":"alice"}'),
   ('bbbbbbbb-0000-0000-0000-000000000002','bob@t.co','{"name":"Bob Bee","username":"alice"}'),
   ('cccccccc-0000-0000-0000-000000000003','carol@t.co','{"name":"Carol Cee","username":"carol"}');
  perform t_ok((select count(*) from profiles)=3, 'signup creates 3 profiles via trigger');
  perform t_ok((select count(*) from user_settings)=3, 'signup creates settings rows');
  perform t_ok((select username from profiles where id='bbbbbbbb-0000-0000-0000-000000000002') like 'user_%', 'duplicate username gets safe fallback');
  update profiles set username='bob' where id='bbbbbbbb-0000-0000-0000-000000000002';
end $$;

-- anon
do $$ begin
  execute 'set local role anon';
  perform t_ok(public.username_available('zed') is true, 'anon: username_available(new)=true');
  perform t_ok(public.username_available('Alice') is false, 'anon: username_available(taken)=false (case-insensitive)');
  perform t_fails('select * from public.profiles', 'anon cannot read profiles');
  perform t_fails('select * from public.posts', 'anon cannot read posts');
  perform t_fails($q$select public.record_visit('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'anon cannot call record_visit');
end $$;

-- profiles
do $$ begin
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows('select 1 from profiles')=3, 'user can see profiles');
  update profiles set bio='hacked' where id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_su();
  perform t_ok((select bio from profiles where id='aaaaaaaa-0000-0000-0000-000000000001')='', 'cannot edit someone elses profile');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_fails($q$update profiles set role='admin' where id='bbbbbbbb-0000-0000-0000-000000000002'$q$, 'cannot make myself admin');
  update profiles set bio='hello' where id='bbbbbbbb-0000-0000-0000-000000000002';
  perform t_su();
  perform t_ok((select bio from profiles where id='bbbbbbbb-0000-0000-0000-000000000002')='hello', 'can edit own profile');
end $$;

-- posts & audiences
do $$ declare n int; begin
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  insert into posts (author_id, body, audience) values ('aaaaaaaa-0000-0000-0000-000000000001','pub','public'),('aaaaaaaa-0000-0000-0000-000000000001','fr','friends'),('aaaaaaaa-0000-0000-0000-000000000001','me','me');
  perform t_ok(t_rows('select 1 from posts')=3, 'author sees all own posts');
  perform t_fails($q$insert into posts (author_id, body) values ('bbbbbbbb-0000-0000-0000-000000000002','spoof')$q$, 'cannot post as someone else');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows('select 1 from posts')=1, 'stranger sees only the public post');
  perform t_fails($q$insert into friendships (requester_id,addressee_id,status) values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','accepted')$q$, 'cannot create an already-accepted friendship');
  insert into friendships (requester_id,addressee_id) values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');
  update friendships set status='accepted' where requester_id='bbbbbbbb-0000-0000-0000-000000000002';
  perform t_su();
  perform t_ok((select status from friendships limit 1)='pending', 'requester cannot accept own request (row stays pending)');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from friendships')=0, 'third person cannot see friendship');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(t_rows($q$select 1 from notifications where type='friend_request'$q$)=1, 'addressee got friend_request notification');
  update friendships set status='accepted' where addressee_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows('select 1 from posts')=2, 'friend sees public + friends-only (not me-only)');
  perform t_ok(t_rows($q$select 1 from notifications where type='friend_accept'$q$)=1, 'requester got friend_accept notification');
end $$;

-- private profile hides public posts from non-friends
do $$ begin
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  update profiles set is_public=false where id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from posts')=0, 'private profile: non-friend sees nothing');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows('select 1 from posts')=2, 'private profile: friend still sees posts');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  update profiles set is_public=true where id='aaaaaaaa-0000-0000-0000-000000000001';
end $$;

-- reactions, comments, notifications
do $$ declare pid uuid; begin
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  select id into pid from posts where body='pub';
  insert into post_reactions (post_id,user_id,type) values (pid,'cccccccc-0000-0000-0000-000000000003','love');
  insert into comments (post_id,author_id,body) values (pid,'cccccccc-0000-0000-0000-000000000003','nice');
  perform t_fails(format($q$insert into post_reactions (post_id,user_id) values (%L,'bbbbbbbb-0000-0000-0000-000000000002')$q$, pid), 'cannot react as someone else');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(t_rows($q$select 1 from notifications where type in ('like','comment')$q$)=2, 'post owner notified of like + comment');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows($q$select 1 from notifications where type in ('like','comment')$q$)=0, 'others cannot read my notifications');
  perform t_fails($q$insert into notifications (user_id,type) values ('cccccccc-0000-0000-0000-000000000003','system')$q$, 'users cannot forge notifications');
  -- cannot comment on a post I cannot see
  declare mepid uuid; begin
    perform t_su(); select id into mepid from posts where body='me'; perform t_as('cccccccc-0000-0000-0000-000000000003');
    perform t_fails(format($q$insert into comments (post_id,author_id,body) values (%L,'cccccccc-0000-0000-0000-000000000003','x')$q$, mepid), 'cannot comment on a post I cannot see');
  end;
end $$;

-- blocking
do $$ begin
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  insert into blocks values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(t_rows('select 1 from posts')=0, 'blocker no longer sees blocked users posts');
  perform t_ok(t_rows($q$select 1 from profiles where id='aaaaaaaa-0000-0000-0000-000000000001'$q$)=0, 'blocker cannot see blocked profile');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(t_rows($q$select 1 from profiles where id='bbbbbbbb-0000-0000-0000-000000000002'$q$)=0, 'blocked user cannot see blocker profile');
  perform t_ok(t_rows('select 1 from blocks')=0, 'blocked user cannot see the block list');
  perform t_fails($q$select public.start_chat('bbbbbbbb-0000-0000-0000-000000000002')$q$, 'cannot start chat with a blocker');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  delete from blocks where blocker_id='bbbbbbbb-0000-0000-0000-000000000002';
end $$;

-- profile visitors
do $$ begin
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform public.record_visit('aaaaaaaa-0000-0000-0000-000000000001');
  perform public.record_visit('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok((select count(*) from public.my_visitors())=1, 'visit recorded once (30-minute dedupe)');
  perform t_ok(t_rows($q$select 1 from notifications where type='visit'$q$)=1, 'visit notification created');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from profile_visits')=0, 'strangers cannot read someone elses visitors');
  perform t_fails($q$insert into profile_visits (profile_id,visitor_id) values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003')$q$, 'cannot fake a visit by direct insert');
  perform public.record_visit('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from profile_visits')=0, 'visiting myself records nothing');
  -- private browsing
  update user_settings set record_my_visits=false where user_id='cccccccc-0000-0000-0000-000000000003';
  perform public.record_visit('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok((select count(*) from public.my_visitors())=1, 'private browsing: visit NOT recorded');
  -- owner turns the log off
  update user_settings set keep_visitors=false where user_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_su(); delete from profile_visits where visitor_id='bbbbbbbb-0000-0000-0000-000000000002'; perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform public.record_visit('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok((select count(*) from public.my_visitors())=0, 'owner turned log off: nothing recorded');
  update user_settings set keep_visitors=true where user_id='aaaaaaaa-0000-0000-0000-000000000001';
  -- auto delete + delete own history
  perform t_su(); insert into profile_visits (profile_id,visitor_id,visited_at) values ('aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000003', now()-interval '40 days'); perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok((select count(*) from public.my_visitors())=1, 'old visit shown when auto-delete = never');
  update user_settings set auto_delete_days=30 where user_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_ok((select count(*) from public.my_visitors())=0, 'auto-delete 30 days hides the 40-day-old visit');
  delete from profile_visits;
  perform t_su();
  perform t_ok((select count(*) from profile_visits where profile_id='aaaaaaaa-0000-0000-0000-000000000001')=0, 'owner can clear visitor history');
end $$;

-- messenger
do $$ declare cid uuid; gid uuid; begin
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  cid := public.start_chat('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(public.start_chat('aaaaaaaa-0000-0000-0000-000000000001') = cid, 'start_chat reuses the same 1:1 chat');
  insert into messages (conversation_id,sender_id,body) values (cid,'bbbbbbbb-0000-0000-0000-000000000002','hi');
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body) values (%L,'aaaaaaaa-0000-0000-0000-000000000001','spoof')$q$, cid), 'cannot send as someone else');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok(t_rows('select 1 from messages')=1, 'chat partner can read the message');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from messages')=0, 'outsider cannot read messages');
  perform t_ok(t_rows('select 1 from conversations')=0, 'outsider cannot see conversations');
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body) values (%L,'cccccccc-0000-0000-0000-000000000003','intrude')$q$, cid), 'outsider cannot post in a chat');
  perform t_fails($q$insert into conversations (created_by) values ('cccccccc-0000-0000-0000-000000000003')$q$, 'conversations only via start_chat()');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  update user_settings set who_can_message='friends' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_fails($q$select public.start_chat('aaaaaaaa-0000-0000-0000-000000000001')$q$, 'who_can_message=friends blocks non-friend');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  gid := public.create_group_chat('Team', array['bbbbbbbb-0000-0000-0000-000000000002']::uuid[]);
  perform t_ok(t_rows('select 1 from conversation_members')>=2, 'group chat created with a friend');
  perform t_fails($q$select public.create_group_chat('X', array['cccccccc-0000-0000-0000-000000000003']::uuid[])$q$, 'group chat only with friends');
end $$;

-- groups
do $$ declare pubg uuid; prvg uuid; begin
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  insert into groups (name, privacy, owner_id) values ('Open Club','public','aaaaaaaa-0000-0000-0000-000000000001') returning id into pubg;
  insert into groups (name, privacy, owner_id) values ('Secret Club','private','aaaaaaaa-0000-0000-0000-000000000001') returning id into prvg;
  perform t_ok(t_rows($q$select 1 from group_members where role='owner'$q$)=2, 'owner becomes member automatically');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from groups')=1, 'private group invisible to non-members');
  insert into group_members (group_id,user_id) values (pubg,'cccccccc-0000-0000-0000-000000000003');
  perform t_fails(format($q$insert into group_members (group_id,user_id) values (%L,'cccccccc-0000-0000-0000-000000000003')$q$, prvg), 'cannot join private group directly');
  perform t_fails(format($q$insert into group_members (group_id,user_id,role) values (%L,'cccccccc-0000-0000-0000-000000000003','admin')$q$, pubg), 'cannot make myself group admin');
  update groups set name='stolen' where id=pubg;
  perform t_su();
  perform t_ok((select name from groups where id=pubg)='Open Club', 'non-owner cannot rename a group');
end $$;

-- pages and adding group members
do $$
declare pg uuid; prv uuid;
begin
  perform t_su();
  delete from friendships;
  insert into friendships (requester_id,addressee_id,status) values ('aaaaaaaa-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000002','accepted');
  select id into prv from groups where name='Secret Club';
  insert into pages (name, owner_id) values ('Alice Page','aaaaaaaa-0000-0000-0000-000000000001') returning id into pg;
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_fails(format($q$insert into posts (author_id, body, page_id) values ('bbbbbbbb-0000-0000-0000-000000000002','fake page post',%L)$q$, pg), 'cannot post as someone elses page');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  insert into posts (author_id, body, page_id) values ('aaaaaaaa-0000-0000-0000-000000000001','page post',pg);
  perform t_ok(true, 'page owner can post to own page');
  perform t_fails(format($q$select add_group_member(%L,'cccccccc-0000-0000-0000-000000000003')$q$, prv), 'owner cannot add a non-friend');
  perform add_group_member(prv, 'bbbbbbbb-0000-0000-0000-000000000002');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows(format($q$select 1 from groups where id=%L$q$, prv))=1, 'invited friend can now see the private group');
  perform t_fails(format($q$select add_group_member(%L,'cccccccc-0000-0000-0000-000000000003')$q$, prv), 'plain member cannot add members');
  perform t_su();
end $$;

-- admin tools, bans, rate limits
do $$
declare pid uuid; rid uuid; n int; cnt int := 0;
begin
  perform t_su();
  update profiles set role='admin' where id='aaaaaaaa-0000-0000-0000-000000000001';
  insert into posts (author_id, body) values ('cccccccc-0000-0000-0000-000000000003','bad post') returning id into pid;
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  insert into reports (reporter_id, kind, target_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002','post',pid::text,'spam');
  perform t_fails(format($q$insert into reports (reporter_id, kind, target_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002','post',%L,'again')$q$, pid::text), 'same person cannot report the same item twice');
  perform t_fails('select * from admin_stats()', 'normal user cannot call admin_stats');
  perform t_fails('select * from admin_reports()', 'normal user cannot list reports');
  perform t_ok(t_rows('select 1 from reports')=0, 'normal user cannot read any report');
  perform t_fails($q$update profiles set role='admin' where id='bbbbbbbb-0000-0000-0000-000000000002'$q$, 'user cannot make himself admin');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform t_ok((select users from admin_stats())>=3, 'admin can read stats');
  perform t_ok((select count(*) from admin_reports())=1, 'admin sees the report');
  perform t_ok((select target->>'text' from admin_reports() limit 1)='bad post', 'admin sees snapshot of the reported post');
  perform t_ok(t_rows('select 1 from reports')=1, 'admin can read reports table');
  perform admin_set_ban('cccccccc-0000-0000-0000-000000000003', true, 'spam');
  perform t_fails($q$select admin_set_ban('aaaaaaaa-0000-0000-0000-000000000001', true, '')$q$, 'admin cannot ban himself');
  perform t_su();
  perform t_ok((select banned from profiles where id='cccccccc-0000-0000-0000-000000000003'), 'ban is stored');
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_fails($q$insert into posts (author_id, body) values ('cccccccc-0000-0000-0000-000000000003','still posting')$q$, 'banned user cannot post');
  perform t_fails($q$update profiles set banned=false where id='cccccccc-0000-0000-0000-000000000003'$q$, 'banned user cannot unban himself');
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  perform admin_remove_content('post', pid::text, 'removed');
  perform t_su();
  perform t_ok((select count(*) from posts where id=pid)=0, 'admin removed the post');
  perform t_ok((select status from reports limit 1)='resolved', 'report auto-resolved after removal');
  perform t_ok((select count(*) from admin_actions)=2, 'admin actions are logged (ban + removal)');
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  perform t_ok(t_rows('select 1 from admin_actions')=0, 'normal user cannot read admin log');
  perform t_fails($q$select admin_remove_content('post','x','')$q$, 'normal user cannot remove content');
  perform t_su();
  update profiles set banned=false where id='cccccccc-0000-0000-0000-000000000003';
  -- rate limit: 20 reports per hour
  perform t_as('bbbbbbbb-0000-0000-0000-000000000002');
  for n in 1..25 loop
    begin
      insert into reports (reporter_id, kind, target_id, reason) values ('bbbbbbbb-0000-0000-0000-000000000002','user',('x'||n)::text,'r');
      cnt := cnt + 1;
    exception when others then exit;
    end;
  end loop;
  perform t_ok(cnt between 18 and 20, 'report spam is rate-limited (stopped after ' || cnt || ')');
  perform t_su();
end $$;

-- stories
do $$ begin
  perform t_su();
  insert into stories (author_id, body, created_at) values ('aaaaaaaa-0000-0000-0000-000000000001','old', now()-interval '25 hours'), ('aaaaaaaa-0000-0000-0000-000000000001','fresh', now());
  perform t_as('cccccccc-0000-0000-0000-000000000003');
  perform t_ok(t_rows('select 1 from stories')=1, 'only the last 24 hours of stories are visible');
end $$;

-- storage
do $$ begin
  perform t_as('aaaaaaaa-0000-0000-0000-000000000001');
  insert into storage.objects (bucket_id,name) values ('avatars','aaaaaaaa-0000-0000-0000-000000000001/me.jpg');
  perform t_fails($q$insert into storage.objects (bucket_id,name) values ('avatars','bbbbbbbb-0000-0000-0000-000000000002/me.jpg')$q$, 'cannot upload into another users folder');
  perform t_su();
  perform t_ok((select count(*) from storage.buckets)=6, '6 storage buckets exist');
end $$;
\echo ALL TESTS COMPLETED
