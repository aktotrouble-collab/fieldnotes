/* Build a retrospective, notable-prospect layer from historical MLB affiliate rosters.
   Run: node build-minor-league-prospects.js [year ...]
   Only players on that year's affiliate rosters who later debuted in MLB are candidates.
   Future MLB career totals are used solely to identify a notable prospect and estimate hidden potential. */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const file=path.join(__dirname,'minor-league-prospects.js');
const aliases={OAK:'ATH',ARI:'AZ',WAS:'WSH',CHW:'CWS',TBR:'TB',SDP:'SD',SFG:'SF',KCR:'KC',NYA:'NYY',NYN:'NYM',ANA:'LAA',FLO:'MIA',MON:'WSH'};
const levels={11:6,12:5,13:4,14:3,15:2,16:1,17:0};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const seasonFiles=['players-data.js',...fs.readdirSync(path.join(__dirname,'seasons')).filter(n=>/^players-\d+\.js$/.test(n)).map(n=>path.join('seasons',n))];
function loadDataset(filename) {
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,filename),'utf8'),context);
  return context.window.MLB_PLAYERS||Object.values(context.window.MLB_SEASONS)[0];
}
const datasets=seasonFiles.map(file=>({file,data:loadDataset(file)}));
const datasetYears=[...new Set(datasets.map(x=>x.data.year))].sort((a,b)=>a-b);
const careerSummary=stats=>{
  const map={hitting:null,pitching:null,peakHitting:null,peakPitching:null};
  for(const entry of stats||[]) {
    const group=entry.group?.displayName?.toLowerCase();
    if(group!=='hitting'&&group!=='pitching')continue;
    for(const split of entry.splits||[]) {
      if(split.sport?.abbreviation!=='MLB')continue;
      const row=split.stat;
      if(entry.type?.displayName==='career')map[group]=row;
      if(entry.type?.displayName==='yearByYear') {
        const volume=group==='hitting'?num(row.plateAppearances):num(row.outs);
        const minimum=group==='hitting'?200:120;
        if(volume<minimum)continue;
        const score=group==='hitting'?Number(row.ops)||0:(Number(row.era)||10)*-1+num(row.strikeOuts)*0.001;
        const previous=map[group==='hitting'?'peakHitting':'peakPitching'];
        if(!previous||score>previous.score)map[group==='hitting'?'peakHitting':'peakPitching']={stat:row,score};
      }
    }
  }
  map.peakHitting=map.peakHitting?.stat||map.hitting||{};
  map.peakPitching=map.peakPitching?.stat||map.pitching||{};
  map.hitting||={};map.pitching||={};
  return map;
};
const eligibility=career=>{
  const bat=career.hitting||{},pit=career.pitching||{};
  const batPA=num(bat.plateAppearances),batH=num(bat.hits),batHR=num(bat.homeRuns),batSB=num(bat.stolenBases);
  const pitIP=num(pit.outs)/3,pitG=num(pit.gamesPlayed),pitK=num(pit.strikeOuts),pitSV=num(pit.saves);
  return {
    bat:batPA>=1000||batH>=600||batHR>=100||batSB>=100,
    pit:pitIP>=300||pitG>=150||pitK>=300||pitSV>=50
  };
};
const battingPotential=stats=>{
  const pa=Math.max(1,num(stats.plateAppearances)),ab=Math.max(1,num(stats.atBats));
  const avg=Number(stats.avg)||0.245,obp=Number(stats.obp)||avg+0.075,slg=Number(stats.slg)||0.36;
  const so=num(stats.strikeOuts)/pa,bb=num(stats.baseOnBalls)/pa,hr=num(stats.homeRuns)/pa;
  const contact=clamp(Math.round(50+(avg-0.245)*210+(0.18-so)*68),30,112);
  const power=clamp(Math.round(50+(slg-0.4)*115+(hr-0.025)*330),28,118);
  const eye=clamp(Math.round(50+(bb-0.075)*250+((obp-avg)-0.075)*150),28,112);
  const speed=clamp(Math.round(46+(num(stats.stolenBases)/pa)*350-(num(stats.caughtStealing)/pa)*120),25,105);
  return {contact,power,eye,speed,arm:55,field:55};
};
const pitchingPotential=stats=>{
  const outs=Math.max(1,num(stats.outs)),ip=outs/3,g=Math.max(1,num(stats.gamesPlayed));
  const k9=num(stats.strikeOuts)*27/outs,bb9=num(stats.baseOnBalls)*27/outs;
  const era=Number(stats.era)||4.2,starts=num(stats.gamesStarted);
  return {velo:clamp(Math.round(55+(k9-7)*3.1),35,105),
    control:clamp(Math.round(55+(3.2-bb9)*6.5+(4.1-era)*1.8),28,110),
    movement:clamp(Math.round(52+(k9-7)*4+(3.8-era)*3),28,112),
    stamina:clamp(Math.round(40+Math.min(10,ip/g)*3+(starts/g>0.45?9:0)),30,92)};
};
function prospect(person,year,team,affiliate,career,notability) {
  const bat=career.peakHitting||career.hitting||{},pit=career.peakPitching||career.pitching||{};
  const isPitcher=!!notability.pit&&(!notability.bat||num(pit.outs)>num(bat.plateAppearances)*0.65);
  const projected=isPitcher?pitchingPotential(pit):battingPotential(bat);
  const age=year-Number(person.birthDate.slice(0,4))-(person.birthDate.slice(5)> '07-01'?1:0);
  const developmentGap=age<=19?20:age<=21?16:age<=23?12:age<=25?8:5;
  const current=Object.fromEntries(Object.entries(projected).map(([key,value])=>[key,Math.max(20,value-developmentGap)]));
  const position=person.primaryPosition?.abbreviation||'DH';
  const player={id:person.id,mlb:person.id,name:person.fullName,team,customYear:year,age,
    birthDate:person.birthDate,ageSource:'MLB birth date',pos:isPitcher?'P':position,
    natural:isPitcher?'P':position,alt:[],bats:person.batSide?.code||'R',throws:person.pitchHand?.code||'R',
    ...current,prospect:true,prospectSourceYear:year,prospectAffiliate:affiliate.name,
    prospectLevel:affiliate.sport.id,prospectPotential:projected,prospectDebut:person.mlbDebutDate};
  if(isPitcher)Object.assign(player,{role:num(pit.gamesStarted)/Math.max(1,num(pit.gamesPlayed))>0.45?'SP':'RP',...current});
  if(!isPitcher)Object.assign(player,{loft:Math.max(0,Math.min(30,Math.round(((Number(bat.slg)||0.4)-0.25)*30))),...current});
  player.prospectCareer={
    pa:num(career.hitting?.plateAppearances),hits:num(career.hitting?.hits),homeRuns:num(career.hitting?.homeRuns),stolenBases:num(career.hitting?.stolenBases),
    innings:Math.round(num(career.pitching?.outs)/3),games:num(career.pitching?.gamesPlayed),strikeouts:num(career.pitching?.strikeOuts),wins:num(career.pitching?.wins),saves:num(career.pitching?.saves)
  };
  player.prospectNotability=notability.bat&&notability.pit?'Two-way MLB career':notability.pit?'Established MLB pitcher':'Established MLB hitter';
  return player;
}
async function json(url) {
  let last;
  for(let attempt=0;attempt<5;attempt++) {
    try {
      const response=await fetch(url);
      if(response.status===429||response.status>=500)throw new Error(`HTTP ${response.status}`);
      if(!response.ok)throw new Error(`HTTP ${response.status} ${url}`);
      return await response.json();
    } catch(error) {
      last=error;
      if(attempt===4)break;
      await new Promise(resolve=>setTimeout(resolve,500*2**attempt));
    }
  }
  throw last;
}
async function parallel(items,limit,fn) {
  const out=new Array(items.length);let cursor=0,errors=[];
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{
    while(true) {
      const at=cursor++;if(at>=items.length)return;
      try{out[at]=await fn(items[at],at);}
      catch(error){errors.push(error);}
    }
  }));
  if(errors.length)throw new Error(`${errors.length} MLB Stats API request(s) failed. First: ${errors[0].message}`);
  return out;
}
async function build(year) {
  const dataset=datasets.find(x=>x.data.year===year)?.data;
  if(!dataset)throw new Error(`No bundled MLB player dataset for ${year}; build and distribute that year's players-data.js first.`);
  const mlbTeams=await json(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${year}`);
  const teamIds=new Map(mlbTeams.teams.map(team=>[team.id,aliases[team.abbreviation]||team.abbreviation]));
  const affiliates=await json(`https://statsapi.mlb.com/api/v1/teams?sportIds=11,12,13,14,15,16,17&season=${year}`);
  const clubs=affiliates.teams.filter(team=>team.parentOrgId&&teamIds.has(team.parentOrgId)&&levels[team.sport?.id]!==undefined);
  console.log(`${year}: downloading ${clubs.length} historical affiliate rosters.`);
  const rosterData=await parallel(clubs,14,team=>json(`https://statsapi.mlb.com/api/v1/teams/${team.id}/roster?rosterType=fullRoster&season=${year}`));
  const candidates=new Map();
  rosterData.forEach((response,index)=>{
    const affiliate=clubs[index],org=teamIds.get(affiliate.parentOrgId);
    for(const row of response.roster||[]) {
      const id=row.person?.id;if(!id)continue;
      const previous=candidates.get(id),level=levels[affiliate.sport.id];
      if(!previous||level>previous.level)candidates.set(id,{id,org,affiliate:{id:affiliate.id,name:affiliate.name,sport:{id:affiliate.sport.id,name:affiliate.sport.name}},level});
    }
  });
  const ids=[...candidates.keys()];
  console.log(`${year}: resolving MLB debuts and career lines for ${ids.length} minor leaguers.`);
  const people=await parallel(Array.from({length:Math.ceil(ids.length/100)},(_,i)=>ids.slice(i*100,(i+1)*100)),10,chunk=>
    json(`https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(',')}&hydrate=stats(group=[hitting,pitching],type=[career,yearByYear])`));
  const majorIds=new Set([...dataset.batters,...dataset.pitchers].map(p=>p.id));
  const rosters=Object.fromEntries([...new Set(teamIds.values())].map(code=>[code,[]]));
  const totals={rostered:ids.length,debuts:0,notable:0,teams:{}};
  for(const batch of people)for(const person of batch.people||[]) {
    if(!person.birthDate||!person.mlbDebutDate||person.mlbDebutDate.slice(0,4)<String(year))continue;
    if(person.mlbDebutDate.slice(0,4)===String(year)&&person.mlbDebutDate<`${year}-04-01`)continue;
    totals.debuts++;
    const entry=candidates.get(person.id),career=careerSummary(person.stats),notability=eligibility(career);
    if(!notability.bat&&!notability.pit)continue;
    if(majorIds.has(person.id))continue;
    rosters[entry.org].push(prospect(person,year,entry.org,entry.affiliate,career,notability));
  }
  for(const [team,players]of Object.entries(rosters)) {
    players.sort((a,b)=>Math.max(...Object.values(b.prospectPotential))-Math.max(...Object.values(a.prospectPotential))||a.name.localeCompare(b.name));
    if(players.length)totals.teams[team]=players.length;
    totals.notable+=players.length;
  }
  return {teams:rosters,summary:totals};
}
async function main() {
  const years=process.argv.slice(2).map(Number);
  const selected=years.length?years:datasetYears.filter(year=>year<Math.max(...datasetYears));
  if(!selected.length)throw new Error('No historical datasets to build. Pass one or more bundled season years.');
  const all=fs.existsSync(file)?{...require(file)}:{};
  for(const year of selected) {
    if(!Number.isInteger(year))throw new Error(`Invalid year: ${year}`);
    const result=await build(year);
    all[year]=result.teams;
    console.log(JSON.stringify({year,...result.summary}));
  }
  fs.writeFileSync(file,`/* Retrospective notable MLB prospects mapped to their actual seasonal minor-league affiliates. Generated by build-minor-league-prospects.js. Hidden potential uses later MLB career rates; only the chosen season's minor-league affiliation is imported. */\n(function(root){const data=${JSON.stringify(all)};if(typeof module!=="undefined"&&module.exports)module.exports=data;else root.MinorLeagueProspects=data;})(typeof window!=="undefined"?window:globalThis);\n`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
