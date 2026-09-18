import json,os
REPO=os.path.abspath(os.path.join(os.path.dirname(__file__),'..','..'))
R=json.load(open('responses.json'))
AUTO='N/A (not applicable based on a prior answer)'
S={k:json.load(open(REPO+'/tools/questions_%s.json'%k)) for k in 'AB'}
tot=0
for key in 'AB':
    idx={f['field_id']:f for s in S[key]['sections'] for q in s['questions'] for f in q['fields']}
    print('='*72); print('INSTRUMENT',key); print('='*72)
    for n,r in enumerate(R[key],1):
        v=r['values']; bad=[]
        if 'ligible' not in v.get('A10_1',''): bad.append('A10=%r'%v.get('A10_1','')[:40])
        for pref in ('C17_table1__','F1_table1__','G12_table1__'):
            cells={k:v[k] for k in v if k.startswith(pref)}
            if not cells or all(c==AUTO for c in cells.values()): continue
            rows=[k for k in cells if '__total__' not in k.lower()]
            tots=[k for k in cells if '__total__' in k.lower()]
            if not tots: continue
            s=sum(float(cells[k]) for k in rows if str(cells[k]).replace('.','',1).isdigit())
            t=float(cells[tots[0]]) if str(cells[tots[0]]).replace('.','',1).isdigit() else -1
            if abs(s-100)>0.01: bad.append('%s rows sum %.0f'%(pref,s))
            if abs(t-s)>0.01:   bad.append('%s total %.0f != rows %.0f'%(pref,t,s))
        for num,fb in (('B8_1','B8_2'),('C13_1','C13_2'),('C14_1','C14_2'),('C15_1','C15_2'),('F6_1','F6_2'),('E3_1','E3_2')):
            a=str(v.get(num,'')).strip(); b=str(v.get(fb,'')).strip()
            if a and a!=AUTO and b and b!=AUTO: bad.append('both %s + %s'%(num,fb))
        for fid,f in idx.items():
            if f.get('type')!='number': continue
            raw=str(v.get(fid,'')).strip()
            if not raw or raw==AUTO: continue
            try: x=float(raw)
            except: bad.append('%s non-numeric'%fid); continue
            if f.get('min') is not None and x<f['min']: bad.append('%s=%s<min'%(fid,raw))
            if f.get('max') is not None and x>f['max']: bad.append('%s=%s>max'%(fid,raw))
            if f.get('maxOf'):
                try:
                    cap=float(v.get(f['maxOf'],'nan'))
                    if x>cap: bad.append('%s>%s'%(fid,f['maxOf']))
                except: pass
        # required fields must be answered
        for fid,f in idx.items():
            if not f.get('required'): continue
            val=str(v.get(fid,'')).strip()
            if not val: bad.append('required %s blank'%fid)
        tot+=len(bad)
        print(' [%s] %d. %-48s %s'%('OK ' if not bad else 'BAD',n,r['profile'][:48],'; '.join(bad[:3])))
print('\nTOTAL PROBLEMS:',tot)
