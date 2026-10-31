import {MUSIC_CATALOG} from './music-catalog.js';
export const MENU_TRACKS=MUSIC_CATALOG;

export function validateMusicTracks(value){
  if(!Array.isArray(value)||value.length>1000)throw Error('Invalid music playlist.');
  const seen=new Set();
  return value.map(track=>{
    if(typeof track?.title!=='string'||!track.title.trim()||track.title.length>200||typeof track.src!=='string'||track.src.length>1024||
      !track.src.startsWith('music/')||/[?#\\\u0000-\u001f\u007f]/.test(track.src))throw Error('Invalid music track.');
    const parts=track.src.split('/').map(decodeURIComponent);
    if(parts.some(part=>!part||part==='.'||part==='..'||/[\\/\u0000-\u001f\u007f]/.test(part))||
      !/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac|webm|mp4)$/i.test(parts.at(-1))||seen.has(track.src))throw Error('Invalid music track.');
    seen.add(track.src);return {title:track.title,src:track.src};
  });
}

// A single streaming player; pausing halts playback instead of hiding its sound.
export class MenuMusic {
  constructor({tracks=MENU_TRACKS,enabled=false,volume=.35,random=Math.random,
    createAudio=()=>new Audio(),onStatus=()=>{},onTracks=()=>{},fetcher=(...args)=>fetch(...args),now=Date.now}={}) {
    this.tracks=tracks;this.enabled=!!enabled;this.random=random;this.createAudio=createAudio;this.onStatus=onStatus;
    this.audio=null;this.index=-1;this.active=false;this.focused=false;this.pending=false;
    this.generation=0;this.failed=new Set();this.blocked=false;this.setVolume(volume);
    Object.assign(this,{onTracks,fetcher,now});this.catalogRequest=null;this.catalogAt=-Infinity;
  }
  get wanted(){return this.enabled&&this.active&&this.focused&&this.volume>0&&this.tracks.length>0;}
  setTracks(tracks){
    tracks=validateMusicTracks(tracks);
    const current=this.tracks[this.index]?.src,failed=new Set([...this.failed].map(index=>this.tracks[index]?.src));
    this.tracks=tracks;this.index=current?tracks.findIndex(track=>track.src===current):-1;
    this.failed=new Set(tracks.flatMap((track,index)=>failed.has(track.src)?[index]:[]));
    if(current&&this.index<0){this.generation++;this.pending=false;this.blocked=false;this.audio?.pause();}
    this.onTracks(this.tracks);this.update();
  }
  async refreshTracks({force=false}={}){
    if(this.catalogRequest)return this.catalogRequest;
    if(!force&&this.now()-this.catalogAt<30000)return false;
    this.catalogAt=this.now();
    this.catalogRequest=(async()=>{
      const controller=new AbortController(),timer=globalThis.setTimeout(()=>controller.abort(),5000);
      try{
        const response=await this.fetcher('music/playlist.json',{cache:'no-store',credentials:'omit',signal:controller.signal});
        if(!response.ok)throw Error('Playlist unavailable.');
        const text=await response.text();if(text.length>1048576)throw Error('Playlist too large.');
        const data=JSON.parse(text);if(data.version!==1)throw Error('Invalid playlist version.');
        this.setTracks(data.tracks);return true;
      }catch{return false;}finally{globalThis.clearTimeout(timer);this.catalogRequest=null;}
    })();return this.catalogRequest;
  }
  setEnabled(value){this.enabled=!!value;this.failed.clear();this.blocked=false;this.update();}
  setVolume(value){this.volume=Number.isFinite(value)?Math.max(0,Math.min(1,value)):.35;if(this.audio)this.audio.volume=this.volume;this.update();}
  setActive(active,focused){this.active=!!active;this.focused=!!focused;this.update();}
  pause() {
    this.generation++;this.pending=false;this.audio?.pause();
    this.onStatus(!this.enabled?'Menu music is off.':!this.focused?'Music paused while unfocused.':
      !this.active?'Music paused during the run.':!this.tracks.length?'No songs in the music folder.':this.volume===0?'Music volume is muted.':'Music paused.');
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
      void this.refreshTracks();
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
