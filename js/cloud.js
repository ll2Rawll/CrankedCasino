// GitHub sign-in + cloud saves (Supabase Auth with the GitHub provider, PKCE flow).
//
// Guests play with a save in localStorage. Signing in with GitHub moves that
// progress into the player's row in the `players` table, and from then on every
// change is mirrored there (debounced), so progress follows them across devices.

import { CONFIG } from './config.js';
import { loadScript, storage, esc } from './util.js';
import { store, on, sanitize } from './store.js';
import { toast, modal } from './ui.js';
import { icon } from './icons.js';

const listeners = new Set();
let client = null;
let user = null; // { id, login, name, avatar }
let status = 'local'; // local | syncing | synced | error | offline
let accessToken = null;
let pushTimer = 0;
let pushing = false;
let dirty = false;
let ready = false;

const enabled = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey);

function notify() {
  listeners.forEach((fn) => {
    try {
      fn({ user, status });
    } catch (e) {
      console.error(e);
    }
  });
}
function setStatus(s) {
  if (status === s) return;
  status = s;
  notify();
}

function userFrom(authUser) {
  const m = authUser.user_metadata || {};
  return {
    id: authUser.id,
    login: m.user_name || m.preferred_username || m.name || 'player',
    name: m.full_name || m.name || '',
    avatar: m.avatar_url || '',
  };
}

function cleanUrl() {
  const params = new URLSearchParams(location.search);
  const err = params.get('error_description') || params.get('error');
  if (params.has('code') || err) {
    const back = storage.get('cc:returnTo', '') || '';
    storage.remove('cc:returnTo');
    history.replaceState(null, '', location.pathname + back);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }
  if (err) toast(`GitHub sign-in failed: ${err}`, { type: 'loss', timeout: 6000 });
}

async function onSignedIn(authUser, session) {
  user = userFrom(authUser);
  accessToken = session?.access_token || accessToken;
  setStatus('syncing');
  notify();

  let data = null;
  let error = null;
  try {
    ({ data, error } = await client.from('players').select('balance, state').eq('id', user.id).maybeSingle());
  } catch (e) {
    error = e;
  }
  if (error) {
    console.warn('[cloud] load failed', error);
    store.useProfile(user.id); // fall back to the cached copy on this device
    setStatus(navigator.onLine ? 'error' : 'offline');
    toast('Signed in, but the cloud save could not be reached. Playing from this device.', { type: 'loss', timeout: 5000 });
    return;
  }

  const local = store.localFor(user.id);
  if (data) {
    const remote = sanitize({ ...(data.state || {}), balance: data.balance });
    const useLocal = local && local.savedAt > remote.savedAt;
    store.useProfile(user.id, useLocal ? local : remote);
    if (useLocal) await pushNow();
    else setStatus('synced');
    toast(`Welcome back, @${user.login}`, { type: 'win', iconName: 'cloud' });
  } else {
    // First sign-in: bring the guest's progress along, then start the guest fresh.
    const start = local || store.guestState();
    store.useProfile(user.id, start);
    store.clearGuest();
    await pushNow();
    toast(`Your chips are now saved to GitHub @${user.login}`, { type: 'win', iconName: 'cloud', timeout: 4500 });
  }
}

function onSignedOut() {
  user = null;
  accessToken = null;
  store.useProfile(null);
  setStatus('local');
  notify();
}

function schedulePush() {
  if (!user || store.owner !== user.id) return;
  dirty = true;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 1500);
}

function row() {
  const snap = store.snapshot();
  return { id: user.id, balance: snap.balance, biggest_win: snap.stats.biggestWin, bets: snap.stats.bets, state: snap };
}

async function pushNow() {
  if (!client || !user || store.owner !== user.id) return;
  clearTimeout(pushTimer);
  if (pushing) {
    dirty = true;
    return;
  }
  pushing = true;
  dirty = false;
  setStatus('syncing');
  let error = null;
  try {
    ({ error } = await client.from('players').upsert(row(), { onConflict: 'id' }));
  } catch (e) {
    error = e;
  } finally {
    pushing = false;
  }
  if (error) {
    console.warn('[cloud] save failed', error);
    setStatus(navigator.onLine ? 'error' : 'offline');
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 10000);
    return;
  }
  setStatus('synced');
  if (dirty) schedulePush();
}

