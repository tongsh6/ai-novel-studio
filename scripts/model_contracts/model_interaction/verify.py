#!/usr/bin/env python3
"""Offline design-fixture verifier. It does not call a model, query the real DB, or run product tests."""
from __future__ import annotations
import argparse, copy, hashlib, json, re, sys
from pathlib import Path
from datetime import datetime
from jsonschema import Draft202012Validator, FormatChecker

from paths import ROOT, SCHEMAS, CATALOGS, FIXTURES, report_dir, report_file
SCHEMA=json.loads((SCHEMAS/'model-interaction.schema.json').read_text(encoding='utf-8'))
VALIDATOR=Draft202012Validator(SCHEMA,format_checker=FormatChecker())
FORBIDDEN={'adopt','canon_write','accept_candidate','confirm_candidate','self_approve'}
SYSTEM_FIELDS={'authorized','canon_written','auto_adopted','author_confirmed','execution_authorized','adoption_status','truthfulness'}

def sha(s:str)->str:return hashlib.sha256(s.encode('utf-8')).hexdigest()
def ptr(obj,p):
    if p=='':return obj
    for k in p.lstrip('/').split('/'):
        k=k.replace('~1','/').replace('~0','~')
        obj=obj[int(k)] if isinstance(obj,list) else obj[k]
    return obj

