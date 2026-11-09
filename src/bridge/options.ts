export type BridgeOptions={connectorId:string;credentialPath:string;endpointPath:string};
export function parseOptions(args:string[]):BridgeOptions {
  const read=(key:string)=>{const i=args.indexOf(key);if(i<0||!args[i+1]||args[i+1]!.startsWith('--'))throw new Error('Missing bridge argument');return args[i+1]!;};
  return {connectorId:read('--connector'),credentialPath:read('--credential'),endpointPath:read('--endpoint')};
}
