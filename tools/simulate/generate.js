// Generates COMPLETE simulated responses by driving the real client, so
// routing, derivation, exclusivity and validation all apply exactly as
// they would in the field.
const {loadApp}=require('./drive');
const V=require('./values');
const fs=require('fs');

const LOCS=[
 {region:'Region III – Central Luzon',province:'Nueva Ecija',city:'Science City of Muñoz',brgy:'Malasin',lc:'LANDBANK Muñoz Branch'},
 {region:'Region III – Central Luzon',province:'Bulacan',city:'San Miguel',brgy:'Sibul',lc:'LANDBANK San Miguel Branch'},
 {region:'Region VI – Western Visayas',province:'Iloilo',city:'Pototan',brgy:'Cau-ayan',lc:'LANDBANK Pototan Branch'},
 {region:'Region II – Cagayan Valley',province:'Isabela',city:'Cauayan City',brgy:'Villa Luna',lc:'LANDBANK Cauayan Branch'},
 {region:'Region X – Northern Mindanao',province:'Bukidnon',city:'Valencia City',brgy:'Poblacion',lc:'LANDBANK Valencia Branch'},
 {region:'Region IV-A – CALABARZON',province:'Quezon',city:'Candelaria',brgy:'Mangilag Sur',lc:'LANDBANK Candelaria Branch'},
];

function ctxFor(i,kind){
  const L=LOCS[i%LOCS.length];
  return {province:L.province,city:L.city,barangay:L.brgy,region:L.region,lendingCenter:L.lc,
    personName:V.pick(V.SURNAMES)+', '+V.pick(V.GIVEN),
    orgName:V.pick(V.ORGS),
    enumerator:V.pick(V.SURNAMES)+', '+V.pick(V.GIVEN),
    supervisor:V.pick(V.SURNAMES)+', '+V.pick(V.GIVEN),
    frameId:(kind==='A'?'BRW-':'NBR-')+L.province.slice(0,3).toUpperCase()+'-'+String(1000+V.int(1,899)),
    commodity:'Palay (rice)'};
}

