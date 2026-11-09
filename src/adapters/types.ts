import type { NativeReporterBinding, NormalizedEvent, ParserState, ProviderId, TrustedSource } from '../shared/contracts.js';
import type { TailBatch } from './common/tail-reader.js';
export type SourceFile = { path: string; provider: ProviderId; nativeSessionId?: string; nativeProject?:string; nativeSessionName?:string; mtimeMs: number };
export type SourceObservation = Omit<NormalizedEvent, 'run' | 'receivedAt' | 'seq' | 'eventIndex'> & { completePlan?: boolean; nativeSequence:number };
export type ParseContext = { source: TrustedSource; fileGeneration: string; previous: ParserState };
export type ParseResult = { observations: SourceObservation[]; state: ParserState; diagnostics: string[];bindings?:NativeReporterBinding[] };
export type Parser = (lines: TailBatch['lines'], context: ParseContext) => ParseResult;
export type ProviderAdapter = { provider: ProviderId; discover(): Promise<SourceFile[]>; parse: Parser };
export const emptyParser = (): ParserState => ({ currentTurnId: null, nativePlanRevision: 0, completePlan: false, pendingCalls: {} });