/** Last-chance save when the tab is hidden or closed (fetch keepalive survives unload). */
function beaconPush() {
  if (!user || !accessToken || store.owner !== user.id || (!dirty && status === 'synced')) return;
  try {
    fetch(`${CONFIG.supabaseUrl.replace(/\/$/, '')}/rest/v1/players?on_conflict=id`, {
      method: 'POST',
      keepalive: true,
      headers: {
        apikey: CONFIG.supabaseKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row()),
    }).catch(() => {});
    dirty = false;
  } catch {
    /* ignore */
  }
}

async function init() {
  if (!enabled) {
    ready = true;
    notify();
    return;
  }
  try {
    await loadScript('vendor/supabase.umd.js');
    client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  } catch (e) {
    console.warn('[cloud] could not start', e);
    setStatus('error');
    ready = true;
    return;
  }

  let session = null;
  try {
    ({ data: { session } } = await client.auth.getSession());
  } catch (e) {
    console.warn('[cloud] session error', e);
  }
  cleanUrl();
  if (session?.user) await onSignedIn(session.user, session);
  ready = true;
  notify();

  client.auth.onAuthStateChange((event, s) => {
    if (s?.access_token) accessToken = s.access_token;
    // Defer: Supabase recommends not awaiting other calls inside this callback.
    setTimeout(() => {
      if (event === 'SIGNED_IN' && s?.user && s.user.id !== user?.id) onSignedIn(s.user, s);
      if (event === 'SIGNED_OUT' && user) onSignedOut();
    }, 0);
  });

  on('persist', schedulePush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') beaconPush();
  });
  window.addEventListener('pagehide', beaconPush);
  window.addEventListener('online', () => user && pushNow());
}

async function signIn() {
  if (!enabled) {
    modal({
      title: 'Save with GitHub',
      body: `
        <p>GitHub sign-in isn't switched on for this copy of CrankedCasino yet, so your chips are being saved in this browser. Everything else works.</p>
        <p class="dim" style="font-size:14px">Site owner? Add your Supabase project keys to <code>js/config.js</code>. The README has a 5-minute walkthrough.</p>`,
      actions: [
        { label: 'Open the README', icon: 'github', onClick: () => window.open(`${CONFIG.repoUrl}#turn-on-github-sign-in`, '_blank', 'noopener') },
        { label: 'Keep playing', primary: true },
      ],
    });
    return;
  }
  if (!client) {
    toast('Sign-in is still loading. Try again in a second.');
    return;
  }
  storage.set('cc:returnTo', location.hash || '');
  const redirectTo = location.origin + location.pathname;
  const { error } = await client.auth.signInWithOAuth({ provider: 'github', options: { redirectTo } });
  if (error) toast(`GitHub sign-in failed: ${error.message}`, { type: 'loss' });
}

async function signOut() {
  if (!client) return;
  await pushNow();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) console.warn(error);
  if (user) onSignedOut();
  toast('Signed out. Playing as a guest on this device.', { iconName: 'logout' });
}

async function leaderboard(limit = 50) {
  if (!enabled) return { data: null, error: 'disabled' };
  if (!client) {
    await new Promise((r) => {
      const off = cloud.onChange(() => {
        if (client || ready) {
          off();
          r();
        }
      });
      setTimeout(r, 4000);
    });
  }
  if (!client) return { data: null, error: 'unavailable' };
  const { data, error } = await client.rpc('leaderboard', { lim: limit });
  return { data, error };
}

export function syncLabel() {
  if (!enabled) return { icon: 'device', text: 'Saved in this browser' };
  if (!user) return { icon: 'device', text: 'Guest · saved in this browser' };
  const who = `@${esc(user.login)}`;
  if (status === 'synced') return { icon: 'cloud', text: `Saved to GitHub ${who}` };
  if (status === 'syncing') return { icon: 'refresh', text: `Saving to GitHub ${who}…` };
  if (status === 'offline') return { icon: 'device', text: 'Offline · will sync when back' };
  return { icon: 'info', text: 'Cloud save hiccup · retrying' };
}

export const cloud = {
  get enabled() {
    return enabled;
  },
  get user() {
    return user;
  },
  get status() {
    return status;
  },
  get ready() {
    return ready;
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  init,
  signIn,
  signOut,
  leaderboard,
  pushNow,
  icon,
};
