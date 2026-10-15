// Run: node test-player-heights.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('./game-engine.js');
const M = require('./fielding-motion.js');
const L = require('./league-engine.js');
const heights = require('./player-heights.js');
const weights = require('./player-weights.js');
const dataFiles = ['players-data.js', ...fs.readdirSync(path.join(__dirname, 'seasons')).filter((f) => /^players-\d+\.js$/.test(f)).map((f) => path.join('seasons', f))];
let records = 0;
let currentData;
for (const file of dataFiles) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
  const data = context.window.MLB_PLAYERS || Object.values(context.window.MLB_SEASONS)[0];
  if (file === 'players-data.js') currentData = data;
  for (const player of [...data.batters, ...data.pitchers]) {
    assert(Number.isFinite(player.height) && player.height > 0, `${player.name} has an MLB-listed height`);
    assert.equal(player.height, heights[player.id]);
    assert(Number.isFinite(player.weight) && player.weight > 0, `${player.name} has an MLB-listed weight`);
    assert.equal(player.weight, weights[player.id]);
    records++;
  }
  const mlbRoster = L.mlbRoster('NYY', currentData, { bench: 5, rotation: 5, bullpen: 8 });
  for (const player of [...mlbRoster.lineup, ...mlbRoster.bench, ...mlbRoster.rotation, ...mlbRoster.bullpen]) {
    if (player.mlb) assert.equal(player.weight, weights[player.mlb], 'League MLB imports carry listed weight');
  }
}
assert.equal(heights[592450], 79, 'Aaron Judge listed at 6 ft 7');
assert.equal(heights[660271], 76, 'Shohei Ohtani listed at 6 ft 4');
assert.equal(E.playerHeight({ mlb: 592450 }), 79, 'Old saved MLB rosters gain height');
assert.equal(E.playerHeight({ mlb: 592450, height: 72 }), 79, 'Refreshed listed height replaces an old automatic height');
assert.equal(E.playerHeight({ mlb: 592450, height: 90, heightManual: true }), 90, 'Manual override is respected');
assert.equal(E.playerHeight({ height: 120 }), 120, 'Custom height is not upper-capped');
assert.equal(E.playerHeight({}), 72, 'Legacy fictional players retain previous height');
assert.equal(E.playerWeight({ mlb: 592450 }), weights[592450], 'Old MLB rosters gain listed weights');
assert.equal(E.playerWeight({ mlb: 592450, weight: 200 }), weights[592450], 'Automatic MLB weights refresh');
assert.equal(E.playerWeight({ mlb: 592450, weight: 320, weightManual: true }), 320, 'Manual weight overrides are respected');
assert.equal(E.playerWeight({ weight: 1250 }), 1250, 'Custom weights are not upper-capped');
assert.equal(E.playerWeight({}), 200, 'Legacy fictional players use neutral weight');
const builder = fs.readFileSync(path.join(__dirname, 'build-players.js'), 'utf8');
const parseContext = {};
vm.runInNewContext(builder.slice(builder.indexOf('function heightInches('), builder.indexOf('function writeHeights(')), parseContext);
assert.equal(parseContext.heightInches(`6' 7"`), 79);
assert.equal(parseContext.heightInches(`5' 6"`), 66);
assert.throws(() => parseContext.heightInches(null), /Invalid MLB height/);
assert.equal(parseContext.weightPounds(230), 230);
assert.equal(parseContext.weightPounds('185'), 185);
for (const value of [null, '', 0, -20, 'unknown', Infinity]) assert.throws(() => parseContext.weightPounds(value), /Invalid MLB weight/);
const short = M.pose(null, 0, 66), tall = M.pose(null, 0, 84);
assert(!M.canReach(short, 0, 0, 8.5));
assert(M.canReach(tall, 0, 0, 8.5), 'Standing glove reach follows height');
const dive = { kind: 'dive', start: 0.5, contact: 1, end: 2, duration: 0.65, dx: 1, dy: 0 };
assert(M.reach(M.pose(dive, 1, 84), 1.5) > M.reach(M.pose(dive, 1, 66), 1.5), 'Dive body geometry follows height');
const away = E.generateTeam('Away', 'balanced', 1), home = E.generateTeam('Home', 'balanced', 2);
assert([...away.lineup, ...away.bench, ...away.pitchers].every((p) => p.height === 72));
assert([...away.lineup, ...away.bench, ...away.pitchers].every((p) => p.weight === 200));
home.lineup.forEach((p) => { p.height = 84; });
home.pitchers.forEach((p) => { p.height = 80; });
away.lineup[0].height = 66;
home.lineup.forEach((p) => { p.weight = 240; });
home.pitchers.forEach((p) => { p.weight = 225; });
away.lineup[0].weight = 165;
const game = E.createGame({ away, home, park: 'dodgers', seed: 10 });
const event = E.stepPitch(game, { swing: true, ball: { ev: 95, la: 15, dir: 0 } }, { live: { batHuman: false, fieldHuman: false } });
assert(event.live);
const frame = event.live.snapshot();
assert.equal(frame.fielders.find((p) => p.pos === 'P').height, 80);
assert(frame.fielders.filter((p) => p.pos !== 'P').every((p) => p.height === 84 && p.pose.height === 7));
assert.equal(frame.runners.find((p) => p.isBatter).height, 66);
assert.equal(frame.runners.find((p) => p.isBatter).weight, 165);
assert.equal(frame.fielders.find((p) => p.pos === 'P').weight, 225);
assert(frame.fielders.filter((p) => p.pos !== 'P').every((p) => p.weight === 240));
const gameHtml = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
const sceneMessages = [];
const sceneContext = {
  E, game, post: (message) => sceneMessages.push(message)
};
vm.runInNewContext(
  gameHtml.slice(gameHtml.indexOf('    function takeSnap('), gameHtml.indexOf('    function beginRec(')) +
  gameHtml.slice(gameHtml.indexOf('    function sendScene('), gameHtml.indexOf('    const RESULT_COLOR')) +
  '\nconst snap=takeSnap();sendScene(JSON.parse(JSON.stringify(snap)));', sceneContext
);
const scene = sceneMessages.find((message) => message.type === 'gm-scene');
assert.equal(scene.batter.weight, 165, 'Recorded scenes preserve batter weight');
assert.equal(scene.fielders.find((p) => p.pos === 'P').weight, 225);
assert(scene.fielders.filter((p) => p.pos !== 'P').every((p) => p.weight === 240), 'Recorded scenes preserve fielder weights');
for (const bats of ['R','L','S']) {
  for (const throws of ['R','L']) {
    E.currentBatter(game).bats=bats;
    E.currentPitcher(game).throws=throws;
    sceneMessages.length=0;
    vm.runInNewContext(
      gameHtml.slice(gameHtml.indexOf('    function takeSnap('),gameHtml.indexOf('    function beginRec('))+
      gameHtml.slice(gameHtml.indexOf('    function sendScene('),gameHtml.indexOf('    const RESULT_COLOR'))+
      '\nsendScene(JSON.parse(JSON.stringify(takeSnap())));',sceneContext
    );
    const expected=bats==='S'?(throws==='L'?'R':'L'):bats;
    assert.equal(sceneMessages.find(m=>m.type==='gm-scene').batter.side,expected,
      `${bats} hitter against ${throws} pitcher: recorded scene preserves actual batting side`);
  }
}
const visualOnly = (weight) => {
  const away = E.generateTeam('Away', 'balanced', 101), home = E.generateTeam('Home', 'balanced', 102);
  for (const team of [away, home]) for (const p of [...team.lineup, ...team.bench, ...team.pitchers]) p.weight = weight;
  const game = E.createGame({ away, home, park: 'dodgers', seed: 100 });
  const event = E.stepPitch(game, { swing: true, ball: { ev: 100, la: 20, dir: 25 } }, { live: { batHuman: false, fieldHuman: false } });
  const frames = [];
  while (!event.live.done && frames.length < 2400) {
    event.live.step(1 / 120);
    frames.push(event.live.snapshot());
  }
  assert(event.live.done);
  return JSON.stringify(frames, (key, value) => key === 'weight' ? undefined : value);
};
assert.equal(visualOnly(120), visualOnly(500), 'Weight changes neither movement, reach, decisions nor live play outcomes');
const leagueHtml = fs.readFileSync(path.join(__dirname, 'league.html'), 'utf8');
const leagueInputs = [0, away.lineup.length, away.lineup.length + away.bench.length].map((index) => ({
  dataset: { playerHeight: String(index) }, value: '81', listeners: {},
  addEventListener(type, callback) { this.listeners[type] = callback; },
  setCustomValidity(message) { this.error = message; }, reportValidity() {}
}));
const weightInputs = leagueInputs.map((input) => ({
  ...input, dataset: { playerWeight: input.dataset.playerHeight }, value: '235', listeners: {}
}));
let saves = 0;
const leagueTeam = { ...away, roster: { lineup: away.lineup, bench: away.bench, rotation: away.pitchers.slice(0, 1), bullpen: away.pitchers.slice(1) } };
const leagueContext = {
  GE: E, L: { pkey: (_t, p) => p.name }, view: { teamIdx: 0 },
  league: { teams: [leagueTeam], rec: [{w: 0, l: 0}], stats: { reg: { bat: {}, pit: {} } } },
  esc: String, opt: () => '', parkOpts: () => '', myIdx: () => 0, saveNow: () => saves++,
  document: { getElementById: () => ({ addEventListener() {} }) },
  el: { innerHTML: '', querySelectorAll: (selector) => selector === '[data-player-weight]' ? weightInputs : leagueInputs }
};
vm.runInNewContext(leagueHtml.slice(leagueHtml.indexOf('    function tabTeams('), leagueHtml.indexOf('    function tabHistory(')) + '\ntabTeams(el);', leagueContext);
for (const input of leagueInputs) input.listeners.change();
assert.equal(saves, 3, 'League height edits save lineup, bench and pitchers');
assert.equal(away.lineup[0].height, 81);
assert(away.lineup[0].heightManual);
leagueInputs[0].value = '0';
leagueInputs[0].listeners.change();
assert.equal(saves, 3, 'Invalid heights cannot overwrite saved league players');
assert(leagueInputs[0].error);
for (const input of weightInputs) input.listeners.change();
assert.equal(saves, 6, 'League weight edits save lineup, bench and pitchers');
assert.equal(away.lineup[0].weight, 235);
assert(away.lineup[0].weightManual);
weightInputs[0].value = '0';
weightInputs[0].listeners.change();
assert.equal(saves, 6, 'Invalid weights cannot overwrite saved league players');
assert(weightInputs[0].error);
console.log(`Passed: ${records} MLB records across ${dataFiles.length} datasets, height/weight parsing, saved-roster upgrades, overrides, league editors, reach, live measurements and weight-only gameplay equivalence.`);