/** Fills every answerable field on the page that is still blank. */
function fillPage(H,ctx){
  const doc=H.doc, win=H.window;
  const section=H.schemas[H.key].sections[H.sectionIndex()];
  const byId={};
  section.questions.forEach(q=>q.fields.forEach(f=>{byId[f.field_id]=f;}));

  // Commodity has to match the activity the respondent actually reported:
  // "Palay (rice)" against an Aquaculture enterprise is the kind of thing
  // a reviewer spots in the first minute.
  const c1=doc.querySelector('[data-field-id="C1_1"]');
  if(c1 && !c1.classList.contains('field-grayed')){
    const ticked=[...c1.querySelectorAll('input:checked')]
      .map(i=>{const l=c1.querySelector('label[for="'+i.id+'"]');return l?l.textContent.trim():'';})
      .filter(Boolean);
    for(const act of ticked){ if(V.COMMODITY[act]){ ctx.commodity=V.pick(V.COMMODITY[act]); break; } }
  }

  doc.querySelectorAll('[data-field-id]').forEach(wrap=>{
    if(wrap.classList.contains('field-grayed')) return;
    const fid=wrap.getAttribute('data-field-id'); const f=byId[fid]; if(!f) return;
    if(f.readOnly||f.derived||f.generator) return;
    // Interview Outcome is not a free choice: an interview that reaches
    // the end and submits IS "Completed". Randomising it produced records
    // that ran to the last section and then claimed the respondent was
    // unavailable. The disposition cases set this themselves, via the
    // routing gate.
    if(fid==='QUESTIONNAIR_intro_12'){
      // 7 options, so the app renders this as a dropdown, not radios.
      const sl=wrap.querySelector('select.input-select');
      if(sl){
        const o=[...sl.options].find(o=>o.textContent.trim()==='Completed');
        if(o && sl.value!==o.value){ sl.value=o.value; sl.dispatchEvent(new win.Event('change',{bubbles:true})); }
      } else {
        const r=[...wrap.querySelectorAll('input[type=radio]')].find(i=>{
          const l=wrap.querySelector('label[for="'+i.id+'"]');
          return l && l.textContent.trim()==='Completed';});
        if(r && !r.checked){ r.checked=true; r.dispatchEvent(new win.Event('change',{bubbles:true})); }
      }
      return;
    }
    // The post-interview QC fields belong to the supervisor and the data
    // manager. They open at Pending and must stay there.
    if(f.adminOnly) return;
    // An exact amount and its "cannot provide" fallback are alternate
    // routes to one answer. Filling both makes the app clear one of them
    // and produces a contradictory record.
    if(f.exclusiveWith && f.exclusiveWith.some(pid=>{
        const pv=H.answers?H.answers()[pid]:null; return false;})) return;
    if(f.exclusiveWith && f.exclusiveWith.some(pid=>{
        const pw=doc.querySelector('[data-field-id="'+pid+'"]');
        if(!pw||pw.classList.contains('field-grayed')) return false;
        if(pw.querySelector('input:checked')) return true;
        const pi=pw.querySelector('input.input-text,input.input-datetime,textarea');
        return !!(pi&&pi.value);
      })) return;

    const sel=wrap.querySelector('select.input-select');
    if(sel&&!sel.disabled){
      if(sel.value) return;
      const opts=[...sel.options].filter(o=>o.value);
      if(!opts.length) return;
      const o=V.pick(opts.slice(0,Math.min(opts.length,8)));
      sel.value=o.value; sel.dispatchEvent(new win.Event('change',{bubbles:true}));
      const sp=wrap.querySelector('input.specify-input');
      if(sp&&!sp.value){sp.value='Specified by respondent';sp.dispatchEvent(new win.Event('input',{bubbles:true}));}
      return;
    }
    const radios=[...wrap.querySelectorAll('input[type=radio]:not([disabled])')];
    if(radios.length){
      if(wrap.querySelector('input[type=radio]:checked')) return;
      const r=V.pick(radios);
      r.checked=true; r.dispatchEvent(new win.Event('change',{bubbles:true}));
      return;
    }
    const boxes=[...wrap.querySelectorAll('input[type=checkbox]:not([disabled])')];
    if(boxes.length){
      if(wrap.querySelector('input[type=checkbox]:checked')) return;
      const n=Math.min(boxes.length,V.int(1,Math.min(3,boxes.length)));
      const chosen=new Set(); while(chosen.size<n) chosen.add(V.int(0,boxes.length-1));
      chosen.forEach(ix=>{boxes[ix].checked=true;boxes[ix].dispatchEvent(new win.Event('change',{bubbles:true}));});
      const sp=wrap.querySelector('input.specify-input');
      if(sp&&!sp.value){sp.value='Specified by respondent';sp.dispatchEvent(new win.Event('input',{bubbles:true}));}
      return;
    }
    const inp=wrap.querySelector('input:not([disabled]),textarea:not([disabled])');
    if(inp&&!inp.value){
      let v='';
      if(inp.type==='number'){
        v=V.numberFor(f);
        // Net income is not independent of the two figures above it.
        if(fid==='C15_1'){
          const g=parseFloat((doc.querySelector('[data-field-id="C14_1"] input')||{}).value);
          const c=parseFloat((doc.querySelector('[data-field-id="C13_1"] input')||{}).value);
          if(!isNaN(g)&&!isNaN(c)) v=String(Math.round((g-c)/500)*500);
        }
        // Honour cross-field caps (released <= approved, cultivated <=
        // total, active members <= household size) so the generated data
        // never trips the app's own contradiction warnings.
        if(f.maxOf){
          const cw=doc.querySelector('[data-field-id="'+f.maxOf+'"]');
          const ci=cw&&cw.querySelector('input');
          const cap=ci?parseFloat(ci.value):NaN;
          if(!isNaN(cap)&&parseFloat(v)>cap) v=String(cap);
        }
      }
      else if(inp.type==='date') v='2026-0'+V.int(3,8)+'-1'+V.int(0,9);
      else if(inp.type==='month') v='2026-0'+V.int(1,9);
      else if(inp.type==='time') v='0'+V.int(8,9)+':'+V.int(10,59);
      else v=V.textFor(f,ctx)||'Recorded by enumerator';
      if(v!==''){inp.value=v;inp.dispatchEvent(new win.Event('input',{bubbles:true}));}
    }
  });

  // matrices
  doc.querySelectorAll('[data-matrix-field]').forEach(wrap=>{
    if(wrap.classList.contains('field-grayed')) return;
    const nums=[...wrap.querySelectorAll('input[type=number]:not([disabled])')];
    if(nums.length){
      const isPct=wrap.querySelector('.matrix-total-row')!==null;
      if(isPct){
        const parts=[70,15,7,5,3].slice(0,nums.length);
        let rest=100-parts.reduce((a,b)=>a+b,0);
        parts[0]+=rest;
        nums.forEach((n,i)=>{if(!n.value){n.value=String(parts[i]!==undefined?parts[i]:0);
          n.dispatchEvent(new win.Event('input',{bubbles:true}));}});
      } else {
        nums.forEach(n=>{if(!n.value){n.value=String(V.int(1,40)*10);
          n.dispatchEvent(new win.Event('input',{bubbles:true}));}});
      }
    }
    const texts=[...wrap.querySelectorAll('input[type=text]:not([disabled])')];
    texts.forEach(t=>{if(!t.value){t.value='Kilograms';t.dispatchEvent(new win.Event('input',{bubbles:true}));}});
    // radio grids
    const names=new Set(); wrap.querySelectorAll('input[type=radio]:not([disabled])').forEach(r=>names.add(r.name));
    names.forEach(nm=>{
      if(wrap.querySelector('input[name="'+nm+'"]:checked')) return;
      const rs=[...wrap.querySelectorAll('input[name="'+nm+'"]:not([disabled])')];
      if(rs.length){const r=V.pick(rs);r.checked=true;r.dispatchEvent(new win.Event('change',{bubbles:true}));}
    });
  });
}

