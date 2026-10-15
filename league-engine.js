/* League / season engine for Field Notes. Builds teams, a schedule, simulates games with GameEngine,
   and tracks standings, player stats, playoffs and history. Everything is plain JSON so it can be saved. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game-engine.js'));
  else root.LeagueEngine = factory(root.GameEngine);
})(typeof self !== 'undefined' ? self : this, function (GE) {
  'use strict';

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const R = GE.makeRng;

  /* code: [name, color, park, league, division] */
  const CLUBS = {
    BAL: ['Baltimore Orioles', '#df4601', 'orioles', 'AL', 'East'], BOS: ['Boston Red Sox', '#bd3039', 'red-sox', 'AL', 'East'],
    NYY: ['New York Yankees', '#0c2340', 'yankees', 'AL', 'East'], TB: ['Tampa Bay Rays', '#092c5c', 'rays', 'AL', 'East'],
    TOR: ['Toronto Blue Jays', '#134a8e', 'blue-jays', 'AL', 'East'],
    CWS: ['Chicago White Sox', '#27251f', 'white-sox', 'AL', 'Central'], CLE: ['Cleveland Guardians', '#00385d', 'guardians', 'AL', 'Central'],
    DET: ['Detroit Tigers', '#0c2340', 'tigers', 'AL', 'Central'], KC: ['Kansas City Royals', '#004687', 'royals', 'AL', 'Central'],
    MIN: ['Minnesota Twins', '#002b5c', 'twins', 'AL', 'Central'],
    ATH: ['Athletics', '#006a4e', 'athletics', 'AL', 'West'], HOU: ['Houston Astros', '#eb6e1f', 'astros', 'AL', 'West'],
    LAA: ['Los Angeles Angels', '#ba0021', 'angels', 'AL', 'West'], SEA: ['Seattle Mariners', '#005c5c', 'mariners', 'AL', 'West'],
    TEX: ['Texas Rangers', '#003278', 'rangers', 'AL', 'West'],
    ATL: ['Atlanta Braves', '#ce1141', 'braves', 'NL', 'East'], MIA: ['Miami Marlins', '#00a3e0', 'marlins', 'NL', 'East'],
    NYM: ['New York Mets', '#ff5910', 'mets', 'NL', 'East'], PHI: ['Philadelphia Phillies', '#e81828', 'phillies', 'NL', 'East'],
    WSH: ['Washington Nationals', '#ab0003', 'nationals', 'NL', 'East'],
    CHC: ['Chicago Cubs', '#0e3386', 'cubs', 'NL', 'Central'], CIN: ['Cincinnati Reds', '#c6011f', 'reds', 'NL', 'Central'],
    MIL: ['Milwaukee Brewers', '#12284b', 'brewers', 'NL', 'Central'], PIT: ['Pittsburgh Pirates', '#fdb827', 'pirates', 'NL', 'Central'],
    STL: ['St. Louis Cardinals', '#c41e3a', 'cardinals', 'NL', 'Central'],
    AZ: ['Arizona Diamondbacks', '#a71930', 'diamondbacks', 'NL', 'West'], COL: ['Colorado Rockies', '#33006f', 'rockies', 'NL', 'West'],
    LAD: ['Los Angeles Dodgers', '#005a9c', 'dodgers', 'NL', 'West'], SD: ['San Diego Padres', '#2f241d', 'padres', 'NL', 'West'],
    SF: ['San Francisco Giants', '#fd5a1e', 'giants', 'NL', 'West']
  };
  const CODE_ALIAS = { ATH: ['OAK'], OAK: ['ATH'], AZ: ['ARI'], WSH: ['WAS'] };
  const REST = { off: 0, light: 0.06, normal: 0.1, heavy: 0.16 };
  const EMPHASIS = {
    balanced: [1, 1, 1], mlb: [4.2, 2.1, 1], division: [8, 2, 1], 'no-interleague': [4, 2, 0], 'no-interleague-flat': [1, 1, 0]
  };
  const PALETTE = ['#c0392b', '#2471a3', '#1e8449', '#b9770e', '#7d3c98', '#17808f', '#a04000', '#34495e', '#cb4335', '#1f618d',
    '#239b56', '#9a7d0a', '#6c3483', '#148f77', '#ba4a00', '#2c3e50', '#922b21', '#154360', '#186a3b', '#7e5109'];
  const FIRST = ['Red', 'Blue', 'Green', 'Gold', 'Iron', 'Storm', 'River', 'Harbor', 'Mountain', 'Prairie', 'Desert', 'Forest', 'Lake', 'Coastal', 'Summit', 'Valley', 'Capital', 'Metro', 'Bay', 'Canyon'];
  const SECOND = ['Hawks', 'Wolves', 'Bears', 'Foxes', 'Pilots', 'Rangers', 'Kings', 'Comets', 'Miners', 'Sailors', 'Herons', 'Bison', 'Owls', 'Cranes', 'Rockets', 'Knights', 'Badgers', 'Vipers', 'Otters', 'Falcons'];

  const defaults = () => ({
    gamesPerTeam: 162, seriesLength: 3, emphasis: 'mlb', startDate: '2026-03-26', innings: 9, ghost: true,
    parkMode: 'home', neutralPark: 'yankees', rest: 'normal', rotation: 5, bullpen: 7, bench: 5,
    weather: { mode: 'park', variation: 'steady', tempMode: 'park' },
    playoffs: { enabled: true, qualifiers: 6, roundLengths: [3, 5, 7, 7], reseed: false },
    control: 'hands', myTeam: null, leagueNames: ['AL', 'NL'], seasonLabel: 'Season 1'
  });

  const mergeSettings = (o) => {
    const d = defaults();
    const s = { ...d, ...(o || {}) };
    s.weather = { ...d.weather, ...((o && o.weather) || {}) };
    s.playoffs = { ...d.playoffs, ...((o && o.playoffs) || {}) };
    return s;
  };

  /* ------------------------------------------------------------ rosters */

  let fillerId = 0;
  const filler = (kind, pos) => {
    fillerId += 1;
    if (kind === 'bat') {
      return { name: `Replacement ${fillerId}`, pos, natural: pos, alt: [], bats: 'R', contact: 38, power: 38, eye: 38, speed: 42, arm: 42, field: 42, risk: 50, loft: 50 };
    }
    return { name: `Replacement Arm ${fillerId}`, role: 'RP', throws: 'R', velo: GE.mphToVelo(89), control: 38, movement: 38, stamina: 30 };
  };

  const toBatter = (p, pos) => ({
    name: p.name, pos, bats: p.bats, throws: p.throws, contact: p.contact, power: p.power, eye: p.eye, speed: p.speed, arm: p.arm,
    field: p.field, risk: p.risk, loft: p.loft, height: GE.playerHeight(p), weight: GE.playerWeight(p), heightManual: p.heightManual, weightManual: p.weightManual, customYear: p.customYear, mlb: p.id, natural: p.pos, alt: p.alt || []
  });
  const toPitcher = (p, role) => ({
    name: p.name, role, bats: p.bats, throws: p.throws, contact: p.contact, power: p.power, eye: p.eye, speed: p.speed,
    arm: p.arm, field: p.field, risk: p.risk, loft: p.loft, velo: p.velo, control: p.control, movement: p.movement, stamina: p.stamina, height: GE.playerHeight(p), weight: GE.playerWeight(p), heightManual: p.heightManual, weightManual: p.weightManual, customYear: p.customYear, mlb: p.id
  });

  /* Best lineup, bench, rotation and bullpen from one real club's players. */
  function mlbRoster(code, data, s) {
    const codes = [code, ...(CODE_ALIAS[code] || [])];
    const mine = (p) => codes.includes(p.team);
    const ovr = (p) => GE.batterOverall(p);
    const left = data.batters.filter(mine).sort((a, b) => ovr(b) - ovr(a));
    const take = (p) => { left.splice(left.indexOf(p), 1); return p; };
    const spots = {};
    const order = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B'].sort((a, b) => left.filter((p) => p.pos === a).length - left.filter((p) => p.pos === b).length);
    for (const pos of order) {
      const natural = left.find((p) => p.pos === pos);
      if (natural) spots[pos] = take(natural);
    }
    const dh = left.find((p) => p.pos === 'DH') || left[0];
    if (dh) spots.DH = take(dh);
    const ALL = ['C', 'SS', 'CF', '2B', '3B', 'RF', 'LF', '1B', 'DH'];
    for (const pos of ALL) {
      if (spots[pos] || !left.length) continue;
      const pick = pos === 'DH' ? left[0] : left.slice().sort((a, b) => GE.positionPenalty(a, pos) - GE.positionPenalty(b, pos) || ovr(b) - ovr(a))[0];
      spots[pos] = take(pick);
    }
    const chosen = ALL.filter((pos) => spots[pos]).map((pos) => ({ p: spots[pos], pos }));
    const made = chosen.map((c) => ({ p: toBatter(c.p, c.pos), pos: c.pos, src: c.p }));
    for (const pos of ALL) if (!spots[pos]) made.push({ p: { ...filler('bat', pos), pos }, pos, src: null });
    const order2 = [];
    const pull = (score) => {
      const best = made.filter((c) => !order2.includes(c)).sort((a, b) => score(b.p) - score(a.p))[0];
      if (best) order2.push(best);
    };
    pull((p) => p.contact + p.eye * 1.2 + p.speed * 0.5);
    pull(ovr);
    pull(ovr);
    pull((p) => p.power * 1.5 + p.contact);
    while (order2.length < made.length) pull((p) => p.contact + p.power + p.eye);
    const lineup = order2.map((c) => c.p);

    const bench = [];
    const benchPick = (test) => {
      const p = left.find(test);
      if (p && bench.length < s.bench) bench.push(toBatter(take(p), p.pos));
    };
    benchPick((p) => GE.eligibleAt(p, 'C'));
    benchPick((p) => ['SS', '2B', '3B'].some((q) => GE.eligibleAt(p, q)));
    benchPick((p) => ['CF', 'LF', 'RF'].some((q) => GE.eligibleAt(p, q)));
    benchPick((p) => p.speed >= 60);
    while (bench.length < s.bench && left.length) benchPick(() => true);
    while (bench.length < Math.min(s.bench, 3)) bench.push(filler('bat', 'DH'));

    const pits = data.pitchers.filter(mine).sort((a, b) => GE.pitcherOverall(b) - GE.pitcherOverall(a));
    const sps = pits.filter((p) => p.role === 'SP');
    const rotation = [];
    sps.slice(0, s.rotation).forEach((p) => rotation.push(toPitcher(p, 'SP')));
    const rest = pits.filter((p) => !sps.slice(0, s.rotation).includes(p));
    while (rotation.length < Math.min(s.rotation, 3) && rest.length) rotation.push(toPitcher(rest.shift(), 'SP'));
    const bullpen = rest.slice(0, s.bullpen).map((p) => toPitcher(p, 'RP'));
    while (rotation.length < Math.min(s.rotation, 3)) rotation.push({ ...filler('arm'), role: 'SP', stamina: 45 });
    while (bullpen.length < Math.min(s.bullpen, 4)) bullpen.push(filler('arm'));
    return { lineup, bench, rotation, bullpen };
  }

  /* Turns a saved Game-mode team (lineup, bench, pitchers[]) into a league roster. */
  function rosterFromTeam(team, s) {
    const t = clone(team);
    const sps = t.pitchers.filter((p) => p.role === 'SP');
    const starters = (sps.length ? sps : t.pitchers.slice(0, 1)).slice(0, s.rotation);
    const rotation = starters.map((p) => ({ ...p, role: 'SP' }));
    const bullpen = t.pitchers.filter((p) => !starters.includes(p)).slice(0, s.bullpen).map((p) => ({ ...p, role: 'RP' }));
    while (rotation.length + bullpen.length < 5) bullpen.push(filler('arm'));
    const bench = (t.bench || []).slice(0, s.bench);
    while (bench.length < 3) bench.push(filler('bat', 'DH'));
    return { lineup: t.lineup, bench, rotation, bullpen };
  }

  function generatedRoster(name, style, seed, s) {
    const base = GE.generateTeam(name, style, seed);
    const pool = base.pitchers.slice();
    for (let i = 1; pool.length < s.rotation + s.bullpen && i < 6; i += 1) pool.push(...GE.generateTeam(name, style, seed + 7919 * i).pitchers);
    const seen = new Set(base.lineup.concat(base.bench).map((p) => p.name));
    const names = new Set(seen);
    const uniq = pool.map((p, i) => {
      let n = p.name;
      while (names.has(n)) n = `${p.name} ${['Jr.', 'II', 'III', 'IV'][i % 4]}`;
      names.add(n);
      return { ...p, name: n };
    });
    const sorted = uniq.slice(0, s.rotation + s.bullpen);
    const rotation = sorted.slice(0, s.rotation).map((p) => ({ ...p, role: 'SP' }));
    const bullpen = sorted.slice(s.rotation).map((p) => ({ ...p, role: 'RP' }));
    return { lineup: base.lineup, bench: base.bench.slice(0, s.bench), rotation, bullpen };
  }

  /* ------------------------------------------------------- descriptors */

  function mlbDescriptors(codes) {
    return codes.filter((c) => CLUBS[c]).map((c) => ({ code: c, name: CLUBS[c][0], abbr: c, color: CLUBS[c][1], park: CLUBS[c][2], league: CLUBS[c][3], division: CLUBS[c][4] }));
  }

  function generatedDescriptors(count, leagues, perDivision, seed) {
    const rng = R(seed);
    const parks = GE.PARK_LIST.map((p) => p.id);
    const out = [];
    const names = new Set();
    const leagueNames = ['A', 'B', 'C', 'D'].slice(0, Math.max(1, leagues));
    const divNames = ['East', 'Central', 'West', 'North', 'South', 'Mid'];
    const perLeague = Math.ceil(count / leagueNames.length);
    for (let i = 0; i < count; i += 1) {
      let name;
      do name = `${rng.pick(FIRST)} ${rng.pick(SECOND)}`; while (names.has(name));
      names.add(name);
      const lg = Math.floor(i / perLeague);
      const idxInLeague = i % perLeague;
      const divCount = Math.max(1, Math.round(Math.min(perLeague, perLeague) / Math.max(2, perDivision)));
      const div = Math.min(divCount - 1, Math.floor(idxInLeague / Math.ceil(Math.min(perLeague, count - lg * perLeague) / divCount)));
      out.push({
        name, abbr: name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 3) + '', color: PALETTE[i % PALETTE.length],
        park: parks[i % parks.length], league: leagueNames[lg], division: divNames[div % divNames.length]
      });
    }
    return out;
  }

  /* ----------------------------------------------------------- schedule */

  function buildMatrix(teams, G, emphasis, rng) {
    const n = teams.length;
    const wts = Array.isArray(emphasis) ? emphasis : (EMPHASIS[emphasis] || EMPHASIS.balanced);
    const m = [];
    for (let i = 0; i < n; i += 1) {
      m.push([]);
      for (let j = 0; j < n; j += 1) {
        if (i === j) { m[i].push(0); continue; }
        const same = teams[i].league === teams[j].league;
        const w = same && teams[i].division === teams[j].division ? wts[0] : same ? wts[1] : wts[2];
        m[i].push(w);
      }
    }
    for (let it = 0; it < 300; it += 1) {
      const scale = m.map((row) => {
        const sum = row.reduce((a, b) => a + b, 0);
        return sum > 0 ? G / sum : 1;
      });
      for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1) m[i][j] *= Math.sqrt(scale[i] * scale[j]);
    }
    const base = m.map((row) => row.map(Math.floor));
    const deficit = (i) => G - base[i].reduce((a, b) => a + b, 0);
    const frac = (i, j) => m[i][j] - base[i][j] + rng.next() * 0.01;
    const add = (i, j, k) => { base[i][j] += k; base[j][i] += k; };
    for (let guard = 0; guard < n * G; guard += 1) {
      const needy = [];
      for (let i = 0; i < n; i += 1) if (deficit(i) > 0) needy.push(i);
      if (!needy.length) break;
      if (needy.length >= 2) {
        let best = null;
        for (const i of needy) for (const j of needy) {
          if (i >= j || m[i][j] <= 0) continue;
          const f = frac(i, j);
          if (!best || f > best[0]) best = [f, i, j];
        }
        if (!best) {
          const i = needy[0];
          const j = needy.find((x) => x !== i);
          best = [0, i, j];
        }
        add(best[1], best[2], 1);
      } else {
        // One team is short with no partner: move a game off two other teams onto it.
        const i = needy[0];
        let done = false;
        for (let j = 0; j < n && !done; j += 1) for (let k = j + 1; k < n && !done; k += 1) {
          if (j !== i && k !== i && base[j][k] > 0 && m[i][j] > 0 && m[i][k] > 0) {
            add(j, k, -1); add(i, j, 1); add(i, k, 1); done = true;
          }
        }
        if (!done) break;
      }
    }
    return base;
  }

  function buildSchedule(teams, settings, seed) {
    const rng = R(seed);
    const n = teams.length;
    const G = settings.gamesPerTeam;
    const matrix = buildMatrix(teams, G, settings.emphasis, rng);
    const bal = new Array(n).fill(0);
    const series = [];
    const L = Math.max(1, settings.seriesLength);
    for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
      const total = matrix[i][j];
      if (!total) continue;
      const k = Math.max(1, Math.round(total / L));
      for (let x = 0; x < k; x += 1) series.push({ host: i, guest: j, len: Math.floor(total / k) + (x < total % k ? 1 : 0) });
    }
    for (let x = series.length - 1; x > 0; x -= 1) {
      const y = Math.floor(rng.next() * (x + 1));
      [series[x], series[y]] = [series[y], series[x]];
    }
    // Hosts are picked to keep each club's home/away split even, then refined by flipping series that help.
    for (const s of series) {
      if (bal[s.host] > bal[s.guest]) [s.host, s.guest] = [s.guest, s.host];
      bal[s.host] += s.len;
      bal[s.guest] -= s.len;
    }
    for (let pass = 0; pass < 30; pass += 1) {
      let changed = false;
      for (const s of series) {
        const h = bal[s.host];
        const g = bal[s.guest];
        if (Math.abs(h - 2 * s.len) + Math.abs(g + 2 * s.len) < Math.abs(h) + Math.abs(g)) {
          bal[s.host] -= 2 * s.len; bal[s.guest] += 2 * s.len;
          [s.host, s.guest] = [s.guest, s.host];
          changed = true;
        }
      }
      if (!changed) break;
    }
    const remaining = new Array(n).fill(G);
    const busy = new Array(n).fill(false);
    let pending = series;
    let active = [];
    const days = [];
    while (pending.length || active.length) {
      const order = pending.map((s) => ({ s, k: remaining[s.host] + remaining[s.guest] + rng.next() * 2 })).sort((a, b) => b.k - a.k);
      for (const { s } of order) {
        if (busy[s.host] || busy[s.guest]) continue;
        busy[s.host] = busy[s.guest] = true;
        active.push({ ...s, left: s.len });
        pending = pending.filter((x) => x !== s);
      }
      const day = [];
      for (const s of active) {
        day.push([s.guest, s.host]);
        s.left -= 1;
        remaining[s.host] -= 1;
        remaining[s.guest] -= 1;
      }
      days.push(day);
      active = active.filter((s) => {
        if (s.left > 0) return true;
        busy[s.host] = busy[s.guest] = false;
        return false;
      });
    }
    return days;
  }

  function validateSchedule(league) {
    const n = league.teams.length;
    const counts = new Array(n).fill(0);
    const home = new Array(n).fill(0);
    let doubleBooked = 0;
    for (const day of league.schedule) {
      const seen = new Set();
      for (const [a, h] of day) {
        counts[a] += 1; counts[h] += 1; home[h] += 1;
        if (seen.has(a) || seen.has(h)) doubleBooked += 1;
        seen.add(a); seen.add(h);
      }
    }
    return { counts, home, doubleBooked, days: league.schedule.length };
  }

  /* -------------------------------------------------------------- state */

  const blankRec = () => ({ w: 0, l: 0, rs: 0, ra: 0, hw: 0, hl: 0, aw: 0, al: 0, dw: 0, dl: 0, lw: 0, ll: 0, last: [], streak: 0, h2h: {} });
  const blankStats = () => ({ reg: { bat: {}, pit: {} }, post: { bat: {}, pit: {} } });

  function createLeague(opts, data) {
    const settings = mergeSettings(opts.settings);
    const seed = (opts.seed == null ? Math.floor(Math.random() * 4294967296) : opts.seed) >>> 0;
    const source = opts.source || 'generated';
    const descriptors = opts.teams;
    if (!descriptors || descriptors.length < 2) throw new Error('A league needs at least two teams.');
    const teams = descriptors.map((d, i) => {
      let roster = d.roster ? rosterFromTeam(d.roster, settings) : null;
      if (!roster) {
        if (source === 'mlb' && d.code && data) roster = mlbRoster(d.code, data, settings);
        else roster = generatedRoster(d.name, ['balanced', 'sluggers', 'speed', 'pitching'][Math.floor(R(seed + i).next() * 4)], seed + i * 101, settings);
      }
      return {
        name: d.name, abbr: d.abbr || d.name.slice(0, 3).toUpperCase(), color: d.color || PALETTE[i % PALETTE.length],
        park: d.park || GE.PARK_LIST[i % GE.PARK_LIST.length].id, league: d.league || 'A', division: d.division || 'East',
        code: d.code || null, customId: d.roster && d.roster.customId, src: d.roster && d.roster.src, roster, rot: 0, pst: {}
      };
    });
    const league = {
      v: 1, id: `lg-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5).toString(36)}`,
      name: opts.name || 'My League', created: Date.now(), seed, source, year: opts.year || null, settings,
      teams, schedule: [], day: 0, clock: 0, phase: 'regular', rec: teams.map(blankRec), stats: blankStats(),
      log: [], plog: [], po: null, champion: null, history: opts.history || [], seasonNo: (opts.history || []).length + 1
    };
    league.schedule = buildSchedule(teams, settings, seed);
    return league;
  }

  /* Starts the next season with the same rosters; clears records, stats and the schedule. */
  function archiveSeason(league) {
    const st = standings(league);
    const entry = {
      label: league.settings.seasonLabel, champion: league.champion != null ? league.teams[league.champion].name : null,
      final: league.po && league.po.finalText || null,
      table: league.teams.map((t, i) => ({ name: t.name, league: t.league, division: t.division, w: league.rec[i].w, l: league.rec[i].l, rs: league.rec[i].rs, ra: league.rec[i].ra })),
      leaders: {
        hr: leaders(league, 'reg', 'bat', 'hr', 3), avg: leaders(league, 'reg', 'bat', 'avg', 3), rbi: leaders(league, 'reg', 'bat', 'rbi', 3),
        w: leaders(league, 'reg', 'pit', 'w', 3), k: leaders(league, 'reg', 'pit', 'k', 3), ra9: leaders(league, 'reg', 'pit', 'ra9', 3)
      }
    };
    void st;
    return entry;
  }

  function nextSeason(league, patch) {
    league.history.push(archiveSeason(league));
    const label = (patch && patch.seasonLabel) || `Season ${league.history.length + 1}`;
    league.settings.seasonLabel = label;
    league.seasonNo = league.history.length + 1;
    league.seed = (league.seed + 7919) >>> 0;
    if (patch && patch.rosters) patch.rosters.forEach((r, i) => { if (r) league.teams[i].roster = r; });
    league.teams.forEach((t) => { t.rot = 0; t.pst = {}; });
    league.schedule = buildSchedule(league.teams, league.settings, league.seed);
    Object.assign(league, { day: 0, clock: 0, phase: 'regular', rec: league.teams.map(blankRec), stats: blankStats(), log: [], plog: [], po: null, champion: null });
    return league;
  }

  /* ---------------------------------------------------------- standings */

  function sortTeams(league, ids) {
    const rec = league.rec;
    const pct = (i) => (rec[i].w + rec[i].l ? rec[i].w / (rec[i].w + rec[i].l) : 0);
    return ids.slice().sort((a, b) => {
      if (pct(b) !== pct(a)) return pct(b) - pct(a);
      const ha = rec[a].h2h[b] || [0, 0];
      const hp = ha[0] + ha[1] ? ha[0] / (ha[0] + ha[1]) : 0.5;
      if (hp !== 0.5) return hp > 0.5 ? -1 : 1;
      const da = rec[a].rs - rec[a].ra;
      const db = rec[b].rs - rec[b].ra;
      if (da !== db) return db - da;
      return a - b;
    });
  }

  function standings(league) {
    const leagues = [];
    for (const name of [...new Set(league.teams.map((t) => t.league))]) {
      const divs = [];
      for (const dn of [...new Set(league.teams.filter((t) => t.league === name).map((t) => t.division))]) {
        const ids = league.teams.map((t, i) => i).filter((i) => league.teams[i].league === name && league.teams[i].division === dn);
        const sorted = sortTeams(league, ids);
        const lead = league.rec[sorted[0]];
        divs.push({ name: dn, teams: sorted.map((i) => ({ idx: i, gb: ((lead.w - league.rec[i].w) + (league.rec[i].l - lead.l)) / 2 })) });
      }
      leagues.push({ name, divisions: divs });
    }
    return leagues;
  }

  /* Playoff seeds per league: division winners first (by record), then the best of the rest. */
  function playoffSeeds(league) {
    const q = league.settings.playoffs.qualifiers;
    const seeds = {};
    for (const lg of standings(league)) {
      const all = league.teams.map((t, i) => i).filter((i) => league.teams[i].league === lg.name);
      const winners = sortTeams(league, lg.divisions.map((d) => d.teams[0].idx)).slice(0, q);
      const rest = sortTeams(league, all.filter((i) => !winners.includes(i)));
      seeds[lg.name] = winners.concat(rest).slice(0, Math.min(q, all.length));
    }
    return seeds;
  }

  /* -------------------------------------------------------- game build */

  const hashSeed = (league, id) => {
    let h = (league.seed ^ 0x9e3779b9) >>> 0;
    for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  };
  const pkey = (team, p) => (p.mlb ? `m${p.mlb}` : p.customPlayerId || p.name);

  function prepareTeam(league, idx, rng) {
    const t = league.teams[idx];
    const s = league.settings;
    const lineup = clone(t.roster.lineup);
    const bench = clone(t.roster.bench);
    const base = REST[s.rest] || 0;
    let swaps = 0;
    for (let i = 0; i < lineup.length && base > 0 && swaps < 2; i += 1) {
      const p = lineup[i];
      if (!rng.chance(base * (p.pos === 'C' ? 2 : 1))) continue;
      const pos = p.pos;
      const options = bench.map((b, j) => ({ b, j })).filter((o) => GE.eligibleAt(o.b, pos)).sort((a, b) => GE.batterOverall(b.b) - GE.batterOverall(a.b));
      if (!options.length) continue;
      const { b, j } = options[0];
      lineup[i] = { ...b, pos };
      bench[j] = { ...p, pos: p.natural || p.pos };
      swaps += 1;
    }
    const rot = t.roster.rotation;
    const starter = rot[t.rot % rot.length];
    const used = (p) => t.pst[pkey(t, p)] || null;
    const fresh = [];
    const tired = [];
    for (const p of t.roster.bullpen) {
      const u = used(p);
      const recent = u && league.clock - u.d <= 1;
      if (recent && (u.pc >= 30 || u.streak >= 3 || u.d === league.clock - 0)) tired.push(p);
      else fresh.push(p);
    }
    fresh.sort((a, b) => GE.pitcherOverall(b) - GE.pitcherOverall(a));
    const pitchers = clone([starter, ...fresh, ...tired, ...rot.filter((p) => p !== starter)]);
    return { name: t.name, lineup, bench, pitchers };
  }

  function parkFor(league, ref, rng) {
    const s = league.settings;
    if (s.parkMode === 'neutral') return s.neutralPark;
    if (s.parkMode === 'random') return rng.pick(GE.PARK_LIST).id;
    return league.teams[ref.home].park;
  }

  function gameConfig(league, ref) {
    const seed = hashSeed(league, ref.id);
    const rng = R(seed);
    const s = league.settings;
    return {
      away: prepareTeam(league, ref.away, rng), home: prepareTeam(league, ref.home, rng), park: parkFor(league, ref, rng),
      seed, innings: s.innings, ghost: s.ghost, weather: clone(s.weather)
    };
  }

  /* --------------------------------------------------- extract & apply */

  const BAT_KEYS = ['pa', 'ab', 'h', 'd', 't', 'hr', 'r', 'rbi', 'bb', 'k', 'sb', 'cs'];
  const PIT_KEYS = ['outs', 'h', 'r', 'bb', 'k', 'hr', 'pc', 'bf'];

  /* Pulls the box-score numbers out of a finished GameEngine game into plain JSON. */
  function extract(g) {
    const win = g.score[0] > g.score[1] ? 0 : 1;
    const sides = g.teams.map((t, side) => {
      const seen = new Set();
      const bat = [];
      for (const p of [...t.lineup, ...t.removed]) {
        if (seen.has(p)) continue;
        seen.add(p);
        bat.push({ name: p.name, mlb: p.mlb, customPlayerId: p.customPlayerId, stat: pick(p.stat, BAT_KEYS) });
      }
      const pit = t.pitchers.filter((p) => p.stat && (p.stat.bf > 0 || p.stat.outs > 0)).map((p) => ({ name: p.name, mlb: p.mlb, customPlayerId: p.customPlayerId, stat: pick(p.stat, PIT_KEYS) }));
      return { bat, pit };
    });
    const w = sides[win].pit;
    const lo = sides[1 - win].pit;
    if (w.length) {
      let wi = 0;
      if (w[0].stat.outs < 15) wi = w.reduce((best, p, i) => (i > 0 && p.stat.outs > (w[best].stat.outs || 0) ? i : best), w.length > 1 ? 1 : 0);
      w[wi].dec = 'W';
      const last = w[w.length - 1];
      if (last !== w[wi] && w.length > 1 && last.stat.outs > 0 && Math.abs(g.score[0] - g.score[1]) <= 3) last.dec = 'S';
      w[0].gs = 1;
    }
    if (lo.length) {
      let li = 0;
      lo.forEach((p, i) => { if (p.stat.r > lo[li].stat.r) li = i; });
      lo[li].dec = 'L';
      lo[0].gs = 1;
    }
    return {
      score: [g.score[0], g.score[1]], hits: [g.hits[0], g.hits[1]], errors: [g.errors[0], g.errors[1]],
      inn: Math.max(g.lineScore[0].length, g.lineScore[1].length), sides
    };
  }
  const pick = (obj, keys) => { const o = {}; for (const k of keys) o[k] = (obj && obj[k]) || 0; return o; };

  function applyResult(league, ref, ex) {
    const post = !!ref.post;
    const phase = post ? league.stats.post : league.stats.reg;
    const sideTeams = [ref.away, ref.home];
    ex.sides.forEach((side, k) => {
      const ti = sideTeams[k];
      const team = league.teams[ti];
      for (const b of side.bat) {
        const key = pkey(team, b);
        const row = phase.bat[key] || (phase.bat[key] = { name: b.name, team: ti, g: 0 });
        row.g += 1;
        for (const f of BAT_KEYS) row[f] = (row[f] || 0) + (b.stat[f] || 0);
      }
      for (const p of side.pit) {
        const key = pkey(team, p);
        const row = phase.pit[key] || (phase.pit[key] = { name: p.name, team: ti, g: 0 });
        row.g += 1;
        row.gs = (row.gs || 0) + (p.gs ? 1 : 0);
        row.w = (row.w || 0) + (p.dec === 'W' ? 1 : 0);
        row.l = (row.l || 0) + (p.dec === 'L' ? 1 : 0);
        row.sv = (row.sv || 0) + (p.dec === 'S' ? 1 : 0);
        for (const f of PIT_KEYS) row[f] = (row[f] || 0) + (p.stat[f] || 0);
        const u = team.pst[key];
        team.pst[key] = { d: league.clock, pc: p.stat.pc, streak: u && league.clock - u.d === 1 ? u.streak + 1 : 1 };
      }
      team.rot += 1;
    });
    const dec = (k, d) => { const p = ex.sides[k].pit.find((x) => x.dec === d); return p ? p.name : null; };
    const winSide = ex.score[0] > ex.score[1] ? 0 : 1;
    const hrs = [];
    ex.sides.forEach((side) => side.bat.forEach((b) => { if (b.stat.hr) hrs.push(b.stat.hr > 1 ? `${b.name} ${b.stat.hr}` : b.name); }));
    const row = {
      id: ref.id, d: league.clock, a: ref.away, h: ref.home, sa: ex.score[0], sh: ex.score[1], ha: ex.hits[0], hh: ex.hits[1],
      ea: ex.errors[0], eh: ex.errors[1], inn: ex.inn, w: dec(winSide, 'W'), l: dec(1 - winSide, 'L'), sv: dec(winSide, 'S'), hr: hrs
    };
    if (post) {
      league.plog.push(row);
      const s = ref.series;
      s.games.push(row.id);
      s.w[winSide === 0 ? (s.hi === ref.away ? 0 : 1) : (s.hi === ref.home ? 0 : 1)] += 1;
      return row;
    }
    league.log.push(row);
    const rec = league.rec;
    const A = rec[ref.away];
    const H = rec[ref.home];
    A.rs += ex.score[0]; A.ra += ex.score[1]; H.rs += ex.score[1]; H.ra += ex.score[0];
    const winner = winSide === 0 ? ref.away : ref.home;
    const loser = winSide === 0 ? ref.home : ref.away;
    const W = rec[winner];
    const Lr = rec[loser];
    W.w += 1; Lr.l += 1;
    if (winner === ref.home) { H.hw += 1; A.al += 1; } else { A.aw += 1; H.hl += 1; }
    if (league.teams[winner].league === league.teams[loser].league) {
      W.lw += 1; Lr.ll += 1;
      if (league.teams[winner].division === league.teams[loser].division) { W.dw += 1; Lr.dl += 1; }
    }
    (W.h2h[loser] = W.h2h[loser] || [0, 0])[0] += 1;
    (Lr.h2h[winner] = Lr.h2h[winner] || [0, 0])[1] += 1;
    W.last.push(1); Lr.last.push(0);
    if (W.last.length > 10) W.last.shift();
    if (Lr.last.length > 10) Lr.last.shift();
    W.streak = W.streak > 0 ? W.streak + 1 : 1;
    Lr.streak = Lr.streak < 0 ? Lr.streak - 1 : -1;
    return row;
  }

  /* ----------------------------------------------------------- playoffs */

  const pow2 = (n) => { let b = 1; while (b < n) b *= 2; return b; };
  function bracketOrder(size) {
    let order = [1];
    while (order.length < size) {
      const m = order.length * 2 + 1;
      order = order.flatMap((s) => [s, m - s]);
    }
    return order;
  }
  const hostPattern = (len) => {
    if (len <= 3) return new Array(len).fill(true);
    if (len === 5) return [true, true, false, false, true];
    if (len === 7) return [true, true, false, false, true, false, true];
    return Array.from({ length: len }, (_, i) => (Math.floor(i / 2) % 2 === 0));
  };

  function startPlayoffs(league) {
    const cfg = league.settings.playoffs;
    league.phase = 'playoffs';
    league.po = null;
    if (!cfg.enabled || cfg.qualifiers < 1) return finishSeason(league, sortTeams(league, league.teams.map((t, i) => i))[0]);
    const seeds = playoffSeeds(league);
    const slots = {};
    for (const lg of Object.keys(seeds)) {
      const n = seeds[lg].length;
      slots[lg] = bracketOrder(pow2(n)).map((s) => (s <= n ? { team: seeds[lg][s - 1], seed: s } : null));
    }
    league.po = { seeds, rounds: [], slots, final: false, finalText: null };
    return nextRound(league);
  }

  function lengthFor(league, round, isFinal) {
    const arr = league.settings.playoffs.roundLengths;
    if (isFinal) return arr[arr.length - 1];
    return arr[Math.min(round, Math.max(0, arr.length - 2))];
  }

  function nextRound(league) {
    const po = league.po;
    const lgs = Object.keys(po.slots);
    const round = po.rounds.length;
    if (round > 0) {
      const prev = po.rounds[round - 1];
      if (prev.final) return finishSeason(league, prev.series[0].winner);
      for (const lg of lgs) {
        const cur = po.slots[lg];
        const nextSlots = [];
        for (let i = 0; i < cur.length; i += 2) {
          const a = cur[i];
          const b = cur[i + 1];
          if (!a || !b) { nextSlots.push(a || b); continue; }
          const s = prev.series.find((x) => x.league === lg && ((x.hi === a.team && x.lo === b.team) || (x.hi === b.team && x.lo === a.team)));
          nextSlots.push(s.winner === a.team ? a : b);
        }
        if (league.settings.playoffs.reseed && nextSlots.length > 1) {
          const sorted = nextSlots.filter(Boolean).sort((x, y) => x.seed - y.seed);
          const re = [];
          while (sorted.length) { re.push(sorted.shift()); if (sorted.length) re.push(sorted.pop()); }
          po.slots[lg] = re;
        } else po.slots[lg] = nextSlots;
      }
    }
    const series = [];
    let allOne = true;
    for (const lg of lgs) {
      const cur = po.slots[lg];
      if (cur.length === 1 && !cur[0]) continue;
      if (cur.length > 1) {
        allOne = false;
        for (let i = 0; i < cur.length; i += 2) {
          const a = cur[i];
          const b = cur[i + 1];
          if (!a || !b) continue;
          const hi = a.seed < b.seed ? a : b;
          const lo = hi === a ? b : a;
          series.push({ id: `p${round}-${series.length}`, league: lg, hi: hi.team, lo: lo.team, hiSeed: hi.seed, loSeed: lo.seed, len: lengthFor(league, round, false), w: [0, 0], games: [], winner: null });
        }
      }
    }
    if (allOne) {
      const champs = lgs.map((lg) => po.slots[lg][0]).filter(Boolean);
      if (champs.length === 1) return finishSeason(league, champs[0].team);
      const ordered = sortTeams(league, champs.map((c) => c.team));
      po.final = true;
      series.push({ id: `p${round}-0`, league: 'Final', hi: ordered[0], lo: ordered[1], hiSeed: 1, loSeed: 1, len: lengthFor(league, round, true), w: [0, 0], games: [], winner: null });
      po.rounds.push({ final: true, series });
      return null;
    }
    // A league that already has its champion waits for the others, so a single-league bracket never reaches 'allOne' with leftovers.
    for (const s of series) s.len = s.len || 3;
    po.rounds.push({ final: false, series });
    const lastLeague = lgs.length === 1;
    if (lastLeague && series.length === 1 && po.slots[lgs[0]].length === 2) po.rounds[po.rounds.length - 1].final = true;
    return null;
  }

  function seriesWinner(s) {
    const need = Math.ceil(s.len / 2);
    if (s.w[0] >= need) return s.hi;
    if (s.w[1] >= need) return s.lo;
    return null;
  }

  function finishSeason(league, champIdx) {
    league.phase = 'done';
    league.champion = champIdx;
    if (league.po) {
      const fin = league.po.rounds.length ? league.po.rounds[league.po.rounds.length - 1].series[0] : null;
      if (fin && fin.winner != null) {
        const lose = fin.winner === fin.hi ? fin.lo : fin.hi;
        const ww = fin.winner === fin.hi ? fin.w[0] : fin.w[1];
        const ll = fin.winner === fin.hi ? fin.w[1] : fin.w[0];
        league.po.finalText = `${league.teams[fin.winner].name} def. ${league.teams[lose].name} ${ww}-${ll}`;
      }
    }
    return null;
  }

  /* --------------------------------------------------------- day driver */

  function pendingGames(league) {
    const out = [];
    if (league.phase === 'regular') {
      const day = league.schedule[league.day] || [];
      day.forEach(([away, home], k) => {
        const id = `${league.seasonNo}.${league.day}.${k}`;
        if (!(league.todayDone && league.todayDone[id])) out.push({ id, away, home, post: false });
      });
    } else if (league.phase === 'playoffs' && league.po) {
      const round = league.po.rounds[league.po.rounds.length - 1];
      for (const s of round.series) {
        if (s.winner != null || (league.todayDone && league.todayDone[s.id])) continue;
        const g = s.games.length;
        const hostHi = hostPattern(s.len)[g] !== false;
        const home = hostHi ? s.hi : s.lo;
        const id = `${league.seasonNo}.${s.id}.${g}`;
        if (league.todayDone && league.todayDone[id]) continue;
        out.push({ id, away: home === s.hi ? s.lo : s.hi, home, post: true, series: s });
      }
    }
    return out;
  }

  function simRef(league, ref) {
    const g = GE.createGame(gameConfig(league, ref));
    GE.simGame(g);
    return recordRef(league, ref, extract(g));
  }

  function recordRef(league, ref, ex) {
    const row = applyResult(league, ref, ex);
    (league.todayDone = league.todayDone || {})[ref.id] = 1;
    if (ref.series) league.todayDone[ref.series.id] = 1;
    return row;
  }

  /* Closes out the day once every game is in: advances the date, the series, and the phase. */
  function closeDayIfDone(league) {
    if (pendingGames(league).length) return false;
    league.todayDone = {};
    league.clock += 1;
    if (league.phase === 'regular') {
      league.day += 1;
      if (league.day >= league.schedule.length) startPlayoffs(league);
    } else if (league.phase === 'playoffs') {
      const round = league.po.rounds[league.po.rounds.length - 1];
      for (const s of round.series) if (s.winner == null) s.winner = seriesWinner(s);
      if (round.series.every((s) => s.winner != null)) nextRound(league);
    }
    return true;
  }

  /* Plays today's games, skipping any the caller wants to hold (e.g. the user's own game). */
  function simDay(league, hold) {
    const refs = pendingGames(league);
    const held = [];
    for (const ref of refs) {
      if (hold && hold(ref)) held.push(ref);
      else simRef(league, ref);
    }
    const advanced = held.length ? false : closeDayIfDone(league);
    return { held, advanced };
  }

  const holdFor = (league) => (ref) => league.settings.control === 'hands' && league.settings.myTeam != null && (ref.away === league.settings.myTeam || ref.home === league.settings.myTeam);

  function dateOf(league, day) {
    const d = new Date(`${league.settings.startDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + day);
    return d.toISOString().slice(0, 10);
  }

  /* ---------------------------------------------------------- stat views */

  const ipText = (outs) => `${Math.floor(outs / 3)}.${outs % 3}`;
  const div = (a, b) => (b ? a / b : 0);

  function derivedBat(r) {
    const tb = r.h + r.d + 2 * r.t + 3 * r.hr;
    return { ...r, avg: div(r.h, r.ab), obp: div(r.h + r.bb, r.pa), slg: div(tb, r.ab), ops: div(r.h + r.bb, r.pa) + div(tb, r.ab), tb };
  }
  function derivedPit(r) {
    return { ...r, ip: ipText(r.outs), ra9: div(r.r * 27, r.outs), whip: div((r.h + r.bb) * 3, r.outs), k9: div(r.k * 27, r.outs), bb9: div(r.bb * 27, r.outs) };
  }

  function statRows(league, phase, kind) {
    const map = league.stats[phase][kind];
    const fn = kind === 'bat' ? derivedBat : derivedPit;
    return Object.keys(map).map((key) => ({ key, ...fn(map[key]) }));
  }

  const LOW_IS_BETTER = { ra9: 1, whip: 1, bb9: 1 };
  function leaders(league, phase, kind, stat, n, teamIdx) {
    let rows = statRows(league, phase, kind);
    if (teamIdx != null) rows = rows.filter((r) => r.team === teamIdx);
    if (phase === 'reg' && ['avg', 'obp', 'slg', 'ops', 'ra9', 'whip', 'k9', 'bb9'].includes(stat)) {
      rows = rows.filter((r) => {
        const games = league.rec[r.team].w + league.rec[r.team].l;
        return kind === 'bat' ? r.pa >= 3.1 * games : r.outs >= 3 * games;
      });
    }
    rows.sort((a, b) => (LOW_IS_BETTER[stat] ? a[stat] - b[stat] : b[stat] - a[stat]));
    return rows.slice(0, n).map((r) => ({ name: r.name, team: league.teams[r.team].abbr, v: r[stat] }));
  }

  function teamTotals(league, phase) {
    const out = league.teams.map(() => ({ bat: {}, pit: {} }));
    for (const r of statRows(league, phase, 'bat')) {
      const o = out[r.team].bat;
      for (const k of BAT_KEYS) o[k] = (o[k] || 0) + (r[k] || 0);
    }
    for (const r of statRows(league, phase, 'pit')) {
      const o = out[r.team].pit;
      for (const k of PIT_KEYS) o[k] = (o[k] || 0) + (r[k] || 0);
    }
    return out.map((o) => ({ bat: o.bat.pa ? derivedBat({ h: 0, d: 0, t: 0, hr: 0, ab: 0, bb: 0, pa: 0, ...o.bat }) : null, pit: o.pit.outs ? derivedPit({ h: 0, r: 0, bb: 0, k: 0, hr: 0, ...o.pit }) : null }));
  }

  return {
    CLUBS, EMPHASIS, REST, PARKS: GE.PARK_LIST, defaults, mergeSettings,
    mlbDescriptors, generatedDescriptors, createLeague, nextSeason, buildSchedule, validateSchedule,
    standings, sortTeams, playoffSeeds, startPlayoffs, pendingGames, gameConfig, extract, recordRef, simRef, simDay, closeDayIfDone, holdFor,
    dateOf, statRows, leaders, teamTotals, derivedBat, derivedPit, ipText, pkey, hostPattern, mlbRoster
  };
});
