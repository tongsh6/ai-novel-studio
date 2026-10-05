#!/usr/bin/env bash
# Q4 差距回收机制（2026-08-30，D8 三挖 A 类病根：差距登记后无人收账）。
# 扫描三处差距登记表 → 输出开放差距清单，与上次快照对比出 新增/关闭/滞留。
# 快照台账：reports/gap-ledger/latest.json（跨次处置台账，SSOT 规则）。
# 开工仪式消费：tasks/NEXT.md §5 Selection Rule 第 6 条。
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PYEOF'
import json,re,os,datetime

open_gaps={}

# 1) VS-00D §6 G1-G7
for line in open('docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md',encoding='utf-8'):
    m=re.match(r'\|\s*(G\d+)\s*\|\s*([^|]+)\|', line)
    if m and '~~' not in line:
        open_gaps['VS-00D:'+m.group(1)]=m.group(2).strip()[:60]

# 2) 08 §6.2 NEM-GAP
for line in open('docs/design/08-novel-element-model.md',encoding='utf-8'):
    m=re.match(r'\|\s*(NEM-GAP-\d+)\s*\|\s*([^|]+)\|', line)
    if m:
        desc=m.group(2)
        rest=line
        if '已关闭' in rest and '部分关闭' not in rest: continue
        open_gaps['08:'+m.group(1)]=re.sub(r'~~[^~]*~~','',desc).strip()[:60]

# 3) NEXT B 轨台账
for line in open('tasks/NEXT.md',encoding='utf-8'):
    m=re.match(r'\|\s*(B\d+)\s*\|\s*([^|]+)\|', line)
    if m:
        rest=line
        if '已销账' in rest or 'done（' in rest or 'done /' in rest or '**已销账' in rest: continue
        open_gaps['B轨:'+m.group(1)]=re.sub(r'~~[^~]*~~','',m.group(2)).strip()[:60]

path='reports/gap-ledger/latest.json'
prev={}
streak={}
if os.path.exists(path):
    d=json.load(open(path,encoding='utf-8'))
    prev=d.get('gaps',{})
    streak=d.get('streak',{})

added=[k for k in open_gaps if k not in prev]
closed=[k for k in prev if k not in open_gaps]
stale=[]
new_streak={}
for k in open_gaps:
    n=streak.get(k,0)+1 if k in prev else 1
    new_streak[k]=n
    if n>=3: stale.append((k,n))

today=datetime.date.today().isoformat()
json.dump({'scanned_at':today,'gaps':open_gaps,'streak':new_streak},
          open(path,'w',encoding='utf-8'),ensure_ascii=False,indent=1)

print(f"[gap-ledger] {today} 开放差距 {len(open_gaps)} 项（VS-00D {sum(1 for k in open_gaps if k.startswith('VS-00D'))} / NEM-GAP {sum(1 for k in open_gaps if k.startswith('08'))} / B 轨 {sum(1 for k in open_gaps if k.startswith('B轨'))}）")
if added: print(f"[gap-ledger] 新增: {', '.join(added)}")
if closed: print(f"[gap-ledger] 关闭: {', '.join(closed)}")
if stale:
    print(f"[gap-ledger] ⚠ 复核（连续 {3}+ 次快照仍开放，不代表期间无进展）——应裁决：推进 / 降级登记理由 / 显式弃置:")
    for k,n in sorted(stale,key=lambda x:-x[1]): print(f"    {k} ×{n}  {open_gaps[k]}")
PYEOF
