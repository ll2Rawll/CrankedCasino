// ─────────────────────────────────────────────────────────────────────────────
//  CrankedCasino settings
//
//  GitHub sign-in + cloud saves run on Supabase (free tier is plenty).
//  Paste your project's URL and its anon/publishable key below. Both values are
//  meant to be public; the database rules in supabase/schema.sql keep every
//  player's save private to them. See README.md → "Turn on GitHub sign-in".
//
//  Leave them empty and the casino still works: chips are saved in the browser.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  repoUrl: 'https://github.com/ll2Rawll/CrankedCasino',

  supabaseUrl: '', // e.g. 'https://abcdefghijklmnop.supabase.co'
  supabaseKey: '', // the "anon" or "publishable" key from Project Settings → API
};
