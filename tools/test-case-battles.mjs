// Run with node tools/test-case-battles.mjs.
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const { call } = await import('../js/engine-local.js');
const { CASES, CASE_ITEMS, drawCase, casePayout, caseTotals, itemsForCase, ALL_CASE_ITEMS } = await import('../js/games/cases-data.js');
const signup = await call('cc_signup', { p_username: 'CaseTester', p_password: 'testing-cases-892' });
assert.equal(signup.ok, true);
const token = signup.token;
const rpc = (name, args = {}) => call(name, { p_token: token, ...args });
const id = crypto.randomUUID();
const args = { p_request_id: id, p_cases: ['after-hours', 'neon-vault', 'high-roller'], p_visibility: 'bot' };
assert.equal((await rpc('cc_cases_create', { ...args, p_cases: ['bad'] })).error, 'bad_cases');
assert.equal((await rpc('cc_cases_create', { ...args, p_visibility: 'public' })).error, 'multiplayer_unavailable');
const created = await rpc('cc_cases_create', args);
assert.equal(created.balance, 950);
assert.deepEqual(created.battle.pulls, [null, null, null]);
assert.equal(created.battle.players[1].bot, true);
assert.equal((await rpc('cc_cases_create', args)).balance, 950);
assert.equal((await rpc('cc_cases_create', { ...args, p_request_id: crypto.randomUUID() })).error, 'battle_active');
assert.equal((await rpc('cc_cases_cancel', { p_id: id })).error, 'battle_started');
const db = JSON.parse(localStorage.getItem('cc:device:db'));
const player = Object.values(db.players)[0];
player.caseBattles[0].started = Date.now() - 20000;
delete player.caseBattles[0].entries; // An unfinished battle saved before custom wagers.
player.caseBattles[0].pulls = [[5,0],[4,0],[3,0]];
localStorage.setItem('cc:device:db', JSON.stringify(db));
const settled = await rpc('cc_cases_get', { p_id: id });
assert.equal(settled.battle.state, 'complete');
assert.equal(settled.battle.payout, 100);
assert.equal(settled.balance, 1050);
assert.deepEqual(settled.battle.totals, [395,24]);
assert.equal((await rpc('cc_cases_get', { p_id: id })).balance, 1050);
assert.equal((await rpc('cc_cases_create', args)).balance, 1050);
assert.equal((await rpc('cc_me')).stats.games.cases.bets, 1);
assert.equal((await rpc('cc_cases_list')).active, null);
assert.equal(casePayout([24,24],0), 50);
assert.equal(casePayout([24,32],0), 0);
assert.deepEqual(caseTotals([[0,1],[1,0],[4,5]]), [142,252]);
for (const type of CASES) {
  assert.equal(type.weights.reduce((a,b)=>a+b,0),100);
  let boundary = 0;
  type.weights.forEach((weight,index) => {
    assert.equal(drawCase(type.id, () => (boundary + .00001) / 100), index);
    assert.equal(drawCase(type.id, () => (boundary + weight - .00001) / 100), index);
    boundary += weight;
  });
}
assert.equal(CASE_ITEMS.length,6);
assert.equal(ALL_CASE_ITEMS.length,24);
assert.equal(new Set(ALL_CASE_ITEMS.map(item=>item.id)).size,24);
for(const type of CASES) assert.deepEqual(itemsForCase(type.id).map(item=>item.value),CASE_ITEMS.map(item=>item.value));
const mythicId=crypto.randomUUID();
const mythic=await rpc('cc_cases_create',{p_request_id:mythicId,p_cases:['dragonheart','starfall','leviathan'],p_visibility:'bot'});
assert.equal(mythic.ok,true);
assert.equal(mythic.balance,1000);
const mythicDB=JSON.parse(localStorage.getItem('cc:device:db'));
const mythicBattle=Object.values(mythicDB.players)[0].caseBattles.find(b=>b.id===mythicId);
mythicBattle.started=Date.now()-20000;mythicBattle.pulls=[[5,0],[4,0],[3,0]];
localStorage.setItem('cc:device:db',JSON.stringify(mythicDB));
const mythicResult=await rpc('cc_cases_get',{p_id:mythicId});
assert.deepEqual(mythicResult.battle.totals,[395,24]);
assert.equal(mythicResult.battle.payout,100);
assert.equal((await rpc('cc_cases_get',{p_id:mythicId})).balance,1100);
console.log('Case battles passed odds boundaries, hidden future pulls, balance reservation, retry safety, settlement, history and tie payout checks.');

// Custom bot stakes: persisted entries drive debits, payouts and history.
for (const bad of [0, -.01, .001, NaN, Infinity, null, '75', 1e12 + 1]) {
  assert.equal((await rpc('cc_cases_create', {...args, p_request_id:crypto.randomUUID(), p_bet:bad})).error, 'bad_bet');
}
assert.equal((await rpc('cc_cases_create', {...args,p_request_id:crypto.randomUUID(),p_bet:999999})).error, 'funds');
for (const [amount,pulls,multiplier] of [[125.75,[[5,0],[4,0],[3,0]],2],[.01,[[0,0],[1,1],[2,2]],1],[300,[[0,5],[0,4],[0,3]],0]]) {
  const before=(await rpc('cc_me')).balance;
  const request={...args,p_request_id:crypto.randomUUID(),p_bet:amount};
  const created=await rpc('cc_cases_create',request);
  assert.equal(created.balance,Math.round((before-amount)*100)/100);
  assert.deepEqual(created.battle.entries,[amount,amount]);
  assert.equal(created.battle.pot,amount*2);
  const retry=await rpc('cc_cases_create',{...request,p_bet:800});
  assert.deepEqual(retry.battle.entries,[amount,amount]);
  assert.equal(retry.balance,created.balance);
  const db=JSON.parse(localStorage.getItem('cc:device:db'));
  const battle=Object.values(db.players)[0].caseBattles.find(b=>b.id===request.p_request_id);
  battle.started=Date.now()-30000; battle.pulls=pulls;
  localStorage.setItem('cc:device:db',JSON.stringify(db));
  const result=await rpc('cc_cases_get',{p_id:request.p_request_id});
  assert.equal(result.battle.payout,amount*multiplier);
  assert.equal(result.battle.receipt.a,amount);
  assert.equal(result.balance,Math.round((before+amount*(multiplier-1))*100)/100);
  assert.equal((await rpc('cc_cases_get',{p_id:request.p_request_id})).balance,result.balance);
}
assert.equal(casePayout([24,24],0,[125.75,20.25]),125.75);
assert.equal(casePayout([24,24],1,[125.75,20.25]),20.25);
assert.equal(casePayout([24,25],1,[125.75,20.25]),146);
assert.equal(casePayout([25,24],0,[.1,.2]),.3);
console.log('Custom wagers passed decimal bets, wins/losses/ties, invalid amounts, insufficient funds, immutable retries and exact history amounts.');
