import type { EventBatch, EventPayload, RunHandle, TrustedSource } from '../shared/contracts.js';
import { validateReport, validateFinish } from '../shared/schemas.js';
import { hashBatch } from '../storage/batch.js';
export function normalizeReport(body:unknown, source:TrustedSource, now:number, finish=false):EventBatch {
  const input=finish?validateFinish(body,now):validateReport(body,now);
  const changes:EventPayload[]='changes' in input?input.changes:[{type:'completion.reported',summary:input.summary}];
  return reportBatch(input.handle,input.reportId,input.seq,changes,source,now);
}
export function reportBatch(handle:RunHandle,reportId:string,seq:number,changes:EventPayload[],source:TrustedSource,now:number):EventBatch {
  const batch:EventBatch={handle,events:changes.map((payload,eventIndex)=>({schemaVersion:1,eventId:`report:${reportId}:${eventIndex}`,provider:source.provider,sourceKind:source.kind,sourceInstanceId:source.sourceInstanceId,run:{runId:handle.runId,generation:handle.generation},seq,eventIndex,occurredAt:now,receivedAt:now,payload}))};
  batch.receipt={reportId,bodyHash:hashBatch(batch)};return batch;
}
