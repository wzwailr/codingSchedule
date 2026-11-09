export type ProviderId = 'codex' | 'claude' | 'generic';
export type SourceKind = 'transcript' | 'hook' | 'reporter';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type RunStatus = 'active' | 'waiting' | 'blocked' | 'paused' | 'reported_done' | 'verified_done' | 'failed' | 'cancelled';
export type EvidenceKind = 'declared' | 'observed' | 'verified';
export type Freshness = 'fresh' | 'aging' | 'stale';
export type RunRef = { runId: string; generation: number };
export type NativeReporterBinding = {run:RunRef;turnId:string;receipt?:string;nativeItemId?:string;nativeCallId?:string};
export type NativeBindingContext={sessionId:string;turnId:string;itemId?:string;callId?:string};
export type BindingReceipt={run:RunRef;token:string};
export type RunHandle = RunRef & { resumeHandle: string };
export type Estimate = { minSec: number; maxSec: number };
export type EtaQuestion = { requestId:string; run:RunRef; planRevision:number; requestedAt:number; expiresAt:number };
export type EtaAnswer = { type:'eta.answered';requestId:string;planRevision:number;range:Estimate|null;reason:string };
export type Step = {
  id: string; title: string; weight: 1 | 2 | 3; status: StepStatus;
  quantity?: { done: number; total: number };
  estimate?: Estimate & { version: number }; evidence: EvidenceKind;
};
export type Plan = {
  revision: number; complete: boolean; schedule: 'serial' | 'parallel' | 'unknown';
  steps: Step[]; reason?: string;
};
export type EventPayload =
  | { type: 'run.started'; title: string; scope: 'task' | 'turn' }
  | { type: 'plan.replaced'; plan: Plan }
  | { type: 'step.updated'; revision: number; step: Step }
  | { type: 'activity.updated'; activity: string }
  | EtaAnswer
  | { type: 'run.status'; status: RunStatus; reason?: string }
  | { type: 'completion.reported'; summary: string }
  | { type: 'completion.verified'; summary: string; evidenceRef: string }
  | { type: 'source.heartbeat' }
  | { type:'source.diagnostic';partial:boolean };
export type ReporterChange = Exclude<EventPayload, {
  type: 'run.started' | 'completion.reported' | 'completion.verified' | 'source.heartbeat' | 'source.diagnostic';
}>;
export type NormalizedEvent = {
  schemaVersion: 1; eventId: string; provider: ProviderId; sourceKind: SourceKind;
  sourceInstanceId: string; seq: number; eventIndex: number;
  nativeSessionId?: string; turnId?: string; nativeCallId?: string;
  run: RunRef; occurredAt: number; receivedAt: number; payload: EventPayload;
};
export type RunSnapshot = {
  run: RunRef; provider: ProviderId; title: string; status: RunStatus; scope: 'task' | 'turn';
  nativeSession?: {id:string;turnId:string;project?:string;name?:string};
  nativeActivity?: {lastEventAt:number;inFlight:boolean;hasWork?:boolean;action?:string};
  linkedNativeRun?:RunRef;
  plan: Plan | null; activity: string | null;
  activitySource?: {provider:ProviderId;kind:SourceKind};
  sourcePartial?: boolean;
  progress: { value: number | null; completed: number; total: number; basis: 'plan' | 'quantity' | 'unknown' };
  displayProgress?:{value:number;anchor?:{value:number;range:Estimate;elapsedSec:number;asOf:number}};
  eta: { range: Estimate | null; basis: 'prior' | 'calibrated' | 'agent' | 'unknown'; reason?: string;asOf?:number;overdueSec?:number };
  etaInquiry?: {state:'queued'|'sent'|'answered'|'unanswered';channel:'cooperative'|'hook';requestedAt:number;answeredAt?:number};
  etaWarning?:'ETA_RANGE_TOO_WIDE';
  freshness: Freshness; lastWorkAt: number | null; lastSeenAt: number;reportedAt?:number;
};
export type ClockSample = { wallMs: number; monoMs: number; continuityId: string };
export type TimingState = {
  currentAttemptByStep: Record<string, number>; activeMsByAttempt: Record<string, number>;
  estimateAnchors: Record<string, { version: number; anchorActiveMs: number; kind: 'prior' | 'remaining'; continuous: boolean }>;
  completedSamples: Array<{ stepId: string; attempt: number; activeSec: number; estimateAtStart: Estimate; valid: boolean }>;
  attemptSamples?: Record<string, { estimate: Estimate; version:number; valid:boolean }>;
  continuous: boolean;
  taskActiveMs?:number;
  agentEstimate?: {range:Estimate|null;anchorActiveMs:number;continuous:boolean;reason:string};
  retainedEta?: {range:Estimate;anchorActiveMs:number;basis:'prior'|'calibrated'|'agent'};
  lastReliableProgress?:number;
  progressAnchor?:{value:number;range:Estimate;anchorActiveMs:number};
};
export type RunState = { snapshot: RunSnapshot; timing: TimingState; lastClock: ClockSample | null; planOwner: string | null;
  recoveryPaused?:boolean;
  pendingNativeCalls?:string[];
  etaInquiry?: {question:EtaQuestion|null;nextAt:number;failures:number;hookDelivered?:boolean;asked?:boolean;update?:{requestId:string;planRevision:number}} };
