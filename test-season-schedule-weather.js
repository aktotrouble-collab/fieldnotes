// Run: node test-season-schedule-weather.js [--live]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('./mlb-schedule.js');
const L = require('./league-engine.js');
const E = require('./game-engine.js');
const teams = L.mlbDescriptors(Object.keys(M.CLUB_IDS));
const ids = Object.values(M.CLUB_IDS);
function game(id,away,home,date,extra={}) {
  return {gamePk:id,gameType:'R',season:'2025',officialDate:date,gameDate:`${date}T18:00:00Z`,teams:{away:{team:{id:away}},home:{team:{id:home}}},status:{detailedState:'Final'},...extra};
}
const opening = Array.from({length:15},(_,i)=>game(i+1,ids[i*2],ids[i*2+1],'2025-03-18'));
const payload = {dates:[
  {date:'2025-03-18',games:opening},
  {date:'2025-03-19',games:[
    game(999,ids[0],ids[1],'2025-03-19',{status:{detailedState:'Postponed'}}),
    game(998,ids[2],ids[3],'2025-03-19',{status:{detailedState:'Cancelled'}}),
    game(997,ids[2],ids[3],'2025-03-19',{gameType:'S'})
  ]},
  {date:'2025-03-21',games:[
    game(999,ids[0],ids[1],'2025-03-21',{gameNumber:1}),
    game(1000,ids[0],ids[1],'2025-03-21',{gameNumber:2,gameDate:'2025-03-21T23:00:00Z'})
  ]}
]};
const imported = M.parse(payload,2025,teams);
assert.equal(imported.totalGames,17);
assert.equal(imported.schedule.length,4);
assert.deepEqual(imported.schedule[1],[],'Calendar-wide off-days are retained');
assert.deepEqual(imported.schedule[2],[]);
assert.deepEqual(imported.schedule[3],[[0,1],[0,1]],'Doubleheader games both survive');
const festivalPayload=JSON.parse(JSON.stringify(payload));
festivalPayload.dates[0].games[0].venue={id:50,name:'Host park'};
const allStar=game(777,159,160,'2025-03-20',{gameType:'A',venue:{id:50,name:'Host park'}});
festivalPayload.dates.push({date:'2025-03-20',games:[allStar,allStar,{...allStar,gamePk:778,status:{detailedState:'Cancelled'}}]});
const festivalImport=M.parse(festivalPayload,2025,teams);
assert.equal(festivalImport.totalGames,imported.totalGames,'All-Star games are not regular-season contests');
assert.equal(festivalImport.allStarGames.length,1,'Canceled All-Star events and duplicate API entries are ignored');
assert.equal(festivalImport.allStarGames[0].hostCode,Object.keys(M.CLUB_IDS)[1]);
assert.equal(festivalImport.allStarGames[0].day,2);
assert.deepEqual(imported.allStarGames,[],'Seasons without an actual All-Star event get no festivities');
assert.equal(imported.gameInfo[3][1].number,2);
assert.throws(()=>M.parse(payload,2025,teams.slice(1)),/30/);
assert.throws(()=>M.parse(payload,2025,[teams[1],...teams.slice(1)]),/exactly once/);
assert.throws(()=>M.parse({dates:[]},2025,teams),/No playable/);
assert.throws(()=>M.parse({dates:[{games:[game(1,999,ids[1],'2025-03-18')]}]},2025,teams),/unknown/);
const league = L.createLeague({source:'generated',seed:12,settings:{gamesPerTeam:2,playoffs:{enabled:false}},teams,schedule:imported.schedule});
M.apply(league,imported);
assert.equal(L.dateOf(league,0),'2025-03-18');
assert.equal(L.dateOf(league,3),'2025-03-21');
assert.equal(league.settings.gamesPerTeam,3,'Imported season counts, not forced to 162');
const ref = L.pendingGames(league)[0];
assert.equal(ref.mlbId,1);
assert.equal(L.gameConfig(league,ref).weather.date,'2025-03-18');
league.day = 3; league.clock = 3;
const doubleheader = L.pendingGames(league);
assert.equal(doubleheader.length,2);
assert.notEqual(doubleheader[0].id,doubleheader[1].id);
const empty = {score:[1,0],hits:[0,0],errors:[0,0],inn:9,sides:[{bat:[],pit:[]},{bat:[],pit:[]}]};
L.recordRef(league,doubleheader[0],empty);
assert.equal(L.pendingGames(league).length,1,'Playing first game does not mark second game done');
assert.equal(L.closeDayIfDone(league),false);
assert.throws(()=>M.apply(league,imported),/before any/,'Cannot overwrite an active league');
L.recordRef(league,doubleheader[1],empty);
assert.equal(L.closeDayIfDone(league),true);
assert.equal(league.phase,'done');
const park = E.parkById('cubs');
const spring = E.seasonalClimate(park,'2025-04-01');
const summer = E.seasonalClimate(park,'2025-07-01');
assert(summer.temp-spring.temp>15,'Summer park-weighted temperature is measurably warmer than spring');
assert(spring.mph>summer.mph,'Seasonal wind strength changes too');
assert(E.seasonalClimate(E.parkById('dodgers'),'2025-01-01').temp>E.seasonalClimate(park,'2025-01-01').temp,'Coastal and continental park seasonality differs');
const weather = date=>E.makeEnv(park,{mode:'park',tempMode:'park',date},E.makeRng(42));
const a=weather('2025-04-01'),b=weather('2025-07-01');
assert(b.temp-a.temp>15);
assert.deepEqual(weather('2025-04-01'),a,'Same date/settings/seed is deterministic');
assert.throws(()=>weather('2025-02-30'),/valid game date/);
assert.equal(E.makeEnv(park,{mode:'calm',tempMode:'fixed',temp:64,date:'2025-07-01'},E.makeRng(42)).temp,64,'Explicit weather choices remain intact');
const indoor = E.makeEnv(E.parkById('astros'),{mode:'park',tempMode:'park',date:'2025-01-01'},E.makeRng(1));
assert.equal(indoor.temp,72);
assert.deepEqual(E.windNow({env:indoor}),{x:0,y:0},'Closed roofs suppress wind');
for(const file of ['game.html','league.html']) {
  const html=fs.readFileSync(path.join(__dirname,file),'utf8');
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1],{filename:file});
}
async function main() {
  await assert.rejects(M.load(2025,teams,async()=>({ok:false,status:503})),/503/);
  if(process.argv.includes('--live')) {
    const actual = await M.load(2025,teams);
    assert.equal(actual.totalGames,2430,'Full 2025 MLB regular season has 2430 played games');
    assert(actual.schedule.some(day=>day.length===0),'All-star and travel gaps are preserved');
    assert(actual.schedule.some(day=>new Set(day.flat()).size<day.length*2),'Actual doubleheaders preserved');
    assert.equal(actual.startDate,'2025-03-18','Tokyo opening date preserved');
    assert.equal(actual.allStarGames.length,1);
    assert.equal(actual.allStarGames[0].date,'2025-07-15');
    assert.equal(actual.allStarGames[0].hostCode,'ATL');
    console.log(`Live MLB API verified: ${actual.totalGames} games, ${actual.startDate} through ${actual.endDate}, ${actual.schedule.length} calendar days.`);
  }
  console.log('Passed: exact club validation, real-calendar import, postponements, doubleheaders, active-league guard, dated weather, seasonal thresholds, deterministic seeds and roof/manual overrides.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
