import { engine, errorText } from '../engine.js?v=e109ecc3244d';
import { store, on } from '../store.js?v=e109ecc3244d';
import { esc, storage, fmt, round2 } from '../util.js?v=e109ecc3244d';
import { openAccount } from '../account.js?v=e109ecc3244d';
import { modal, toast, betInput } from '../ui.js?v=e109ecc3244d';
import { sfx } from '../sound.js?v=e109ecc3244d';
import { random } from '../rng.js?v=e109ecc3244d';
import { CASES, CASE_ENTRY, CASE_ROUND_MS, drawCase, caseTotals, validCases, caseById, itemsForCase, caseEntries } from './cases-data.js?v=e109ecc3244d';
import { caseScene, warmCaseArt } from './cases-scene.js?v=e109ecc3244d';

import { caseCover, caseShowcase } from './cases-showcase.js?v=e109ecc3244d';

const validId = (id) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '');
const caseTags = {'after-hours':'Violet mix','neon-vault':'Rare focused','high-roller':'High variance'};
const modeName = (mode) => ({ public: 'Public room', private: 'Invite only', bot: 'Bot battle' })[mode];

export default {
  title: 'Case Battles',
  mount(view) {
    view.innerHTML = `<section class="cases-page wrap"><div class="cases-heading"><div><span class="kicker">Cranked originals</span><h1>Case battles</h1><p>Three cases. Two players. One pot.</p></div><button class="cs-rules" data-rules type="button"><span aria-hidden="true">ⓘ</span> Cases & odds</button></div><div class="cases-content"></div><p class="cases-error" role="status"></p></section>`;
    const content = view.querySelector('.cases-content');
    const error = view.querySelector('.cases-error');
    let destroyed = false, busy = false, polling = false, timer = 0, generation = 0;
    let scene = null, battle = null, lastState = '', lobbyData = null, lobbySignature = '';
    const savedLineup = storage.get('cc:cases:lineup', null);
    let selected = validCases(savedLineup) ? savedLineup : ['after-hours', 'neon-vault', 'high-roller'];
    let activeRound = 0, showcase = null, bet = null;
    let visibility = engine.mode === 'server' ? 'public' : 'bot';
    let roomId = new URLSearchParams(location.hash.split('?')[1] || '').get('battle');
    if (!validId(roomId)) roomId = null;
    const pendingKey = () => `cc:cases:pending:${store.username}`;
    const joinKey = () => `cc:cases:join:${store.username}:${roomId}`;
    warmCaseArt(selected);

    function setUrl(id) {
      roomId = id;
      history.replaceState(null, '', `${location.pathname}${location.search}#/cases${id ? `?battle=${id}` : ''}`);
    }
    function showError(reply) {
      error.textContent = errorText(reply, 'This battle could not be loaded. Try again.');
    }
    function clearScene() {
      showcase?.destroy();
      showcase = null;
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
      return rooms.map((room) => `<div class="cases-room"><div><strong>${esc(room.players[0].name)}</strong><span>${room.cases.map((id) => caseByName(id)).join(' · ')}</span></div><span class="cases-room-price">Host bet<br>${fmt(caseEntries(room)[0])} chips</span><button class="btn btn-outline" data-room="${room.id}" type="button">${room.seat === 0 ? 'Open' : 'Join'}</button></div>`).join('');
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
    function wagerPreview() {
      const amount = Number(bet?.el.querySelector('input').value);
      return Number.isFinite(amount) && amount >= 0 ? round2(amount) : 0;
    }
    function updateStart() {
      const button = content.querySelector('[data-create]');
      if (!button) return;
      const amount = wagerPreview();
      button.setAttribute('aria-label', store.signedIn ? `${visibility === 'bot' ? 'Battle bot' : 'Create battle'} · ${fmt(amount)} chips` : 'Sign in to battle');
      button.innerHTML = `<span>${store.signedIn ? visibility === 'bot' ? 'Battle Rook' : 'Create battle' : 'Sign in to battle'} <i class="cs-arrow" aria-hidden="true"></i></span><b>${fmt(amount)} <small>CHIPS</small></b>`;
      content.querySelector('[data-stake-label]').textContent = visibility === 'bot' ? 'ROOK MATCHES' : 'YOUR RESERVED BET';
      content.querySelector('[data-stake]').textContent = fmt(amount);
      content.querySelector('[data-pot-label]').textContent = visibility === 'bot' ? 'WINNER’S POT' : 'POT SO FAR';
      content.querySelector('[data-pot]').textContent = fmt(visibility === 'bot' ? round2(amount * 2) : amount);
      content.querySelector('[data-bet-note]').textContent = visibility === 'bot' ? 'Rook matches your bet. Bet size does not change item odds.' : 'Your opponent chooses their own bet. Highest item score wins both wagers, even when the amounts differ.';
    }
    function mountBet(selector, amount, update) {
      bet = betInput('cases', { label: 'Your bet', defaultValue: CASE_ENTRY });
      if (amount !== undefined) bet.value = amount;
      content.querySelector(selector).append(bet.el);
      const input = bet.el.querySelector('input');
      let previewAmount = Number(input.value);
      const edited = () => {
        const amount = Number(input.value);
        // Safari can cancel a tap when the input's blur/change redraws its target.
        // Input already updated the preview; formatting the same amount needs no DOM work.
        if (Object.is(amount, previewAmount)) return;
        previewAmount = amount;
        error.textContent = '';
        update();
      };
      bet.el.addEventListener('input', edited);
      bet.el.addEventListener('change', edited);
    }
    function validWager(amount) {
      if (!Number.isFinite(amount) || amount < .01 || amount > 1e12) { bet?.error(); showError({ error: 'bad_bet' }); return false; }
      if (!store.canAfford(amount)) { bet?.error(); showError({ error: 'funds' }); return false; }
      return true;
    }
    function updateLineup(animate = true) {
      content.querySelectorAll('[data-edit-round]').forEach((button, i) => {
        const type = caseById(selected[i]);
        button.setAttribute('aria-pressed', String(i === activeRound));
        button.setAttribute('aria-label', `Edit round ${i + 1}, ${type.name}`);
        button.style.setProperty('--slot-color', type.color);
        button.querySelector('img').src = caseCover(type.id);
        button.querySelector('strong').textContent = type.name;
        button.querySelector('.cs-round-edit').textContent = i === activeRound ? 'EDITING' : 'TAP TO EDIT';
      });
      content.querySelector('.cs-choose-label').textContent = `Choose a case for round ${activeRound + 1}`;
      content.querySelectorAll('[data-case-choice]').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.caseChoice === selected[activeRound]));
        button.setAttribute('aria-label', `Use ${caseById(button.dataset.caseChoice).name} for round ${activeRound + 1}`);
      });
      showcase?.set(caseById(selected[activeRound]), activeRound, animate);
      warmCaseArt([selected[activeRound]]);
    }
    function renderLobby() {
      showcase?.destroy();
      view.querySelector('.cases-heading').hidden = false;
      const online = engine.mode === 'server';
      const pending = storage.get(pendingKey(), null);
      if (validId(pending?.id) && validCases(pending.cases)) { selected = [...pending.cases]; visibility = pending.visibility; }
      lobbySignature = '';
      content.innerHTML = `<div class="cases-create cs-builder">
        <div class="cs-showroom"></div>
        <div class="cs-controls">
          <button class="cs-new-collection" data-new-collection type="button"><span>NEW COLLECTION</span> Mythic cases <b aria-hidden="true">✦</b></button><div class="cs-lineup-heading"><div><span class="cs-eyebrow">YOUR LINEUP</span><h2>Build your battle</h2></div><button data-shuffle type="button" aria-label="Shuffle case lineup"><span aria-hidden="true">⤨</span> Shuffle</button></div>
          <div class="cs-rounds" role="group" aria-label="Your three rounds">${selected.map((id, i) => `<button class="cs-round" data-edit-round="${i}" type="button"><span class="cs-round-number">0${i + 1}</span><img src="${caseCover(id)}" alt=""><strong></strong><span class="cs-round-edit">${i === 0 ? 'EDITING' : 'TAP TO EDIT'}</span></button>`).join('')}</div>
          <dialog class="cs-picker-dialog" aria-label="Choose your case"><div class="cs-picker-heading"><div><span class="cs-eyebrow">THE COLLECTION</span><h3 class="cs-choose-label"></h3></div><button type="button" data-close-picker aria-label="Close case picker">×</button></div>
          <div class="cs-case-picker" role="group" aria-label="Available cases">${[...CASES].sort((a,b)=>Number(!!b.effect)-Number(!!a.effect)).map((type) => `<button data-case-choice="${type.id}" style="--choice-color:${type.color}" type="button"><img src="${caseCover(type.id)}" alt=""><span class="cs-case-option-copy"><strong>${type.name}</strong><small>${type.tag || caseTags[type.id]}</small><span>${type.weights[5]}% Special · ${type.weights[0]}% Common</span></span><span class="cs-choice-check" aria-hidden="true">✓</span></button>`).join('')}</div><p class="cs-picker-note">Any case, your chosen bet. Each case has its own item odds.</p></dialog>
          <div class="cs-battle-mode">${online ? `<span class="cs-eyebrow">OPPONENT</span><div class="cs-mode-picker" role="group" aria-label="Battle type">${['public','private','bot'].map(mode => `<button type="button" data-battle-mode="${mode}" aria-pressed="${visibility === mode}">${modeName(mode)}</button>`).join('')}</div>` : '<span class="cs-bot-avatar" aria-hidden="true"><i></i><i></i></span><div><strong>You vs Rook</strong><span>Bot opponent · this device</span></div><span class="cs-mode-badge">1 VS 1</span>'}</div>
          <div class="cs-wager" data-wager></div><p class="cs-bet-note" data-bet-note></p><div class="cs-stakes"><div><span data-stake-label></span><strong><b data-stake></b> <small>chips</small></strong></div><span class="cs-stakes-arrow" aria-hidden="true">→</span><div><span data-pot-label></span><strong><b data-pot></b> <small>chips</small></strong></div><span class="cs-pot-stack" aria-hidden="true"><i></i><i></i><i></i></span></div>
          <button class="cs-battle-start" data-create type="button"></button>
          <button class="cs-practice" data-practice type="button"><span aria-hidden="true">▷</span> Free practice <small>No chips needed</small></button>
          <p class="cs-fineprint">Highest item score wins. Ties return each player’s own bet.</p>
          <button class="btn btn-outline" data-resume type="button" hidden>Resume your battle</button>
        </div>
      </div>
      <section class="cases-rooms" ${online && store.signedIn ? '' : 'hidden'}><h2>Open battles</h2><div data-rooms><p class="cases-empty">Loading rooms…</p></div></section>
      <section class="cases-rooms" data-recent-section hidden><h2>Your recent battles</h2><div data-recent></div></section>`;
      mountBet('[data-wager]', validId(pending?.id) ? pending.bet ?? CASE_ENTRY : undefined, updateStart);
      showcase = caseShowcase(content.querySelector('.cs-showroom'));
      updateLineup(false);
      updateStart();
      if (lobbyData) renderRooms();
      updatePending();
    }
    function updatePending() {
      const pending = storage.get(pendingKey(), null);
      const locked = !!pending && validId(pending.id);
      bet?.disable(locked);
      if (locked) {
        const create = content.querySelector('[data-create]');
        if (create) { create.textContent = 'Retry pending battle'; create.setAttribute('aria-label', 'Retry pending battle'); }
      } else updateStart();
      content.querySelectorAll('[data-edit-round],[data-case-choice],[data-shuffle],[data-battle-mode],[data-new-collection]').forEach(button => { button.disabled = locked; });
    }

    function updateJoin() {
      const button = content.querySelector('[data-join]');
      if (!button) return;
      const pending = storage.get(joinKey(), null);
      bet.disable(!!pending);
      button.textContent = `${pending ? 'Retry join' : 'Join battle'} · ${fmt(wagerPreview())} chips`;
      content.querySelector('[data-join-pot]').textContent = fmt(round2(caseEntries(battle)[0] + wagerPreview()));
    }
    function renderWaiting() {
      clearScene();
      const own = battle.seat === 0;
      const hostBet = caseEntries(battle)[0];
      const invite = `${location.origin}${location.pathname}#/cases?battle=${battle.id}`;
      content.innerHTML = `<div class="cases-waiting panel"><span class="kicker">${battle.visibility === 'private' ? 'Invite-only battle' : 'Public battle'}</span><h2>${own ? 'Your opponent has an open seat' : `Join ${esc(battle.players[0].name)}’s battle`}</h2><div class="cases-waiting-cases">${battle.cases.map((id) => `<div><img src="${caseCover(id)}" alt=""><span>${caseByName(id)}</span></div>`).join('')}</div><p>3 rounds · Host bet: ${fmt(hostBet)} chips</p>${own ? `<label class="cases-invite">Invite link<input value="${esc(invite)}" readonly aria-label="Battle invite link"></label><div class="cases-wait-actions"><button class="btn btn-primary" data-copy type="button">Copy invite</button><button class="btn btn-outline" data-cancel type="button">Cancel & return ${fmt(hostBet)} chips</button></div><p class="cases-note">Your ${fmt(hostBet)} chips are reserved. Your opponent chooses their own amount. Highest item score wins both wagers, even when they differ. Unjoined rooms expire after 10 minutes.</p>` : `<div class="cs-wager" data-join-wager></div><p class="cases-join-pot">Winner’s pot: <strong data-join-pot></strong> chips</p><p class="cases-note">Choose your own bet. Highest item score wins both wagers. Bet size does not change item odds; a tie returns each player’s own bet.</p><button class="btn btn-primary" data-join type="button"></button>`}<button class="btn btn-ghost" data-back type="button">Back to battles</button></div>`;
      if (!own) { mountBet('[data-join-wager]', storage.get(joinKey(), null)?.bet, updateJoin); updateJoin(); }
      else bet = null;
      lastState = 'waiting';
    }

    function accept(reply) {
      if (!reply?.ok) { showError(reply); return; }
      error.textContent = '';
      store.sync(reply);
      battle = reply.battle;
      if (!battle) return;
      if (battle.state !== 'waiting') storage.remove(joinKey());
      if (battle.state === 'cancelled') {
        clearScene();
        content.innerHTML = `<div class="cases-waiting panel"><h2>Battle closed</h2><p>The reserved ${fmt(caseEntries(battle)[0])} chips were returned to the host.</p><button class="btn btn-primary" data-back type="button">Back to battles</button></div>`;
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
        const amount = bet.value;
        if (!validWager(amount)) return;
        pending = { id: crypto.randomUUID(), cases: [...selected], visibility, bet: amount };
        storage.set(pendingKey(), pending);
      }
      updatePending();
      const reply = await engine.casesCreate(pending.id, pending.cases, pending.visibility, pending.bet ?? CASE_ENTRY);
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
      if (!store.signedIn) { openAccount(); return; }
      let pending = storage.get(joinKey(), null);
      if (!pending) {
        const amount = bet.value;
        if (!validWager(amount)) return;
        pending = { bet: amount };
        storage.set(joinKey(), pending);
      }
      updateJoin();
      const current = generation, account = store.username;
      const reply = await engine.casesJoin(battle.id, pending.bet);
      if (destroyed || current !== generation || account !== store.username) return;
      if (reply.ok || !['network', 'server'].includes(reply.error)) storage.remove(joinKey());
      accept(reply);
      if (battle?.state === 'waiting') updateJoin();
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

    content.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || busy) return;
      if (button.disabled) return;
      if (button.hasAttribute('data-new-collection')) { content.querySelector('.cs-picker-dialog').showModal(); return; }
      if (button.hasAttribute('data-peek')) { showcase?.peek(); return; }
      if (button.hasAttribute('data-close-picker')) { content.querySelector('.cs-picker-dialog').close(); return; }
      if (button.hasAttribute('data-edit-round')) {
        activeRound = Number(button.dataset.editRound);
        updateLineup();
        content.querySelector('.cs-picker-dialog').showModal();
        sfx.click();
        return;
      }
      if (button.dataset.caseChoice) {
        selected[activeRound] = button.dataset.caseChoice;
        content.querySelector('.cs-picker-dialog').close();
        storage.set('cc:cases:lineup', selected);
        updateLineup();
        sfx.click();
        return;
      }
      if (button.hasAttribute('data-shuffle')) {
        selected = selected.map(() => CASES[Math.floor(random() * CASES.length)].id);
        storage.set('cc:cases:lineup', selected);
        updateLineup();
        sfx.shuffle();
        return;
      }
      if (button.dataset.battleMode) {
        visibility = button.dataset.battleMode;
        content.querySelectorAll('[data-battle-mode]').forEach(el => el.setAttribute('aria-pressed', String(el === button)));
        updateStart();
        return;
      }
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
      const body = document.createElement('div');
      body.innerHTML = `<p>Three cases. Each player chooses a bet from 0.01 chips, in whole cents. Bets may differ. The higher item score wins the combined pot; a tie returns each player’s own wager. A larger bet does not improve item odds or score. Rook matches your bet in bot battles. Each pull is independent. Items add points to this battle.</p><label class="case-odds-picker">Explore a case<select aria-label="Case odds">${CASES.map(type=>`<option value="${type.id}">${type.name}</option>`).join('')}</select></label><div class="case-odds-scroll"><table class="case-odds"><thead><tr><th>Item</th><th>Points</th><th>Chance</th></tr></thead><tbody></tbody></table></div><p>Bot opponents use the same odds. Mythic cases use the same six score values and probability profiles as the original collection.</p>`;
      const select = body.querySelector('select');
      select.value = selected[activeRound];
      function renderOdds() {
        const type=caseById(select.value);
        body.querySelector('tbody').innerHTML=itemsForCase(type.id).map((item,i)=>`<tr><th><img src="assets/cases/${item.id}.webp?v=2" alt="">${item.name}<small>${item.tier}</small></th><td>${item.value}</td><td>${type.weights[i]}%</td></tr>`).join('');
      }
      select.addEventListener('change',renderOdds);renderOdds();
      modal({ title: 'Cases & odds', body });
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
