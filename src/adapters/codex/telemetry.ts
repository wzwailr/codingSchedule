// Recognize only ordinary static code-mode wrappers. Ambiguous/dynamic calls
// remain observations; never execute transcript code to discover its meaning.
export function telemetryOnlyWrapper(name:string,code:string):boolean {
 if(!/(^|\.)exec(_code)?$/.test(name)||code.length>1048576||code.includes('`'))return false;
 const plain=code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,' ');
 const calls=Array.from(plain.matchAll(/\b([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*\(/g),m=>m[1]!.replace(/\s/g,''));
 const progress=(value:string)=>/^tools\./.test(value)&&/progress_|codingSchedule/.test(value);
 const helpers=new Set(['text','load','store','JSON.parse','JSON.stringify','Promise.all','Promise.allSettled','if','for','while','switch','catch']);
 return calls.some(progress)&&calls.every(c=>progress(c)||helpers.has(c));
}
