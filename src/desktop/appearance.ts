import {readFile} from 'node:fs/promises';
import {normalizeAppearance,type Appearance} from '../shared/appearance.js';
export async function readAppearance(path:string):Promise<Appearance>{
 try{return normalizeAppearance(JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,'')));}catch{return normalizeAppearance(null);}
}
