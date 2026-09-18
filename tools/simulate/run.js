const {makeResponse}=require('./generate'); const V=require('./values'); const fs=require('fs');

const A=[
 {name:'Individual rice farmer, loan fully released',answers:{A2_1:'Individual borrower',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A7_1:'Yes',A7_2:'Yes',A7_3:'Yes',C1_1:'Crop production'}},
 {name:'Individual corn farmer, partially released',answers:{A2_1:'Individual borrower',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'Yes – Continue',A6_1:'Yes, partially released',A7_1:'Yes',A7_2:'Yes',A7_3:'Yes',C1_1:'Crop production'}},
 {name:'Individual aquaculture (tilapia), fully released',answers:{A2_1:'Individual borrower',A3_1:'Agrarian Reform Beneficiary (ARB)',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A7_1:'Yes',A7_2:'Yes',A7_3:'Yes',C1_1:'Aquaculture'}},
 {name:'Individual swine raiser, fully released',answers:{A2_1:'Individual borrower',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A7_1:'Yes',A7_2:'Yes',A7_3:'Yes',C1_1:'Livestock'}},
 {name:'Cooperative (FFCA), fully released',answers:{A2_1:'Organizational / enterprise borrower',A3_1:'Farmers and Fisherfolk Cooperative / Association (FFCA)',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A8_1:'Manager',A8_2:'Yes – Continue',C1_1:'Crop production'}},
 {name:'BMBE trader, not yet released',answers:{A2_1:'Organizational / enterprise borrower',A3_1:'Barangay Micro Business Enterprise (BMBE)',A5_1:'Yes – Continue',A6_1:'No, not yet released',A8_1:'Owner / Proprietor',A8_2:'Yes – Continue',C1_1:'Agricultural trading / aggregation'}},
 {name:'ARBO, awaiting release',answers:{A2_1:'Organizational / enterprise borrower',A3_1:'Agrarian Reform Beneficiary Organization (ARBO)',A5_1:'Yes – Continue',A6_1:'Respondent does not know / requires verification',A8_1:'Chairperson / President',A8_2:'Yes – Continue',C1_1:'Crop production'}},
 {name:'Individual poultry raiser, fully released',answers:{A2_1:'Individual borrower',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'Yes – Continue',A6_1:'Yes, fully released',A7_1:'Yes',A7_2:'Yes',A7_3:'Yes',C1_1:'Poultry'}},
];
const B=[
 {name:'Individual rice farmer, never applied',answers:{A2_1:'Individual respondent',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Never applied',A8_1:'Yes',A8_2:'Yes',C1_1:'Crop production'}},
 {name:'Individual vegetable farmer, inquired only',answers:{A2_1:'Individual respondent',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Made an inquiry but did not formally apply',A8_1:'Yes',A8_2:'Yes',C1_1:'Crop production'}},
 {name:'Individual fisherfolk, application declined',answers:{A2_1:'Individual respondent',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Application declined / disapproved',A8_1:'Yes',A8_2:'Yes',C1_1:'Capture fisheries'}},
 {name:'Individual livestock raiser, withdrew application',answers:{A2_1:'Individual respondent',A3_1:'Agrarian Reform Beneficiary (ARB)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Application withdrawn',A8_1:'Yes',A8_2:'Yes',C1_1:'Livestock'}},
 {name:'Cooperative (FFCA), never applied',answers:{A2_1:'Organizational / enterprise respondent',A3_1:'Farmers and Fisherfolk Cooperative / Association (FFCA)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Never applied',A9_1:'Manager',A9_2:'Yes – Continue',C1_1:'Crop production'}},
 {name:'BMBE trader, application in process',answers:{A2_1:'Organizational / enterprise respondent',A3_1:'Barangay Micro Business Enterprise (BMBE)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Application currently being processed',A9_1:'Owner / Proprietor',A9_2:'Yes – Continue',C1_1:'Agricultural trading / aggregation'}},
 {name:'SME processor, started but did not complete',answers:{A2_1:'Organizational / enterprise respondent',A3_1:'Small or Medium Enterprise (SME)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Started application but did not complete it',A9_1:'Manager',A9_2:'Yes – Continue',C1_1:'Agricultural processing'}},
 {name:'Individual aquaculture, never applied',answers:{A2_1:'Individual respondent',A3_1:'Small Farmer / Fisherfolk (SFF)',A5_1:'No – Continue',A6_1:'No – Continue',A7_1:'Never applied',A8_1:'Yes',A8_2:'Yes',C1_1:'Aquaculture'}},
];

(async()=>{
  const out={A:[],B:[]};
  for(const [key,list] of [['A',A],['B',B]]){
    console.log('\n=== Instrument '+key+' ===');
    for(let i=0;i<list.length;i++){
      V.setSeed(20260918+i*7919+(key==='A'?0:5000));
      const r=await makeResponse(key,list[i],i);
      if(r.error){console.log('  ['+(i+1)+'] FAILED '+list[i].name+' -> '+r.error);}
      else{const n=Object.values(r.values).filter(v=>String(v).trim()&&String(v).indexOf('N/A (not applicable')!==0).length;
        console.log('  ['+(i+1)+'] ok  '+list[i].name.padEnd(52)+' '+n+' answered');
        out[key].push(r);}
    }
  }
  fs.writeFileSync(__dirname+'/responses.json',JSON.stringify(out,null,1));
  console.log('\nA: '+out.A.length+' responses   B: '+out.B.length+' responses');
})();
