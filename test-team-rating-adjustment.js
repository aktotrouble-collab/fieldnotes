// Run: node test-team-rating-adjustment.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const E = require('./game-engine.js');
const html = fs.readFileSync(path.join(__dirname, 'game.html'), 'utf8');
const sandbox = {};
const batKeys = html.match(/const BAT_KEYS = (\[[^;]+\]);/)[0];
const start = html.indexOf('    const PIT_KEYS =');
const end = html.indexOf('    const attrSummary =', start);
vm.runInNewContext(`${batKeys}\n${html.slice(start, end)}\nthis.adjust = adjustTeamRatings;`, sandbox);
const team = E.generateTeam('Balance test', 'balanced', 17);
const opponent = E.generateTeam('Unchanged', 'balanced', 18);
const original = structuredClone(team);
const untouched = JSON.stringify(opponent);
const before = E.teamRatings(team).ovr;
sandbox.adjust(team, 1);
for (const group of ['lineup', 'bench', 'pitchers']) {
  team[group].forEach((player, i) => {
    for (const key of ['contact', 'power', 'eye', 'speed', 'arm', 'field', 'risk', ...(group === 'pitchers' ? ['velo', 'control', 'movement', 'stamina'] : [])]) {
      const base = original[group][i][key] ?? (group === 'pitchers' && key === 'field' ? 40 : 50);
      assert.equal(player[key], base + 1, `${group} ${i}: ${key} increases exactly one`);
    }
    for (const key of ['name', 'pos', 'height', 'weight', 'bats', 'throws', 'loft', 'mlb']) {
      assert.equal(player[key], original[group][i][key], `${key} is not a rating`);
    }
  });
}
assert(Math.abs(E.teamRatings(team).ovr - before - 1) < 1e-8, 'Team overall rises one point');
assert.equal(JSON.stringify(opponent), untouched, 'Opponent is unaffected');
const saved = JSON.parse(JSON.stringify(team, (k, v) => v && v._orig ? { ...v, ...v._orig } : v));
assert.equal(saved.lineup[0].power, original.lineup[0].power, 'Session adjustment does not overwrite saved originals');
sandbox.adjust(team, -1);
assert(Math.abs(E.teamRatings(team).ovr - before) < 1e-8, 'Downgrade reverses upgrade');
team.lineup[0].power = 120;
sandbox.adjust(team, 1);
assert.equal(team.lineup[0].power, 121, 'No upper cap');
team.bench[0].speed = 0;
sandbox.adjust(team, -1);
assert.equal(team.bench[0].speed, 0, 'Ratings do not become negative');
assert.equal(team.lineup[0]._orig.power, original.lineup[0].power, 'Repeated steps retain original reset values');
assert.match(html, /adjustTeamRatings\(team, delta\);\s+saveTeams\(\);\s+renderTeams\(\);/, 'Buttons refresh displayed player and team ratings');
console.log('Passed: whole-roster +/-1, team overall, defaults, pitcher VELO, session persistence, boundaries and opponent isolation.');
