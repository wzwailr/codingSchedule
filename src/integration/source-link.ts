import type {ProviderId,RunRef,Store} from '../shared/contracts.js';
export type NativeSourceRef={provider:ProviderId;nativeSessionId:string};
export type LinkScope={turnIds:string[]};
export async function linkSource(store:Store,run:RunRef,source:NativeSourceRef,scope:LinkScope):Promise<void>{await store.linkNative(run,source,scope.turnIds);}
export async function unlinkSource(store:Store,run:RunRef,source:NativeSourceRef,scope:LinkScope):Promise<void>{await store.linkNative(run,source,scope.turnIds,true);}
