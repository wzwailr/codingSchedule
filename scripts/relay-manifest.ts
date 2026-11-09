// Generate the native facade's advertised tools from the actual official SDK
// server. Validation remains in the local ingestion service; no schema copy.
import {writeFile} from 'node:fs/promises';import {Client} from '@modelcontextprotocol/client';
import {InMemoryTransport,LATEST_PROTOCOL_VERSION,SUPPORTED_PROTOCOL_VERSIONS} from '@modelcontextprotocol/server';
import {createMcpServer} from '../src/bridge/mcp.js';
const server=createMcpServer({connectorId:'manifest',credentialPath:'unused',endpointPath:'unused'}),client=new Client({name:'manifest-build',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
try{await Promise.all([server.connect(a),client.connect(b)]);const tools=await client.listTools(),fields=JSON.stringify({capabilities:{tools:{}},serverInfo:client.getServerVersion(),instructions:client.getInstructions()}).slice(1);
 const literal=(s:string)=>JSON.stringify(s);await writeFile(process.argv[2]!,`#define MCP_TOOLS ${literal(JSON.stringify(tools))}\n#define MCP_INIT_FIELDS ${literal(fields)}\n#define MCP_LATEST ${literal(LATEST_PROTOCOL_VERSION)}\nstatic const char *mcp_protocols[]={${SUPPORTED_PROTOCOL_VERSIONS.map(literal).join(',')},0};\n`);
}finally{await client.close();await server.close();}
