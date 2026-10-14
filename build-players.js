/* Downloads Baseball Savant + MLB Stats API data and writes players-data.js.
   Run:  node build-players.js [year]      (default: the most recent season with data)
   Ratings: 50 = MLB average, ~100 = best in the league, floor of 20. Small samples are regressed toward 50. */
const fs = require('fs');
const path = require('path');

const SAVANT = 'https://baseballsavant.mlb.com';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'FieldNotes-build-players' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^\uFEFF/, ''));
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const num = (v) => {
  if (v === undefined || v === null || v === '' || v === 'NA') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))) || 1; };

// z-score function built from a reference population.
function zer(values) {
  const clean = values.filter((v) => v !== null && Number.isFinite(v));
  const m = mean(clean);
  const s = sd(clean);
  return (v) => (v === null || v === undefined ? 0 : (v - m) / s);
}

const flip = (fn) => (v) => -fn(v);
// No attribute drops below FLOOR: a 0 would mean a player who can't run or throw.
const FLOOR = 20;
// Small samples are regressed toward average: weight = n / (n + k), so 40 PA says little and 600 PA says nearly everything.
const shrink = (n, k) => n / (n + k);
const rate = (z, w = 1) => Math.max(FLOOR, Math.round(50 + (50 / 3) * z * w));
const up = (legacy) => Math.max(FLOOR, Math.round(50 + (legacy - 50) / 0.6));
const fullName = (lastFirst) => {
  const [last, first] = String(lastFirst).split(',').map((s) => s.trim());
  return first ? `${first} ${last}` : last;
};

async function savant(year, type, selections, min) {
  const url = `${SAVANT}/leaderboard/custom?year=${year}&type=${type}&filter=&min=${min}&selections=${selections.join(',')}&chart=false&r=no&csv=true`;
  return parseCsv(await get(url));
}

async function bios(ids, year) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const json = JSON.parse(await get(`https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(',')}&hydrate=currentTeam,stats(group=[fielding],type=[season],season=${year})`));
    for (const p of json.people || []) {
      // Games played at each fielding position this season; used for multi-position eligibility.
      const games = {};
      for (const group of p.stats || []) {
        for (const split of group.splits || []) {
          const abbr = split.position && split.position.abbreviation;
          if (abbr && abbr !== 'P' && abbr !== 'DH') games[abbr] = (games[abbr] || 0) + (split.stat.gamesPlayed || 0);
        }
      }
      out.set(String(p.id), {
        bats: p.batSide && p.batSide.code, throws: p.pitchHand && p.pitchHand.code,
        pos: p.primaryPosition && p.primaryPosition.abbreviation,
        team: p.currentTeam && (p.currentTeam.abbreviation || p.currentTeam.name),
        teamId: p.currentTeam && p.currentTeam.id,
        games
      });
    }
  }
  return out;
}

async function teamAbbr() {
  const json = JSON.parse(await get('https://statsapi.mlb.com/api/v1/teams?sportId=1'));
  return new Map(json.teams.map((t) => [t.id, t.abbreviation]));
}

