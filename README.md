# CrankedCasino

![CrankedCasino](assets/img/og.jpg)

A free fake-money casino with a neon "after hours" look. Every player picks a username, and their chips live on the casino server, so they follow the player to any browser and can't be reset by clearing history. The site runs on GitHub Pages; the server is a free Supabase project.

## Games

| Game | What happens | Return to player |
| --- | --- | --- |
| **Case Battles** | Two players open the same three selected cases. Players choose their own bets, which may differ. The higher item score wins the combined pot; ties return each player’s own wager. Public rooms, invite-only rooms, bot battles, and free practice. | 100% of the combined player entries |
| **Blackjack** | Six-deck shoe with a cut card. Hit, stand, double, split and insurance. The dealer stands on all 17s and blackjack pays 3:2. | ≈99.5% (basic strategy) |
| **Roulette** | Single-zero European wheel with a rolling ball that lands in the winning pocket. Straight up 35:1, dozens and columns 2:1, even-money bets. | 97.3% |
| **Slots** | Five reels, ten lines, wilds, and bonus stars that trigger free spins at ×2 (with retriggers). | ≈97.5% |
| **Crash** | A rocket climbs a live multiplier curve until it explodes. Cash out in time, or set an auto cash-out. | 99% |
| **Plinko** | Drop balls through 8–16 rows of pegs, three risk levels, up to 1,000×. | ≈99% |
| **Mines** | Flip tiles on a 5×5 grid, collect gems, dodge 1–24 bombs, cash out whenever you like. | 99% |
| **Night Flight** *(new)* | Tap to flap a kingfisher through the harbour's gates, one point a gate, with medals at 10, 20, 30 and 40. The flight follows the classic tap-to-flap arcade rules frame for frame. Free flights chase your best score. Bet flights pick a number of gates and pay the moment you clear them: 5 gates 1.5×, 10 gates 2.5×, 25 gates 8×, 50 gates 30×. | Depends on how well you play |
| **Road Rooster** *(new)* | Hop across roads, rail lines and rivers (ride logs, land on lily pads) ahead of a red line. Score runs are free: hold the egg to bank your rows, and your best stays in this browser. Bet runs pick a row to reach and pay the moment you get there: row 25 1.2×, row 50 1.5×, row 100 2.5×, row 200 9×. Hops are safe in the air: only the tile you land on counts. The course is nine columns wide with a stone wall along each edge, and about a third of the rows are grass, so roads come in short runs. Each game has its own quiet background music (Menu → Music). | Depends on how well you play |

The server decides every card, spin, bounce and crash with a cryptographic random number generator; the browser only animates the result. Road Rooster and Night Flight are skill games. Free runs and flights play locally. For a bet, the server hands out a seed that lays out the course, and before it pays it replays your hops (or your flaps, frame by frame) on that same course. The target multipliers were set with simulated players: a good player about breaks even, an average one loses slowly, and real skill wins.

**Also included**

- **Accounts:** a username and password. They are remembered on each device, so players only log in again on a new browser.
- **Cashier:** watch an ad for +250 chips (two minutes apart, 20 a day), and **promo codes** that work once per account. There's no daily bonus or refill, and new players start with 1,000 chips.
- **Live leaderboard** and a profile with per-game stats.
- **Look and feel:** synthesized sound effects (no audio files), a daylight theme and reduced-motion support. It also installs to your phone's home screen.

> Chips are pretend. Nothing can be bought, won or withdrawn.

## Connect the server (Supabase)

The live casino is connected to the **CrankedCasinov2** Supabase project. Public rooms, private invites, accounts and balances are shared across browsers. Only the publishable client key is in `js/config.js`; privileged keys are never shipped. Previous device-only accounts remain in browser storage and are separate from online accounts.

For another deployment, configure a Supabase project as follows. Leaving the URL/key empty enables device-only accounts and bot battles:

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

### Case Battles

Open `#/cases` to choose three cases, inspect each item’s probability, and create a battle. After Hours, Neon Vault, and High Roller have different distributions. Item points determine the winner. The winner receives the sum of both wagers. Each player chooses an independent amount from 0.01 chips in whole cents, within their balance and the shared 1-trillion-chip limit. The same chip rack, half/double and Max controls used by other games are available. Rook matches the player’s amount in bot battles; ties refund each player’s actual wager. Larger bets do not improve item odds or scores.

The collection contains six cases. Alongside the three original finishes, Dragonheart is a chained molten egg, Starfall is an unfolding celestial engine, and Leviathan is an opening pearl shell. Each mythic case has six original items, its own opening animation and a short fire, star or water particle ritual. They reuse the High Roller, Neon Vault and After Hours probability profiles respectively; item scores and odds stay the same. Saved pulls remain six-slot indexes, so existing battles remain compatible.

Peek inside to see and audition the possible items without entering a battle. All 24 items have individual procedural sound signatures, and all six cases have opening cues. Sound previews are rate limited; the shared mute control silences active audio. The item inspector also includes a sound-preview button. `node tools/test-cases-audio.mjs` checks every cue for audible output, headroom, bounded tails and mute.

Tap a round or the Mythic cases button to open the visual case picker, or shuffle all three. The lineup is saved on this browser; an unresolved entry request keeps its original lineup locked until retry. The same case art appears during battles. `node tools/test-cases-lobby.mjs` checks the picker, saved settings, rapid preview cancellation, free previews, sound controls, responsive layouts and practice. Use `BROWSER=webkit` for Safari-engine coverage. `SHOWROOM_ONLY=1 node tools/render-cases-art.mjs` rebuilds all six cases and their opening atlases. `MYTHIC_ONLY=1` rebuilds only the three mythic cases and their 18 items.

