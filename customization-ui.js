(() => {
  'use strict';
  const C = window.Customizations, E = window.GameEngine, L = window.LeagueEngine;
  const $ = id => document.getElementById(id);
  const latest = window.MLB_PLAYERS.year;
  const BAT = ['contact', 'power', 'eye', 'speed', 'arm', 'field', 'risk', 'loft'];
  const PIT = ['velo', 'control', 'movement', 'stamina'];
  let base = window.MLB_PLAYERS, selected = null, custom = null, rows = [];
  const aliases = { ATH:['OAK'], AZ:['ARI'], WSH:['WAS'] };
  function status(message, error) {
    $('status').textContent = message;
    $('status').classList.toggle('error', !!error);
  }
  async function action(fn) {
    try { await fn(); } catch (error) { status(`Not saved: ${error.message}`, true); }
  }
  const code = () => $('team').value;
  function description(value) {
    const club = L.CLUBS[value];
    return { name:value === 'CLE' && base.year <= 2021 ? 'Cleveland Indians' : club[0], abbr:value, color:club[1], park:club[2] };
  }
  function refreshTeams(keep) {
    const previous = code();
    const current = keep || code();
    $('team').replaceChildren(new Option('All players (including unassigned)', 'all'));
    for (const value of Object.keys(L.CLUBS)) {
      const meta = C.metadata(base.year, value, description(value));
      $('team').add(new Option(`${meta.name} (${value})`, value));
    }
    for (const team of C.fictional()) $('team').add(new Option(`${team.name} (fictional)`, team.customId));
    $('team').value = [...$('team').options].some(o => o.value === current) ? current : 'all';
    if (code() !== previous) $('search').value = '';
    render();
  }
  function render() {
    custom = C.read().fictional[code()]?.team || null;
    selected = null;
    $('player-form').hidden = true;
    $('player-heading').textContent = 'Select a player';
    $('team-card').hidden = code() === 'all';
    $('delete-team').hidden = !custom;
    const meta = custom || (code() !== 'all' ? C.metadata(base.year, code(), description(code())) : null);
    if (meta) for (const key of ['name', 'abbr', 'color', 'park']) $(`team-${key}`).value = meta[key] || (key === 'park' ? 'dodgers' : '');
    if (custom) rows = ['lineup', 'bench', 'pitchers'].flatMap(group => custom[group].map(p => ({ p, group, kind:group === 'pitchers' ? 'pitchers' : 'batters', id:p.customPlayerId })));
    else {
      const data = C.data(base);
      rows = ['batters', 'pitchers'].flatMap(kind => data[kind].filter(p => !p.customPlayerId && (code() === 'all' || [code(), ...(aliases[code()] || [])].includes(p.team))).map(p => ({ p, kind, id:`${kind}:${p.id}` })));
    }
    rows.push(...C.added(base.year).filter(entry => code() === 'all' || entry.team === code() || (aliases[code()] || []).includes(entry.team)).map(entry => ({ p:entry.player, kind:entry.kind, id:entry.id, added:true, team:entry.team })));
    renderPlayers();
  }
  function renderPlayers() {
    const query = $('search').value.trim().toLocaleLowerCase();
    const matches = rows.filter(({p}) => `${p.name} ${p.pos || p.role} ${p.team || ''}`.toLocaleLowerCase().includes(query));
    $('player-count').textContent = `${matches.length} players${matches.length > 120 ? ' (first 120 shown; narrow your search)' : ''}`;
    $('players').replaceChildren();
    for (const row of matches.slice(0, 120)) {
      const button = document.createElement('button');
      const overall = row.kind === 'pitchers' ? E.pitcherOverall(row.p) : E.batterOverall(row.p);
      button.textContent = `${row.p.name} / ${row.p.pos || row.p.role || row.group} / OVR ${Math.round(overall)}${row.added ? ` / Added${row.team ? "" : " (unassigned)"}` : ""}`;
      button.setAttribute('aria-pressed', String(selected?.id === row.id));
      button.addEventListener('click', () => edit(row));
      $('players').append(button);
    }
  }
  function edit(row) {
    selected = row;
    $('player-heading').textContent = row.p.name;
    $('player-form').hidden = false;
    $('player-fields').replaceChildren();
    const keys = ['name', 'bats', 'throws', 'age', 'height', 'weight', ...BAT, ...(row.kind === 'pitchers' ? PIT : [])];
    if (custom || row.added) keys.push(row.kind === 'pitchers' ? 'role' : 'pos');
    $('assignment-label').hidden = !row.added;
    $('delete-player').hidden = !row.added || row.isNew;
    $('reset-player').hidden = !!row.isNew;
    if (row.added) {
      const select = $('player-team');
      select.replaceChildren(new Option('Unassigned', ''));
      for (const value of Object.keys(L.CLUBS)) {
        const meta = C.metadata(base.year, value, description(value));
        select.add(new Option(`${meta.name} (MLB ${base.year})`, value));
      }
      for (const team of C.fictional()) select.add(new Option(`${team.name} (fictional)`, team.customId));
      select.value = row.team || '';
    }
    for (const key of keys) {
      const label = document.createElement('label');
      label.textContent = key.toUpperCase();
      let input;
      const options = key === 'bats' ? ['R','L','S'] : key === 'throws' ? ['R','L'] : key === 'role' ? ['SP','RP'] : key === 'pos' ? [...E.POSITIONS, 'DH'] : null;
      if (options) {
        input = document.createElement('select');
        options.forEach(value => input.add(new Option(value,value)));
      } else {
        input = document.createElement('input');
        input.type = key === 'name' ? 'text' : 'number';
        if (input.type === 'number') { input.min = ['height','weight'].includes(key) ? '0.01' : '0'; input.step = 'any'; }
        input.required = true;
      }
      input.name = key;
      input.value = key === 'age' ? E.playerAge(row.p)??27 : key === 'height' ? E.playerHeight(row.p) : key === 'weight' ? E.playerWeight(row.p) : row.p[key] ?? (key === 'field' && row.kind === 'pitchers' ? 40 : 50);
      label.append(input);
      $('player-fields').append(label);
    }
    renderPlayers();
  }
  function reselect(id) {
    render();
    const row = rows.find(r => r.id === id);
    if (row) edit(row);
  }
  $('player-form').addEventListener('submit', event => {
    event.preventDefault();
    action(() => {
      const row = selected, edited = { ...row.p };
      for (const input of $('player-fields').querySelectorAll('input,select')) edited[input.name] = input.type === 'number' ? Number(input.value) : input.value.trim();
      if (!edited.name) throw new Error('Player name is required.');
      edited.heightManual = true; edited.weightManual = true;
      if (row.added) {
        const id = C.saveAdded(base.year, row.kind, edited, $('player-team').value, row.isNew ? undefined : row.id);
        $('search').value = '';
        const target = $('player-team').value;
        refreshTeams(target || 'all');
        reselect(id);
        status('Added player saved and assigned. Load the team again in Exhibition or create a new league to select its best roster.');
        return;
      } else if (custom) {
        const index = custom[row.group].findIndex(p => p.customPlayerId === row.p.customPlayerId);
        if (row.group === 'lineup' && edited.pos !== row.p.pos) {
          const other = custom.lineup.find(p => p.pos === edited.pos);
          if (other) other.pos = row.p.pos;
        }
        custom[row.group][index] = edited;
        const errors = E.validateTeam(custom);
        if (errors.length) throw new Error(errors.join(' '));
        C.saveFictional(custom);
      } else C.savePlayer(base.year, row.kind, base[row.kind].find(p => p.id === row.p.id), edited);
      reselect(row.id);
      status('Player saved in this browser.');
    });
  });
  $('reset-player').addEventListener('click', () => action(async () => {
    if (!selected || !await window.BrowserDialog.confirm(`Reset ${selected.p.name} to the original player?`)) return;
    const id = selected.id;
    if (selected.added) C.resetAdded(selected.id);
    else if (custom) C.resetFictional(custom.customId, selected.p.customPlayerId);
    else C.resetPlayer(base.year, selected.kind, selected.p.id);
    reselect(id);
    status('Player reset.');
  }));
  function addPlayer(kind) {
    const player = { name:kind === 'pitchers' ? 'New Pitcher' : 'New Batter', bats:'R', throws:'R', height:72, weight:200, heightManual:true, weightManual:true, pos:'DH', role:'SP' };
    if (kind === 'pitchers') delete player.pos;
    else delete player.role;
    for (const key of [...BAT,...PIT]) player[key] = 50;
    edit({ p:player, kind, id:'new-player', added:true, isNew:true, team:code() === 'all' ? '' : code() });
  }
  $('add-batter').addEventListener('click', () => action(() => addPlayer('batters')));
  $('add-pitcher').addEventListener('click', () => action(() => addPlayer('pitchers')));
  $('delete-player').addEventListener('click', () => action(async () => {
    if (!selected?.added || !await window.BrowserDialog.confirm(`Delete added player ${selected.p.name}? Existing leagues keep their snapshots.`)) return;
    C.removeAdded(selected.id);
    render();
    status('Added player deleted.');
  }));
  $('team-form').addEventListener('submit', event => {
    event.preventDefault();
    action(() => {
      const meta = Object.fromEntries(['name','abbr','color','park'].map(key => [key,$(`team-${key}`).value.trim()]));
      if (!meta.name || !meta.abbr) throw new Error('Team name and abbreviation are required.');
      meta.abbr = meta.abbr.toUpperCase();
      if (custom) C.saveFictional({ ...custom, ...meta });
      else C.saveMetadata(base.year, code(), meta);
      refreshTeams();
      status('Team saved in this browser.');
    });
  });
  $('reset-team').addEventListener('click', () => action(async () => {
    if (!await window.BrowserDialog.confirm('Reset this team and all of its players to their original defaults?')) return;
    if (custom) C.resetFictional(custom.customId);
    else C.resetTeam(base, code());
    refreshTeams();
    status('Team and players reset.');
  }));
  $('reset-all').addEventListener('click', () => action(async () => {
    if (!await window.BrowserDialog.confirm('Remove ALL player/team overrides and saved fictional teams? Existing leagues and their results will not be changed.')) return;
    C.resetAll();
    refreshTeams('all');
    status('All customizations reset. Existing leagues are unchanged.');
  }));
  $('delete-team').addEventListener('click', () => action(async () => {
    if (!custom || !await window.BrowserDialog.confirm(`Delete ${custom.name} from saved fictional teams? Existing leagues will keep their copies.`)) return;
    C.removeFictional(custom.customId);
    refreshTeams('all');
    status('Fictional team deleted.');
  }));
  function saveNewTeam(team) {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    team = JSON.parse(JSON.stringify(team));
    delete team.src;
    team.customId = id;
    team.abbr ||= team.name.slice(0,3).toUpperCase();
    team.color ||= '#176442';
    team.park ||= 'dodgers';
    for (const group of ['lineup','bench','pitchers']) team[group].forEach((p,i) => { p.customPlayerId = `${id}:${group}:${i}`; });
    const errors = E.validateTeam(team);
    if (errors.length) throw new Error(errors.join(' '));
    C.saveFictional(team, team);
    return id;
  }
  $('new-team').addEventListener('click', () => action(async () => {
    const name = await window.BrowserDialog.ask('Name for your fictional team:', 'My Team');
    if (!name?.trim()) return;
    const id = saveNewTeam(E.generateTeam(name.trim(), 'balanced', Date.now()));
    refreshTeams(id);
    status('Fictional team created and saved. Edit its players below.');
  }));
  $('import-teams').addEventListener('click', () => action(async () => {
    const teams = JSON.parse(localStorage.getItem('field-notes-game-teams-v1'));
    if (!Array.isArray(teams) || !teams.length) throw new Error('Open Exhibition and configure teams first.');
    if (!await window.BrowserDialog.confirm('Save copies of both Exhibition teams in Customization?')) return;
    let id;
    for (const team of teams) id = saveNewTeam(team);
    refreshTeams(id);
    status('Exhibition teams copied into permanent customization.');
  }));
  $('search').addEventListener('input', renderPlayers);
  $('team').addEventListener('change', () => action(() => { $('search').value = ''; render(); }));
  for (let year = latest; year >= 2015; year--) $('season').add(new Option(year, year));
  for (const park of E.PARK_LIST) $('team-park').add(new Option(park.name, park.id));
  $('season').addEventListener('change', () => {
    const year = Number($('season').value);
    const finish = () => {
      base = year === latest ? window.MLB_PLAYERS : window.MLB_SEASONS[year];
      $('season').disabled = false;
      action(() => refreshTeams());
    };
    if (year === latest || window.MLB_SEASONS?.[year]) return finish();
    $('season').disabled = true;
    const script = document.createElement('script');
    script.src = `seasons/players-${year}.js`;
    script.onload = finish;
    script.onerror = () => {
      script.remove(); $('season').disabled = false; $('season').value = base.year;
      status(`Couldn't load ${year} player data. Your edits have not changed.`, true);
    };
    document.head.append(script);
  });
  action(() => refreshTeams('all'));
})();
