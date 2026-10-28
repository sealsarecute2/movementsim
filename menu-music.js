export const MENU_TRACKS=Object.freeze([
  {title:'Defend The Train OST - BTHG HQ',src:'music/defend-the-train.m4a'},
  {title:'Surya Hearts - Retrofit',src:'music/retrofit.m4a'},
]);

// A single streaming player; pausing halts playback instead of hiding its sound.
export class MenuMusic {
  constructor({tracks=MENU_TRACKS,enabled=false,volume=.35,random=Math.random,
    createAudio=()=>new Audio(),onStatus=()=>{}}={}) {
    this.tracks=tracks;this.enabled=!!enabled;this.random=random;this.createAudio=createAudio;this.onStatus=onStatus;
    this.audio=null;this.index=-1;this.active=false;this.focused=false;this.pending=false;
    this.generation=0;this.failed=new Set();this.blocked=false;this.setVolume(volume);
  }
  get wanted(){return this.enabled&&this.active&&this.focused&&this.volume>0&&this.tracks.length>0;}
  setEnabled(value){this.enabled=!!value;this.failed.clear();this.blocked=false;this.update();}
  setVolume(value){this.volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.35;if(this.audio)this.audio.volume=this.volume;this.update();}
  setActive(active,focused){this.active=!!active;this.focused=!!focused;this.update();}
  pause() {
    this.generation++;this.pending=false;this.audio?.pause();
    this.onStatus(!this.enabled?'Menu music is off.':!this.focused?'Music paused while unfocused.':
      !this.active?'Music paused during the run.':this.volume===0?'Music volume is muted.':'Music paused.');
  }
  chooseNext() {
    let available=this.tracks.map((_,i)=>i).filter(i=>!this.failed.has(i)&&i!==this.index);
    if(!available.length&&this.index>=0&&!this.failed.has(this.index))available=[this.index];
    if(!available.length)return false;
    const random=Math.max(0,Math.min(.999999999,Number(this.random())||0));
    this.index=available[Math.floor(random*available.length)];
    this.generation++;this.pending=false;this.blocked=false;
    this.audio.src=this.tracks[this.index].src;this.audio.load();return true;
  }
  ensureAudio() {
    if(this.audio)return;
    this.audio=this.createAudio();this.audio.preload='none';this.audio.volume=this.volume;this.audio.loop=false;
    this.audio.addEventListener('ended',()=>{
      if(!this.wanted)return;
      if(this.chooseNext())this.update();
    });
    this.audio.addEventListener('error',()=>{
      if(this.index>=0)this.failed.add(this.index);
      this.generation++;this.pending=false;
      if(this.wanted&&this.chooseNext())this.update();
      else {this.audio.pause();this.onStatus('Menu music unavailable. Toggle music to retry.');}
    });
  }
  update() {
    if(!this.wanted){this.pause();return;}
    if(this.pending||this.blocked)return;
    try {
      this.ensureAudio();
      if(this.index<0||this.audio.ended||this.failed.has(this.index)) {
        if(!this.chooseNext()){this.onStatus('Menu music unavailable. Toggle music to retry.');return;}
      }
      if(!this.audio.paused)return;
      const generation=this.generation;this.pending=true;
      this.onStatus('Loading '+this.tracks[this.index].title+'…');
      const request=this.audio.play();
      Promise.resolve(request).then(()=>{
        if(generation!==this.generation){if(!this.wanted)this.audio.pause();return;}
        this.pending=false;
        if(!this.wanted){this.pause();return;}
        this.onStatus('Now playing: '+this.tracks[this.index].title);
      }).catch(()=>{
        if(generation!==this.generation)return;
        this.pending=false;this.blocked=true;this.audio.pause();
        this.onStatus('Click anywhere in the menu to start music.');
      });
    } catch {
      this.pending=false;this.blocked=true;this.onStatus('Menu music is unavailable in this browser.');
    }
  }
  retry(){if(this.blocked){this.blocked=false;this.update();}}
}