async function makeResponse(key, profile, idx){
  const H=loadApp(); H.key=key;
  H.sectionIndex=()=>{
    const t=(H.doc.querySelector('.section-title')||{}).textContent;
    return H.schemas[key].sections.findIndex(s=>s.title===t);
  };
  await H.start(key);
  const ctx=ctxFor(idx,key);
  // Force-set, never toggle: profile answers are applied on every page
  // pass, and a toggling checkbox would switch itself back off.
  const P=(f,t)=>{
    try{
      const w=H.wrap(f); if(!w) return;
      const sel=w.querySelector('select.input-select');
      if(sel){ const o=[...sel.options].find(o=>o.textContent.trim()===t); if(!o) return;
        if(sel.value===o.value) return;
        sel.value=o.value; sel.dispatchEvent(new H.window.Event('change',{bubbles:true})); return; }
      const i=[...w.querySelectorAll('input')].find(i=>{
        const l=w.querySelector('label[for="'+i.id+'"]'); return l&&l.textContent.trim()===t;});
      if(!i||i.disabled||i.checked) return;
      i.checked=true; i.dispatchEvent(new H.window.Event('change',{bubbles:true}));
    }catch(e){}
  };
  const T=(f,v)=>{try{H.type(f,v);}catch(e){}};

  for(let guard=0; guard<40; guard++){
    const before=(H.doc.querySelector('.section-title')||{}).textContent;
    // profile-critical answers first, so routing settles before bulk fill
    P('QUESTIONNAIR_intro_10', V.pick(['Filipino','Filipino','English']));
    P('QUESTIONNAIR_intro_11','Face-to-face');
    P('Consent_to_Participa_1','Yes – Proceed');
    P('Consent_for_Possible_1', V.pick(['Yes','Yes','No']));
    P('Consent_Confirmation_1','I certify that I read/explained the informed consent and that the respondent voluntarily agreed to participate.');
    P('A1_1', ctx.region);
    Object.entries(profile.answers||{}).forEach(([f,v])=>P(f,v));
    await H.flush();
    Object.entries(profile.answers||{}).forEach(([f,v])=>P(f,v));
    await H.flush();
    fillPage(H,ctx); await H.flush();
    fillPage(H,ctx); await H.flush();   // second pass catches newly-revealed follow-ups

    if(H.doc.getElementById('submitBtn').style.display!=='none') break;
    H.next(); await H.flush();
    if((H.doc.querySelector('.section-title')||{}).textContent===before){
      return {error:'blocked at "'+before+'": '+H.status()};
    }
  }
  H.submit(); await new Promise(r=>setTimeout(r,60));
  if(!H.submissions.length) return {error:'not submitted: '+H.status()};
  return {values:H.submissions[0].values, profile:profile.name};
}
module.exports={makeResponse};
