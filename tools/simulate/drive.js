const fs=require('fs'),path=require('path'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..','..');
function loadApp(){
  const html=fs.readFileSync(path.join(ROOT,'docs/index.html'),'utf8')
    .replace(/<script src="config.js"><\/script>/,'').replace(/<script src="app.js"><\/script>/,'');
  const dom=new JSDOM(html,{runScripts:'outside-only',url:'http://localhost/'});
  const {window}=dom;
  const schemas={A:JSON.parse(fs.readFileSync(path.join(ROOT,'tools/questions_A.json'),'utf8')),
                 B:JSON.parse(fs.readFileSync(path.join(ROOT,'tools/questions_B.json'),'utf8'))};
  window.APPS_SCRIPT_URL='https://example.test/exec';
  const submissions=[];
  window.fetch=function(url,opts){
    if(opts&&opts.method==='POST'){submissions.push(JSON.parse(opts.body));
      return Promise.resolve({ok:true,json:()=>Promise.resolve({ok:true,responseNo:'SIM'})});}
    const u=String(url);
    if(u.indexOf('action=schema')!==-1){const k=/instrument=([AB])/.exec(u)[1];
      return Promise.resolve({ok:true,json:()=>Promise.resolve(schemas[k])});}
    return Promise.reject(new Error('offline'));
  };
  window.confirm=()=>false; window.alert=()=>{}; window.scrollTo=()=>{};
  window.localStorage.clear();
  window.eval(fs.readFileSync(path.join(ROOT,'docs/app.js'),'utf8'));
  const doc=window.document;
  const H={window,doc,submissions,schemas,
    start(k){const b=[...doc.querySelectorAll('.chooser button.big')][k==='A'?0:1];
      b.disabled=false;b.dispatchEvent(new window.Event('click',{bubbles:true}));
      return new Promise(r=>setTimeout(r,30));},
    wrap(f){return doc.querySelector('[data-field-id="'+f+'"]');},
    grayed(f){const w=H.wrap(f);return !!w&&w.classList.contains('field-grayed');},
    pick(f,t){const w=H.wrap(f);if(!w)throw new Error('no field '+f);
      const s=w.querySelector('select.input-select');
      if(s){const o=[...s.options].find(o=>o.textContent.trim()===t);
        if(!o)throw new Error('no option '+t+' in '+f);s.value=o.value;
        s.dispatchEvent(new window.Event('change',{bubbles:true}));return;}
      const i=[...w.querySelectorAll('input')].find(i=>{const l=w.querySelector('label[for="'+i.id+'"]');return l&&l.textContent.trim()===t;});
      if(!i)throw new Error('no choice "'+t+'" in '+f);
      i.checked=i.type==='checkbox'?!i.checked:true;
      i.dispatchEvent(new window.Event('change',{bubbles:true}));},
    type(f,v){const w=H.wrap(f);if(!w)throw new Error('no field '+f);
      const i=w.querySelector('input.input-text,input.input-datetime,textarea');
      if(!i)throw new Error('no input in '+f);i.value=v;
      i.dispatchEvent(new window.Event('input',{bubbles:true}));},
    flush(){return new Promise(r=>setTimeout(r,6));},
    next(){doc.getElementById('nextBtn').dispatchEvent(new window.Event('click',{bubbles:true}));},
    submit(){doc.getElementById('submitBtn').dispatchEvent(new window.Event('click',{bubbles:true}));},
    title(){return (doc.querySelector('.section-title')||{}).textContent;},
    status(){return doc.getElementById('statusBar').textContent;}};
  return H;
}
module.exports={loadApp,ROOT};