def lint(case):
    """Return stable error codes. Full DB authorization, semantic truth, and literary quality remain runtime/human obligations."""
    errs=[]
    def fail(code):errs.append(code)
    try:
        if list(VALIDATOR.iter_errors(case)):fail('SCHEMA_INVALID');return sorted(set(errs))
    except Exception:
        fail('SCHEMA_RESOLUTION_ERROR');return sorted(set(errs))
    reqs={r['identity']['request_id']:r for r in case['requests']}
    resps={r['response_id']:r for r in case['responses']}
    if len(reqs)!=len(case['requests']):fail('DUPLICATE_REQUEST_ID')
    if len(resps)!=len(case['responses']):fail('DUPLICATE_RESPONSE_ID')
    all_calls={}
    for r in case['requests']:
        work=r['identity'].get('work_ref')
        author=r.get('author_input')
        if r['identity']['kind']=='agent_run' and not author:fail('AUTHOR_SOURCE_MISSING')
        if r['identity']['kind']=='standalone_operation' and any(k in r['identity'] for k in ['run_ref','session_ref','turn_ref']):fail('FAKE_RUN_IDENTITY')
        if author and sha(author['text'])!=author['sha256']:fail('AUTHOR_BYTES_CHANGED')
        if r['context'].get('work_ref') not in (None,work):fail('CROSS_WORK_CONTEXT')
        if r['task']['scope'].get('modification_scope') in ['whole_chapter','target_segments','format_only']:
            if not r['task']['scope'].get('expected_base_versions') or not r['task']['scope'].get('base_hash'):fail('REVISION_BASE_MISSING')
        mats={m['material_ref']:m for m in r['context']['materials']}
        if len(mats)!=len(r['context']['materials']):fail('DUPLICATE_MATERIAL_REF')
        if not set(r['task']['material_refs'])<=set(mats):fail('MATERIAL_NOT_SUPPLIED')
        history=r['history']['messages'];pending={};hist_calls={};hist_result={}
        insert=r['history'].get('current_author_insert_at',len(history))
        if insert>len(history):fail('AUTHOR_INSERT_OUT_OF_RANGE')
        for idx,h in enumerate(history):
            if idx==insert and author and pending:fail('AUTHOR_INTERRUPTS_TOOL_EXCHANGE')
            if h['role']=='user':
                if pending:fail('TOOL_RESULT_NOT_ADJACENT')
                if sha(h['text'])!=h['sha256']:fail('HISTORICAL_AUTHOR_BYTES_CHANGED')
                if author and h['message_ref']==author['message_ref']:fail('CURRENT_AUTHOR_DUPLICATED')
            elif h['role']=='assistant':
                if pending:fail('UNCLOSED_TOOL_CALL')
                for c in h['tool_calls']:
                    if c['call_id'] in hist_calls:fail('DUPLICATE_CALL_ID')
                    pending[c['call_id']]=c;hist_calls[c['call_id']]=c
            elif h['role']=='tool':
                cid=h['call_id']
                if cid not in pending:fail('ORPHAN_TOOL_RESULT')
                else:pending.pop(cid)
                if cid in hist_result:fail('DUPLICATE_TOOL_RESULT')
                hist_result[cid]=h
                for mr in h['material_refs']:
                    if mr not in mats:fail('TOOL_RESULT_MATERIAL_MISSING');continue
                    if mats[mr].get('tool_call_id')!=cid:fail('OBSERVATION_CALL_MISMATCH')
            elif h['role']=='checkpoint':
                if pending:fail('CHECKPOINT_CUTS_OPEN_CALL')
                if h['checkpoint_ref'] not in {c['checkpoint_ref'] for c in r['history']['checkpoints']}:fail('CHECKPOINT_MISSING')
        if pending:fail('UNCLOSED_TOOL_CALL')
        for m in mats.values():
            source=m['source'];payload=m['payload'];cov=m['coverage']
            if source.get('work_ref') not in (None,work):fail('CROSS_WORK_MATERIAL')
            if m['origin']=='tool_observation':
                cid=m.get('tool_call_id')
                if cid not in hist_calls or cid not in hist_result:fail('FABRICATED_OBSERVATION')
            if cov['status']=='complete' and (cov['total'] is None or cov['included']!=cov['total'] or cov['omitted_count']!=0 or cov['next_cursor'] is not None):fail('COVERAGE_INCONSISTENT')
            if cov['total'] is not None and cov['omitted_count'] is not None and cov['included']+cov['omitted_count']!=cov['total']:fail('COVERAGE_COUNTS_MISMATCH')
            if cov['status'] in ['not_read','unavailable'] and cov['included']!=0:fail('UNREAD_HAS_CONTENT_CLAIM')
            if payload['kind'] in ['text','author_asset']:
                if sha(payload['text'])!=payload['sha256']:fail('MATERIAL_HASH_MISMATCH')
            if payload['kind']=='text':
                raw=payload['text'].encode('utf-8')
                for seg in payload.get('segments',[]):
                    a,b=seg['start_byte'],seg['end_byte_exclusive']
                    if not (a<=b<=len(raw)) or raw[a:b]!=seg['text'].encode('utf-8') or sha(seg['text'])!=seg['sha256']:fail('SEGMENT_BYTES_MISMATCH')
                if cov['status']=='complete' and cov['unit']=='utf8_byte' and cov['included']!=len(raw):fail('TEXT_COVERAGE_MISMATCH')
            if payload['kind']=='chapter_index':
                if cov['status']=='complete' and (len(payload['items'])!=payload['chapter_slots_total'] or sum(x['has_accepted_prose'] for x in payload['items'])!=payload['chapters_with_accepted_prose']):fail('CHAPTER_COUNTS_MISMATCH')
            if payload['kind']=='author_asset':
                if source['authority']=='canon':fail('ASSET_BECOMES_CANON')
                if not payload['enabled'] or payload['linked_work_ref']!=work:fail('ASSET_LINK_INVALID')
        expected_versions={v['ref']:v['version'] for v in r['task']['scope'].get('expected_base_versions',[])}
        for m in mats.values():
            if m['source']['ref'] in expected_versions and m['source'].get('version')!=expected_versions[m['source']['ref']]:fail('EVIDENCE_VERSION_MISMATCH')
        if r['task']['output_contract']['required_evidence']=='complete_target':
            texts=[m for m in mats.values() if m['payload']['kind']=='text']
            target=r['task']['scope'].get('base_ref') or r['task']['scope'].get('target_chapter_ref')
            if target:texts=[m for m in texts if m['source']['ref']==target]
            complete=any(m['coverage']['status']=='complete' for m in texts)
            if not complete and texts:
                versions={(m['source']['ref'],m['source'].get('version')) for m in texts}
                totals={m['coverage']['total'] for m in texts}
                ranges=sorted((z['start'],z['end_exclusive']) for m in texts for z in m['coverage'].get('ranges',[]))
                cursor=0
                for start,end in ranges:
                    if start!=cursor or end<start:cursor=-1;break
                    cursor=end
                complete=bool(ranges) and len(versions)==1 and len(totals)==1 and None not in totals and cursor==next(iter(totals))
            if not complete:fail('COMPLETE_TARGET_NOT_READ')
        lit=r['context'].get('literary',{})
        for u in lit.get('execution_brief',{}).get('scene_units',[]):
            em=u['emotion_transition']
            if not em['pressures'] and not em.get('empty_pressures_reason'):fail('EMPTY_PRESSURES_UNEXPLAINED')
            if u['degraded'] and not u.get('degraded_reason'):fail('DEGRADED_REASON_MISSING')
        for e in lit.get('elements',[]):
            if e['plane']=='design' and e['authority']=='canon':fail('DESIGN_MASQUERADES_AS_CANON')
        records={x['ref']:x for x in case.get('canonical_fixture_records',[])}
        for cp in r['history']['checkpoints']:
            covered=set(cp['covers']['message_refs']+cp['covers']['scope_refs']+cp['covers']['turn_refs'])
            if cp['contract_state']=='proposed_scope_or_turn_coverage' and not covered<=set(records):fail('CHECKPOINT_SOURCE_NOT_FOUND')
            for ref in covered & set(records):
                if sha(records[ref]['text'])!=records[ref]['sha256']:fail('CHECKPOINT_SOURCE_BYTES_CHANGED')
            if cp['contract_state']=='current_call_id_coverage' and (not cp['covers']['call_ids'] or cp['covers']['scope_refs']):fail('CHECKPOINT_UNAPPROVED_COVERAGE')
            if set(cp['covers']['message_refs']) & set(r['history']['unresolved_question_refs']):fail('CHECKPOINT_COVERS_OPEN_OBLIGATION')
        for t in r['capabilities']['tools']:
            try:Draft202012Validator.check_schema(t['input_schema'])
            except Exception:fail('INVALID_TOOL_SCHEMA')
            if t['name'] in FORBIDDEN:fail('FORBIDDEN_TOOL_REGISTERED')
    for resp in case['responses']:
        if resp['request_id'] not in reqs:fail('RESPONSE_REQUEST_MISMATCH');continue
        r=reqs[resp['request_id']];calls=resp['output']['tool_calls'];names=[c['name'] for c in calls]
        allowed={t['name']:t for t in r['capabilities']['tools']}
        if any(n not in allowed for n in names):fail('TOOL_NOT_IN_PROFILE')
        if resp['status']=='tool_calls' and not calls:fail('TOOL_FINISH_WITHOUT_CALLS')
        if resp['status'] in ['failed','cancelled','incomplete'] and calls:fail('PARTIAL_TOOL_NOT_EXECUTABLE')
        if resp['status']=='completed' and not calls and not resp['output']['content']:fail('EMPTY_FINAL_REPLY')
        if resp['output']['content'] and re.search(r'<(?:tool_call|function=)',resp['output']['content']):fail('FAKE_TEXT_TOOL_CALL')
        if r['task']['kind']=='judgment':
            if 'agent_plan_draft' in names:
                if sorted(names)!=['agent_plan_draft','judgment_decision'] or next((c['arguments'].get('action') for c in calls if c['name']=='judgment_decision'),None)!='plan':fail('PLAN_PAIR_INVALID')
            elif len(calls)>1:fail('TOOL_COMBINATION_INVALID')
        accessible={m['material_ref'] for m in r['context']['materials'] if m['origin']!='tool_observation' and m['coverage']['status'] in ['partial','complete','truncated']}
        accessible|={m['observation_ref'] for m in r['context']['materials'] if m['origin']=='tool_observation' and m['coverage']['status'] in ['partial','complete','truncated']}
        objects={m['source']['ref'] for m in r['context']['materials']}
        for m in r['context']['materials']:
            objects|={x.get('chapter_ref') for x in m['payload'].get('items',[]) if isinstance(x,dict)}
            objects|={x.get('ref') for x in m['payload'].get('records',[]) if isinstance(x,dict)}
        for c in calls:
            cid=c['call_id'];all_calls[cid]=(r,c)
            a=c['arguments']
            if c.get('arguments_raw'):
                try:
                    if json.loads(c['arguments_raw'])!=a:fail('RAW_PARSED_ARGUMENTS_MISMATCH')
                except json.JSONDecodeError:fail('RAW_ARGUMENTS_INVALID_JSON')
            if c['name'] in allowed:
                if list(Draft202012Validator(allowed[c['name']]['input_schema']).iter_errors(a)):fail('TOOL_ARGUMENTS_SCHEMA_INVALID')
            if c['name']=='judgment_decision':
                targets=[a.get(k) for k in ['pending_artifact_ref','adopted_content_ref','character_ref'] if a.get(k)]
                if len(targets)>1:fail('MULTIPLE_EXECUTION_TARGETS')
                if a['action']=='explore' and (not a.get('explore_request') or a.get('capability') or targets):fail('ACTION_FIELD_CONFLICT')
                if a['action']=='execute' and (not a.get('capability') or a.get('explore_request')):fail('ACTION_FIELD_CONFLICT')
                if a['action']=='plan' and (a.get('capability') or a.get('explore_request') or targets):fail('ACTION_FIELD_CONFLICT')
                if a['action']=='execute' and targets and any(t not in objects for t in targets):fail('TARGET_NOT_READ_OR_SUPPLIED')
                if a['action']=='explore' and r['authority']['budget']['tool_calls_remaining']==0:fail('TOOL_BUDGET_EXHAUSTED')
            if c['name']=='report_capability_gap':
                catalog={x['name'] for x in r['capabilities']['business_operations']}
                if any(ref not in catalog for ref in a.get('alternative_operation_refs',[])):fail('INVALID_CAPABILITY_REF')
                if r['capabilities']['inventory_coverage']!='complete_for_profile' and not any(m['payload']['kind']=='capability_catalog' and m['payload']['complete_for_scope'] for m in r['context']['materials']):fail('GAP_WITHOUT_CATALOG_EVIDENCE')
            if c['name']=='register_author_content':
                originals={r['author_input']['message_ref']:r['author_input']['text']} if r.get('author_input') else {}
                originals.update({h['message_ref']:h['text'] for h in r['history']['messages'] if h['role']=='user'})
                if a['author_content_source_ref'] not in originals:fail('REGISTRATION_SOURCE_NOT_AUTHOR_TEXT')
                if a['author_content_source_ref'] not in r['context'].get('registerable_author_source_refs',[]):fail('REGISTRATION_SOURCE_NOT_ELIGIBLE')
            if c['name']=='submit_tentative_artifact':
                if any(k in item for item in a['items'] for k in SYSTEM_FIELDS):fail('MODEL_WRITES_SYSTEM_FIELDS')
                if not set(a.get('self_report',{}).get('used_context_refs',[]))<=accessible:fail('USED_REF_NOT_VISIBLE')
                if r['task']['scope'].get('modification_scope')=='target_segments':
                    targetset=set(r['task']['scope']['target_segment_ids'])
                    actual={s['segment_id'] for m in r['context']['materials'] for s in m['payload'].get('segments',[])}
                    if not targetset<=actual:fail('TARGET_SEGMENT_NOT_OBSERVED')
                    if len(a['items'])!=len(targetset):fail('TARGET_REPLACEMENT_COUNT_MISMATCH')
                if r['task']['output_contract'].get('artifact_type')=='prose_formatting_plan':
                    boundaries={b['boundary_id'] for m in r['context']['materials'] for b in m['payload'].get('line_break_boundaries',[])}
                    for item in a['items']:
                        v=Draft202012Validator({'$ref':'#/$defs/FormattingItem','$defs':SCHEMA['$defs']})
                        if list(v.iter_errors(item)):fail('FORMATTING_PLAN_INVALID')
                        for change in item.get('line_break_changes',[]):
                            if change['boundary_id'] not in boundaries:fail('UNKNOWN_FORMATTING_BOUNDARY')
            if c['name']=='report_quality_findings':
                prose=[m['payload']['text'] for m in r['context']['materials'] if m['payload']['kind']=='text']
                for f in a['findings']:
                    for span in f['evidence_spans']:
                        if not any(span['text'] in text for text in prose):fail('QUALITY_EVIDENCE_NOT_IN_TEXT')
                        if span['sentence_end']<span['sentence_start']:fail('QUALITY_SPAN_ORDER_INVALID')
        outspec=r['task']['output_contract']
        if resp['status']=='completed' and outspec['mode']=='structured_json':
            try:
                obj=json.loads(resp['output']['content'])
                v=Draft202012Validator({'$ref':outspec['payload_schema_ref'],'$defs':SCHEMA['$defs']})
                if list(v.iter_errors(obj)):fail('STRUCTURED_RESULT_INVALID')
            except Exception:fail('STRUCTURED_RESULT_INVALID')
        u=resp['usage']
        if u['measurement']=='unavailable' and any(v is not None for k,v in u.items() if k!='measurement'):fail('FAKE_USAGE_MEASUREMENT')
        if u['cached_input_tokens'] is not None and (u['input_tokens'] is None or u['cached_input_tokens']>u['input_tokens']):fail('CACHED_EXCEEDS_INPUT')
        if all(u[k] is not None for k in ['input_tokens','output_tokens','total_tokens']) and u['total_tokens']!=u['input_tokens']+u['output_tokens']:fail('USAGE_TOTAL_INCORRECT')
    seen_results=set()
    for tr in case['tool_results']:
        cid=tr['call_id']
        if cid in seen_results:fail('DUPLICATE_TOOL_RESULT')
        seen_results.add(cid)
        if cid not in all_calls:fail('ORPHAN_TOOL_RESULT');continue
        r,c=all_calls[cid]
        expected=c['arguments'].get('explore_request',{}).get('tool') if c['name']=='judgment_decision' and c['arguments'].get('action')=='explore' else c['name']
        if tr['tool_name'] not in (expected,c['name']):fail('TOOL_RESULT_NAME_MISMATCH')
        if tr['result_kind'] in ['observation','validation_result'] and tr['canon_written']:fail('READ_OR_VALIDATION_WRITES_CANON')
        for m in tr['materials']:
            if m.get('tool_call_id')!=cid:fail('OBSERVATION_CALL_MISMATCH')
    for v in case['validations']:
        if v['status']=='passed' and any(c['status'] not in ['pass','not_applicable'] for c in v['checks']):fail('VALIDATION_FALSE_PASS')
    for o in case['outcomes']:
        if o['request_id'] not in reqs or o['response_ref'] not in resps:fail('OUTCOME_CORRELATION_MISMATCH');continue
        r=reqs[o['request_id']];resp=resps[o['response_ref']]
        a=o['authorization'];c=o['canon'];exe=o['execution']
        if a['work_ref']!=r['identity'].get('work_ref'):fail('OUTCOME_CROSS_WORK')
        if a['decision'] in ['deny','require_confirmation'] and (c['changed'] is True or exe['state']=='completed'):fail('UNAUTHORIZED_EXECUTION')
        if exe['state']=='unknown' and (c['changed'] is not None or c['write_state']!='unknown' or o.get('recovery',{}).get('retry_policy')!='reconcile_before_retry'):fail('UNKNOWN_WRITE_FALSE_CERTAINTY')
        if c['changed'] is True:
            if not c['receipt_refs'] or not c['after_versions'] or exe['state']!='completed' or a['decision']!='allow' or c['write_state']!='committed':fail('CANON_WRITE_WITHOUT_RECEIPT')
            before={v['ref']:v['version'] for v in c['before_versions']}
            for v in c['after_versions']:
                if v['ref'] in before and v['version']<=before[v['ref']]:fail('CANON_VERSION_NOT_ADVANCED')
            acts=case['author_actions'];human=[x for x in acts if x['action'] in ['accept','edit_then_accept','confirm'] and x['work_ref']==a['work_ref']]
            d=r['authority'].get('delegation')
            if a.get('delegation_ref'):
                if not d or d['delegation_ref']!=a['delegation_ref'] or d['revoked'] or not d['may_adopt'] or not d['can_rollback'] or d['work_ref']!=a['work_ref']:fail('INVALID_DELEGATION')
                elif not set(a['target_refs'])<=set(d['target_refs']) or a['effect'] not in d['allowed_effects']:fail('DELEGATION_SCOPE_EXCEEDED')
                elif not(datetime.fromisoformat(d['valid_from'].replace('Z','+00:00'))<=datetime.fromisoformat(r['identity']['created_at'].replace('Z','+00:00'))<datetime.fromisoformat(d['expires_at'].replace('Z','+00:00'))):fail('DELEGATION_EXPIRED')
                if a['risk_class']=='critical':fail('CRITICAL_AUTO_ADOPTION')
            elif not human:fail('ADOPTION_WITHOUT_AUTHOR_DECISION')
            elif not any((set(a['target_refs'])<=set(h['target_refs']) or any(art['artifact_ref'] in h['target_refs'] and set(a['target_refs'])<=set(art['target_refs']) for art in o['artifacts'])) and all(hv in h['expected_versions'] for hv in a['expected_versions']) for h in human):fail('AUTHOR_DECISION_BINDING_MISMATCH')
            if a.get('delegation_ref') and d and not any(h['action']=='grant_delegation' and h.get('delegation_ref')==d['delegation_ref'] and h['action_ref']==d['source_author_action_ref'] for h in acts):fail('DELEGATION_SOURCE_MISSING')
            if r['task']['scope'].get('modification_scope')=='target_segments':
                textmat=next((m for m in r['context']['materials'] if m['payload']['kind']=='text' and m['coverage']['status']=='complete'),None)
                calls=resp['output']['tool_calls']
                if textmat and calls:
                    segs={z['segment_id']:z for z in textmat['payload'].get('segments',[])}
                    targets=r['task']['scope']['target_segment_ids'];items=calls[0]['arguments'].get('items',[])
                    if len(targets)==len(items) and all(t in segs for t in targets):
                        raw=textmat['payload']['text'].encode('utf-8')
                        for target,item in sorted(zip(targets,items),key=lambda v:segs[v[0]]['start_byte'],reverse=True):
                            z=segs[target];raw=raw[:z['start_byte']]+item['body'].encode('utf-8')+raw[z['end_byte_exclusive']:]
                        wanted=next((v.get('sha256') for v in c['after_versions'] if v['ref']==r['task']['scope']['base_ref']),None)
                        if wanted!=hashlib.sha256(raw).hexdigest():fail('APPLIED_REVISION_HASH_MISMATCH')
        for art in o['artifacts']:
            if art['status']=='ACCEPTED' and (not art.get('receipt_ref') or not c['changed']):fail('ACCEPTED_WITHOUT_COMMIT')
        bindings=o['author_visible']['model_texts']+[x['model_body'] for x in o['artifacts']]
        knownrefs={m['source']['ref'] for m in r['context']['materials']}
        knownrefs|={s['segment_id'] for m in r['context']['materials'] for s in m['payload'].get('segments',[])}
        for b in bindings:
            rr=resps.get(b['response_ref'])
            try:original=ptr(rr,b['json_pointer'])
            except (KeyError,IndexError,TypeError,ValueError):fail('NARRATIVE_SOURCE_MISSING');continue
            if original!=b['content'] or sha(b['content'])!=b['sha256']:fail('NARRATIVE_BYTES_REWRITTEN')
            if any(ref and ref in b['content'] for ref in knownrefs):fail('INTERNAL_REF_IN_AUTHOR_TEXT')
        if resp['status'] in ['incomplete','failed','cancelled'] and o['artifacts']:fail('INVALID_RESPONSE_MATERIALIZED')
    findings={f['quality_finding_id'] for p in case['responses'] for c in p['output']['tool_calls'] if c['name']=='report_quality_findings' for f in c['arguments']['findings']}
    for action in case['author_actions']:
        if action['action']=='revise_from_findings' and (not action.get('quality_finding_refs') or not set(action['quality_finding_refs'])<=findings):fail('FINDING_SELECTION_INVALID')
    byrun={}
    for e in case['events']:byrun.setdefault(e['provider_run_ref'],[]).append(e)
    for events in byrun.values():
        seq=[e['sequence'] for e in events]
        if seq!=sorted(set(seq)):fail('EVENT_SEQUENCE_INVALID')
        terminal=False
        for e in events:
            if terminal and e['event_type'] not in ['usage_recorded']:fail('EVENT_AFTER_TERMINAL')
            if e['event_type'] in ['final_output','error','cancelled']:terminal=True
            if e['event_type']=='cancelled' and not e['payload'].get('cancel_acknowledged'):fail('CANCELLATION_NOT_ACKNOWLEDGED')
    return sorted(set(errs))

