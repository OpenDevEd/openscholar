import json,sys
d=json.loads(sys.stdin.read()); last=sys.argv[1]
print(' '.join(f"{x['name'].split(':')[-1]}={x['processed']}{'' if x.get('state')=='success' else '('+str(x.get('state'))+')'}" for x in d))
bad=[x for x in d if x.get('state')=='failed' or x.get('error')]
for x in bad: print('ERR',x['name'],str(x.get('error') or x)[:700])
names={x['name'].split(':')[-1]:x for x in d}
sys.exit(2 if bad else (0 if last in names and all(x.get('state')=='success' for x in d) else 3))
