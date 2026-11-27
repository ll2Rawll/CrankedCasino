# CrankedCasino

![CrankedCasino](assets/img/og.jpg)

A sleek, fake-money online casino that runs entirely on GitHub Pages. Four original games, a real-time chrome 3D lobby, and progress that's saved to your GitHub account.

**Games**

| Game | What happens | Return to player |
| --- | --- | --- |
| **Mines** | Flip tiles on a 5×5 grid, collect gems, dodge 1–24 hidden bombs, and cash out whenever you like. | 99% |
| **Plinko** | Drop balls through 8–16 rows of pegs onto multiplier bins. Low, medium or high risk, up to 1,000×. Manual or autodrop. | ≈99% |
| **Slots** | 5 reels × 3 rows, 10 lines, chrome wilds, bonus stars and free spins at ×2 that can retrigger. Turbo and autoplay. | ≈97.5% |
| **Crash** | A rocket climbs a live multiplier curve until it explodes. Cash out in time, or set an auto cash-out. | 99% |

Every result comes from the browser's cryptographic random number generator (`crypto.getRandomValues`). The Plinko tables and slot paytable were built for this site and checked with exact maths.

**Also included:** a daily +1,000 bonus, a refill when you go broke, a leaderboard, a profile with per-game stats, light and dark themes, synthesized sound effects (no audio files), haptics on Android, reduced-motion support and keyboard shortcuts. It installs to your home screen as an app.

> Chips are pretend. Nothing can be bought, won or withdrawn.

---

## Put it online with GitHub Pages

1. Open the repo on GitHub → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Pick the branch that holds this code (for example `main`) and the **/ (root)** folder, then **Save**.
4. After a minute the casino is live at **https://ll2rawll.github.io/CrankedCasino/**.

There's no build step. The site is plain HTML, CSS and JavaScript modules, and every library is bundled in `vendor/`.

## Turn on GitHub sign-in

Without this, everything still works and chips are saved in the visitor's browser. With it, players can **Sign in with GitHub**: their balance, stats and history are saved to their account and follow them to any device, and they appear on the leaderboard.

GitHub Pages can't keep secrets, so sign-in goes through [Supabase](https://supabase.com) (free tier). It takes about 5 minutes:

1. **Create a Supabase project** at [supabase.com/dashboard](https://supabase.com/dashboard). Any name and region is fine.
2. **Create the database table.** In your project open **SQL Editor** → **New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and press **Run**.
3. **Create a GitHub OAuth app.** On GitHub go to **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**:
   - *Homepage URL:* `https://ll2rawll.github.io/CrankedCasino/`
   - *Authorization callback URL:* `https://<your-project-ref>.supabase.co/auth/v1/callback`

     You'll find this exact URL in Supabase under **Authentication** → **Sign In / Providers** → **GitHub**.
   - Register the app, then copy the **Client ID** and generate a **Client secret**.
4. **Enable GitHub in Supabase.** In **Authentication** → **Sign In / Providers** → **GitHub**, switch it on and paste the Client ID and secret.
5. **Allow the site to receive the login.** In **Authentication** → **URL Configuration**:
   - *Site URL:* `https://ll2rawll.github.io/CrankedCasino/`
   - *Redirect URLs:* add `https://ll2rawll.github.io/CrankedCasino/**`. Add `http://localhost:8080/**` too if you test locally.
6. **Connect the site.** In Supabase open **Project Settings** → **API** (or **API Keys**) and copy the **Project URL** and the **anon** / **publishable** key into [`js/config.js`](js/config.js):

   ```js
   export const CONFIG = {
     repoUrl: 'https://github.com/ll2Rawll/CrankedCasino',
     supabaseUrl: 'https://abcdefghijklmnop.supabase.co',
     supabaseKey: 'sb_publishable_…', // or the long "anon" key
   };
   ```

   Commit and push. Both values are meant to be public. The database rules only let each player read and write their own save, and the leaderboard only exposes usernames, avatars and numbers.

### How saving works

- **Guests:** progress lives in `localStorage` on that device.
- **First GitHub sign-in:** the guest's progress moves into their account, and the guest slot starts fresh.
- **Signed in:** every change is saved to the `players` table about 1.5 seconds after it happens. It's also saved when the tab is hidden or closed. If two devices disagree, the newest save wins.
- **Mid-game:** wins that are still animating are counted in the saved balance, so a reload never loses a payout. An unfinished Mines round resumes where you left it.
- **Paused projects:** free Supabase projects pause after a week without traffic. The casino falls back to on-device saves until you un-pause the project.

The games run in the browser, so a determined player could edit their own balance. That's fine for fake chips; just treat the leaderboard as an honour system.

## Run it locally

Any static file server works:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

## Project layout

```
index.html            app shell (header, menu, footer)
css/                  base.css (design system), lobby.css, games.css
js/main.js            header, wallet, menu, theme, hash router
js/store.js           balance, bets, stats, history, local saves
js/cloud.js           GitHub sign-in + cloud saves (Supabase)
js/config.js          ← your Supabase URL + key go here
js/hero3d.js          real-time chrome 3D objects (Three.js)
js/games/*.js         mines, plinko, slots, crash
js/pages/*.js         lobby, leaderboard, profile
js/sound.js, fx.js    synthesized sound effects, particles and confetti
assets/               fonts, rendered 3D art, slot symbols, icons
supabase/schema.sql   database table, security rules, leaderboard function
tools/                scripts that re-render the 3D art and share image
vendor/               three.js, supabase-js (bundled, MIT licensed)
```

To re-render the chrome images in `assets/img` after changing `js/hero3d.js`, serve the repo on port 8765 and run `node tools/render-assets.mjs`. This needs Playwright and Python with Pillow.

## Credits

[Three.js](https://threejs.org) and [supabase-js](https://github.com/supabase/supabase-js) are MIT licensed. The fonts, [Instrument Serif](https://github.com/Instrument/instrument-serif) and [Manrope](https://github.com/sharanda/manrope), are under the SIL Open Font License. All game art, symbols and sounds are original to this project.
