(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Customizations = factory().createStore(root.localStorage, root.GameEngine, root.LeagueEngine);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const KEY = 'field-notes-customizations-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const BAT = ['contact', 'power', 'eye', 'speed', 'arm', 'field', 'risk', 'loft'];
  const PIT = ['velo', 'control', 'movement', 'stamina'];
  const PLAYER = ['name', 'bats', 'throws', 'age', 'birthDate', 'height', 'weight', 'heightManual', 'weightManual', ...BAT, ...PIT];
  const META = ['name', 'abbr', 'color', 'park'];
  const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
  const playerKey = (year, kind, id) => `${year}:${kind}:${id}`;
  const teamKey = (year, code) => `${year}:${({ OAK:'ATH', ARI:'AZ', WAS:'WSH' })[code] || code}`;
  const empty = () => ({ version: 1, players: {}, teams: {}, fictional: {} });
  function createStore(storage, engine, leagueEngine) {
    function read() {
      const raw = storage.getItem(KEY);
      if (!raw) return { ...empty(), added: {} };
      const state = JSON.parse(raw);
      if (state.version !== 1 || !state.players || !state.teams || !state.fictional) throw new Error('Invalid saved customization data. Export browser data before resetting customizations.');
      state.added ||= {};
      return state;
    }
    function write(state) {
      storage.setItem(KEY, JSON.stringify(state));
    }
    function savePlayer(year, kind, original, edited) {
      const state = read(), patch = {};
      for (const key of PLAYER) {
        if (edited[key] === undefined || edited[key] === original[key]) continue;
        if ([...BAT, ...PIT, 'age', 'height', 'weight'].includes(key) && (!Number.isFinite(edited[key]) || edited[key] < 0 || (['height', 'weight'].includes(key) && edited[key] === 0))) throw new Error(`Invalid ${key}.`);
        patch[key] = edited[key];
      }
      const key = playerKey(year, kind, original.id);
      if (Object.keys(patch).length) state.players[key] = patch;
      else delete state.players[key];
      write(state);
    }
    function data(base) {
      if (!base) return base;
      const state = read();
      const list = kind => base[kind].map(p => ({ ...p, ...state.players[playerKey(base.year, kind, p.id)], customYear: base.year })).concat(
        Object.values(state.added).filter(entry => entry.year === base.year && entry.kind === kind && entry.team && !entry.team.startsWith('custom-'))
          .map(entry => ({ ...entry.player, id:entry.id, customPlayerId:entry.id, customYear:entry.year, team:entry.team, stat:{}, pa:0, ip:0 }))
      );
      return { ...base, batters: list('batters'), pitchers: list('pitchers') };
    }
    function metadata(year, code, base) {
      return { ...base, ...read().teams[teamKey(year, code)] };
    }
    function saveMetadata(year, code, value) {
      const state = read();
      state.teams[teamKey(year, code)] = pick(value, META);
      write(state);
    }
    function resetPlayer(year, kind, id) {
      const state = read();
      delete state.players[playerKey(year, kind, id)];
      write(state);
    }
    function resetTeam(base, code) {
      const state = read();
      delete state.teams[teamKey(base.year, code)];
      const aliases = { ATH: ['OAK'], OAK: ['ATH'], AZ: ['ARI'], WSH: ['WAS'] };
      for (const kind of ['batters', 'pitchers']) for (const p of base[kind]) {
        if ([code, ...(aliases[code] || [])].includes(p.team)) delete state.players[playerKey(base.year, kind, p.id)];
      }
      for (const entry of Object.values(state.added)) if (entry.year === base.year && teamKey(base.year, entry.team) === teamKey(base.year, code)) entry.team = '';
      write(state);
    }
    function saveFictional(team, original) {
      const state = read();
      if (!team.customId) throw new Error('Custom team has no identity.');
      state.fictional[team.customId] = { original: clone(state.fictional[team.customId]?.original || original || team), team: clone(team) };
      write(state);
    }
    function fictional() {
      const state = read();
      return Object.values(state.fictional).map(entry => {
        const team = clone(entry.team);
        const additions = Object.values(state.added).filter(p => p.team === team.customId);
        if (!additions.length) return team;
        if (!leagueEngine) throw new Error('Automatic custom team selection requires the league engine.');
        const batter = p => ({ ...p, id:p.mlb || p.customPlayerId, pos:p.natural || p.pos, team:team.customId });
        const data = {
          batters:[...team.lineup,...team.bench].map(batter),
          pitchers:team.pitchers.map(p => ({ ...p, id:p.mlb || p.customPlayerId, team:team.customId }))
        };
        for (const p of additions) data[p.kind].push({ ...p.player, id:p.id, customPlayerId:p.id, team:team.customId });
        const roster = leagueEngine.mlbRoster(team.customId, data, { bench:team.bench.length, rotation:1, bullpen:Math.max(1,team.pitchers.length-1) });
        const identities = new Map([...team.lineup,...team.bench,...team.pitchers].map(p => [p.mlb || p.customPlayerId,p]));
        for (const addition of additions) identities.set(addition.id,{ ...addition.player, customPlayerId:addition.id });
        const restore = p => {
          const original = identities.get(p.mlb);
          return { ...p, mlb:original?.mlb, customPlayerId:original?.customPlayerId || p.customPlayerId };
        };
        return { ...team, lineup:roster.lineup.map(restore), bench:roster.bench.map(restore), pitchers:[...roster.rotation,...roster.bullpen].map(restore) };
      });
    }
    function added(year) { return Object.values(read().added).filter(p => p.year === Number(year)).map(clone); }
    function saveAdded(year, kind, player, team, id) {
      const state = read();
      if (!['batters','pitchers'].includes(kind)) throw new Error('Choose batter or pitcher.');
      if (!player.name?.trim()) throw new Error('Player name is required.');
      if (kind === 'batters' && !['C','1B','2B','3B','SS','LF','CF','RF','DH'].includes(player.pos)) throw new Error('Choose a valid batting position.');
      if (kind === 'pitchers' && !['SP','RP'].includes(player.role)) throw new Error('Choose starting pitcher or reliever.');
      for (const key of [...BAT,...(kind === 'pitchers' ? PIT : []),'height','weight']) {
        if (!Number.isFinite(player[key]) || player[key] < 0 || (['height','weight'].includes(key) && player[key] <= 0)) throw new Error(`Invalid ${key}.`);
      }
      if (team && !state.fictional[team] && !['BAL','BOS','NYY','TB','TOR','CWS','CLE','DET','KC','MIN','ATH','OAK','HOU','LAA','SEA','TEX','ATL','MIA','NYM','PHI','WSH','WAS','CHC','CIN','MIL','PIT','STL','AZ','ARI','COL','LAD','SD','SF'].includes(team)) throw new Error('Choose an existing team or leave the player unassigned.');
      id ||= `added-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
      const original = state.added[id]?.original || clone(player);
      state.added[id] = { id,year:Number(year),kind,team:team || '',player:{ ...clone(player), customPlayerId:id },original };
      write(state);
      return id;
    }
    function resetAdded(id) {
      const state = read(), entry = state.added[id];
      if (!entry) throw new Error('Added player no longer exists.');
      entry.player = { ...clone(entry.original), customPlayerId:id };
      write(state);
    }
    function removeAdded(id) {
      const state = read();
      delete state.added[id];
      write(state);
    }
    function resetFictional(id, playerId) {
      const state = read(), entry = state.fictional[id];
      if (!entry) throw new Error('Custom team no longer exists.');
      if (!playerId) entry.team = clone(entry.original);
      else for (const group of ['lineup', 'bench', 'pitchers']) {
        const index = entry.team[group].findIndex(p => p.customPlayerId === playerId);
        const original = entry.original[group].find(p => p.customPlayerId === playerId);
        if (index >= 0 && original) entry.team[group][index] = clone(original);
      }
      if (!playerId) for (const player of Object.values(state.added)) if (player.team === id) player.team = '';
      write(state);
    }
    function removeFictional(id) {
      const state = read();
      delete state.fictional[id];
      for (const player of Object.values(state.added)) if (player.team === id) player.team = '';
      write(state);
    }
    function applyRoster(team, bases, fallbackYear, refresh) {
      const state = read();
      const result = clone(team);
      const custom = state.fictional[team.customId];
      if (custom) Object.assign(result, pick(custom.team, META));
      else if (team.src) Object.assign(result, state.teams[teamKey(team.src.year, team.src.club)]);
      for (const group of ['lineup', 'bench', 'pitchers', 'rotation', 'bullpen', 'farm']) {
        if (!result[group]) continue;
        for (const p of result[group]) {
          const kind = ['pitchers', 'rotation', 'bullpen'].includes(group)||(group==='farm'&&p.role) ? 'pitchers' : 'batters';
          const addition = state.added[p.customPlayerId || p.mlb];
          if (addition) { Object.assign(p, pick(addition.player, PLAYER)); continue; }
          if (custom) {
            const replacement = ['lineup', 'bench', 'pitchers'].flatMap(k => custom.team[k]).find(q => q.customPlayerId === p.customPlayerId);
            if (replacement) Object.assign(p, pick(replacement, PLAYER));
          } else if (p.mlb) {
            const year = p.customYear || team.src?.year || team.year || fallbackYear;
            const original = bases[year]?.[kind].find(q => q.id === p.mlb);
            if (refresh && original) {
              const defaults = Object.fromEntries([...BAT, ...(kind === 'pitchers' ? PIT : [])].map(k => [k, k === 'field' && kind === 'pitchers' ? 40 : 50]));
              Object.assign(p, defaults, { heightManual:false, weightManual:false }, pick(original, PLAYER));
              if (engine) Object.assign(p, { height:engine.playerHeight(original), weight:engine.playerWeight(original) });
            }
            Object.assign(p, state.players[playerKey(year, kind, p.mlb)]);
          }
        }
      }
      return result;
    }
    function updateLeague(league, bases, clubs) {
      if(league.franchise?.year>league.settings.franchise?.startYear)throw new Error('Player data is frozen at franchise initialization. Later real-world customization imports are disabled to preserve this league timeline.');
      const result = clone(league);
      result.teams.forEach((team, index) => {
        const code = team.code || team.src?.club;
        const year = team.src?.year || league.year;
        const canonical = ({ OAK:'ATH', ARI:'AZ', WAS:'WSH' })[code] || code;
        if (code && clubs[canonical]) Object.assign(team, metadata(year, code, clubs[canonical]));
        const source = { ...team.roster, farm:team.farm, customId:team.customId, src:team.code ? { year:league.year, club:team.code } : team.src };
        const updated = applyRoster(source, bases, league.year, true);
        Object.assign(team, pick(updated, META));
        for (const group of ['lineup','bench','rotation','bullpen']) team.roster[group] = updated[group];
        if(team.farm)team.farm=updated.farm;
        for(const entry of team.il||[]) {
          const group=entry.player.role?'rotation':'bench';
          entry.player=applyRoster({[group]:[entry.player],customId:source.customId,src:source.src},bases,league.year,true)[group][0];
        }
        const owned=[...team.roster.lineup,...team.roster.bench,...team.roster.rotation,...team.roster.bullpen,...(team.farm||[]),...(team.il||[]).map(e=>e.player)];
        for(const p of owned) {
          const key=p.mlb?`m${p.mlb}`:p.customPlayerId||p.name;
          const person=result.franchise?.people[key];
          if(person){person.name=p.name;if(Number.isFinite(p.age))person.age=p.age;}
        }
        for (const phase of ['reg','post']) for (const kind of ['bat','pit']) {
          const players = owned.filter(p=>kind==='bat'?!p.role:!!p.role);
          for (const p of players) {
            const key = p.mlb ? `m${p.mlb}` : p.customPlayerId || p.name;
            const row = result.stats[phase][kind][key];
            if (row && row.team === index) row.name = p.name;
          }
        }
      });
      return result;
    }
    return { KEY, read, data, metadata, saveMetadata, savePlayer, resetPlayer, resetTeam, saveFictional, fictional, resetFictional, removeFictional, added, saveAdded, resetAdded, removeAdded, applyRoster, updateLeague, attributes: value => pick(value, PLAYER), resetAll: () => storage.removeItem(KEY) };
  }
  return { KEY, BAT, PIT, PLAYER, createStore };
});
