# CrankedCasino

![CrankedCasino](assets/img/og.jpg)

A free fake-money casino with a neon "after hours" look. Every player picks a username, and their chips live on the casino server, so they follow the player to any browser and can't be reset by clearing history. The site runs on GitHub Pages; the server is a free Supabase project.

## Games

| Game | What happens | Return to player |
| --- | --- | --- |
| **Blackjack** | Six-deck shoe with a cut card. Hit, stand, double, split and insurance. The dealer stands on all 17s and blackjack pays 3:2. | ≈99.5% (basic strategy) |
| **Roulette** | Single-zero European wheel with a rolling ball that lands in the winning pocket. Straight up 35:1, dozens and columns 2:1, even-money bets. | 97.3% |
| **Slots** | Five reels, ten lines, wilds, and bonus stars that trigger free spins at ×2 (with retriggers). | ≈97.5% |
| **Crash** | A rocket climbs a live multiplier curve until it explodes. Cash out in time, or set an auto cash-out. | 99% |
| **Plinko** | Drop balls through 8–16 rows of pegs, three risk levels, up to 1,000×. | ≈99% |
| **Mines** | Flip tiles on a 5×5 grid, collect gems, dodge 1–24 bombs, cash out whenever you like. | 99% |
| **Road Rooster** *(new)* | A skill game. Hop a rooster across a neon highway, dodging cars, buses and trains, with a hawk chasing you if you dawdle. Cash out any time for your furthest row: row 10 returns your bet, and every row after adds 7%, up to 81.27× at the golden egg on row 75. | Depends on how well you play |

The server decides every card, spin, bounce and crash with a cryptographic random number generator; the browser only animates the result. Road Rooster is the exception: it's a skill game. The server hands out a seed that lays out the traffic, and when you cash out it replays your moves against the same traffic before paying.

**Also included**

- **Accounts:** a username and password. They are remembered on each device, so players only log in again on a new browser.
- **Cashier:** watch an ad for +250 chips (two minutes apart, 20 a day), and **promo codes** that work once per account. There's no daily bonus or refill, and new players start with 1,000 chips.
- **Live leaderboard** and a profile with per-game stats.
- **Look and feel:** synthesized sound effects (no audio files), a daylight theme and reduced-motion support. It also installs to your phone's home screen.

> Chips are pretend. Nothing can be bought, won or withdrawn.

## Connect the server (Supabase)

Until you do this, the site runs in **offline mode**: everything works, but accounts are stored only in the visitor's browser. To make accounts work across browsers, and to make cheating impossible, connect a Supabase project. It's free and takes about five minutes:

