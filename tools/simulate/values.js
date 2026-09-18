// Realistic value pools + a seeded RNG so the dataset is reproducible.
let seed = 20260918;
function rnd(){ seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
function pick(a){ return a[Math.floor(rnd()*a.length)]; }
function int(lo,hi){ return Math.floor(lo+rnd()*(hi-lo+1)); }
function money(lo,hi,step){ step=step||500; return String(int(lo/step,hi/step)*step); }

const SURNAMES=['Dela Cruz','Santos','Reyes','Bautista','Ocampo','Villanueva','Mercado',
  'Aquino','Salvador','Domingo','Castillo','Ramos','Navarro','Bayani','Malabanan'];
const GIVEN=['Juan M.','Maria L.','Pedro S.','Rosario A.','Ernesto B.','Lourdes P.',
  'Ricardo T.','Anelyn G.','Danilo R.','Teresita V.','Rolando C.','Marilou F.'];
const ORGS=['Malasin Farmers Multi-Purpose Cooperative','Sto. Domingo ARB Association',
  'Bantug Irrigators Association Inc.','Rizal Agri-Producers Cooperative',
  'San Isidro Fisherfolk Association','Talavera Agri-Enterprise BMBE'];
const COMMODITY={
  'Crop production':['Palay (rice)','Yellow corn','White corn','Eggplant','Ampalaya','Tomato','Onion (red)','Sweet potato'],
  'Capture fisheries':['Tilapia (wild catch)','Galunggong','Hito','Mixed marine catch'],
  'Aquaculture':['Tilapia','Bangus (milkfish)','Hito (catfish)','Shrimp (suahe)'],
  'Livestock':['Swine (fattener)','Carabao','Native cattle','Goat'],
  'Poultry':['Broiler chicken','Native chicken','Layer (eggs)','Itik (duck)'],
  'Agricultural processing':['Milled rice','Dried fish','Peanut butter','Banana chips'],
  'Agricultural trading / aggregation':['Palay (traded)','Assorted vegetables','Live hogs'],
};
const LOSS_REASONS=['Heavy rain before harvest','Typhoon damage','Pest infestation (rats)',
  'Delayed hauling by trader','Poor drying weather','Bacterial leaf blight'];
const NOTES=['Interview conducted at the respondent’s home. No issues.',
  'Respondent consulted a notebook for loan figures.',
  'Spouse present for part of the interview.',
  'Interview paused briefly; respondent attended to livestock.',
  'Respondent estimated production figures from memory.'];
const ASSIST=['Helped complete the application form','Explained documentary requirements',
  'Accompanied respondent to the Lending Center','Assisted with photocopying of IDs'];
const IMPROVE=['Faster release of loan proceeds','Lower interest rate',
  'Fewer documentary requirements','Lending Center closer to the barangay',
  'Clearer explanation of repayment schedule'];

function numberFor(field){
  const id=field.field_id, lab=(field.label||'').toLowerCase(), unit=(field.unit||'').toLowerCase();
  const min=field.min!==undefined?field.min:0, max=field.max!==undefined?field.max:null;
  if(id==='B2_1') return String(int(28,64));
  if(id==='B5_1') return String(int(3,7));
  if(id==='B6_1') return String(int(1,3));
  if(id==='B7_1') return String(int(1,4));
  if(id==='B8_1') return money(9000,32000,500);
  if(id==='C3_1') return String(int(4,30));
  if(id==='C4_1') return String([0.5,1,1.5,2,2.5,3][int(0,5)]);
  if(id==='C4_3') return String([0.5,1,1.5,2][int(0,3)]);
  if(id==='C7_2') return String(int(20,180)*50);
  if(id==='C7_4') return String(int(30,95)*50);
  if(id==='C8_1') return String(int(1,3));
  if(id==='C13_1') return money(18000,90000,500);
  if(id==='C14_1') return money(60000,260000,500);
  if(id==='C15_1') return money(15000,130000,500);
  if(id==='C18_2') return String(int(3,18));
  if(id==='E4_1'||id==='E4_2') return money(50000,300000,5000);
  if(id==='E4_3') return money(50000,300000,5000);
  if(id==='E6_1') return String([2,3,5,6][int(0,3)]);
  if(id==='E7_1') return String([1,1,2,3][int(0,3)]);
  if(id==='E12_1') return String(int(3,9));
  if(id==='E13_1') return String(int(1,5));
  if(id==='E14_1') return money(200,1500,50);
  if(id==='E14_2') return money(100,900,50);
  if(id==='F6_1'||id==='E3_1') return money(20000,120000,1000);
  if(unit==='%'||lab.includes('percent')) return String(int(3,20));
  if(unit==='php'||lab.includes('php')) return money(5000,80000,500);
  let lo=Math.max(min,1), hi=max!==null?Math.min(max,20):12;
  if(hi<lo) hi=lo;
  return String(int(lo,hi));
}

function textFor(field, ctx){
  const id=field.field_id, lab=(field.label||'').toLowerCase();
  if(id==='A1_2') return ctx.province;
  if(id==='A1_3') return ctx.city;
  if(id==='A1_4') return ctx.barangay;
  if(id==='A4_1'||id==='B1_1') return ctx.personName;
  if(id==='A4_2') return ctx.orgName;
  if(id==='QUESTIONNAIR_intro_4') return ctx.frameId;
  if(id==='QUESTIONNAIR_intro_5') return ctx.enumerator;
  if(id==='QUESTIONNAIR_intro_6') return ctx.supervisor;
  if(id==='C2_2'||id==='C7_1') return ctx.commodity;
  if(id==='C18_3') return pick(LOSS_REASONS);
  if(id==='D7_3') return pick(ASSIST);
  if(id.startsWith('E1_')&&lab.includes('lending')) return ctx.lendingCenter;
  if(lab.includes('improve')) return pick(IMPROVE);
  if(lab.includes('note')||lab.includes('brief')) return pick(NOTES);
  if(lab.includes('reason')||lab.includes('why')||lab.includes('difficult')) return pick(LOSS_REASONS);
  if(lab.includes('unit')) return 'Kilograms';
  if(lab.includes('comment')) return 'No further comments.';
  if(lab.includes('specify')) return 'Other (specified by respondent)';
  return '';
}
module.exports={rnd,pick,int,money,SURNAMES,GIVEN,ORGS,COMMODITY,NOTES,numberFor,textFor,
  setSeed:(s)=>{seed=s;}};
