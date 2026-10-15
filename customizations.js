(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Customizations = factory().createStore(root.localStorage, root.GameEngine);
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const KEY = 'field-notes-customizations-v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const BAT = ['contact', 'power', 'eye', 'speed', 'arm', 'field', 'risk', 'loft'];
  const PIT = ['velo', 'control', 'movement', 'stamina'];
  const PLAYER = ['name', 'bats', 'throws', 'height', 'weight', 'heightManual', 'weightManual', ...BAT, ...PIT];
  const META = ['name', 'abbr', 'color', 'park'];
  const pick = (value, keys) => Object.fromEntries(keys.filter(k => value[k] !== undefined).map(k => [k, value[k]]));
  const playerKey = (year, kind, id) => `${year}:${kind}:${id}`;
  const teamKey = (year, code) => `${year}:${({ OAK:'ATH', ARI:'AZ', WAS:'WSH' })[code] || code}`;
  const empty = () => ({ version: 1, players: {}, teams: {}, fictional: {} });
  function createStore(storage, engine) {
    function read() {
      const raw = storage.getItem(KEY);
      if (!raw) return empty();
      const state = JSON.parse(raw);
      if (state.version !== 1 || !state.players || !state.teams || !state.fictional) throw new Error('Invalid saved customization data. Export browser data before resetting customizations.');
      return state;
    }
    function write(state) {
      storage.setItem(KEY, JSON.stringify(state));
    }
    function savePlayer(year, kind, original, edited) {
      const state = read(), patch = {};
      for (const key of PLAYER) {
        if (edited[key] === undefined || edited[key] === original[key]) continue;
        if ([...BAT, ...PIT, 'height', 'weight'].includes(key) && (!Number.isFinite(edited[key]) || edited[key] < 0 || (['height', 'weight'].includes(key) && edited[key] === 0))) throw new Error(`Invalid ${key}.`);
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
      const list = kind => base[kind].map(p => ({ ...p, ...state.players[playerKey(base.year, kind, p.id)], customYear: base.year }));
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
      write(state);
    }
    function saveFictional(team, original) {
      const state = read();
      if (!team.customId) throw new Error('Custom team has no identity.');
      state.fictional[team.customId] = { original: clone(state.fictional[team.customId]?.original || original || team), team: clone(team) };
      write(state);
    }
    function fictional() { return Object.values(read().fictional).map(entry => clone(entry.team)); }
    function resetFictional(id, playerId) {
      const state = read(), entry = state.fictional[id];
      if (!entry) throw new Error('Custom team no longer exists.');
      if (!playerId) entry.team = clone(entry.original);
      else for (const group of ['lineup', 'bench', 'pitchers']) {
        const index = entry.team[group].findIndex(p => p.customPlayerId === playerId);
        const original = entry.original[group].find(p => p.customPlayerId === playerId);
        if (index >= 0 && original) entry.team[group][index] = clone(original);
      }
      write(state);
    }
    function removeFictional(id) {
      const state = read();
      delete state.fictional[id];
      write(state);
    }
    function applyRoster(team, bases, fallbackYear, refresh) {
      const state = read();
      const result = clone(team);
      const custom = state.fictional[team.customId];
      if (custom) Object.assign(result, pick(custom.team, META));
      else if (team.src) Object.assign(result, state.teams[teamKey(team.src.year, team.src.club)]);
      for (const group of ['lineup', 'bench', 'pitchers', 'rotation', 'bullpen']) {
        if (!result[group]) continue;
        const kind = ['pitchers', 'rotation', 'bullpen'].includes(group) ? 'pitchers' : 'batters';
        for (const p of result[group]) {
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
      const result = clone(league);
      result.teams.forEach((team, index) => {
        const code = team.code || team.src?.club;
        const year = team.src?.year || league.year;
        const canonical = ({ OAK:'ATH', ARI:'AZ', WAS:'WSH' })[code] || code;
        if (code && clubs[canonical]) Object.assign(team, metadata(year, code, clubs[canonical]));
        const source = { ...team.roster, customId:team.customId, src:team.code ? { year:league.year, club:team.code } : team.src };
        const updated = applyRoster(source, bases, league.year, true);
        Object.assign(team, pick(updated, META));
        for (const group of ['lineup','bench','rotation','bullpen']) team.roster[group] = updated[group];
        for (const phase of ['reg','post']) for (const kind of ['bat','pit']) {
          const players = kind === 'bat' ? [...team.roster.lineup, ...team.roster.bench] : [...team.roster.rotation, ...team.roster.bullpen];
          for (const p of players) {
            const key = p.mlb ? `m${p.mlb}` : p.customPlayerId || p.name;
            const row = result.stats[phase][kind][key];
            if (row && row.team === index) row.name = p.name;
          }
        }
      });
      return result;
    }
    return { KEY, read, data, metadata, saveMetadata, savePlayer, resetPlayer, resetTeam, saveFictional, fictional, resetFictional, removeFictional, applyRoster, updateLeague, attributes: value => pick(value, PLAYER), resetAll: () => storage.removeItem(KEY) };
  }
  return { KEY, BAT, PIT, PLAYER, createStore };
});
