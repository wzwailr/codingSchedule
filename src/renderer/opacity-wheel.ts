// Normalize pixel/line/page wheels. A trackpad accumulates small deltas; one
// oversized event can change at most one 5% step and steps are rate limited.
export class OpacityWheel {
 private amount=0;private lastEvent=-Infinity;private lastStep=-Infinity;
 consume(delta:number,mode:number,now:number):number{
  if(!Number.isFinite(delta)||delta===0)return 0;
  const pixels=delta*(mode===1?40:mode===2?100:1);
  if(now-this.lastEvent>250||this.amount*pixels<0)this.amount=0;
  this.lastEvent=now;this.amount=Math.max(-200,Math.min(200,this.amount+pixels));
  if(Math.abs(this.amount)<100||now-this.lastStep<80)return 0;
  const direction=Math.sign(this.amount);this.amount-=direction*100;this.lastStep=now;return -direction;
 }
}
