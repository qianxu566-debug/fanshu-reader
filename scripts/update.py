from pathlib import Path
import json,subprocess,sys,tempfile
p=Path(__file__).resolve().parent
def read(name):return (p/name).read_text(encoding='utf-8-sig')
parts=['const QBOOK='+json.dumps(read('qbook-parser.py'))+';', 'const SCOPES='+read('scopes.json')+';', 'const RANK_FONT='+read('rank-font.json')+';']
parts.extend(read(n) for n in ['channel.mjs','shelf.mjs','refresh.mjs'])
with tempfile.TemporaryDirectory() as tmp:
    run=Path(tmp)/'refresh.mjs'
    run.write_text('\n'.join(parts),encoding='utf-8')
    sys.exit(subprocess.call(['node',str(run),*sys.argv[1:]]))
