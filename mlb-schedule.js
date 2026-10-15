(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MLBSchedule = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  const CLUB_IDS = {
    BAL:110, BOS:111, NYY:147, TB:139, TOR:141, CWS:145, CLE:114, DET:116, KC:118, MIN:142,
    ATH:133, HOU:117, LAA:108, SEA:136, TEX:140, ATL:144, MIA:146, NYM:121, PHI:143, WSH:120,
    CHC:112, CIN:113, MIL:158, PIT:134, STL:138, AZ:109, COL:115, LAD:119, SD:135, SF:137
  };
  const DAY = 86400000;
  const dateMs = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid schedule date: ${value}`);
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== value) throw new Error(`Invalid schedule date: ${value}`);
    return ms;
  };
  function teamMap(teams) {
    const map = new Map();
    if (teams.length !== 30) throw new Error('An exact MLB schedule requires all 30 MLB teams, with no extra teams.');
    teams.forEach((team,index) => {
      const code = ({ OAK:'ATH', ARI:'AZ', WAS:'WSH' })[team.code] || team.code;
      const id = CLUB_IDS[code];
      if (!id || map.has(id)) throw new Error('An exact MLB schedule requires each of the 30 MLB clubs exactly once.');
      map.set(id,index);
    });
    return map;
  }
  function parse(payload, year, teams) {
    const map = teamMap(teams);
    if (!Array.isArray(payload.dates)) throw new Error('MLB returned an invalid schedule.');
    const games = new Map();
    for (const day of payload.dates) for (const game of day.games || []) {
      if (game.gameType !== 'R' || Number(game.season) !== Number(year)) continue;
      const state = game.status?.detailedState || '';
      if (/postponed|cancelled|canceled|suspended/i.test(state)) continue;
      const away = map.get(game.teams?.away?.team?.id), home = map.get(game.teams?.home?.team?.id);
      if (away === undefined || home === undefined || away === home) throw new Error('MLB schedule contains an unknown or invalid club.');
      if (!Number.isInteger(game.gamePk)) throw new Error('MLB schedule contains a game without an identifier.');
      const date = game.officialDate || day.date;
      dateMs(date);
      const entry = { id:game.gamePk, date, away, home, number:game.gameNumber || 1, start:game.gameDate || '', venue:game.venue?.name || null };
      const previous = games.get(entry.id);
      if (previous && (previous.date !== date || previous.away !== away || previous.home !== home)) throw new Error(`Conflicting dates for MLB game ${entry.id}.`);
      games.set(entry.id,entry);
    }
    const sorted = [...games.values()].sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.number - b.number || a.id - b.id);
    if (!sorted.length) throw new Error(`No playable regular-season games were found for ${year}.`);
    const startDate = sorted[0].date, endDate = sorted[sorted.length-1].date;
    const duration = Math.round((dateMs(endDate)-dateMs(startDate))/DAY)+1;
    if (duration > 370) throw new Error('MLB returned a schedule spanning more than one season.');
    const schedule = Array.from({length:duration},()=>[]);
    const gameInfo = Array.from({length:duration},()=>[]);
    const counts = new Array(30).fill(0);
    for (const game of sorted) {
      const day = Math.round((dateMs(game.date)-dateMs(startDate))/DAY);
      schedule[day].push([game.away,game.home]);
      gameInfo[day].push({ mlbId:game.id, number:game.number, venue:game.venue, start:game.start });
      counts[game.away]++; counts[game.home]++;
    }
    if (counts.some(n=>!n)) throw new Error('MLB returned an incomplete schedule: some clubs have no games.');
    const venues = new Map();
    for (const day of payload.dates) for (const game of day.games || []) {
      if (game.gameType === 'R' && game.venue?.id && map.has(game.teams?.home?.team?.id)) venues.set(game.venue.id, game.teams.home.team.id);
    }
    const allStarGames = [], allStarIds = new Set();
    for (const day of payload.dates) for (const game of day.games || []) {
      if (game.gameType !== 'A' || Number(game.season) !== Number(year) || /cancelled|canceled|postponed/i.test(game.status?.detailedState || '')) continue;
      if (allStarIds.has(game.gamePk)) continue;
      allStarIds.add(game.gamePk);
      const date = game.officialDate || day.date;
      const offset = Math.round((dateMs(date)-dateMs(startDate))/DAY);
      if (offset < 0 || offset >= schedule.length) continue;
      const host = venues.get(game.venue?.id);
      allStarGames.push({ date, day:offset, venue:game.venue?.name || 'All-Star host park', hostCode:Object.keys(CLUB_IDS).find(code => CLUB_IDS[code] === host) || null });
    }
    allStarGames.sort((a,b)=>a.day-b.day);
    return { year:Number(year), startDate, endDate, schedule, gameInfo, counts, totalGames:sorted.length, allStarGames, importedAt:new Date().toISOString() };
  }
  async function load(year, teams, fetcher) {
    teamMap(teams);
    if (!Number.isInteger(Number(year)) || Number(year) < 1901 || Number(year) > new Date().getFullYear()+1) throw new Error('Choose an MLB schedule year from 1901 through next year.');
    const request = fetcher || fetch;
    const response = await request(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=${Number(year)}&gameType=R,A`);
    if (!response.ok) throw new Error(`MLB schedule download failed (HTTP ${response.status}).`);
    return parse(await response.json(),year,teams);
  }
  function apply(league, imported) {
    teamMap(league.teams);
    if (league.phase !== 'regular' || league.day !== 0 || league.clock !== 0 || league.log.length || Object.keys(league.todayDone || {}).length || league.rec.some(r=>r.w || r.l)) throw new Error('Schedules can only be replaced before any games have been played or days advanced.');
    if (!imported?.schedule?.length) throw new Error('No imported schedule is available.');
    if(league.settings.franchise?.aging&&(league.franchise.year!==league.settings.franchise.startYear||imported.year!==league.franchise.year))throw new Error('Aging leagues use only the starting year MLB calendar. Future seasons must use generated schedules.');
    league.schedule = imported.schedule;
    league.scheduleImport = { ...imported };
    delete league.scheduleImport.schedule;
    league.settings.startDate = imported.startDate;
    league.settings.gamesPerTeam = Math.max(...imported.counts);
    league.settings.scheduleSource = 'mlb';
    league.settings.scheduleYear = imported.year;
    delete league.allStar;
    delete league.festivitiesCalendar;
    if(typeof window!=='undefined'&&window.AllStar)window.AllStar.scheduleBreak(league);
    else if(typeof module!=='undefined'&&module.exports)require('./all-star.js').scheduleBreak(league);
    return league;
  }
  return { CLUB_IDS, teamMap, parse, load, apply };
});