def mutate(base,mutation):
    result=copy.deepcopy(base)
    parent=ptr(result,mutation['pointer'].rsplit('/',1)[0]);last=mutation['pointer'].rsplit('/',1)[1]
    key=int(last) if isinstance(parent,list) else last
    if mutation['op']=='remove':del parent[key]
    elif mutation['op']=='append':ptr(result,mutation['pointer']).append(copy.deepcopy(mutation['value']))
    else:parent[key]=copy.deepcopy(mutation['value'])
    return result

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--report',default=None);args=ap.parse_args()
    schema_reports=[]
    for p in sorted((SCHEMAS).glob('*.json')):
        try:Draft202012Validator.check_schema(json.loads(p.read_text(encoding='utf-8')));schema_reports.append({'file':str(p.relative_to(ROOT)),'status':'pass'})
        except Exception as ex:schema_reports.append({'file':str(p.relative_to(ROOT)),'status':'fail','error':str(ex)})
    positives=[];lookup={}
    for p in sorted((FIXTURES/'exchanges').glob('*.json')):
        d=json.loads(p.read_text(encoding='utf-8'));lookup[d['case_id']]=d;errors=lint(d)
        positives.append({'case_id':d['case_id'],'status':'pass' if not errors else 'fail','errors':errors})
    negatives=[]
    for p in sorted((FIXTURES/'negative').glob('*.json')):
        spec=json.loads(p.read_text(encoding='utf-8'));d=copy.deepcopy(lookup[spec['base_case']])
        for m in spec['mutations']:d=mutate(d,m)
        errors=lint(d);ok=set(spec['expected_error_codes'])<=set(errors)
        negatives.append({'case_id':spec['case_id'],'status':'pass' if ok else 'fail','expected':spec['expected_error_codes'],'actual':errors})
    report={'validation_kind':'offline_json_schema_and_synthetic_semantic_invariants','source_commit':'f13ff6406a002eff54397b906872255048c31763',
      'schemas':schema_reports,'positive_cases':positives,'negative_cases':negatives,
      'summary':{'schemas':len(schema_reports),'positive_cases':len(positives),'negative_cases':len(negatives),
       'failures':sum(x['status']=='fail' for x in schema_reports+positives+negatives)},
      'not_verified':['仓库Elixir运行时接线','真实Provider API接受度','实际数据库存在性/事务','真实Tauri页面','模型判断正确率','小说文学质量盲评','实际Token/延迟改善']}
    report_file('report.json', args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report['summary'],ensure_ascii=False))
    for x in positives+negatives:
        if x['status']=='fail':print(json.dumps(x,ensure_ascii=False))
    return 0 if not report['summary']['failures'] else 1
if __name__=='__main__':raise SystemExit(main())
