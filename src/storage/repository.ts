import {prepared,releaseStatements} from './statements.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { Ack, BeginInput, ClockSample, ContextResult, EventBatch, FileCheckpoint, NativeReporterBinding, NormalizedEvent, RunHandle, RunRef, RunState, Store, TrustedSource } from '../shared/contracts.js';
import { fail } from '../shared/errors.js';
import { validateBegin, validateEvent } from '../shared/schemas.js';
import { assertExpectedHead, assertFreshKey, createUuid7, sessionKey } from '../domain/identity.js';
import { classifyFreshness, createRunState, reduceRun } from '../domain/reducer.js';
import { openDatabase, transaction } from './database.js';
import { digest, hashBatch } from './batch.js';
import { boundedCheckpoint, saveCheckpoint, validateCursor } from './checkpoint.js';
import { advanceClock } from '../domain/clock.js';
import { refreshRemaining } from '../domain/eta.js';
import {currentEtaQuestion,invalidateEtaInquiry,refreshEtaInquiry} from '../domain/eta-inquiry.js';
type RunRow = {
  run_id: string; generation: number; owner_connector: string; source_id: string;
  provider: string; session_key: string | null; resume_hash: string; state_json: string;
};
type Receipt = { body_hash: string; ack_json: string };
type BeginReceipt = { body_hash: string; handle_json: string };
const terminal = new Set(['reported_done', 'verified_done', 'failed', 'cancelled']);
function rowById(db: DatabaseSync, id: string): RunRow {
  const row = prepared(db,'SELECT * FROM runs WHERE run_id=?').get(id);
  if (!row) fail('RUN_GONE', 410);
  return row as unknown as RunRow;
}
function authorize(row: RunRow, handle: RunHandle, source: TrustedSource): void {
  if (row.owner_connector !== source.connectorId) fail('FORBIDDEN', 403);
  if (row.generation !== handle.generation) fail('RUN_MISMATCH');
  const expected = Buffer.from(row.resume_hash, 'hex'), actual = Buffer.from(digest(handle.resumeHandle), 'hex');
  if (!timingSafeEqual(expected, actual)) fail('FORBIDDEN', 403);
}
function headFor(db: DatabaseSync, key: string | null): RunRef | null {
  if (!key) return null;
  const row = prepared(db,'SELECT run_id,generation FROM source_bindings WHERE session_key=?').get(key);
  return row ? { runId: String(row.run_id), generation: Number(row.generation) } : null;
}
function sequence(db: DatabaseSync, runId: string, sourceId: string): number {
  return Number(prepared(db,'SELECT seq FROM source_sequences WHERE run_id=? AND source_id=?').get(runId, sourceId)?.seq || 0);
}
function saveSequence(db: DatabaseSync, runId: string, sourceId: string, seq: number): void {
  prepared(db,'INSERT INTO source_sequences VALUES(?,?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET seq=excluded.seq').run(runId, sourceId, seq);
}
function callKey(event: NormalizedEvent): string | null {
  return event.nativeCallId && event.nativeSessionId ? digest([event.provider, event.nativeSessionId, event.nativeCallId, event.payload.type]) : null;
}
function saveEvent(db: DatabaseSync, event: NormalizedEvent): void {
  prepared(db,'INSERT INTO events VALUES(?,?,?,?,?,?,?)').run(event.eventId, event.run.runId, event.sourceInstanceId, event.seq, event.eventIndex, callKey(event), JSON.stringify(event));
}
function withEvidence(event: NormalizedEvent, source: TrustedSource): NormalizedEvent {
  const copy = structuredClone(event);
  const evidence = source.kind === 'reporter' ? 'declared' as const : 'observed' as const;
  if (copy.payload.type === 'plan.replaced') copy.payload.plan.steps.forEach((s) => { s.evidence = evidence; });
  if (copy.payload.type === 'step.updated') copy.payload.step.evidence = evidence;
  return copy;
}
export async function openStore(dbPath: string, clock: () => ClockSample): Promise<Store> {
  const db = openDatabase(dbPath);
  let closed = false;
  let pressure = false;
  try {
    transaction(db, () => {
      for (const raw of prepared(db,'SELECT run_id,state_json FROM runs').all()) {
        const state = JSON.parse(String(raw.state_json)) as RunState;
        if (terminal.has(state.snapshot.status)) continue;
        if(!state.timing.retainedEta&&state.snapshot.eta.range&&state.snapshot.eta.basis!=='unknown')state.timing.retainedEta={range:{...state.snapshot.eta.range},anchorActiveMs:state.timing.taskActiveMs||0,basis:state.snapshot.eta.basis};
        if (state.snapshot.status === 'active'&&state.snapshot.scope!=='turn'){state.snapshot.status='paused';state.recoveryPaused=true;}
        state.lastClock = null; state.timing.continuous = false;
        invalidateEtaInquiry(state);
        for (const anchor of Object.values(state.timing.estimateAnchors)) anchor.continuous = false;
        if(state.timing.agentEstimate)state.timing.agentEstimate.continuous=false;
        refreshRemaining(state,clock().wallMs);
        prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state), String(raw.run_id));
      }
    });
  } catch (error) { releaseStatements(db); db.close(); throw error; }
  const ensureOpen = () => { if (closed) fail('STORE_CLOSED', 503); };
  const effectiveSize=()=> (Number(prepared(db,'PRAGMA page_count').get()!.page_count)-Number(prepared(db,'PRAGMA freelist_count').get()!.freelist_count))*Number(prepared(db,'PRAGMA page_size').get()!.page_size);
  const ensureBudget=()=>{if(effectiveSize()>104857600){pressure=true;fail('STORAGE_PRESSURE',503);}};
  function linkedActivity(event:NormalizedEvent, target:RunRef):void {
    if(event.payload.type!=='activity.updated')return;
    const row=rowById(db,target.runId),state=JSON.parse(row.state_json) as RunState;
    if(state.snapshot.scope!=='task'||terminal.has(state.snapshot.status)||row.generation!==target.generation)return;
    const changed=reduceRun(state,{...event,provider:state.snapshot.provider,run:{runId:target.runId,generation:target.generation}},clock());
    changed.snapshot.nativeActivity={...(changed.snapshot.nativeActivity??{lastEventAt:event.receivedAt,inFlight:false}),action:event.payload.activity};
    if(state.snapshot.activity&&state.snapshot.activitySource?.kind==='reporter'){changed.snapshot.activity=state.snapshot.activity;changed.snapshot.activitySource={...state.snapshot.activitySource};}
    else changed.snapshot.activitySource={provider:event.provider,kind:event.sourceKind};
    prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(changed),target.runId);
  }
  function bindObservedReporter(binding:NativeReporterBinding,source:TrustedSource):void {
    if(!source.nativeSessionId||!binding.turnId||!Number.isSafeInteger(binding.run.generation))return;
    if(binding.receipt){
      const claim=prepared(db,'SELECT * FROM native_binding_receipts WHERE token_hash=?').get(digest(binding.receipt));
      if(!claim||source.kind!=='transcript'||Number(claim.expires_at)<=clock().wallMs||claim.run_id!==binding.run.runId||claim.generation!==binding.run.generation||claim.provider!==source.provider||claim.session_id!==source.nativeSessionId||claim.turn_id!==binding.turnId||claim.item_id&&claim.item_id!==binding.nativeItemId||claim.call_id&&claim.call_id!==binding.nativeCallId)return;
    }
    const row=prepared(db,'SELECT * FROM runs WHERE run_id=?').get(binding.run.runId) as RunRow|undefined;
    if(!row||row.provider!==source.provider||row.generation!==binding.run.generation)return;
    const state=JSON.parse(row.state_json) as RunState;
    if(state.snapshot.scope!=='task'||terminal.has(state.snapshot.status))return;
    const trace=prepared(db,'SELECT run_id FROM native_runs WHERE session_key=? AND turn_id=?').get(sessionKey(source),binding.turnId);
    if(!trace)return;
    // Observed public references cannot steal another session's task or
    // override a manual link. No matching by title, cwd or relative recency.
    const links=prepared(db,'SELECT provider,session_id,run_id FROM source_links WHERE run_id=? OR (provider=? AND session_id=? AND turn_id=?)').all(row.run_id,source.provider,source.nativeSessionId,binding.turnId);
    if(links.some(link=>link.run_id!==row.run_id||link.provider!==source.provider||link.session_id!==source.nativeSessionId))return;
    prepared(db,'INSERT OR IGNORE INTO source_links VALUES(?,?,?,?,?)').run(source.provider,source.nativeSessionId,binding.turnId,row.run_id,row.generation);
    const latest=prepared(db,"SELECT event_json FROM events WHERE run_id=? AND json_extract(event_json,'$.payload.type')='activity.updated' ORDER BY rowid DESC LIMIT 1").get(String(trace.run_id));
    if(latest)linkedActivity(JSON.parse(String(latest.event_json)) as NormalizedEvent,binding.run);
  }
  function commitBatch(batch: EventBatch, source: TrustedSource): Ack {
      ensureOpen();
      if (batch.events.length > 20) fail('INVALID_BATCH', 400);
      const now = clock();
      if (batch.receipt) assertFreshKey(batch.receipt.reportId, now.wallMs);
      const bodyHash = hashBatch(batch);
      if (batch.receipt && batch.receipt.bodyHash !== bodyHash) fail('BODY_HASH_MISMATCH', 400);
      const parserCheckpoint = boundedCheckpoint(batch);
      if (batch.cursor) validateCursor(batch.cursor);
      if (!batch.events.length) {
        if (source.kind !== 'transcript' || !source.nativeSessionId || batch.receipt || batch.handle) fail('FORBIDDEN', 403);
        if (!batch.cursor) fail('INVALID_BATCH', 400);
        return transaction(db, () => {
          saveCheckpoint(db, batch, parserCheckpoint);
          ensureBudget();
          const head = headFor(db, sessionKey(source));
          return { accepted: true, duplicate: false, nextSeq: head ? sequence(db, head.runId, source.sourceInstanceId) + 1 : 1 };
        });
      }
      return transaction(db, () => {
        const first = batch.events[0]!;
        const row = rowById(db, first.run.runId);
        if (row.provider !== source.provider) fail('FORBIDDEN', 403);
        const localVerification = source.canVerify === true && batch.events.every((e) => e.payload.type === 'completion.verified');
        if (source.kind === 'reporter' && !localVerification) {
          if (!batch.handle) fail('HANDLE_REQUIRED', 403);
          authorize(row, batch.handle, source);
          if (batch.handle.runId !== row.run_id) fail('RUN_MISMATCH');
        } else if (!localVerification && (!source.nativeSessionId || sessionKey(source) !== row.session_key)) fail('FORBIDDEN', 403);
        if (batch.events.some((e) => e.payload.type === 'completion.verified') && !localVerification) fail('FORBIDDEN', 403);
        if(batch.events.some(e=>e.payload.type==='source.diagnostic')&&source.kind!=='transcript')fail('FORBIDDEN',403);
        const sourceId = source.kind === 'reporter' && !localVerification ? row.source_id : source.sourceInstanceId;
        if (batch.receipt) {
          const receipt = prepared(db,'SELECT body_hash,ack_json FROM report_receipts WHERE connector_id=? AND report_id=?').get(source.connectorId, batch.receipt.reportId) as Receipt | undefined;
          if (receipt) {
            if (receipt.body_hash !== bodyHash) fail('IDEMPOTENCY_CONFLICT');
            return { ...(JSON.parse(receipt.ack_json) as Ack), duplicate: true };
          }
        }
        const events = batch.events.map((raw, i) => {
          if (raw.run.runId !== row.run_id || raw.run.generation !== row.generation || raw.provider !== source.provider) fail('RUN_MISMATCH');
          if (raw.sourceKind !== source.kind || raw.seq !== first.seq || raw.eventIndex !== i) fail('INVALID_BATCH', 400);
          if (raw.nativeSessionId && raw.nativeSessionId !== source.nativeSessionId) fail('FORBIDDEN', 403);
          return validateEvent(withEvidence({ ...raw, sourceInstanceId: sourceId, receivedAt: now.wallMs,
            ...(source.nativeSessionId ? { nativeSessionId: source.nativeSessionId } : {}) }, source));
        });
        const seen = events.map((e) => {
          const sameId = prepared(db,'SELECT event_json FROM events WHERE event_id=?').get(e.eventId);
          if (sameId) {
            const previous = JSON.parse(String(sameId.event_json)) as NormalizedEvent;
            if (hashBatch({ events: [previous] }) !== hashBatch({ events: [e] })) fail('EVENT_ID_CONFLICT');
            return true;
          }
          return callKey(e) !== null && prepared(db,'SELECT event_id FROM events WHERE call_key=?').get(callKey(e)) !== undefined;
        });
        if (seen.every(Boolean)) {
          saveCheckpoint(db, batch, parserCheckpoint);
          const ack: Ack = { accepted: true, duplicate: true, nextSeq: sequence(db, row.run_id, sourceId) + 1 };
          if (batch.receipt) prepared(db,'INSERT INTO report_receipts VALUES(?,?,?,?,?,?)').run(source.connectorId, batch.receipt.reportId, row.run_id, bodyHash, JSON.stringify(ack), now.wallMs);
          return ack;
        }
        if (seen.some(Boolean)) fail('PARTIAL_DUPLICATE_BATCH');
        if (pressure) fail('STORAGE_PRESSURE',503);
        const highest = sequence(db, row.run_id, sourceId);
        if (first.seq <= highest) fail('STALE_SEQUENCE');
        if (source.kind === 'reporter' && !localVerification && first.seq !== highest + 1) fail('SEQUENCE_GAP');
        let state = JSON.parse(row.state_json) as RunState;
        // Only an authenticated original reporter's meaningful work resumes a
        // restart pause. ETA/context/native observation cannot undo user waits.
        if(state.recoveryPaused&&source.kind==='reporter'&&events.some(e=>['activity.updated','plan.replaced','step.updated'].includes(e.payload.type))&&!events.some(e=>e.payload.type==='run.status')){
          state.snapshot.status='active';state.lastClock={...now};delete state.recoveryPaused;
        }
        for (const event of events) {
          // Native revisions belong to their file parser; the task revision must survive rotation.
          const applied=event.sourceKind==='transcript'&&event.payload.type==='plan.replaced'?{...event,payload:{...event.payload,plan:{...event.payload.plan,revision:(state.snapshot.plan?.revision||0)+1}}}:event;
          state = reduceRun(state, applied, now); saveEvent(db, event);
          if(['run.status','completion.reported','completion.verified'].includes(event.payload.type))delete state.recoveryPaused;
        }
        refreshEtaInquiry(state,now.wallMs);
        prepared(db,'UPDATE runs SET state_json=?,updated_at=?,terminal_at=CASE WHEN ? THEN COALESCE(terminal_at,?) ELSE terminal_at END WHERE run_id=?')
          .run(JSON.stringify(state), now.wallMs, terminal.has(state.snapshot.status) ? 1 : 0, now.wallMs, row.run_id);
        saveSequence(db, row.run_id, sourceId, first.seq);
        for(const event of events)if(event.nativeSessionId&&event.turnId&&event.sourceKind!=='reporter'){
          const links=prepared(db,'SELECT run_id,generation FROM source_links WHERE provider=? AND session_id=? AND turn_id=?').all(event.provider,event.nativeSessionId,event.turnId);
          for(const link of links)linkedActivity(event,{runId:String(link.run_id),generation:Number(link.generation)});
        }
        saveCheckpoint(db, batch, parserCheckpoint);
        const ack: Ack = { accepted: true, duplicate: false, nextSeq: first.seq + 1,...(state.snapshot.etaWarning?{warnings:[state.snapshot.etaWarning]}:{}) };
        if (batch.receipt) prepared(db,'INSERT INTO report_receipts VALUES(?,?,?,?,?,?)').run(source.connectorId, batch.receipt.reportId, row.run_id, bodyHash, JSON.stringify(ack), now.wallMs);
        ensureBudget();
        return ack;
      });
  }
  const store: Store = {
    async prepareBinding(handle,context,source){
      ensureOpen();const row=rowById(db,handle.runId);if(source.kind!=='reporter')fail('FORBIDDEN',403);authorize(row,handle,source);
      const state=JSON.parse(row.state_json) as RunState;if(state.snapshot.scope!=='task'||terminal.has(state.snapshot.status))fail('INVALID_TARGET');
      const valid=(v:unknown)=>typeof v==='string'&&v.length>0&&v.length<=256&&[...v].every(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127);
      if(!valid(context.sessionId)||!valid(context.turnId)||!context.itemId&&!context.callId||context.itemId!==undefined&&!valid(context.itemId)||context.callId!==undefined&&!valid(context.callId))fail('INVALID_BINDING_CONTEXT',400);
      return transaction(db,()=>{const now=clock().wallMs;prepared(db,'DELETE FROM native_binding_receipts WHERE token_hash IN (SELECT token_hash FROM native_binding_receipts WHERE expires_at<? LIMIT 500)').run(now);if(Number(prepared(db,'SELECT count(*) AS n FROM native_binding_receipts').get()!.n)>=512)fail('BINDING_QUEUE_FULL',503);
        const token=randomBytes(32).toString('hex');prepared(db,'INSERT INTO native_binding_receipts VALUES(?,?,?,?,?,?,?,?,?)').run(digest(token),handle.runId,handle.generation,source.provider,context.sessionId,context.turnId,context.itemId??null,context.callId??null,now+600000);return {run:{runId:handle.runId,generation:handle.generation},token};});
    },
    async takeEtaQuestion(source,turnId){
      ensureOpen();if(source.kind!=='hook'||!source.nativeSessionId)return null;
      return transaction(db,()=>{
        const link=prepared(db,'SELECT run_id,generation FROM source_links WHERE provider=? AND session_id=? AND turn_id=?').get(source.provider,source.nativeSessionId!,turnId);
        if(!link)return null;
        const row=rowById(db,String(link.run_id)),state=JSON.parse(row.state_json) as RunState;
        if(row.generation!==link.generation)return null;
        const q=currentEtaQuestion(state,clock().wallMs);
        if(!q||state.etaInquiry!.hookDelivered)return null;
        state.etaInquiry!.hookDelivered=true;
        state.snapshot.etaInquiry={...state.snapshot.etaInquiry,state:'sent',channel:'hook',requestedAt:q.requestedAt};
        prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state),row.run_id);
        return q;
      });
    },
    async nativeTurnForCall(source,callId){
      ensureOpen();if(!source.nativeSessionId||source.kind==='reporter')return null;
      const rows=prepared(db,"SELECT DISTINCT json_extract(event_json,'$.turnId') AS turn_id FROM events WHERE json_extract(event_json,'$.provider')=? AND json_extract(event_json,'$.nativeSessionId')=? AND json_extract(event_json,'$.nativeCallId') IN (?,?) AND json_extract(event_json,'$.sourceKind')='transcript' LIMIT 2").all(source.provider,source.nativeSessionId,callId,callId+':end');
      return rows.length===1&&typeof rows[0]!.turn_id==='string'?rows[0]!.turn_id:null;
    },
    async verify(run){
      const row=rowById(db,run.runId);if(row.generation!==run.generation)fail('RUN_MISMATCH');
      const source:TrustedSource={connectorId:'local-ui',sourceInstanceId:'local-ui',provider:row.provider as TrustedSource['provider'],kind:'reporter',canVerify:true};
      commitBatch({events:[{schemaVersion:1,eventId:'verification:'+run.runId,provider:source.provider,sourceKind:'reporter',sourceInstanceId:source.sourceInstanceId,run:{runId:run.runId,generation:run.generation},seq:sequence(db,run.runId,source.sourceInstanceId)+1,eventIndex:0,occurredAt:clock().wallMs,receivedAt:clock().wallMs,payload:{type:'completion.verified',summary:'用户确认验收通过',evidenceRef:'local-user-click'}}]},source);
    },
    async maintenance(){
      ensureOpen();let deletedRows=0;const now=clock().wallMs;
      transaction(db,()=>{
        const removed=prepared(db,'DELETE FROM events WHERE rowid IN (SELECT e.rowid FROM events e JOIN runs r ON e.run_id=r.run_id WHERE r.terminal_at IS NOT NULL AND r.terminal_at<? LIMIT 500)').run(now-7*86400000);deletedRows+=Number(removed.changes);
        // Control records are never evicted for the space budget; terminal runs live for 30 days.
        const expired=prepared(db,'SELECT run_id FROM runs WHERE terminal_at IS NOT NULL AND terminal_at<? LIMIT 50').all(now-30*86400000);
        for(const row of expired){const id=String(row.run_id);
          const tables=['events','report_receipts','source_sequences','native_runs','source_links','source_bindings'];
          for(const table of tables){if(deletedRows>=500)break;deletedRows+=Number(prepared(db,`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE run_id=? LIMIT ?)`).run(id,500-deletedRows).changes);}
          const remaining=tables.reduce((n,table)=>n+Number(prepared(db,`SELECT count(*) AS n FROM ${table} WHERE run_id=?`).get(id)!.n),0);
          if(!remaining&&deletedRows<500)deletedRows+=Number(prepared(db,'DELETE FROM runs WHERE run_id=?').run(id).changes);
        }
        const remaining=500-deletedRows;if(remaining>0)deletedRows+=Number(prepared(db,"DELETE FROM begin_receipts WHERE rowid IN (SELECT b.rowid FROM begin_receipts b LEFT JOIN runs r ON json_extract(b.handle_json,'$.runId')=r.run_id WHERE r.run_id IS NULL AND b.issued_at<? LIMIT ?)").run(now-86700000,remaining).changes);
      });
      const effectiveBytes=effectiveSize();
      pressure=effectiveBytes>104857600;
      try{if(dbPath!==':memory:'&&statSync(dbPath+'-wal').size>8388608)db.exec('PRAGMA wal_checkpoint(PASSIVE)');}catch{/* WAL can disappear between size check and checkpoint. */}
      return {deletedRows,effectiveBytes,pressure};
    },
    async nativeSources(){
      ensureOpen();return prepared(db,'SELECT n.*,r.state_json FROM native_runs n JOIN runs r ON n.run_id=r.run_id ORDER BY r.updated_at DESC LIMIT 100').all().flatMap(row=>{
        const started=prepared(db,'SELECT event_json FROM events WHERE run_id=? ORDER BY seq,event_index LIMIT 1').get(String(row.run_id));
        if(!started)return [];const e=JSON.parse(String(started.event_json)) as NormalizedEvent;
        return e.nativeSessionId?[{run:(JSON.parse(String(row.state_json)) as RunState).snapshot.run,provider:e.provider,nativeSessionId:e.nativeSessionId,turnId:String(row.turn_id),completeReplay:row.complete_replay===1}]:[];
      });
    },
    async linkNative(target,native,turnIds,remove=false){
      ensureOpen();if(!Array.isArray(turnIds)||!turnIds.length||turnIds.length>20||turnIds.some(t=>typeof t!=='string'||!t||t.length>256))fail('INVALID_SCOPE',400);
      transaction(db,()=>{
        const row=rowById(db,target.runId),state=JSON.parse(row.state_json) as RunState;
        if(row.generation!==target.generation||state.snapshot.scope!=='task'||terminal.has(state.snapshot.status))fail('INVALID_TARGET');
        const key=sessionKey({...native,connectorId:'local',sourceInstanceId:'local',kind:'transcript'});
        for(const turn of turnIds){
          if(remove){prepared(db,'DELETE FROM source_links WHERE provider=? AND session_id=? AND turn_id=? AND run_id=?').run(native.provider,native.nativeSessionId,turn,target.runId);continue;}
          const trace=prepared(db,'SELECT * FROM native_runs WHERE session_key=? AND turn_id=?').get(key,turn);
          if(!trace||trace.complete_replay!==1)fail('REPLAY_UNAVAILABLE');
          const old=prepared(db,'SELECT run_id FROM source_links WHERE provider=? AND session_id=? AND turn_id=?').get(native.provider,native.nativeSessionId,turn);
          if(old&&old.run_id!==target.runId)fail('SOURCE_ALREADY_LINKED');
          const records=prepared(db,'SELECT event_json FROM events WHERE run_id=? ORDER BY rowid').all(String(trace.run_id));
          if(!records.some(r=>(JSON.parse(String(r.event_json)) as NormalizedEvent).payload.type==='run.started'))fail('REPLAY_UNAVAILABLE');
          prepared(db,'INSERT OR REPLACE INTO source_links VALUES(?,?,?,?,?)').run(native.provider,native.nativeSessionId,turn,target.runId,target.generation);
          for(const r of records)linkedActivity(JSON.parse(String(r.event_json)) as NormalizedEvent,target);
        }
        if(remove){
          const own=prepared(db,'SELECT event_json FROM events WHERE run_id=? ORDER BY rowid').all(target.runId).map(r=>JSON.parse(String(r.event_json)) as NormalizedEvent).filter(e=>e.sourceKind==='reporter');
          invalidateEtaInquiry(state);refreshEtaInquiry(state,clock().wallMs);
          const action=own.filter(e=>e.payload.type==='activity.updated').at(-1);
          state.snapshot.activity=action?.payload.type==='activity.updated'?action.payload.activity:null;delete state.snapshot.activitySource;
          state.snapshot.lastWorkAt=Math.max(...own.filter(e=>e.payload.type!=='eta.answered').map(e=>e.receivedAt));
          prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state),target.runId);
          const remaining=prepared(db,'SELECT provider,session_id,turn_id FROM source_links WHERE run_id=?').all(target.runId);
          for(const link of remaining){const records=prepared(db,'SELECT event_json FROM events WHERE json_extract(event_json,\'$.provider\')=? AND json_extract(event_json,\'$.nativeSessionId\')=? AND json_extract(event_json,\'$.turnId\')=? ORDER BY rowid').all(link.provider!,link.session_id!,link.turn_id!);for(const r of records)linkedActivity(JSON.parse(String(r.event_json)),target);}
        }
      });
    },
    async tick() {
      ensureOpen(); const now=clock();
      transaction(db,()=>{for(const row of prepared(db,'SELECT run_id,state_json FROM runs WHERE terminal_at IS NULL').all()){
        const state=JSON.parse(String(row.state_json)) as RunState;state.timing=advanceClock(state,now);state.lastClock=now;
        refreshEtaInquiry(state,now.wallMs);
        state.snapshot.freshness=classifyFreshness(state.snapshot.lastWorkAt,now.wallMs);refreshRemaining(state,now.wallMs);
        prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state),String(row.run_id));
      }});
    },
    async resolveNative(source, turnId) {
      ensureOpen();
      const nativeKey = sessionKey(source);
      if (!nativeKey || source.kind === 'reporter' || !turnId || turnId.length > 256) fail('INVALID_NATIVE_SOURCE', 400);
      const existing = prepared(db,'SELECT handle_json FROM native_runs WHERE session_key=? AND turn_id=?').get(nativeKey, turnId);
      if (existing) {
        if(source.nativeReplayComplete===false)prepared(db,'UPDATE native_runs SET complete_replay=0 WHERE session_key=? AND turn_id=?').run(nativeKey,turnId);
        const handle=JSON.parse(String(existing.handle_json)) as RunHandle,row=rowById(db,handle.runId),state=JSON.parse(row.state_json) as RunState;
        const session={id:source.nativeSessionId!,turnId,...(source.nativeProject?{project:source.nativeProject}:{}),...(source.nativeSessionName?{name:source.nativeSessionName}:state.snapshot.nativeSession?.name?{name:state.snapshot.nativeSession.name}:{})};
        if(JSON.stringify(state.snapshot.nativeSession)!==JSON.stringify(session)){state.snapshot.nativeSession=session;state.snapshot.nativeActivity??={lastEventAt:0,inFlight:false};prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(state),handle.runId);}
        return handle;
      }
      return store.begin({idempotencyKey:createUuid7(clock().wallMs),title:`${source.provider === 'codex' ? 'Codex' : 'Claude'} · ${source.nativeProject||'会话'} · ${source.nativeSessionId!.slice(-8)}`,expectedRun:headFor(db,nativeKey)}, {...source,nativeTurnId:turnId});
    },
    async begin(raw: BeginInput, source: TrustedSource): Promise<RunHandle> {
      ensureOpen();
      const now = clock();
      const input = validateBegin(raw, now.wallMs);
      const nativeKey = sessionKey(source);
      const bodyHash = digest({ input, provider: source.provider, sourceKind: source.kind, nativeKey });
      return transaction(db, () => {
        const receipt = prepared(db,'SELECT body_hash,handle_json FROM begin_receipts WHERE connector_id=? AND idempotency_key=?').get(source.connectorId, input.idempotencyKey) as BeginReceipt | undefined;
        if (receipt) {
          if (receipt.body_hash !== bodyHash) fail('IDEMPOTENCY_CONFLICT');
          return JSON.parse(receipt.handle_json) as RunHandle;
        }
        if (pressure) fail('STORAGE_PRESSURE',503);
        const head = headFor(db, nativeKey);
        if (nativeKey) assertExpectedHead(head, input.expectedRun);
        if (nativeKey && source.nativeTurnId) {
          const existing = prepared(db,'SELECT handle_json FROM native_runs WHERE session_key=? AND turn_id=?').get(nativeKey, source.nativeTurnId);
          if (existing) return JSON.parse(String(existing.handle_json)) as RunHandle;
          if (head) {
            const oldRow = rowById(db, head.runId), previous = JSON.parse(oldRow.state_json) as RunState;
            if (previous.snapshot.scope === 'turn' && previous.snapshot.status === 'active') {
              previous.snapshot.status = 'paused';
              prepared(db,'UPDATE runs SET state_json=? WHERE run_id=?').run(JSON.stringify(previous),head.runId);
            }
          }
        }
        const handle: RunHandle = { runId: createUuid7(now.wallMs), generation: head ? head.generation + 1 : 1, resumeHandle: randomBytes(32).toString('base64url') };
        const sourceId = source.kind === 'reporter' ? 'stream:' + createUuid7(now.wallMs) : source.sourceInstanceId;
        const started: NormalizedEvent = {
          schemaVersion: 1, eventId: 'begin:' + handle.runId, provider: source.provider, sourceKind: source.kind,
          sourceInstanceId: sourceId, seq: 1, eventIndex: 0, run: { runId: handle.runId, generation: handle.generation },
          occurredAt: source.kind==='reporter'?now.wallMs:source.nativeObservedAt??now.wallMs, receivedAt: now.wallMs, payload: { type: 'run.started', title: input.title, scope: source.kind === 'reporter' ? 'task' : 'turn' },
          ...(source.nativeSessionId ? { nativeSessionId: source.nativeSessionId } : {}),
          ...(source.nativeTurnId ? {turnId:source.nativeTurnId} : {}),
        };
        let state = createRunState(started, now);
        if(state.snapshot.nativeSession){if(source.nativeProject)state.snapshot.nativeSession.project=source.nativeProject;if(source.nativeSessionName)state.snapshot.nativeSession.name=source.nativeSessionName;}
        const events = [started];
        if (input.plan) {
          const planEvent = withEvidence({ ...started, eventId: 'begin-plan:' + handle.runId, eventIndex: 1, payload: { type: 'plan.replaced', plan: input.plan } }, source);
          state = reduceRun(state, planEvent, now); events.push(planEvent);
        }
        refreshEtaInquiry(state,now.wallMs);
        prepared(db,'INSERT INTO runs(run_id,generation,owner_connector,source_id,provider,session_key,resume_hash,state_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(handle.runId, handle.generation, source.connectorId, sourceId, source.provider, nativeKey, digest(handle.resumeHandle), JSON.stringify(state), now.wallMs);
        for (const event of events) saveEvent(db, event);
        saveSequence(db, handle.runId, sourceId, 1);
        if (nativeKey) prepared(db,'INSERT INTO source_bindings VALUES(?,?,?) ON CONFLICT(session_key) DO UPDATE SET run_id=excluded.run_id,generation=excluded.generation').run(nativeKey, handle.runId, handle.generation);
        if (nativeKey && source.nativeTurnId) prepared(db,'INSERT INTO native_runs VALUES(?,?,?,?,?)').run(nativeKey,source.nativeTurnId,handle.runId,JSON.stringify(handle),source.nativeReplayComplete===false?0:1);
        prepared(db,'INSERT INTO begin_receipts VALUES(?,?,?,?,?)').run(source.connectorId, input.idempotencyKey, bodyHash, JSON.stringify(handle), now.wallMs);
        ensureBudget();
        return handle;
      });
    },
    async context(handle: RunHandle, source: TrustedSource): Promise<ContextResult> {
      ensureOpen();
      const row = rowById(db, handle.runId);
      if(source.kind!=='reporter'&&source.nativeSessionId&&sessionKey(source)===row.session_key)authorize(row,handle,{...source,connectorId:row.owner_connector});
      else authorize(row, handle, source);
      const state = JSON.parse(row.state_json) as RunState;
      state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock().wallMs);
      const etaQuestion=source.kind==='reporter'?currentEtaQuestion(state,clock().wallMs):undefined;
      const etaUpdate=source.kind==='reporter'&&state.snapshot.status==='active'?state.etaInquiry?.update:undefined;
      return { snapshot: state.snapshot, nextSeq: sequence(db, row.run_id, source.kind === 'reporter' ? row.source_id : source.sourceInstanceId) + 1, sessionHead: headFor(db, row.session_key),...(etaQuestion?{etaQuestion}:{}),...(etaUpdate?{etaUpdate}:{}) };
    },
    async commit(batch, source) { return commitBatch(batch, source); },
    async commitNative(batches, checkpoint, source,bindings=[]) {
      if (source.kind !== 'transcript') fail('FORBIDDEN',403);
      transaction(db, () => { for (const batch of batches) commitBatch(batch, source);for(const binding of bindings.slice(0,100))bindObservedReporter(binding,source);commitBatch(checkpoint,source); });
    },
    async checkpoint(pathKey: string): Promise<FileCheckpoint | null> {
      ensureOpen();
      const cursor = prepared(db,'SELECT * FROM file_cursors WHERE path_key=?').get(pathKey);
      if (!cursor) return null;
      const parser = prepared(db,'SELECT state_json FROM parser_checkpoints WHERE path_key=?').get(pathKey);
      return { cursor: { pathKey, fileGeneration: String(cursor.file_generation), committedOffset: Number(cursor.committed_offset), pendingBytes: new Uint8Array(cursor.pending_bytes as Uint8Array),...(cursor.fingerprint?{fingerprint:String(cursor.fingerprint)}:{}) },
        parserCheckpoint: parser ? JSON.parse(String(parser.state_json)) as FileCheckpoint['parserCheckpoint'] : null };
    },
    async listSnapshots() {
      ensureOpen();
      const snapshots=prepared(db,'SELECT state_json FROM runs ORDER BY updated_at DESC,run_id').all().map((row) => {
        const state = JSON.parse(String(row.state_json)) as RunState;
        state.snapshot.freshness = classifyFreshness(state.snapshot.lastWorkAt, clock().wallMs);
        return state.snapshot;
      });
      const native=new Map(snapshots.filter(s=>s.nativeSession).map(s=>[JSON.stringify([s.provider,s.nativeSession!.id,s.nativeSession!.turnId]),s.run]));
      const byRun=new Map(snapshots.map(s=>[s.run.runId,s]));
      for(const link of prepared(db,'SELECT provider,session_id,turn_id,run_id FROM source_links').all()){
        const target=byRun.get(String(link.run_id)),run=native.get(JSON.stringify([link.provider,link.session_id,link.turn_id]));
        if(target&&run&&(!target.linkedNativeRun||run.generation>target.linkedNativeRun.generation))target.linkedNativeRun=run;
      }
      return snapshots;
    },
    async close() { if (!closed) { closed = true; releaseStatements(db); db.close(); } },
  };
  return store;
}
