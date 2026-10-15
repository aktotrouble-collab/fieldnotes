/* Selected-year annual salary facts from the public Lahman dataset.
   Run: node build-starting-salaries.js. No future salary is used to fill missing years. */
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const base='https://raw.githubusercontent.com/vincentarelbundock/Rdatasets/master/csv/Lahman/';
async function csv(name) {
  const response=await fetch(base+name+'.csv');
  if(!response.ok)throw new Error(`Lahman ${name}: HTTP ${response.status}`);
  const lines=(await response.text()).trim().split(/\r?\n/);
  const cells=line=>line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(v=>v.replace(/^"|"$/g,'').replace(/""/g,'"'));
  const headers=cells(lines.shift());
  return lines.map(line=>Object.fromEntries(cells(line).map((value,i)=>[headers[i],value])));
}
const plain=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
async function main() {
  const [people,salaries]=await Promise.all([csv('People'),csv('Salaries')]);
  const files=['players-data.js',...fs.readdirSync(path.join(__dirname,'seasons')).filter(f=>/^players-\d+\.js$/.test(f)).map(f=>path.join('seasons',f))];
  const result={};
  let count=0;
  for(const file of files) {
    const context={window:{}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
    const data=context.window.MLB_PLAYERS||Object.values(context.window.MLB_SEASONS)[0];
    const yearRows=salaries.filter(r=>Number(r.yearID)===data.year);
    if(!yearRows.length)continue;
    result[data.year]={};
    for(const p of [...data.batters,...data.pitchers]) {
      if(result[data.year][p.id])continue;
      const surname=plain(p.name.replace(/\s+(Jr\.?|Sr\.?|II|III|IV)$/i,'').split(' ').pop());
      const candidates=people.filter(person=>person.birthDate===p.birthDate&&plain(person.nameLast)===surname);
      if(candidates.length!==1)continue;
      const amounts=yearRows.filter(r=>r.playerID===candidates[0].playerID).map(r=>Number(r.salary)).filter(n=>Number.isFinite(n)&&n>0);
      if(amounts.length){result[data.year][p.id]=Math.max(...amounts);count++;}
    }
  }
  fs.writeFileSync(path.join(__dirname,'starting-salaries.js'),`/* Lahman annual salary facts, selected-year only. Annual salary is not a multi-year guarantee. Source: ${base}Salaries.csv */\n(function(root){const data=${JSON.stringify(result)};if(typeof module!=="undefined"&&module.exports)module.exports=data;else root.StartingSalaries=data;})(typeof window!=="undefined"?window:globalThis);\n`);
  console.log(`Imported ${count} annual salary facts for ${Object.keys(result).join(', ')}. Missing years remain generated, not backfilled.`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
