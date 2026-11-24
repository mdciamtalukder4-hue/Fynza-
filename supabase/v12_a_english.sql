-- v12_a: English-only text inside database-generated messages (notifications, guardian drafts, labels).
-- Detection keywords (regex patterns for spam/abuse in other languages) are intentionally kept: they are detection data, not UI text.
do $mig$
declare
  m text[][] := array[
    ['বিদ্বেষমূলক বক্তব্য','hate speech'],['হুমকি','threats'],['প্রতারণা/স্ক্যাম','fraud/scam'],
    ['অশ্লীল কনটেন্ট','sexual content'],['হয়রানি/গালিগালাজ','harassment/abuse'],['স্প্যাম','spam'],
    ['''পোস্ট''','''post'''],['''মন্তব্য''','''comment'''],['''মেসেজ''','''message'''],['''কার্যক্রম''','''activity'''],
    ['FYNZA কমিউনিটি নিয়ম লঙ্ঘন (','FYNZA community rule violation ('],
    ['): আপনার একটি ','): your '],
    [' আমাদের নিয়ম ভঙ্গ করেছে। সংশ্লিষ্ট কনটেন্ট: ',' broke our community rules. Related content: '],
    ['। অনুগ্রহ করে নিয়ম মেনে চলুন; পুনরাবৃত্তি হলে অ্যাকাউন্টে ব্যবস্থা নেওয়া হতে পারে।','. Please follow the rules; repeated violations may lead to action on your account.'],
    ['স্বয়ংক্রিয় যাচাইয়ে নিয়ম-ভঙ্গের স্পষ্ট প্রমাণ মেলেনি; Admin নিজে দেখে সিদ্ধান্ত নিন।','The automatic check found no clear evidence of a rule violation; an admin should review it and decide.'],
    ['AI সুপারিশ বাতিল','AI recommendation rejected'],
    ['⚠ সতর্কবার্তা: ','⚠ Warning: '],
    ['⚠ আপনার একটি কনটেন্ট কমিউনিটি নিয়ম ভাঙার কারণে সরানো হয়েছে','⚠ One of your posts was removed for breaking the community rules'],
    ['আপনাকে FYNZA ব্লু ব্যাজ দেওয়া হয়েছে ✔','You have been given the FYNZA blue badge ✔'],
    ['আপনার বিজ্ঞাপন "','Your ad "'],
    ['" রিভিউয়ে অনুমোদিত হয়েছে। পেমেন্ট চালু হলে এটি চালু করা যাবে।','" was approved in review. It can be started when payments are turned on.'],
    ['" বাতিল: ','" was rejected: '],
    ['আপনি FYNZA Creator হিসেবে অনুমোদিত হয়েছেন। আয়ের সুবিধা পেমেন্ট চালু হলে সক্রিয় হবে।','You are approved as a FYNZA Creator. Earning features will activate when payments are turned on.'],
    ['Creator আবেদন বাতিল: ','Creator application rejected: '],
    ['আপনার FYNZA Verified পরিচয় যাচাই সম্পন্ন হয়েছে ✔ পেমেন্ট চালু হলে ব্লু ব্যাজ সক্রিয় করা যাবে।','Your FYNZA Verified identity check is complete ✔ The blue badge can be activated when payments are turned on.'],
    ['আপনার FYNZA Verified আবেদন বাতিল হয়েছে: ','Your FYNZA Verified application was rejected: '],
    ['নতুন অ্যাকাউন্টে অস্বাভাবিক বেশি পোস্ট','Unusually many posts for a new account'],
    ['২৪ ঘণ্টায় অনেক ফ্রেন্ড রিকোয়েস্ট','Many friend requests in 24 hours'],
    ['একাধিক ব্যক্তি রিপোর্ট করেছে','Reported by several people'],
    ['ফলোয়ার','Followers'],['অ্যাকাউন্টের বয়স (দিন)','Account age (days)'],['পোস্ট সংখ্যা','Number of posts'],
    ['পরিচয় যাচাই (FYNZA Verified আবেদন অনুমোদিত)','Identity verified (FYNZA Verified application approved)'],
    ['গত ৯০ দিনে কোনো সতর্কবার্তা নেই','No warnings in the last 90 days'],['দেশ সেট করা আছে','Country is set'],
    ['আপনার FYNZA Verified মেয়াদ শেষ হয়েছে।','Your FYNZA Verified has expired.'],
    ['আপনার FYNZA Verified শীঘ্রই শেষ হবে। রিনিউয়াল নিশ্চিত করুন।','Your FYNZA Verified will expire soon. Please confirm renewal.'],
    ['একাধিক লিংক (','Multiple links ('],['টি)',')'],
    ['সংক্ষিপ্ত/লুকানো লিংক','Shortened/hidden link'],
    ['প্রতারণামূলক বাক্য/প্রলোভন','Scam phrases/bait'],['হুমকির ভাষা','Threatening language'],
    ['ধর্মীয় গোষ্ঠীর বিরুদ্ধে সহিংস আহ্বান','Violent call against a religious group'],
    ['গালিগালাজ/হয়রানির ভাষা','Abusive/harassing language'],['অশ্লীল কনটেন্টের ইঙ্গিত','Hint of sexual content'],
    ['নতুন ডিভাইস থেকে লগইন: ','Login from a new device: '],
    ['। আপনি না হলে এখনই পাসওয়ার্ড বদলান ও "সব ডিভাইস থেকে লগআউট" করুন।','. If this was not you, change your password now and use "Log out of all devices".']
  ];
  fn record; def text; i int;
begin
  for fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.prokind='f' and pg_get_functiondef(p.oid) ~ '[ঀ-৿]' loop
    def := pg_get_functiondef(fn.oid);
    for i in 1..array_length(m,1) loop def := replace(def, m[i][1], m[i][2]); end loop;
    execute def;
  end loop;
end $mig$;