With Supabase connected, public rooms appear in the lobby and private rooms are shared by invite link. The server reserves the entry, starts both players on one clock, hides future rounds, and records each payout once using the two persisted wagers. Custom bets survive reloads and ambiguous network retries; old 50-chip battles retain their original amounts. A host can cancel an unjoined room for a refund. Waiting rooms expire after ten minutes, and their refunds are reconciled on the host’s next account or battle request. Started battles survive leaving the page and reloading.

The full `supabase/schema.sql` includes the battle upgrade. Run the updated schema when connecting or updating the casino. `supabase/case-battles.sql` contains the standalone battle tables and RPC functions for deployments that already have the current account functions.

In device mode, paid bot battles use the existing browser account and balance. Free practice needs no account and never changes chips or stats. Bots are labeled and draw from the same item probabilities.

Validation covers custom decimal stakes, unequal multiplayer bets, both winners, ties, invalid amounts, exact refunds and immutable retry amounts. Validation uses `node tools/test-case-battles.mjs`, `node tools/test-case-battles-browser.mjs` with Playwright Core, and `python3 tools/test-case-battles-postgres.py CONTAINER_NAME` against a disposable PostgreSQL container loaded with the schema. `BROWSER=webkit` runs the browser suite with Safari’s engine; `MYTHIC=1` selects the new collection in the paid-battle browser and effects suites. `CASES_DB=CONTAINER_NAME node tools/test-case-battles-multiplayer.mjs` exercises two browser players through the real PostgreSQL RPCs with a mythic lineup.

Decisive wins (at least a 150-point lead and 1.75× the other score) trigger a full-screen winner takeover after settlement is confirmed. Both players see the same winner name, crown, score margin, strongest collected item and actual pot. The sequence lasts 7.2 seconds, can be skipped immediately, respects reduced motion, and does not replay when the result is reopened. `node tools/test-case-victory.mjs` checks these rules and cleanup in Chromium or WebKit; `node tools/test-case-victory-perf.mjs` measures it under 4× CPU throttling.

Openings include animated case latches, rotating item reveals, rarity bursts, a score meter, lead changes, and a winner celebration. Collected item buttons open an inspection dialog with rotation, points, and the selected case's actual drop chance. Effects respect reduced motion and stop when the scene is destroyed.

Artwork is original, generated offline by `node tools/render-cases-art.mjs` using the bundled Three.js and Playwright Core. The game uses WebP images and short 24-frame atlases, with no runtime WebGL. Essential artwork loads first; larger inspection atlases load only for the item being inspected. `node tools/test-case-effects.mjs` checks reveal transitions and cleanup. `PERF=1` measures a real-time battle under 4× CPU throttling in Chromium. These runs require Playwright Core on Node's module path and an installed browser. Cloud WebKit coverage does not replace testing on a physical iPhone.

`node tools/test-cases-online.mjs` exercises the actual configured Supabase project using isolated QA accounts, public room cancellation, private invites, unequal wagers, reloads and conserved payouts. Set `BASE_URL` to test the deployed site and `BROWSER=webkit` for the Safari engine. This is an explicit live integration test, not a routine offline test.

The backend uses the casino's own opaque session tokens. Its private `cc` schema denies direct client access; exposed RPCs validate the token before reading accounts or moving chips. The Supabase Advisor's [SECURITY DEFINER warning](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) applies to these intentional API entry points; changing them to invoker mode would remove their access to the private tables. [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is intentional deny-all protection here. Authentication failures, private-room visibility and exact payouts are covered by integration tests. Health checks are clear; unused-index notices are expected on a fresh database.

### How it stops cheating

- **Balances live on the server.** Every bet is placed, decided and paid inside Postgres, under a row lock. Editing the page or the network traffic can't change a result.
- **Clearing history doesn't reset anything.** It only logs you out. Logging back in, from that browser or any other, brings back the same stack, stats and history.
- **Promo codes are once per account, ever.** They're tracked in `cc.promo_redemptions`.
- **Ad rewards are rate-limited by the server** (cooldown plus a daily cap), so the button can't be farmed.
- **New accounts are limited** to 4 per network per day, so you can't keep making accounts for fresh chips. Passwords are bcrypt-hashed, and 8 wrong passwords lock the account for 10 minutes.
- **Road Rooster runs and Night Flight flights are replayed** by the server before they pay. Fake runs, impossible timings, flights faster than the clock and moves that would have crashed pay nothing.

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

### Tests

The game checks run with Node 18+. The browser tests drive Chromium through `playwright-core` with a fake clock, against a local server or the live site:

```bash
node tools/test-rooster-course.mjs        # Road Rooster's score course: variety, fairness, every course crossable
node tools/test-flight-course.mjs         # Night Flight's physics and a proof every course is flyable
BASE=http://localhost:8080/ node tools/test-rooster-input.mjs   # touch input on a phone screen
BASE=http://localhost:8080/ node tools/test-rooster-run.mjs     # a pilot plays logs, pads, trains, banking and every way to lose
BASE=http://localhost:8080/ node tools/test-night-flight.mjs    # a full flight, crash, board and retry
node tools/stamp-versions.mjs             # after any change: one ?v= build tag on every script, content tags on the rest
```

`SHOTS=<folder>` makes `test-rooster-run.mjs` save a screenshot of each moment it checks.

## Project layout

```
index.html               app shell (header, cashier, menu, footer)
css/                     design system, lobby, game screens, felt tables
js/main.js               header, cashier, menu, theme, hash router, session start-up
js/engine.js             talks to the casino server (Supabase REST), one call at a time
js/engine-local.js       the same server, in the browser, for offline mode
js/math.js               game maths shared with the server (pay tables, skill-game hash and targets)
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