1. **Create a project** at [supabase.com/dashboard](https://supabase.com/dashboard). Any name and region; note the database password somewhere safe.
2. **Install the casino.** Open **SQL Editor** → **New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and press **Run**. It's safe to run again later, for example after an update; it never deletes players.
3. **Connect the site.** In **Project Settings** → **API** (or **API Keys**), copy the **Project URL** and the **anon** / **publishable** key into [`js/config.js`](js/config.js):

   ```js
   supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
   supabaseKey: 'sb_publishable_…', // or the older "anon" key starting with eyJ…
   ```

   Commit and push, and GitHub Pages redeploys in a minute.

Both values are meant to be public. All the tables sit in a private `cc` schema that the API can't reach; visitors can only call the `cc_*` functions, and those check the player's session on every call.

Free Supabase projects pause after a week without any visits. If that happens, open the dashboard and press **Restore**.

### How it stops cheating

- **Balances live on the server.** Every bet is placed, decided and paid inside Postgres, under a row lock. Editing the page or the network traffic can't change a result.
- **Clearing history doesn't reset anything.** It only logs you out. Logging back in, from that browser or any other, brings back the same stack, stats and history.
- **Promo codes are once per account, ever.** They're tracked in `cc.promo_redemptions`.
- **Ad rewards are rate-limited by the server** (cooldown plus a daily cap), so the button can't be farmed.
- **New accounts are limited** to 4 per network per day, so you can't keep making accounts for fresh chips. Passwords are bcrypt-hashed, and 8 wrong passwords lock the account for 10 minutes.
- **Road Rooster runs are replayed** by the server before they pay. Fake runs, impossible timings and moves that would have been hit by traffic pay nothing.

### Tuning

Change these in **Table Editor** → schema **cc** → **settings** (no redeploy needed):

| key | default | meaning |
| --- | --- | --- |
| `start_balance` | 1000 | chips for a new player |
| `ad_reward` | 250 | chips per rewarded ad |
| `ad_cooldown_seconds` | 120 | wait between ads |
| `ad_daily_cap` | 20 | ads per player per day |
| `signups_per_ip_per_day` | 4 | new accounts per network per day |
| `login_attempts` / `lockout_minutes` | 8 / 10 | lockout after wrong passwords |

**Promo codes** live in `cc.promo_codes`. Add a row with `code` (UPPERCASE) and `chips`, or set `active` to false to retire one. The site ships with `MAXWIN` → +1,000 chips. For offline mode the same codes are listed in `PROMOS` in [`js/engine-local.js`](js/engine-local.js).

## Ads

The site has two kinds of ad placement:

- **Banners** in the lobby, under every game and on the leaderboard.
- **Rewarded ad breaks:** the "Watch an ad · +250 chips" button in the cashier, the drawer and the profile.

Until you add an ad account, those spots show **house ads** for the casino's own games, and the rewarded break is a 15-second house spot, so everything already works.

To earn money, use Google AdSense:

1. Sign up at [adsense.google.com](https://adsense.google.com) and add your site.
2. AdSense needs an `ads.txt` file at the root of your domain. For a GitHub Pages project site, that's the `ll2rawll.github.io` user-site repository, so a custom domain is usually simpler.
3. Once approved, create a responsive **display ad unit**. In [`js/config.js`](js/config.js), fill in `ads.adsenseClient` (`ca-pub-…`) and `ads.bannerSlot` (the unit's `data-ad-slot` number).
4. For **rewarded** ads, apply for Google's [H5 Games Ads](https://developers.google.com/ad-placement) (the Ad Placement API) on the same AdSense account. Keep `testMode: true` until Google approves it, then set it to `false`.

With real ads switched on, chips are only claimed after Google's player reports the ad as watched, and the server still applies the cooldown and daily cap. If an ad blocker stops the ad, the player is asked to allow ads instead.

Heads-up: Google treats simulated casino games as restricted content, so approval isn't guaranteed and some advertisers won't show up. You'll also need a privacy policy, and a consent banner for visitors in Europe (AdSense's own **Privacy & messaging** tool can provide one).

## Put it online with GitHub Pages

1. Open the repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**. Pick the branch with this code and the **/ (root)** folder, then **Save**.
3. After a minute the casino is live at **https://ll2rawll.github.io/CrankedCasino/**.

There's no build step. The site is plain HTML, CSS and JavaScript modules, and the fonts are bundled in the repo.

## Run it locally

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Project layout

```
index.html               app shell (header, cashier, menu, footer)
css/                     design system, lobby, game screens, felt tables
js/main.js               header, cashier, menu, theme, hash router, session start-up
js/engine.js             talks to the casino server (Supabase REST), one call at a time
js/engine-local.js       the same server, in the browser, for offline mode
js/math.js               game maths shared with the server (pay tables, Road Rooster traffic)
js/store.js              the balance and stats the player sees, synced from the server
js/account.js            sign-up / log-in sheet
js/ads.js                banners and rewarded ad breaks (AdSense, or house ads)
js/config.js             ← your Supabase URL/key and AdSense IDs go here
js/games/*.js            blackjack, roulette, slots, crash, plinko, mines, rooster (+ art)
js/pages/*.js            lobby, leaderboard, profile
supabase/schema.sql      the whole casino server: accounts, chips, games, ads, promos
tools/                   scripts that re-render the 3D card art, share image and app icons
vendor/                  three.js (art tools only)
```

## Credits

[Three.js](https://threejs.org) is MIT licensed. The fonts, [Tilt Neon](https://github.com/googlefonts/Tilt-Fonts) and [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), are under the SIL Open Font License. All game art, cards, chips, symbols, vehicles, the rooster and the sounds are original to this project.
