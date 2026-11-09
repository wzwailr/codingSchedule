import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { toolSchemas } from '../shared/schemas.js';
import { sendLocal } from './transport.js';
import type { BridgeOptions } from './options.js';
import {etaQuestionContext} from '../domain/eta-inquiry.js';
import type {ContextResult} from '../shared/contracts.js';
export function createMcpServer(options:BridgeOptions,onOverload?:()=>void):McpServer {
  let activeCalls=0;
  const server=new McpServer({name:'codingSchedule',version:'0.1.1'},{instructions:'For enabled tasks retain your own private run handle. Report the initial plan, each meaningful step/action/wait transition, and completion. Read context immediately before those reports, not on a timer solely for ETA. A first etaQuestion may ask for an initial estimate. Later publish a revised remaining ACTIVE range only when necessary, using eta.answered with context.etaUpdate requestId and planRevision. Estimate width must be at most 600 seconds; if that cannot be bounded honestly, omit ETA or send null. ETA_RANGE_TOO_WIDE is a warning: other work in the batch was committed; the last valid countdown remains. Omitting ETA or sending null preserves the last valid countdown. Do not repeat unchanged estimates. Never infer a task from cwd or the latest run, give its handle to a child, wake another session, or add progress to chat prose. Backend UNAVAILABLE does not close the Windows MCP connection: continue work, then try once at the next natural reporting boundary, retaining the same handle and exact IDs for uncertain writes. Follow coding-schedule-report.'});
  for(const operation of ['begin','report','context','finish'] as const){
    server.registerTool('progress_'+operation,{description:{begin:'Begin an independent task. Retain returned handle; never route by current directory.',report:'Report meaningful progress changes. Initial or necessary revised ETA uses eta.answered with etaQuestion or etaUpdate identifiers from context. No ETA required for ordinary reports; use nextSeq and a stable UUIDv7 reportId for exact retries.',context:'Read your task snapshot and nextSeq before a meaningful report. etaQuestion is an initial request; etaUpdate permits an optional revised estimate. Do not poll solely for unchanged ETA. Read-only; does not refresh activity.',finish:'Declare task complete after its plan is complete. This does not mark user acceptance.'}[operation],inputSchema:toolSchemas[operation],annotations:{readOnlyHint:operation==='context',destructiveHint:false}},async (body:unknown)=>{
      if(activeCalls>=8){onOverload?.();return {content:[{type:'text' as const,text:JSON.stringify({error:'BUSY'})}],isError:true};}activeCalls++;
      try{const response=await sendLocal({...options,operation,body},1500);const result=response.body as ContextResult;
        const failure=response.body as {error?:string};
        const output=failure.error==='STALE_ETA_REQUEST'?{...response.body as Record<string,unknown>,recovery:'No changes in this report were committed. Do not retry the unchanged rejected batch. If plan.replaced is necessary, commit it without the old ETA answer, then read progress_context for the current plan revision and nextSeq before a necessary ETA answer. Ordinary step completion can use step.updated at the current revision. Continue the primary task.'}:operation==='context'&&response.status===200&&result.etaQuestion?{...result,etaInstruction:etaQuestionContext(result.etaQuestion)}:response.body;
        return {content:[{type:'text' as const,text:JSON.stringify(output)}],isError:response.status!==200};}
      catch(error){const failure=error as {code?:unknown;name?:unknown;cause?:{code?:unknown}},value=failure?.cause?.code??failure?.code,code=typeof value==='string'&&/^[A-Z_0-9]{1,60}$/.test(value)?value:failure?.name==='TimeoutError'?'TIMEOUT':'TRANSPORT_FAILED';return {content:[{type:'text' as const,text:JSON.stringify({error:'UNAVAILABLE',code,message:'Progress service unavailable. Continue the primary task; do not loop.'})}],isError:true};}
      finally{activeCalls--;}
    });
  }
  return server;
}
export async function startMcpServer(options:BridgeOptions):Promise<void>{await createMcpServer(options).connect(new StdioServerTransport());}
