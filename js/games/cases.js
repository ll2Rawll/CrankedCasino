import { engine, errorText } from '../engine.js?v=e08da9841def';
import { store, on } from '../store.js?v=e08da9841def';
import { esc, storage } from '../util.js?v=e08da9841def';
import { openAccount } from '../account.js?v=e08da9841def';
import { modal, toast } from '../ui.js?v=e08da9841def';
import { sfx } from '../sound.js?v=e08da9841def';
import { random } from '../rng.js?v=e08da9841def';
import { CASES, CASE_ITEMS, CASE_ENTRY, CASE_ROUND_MS, drawCase, caseTotals } from './cases-data.js?v=e08da9841def';
import { caseScene, warmCaseArt } from './cases-scene.js?v=e08da9841def';

const validId = (id) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '');
const options = (selected) => CASES.map((type) => `<option value="${type.id}" ${selected === type.id ? 'selected' : ''}>${type.name}</option>`).join('');

export default {
  title: 'Case Battles',
  mount(view) {
    view.innerHTML = `<section class="cases-page wrap"><div class="cases-heading"><div><span class="kicker">Cranked originals</span><h1>Case battles</h1><p>Open three cases. Highest item score takes the pot.</p></div><button class="btn btn-outline" data-rules type="button">Cases & odds</button></div><div class="cases-content"></div><p class="cases-error" role="status"></p></section>`;
    const content = view.querySelector('.cases-content');
    const error = view.querySelector('.cases-error');
    let destroyed = false, busy = false, polling = false, timer = 0, generation = 0;
    let scene = null, battle = null, lastState = '', lobbyData = null, lobbySignature = '';
    let selected = ['after-hours', 'after-hours', 'after-hours'];
    let visibility = engine.mode === 'server' ? 'public' : 'bot';
    let roomId = new URLSearchParams(location.hash.split('?')[1] || '').get('battle');
    if (!validId(roomId)) roomId = null;
    const pendingKey = () => `cc:cases:pending:${store.username}`;
    warmCaseArt();

    function setUrl(id) {
      roomId = id;
      history.replaceState(null, '', `${location.pathname}${location.search}#/cases${id ? `?battle=${id}` : ''}`);
    }
    function showError(reply) {
      error.textContent = errorText(reply, 'This battle could not be loaded. Try again.');
    }
    function clearScene() {
      scene?.destroy();
      scene = null;
      lastState = '';
    }
    function back() {
      generation++;
      clearScene();
      battle = null;
      setUrl(null);
      error.textContent = '';
      renderLobby();
      schedule(0);
    }

    function roomRows(rooms) {
      if (!rooms?.length) return '<p class="cases-empty">No open battles yet. Create a room for the next player.</p>';
      return rooms.map((room) => `<div class="cases-room"><div><strong>${esc(room.players[0].name)}</strong><span>${room.cases.map((id) => caseByName(id)).join(' · ')}</span></div><span class="cases-room-price">50 chips</span><button class="btn btn-outline" data-room="${room.id}" type="button">${room.seat === 0 ? 'Open' : 'Join'}</button></div>`).join('');
    }
    function caseByName(id) { return CASES.find((type) => type.id === id)?.name || 'Case'; }
    function renderRooms() {
      const rooms = content.querySelector('[data-rooms]');
      if (!rooms) return;
      const signature = JSON.stringify([lobbyData?.rooms, lobbyData?.recent, lobbyData?.active]);
      if (signature === lobbySignature) return;
      lobbySignature = signature;
      rooms.innerHTML = roomRows(lobbyData?.rooms);
      const recent = content.querySelector('[data-recent]');
      recent.innerHTML = (lobbyData?.recent || []).slice(0, 6).map((room) => `<button class="cases-recent" data-room="${room.id}" type="button"><span>${room.players.map((player) => player ? esc(player.name) + (player.bot ? ' (bot)' : '') : 'Open seat').join(' vs ')}</span><strong>${room.state === 'complete' ? `${room.totals[0]}–${room.totals[1]}` : room.state === 'cancelled' ? 'Refunded' : room.state === 'waiting' ? 'Waiting' : 'Opening'}</strong></button>`).join('');
      content.querySelector('[data-recent-section]').hidden = !lobbyData?.recent?.length;
      const resume = content.querySelector('[data-resume]');
      resume.hidden = !lobbyData?.active;
      resume.dataset.room = lobbyData?.active || '';
    }
    function renderLobby() {
      view.querySelector('.cases-heading').hidden = false;
      const online = engine.mode === 'server';
      const signedIn = store.signedIn;
      lobbySignature = '';
      content.innerHTML = `<div class="cases-create panel">
        <div class="cases-create-top"><h2>Build your battle</h2><span>50 chip entry <b>·</b> 100 chip pot</span></div>
        <div class="cases-selection">${selected.map((id, i) => `<label class="cases-choice"><img src="assets/cases/case.webp?v=2" alt="" style="filter:hue-rotate(${CASES.find((type) => type.id === id).hue}deg)"><span>Round ${i + 1}</span><select data-case="${i}" aria-label="Case for round ${i + 1}">${options(id)}</select></label>`).join('')}</div>
        <div class="cases-create-bottom"><label class="cases-mode">Battle type<select data-visibility aria-label="Battle type">${online ? `<option value="public" ${visibility === 'public' ? 'selected' : ''}>Public room</option><option value="private" ${visibility === 'private' ? 'selected' : ''}>Invite-only room</option>` : ''}<option value="bot" ${visibility === 'bot' ? 'selected' : ''}>Bot battle</option></select></label><div class="cases-create-buttons"><button class="btn btn-outline" data-practice type="button">Free practice</button><button class="btn btn-primary" data-create type="button">${signedIn ? visibility === 'bot' ? 'Battle bot · 50 chips' : 'Create battle · 50 chips' : 'Sign in to battle'}</button></div></div>
        <p class="cases-note">${online ? 'Both players open the same cases. Item values count toward your score. A draw returns 50 chips to each player.' : 'Bot battles and free practice are available on this device. Online rooms become available when the casino connects.'}</p>
        <button class="btn btn-outline" data-resume type="button" hidden>Resume your battle</button>
      </div>
      <section class="cases-rooms" ${online && signedIn ? '' : 'hidden'}><h2>Open battles</h2><div data-rooms><p class="cases-empty">Loading rooms…</p></div></section>
      <section class="cases-rooms" data-recent-section hidden><h2>Your recent battles</h2><div data-recent></div></section>`;
      if (lobbyData) renderRooms();
      updatePending();
    }
    function updatePending() {
      const pending = storage.get(pendingKey(), null);
      if (!pending || !validId(pending.id)) return;
      const create = content.querySelector('[data-create]');
      if (create) create.textContent = 'Retry pending battle';
      content.querySelectorAll('select').forEach((select) => { select.disabled = true; });
    }

    function renderWaiting() {
      clearScene();
      const own = battle.seat === 0;
      const invite = `${location.origin}${location.pathname}#/cases?battle=${battle.id}`;
      content.innerHTML = `<div class="cases-waiting panel"><span class="kicker">${battle.visibility === 'private' ? 'Invite-only battle' : 'Public battle'}</span><h2>${own ? 'Your opponent has an open seat' : `Join ${esc(battle.players[0].name)}’s battle`}</h2><div class="cases-waiting-cases">${battle.cases.map((id) => `<div><img src="assets/cases/case.webp?v=2" alt=""><span>${caseByName(id)}</span></div>`).join('')}</div><p>3 rounds · 50 chips each · 100 chip pot</p>${own ? `<label class="cases-invite">Invite link<input value="${esc(invite)}" readonly aria-label="Battle invite link"></label><div class="cases-wait-actions"><button class="btn btn-primary" data-copy type="button">Copy invite</button><button class="btn btn-outline" data-cancel type="button">Cancel & return 50 chips</button></div><p class="cases-note">Your 50 chips are reserved. The battle starts when a second player joins. Unjoined rooms expire after 10 minutes.</p>` : '<button class="btn btn-primary" data-join type="button">Join battle · 50 chips</button>'}<button class="btn btn-ghost" data-back type="button">Back to battles</button></div>`;
      lastState = 'waiting';
    }

    function accept(reply) {
      if (!reply?.ok) { showError(reply); return; }
      error.textContent = '';
      store.sync(reply);
      battle = reply.battle;
      if (!battle) return;
      if (battle.state === 'cancelled') {
        clearScene();
        content.innerHTML = '<div class="cases-waiting panel"><h2>Battle closed</h2><p>The reserved 50 chips were returned to the host.</p><button class="btn btn-primary" data-back type="button">Back to battles</button></div>';
        return;
      }
      if (battle.state === 'waiting') {
        if (lastState !== 'waiting') renderWaiting();
        return;
      }
      if (!scene) {
        clearScene();
        view.querySelector('.cases-heading').hidden = true;
        scene = caseScene(content, battle, { onBack: back, onFinish: () => { if (!battle.practice) store.refresh(); } });
      }
      scene.update(battle, reply.server_now);
    }

    async function openRoom(id) {
      generation++;
      clearScene();
      battle = null;
      setUrl(id);
      content.innerHTML = '<div class="cases-waiting panel"><p>Loading battle…</p><button class="btn btn-outline" data-back type="button">Back to battles</button></div>';
      schedule(0);
    }
    async function create() {
      if (!store.signedIn) { openAccount(); return; }
      const account = store.username;
      const current = generation;
      let pending = storage.get(pendingKey(), null);
      if (!pending || !validId(pending.id)) {
        if (!store.canAfford(CASE_ENTRY)) { showError({ error: 'funds' }); return; }
        pending = { id: crypto.randomUUID(), cases: [...selected], visibility };
        storage.set(pendingKey(), pending);
      }
      const reply = await engine.casesCreate(pending.id, pending.cases, pending.visibility);
      if (destroyed || account !== store.username || current !== generation) return;
      if (reply.ok) {
        storage.remove(pendingKey());
        setUrl(reply.battle.id);
        accept(reply);
      } else if (reply.error === 'battle_active') {
        storage.remove(pendingKey());
        openRoom(reply.battle_id);
      } else {
        if (!['network', 'server'].includes(reply.error)) storage.remove(pendingKey());
        showError(reply);
        updatePending();
      }
    }
    function practice() {
      generation++;
      clearScene();
      setUrl(null);
      const pulls = selected.map((id) => [drawCase(id, random), drawCase(id, random)]);
      battle = { id: 'practice', practice: true, visibility: 'bot', state: 'running', cases: [...selected],
        players: [{ name: store.username || 'You', bot: false }, { name: 'Rook', bot: true }], seat: 0,
        pulls, totals: caseTotals(pulls), started: Date.now() + 3000, payout: 0 };
      accept({ ok: true, battle, server_now: Date.now() });
    }
    async function cancel() {
      const current = generation;
      const reply = await engine.casesCancel(battle.id);
      if (!destroyed && current === generation) accept(reply);
    }
    async function join() {
      if (!store.canAfford(CASE_ENTRY)) { showError({ error: 'funds' }); return; }
      const current = generation;
      const reply = await engine.casesJoin(battle.id);
      if (!destroyed && current === generation) accept(reply);
    }
    function schedule(delay = 1250) {
      clearTimeout(timer);
      if (!destroyed) timer = setTimeout(poll, delay);
    }
    async function poll() {
      if (destroyed) return;
      if (polling || busy || document.hidden) { schedule(); return; }
      if (battle?.practice) {
        if (Date.now() >= battle.started + 3 * CASE_ROUND_MS) {
          battle.state = 'complete';
          scene?.update(battle, Date.now());
        }
        schedule();
        return;
      }
      if (!store.signedIn) { schedule(3000); return; }
      if (battle?.state === 'complete' || battle?.state === 'cancelled') return;
      polling = true;
      const current = generation;
      const account = store.username;
      try {
        const reply = roomId ? await engine.casesGet(roomId) : await engine.casesList();
        if (destroyed || current !== generation || account !== store.username) return;
        if (!reply.ok) { showError(reply); return; }
        if (roomId) accept(reply);
        else {
          store.sync(reply);
          lobbyData = reply;
          renderRooms();
        }
      } finally {
        polling = false;
        schedule(roomId ? 900 : 3500);
      }
    }

    content.addEventListener('change', (event) => {
      if (event.target.matches('[data-case]')) {
        const index = Number(event.target.dataset.case);
        selected[index] = event.target.value;
        const type = CASES.find((item) => item.id === selected[index]);
        event.target.closest('label').querySelector('img').style.filter = `hue-rotate(${type.hue}deg)`;
      }
      if (event.target.matches('[data-visibility]')) {
        visibility = event.target.value;
        content.querySelector('[data-create]').textContent = store.signedIn ? visibility === 'bot' ? 'Battle bot · 50 chips' : 'Create battle · 50 chips' : 'Sign in to battle';
      }
    });
    content.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.hasAttribute('data-back')) { back(); return; }
      if (button.dataset.room) { openRoom(button.dataset.room); return; }
      if (button.hasAttribute('data-practice')) { practice(); return; }
      if (button.hasAttribute('data-copy')) {
        const input = content.querySelector('.cases-invite input');
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied.'); }
        catch { input.focus(); input.select(); toast('Select and copy the invite link.'); }
        return;
      }
      const action = button.hasAttribute('data-create') ? create : button.hasAttribute('data-cancel') ? cancel : button.hasAttribute('data-join') ? join : null;
      if (!action) return;
      busy = true;
      button.disabled = true;
      sfx.click();
      try { await action(); } catch (exception) { console.error(exception); showError({ error: 'network' }); }
      finally { busy = false; if (button.isConnected) button.disabled = false; schedule(0); }
    });
    view.querySelector('[data-rules]').addEventListener('click', () => {
      modal({ title: 'Cases & odds', body: `<p>Both players open the same three selected cases. Each item adds its listed points. The higher total wins the 100-chip pot. A tie returns 50 chips to each player. Items are scores for this battle.</p><div class="case-odds-scroll"><table class="case-odds"><thead><tr><th>Item</th><th>Points</th>${CASES.map((type) => `<th>${type.name}</th>`).join('')}</tr></thead><tbody>${CASE_ITEMS.map((item, i) => `<tr><th>${item.name}<small>${item.tier}</small></th><td>${item.value}</td>${CASES.map((type) => `<td>${type.weights[i]}%</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>Every pull is independent. Bot opponents use the same odds. Public rooms accept the next player. Invite-only rooms require the link. A waiting room can be cancelled for a full refund and expires after 10 minutes.</p>` });
    });
    const stopAccount = on('account', () => {
      generation++;
      clearScene();
      battle = null;
      lobbyData = null;
      if (roomId && store.signedIn) openRoom(roomId);
      else if (roomId) signInRoom();
      else renderLobby();
      schedule(0);
    });
    function signInRoom() {
      content.innerHTML = '<div class="cases-waiting panel"><h2>You have a battle invite</h2><p>Sign in to view the cases and join the room.</p><button class="btn btn-primary" data-create type="button">Sign in to view battle</button><button class="btn btn-outline" data-back type="button">Back to battles</button></div>';
    }
    function onVisible() { if (!document.hidden) schedule(0); }
    document.addEventListener('visibilitychange', onVisible);
    if (roomId) { if (store.signedIn) openRoom(roomId); else signInRoom(); }
    else renderLobby();
    schedule(0);
    return () => {
      destroyed = true;
      generation++;
      clearTimeout(timer);
      clearScene();
      stopAccount();
      document.removeEventListener('visibilitychange', onVisible);
    };
  },
};
