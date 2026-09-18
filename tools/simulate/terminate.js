// Generates the disposition cases: interviews the routing gates stop.
// These are the records that populate INTERVIEW_COMPLETION and
// INTERVIEW_TERMINATION_REASON, and they are how refusals and
// ineligibles are counted in the sample disposition.
const {loadApp}=require('./drive'); const V=require('./values'); const fs=require('fs');

const LOCS=[
 {region:'Region III – Central Luzon',province:'Nueva Ecija',city:'Science City of Muñoz',brgy:'Malasin'},
 {region:'Region VI – Western Visayas',province:'Iloilo',city:'Pototan',brgy:'Cau-ayan'},
 {region:'Region II – Cagayan Valley',province:'Isabela',city:'Cauayan City',brgy:'Villa Luna'},
 {region:'Region X – Northern Mindanao',province:'Bukidnon',city:'Valencia City',brgy:'Poblacion'},
 {region:'Region IV-A – CALABARZON',province:'Quezon',city:'Candelaria',brgy:'Mangilag Sur'},
];

async function terminated(key, spec, idx){
  const H=loadApp(); await H.start(key);
  const L=LOCS[idx%LOCS.length];
  const P=(f,t)=>{try{
    const w=H.wrap(f); if(!w) return;
    const s=w.querySelector('select.input-select');
    if(s){const o=[...s.options].find(o=>o.textContent.trim()===t); if(!o||s.value===o.value)return;
      s.value=o.value; s.dispatchEvent(new H.window.Event('change',{bubbles:true})); return;}
    const i=[...w.querySelectorAll('input')].find(i=>{const l=w.querySelector('label[for="'+i.id+'"]');return l&&l.textContent.trim()===t;});
    if(!i||i.disabled||i.checked) return;
    i.checked=true; i.dispatchEvent(new H.window.Event('change',{bubbles:true}));
  }catch(e){}};
  const T=(f,v)=>{try{const w=H.wrap(f); const i=w&&w.querySelector('input.input-text,textarea');
    if(i&&!i.disabled){i.value=v;i.dispatchEvent(new H.window.Event('input',{bubbles:true}));}}catch(e){}};

  H.next();                                            // admin
  T('QUESTIONNAIR_intro_4',(key==='A'?'BRW-':'NBR-')+L.province.slice(0,3).toUpperCase()+'-'+String(2000+idx));
  T('QUESTIONNAIR_intro_5',V.pick(V.SURNAMES)+', '+V.pick(V.GIVEN));
  T('QUESTIONNAIR_intro_6',V.pick(V.SURNAMES)+', '+V.pick(V.GIVEN));
  P('QUESTIONNAIR_intro_10','Filipino'); P('QUESTIONNAIR_intro_11','Face-to-face');
  H.next();                                            // consent
  P('Consent_to_Participa_1', spec.consent||'Yes – Proceed');
  await H.flush();
  if(!spec.consent || spec.consent.indexOf('Yes')===0){
    P('Consent_for_Possible_1','Yes');
    P('Consent_Confirmation_1','I certify that I read/explained the informed consent and that the respondent voluntarily agreed to participate.');
    H.next();                                          // eligibility
    P('A1_1',L.region); T('A1_2',L.province); T('A1_3',L.city); T('A1_4',L.brgy);
    Object.entries(spec.answers||{}).forEach(([f,v])=>P(f,v));
    await H.flush();
    Object.entries(spec.answers||{}).forEach(([f,v])=>P(f,v));
    await H.flush();
  }
  const banner=H.doc.getElementById('terminationBanner');
  if(!banner) return {error:'no gate fired'};
  const title=banner.querySelector('h3').textContent;
  H.window.confirm=()=>true;
  banner.querySelector('button').dispatchEvent(new H.window.Event('click',{bubbles:true}));
  await new Promise(r=>setTimeout(r,60));
  if(!H.submissions.length) return {error:'not submitted'};
  return {values:H.submissions[0].values, profile:spec.name, gate:title};
}

const A=[
 {name:'Consent refused',consent:'No – End interview and thank respondent'},
 {name:'No AGRISENSO Plus loan agreement on record',answers:{A2_1:'Individual borrower',A5_1:'No'}},
 {name:'Loan agreement could not be verified',answers:{A2_1:'Individual borrower',A5_1:'Unable to verify'}},
 {name:'Respondent under 18',answers:{A2_1:'Individual borrower',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A7_1:'Yes',A7_2:'No'}},
 {name:'Organisational rep not authorised',answers:{A2_1:'Organizational / enterprise borrower',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A8_1:'Board Member / Director',A8_2:'No'}},
];
const B=[
 {name:'Consent refused',consent:'No – End interview and thank respondent'},
 {name:'Currently an AGRISENSO Plus borrower',answers:{A2_1:'Individual respondent',A5_1:'Yes'}},
 {name:'Previously an AGRISENSO Plus borrower',answers:{A2_1:'Individual respondent',A5_1:'No – Continue',A6_1:'Yes'}},
 {name:'Respondent under 18',answers:{A2_1:'Individual respondent',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Never applied',A8_1:'No'}},
 {name:'Organisational rep not authorised',answers:{A2_1:'Organizational / enterprise respondent',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Never applied',A9_1:'Board Member / Director',A9_2:'No'}},
];

(async()=>{
  const out={A:[],B:[]};
  for(const [key,list] of [['A',A],['B',B]]){
    console.log('\n=== Instrument '+key+' — disposition cases ===');
    for(let i=0;i<list.length;i++){
      V.setSeed(77000+i*131+(key==='A'?0:900));
      const r=await terminated(key,list[i],i);
      if(r.error) console.log('  ['+(i+1)+'] FAILED '+list[i].name+' -> '+r.error);
      else{
        console.log('  ['+(i+1)+'] '+list[i].name.padEnd(42)+' -> '+r.values['QUESTIONNAIR_intro_12']);
        out[key].push(r);
      }
    }
  }
  fs.writeFileSync(__dirname+'/terminated.json',JSON.stringify(out,null,1));
  console.log('\nA: '+out.A.length+'   B: '+out.B.length);
})();
