import {RunInputGate} from './limits.js';
import {RunSimulation} from './simulation.js';

// The transport owns its timer; this class is also exercised without sockets.
export class VerificationSession {
  constructor({map,preset,seed,startedAt,expiresAt=startedAt+600000,now=()=>Date.now(),send=()=>{},onEnd=()=>{}}){
    this.now=now;this.send=send;this.onEnd=onEnd;this.simulation=new RunSimulation(map,preset,seed);
    this.gate=new RunInputGate({now});this.gate.startedAt=startedAt;this.gate.lastInputAt=now();
    this.expiresAt=expiresAt;
    this.ended=false;this.lastSent=-Infinity;this.messages=0;
    this.metrics={packets:0,peakQueue:0,maxCatchup:0};
  }
  receive(raw){
    if(this.ended)return;
    try{this.gate.receive(raw);this.metrics.packets++;this.metrics.peakQueue=Math.max(this.metrics.peakQueue,this.gate.queue.length);}
    catch(error){this.end(error.code||'invalid-input');}
  }
  advance(){
    if(this.ended)return;
    if(this.now()>=this.expiresAt){this.end('run-expired');return;}
    try{
      const count=this.gate.advance(input=>this.simulation.step(input));this.metrics.maxCatchup=Math.max(this.metrics.maxCatchup,count);
      if(this.simulation.invalid){this.end(this.simulation.invalid);return;}
      if(this.simulation.completed){this.end('completed');return;}
      if(this.now()-this.lastSent>=200){
        this.lastSent=this.now();if(++this.messages>3000){this.end('egress-budget');return;}
        this.send({type:'state',...this.simulation.state(),metrics:this.metrics});
      }
    }catch(error){this.end(error.code||'simulation-error');}
  }
  end(reason='client-left'){
    if(this.ended)return;this.ended=true;this.gate.closed=true;this.gate.queue=[];
    const result={reason,...this.simulation.state(),metrics:{...this.metrics},endedAt:this.now(),ranked:false};
    try{this.send({type:'ended',...result});}catch{}
    this.onEnd(result);
  }
}
