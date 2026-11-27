// ─────────────────────────────────────────────────────────────────────────────
//  CrankedCasino settings
//
//  1. The casino server (accounts, chips, every game result) runs on Supabase.
//     Paste your project's URL and its anon / publishable key below. Both are meant
//     to be public: players can only call the casino functions in
//     supabase/schema.sql, never touch the tables. See README → "Connect the server".
//     Leave them empty and the site runs in offline mode (accounts on this device only).
//
//  2. Ads. With a Google AdSense publisher ID the site shows real ads: banners in the
//     lobby and under each game, and rewarded "watch an ad for chips" breaks (AdSense
//     H5 Games ads). Without one it shows house ads for its own games. See README → "Ads".
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  repoUrl: 'https://github.com/ll2Rawll/CrankedCasino',

  supabaseUrl: '', // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseKey: '', // the "anon" or "publishable" key from Project Settings → API

  ads: {
    adsenseClient: '', // e.g. 'ca-pub-1234567890123456'
    bannerSlot: '', // a responsive display ad unit's data-ad-slot number, e.g. '1234567890'
    testMode: true, // keep true until Google approves your site for H5 Games ads, then set false
  },
};
