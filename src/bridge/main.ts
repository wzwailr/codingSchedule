import { parseOptions } from './options.js';
import { startMcpServer } from './mcp.js';
import { runCli } from './cli.js';
// This dedicated helper only reads tiny local endpoint/credential files. Set
// before its first async file read so four native IO stacks are not committed.
process.env.UV_THREADPOOL_SIZE='1';
async function main(){const args=process.argv.slice(2);if(args.includes('--mcp'))await startMcpServer(parseOptions(args));else process.exitCode=await runCli(args,process.stdin);}
main().catch(()=>{console.error('Progress bridge unavailable');process.exitCode=3;});