export type TrustedSource = {
  connectorId: string; sourceInstanceId: string; provider: ProviderId;
  kind: SourceKind; nativeSessionId?: string; nativeTurnId?: string; nativeReplayComplete?: boolean; canVerify?: boolean;
  nativeProject?:string;nativeSessionName?:string;nativeObservedAt?:number;
};
export type BeginInput = { idempotencyKey: string; title: string; expectedRun?: RunRef | null; plan?: Plan };
export type ReportInput = { handle: RunHandle; reportId: string; seq: number; changes: ReporterChange[] };
export type FinishInput = { handle: RunHandle; reportId: string; seq: number; summary: string };
export type Ack = { accepted: true; duplicate: boolean; nextSeq: number;warnings?:string[] };
export type ContextResult = { snapshot: RunSnapshot; nextSeq: number; sessionHead: RunRef | null;etaQuestion?:EtaQuestion;etaUpdate?:{requestId:string;planRevision:number} };
export type ParserState = {
  currentTurnId: string | null; nativePlanRevision: number; completePlan: boolean;
  pendingCalls: Record<string, { name: string; input: unknown; offset: number }>;
};
export type FileCursor = {
  pathKey: string; fileGeneration: string; committedOffset: number; pendingBytes: Uint8Array; fingerprint?:string;
};
export type EventBatch = {
  events: NormalizedEvent[]; handle?: RunHandle;
  expectedCursor?: { fileGeneration: string; committedOffset: number } | null;
  receipt?: { reportId: string; bodyHash: string }; cursor?: FileCursor; parserCheckpoint?: ParserState;
};
export type FileCheckpoint = { cursor: FileCursor; parserCheckpoint: ParserState | null };
export type Store = {
  prepareBinding(handle:RunHandle,context:NativeBindingContext,source:TrustedSource):Promise<BindingReceipt>;
  takeEtaQuestion(source:TrustedSource,turnId:string):Promise<EtaQuestion|null>;
  linkNative(run:RunRef, source:{provider:ProviderId;nativeSessionId:string}, turnIds:string[], remove?:boolean):Promise<void>;
  nativeSources():Promise<Array<{run:RunRef;provider:ProviderId;nativeSessionId:string;turnId:string;completeReplay:boolean}>>;
  resolveNative(source: TrustedSource, turnId: string): Promise<RunHandle>;
  commitNative(batches: EventBatch[], checkpoint: EventBatch, source: TrustedSource, bindings?:NativeReporterBinding[]): Promise<void>;
  tick(): Promise<void>;
  maintenance():Promise<{deletedRows:number;effectiveBytes:number;pressure:boolean}>;
  verify(run:RunRef):Promise<void>;
  nativeTurnForCall(source:TrustedSource,callId:string):Promise<string|null>;
  begin(input: BeginInput, source: TrustedSource): Promise<RunHandle>;
  context(handle: RunHandle, source: TrustedSource): Promise<ContextResult>;
  commit(batch: EventBatch, source: TrustedSource): Promise<Ack>;
  checkpoint(pathKey: string): Promise<FileCheckpoint | null>;
  listSnapshots(): Promise<RunSnapshot[]>;
  close(): Promise<void>;
};
