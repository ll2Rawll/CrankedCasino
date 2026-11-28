import { CASE_ENTRY, CASE_ROUND_MS, CASE_COUNTDOWN_MS, validCases, drawCase, caseTotals, casePayout, caseEntries } from './games/cases-data.js?v=0f27056399f9';
import { random } from './rng.js?v=0f27056399f9';

// Uses the casino's existing transaction, balance, and history functions.
export function caseApi({ move, record, money, err, validBet }) {
  function resolve(player, battle) {
    if (battle.state !== 'running' || Date.now() < battle.started + CASE_ROUND_MS * 3) return;
    battle.totals = caseTotals(battle.pulls);
    battle.payout = casePayout(battle.totals, 0, caseEntries(battle));
    battle.entry = record(player, 'cases', caseEntries(battle)[0], battle.payout, `3 cases · ${battle.totals[0]} to ${battle.totals[1]} · bot battle`);
    move(player, battle.payout);
    battle.state = 'complete';
  }
  function view(player, battle) {
    resolve(player, battle);
    const now = Date.now();
    const entries = caseEntries(battle);
    return {
      id: battle.id, state: battle.state, visibility: 'bot', cases: battle.cases, entry: entries[0], entries,
      pot: Math.round((entries[0] + entries[1]) * 100) / 100, created: battle.created, started: battle.started, expires: null,
      players: [{ name: player.username, bot: false }, { name: 'Rook', bot: true }],
      seat: 0, pulls: battle.pulls.map((pull, round) => now >= battle.started + round * CASE_ROUND_MS ? pull : null),
      totals: battle.state === 'complete' ? battle.totals : null,
      payout: battle.state === 'complete' ? battle.payout : null,
      receipt: battle.state === 'complete' ? battle.entry : null,
    };
  }
  function reconcile(player) {
    for (const battle of player.caseBattles || []) resolve(player, battle);
  }
  const reply = (player, battle) => money(player, { ok: true, battle: view(player, battle), server_now: Date.now() });
  return {
    reconcile,
    api: {
      cc_cases_create({ p_request_id, p_cases, p_visibility, p_bet = CASE_ENTRY }, db, player) {
        if (!/^[a-f0-9-]{36}$/i.test(p_request_id || '') || !validCases(p_cases)) return err('bad_cases');
        if (p_visibility !== 'bot') return err('multiplayer_unavailable');
        reconcile(player);
        player.caseBattles ||= [];
        const previous = player.caseBattles.find((battle) => battle.id === p_request_id);
        if (previous) return reply(player, previous);
        if (!validBet(p_bet)) return err('bad_bet');
        const active = player.caseBattles.find((battle) => battle.state === 'running');
        if (active) return err('battle_active', { battle_id: active.id });
        if (player.balance < p_bet) return err('funds');
        const battle = {
          id: p_request_id, state: 'running', cases: [...p_cases], created: Date.now(),
          started: Date.now() + CASE_COUNTDOWN_MS, entries: [p_bet, p_bet],
          pulls: p_cases.map((id) => [drawCase(id, random), drawCase(id, random)]),
        };
        move(player, -p_bet);
        player.caseBattles.unshift(battle);
        // Retain request IDs so even an old retried request cannot create another wager.
        return reply(player, battle);
      },
      cc_cases_get({ p_id }, db, player) {
        const battle = player.caseBattles?.find((item) => item.id === p_id);
        return battle ? reply(player, battle) : err('battle_missing');
      },
      cc_cases_list(_, db, player) {
        reconcile(player);
        const battles = player.caseBattles || [];
        return money(player, {
          ok: true, server_now: Date.now(), rooms: [],
          active: battles.find((battle) => battle.state === 'running')?.id || null,
          recent: battles.slice(0, 12).map((battle) => view(player, battle)),
        });
      },
      cc_cases_join() { return err('multiplayer_unavailable'); },
      cc_cases_cancel() { return err('battle_started'); },
    },
  };
}
