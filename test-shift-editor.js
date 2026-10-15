// Run: node test-shift-editor.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('./game-engine.js');
const html = fs.readFileSync(require('node:path').join(__dirname, 'game.html'), 'utf8');
const source = html.slice(html.indexOf('    let shiftKey ='), html.indexOf('    /* ------------------------------------------------------------ umpire challenges */'));
const storage = new Map(), alerts = [];
let failStorage = false;
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    innerHTML: '', value: '', classList: { toggle() {}, add() {} },
    listeners: {}, addEventListener(type, listener) { this.listeners[type] = listener; },
    querySelectorAll() { return []; }
  });
  return elements.get(id);
}
function context() {
  const game = E.createGame({
    away: E.generateTeam('Away', 'balanced', 1),
    home: E.generateTeam('Home', 'balanced', 2),
    park: 'dodgers', seed: 10, coach: ['manual', 'manual']
  });
  return vm.createContext({
    E, game, phase: 'ready', holdView: false, liveRun: null,
    $: element, window: { addEventListener() {} }, console: { error() {} },
    alert: (message) => alerts.push(message), sendScene() {}, refresh() {},
    esc: (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
    localStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => { if (failStorage) throw new Error('Storage full'); storage.set(key, value); }
    }
  });
}
let c = context();
const run = (script) => vm.runInContext(script, c);
run(source);
run('renderCoach()');
assert.match(element('coach-panel').innerHTML, /id="btn-substitution"/);
assert.match(element('coach-panel').innerHTML, /id="substitution-options" class="hidden"/);
for (const action of ['ph', 'pc', 'ds']) assert.match(element('coach-panel').innerHTML, new RegExp(`data-act="${action}"`));
run('game.bases[0]={p:game.teams[0].lineup[1]};coachKey="";renderCoach()');
assert.match(element('coach-panel').innerHTML, /data-act="pr"/, 'Pinch running is inside the same substitution menu');
run(`applyShift({preset:"custom",custom:{},mirror:false});renderShift();moveShiftMarker("CF",65,290);`);
assert.equal(run('shiftSpec().custom.CF.x'), 65);
assert.equal(run('shiftPoint("CF",shiftSpec()).y'), 290);
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65, 'Diagram positions drive the engine');
assert.equal((element('shift-custom').innerHTML.match(/data-fielder="/g) || []).length, 7);
assert(!element('shift-custom').innerHTML.includes('data-fielder="P"'));
assert(run(`persistShifts([{...shiftSpec(),id:"test",name:'Deep "pull"'}])`));
run('moveShiftMarker("CF",-40,310)');
assert.equal(run('savedShifts[0].custom.CF.x'), 65, 'Editing does not mutate saved positions');
c = context();
run(source);
assert.equal(run('savedShifts[0].name'), 'Deep "pull"', 'Names survive a reload');
run('applyShift({...savedShifts[0],preset:"custom"});selectedShift="test";renderShift()');
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65);
assert.match(element('shift-custom').innerHTML, /Deep &quot;pull&quot;/, 'Names safely render in attributes');
run('applyShift({...shiftSpec(),mirror:true})');
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"L"}).x'), -65);
assert.equal(run('E.shiftedSpot(game,"CF",1,{bats:"R"}).x'), 65);
assert(run(`persistShifts(savedShifts.map(s=>({...s,name:"Renamed"})))`));
assert.equal(JSON.parse(storage.values().next().value)[0].name, 'Renamed');
failStorage = true;
assert.equal(run('persistShifts([])'), false);
assert.equal(run('savedShifts.length'), 1, 'Failed write preserves the saved library');
assert(alerts.some((s) => /Could not save/.test(s)), 'Storage errors are surfaced');
failStorage = false;
assert(run('persistShifts([])'));
assert.equal(run('savedShifts.length'), 0);
console.log('Passed: grouped substitutions, seven-field diagram, actual engine positions, independent saved data, reload, mirroring, names, deletion and storage errors.');