async function main() {
  const year = Number(process.argv[2]) || new Date().getFullYear();
  const BAT = ['pa', 'k_percent', 'bb_percent', 'batting_avg', 'on_base_percent', 'slg_percent', 'exit_velocity_avg', 'launch_angle_avg',
    'barrel_batted_rate', 'hard_hit_percent', 'sprint_speed', 'oz_swing_percent', 'swing_percent', 'iz_contact_percent', 'avg_swing_speed', 'home_run'];
  const PIT = ['p_game', 'p_formatted_ip', 'p_starts', 'k_percent', 'bb_percent', 'ff_avg_speed', 'sl_avg_speed', 'whiff_percent', 'oz_swing_percent', 'p_era', 'groundballs_percent'];

  let useYear = year;
  let batRows = await savant(useYear, 'batter', BAT, 25);
  if (batRows.length < 100) { useYear -= 1; batRows = await savant(useYear, 'batter', BAT, 25); }
  const pitRows = await savant(useYear, 'pitcher', PIT, 5);
  const armRows = parseCsv(await get(`${SAVANT}/leaderboard/arm-strength?type=player&year=${useYear}&minThrows=10&pos=&team=&csv=true`));
  const oaaRows = parseCsv(await get(`${SAVANT}/leaderboard/outs_above_average?type=Fielder&startYear=${useYear}&endYear=${useYear}&split=no&team=&range=year&min=10&pos=&roles=&viz=hide&csv=true`));
  console.log(`season ${useYear}: ${batRows.length} batters, ${pitRows.length} pitchers, ${armRows.length} arm rows, ${oaaRows.length} OAA rows`);

  const ids = [...new Set([...batRows, ...pitRows].map((r) => r.player_id))];
  const [bio, teams] = await Promise.all([bios(ids, useYear), teamAbbr()]);

  const arm = new Map(armRows.map((r) => [r.player_id, r]));
  const oaa = new Map(oaaRows.map((r) => [r.player_id, num(r.outs_above_average)]));

  // Reference populations (everyone with a real sample) for the z-scores.
  const ref = batRows.filter((r) => num(r.pa) >= 100).map((r) => Object.fromEntries(BAT.map((k) => [k, num(r[k])])));
  const col = (k) => ref.map((r) => r[k]);
  const zK = zer(col('k_percent')), zBB = zer(col('bb_percent')), zAvg = zer(col('batting_avg'));
  const zBarrel = zer(col('barrel_batted_rate')), zEV = zer(col('exit_velocity_avg')), zSLG = zer(col('slg_percent'));
  const zHH = zer(col('hard_hit_percent')), zChase = zer(col('oz_swing_percent')), zContact = zer(col('iz_contact_percent'));
  const zSpeed = zer(col('sprint_speed')), zSwing = zer(col('swing_percent')), zBatSpeed = zer(col('avg_swing_speed'));

  const armGroup = (pos) => (['LF', 'CF', 'RF'].includes(pos) ? 'arm_of' : ['1B', '2B', '3B', 'SS'].includes(pos) ? 'arm_inf' : 'arm_overall');
  const armStats = {};
  for (const g of ['arm_of', 'arm_inf', 'arm_overall']) armStats[g] = zer(armRows.map((r) => num(r[g])));
  const oaaZ = zer([...oaa.values()]);

  const batters = [];
  for (const r of batRows) {
    const b = bio.get(r.player_id) || {};
    const pa = num(r.pa);
    const pos = b.pos && b.pos !== 'P' && b.pos !== 'TWP' ? b.pos : (b.pos === 'TWP' ? 'DH' : 'DH');
    const wBat = shrink(pa, 150);
    const sprint = num(r.sprint_speed);
    const speed = sprint === null ? 42 : rate(zSpeed(sprint));
    const power = rate(0.35 * zBarrel(num(r.barrel_batted_rate)) + 0.25 * zEV(num(r.exit_velocity_avg)) + 0.2 * zSLG(num(r.slg_percent)) + 0.2 * (num(r.avg_swing_speed) === null ? 0 : zBatSpeed(num(r.avg_swing_speed))));
    const contact = rate(-0.5 * zK(num(r.k_percent)) + 0.3 * zContact(num(r.iz_contact_percent)) + 0.2 * zAvg(num(r.batting_avg)), wBat);
    const eye = rate(0.55 * zBB(num(r.bb_percent)) - 0.45 * zChase(num(r.oz_swing_percent)), wBat);
    const armRow = arm.get(r.player_id);
    const group = armGroup(pos);
    const armVal = armRow ? num(armRow[group]) ?? num(armRow.arm_overall) : null;
    const armRating = armVal === null ? (pos === 'C' ? 58 : 50) : rate(armStats[group](armVal));
    const oaaVal = oaa.get(r.player_id);
    const field = oaaVal === null || oaaVal === undefined ? 50 : Math.max(FLOOR, Math.round(50 + 3 * oaaVal));
    const risk = Math.max(FLOOR, Math.round(50 + 0.5 * (speed - 50) + 5 * zSwing(num(r.swing_percent))));
    const alt = Object.entries(b.games || {}).filter(([p, n]) => p !== pos && n >= 10).sort((x, y) => y[1] - x[1]).map(([p]) => p);
    batters.push({
      id: Number(r.player_id), name: fullName(r['last_name, first_name']), team: teams.get(b.teamId) || b.team || '', pos, natural: pos, alt,
      bats: b.bats || 'R', throws: b.throws || 'R', pa,
      contact, power, eye, speed, arm: armRating, field, risk,
      loft: Math.round(clamp(num(r.launch_angle_avg) ?? 12, 0, 25) * 10) / 10,
      stat: { avg: num(r.batting_avg), obp: num(r.on_base_percent), slg: num(r.slg_percent), hr: num(r.home_run), ev: num(r.exit_velocity_avg), k: num(r.k_percent), bb: num(r.bb_percent), brl: num(r.barrel_batted_rate), spd: sprint }
    });
  }

  const pref = pitRows.filter((r) => num(r.p_game) >= 8);
  const zpK = zer(pref.map((r) => num(r.k_percent))), zpBB = zer(pref.map((r) => num(r.bb_percent)));
  const zpW = zer(pref.map((r) => num(r.whiff_percent))), zpGB = zer(pref.map((r) => num(r.groundballs_percent)));
  const pitchers = [];
  for (const r of pitRows) {
    const b = bio.get(r.player_id) || {};
    const g = num(r.p_game) || 1;
    const ip = num(r.p_formatted_ip) || 0;
    const ipPerG = ip / g;
    const wPit = shrink(ip, 45);
    const starts = num(r.p_starts) || 0;
    const role = starts >= Math.max(3, g * 0.4) || ipPerG >= 4 ? 'SP' : 'RP';
    const velo = num(r.ff_avg_speed) ?? (num(r.sl_avg_speed) ? num(r.sl_avg_speed) + 9 : 92);
    pitchers.push({
      id: Number(r.player_id), name: fullName(r['last_name, first_name']), team: teams.get(b.teamId) || b.team || '', role,
      throws: b.throws || 'R', ip,
      velo: Math.max(FLOOR, Math.round(50 + (velo - 93) * 8)), mph: Math.round(velo * 10) / 10,
      control: rate(-zpBB(num(r.bb_percent)), wPit),
      movement: rate(0.6 * zpW(num(r.whiff_percent)) + 0.25 * zpK(num(r.k_percent)) + 0.15 * zpGB(num(r.groundballs_percent)), wPit),
      stamina: up(clamp(Math.round(role === 'SP' ? 40 + ipPerG * 5 : 22 + ipPerG * 8), 20, 80)),
      stat: { era: num(r.p_era), k: num(r.k_percent), bb: num(r.bb_percent), g, ip }
    });
  }

  batters.sort((a, b) => b.pa - a.pa);
  pitchers.sort((a, b) => b.ip - a.ip);
  const out = `/* Generated by build-players.js from Baseball Savant and the MLB Stats API (${useYear} season). Do not edit by hand. */\n`
    + `window.MLB_PLAYERS = ${JSON.stringify({ year: useYear, built: new Date().toISOString().slice(0, 10), batters, pitchers })};\n`;
  fs.writeFileSync(path.join(__dirname, 'players-data.js'), out);
  console.log(`wrote players-data.js: ${batters.length} batters, ${pitchers.length} pitchers, ${(out.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
