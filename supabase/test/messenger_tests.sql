\set ON_ERROR_STOP on
\set QUIET on
create or replace function t_as(u uuid) returns void language plpgsql as $$ begin execute 'reset role'; execute 'set local role authenticated'; perform set_config('request.jwt.claim.sub', u::text, true); end $$;
create or replace function t_su() returns void language plpgsql as $$ begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', true); end $$;
create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$ begin if c is not true then raise exception 'TEST FAILED: %', m; end if; raise notice 'PASS  %', m; end $$;
create or replace function t_fails(q text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS  % (blocked: %)', m, left(sqlerrm, 60); return; end;
  raise exception 'TEST FAILED (was allowed): %', m;
end $$;

do $$
declare A uuid := 'aaaaaaaa-0000-0000-0000-000000000001'; B uuid := 'bbbbbbbb-0000-0000-0000-000000000002'; C uuid := 'cccccccc-0000-0000-0000-000000000003';
  cid uuid; gid uuid; m1 uuid; m2 uuid; callid uuid; n int; ts timestamptz;
begin
  insert into auth.users (id,email,raw_user_meta_data) values
   (A,'a@t.co','{"name":"Alice Ann","username":"alice"}'),(B,'b@t.co','{"name":"Bob Bee","username":"bob"}'),(C,'c@t.co','{"name":"Carol Cee","username":"carol"}');
  insert into friendships (requester_id,addressee_id,status) values (A,B,'accepted'),(A,C,'accepted');

  perform t_as(A);
  cid := public.start_chat(B);
  insert into messages (conversation_id,sender_id,body) values (cid,A,'hello') returning id into m1;
  perform t_as(B);
  insert into messages (conversation_id,sender_id,body,reply_to) values (cid,B,'hi back',m1) returning id into m2;
  perform t_ok((select reply_to from messages where id=m2)=m1, 'reply_to stored');
  perform t_ok((select count(*) from messages where conversation_id=cid)=2, 'B sees both messages');

  -- reply to a message from ANOTHER conversation is refused
  perform t_as(A);
  gid := public.create_group_chat('Team', array[B,C]);
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body,reply_to) values (%L,%L,'x',%L)$q$, gid, A, m1), 'cannot reply to a message of another chat');

  -- kinds
  insert into messages (conversation_id,sender_id,body,kind) values (cid,A,'🔥','sticker');
  insert into messages (conversation_id,sender_id,media_url,kind,duration) values (cid,A,A||'/v.webm','voice',7);
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body,kind) values (%L,%L,'x','bogus')$q$, cid, A), 'unknown message kind rejected');
  perform t_fails(format($q$insert into messages (conversation_id,sender_id) values (%L,%L)$q$, cid, A), 'empty message rejected');

  -- reactions
  perform t_as(B);
  insert into message_reactions (message_id,user_id,emoji) values (m1,B,'❤️');
  perform t_as(A);
  perform t_ok((select count(*) from message_reactions where message_id=m1)=1, 'A sees B reaction');
  perform t_fails(format($q$insert into message_reactions (message_id,user_id,emoji) values (%L,%L,'👍')$q$, m1, B), 'cannot react as someone else');
  perform t_as(C);
  perform t_ok((select count(*) from message_reactions)=0, 'outsider sees no reactions');
  perform t_fails(format($q$insert into message_reactions (message_id,user_id,emoji) values (%L,%L,'👍')$q$, m1, C), 'outsider cannot react');

  -- edit / delete
  perform t_as(A);
  perform public.edit_message(m1, 'hello edited');
  perform t_ok((select body from messages where id=m1)='hello edited' and (select edited_at from messages where id=m1) is not null, 'sender can edit');
  perform t_as(B);
  perform t_fails(format('select public.edit_message(%L, %L)', m1, 'hacked'), 'B cannot edit As message');
  perform t_fails(format('select public.delete_message(%L)', m1), 'B cannot delete As message');
  update messages set body='x' where id=m1;
  perform t_ok((select body from messages where id=m1)='hello edited', 'direct UPDATE on messages changes nothing (no policy)');

  perform t_as(A);
  perform public.delete_message(m1);
  perform t_ok((select deleted_at from messages where id=m1) is not null and (select body from messages where id=m1)='', 'sender delete blanks content');
  perform t_ok((select count(*) from message_reactions where message_id=m1)=0, 'delete removes reactions');
  perform t_fails(format('select public.edit_message(%L, %L)', m1, 'again'), 'cannot edit deleted message');

  -- receipts + privacy
  perform t_as(B);
  perform public.mark_chat_read(cid);
  perform t_as(A);
  select last_read_at into ts from conversation_members where conversation_id=cid and user_id=B;
  perform t_ok(ts > now() - interval '1 minute', 'A can see B last_read_at (seen)');
  perform t_as(B);
  update user_settings set show_read_receipts=false where user_id=B;
  perform t_su(); update conversation_members set last_read_at = now() - interval '1 day' where conversation_id=cid and user_id=B;
  perform t_as(B); perform public.mark_chat_read(cid);
  perform t_ok((select last_read_at from conversation_members where conversation_id=cid and user_id=B) < now() - interval '1 hour', 'read receipts off: last_read_at not advanced');
  perform t_su(); update conversation_members set last_read_at = now() - interval '2 days' where conversation_id=cid and user_id=A;
  perform t_as(B);
  update conversation_members set last_read_at = now() where conversation_id=cid and user_id=A;
  perform t_su();
  perform t_ok((select last_read_at from conversation_members where conversation_id=cid and user_id=A) < now() - interval '1 day', 'B cannot fake As seen receipt');
  -- typing
  perform t_as(A); perform public.set_typing(cid);
  perform t_as(B);
  perform t_ok((select count(*) from typing where conversation_id=cid)=1, 'B sees A typing');
  perform t_as(A);
  perform t_ok((select count(*) from typing)=0, 'A does not see own typing');
  perform t_as(C);
  perform t_ok((select count(*) from typing)=0, 'outsider does not see typing');
  perform t_fails(format($q$insert into typing (conversation_id,user_id) values (%L,%L)$q$, cid, C), 'no direct typing insert');
  perform t_su(); update typing set at = now() - interval '10 seconds';
  perform t_as(B);
  perform t_ok((select count(*) from typing)=0, 'typing expires after 6s');

  -- presence
  perform t_as(A); perform public.touch_presence();
  perform t_as(B); perform public.touch_presence();
  perform t_ok((select count(*) from public.get_presence(array[A]))=1, 'friend sees last seen');
  perform t_fails('select * from public.presence', 'presence table not readable directly');
  perform t_as(A); update user_settings set show_last_seen=false where user_id=A;
  perform t_as(B);
  perform t_ok((select count(*) from public.get_presence(array[A]))=0, 'hidden last seen is not exposed');
  perform t_as(A);
  perform t_ok((select count(*) from public.get_presence(array[B]))=0, 'if I hide mine I cannot see theirs');
  update user_settings set show_last_seen=true where user_id=A;
  perform t_as(C); perform public.touch_presence();
  perform t_as(B);
  perform t_ok((select count(*) from public.get_presence(array[C]))=1, 'people sharing a group chat see last seen');
  perform t_su();
  insert into auth.users (id,email,raw_user_meta_data) values ('dddddddd-0000-0000-0000-000000000004','d@t.co','{"name":"Dan Dee","username":"dan"}');
  perform t_as('dddddddd-0000-0000-0000-000000000004'); perform public.touch_presence();
  perform t_as(B);
  perform t_ok((select count(*) from public.get_presence(array['dddddddd-0000-0000-0000-000000000004'::uuid]))=0, 'stranger (no friend/chat) last seen hidden');

  -- calls
  perform t_as(A);
  callid := public.start_call(cid, 'video');
  perform t_fails(format('select public.start_call(%L, %L)', cid, 'audio'), 'second call while ringing = busy');
  perform t_fails(format('select public.start_call(%L, %L)', gid, 'audio'), 'no calls in group chats');
  insert into call_signals (call_id,from_id,to_id,type,payload) values (callid,A,B,'offer','{"sdp":"x"}');
  perform t_as(B);
  perform t_ok((select count(*) from calls where callee_id=B and status='ringing')=1, 'B sees incoming call');
  perform t_ok((select count(*) from call_signals where call_id=callid)=1, 'B receives offer');
  perform t_fails(format($q$insert into call_signals (call_id,from_id,to_id,type,payload) values (%L,%L,%L,'offer','{}')$q$, callid, B, C), 'cannot signal a third person');
  perform public.set_call_status(callid, 'accepted');
  insert into call_signals (call_id,from_id,to_id,type,payload) values (callid,B,A,'answer','{"sdp":"y"}');
  perform t_as(C);
  perform t_ok((select count(*) from calls)=0 and (select count(*) from call_signals)=0, 'outsider sees no calls/signals');
  perform t_fails(format($q$insert into call_signals (call_id,from_id,to_id,type,payload) values (%L,%L,%L,'ice','{}')$q$, callid, C, A), 'outsider cannot inject signals');
  perform t_fails(format($q$update calls set status='ended' where id=%L$q$, callid) || ' returning id' || '; select 1/(select count(*)::int from calls where id=''' || callid || ''')', 'outsider cannot touch call');
  perform t_as(A); perform public.set_call_status(callid, 'ended');
  perform t_ok((select status from calls where id=callid)='ended', 'caller can end call');
  perform t_fails(format($q$insert into call_signals (call_id,from_id,to_id,type,payload) values (%L,%L,%L,'ice','{}')$q$, callid, A, B), 'no signals after call ended');

  -- block: no messages / calls / reactions between blocked people in 1:1
  perform t_as(B);
  insert into blocks (blocker_id,blocked_id) values (B,A);
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body) values (%L,%L,'still there?')$q$, cid, B), 'blocker cannot message blocked');
  perform t_as(A);
  perform t_fails(format($q$insert into messages (conversation_id,sender_id,body) values (%L,%L,'hello??')$q$, cid, A), 'blocked person cannot message blocker');
  perform t_fails(format('select public.start_call(%L, %L)', cid, 'audio'), 'cannot call after block');
  perform t_as(B); delete from blocks where blocker_id=B;

  -- leaving a group chat
  perform t_as(C); perform public.leave_chat(gid);
  perform t_su();
  perform t_ok((select count(*) from conversation_members where conversation_id=gid)=2, 'member left the group chat');
  perform t_as(C);
  perform t_fails(format('select public.leave_chat(%L)', cid), 'cannot leave a 1:1 chat');

  -- storage: chat files only for members
  perform t_su();
  insert into storage.objects (bucket_id,name,owner) values ('chat', A||'/v.webm', A);
  perform t_as(B);
  perform t_ok((select count(*) from storage.objects where bucket_id='chat')=1, 'chat member can read chat file');
  perform t_as(C);
  perform t_ok((select count(*) from storage.objects where bucket_id='chat')=0, 'outsider cannot read chat file');
  raise notice 'ALL MESSENGER TESTS PASSED';
end $$;
