(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./game-engine.js'));
  else root.AllStar = factory(root.GameEngine);
})(typeof window !== 'undefined' ? window : this, function (E) {
  'use strict';
  const clone = value => JSON.parse(JSON.stringify(value));
  const key = p => p.mlb ? `m${p.mlb}` : p.customPlayerId || p.name;
  function scheduleBreak(league) {
    const s=league.settings.festivities;
    if(s?.mode!=='midpoint'||(!s.game&&!s.derby)||league.festivitiesCalendar)return;
    const at=Math.max(0,Math.min(league.schedule.length-1,Math.floor(league.schedule.length*(s.midpoint??0.5))));
    const days=s.game&&s.derby?2:1;
    league.schedule.splice(at,0,...Array.from({length:days},()=>[]));
    if(league.scheduleImport?.gameInfo)league.scheduleImport.gameInfo.splice(at,0,...Array.from({length:days},()=>[]));
    league.festivitiesCalendar=[{day:at+(s.derby&&s.game?1:0),derbyDay:at,venue:'Midseason festivities',hostCode:league.teams[0].code,generated:true}];
  }
  function calendar(league) {
    if(league.settings.festivities?.mode==='off'||(league.settings.festivities?.game===false&&league.settings.festivities?.derby===false))return [];
    if(league.festivitiesCalendar)return league.festivitiesCalendar.map((date,index)=>({...date,index}));
    if (!league.scheduleImport) return [];
    let games = league.scheduleImport.allStarGames;
    if (!games) {
      games = [];
      for (let day = 1; day < league.schedule.length - 1; day++) {
        if (league.schedule[day].length || !league.schedule[day-1].length) continue;
        let end = day;
        while (end < league.schedule.length && !league.schedule[end].length) end++;
        const date = new Date(`${league.settings.startDate}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate()+day);
        if (date.getUTCMonth() === 6 && end-day >= 3 && end-day <= 6) {
          games.push({ day:day+1, venue:null, hostCode:null, inferred:true });
        }
      }
    }
    return games.map((game,index) => ({ ...game, index, derbyDay:game.day-1 }));
  }
  function rankings(league) {
    const bat = [], pit = [], seen = new Set();
    league.teams.forEach((team,ti) => {
      for (const p of [...team.roster.lineup,...team.roster.bench]) {
        const id = `bat:${key(p)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const stats = league.stats.reg.bat[key(p)];
        const s = stats && stats.team === ti ? stats : {};
        bat.push({ player:clone(p), team:ti, league:team.league, key:key(p), stats:clone(s),
          score:(s.h || 0)+(s.d || 0)+(s.t || 0)*2+(s.hr || 0)*3+(s.bb || 0)*0.7 });
      }
      for (const p of [...team.roster.rotation,...team.roster.bullpen]) {
        const id = `pit:${key(p)}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const stats = league.stats.reg.pit[key(p)];
        const s = stats && stats.team === ti ? stats : {};
        pit.push({ player:clone(p), team:ti, league:team.league, key:key(p), stats:clone(s),
          score:(s.outs || 0)*0.45+(s.k || 0)*0.8-(s.r || 0)*1.6-(s.bb || 0)*0.5 });
      }
    });
    const batOrder = (a,b) => b.score-a.score || E.batterOverall(b.player)-E.batterOverall(a.player) || a.key.localeCompare(b.key);
    const pitOrder = (a,b) => b.score-a.score || E.pitcherOverall(b.player)-E.pitcherOverall(a.player) || a.key.localeCompare(b.key);
    return { bat:bat.sort(batOrder), pit:pit.sort(pitOrder) };
  }
  function selectTeams(league, ranked) {
    const names = [...new Set(league.teams.map(t=>t.league))];
    const split=names.length!==2||names.some(name=>ranked.bat.filter(p=>p.league===name).length<9||!ranked.pit.some(p=>p.league===name));
    const labels=split?['Stars','Stripes']:names;
    const sideOf=(i)=>Math.floor(i/2)%2===0?i%2:1-i%2;
    return labels.map((name,side) => {
      const pool = ranked.bat.filter((p,i)=>split?sideOf(i)===side:p.league === name);
      const used = new Set(), lineup = [];
      for (const pos of [...E.POSITIONS,'DH']) {
        const pick = pool.find(p=>!used.has(p.key) && p.player.pos === pos)
          || pool.find(p=>!used.has(p.key) && E.eligibleAt(p.player,pos))
          || pool.find(p=>!used.has(p.key));
        if (!pick) throw new Error(`Not enough ${name} hitters for the All-Star lineup.`);
        used.add(pick.key);
        lineup.push({ ...pick.player, pos });
      }
      const bench = pool.filter(p=>!used.has(p.key)).slice(0,8).map(p=>p.player);
      const pitchers = ranked.pit.filter((p,i)=>split?sideOf(i)===side:p.league === name).slice(0,10).map((p,i)=>({ ...p.player, role:i === 0 ? 'SP' : 'RP' }));
      if (!pitchers.length) throw new Error(`No ${name} pitchers are available for the All-Star Game.`);
      return { name:`${name} All-Stars`, group:name, lineup, bench, pitchers };
    });
  }
  function ensure(league, index) {
    league.allStar ||= {};
    const existing = league.allStar[index];
    if (existing) return existing;
    const date = calendar(league).find(c=>c.index === Number(index));
    if (!date || league.day < date.derbyDay) throw new Error('All-Star selections open at the scheduled break.');
    const ranked = rankings(league);
    const entrants = ranked.bat.slice().sort((a,b)=>(b.stats.hr || 0)-(a.stats.hr || 0) || b.player.power-a.player.power || a.key.localeCompare(b.key)).slice(0,8);
    if (entrants.length < 8) throw new Error('The Home Run Derby needs eight available hitters.');
    const selected = selectTeams(league,ranked);
    const canonical = code => ({ OAK:'ATH',ARI:'AZ',WAS:'WSH' }[code] || code);
    const host = league.teams.find(t=>canonical(t.code) === canonical(date.hostCode));
    const homeGroup = host?.league || selected[1].group;
    if (selected[0].group === homeGroup) selected.reverse();
    const event = {
      index:Number(index), seasonNo:league.seasonNo, date, park:host?.park || league.settings.neutralPark || 'dodgers',
      venue:date.venue || `${league.settings.neutralPark || 'dodgers'} (legacy schedule host fallback)`,
      teams:selected, derby:{ entrants, round:0, matches:[], champion:null }, game:null
    };
    for (const [a,b] of [[0,7],[3,4],[1,6],[2,5]]) event.derby.matches.push(match(a,b,0));
    league.allStar[index] = event;
    return event;
  }
  function match(a,b,round) {
    return { a,b,round,turns:[[],[]],winner:null };
  }
  function overrideDerby(league, index, keys) {
    const event = ensure(league,index);
    if (event.derby.matches.some(m=>m.turns.some(t=>t.length))) throw new Error('Derby selections cannot change after the first swing.');
    if (!Array.isArray(keys) || keys.length !== 8 || new Set(keys).size !== 8) throw new Error('Choose eight different Derby hitters.');
    const pool = rankings(league).bat;
    const entrants = keys.map(id=>{
      const entry = pool.find(p=>p.key === id);
      if (!entry) throw new Error('A selected Derby hitter is not on a league roster.');
      return clone(entry);
    });
    event.derby = { entrants,round:0,matches:[[0,7],[3,4],[1,6],[2,5]].map(([a,b])=>match(a,b,0)),champion:null };
    return event;
  }
  function overrideTeams(league,index,selections) {
    const event = ensure(league,index);
    if (event.game) throw new Error('All-Star selections cannot change after the game is completed.');
    if (!Array.isArray(selections) || selections.length !== 2) throw new Error('Choose two All-Star rosters.');
    const pool = rankings(league),used = new Set();
    const pick = (id,kind) => {
      if (used.has(`${kind}:${id}`)) throw new Error('Each player can appear only once across the All-Star rosters.');
      const entry = pool[kind].find(p=>p.key === id);
      if (!entry) throw new Error('A selected All-Star is not on a league roster.');
      used.add(`${kind}:${id}`);
      return clone(entry.player);
    };
    const teams = selections.map((side,i)=>{
      if (!Array.isArray(side.lineup) || side.lineup.length !== 9 || !Array.isArray(side.bench) || !Array.isArray(side.pitchers) || !side.pitchers.length) throw new Error('Each All-Star team needs nine starters and at least one pitcher.');
      const team = { ...clone(event.teams[i]),
        lineup:side.lineup.map((id,j)=>({ ...pick(id,'bat'),pos:[...E.POSITIONS,'DH'][j] })),
        bench:side.bench.map(id=>pick(id,'bat')),
        pitchers:side.pitchers.map((id,j)=>({ ...pick(id,'pit'),role:j === 0 ? 'SP' : 'RP' }))
      };
      const errors = E.validateTeam(team);
      if (errors.length) throw new Error(errors.join(' '));
      return team;
    });
    event.teams = teams;
    delete event.gameConfig;
    return event;
  }
  function controlled(event, entrant) {
    if (Array.isArray(event.derby.controlled)) return event.derby.controlled.includes(entrant);
    const m = currentMatch(event);
    return !!m && (m.control === 'both' || m.control === String(entrant));
  }
  function currentMatch(event) { return event.derby.matches.find(m=>m.winner === null); }
  function battingTurn(event) {
    const m = currentMatch(event);
    if (!m) return null;
    const a = m.turns[0].length, b = m.turns[1].length;
    const side = a < 10 ? 0 : b < 10 ? 1 : a === b ? 0 : 1;
    return { match:m, side, entrant:side === 0 ? m.a : m.b, swing:m.turns[side].length+1, tiebreak:a >= 10 && b >= 10 };
  }
  const totals = turns => ({ hr:turns.filter(s=>s.hr).length, longest:Math.max(0,...turns.filter(s=>s.hr).map(s=>s.distance || 0)) });
  function recordSwing(event, swing) {
    const turn = battingTurn(event);
    if (!turn) throw new Error('This Derby is already complete.');
    const m = turn.match;
    if (!swing || typeof swing.hr !== 'boolean' || !Number.isFinite(swing.distance) || swing.distance < 0) throw new Error('Invalid Derby swing result.');
    m.turns[turn.side].push({ hr:swing.hr, distance:swing.distance, ev:swing.ev || 0, la:swing.la || 0 });
    const lengths = m.turns.map(t=>t.length);
    if (lengths[0] >= 10 && lengths[0] === lengths[1]) {
      const scores = m.turns.map(totals);
      let winner = null;
      if (lengths[0] <= 13) {
        winner = scores[0].hr > scores[1].hr ? m.a : scores[1].hr > scores[0].hr ? m.b : null;
        if (winner === null && lengths[0] === 13) winner = scores[0].longest > scores[1].longest ? m.a : scores[1].longest > scores[0].longest ? m.b : null;
      } else {
        const distances = m.turns.map(turns=>{ const last=turns[turns.length-1]; return last.hr ? last.distance : 0; });
        winner = distances[0] > distances[1] ? m.a : distances[1] > distances[0] ? m.b : null;
      }
      if (winner !== null) m.winner = winner;
    }
    const d = event.derby;
    if (!currentMatch(event)) {
      const round = d.matches.filter(m=>m.round === d.round);
      if (round.length === 1) d.champion = round[0].winner;
      else {
        d.round++;
        for (let i=0;i<round.length;i+=2) d.matches.push(match(round[i].winner,round[i+1].winner,d.round));
      }
    }
    return turn;
  }
  function pending(league) {
    if (league.phase !== 'regular') return [];
    const out = [];
    for (const date of calendar(league)) {
      if (league.day < date.derbyDay) continue;
      if (league.day > date.day && !league.allStar?.[date.index]) continue;
      const event = ensure(league,date.index);
      const s=league.settings.festivities;
      if (s?.derby!==false && event.derby.champion === null) out.push({ event:'derby', index:date.index, id:`${league.seasonNo}.allstar.${date.index}.derby` });
      else if (s?.game!==false && league.day >= date.day && !event.game) out.push({ event:'allstar', index:date.index, id:`${league.seasonNo}.allstar.${date.index}.game` });
    }
    return out;
  }
  function config(league, ref) {
    const event = ensure(league,ref.index);
    if (ref.event === 'allstar' && event.gameConfig) return clone(event.gameConfig);
    const date = new Date(`${league.settings.startDate}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate()+(ref.event === 'derby' ? event.date.derbyDay : event.date.day));
    return {
      away:clone(event.teams[0]),home:clone(event.teams[1]),park:event.park,innings:9,ghost:false,
      seed:(league.seed+league.seasonNo*7919+ref.index*101)>>>0,
      weather:{ ...clone(league.settings.weather),date:date.toISOString().slice(0,10) }
    };
  }
  function derbyGame(league, ref) {
    const event = ensure(league,ref.index),turn = battingTurn(event);
    if (!turn) throw new Error('This Derby is already complete.');
    return createDerbyGame(event,config(league,ref));
  }
  function createDerbyGame(event, config) {
    const turn = battingTurn(event);
    if (!turn) throw new Error('This Derby is already complete.');
    const cfg = clone(config);
    const hitter = event.derby.entrants[turn.entrant].player;
    cfg.away.lineup[0] = { ...clone(hitter),pos:cfg.away.lineup[0].pos };
    cfg.away.name = 'Home Run Derby';
    cfg.coach = ['manual','manual'];
    const game = E.createGame(cfg);
    game.rng = E.makeRng((cfg.seed+event.derby.matches.length*104729+turn.entrant*7919+turn.swing*31)>>>0);
    game.derby = true;
    return game;
  }
  function finishGame(league, ref, result) {
    const event = ensure(league,ref.index);
    if (event.game) return false;
    if (!result || !Array.isArray(result.score) || result.score.length !== 2 || result.score.some(n=>!Number.isFinite(n) || n<0) || result.score[0] === result.score[1]) throw new Error('Invalid All-Star Game result.');
    event.game = clone(result);
    return true;
  }
  function simulate(league, ref, extract) {
    const event = ensure(league,ref.index);
    if (ref.event === 'allstar') {
      if (event.game) return;
      const g = E.createGame(config(league,ref));
      E.simGame(g);
      finishGame(league,ref,extract(g));
      return;
    }
    if (ref.event !== 'derby') throw new Error('Unknown All-Star event.');
    let swings = 0;
    while (event.derby.champion === null) {
      if (swings++ === 1024) throw new Error('The Derby is still tied after this simulation batch. Progress is retained; play or simulate again to continue. No winner was forced.');
      const g = derbyGame(league,ref);
      E.nextPitch(g);
      const swing = E.stepPitch(g,undefined,{derby:true});
      recordSwing(event,{ hr:!!swing.ball?.hr,distance:swing.ball ? E.hitDistance(swing.ball) : 0,ev:swing.ball?.ev || 0,la:swing.ball?.la || 0 });
    }
  }
  return { scheduleBreak, calendar, rankings, ensure, overrideDerby, overrideTeams, controlled, currentMatch, battingTurn, totals, recordSwing, pending, config, derbyGame, createDerbyGame, finishGame, simulate };
});
