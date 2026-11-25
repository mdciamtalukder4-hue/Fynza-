# FYNZA — Phase 3 (ওয়েবসাইট + অনলাইন অ্যাকাউন্ট ও ডাটাবেস)

ফোনে দেখার সহজ উপায়: ZIP খুলে `dist` ফোল্ডারের `index.html` ক্রোমে খুলুন।

## এই ZIP-এ কী আছে
- `dist/` — তৈরি করা ওয়েবসাইট (সরাসরি চালানো যায়)
- `src/` — সোর্স কোড (React)
- `package.json`, `build.mjs` — পরে অনলাইনে (Vercel) বিল্ড করার জন্য

## Phase 2-এ যা কাজ করে (এই ব্রাউজারে সেভ হয়)
Register/Login, Feed, Stories (২৪ ঘণ্টা), টেক্সট/ছবি/ভিডিও পোস্ট, রিঅ্যাকশন, কমেন্ট ও রিপ্লাই, শেয়ার, সেভ,
প্রোফাইল ও কভার ফটো, বন্ধু অনুরোধ, ফলো, ব্লক/রিপোর্ট, Reels (ভিডিও আপলোড), Messenger ও গ্রুপ চ্যাট,
Groups, Pages, নোটিফিকেশন, সার্চ, Who Viewed My Profile (হিস্ট্রি, সময়, মোট ভিজিট, প্রাইভেসি কন্ট্রোল)।

## এখনও যা নেই (পরের ধাপে)
- অনলাইন ডাটাবেস ও আসল লগইন → Phase 3 (Supabase)
- রিয়েল-টাইম মেসেজ ও নোটিফিকেশন → Phase 7
- Android APK → Phase 10
- নমুনা ব্যবহারকারী (Ayesha, Tanvir…) শুধু ডেমো; Settings থেকে মুছে ফেলা যায়।

## Phase 3-এ যা যোগ হয়েছে
- `supabase/schema.sql` — পুরো ডাটাবেস (প্রোফাইল, পোস্ট, বন্ধু, মেসেজ, গ্রুপ, ভিজিটর…) + নিরাপত্তা নিয়ম (RLS) + স্টোরেজ বাকেট
- `supabase/test/` — নিরাপত্তা টেস্ট (শুধু ডেভেলপারদের জন্য)
- অ্যাপে "Connect database" ও আসল রেজিস্ট্রেশন/লগইন
- **সেটআপের ধাপ:** `SETUP-BN.md` দেখুন

## Status (2026-11-25) — honest summary
Working and tested: email sign-up/login, 2FA for admin, Marketplace, Groups (roles, requests, bans, mutes), Feed (reactions, comments, replies, shares, Time Capsule), Profile (lock, professional mode, details visibility), Reels (sound, reactions, comments), Message (voice, calls, reactions, typing, seen, in-chat search), Privacy Checkup, in-app APK update banner.
Database security was tested with rollback SQL tests (Marketplace, Groups, Feed, Reels). Most online screens were only build-checked in the cloud sandbox and still need a real-phone test.
Needs the owner: SMS provider (Twilio etc.) for phone OTP; Vercel link; enabling "leaked password protection" in Supabase; one-time uninstall of old APKs (signing key changed in apk-12; later updates install over).
Payments are OFF by design. AI Guardian only recommends; only a signed-in admin with 2FA can act.
Password minimum is 5 characters; Supabase needs 6, so shorter passwords are padded internally.
The live Supabase migration history (fynza_01 … fynza_22) is the source of truth for the database; supabase/*.sql files are partial references.
