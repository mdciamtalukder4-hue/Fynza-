-- Marketplace RLS test: runs in one transaction and ends with an exception (full rollback). Result is in the error text.
do $$
declare A uuid := 'aaaaaaaa-0000-0000-0000-0000000000a1'; B uuid := 'bbbbbbbb-0000-0000-0000-0000000000b2'; la uuid; lh uuid; n int; r text := '';
begin
  insert into auth.users (id,email,raw_user_meta_data) values (A,'ma@t.co','{"name":"Mia A","username":"mkta"}'),(B,'mb@t.co','{"name":"Max B","username":"mktb"}');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', A::text, true);
  insert into listings (seller_id,title,price_minor,currency,photos) values (A,'Bike',5000,'USD',array[A::text||'/x.jpg']) returning id into la;
  insert into listings (seller_id,title,status) values (A,'Secret','hidden') returning id into lh;
  begin insert into listings (seller_id,title,photos) values (A,'Bad',array[B::text||'/x.jpg']); r:=r||'FAIL foreign photo; '; exception when others then r:=r||'ok foreign photo blocked; '; end;
  perform set_config('request.jwt.claim.sub', B::text, true);
  update listings set title='Hacked' where id=la; get diagnostics n = row_count; r:=r||case when n=0 then 'ok B cannot update A; ' else 'FAIL; ' end;
  delete from listings where id=la; get diagnostics n = row_count; r:=r||case when n=0 then 'ok B cannot delete A; ' else 'FAIL; ' end;
  select count(*) into n from listings where id=lh; r:=r||case when n=0 then 'ok hidden invisible; ' else 'FAIL; ' end;
  insert into blocks (blocker_id,blocked_id) values (B,A);
  select count(*) into n from listings where id=la; r:=r||case when n=0 then 'ok blocked cannot see; ' else 'FAIL; ' end;
  raise exception 'RESULT: %', r;
end $$;
