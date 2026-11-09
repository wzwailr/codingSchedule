export class RestartPolicy {private attempts=0;nextDelay():number|null{return [1000,2000,5000][this.attempts++]??null;}reset(){this.attempts=0;}}
export function collectorHealth(lastHeartbeat:number,now:number):'ok'|'offline'{return now-lastHeartbeat>30000?'offline':'ok';}
