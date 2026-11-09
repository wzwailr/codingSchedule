import {prepareRemoval} from './removal.js';
import {resolve} from 'node:path';
const index=process.argv.indexOf('--data-dir');
if(index<0||!process.argv[index+1])process.exitCode=2;
else prepareRemoval(process.argv[index+1]!,process.argv.includes('--delete-progress'),process.argv.includes('--webview2')?resolve(__dirname,'../..'):undefined).then(result=>{console.log(JSON.stringify(result));process.exitCode=result.ok?0:2;}).catch(()=>{console.error('Removal stopped; preserve files and review receipts/configuration manually.');process.exitCode=3;});
