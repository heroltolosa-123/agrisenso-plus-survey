const fs=require('fs'),vm=require('vm'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const OUT=process.env.OUT_DIR||path.resolve(__dirname,'out');
fs.mkdirSync(OUT,{recursive:true});
const sheets={};
function mk(name){const rows=[];return{name,rows,
  getLastRow:()=>rows.length,getLastColumn:()=>rows.length?Math.max(...rows.map(r=>r.length)):0,
  getRange:(r,c,nr,nc)=>({getValues:()=>{const o=[];for(let i=0;i<nr;i++){const w=rows[r-1+i]||[];o.push(w.slice(c-1,c-1+nc));}return o;},
   setValues:(v)=>{v.forEach((row,i)=>{const ri=r-1+i;while(rows.length<=ri)rows.push([]);row.forEach((cl,j)=>{rows[ri][c-1+j]=cl;});});}}),
  appendRow:(row)=>rows.push(row.slice()),setFrozenRows:()=>{}};}
let u=0;
const ctx={console,
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=mk(n))})},
 LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
 Utilities:{getUuid:()=>{u++;return 'sim-'+String(u).padStart(4,'0')+'-0000-0000-000000000000';}},
 ContentService:{createTextOutput:s=>({setMimeType:()=>s}),MimeType:{JSON:'json'}},
 HtmlService:{createTemplateFromFile:()=>({evaluate:()=>({setTitle:()=>({addMetaTag:()=>({setXFrameOptionsMode:()=>({})})})})}),createHtmlOutputFromFile:()=>({getContent:()=>''}),XFrameOptionsMode:{ALLOWALL:1}}};
vm.createContext(ctx);
for(const f of ['Schema_A.gs','Schema_B.gs','Code.gs'])
  vm.runInContext(fs.readFileSync(path.join(ROOT,'src',f),'utf8'),ctx);
const R=JSON.parse(fs.readFileSync(__dirname+'/responses.json','utf8'));
// Disposition cases go in after the completed ones, so the export mirrors
// a real field day: completed interviews plus the refusals, ineligibles
// and callbacks that also have to be counted.
let TERM={A:[],B:[]};
try{ TERM=JSON.parse(fs.readFileSync(__dirname+'/terminated.json','utf8')); }catch(e){}
const esc=v=>{v=(v===undefined||v===null)?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
const TAB={A:'Instrument_A_Borrowers',B:'Instrument_B_NonBorrowers'};
for(const key of ['A','B']){
  R[key].concat(TERM[key]||[]).forEach(r=>{ctx.__v=r.values;
    const res=vm.runInContext('submitResponse("'+key+'", __v)',ctx);
    if(!res.ok) throw new Error('submit failed');});
  const sh=sheets[TAB[key]];
  fs.writeFileSync(path.join(OUT,TAB[key]+'.csv'), sh.rows.map(r=>r.map(esc).join(',')).join('\n'));
  // data dictionary, as Code.gs builds it
  const cols=vm.runInContext('flatColumns_(getSchema("'+key+'"))',ctx);
  fs.writeFileSync(path.join(OUT,TAB[key]+'_Dictionary.csv'),
    ['field_id,question_text'].concat(cols.map(c=>esc(c[0])+','+esc(c[1]))).join('\n'));
  console.log(TAB[key]+': '+(sh.rows.length-2)+' responses, '+sh.rows[0].length+' columns');
}
