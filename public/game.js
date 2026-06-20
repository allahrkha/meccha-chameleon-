// ═══════════════════════════════════════════════════════════════
//  MECCHA CHAMELEON  |  game.js  |  Phase 4: Customization · Minimap · Emotes · Rooftop
// ═══════════════════════════════════════════════════════════════

const socket = io();

// ── Core State ─────────────────────────────────────────────────
let myId       = null;
let myRole     = 'hider';   // 'hider' | 'seeker' | 'ghost'
let roomCode   = null;
let isHost     = false;
let gameState  = 'lobby';
let paintOpen  = false;
let curColor   = '#00bcd4';
let curPose    = 'stand';
let currentMap = 'hotel';
const POSES    = ['stand', 'crouch', 'wall-flat'];

// ── Three.js ───────────────────────────────────────────────────
let scene, camera, renderer, clock;
let myMesh = null;
const playerMeshes = {};
const playerData   = {}; // id → { role, name, customization }

// ── Camera ─────────────────────────────────────────────────────
let camTheta = 0, camPhi = 0.45;
let camDist    = 7;          // zoom-able via pinch
const CAM_D_MIN = 3;
const CAM_D_MAX = 14;
const WALL_LIM  = 9.3;

// ── Input ──────────────────────────────────────────────────────
const keys     = {};
const joystick = { x:0, y:0 };
let animating  = false;
let joyInitd   = false;
let timerIval  = null;
let timerCount = 0;

// ── Camo ───────────────────────────────────────────────────────
let camoScore = 0, camoTick = 0;
const hiderCamoScores = {};

// ── Detect Ring ────────────────────────────────────────────────
let detectRing = null, ringPulseTick = 0;

// ── Rounds ────────────────────────────────────────────────────
let currentRound = 0, maxRounds = 1, seekerWins = 0, hiderWins = 0;

// ── Reconnect token ────────────────────────────────────────────
function getToken(){
  let t=localStorage.getItem('chameleon_token');
  if(!t){ t=Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('chameleon_token',t); }
  return t;
}

// ── Fullscreen / Orientation ────────────────────────────────────
function enterFullscreen(){
  const el=document.documentElement;
  const fn=el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen;
  if(fn) fn.call(el).catch(()=>{});
  try{ screen.orientation?.lock('landscape').catch(()=>{}); }catch(e){}
}
// ── Device detection ─────────────────────────────────────────────
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
const IS_MOBILE = IS_IOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

function updateFsBtn(){
  const btn=document.getElementById('fsBtn');
  if(!btn) return;
  const active=!!(document.fullscreenElement||document.webkitFullscreenElement);
  btn.textContent = active ? '⊡' : '⛶';
  btn.title = active ? 'Exit fullscreen' : 'Fullscreen';
}

function toggleFullscreen(){
  if(IS_IOS){
    document.getElementById('iosHint').style.display='flex';
    return;
  }
  const active=document.fullscreenElement||document.webkitFullscreenElement;
  if(active){
    (document.exitFullscreen||document.webkitExitFullscreen).call(document).then(updateFsBtn);
  } else {
    enterFullscreen();
    setTimeout(updateFsBtn, 400);
  }
}

function enterFullscreen(){
  if(IS_IOS) return;
  const el=document.documentElement;
  const fn=el.requestFullscreen||el.webkitRequestFullscreen||el.mozRequestFullScreen;
  if(fn) fn.call(el).catch(()=>{});
  try{ screen.orientation?.lock('landscape').catch(()=>{}); }catch(e){}
}

// Keep screen on during gameplay (Android Chrome / desktop Chrome)
async function requestWakeLock(){
  try{ if('wakeLock' in navigator) await navigator.wakeLock.request('screen'); }catch(e){}
}

// Listen for external fullscreen changes (e.g. user presses Esc)
document.addEventListener('fullscreenchange', updateFsBtn);
document.addEventListener('webkitfullscreenchange', updateFsBtn);

// ── Minimap ────────────────────────────────────────────────────
let minimapCanvas = null, minimapCtx = null;
const MM = 140, MM_HALF = 10;

// ── Emotes ─────────────────────────────────────────────────────
const emoteParticles = [];
let emotePanelOpen = false;

// ── Emote Wheel state ─────────────────────────────────────────
let ewActive      = false;
let ewInitialized = false;
let ewCenter      = { x:0, y:0 };
let ewHighlighted = null;
let lastEmote     = 'wave';

// Emote positions in the wheel (math angle: 0=right, 90=up)
// All in upper arc so thumb from bottom-right can reach all 4
const EW_DEFS = [
  { key:'wave',      angle:135, tx:-56.6, ty:-56.6 }, // ↖ upper-left
  { key:'celebrate', angle:90,  tx:0,     ty:-80   }, // ↑ up
  { key:'sleep',     angle:45,  tx:56.6,  ty:-56.6 }, // ↗ upper-right
  { key:'taunt',     angle:180, tx:-80,   ty:0     }, // ← left
];
const EMOTES = [
  { key:'wave',      emoji:'👋', label:'Wave'      },
  { key:'celebrate', emoji:'🎉', label:'Celebrate' },
  { key:'sleep',     emoji:'😴', label:'Sleep'     },
  { key:'taunt',     emoji:'😝', label:'Taunt'     },
];

// ── Character Customization ────────────────────────────────────
let myCustomization = { skinColor:'#f5c9a0', hat:'none' };
const SKIN_COLORS = [
  '#fde9d9','#f5c9a0','#e8a87c','#c68642','#8d5524',
  '#ffd6e0','#c8f7c5','#a8d8ea',
];
const HAT_OPTIONS = [
  { key:'none',    emoji:'🚫', label:'None'     },
  { key:'crown',   emoji:'👑', label:'Crown'    },
  { key:'tophat',  emoji:'🎩', label:'Top Hat'  },
  { key:'catears', emoji:'🐱', label:'Cat Ears' },
  { key:'cap',     emoji:'🧢', label:'Cap'      },
  { key:'halo',    emoji:'😇', label:'Halo'     },
];

// ── Paint Palette ──────────────────────────────────────────────
const PALETTE = [
  '#ffffff','#f5e6c8','#a8d8ea','#ffccbc','#fff9c4',
  '#69f0ae','#00bcd4','#1976d2','#9c27b0','#e91e63',
  '#ff7043','#ffd54f','#4caf50','#795548','#607d8b',
  '#00e5ff','#ff4081','#7c4dff','#ff5722','#212121',
];

// ═══════════════════════════════════════════════════════════════
//  🎨  CAMOUFLAGE SHADER MATERIAL
// ═══════════════════════════════════════════════════════════════
// Uses MeshStandardMaterial with onBeforeCompile injection so
// full PBR lighting is preserved.  The shader adds:
//   • Fresnel edge blending → edges dissolve into env color
//   • Value-noise micro-pattern → simulates texture matching
//   • Env tint pass → subtle global colour pull toward surroundings
//   • Opacity modulation → up to 22% transparent at 100% camo

const _scanRay = new THREE.Raycaster();

function createCamoMaterial(hexColor){
  const c = typeof hexColor==='number' ? hexColor : parseInt(String(hexColor).replace('#',''),16);
  const mat = new THREE.MeshStandardMaterial({
    color:       new THREE.Color(c),
    roughness:   0.65,
    transparent: true,
    opacity:     1.0,
  });

  // Uniforms shared with the injected shader (updated by reference each frame)
  mat.userData.camoUniforms = {
    envColor:  { value: new THREE.Color(1,1,1) },
    camoScore: { value: 0.0 },
    utime:     { value: 0.0 },
  };

  mat.onBeforeCompile = shader => {
    shader.uniforms.uEnvColor  = mat.userData.camoUniforms.envColor;
    shader.uniforms.uCamoScore = mat.userData.camoUniforms.camoScore;
    shader.uniforms.uTime      = mat.userData.camoUniforms.utime;

    // ── vertex: pass world position ─────────────────────────
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        `#include <common>
         varying vec3 vWorldPos;`)
      .replace('#include <worldpos_vertex>',
        `#include <worldpos_vertex>
         vWorldPos = worldPosition.xyz;`);

    // ── fragment: inject before color_fragment ──────────────
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        `#include <common>
         uniform vec3  uEnvColor;
         uniform float uCamoScore;
         uniform float uTime;
         varying vec3  vWorldPos;

         /* 3-D value noise (smooth, cheap) */
         float h31(vec3 p){ return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
         float vn3(vec3 p){
           vec3 i=floor(p), f=fract(p);
           f=f*f*(3.0-2.0*f);
           return mix(
             mix(mix(h31(i),           h31(i+vec3(1,0,0)),f.x),
                 mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x),
                 mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x), f.y),
             f.z);
         }`)
      .replace('#include <color_fragment>',
        `#include <color_fragment>

         /* ── Fresnel: edges face away from camera → blend with env ── */
         vec3  viewDir = normalize(cameraPosition - vWorldPos);
         float cosA    = max(dot(normalize(vNormal), viewDir), 0.0);
         float fresnel  = pow(1.0 - cosA, 2.5) * uCamoScore;

         /* ── Value-noise layers: simulate surface texture matching ── */
         float n1 = vn3(vWorldPos * 7.0  + uTime * 0.04) * 0.055 * uCamoScore;
         float n2 = vn3(vWorldPos * 19.0)                * 0.030 * uCamoScore;

         /* ── Global env tint (subtle background-colour pull) ── */
         vec3 tinted = mix(diffuseColor.rgb, uEnvColor, uCamoScore * 0.09 + n2);

         /* ── Edge dissolve into env ── */
         vec3 edged  = mix(tinted, uEnvColor, clamp(fresnel * 0.55 + n1, 0.0, 0.85));

         diffuseColor.rgb = mix(tinted, edged, uCamoScore * 0.65);

         /* ── Opacity: 1.0 → 0.78 as camo rises (never invisible) ── */
         diffuseColor.a  *= (1.0 - uCamoScore * 0.22);`);
  };

  return mat;
}

/* Estimate env colour at a world position via quick raycasts */
function estimateEnvColor(worldPos, targetColor){
  _scanRay.far = 5.0;
  const pos = worldPos.clone(); pos.y += 0.8;
  const hits = [];
  [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,-1,0]].forEach(d=>{
    _scanRay.set(pos, new THREE.Vector3(...d));
    const ix = _scanRay.intersectObjects(scene.children, true);
    const h  = ix.find(i=>i.object.isMesh && !i.object.userData.playerId);
    if(h?.object.material?.color)
      hits.push({ c:h.object.material.color, w:1/(h.distance+0.3) });
  });
  if(!hits.length){ targetColor.setRGB(0.6,0.6,0.6); return; }
  const W = hits.reduce((s,h)=>s+h.w, 0);
  targetColor.setRGB(
    hits.reduce((s,h)=>s+h.c.r*h.w,0)/W,
    hits.reduce((s,h)=>s+h.c.g*h.w,0)/W,
    hits.reduce((s,h)=>s+h.c.b*h.w,0)/W,
  );
}



// ═══════════════════════════════════════════════════
//  🔊  AUDIO ENGINE
// ═══════════════════════════════════════════════════

let audioCtx = null, muted = false;

function initAudio() {
  if (audioCtx) return;
  try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
  catch(e) {}
}
function tone(freq,dur,type='sine',vol=0.25,delay=0){
  if(!audioCtx||muted) return;
  const now=audioCtx.currentTime+delay;
  const osc=audioCtx.createOscillator(), gain=audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.type=type; osc.frequency.setValueAtTime(freq,now);
  gain.gain.setValueAtTime(vol,now);
  gain.gain.exponentialRampToValueAtTime(0.0001,now+dur);
  osc.start(now); osc.stop(now+dur+0.02);
}
function noise(dur,vol=0.2,cutoff=500){
  if(!audioCtx||muted) return;
  const rate=audioCtx.sampleRate;
  const buf=audioCtx.createBuffer(1,Math.floor(rate*dur),rate);
  const data=buf.getChannelData(0);
  for(let i=0;i<data.length;i++) data[i]=(Math.random()*2-1)*(1-i/data.length)*vol;
  const src=audioCtx.createBufferSource(), filter=audioCtx.createBiquadFilter();
  filter.type='lowpass'; filter.frequency.value=cutoff;
  src.buffer=buf; src.connect(filter); filter.connect(audioCtx.destination); src.start();
}
const SFX = {
  footstep:  ()=>noise(0.04,0.13,380),
  paint:     ()=>noise(0.07,0.12,2200),
  tag:       ()=>{tone(600,0.07,'square',0.28);tone(180,0.35,'sawtooth',0.2,0.07);},
  tagged:    ()=>{[520,380,220,160].forEach((f,i)=>tone(f,0.22,'sawtooth',0.3,i*0.13));},
  denied:    ()=>{tone(300,0.08,'square',0.2);tone(200,0.12,'square',0.15,0.1);},
  prepStart: ()=>{[262,330,392,523].forEach((f,i)=>tone(f,0.18,'sine',0.28,i*0.1));},
  huntStart: ()=>{tone(110,0.9,'sawtooth',0.12);tone(440,0.2,'sine',0.28,0.55);tone(550,0.2,'sine',0.25,0.75);},
  win:       ()=>{[523,659,784,1046,1318].forEach((f,i)=>tone(f,0.22,'sine',0.32,i*0.13));},
  lose:      ()=>{[380,280,190,140].forEach((f,i)=>tone(f,0.28,'sawtooth',0.22,i*0.18));},
  beep:      ()=>tone(880,0.07,'sine',0.18),
  urgentBeep:()=>{tone(1000,0.06,'square',0.2);tone(800,0.06,'square',0.18,0.1);},
  ghost:     ()=>{tone(220,0.6,'sine',0.12);tone(110,0.6,'sine',0.08,0.15);},
  ping:      ()=>tone(1200,0.06,'sine',0.15),
  roleChange:()=>{[330,440,550].forEach((f,i)=>tone(f,0.15,'sine',0.25,i*0.1));},
  pose:      ()=>tone(660,0.08,'sine',0.15),
  emote:     ()=>tone(880,0.05,'sine',0.1),
};
function toggleMute(){
  initAudio(); muted=!muted;
  const btn=document.getElementById('muteBtn');
  if(btn) btn.textContent=muted?'🔇':'🔊';
  toast(muted?'Sound off 🔇':'Sound on 🔊');
}

// ═══════════════════════════════════════════════════
//  COLLISION SYSTEM
// ═══════════════════════════════════════════════════

const COLLIDERS=[], PLAYER_R=0.38;
function clearColliders(){ COLLIDERS.length=0; }
function cc(x,z,r){ COLLIDERS.push({type:'circle',x,z,r}); }
function bc(cx,cz,hw,hd){ COLLIDERS.push({type:'box',cx,cz,hw,hd}); }
function resolveCollision(nx,nz){
  for(const c of COLLIDERS){
    if(c.type==='circle'){
      const dx=nx-c.x,dz=nz-c.z,d=Math.sqrt(dx*dx+dz*dz),min=PLAYER_R+c.r;
      if(d<min&&d>0.001){const f=(min-d)/d;nx+=dx*f;nz+=dz*f;}
    }else{
      const l=c.cx-c.hw-PLAYER_R,r=c.cx+c.hw+PLAYER_R;
      const t=c.cz-c.hd-PLAYER_R,b=c.cz+c.hd+PLAYER_R;
      if(nx>l&&nx<r&&nz>t&&nz<b){
        const oL=nx-l,oR=r-nx,oT=nz-t,oB=b-nz,m=Math.min(oL,oR,oT,oB);
        if(m===oL)nx=l;else if(m===oR)nx=r;else if(m===oT)nz=t;else nz=b;
      }
    }
  }
  return[nx,nz];
}

// ═══════════════════════════════════════════════════
//  CHARACTER CUSTOMIZATION UI  (Lobby)
// ═══════════════════════════════════════════════════

function initCustomizationUI(){
  const skinPicker=document.getElementById('skinPicker');
  if(skinPicker){
    SKIN_COLORS.forEach(hex=>{
      const d=document.createElement('div');
      d.style.cssText=`width:28px;height:28px;border-radius:50%;background:${hex};cursor:pointer;border:2px solid transparent;transition:.15s;flex-shrink:0`;
      d.title=hex;
      d.onclick=()=>{
        myCustomization.skinColor=hex;
        skinPicker.querySelectorAll('div').forEach(el=>el.style.borderColor='transparent');
        d.style.borderColor='#fff';
        updateLobbyPreview();
      };
      if(myCustomization.skinColor===hex) d.style.borderColor='#fff';
      skinPicker.appendChild(d);
    });
  }
  const hatPicker=document.getElementById('hatPicker');
  if(hatPicker){
    HAT_OPTIONS.forEach(h=>{
      const d=document.createElement('button');
      d.textContent=h.emoji; d.title=h.label;
      d.style.cssText='width:38px;height:38px;border-radius:8px;border:2px solid transparent;background:rgba(255,255,255,0.1);font-size:1.2em;cursor:pointer;transition:.15s';
      d.onclick=()=>{
        myCustomization.hat=h.key;
        hatPicker.querySelectorAll('button').forEach(el=>el.style.borderColor='transparent');
        d.style.borderColor='#fff';
        updateLobbyPreview();
      };
      if(myCustomization.hat===h.key) d.style.borderColor='#fff';
      hatPicker.appendChild(d);
    });
  }
  updateLobbyPreview();
}

function updateLobbyPreview(){
  const prev=document.getElementById('charPreview');
  if(!prev) return;
  const skinC=myCustomization.skinColor||'#f5c9a0';
  const hatEmoji=HAT_OPTIONS.find(h=>h.key===myCustomization.hat)?.emoji||'🚫';
  prev.innerHTML=`
    <div style="display:flex;flex-direction:column;align-items:center;gap:2px">
      <div style="font-size:1.4em;line-height:1">${hatEmoji!=='🚫'?hatEmoji:''}</div>
      <div style="width:22px;height:22px;border-radius:3px;background:${skinC};border:1px solid rgba(255,255,255,0.3)"></div>
      <div style="width:28px;height:28px;border-radius:3px;background:${skinC};border:1px solid rgba(255,255,255,0.3)"></div>
      <div style="width:12px;height:22px;border-radius:2px;background:${skinC};border:1px solid rgba(255,255,255,0.3)"></div>
    </div>`;
}

// ═══════════════════════════════════════════════════
//  LOBBY FUNCTIONS
// ═══════════════════════════════════════════════════

function createRoom(){
  initAudio();
  const name=document.getElementById('playerName').value.trim()||'Player';
  socket.emit('createRoom',{name,customization:myCustomization,token:getToken()},(res)=>{
    if(!res.ok) return toast('❌ '+res.err);
    myId=socket.id;myRole=res.me.role;roomCode=res.code;isHost=true;
    playerData[myId]={role:'hider',name,customization:myCustomization};
    enterRoomLobby(res.room);
  });
}
function joinRoom(){
  initAudio();
  const name=document.getElementById('playerName').value.trim()||'Player';
  const code=document.getElementById('joinCode').value.trim().toUpperCase();
  if(code.length<4) return toast('Enter a valid room code');
  socket.emit('joinRoom',{code,name,customization:myCustomization,token:getToken()},(res)=>{
    if(!res.ok) return toast('❌ '+res.err);
    myId=socket.id;myRole=res.me.role;roomCode=res.code;isHost=false;
    playerData[myId]={role:'hider',name,customization:myCustomization};
    Object.values(res.room.players).forEach(p=>{
      playerData[p.id]={role:p.role,name:p.name,customization:p.customization||{}};
    });
    enterRoomLobby(res.room);
  });
}
function enterRoomLobby(room){
  document.getElementById('lobby').style.display='none';
  document.getElementById('roomLobby').style.display='block';
  document.getElementById('displayCode').textContent=room.code;
  refreshPlayerList(room.players);
  if(isHost){document.getElementById('startBtn').style.display='block';document.getElementById('waitMsg').style.display='none';}
}
function refreshPlayerList(players){
  const ul=document.getElementById('playerList');ul.innerHTML='';
  Object.values(players).forEach(p=>{
    const hatEmoji=HAT_OPTIONS.find(h=>h.key===(p.customization?.hat||'none'))?.emoji||'';
    const skinC=p.customization?.skinColor||'#f5c9a0';
    const li=document.createElement('li');li.className='player-item';
    li.innerHTML=`<div class="pdot" style="background:${skinC}"></div>
      <span style="font-size:.9em">${hatEmoji} </span>
      <span>${esc(p.name)}${p.id===myId?' <em style="color:#888;font-size:.8em">(you)</em>':''}</span>
      <span class="prole role-${p.role}">${p.role}</span>`;
    ul.appendChild(li);
  });
}
function startGame(){
  const mode   =document.getElementById('modeSelect').value;
  const map    =document.getElementById('mapSelect')?.value||'hotel';
  const rounds =document.getElementById('roundsSelect')?.value||'1';
  socket.emit('startGame',{mode,map,rounds},(res)=>{if(res&&!res.ok)toast('❌ '+res.err);});
}
function nextRound(){
  socket.emit('nextRound');
  document.getElementById('resultOverlay').style.display='none';
}
function goBackLobby(){socket.emit('resetLobby');document.getElementById('resultOverlay').style.display='none';}

// ═══════════════════════════════════════════════════
//  ENTER 3-D GAME
// ═══════════════════════════════════════════════════

function enterGame(roomData){
  document.getElementById('roomLobby').style.display='none';
  document.getElementById('gameContainer').style.display='block';
  currentMap=roomData.map||'hotel';
  if(!scene) initThree();
  while(scene.children.length>0) scene.remove(scene.children[0]);
  clearColliders(); detectRing=null;
  if(currentMap==='sugarland') buildSugarland();
  else if(currentMap==='rooftop') buildRooftop();
  else buildHotelRoom();
  createDetectRing();
  Object.keys(playerMeshes).forEach(id=>delete playerMeshes[id]);
  Object.values(roomData.players).forEach(p=>{
    playerData[p.id]={role:p.role,name:p.name,customization:p.customization||{}};
    spawnPlayer(p);
  });
  myMesh=playerMeshes[myId];
  refreshRoleUI();
  buildHiderIcons(roomData.players);
  initMinimap();
  initEmoteWheel();
  initJoystick();
  initCameraControls();
  buildPalette();
  document.getElementById('gameCanvas').addEventListener('click',onCanvasClick);
  if(!animating){animating=true;requestAnimationFrame(loop);}
  // Auto fullscreen + wake lock on game start (mobile)
  if(IS_MOBILE && !IS_IOS){ enterFullscreen(); }
  requestWakeLock();
}

// ═══════════════════════════════════════════════════
//  THREE.JS INIT
// ═══════════════════════════════════════════════════

function initThree(){
  clock=new THREE.Clock(); scene=new THREE.Scene();
  camera=new THREE.PerspectiveCamera(60,innerWidth/innerHeight,0.1,120);
  const canvas=document.getElementById('gameCanvas');
  renderer=new THREE.WebGLRenderer({canvas,antialias:true});
  renderer.setSize(innerWidth,innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  window.addEventListener('resize',()=>{
    camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth,innerHeight);
  });
  document.addEventListener('keydown',e=>{
    keys[e.code]=true;
    // E → toggle desktop emote panel
    if(e.code==='KeyE') toggleEmotePanel();
    // 1-4 → direct emote shortcuts (desktop)
    if(e.code==='Digit1') triggerEmote('wave');
    if(e.code==='Digit2') triggerEmote('celebrate');
    if(e.code==='Digit3') triggerEmote('sleep');
    if(e.code==='Digit4') triggerEmote('taunt');
  });
  document.addEventListener('keyup',e=>keys[e.code]=false);
}

// ═══════════════════════════════════════════════════
//  🗺️  MINIMAP
// ═══════════════════════════════════════════════════

function initMinimap(){
  if(minimapCanvas){
    minimapCanvas.style.display='block';
    return;
  }
  minimapCanvas=document.createElement('canvas');
  minimapCanvas.id='minimap';
  minimapCanvas.width=MM; minimapCanvas.height=MM;
  minimapCanvas.style.cssText=`position:fixed;top:60px;right:12px;width:${MM}px;height:${MM}px;border-radius:10px;border:1px solid rgba(255,255,255,0.18);z-index:100;pointer-events:none;opacity:.85`;
  document.getElementById('gameContainer').appendChild(minimapCanvas);
  minimapCtx=minimapCanvas.getContext('2d');
}

function updateMinimap(){
  if(!minimapCtx||!myMesh) return;
  const ctx=minimapCtx;
  ctx.clearRect(0,0,MM,MM);
  // Background
  ctx.fillStyle='rgba(0,0,0,0.7)';
  ctx.fillRect(0,0,MM,MM);
  // Map features
  drawMinimapFeatures(ctx);
  // Player dots
  Object.entries(playerMeshes).forEach(([id,mesh])=>{
    const pd=playerData[id];
    if(!pd) return;
    const isSeeker=pd.role==='seeker';
    const isGhost=mesh.userData.isGhost;
    const isMe=id===myId;
    // Visibility rules: hiders see only themselves + seekers
    if(myRole==='hider'&&!isMe&&!isSeeker&&!isGhost) return;
    const mx=(mesh.position.x+MM_HALF)/(MM_HALF*2)*MM;
    const mz=(mesh.position.z+MM_HALF)/(MM_HALF*2)*MM;
    // Dot color
    ctx.beginPath(); ctx.arc(mx,mz,isMe?5.5:3.5,0,Math.PI*2);
    ctx.fillStyle=isGhost?'rgba(130,130,200,0.5)':isMe?'#ffeb3b':isSeeker?'#FF4500':'#69f0ae';
    ctx.fill();
    // White stroke on my dot
    if(isMe){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
    // Direction arrow for me
    if(isMe){
      const dir=mesh.rotation.y;
      ctx.strokeStyle='#ffeb3b';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(mx,mz);
      ctx.lineTo(mx-Math.sin(dir)*9,mz-Math.cos(dir)*9);
      ctx.stroke();
    }
  });
  // Border
  ctx.strokeStyle='rgba(255,255,255,0.25)';ctx.lineWidth=1;
  ctx.strokeRect(0.5,0.5,MM-1,MM-1);
  // Map emoji
  ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='10px serif';ctx.textAlign='left';
  ctx.fillText(currentMap==='hotel'?'🏨':currentMap==='sugarland'?'🍭':'🏙️',4,12);
}

function drawMinimapFeatures(ctx){
  ctx.fillStyle='rgba(255,255,255,0.07)';
  const toMM=(wx,wz)=>[(wx+MM_HALF)/(MM_HALF*2)*MM,(wz+MM_HALF)/(MM_HALF*2)*MM];
  const rect=(wx,wz,ww,wd)=>{
    const[mx,mz]=toMM(wx,wz);
    const sw=ww/(MM_HALF*2)*MM, sd=wd/(MM_HALF*2)*MM;
    ctx.fillRect(mx-sw/2,mz-sd/2,sw,sd);
  };
  const circ=(wx,wz,wr)=>{
    const[mx,mz]=toMM(wx,wz);const sr=wr/(MM_HALF*2)*MM;
    ctx.beginPath();ctx.arc(mx,mz,sr,0,Math.PI*2);ctx.fill();
  };
  if(currentMap==='hotel'){
    rect(0,-9,6,1.2);           // desk
    rect(-7.5,-7.5,2.6,1);rect(7.5,-7.5,2.6,1); // sofas back
    rect(-8.5,0,1,2.6);rect(8.5,0,1,2.6);        // sofas sides
    circ(-3.5,-2,0.9);circ(3.5,2,0.9);circ(0,4.5,0.9);circ(-5,4,0.9); // tables
    circ(-7,-7,0.4);circ(7,-7,0.4);circ(-7,7,0.4);circ(7,7,0.4);      // pillars
  } else if(currentMap==='sugarland'){
    circ(-5.5,-5.5,0.9);circ(6,4,0.9);circ(-7,3,0.9);circ(4,7.5,0.9); // cotton candy
    circ(-7.5,-7.5,1.8); // gingerbread house
    circ(-3.5,2.5,1);circ(4,-2,1);circ(-1.5,-5.5,1);circ(6,-6,1);     // cakes
  } else {
    rect(-7,-7,2.5,2.2); // stairwell
    circ(7,-7,1.4);      // water tower
    rect(-3,2,3.5,1.2);rect(4,-4,1.2,3.5); // AC units
    rect(0,-4,4,1);      // vent duct
    rect(2.5,5,1,3);     // vent duct
    circ(7,7,1);         // sat dish area
  }
}

// ═══════════════════════════════════════════════════
//  SEEKER DETECT RING
// ═══════════════════════════════════════════════════

function createDetectRing(){
  const geo=new THREE.RingGeometry(0.1,0.18,40);
  const mat=new THREE.MeshBasicMaterial({color:0xff6600,transparent:true,opacity:0.5,side:THREE.DoubleSide,depthWrite:false});
  detectRing=new THREE.Mesh(geo,mat);
  detectRing.rotation.x=-Math.PI/2; detectRing.position.y=0.06; detectRing.visible=false;
  scene.add(detectRing);
}
function updateDetectRing(dt){
  if(!detectRing||!myMesh){return;}
  if(myRole!=='seeker'){detectRing.visible=false;return;}
  let nearestCamo=0,nearestDist=Infinity;
  Object.entries(playerMeshes).forEach(([id,mesh])=>{
    if(id===myId||!mesh||mesh.userData.isGhost) return;
    const d=myMesh.position.distanceTo(mesh.position);
    if(d<nearestDist){nearestDist=d;nearestCamo=hiderCamoScores[id]||0;}
  });
  const effRange=1.5+(6-1.5)*(1-nearestCamo/100);
  detectRing.scale.setScalar(effRange/0.15);
  detectRing.position.set(myMesh.position.x,0.06,myMesh.position.z);
  const inRange=nearestDist<=effRange;
  ringPulseTick+=dt*(inRange?8:3);
  detectRing.visible=true;
  detectRing.material.opacity=0.3+Math.sin(ringPulseTick)*0.18;
  detectRing.material.color.setHex(inRange?0xff2200:nearestDist<effRange*1.5?0xffaa00:0x44aaff);
}

// ═══════════════════════════════════════════════════
//  MAP 1 — HOTEL ROOM
// ═══════════════════════════════════════════════════

function buildHotelRoom(){
  const W=20,D=20,H=5.2;
  scene.background=new THREE.Color(0x12082a);
  scene.fog=new THREE.FogExp2(0x12082a,0.018);
  scene.add(new THREE.AmbientLight(0xffeeff,0.45));
  scene.add(new THREE.HemisphereLight(0xfff0ee,0x223344,0.35));
  const sun=new THREE.DirectionalLight(0xfff5e0,0.8);sun.position.set(5,10,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
  [[-4,-4],[4,-4],[-4,4],[4,4],[0,0]].forEach(([x,z])=>{
    const pl=new THREE.PointLight(0xfff5e0,1.0,14);pl.position.set(x,H-0.3,z);scene.add(pl);
    const fix=new THREE.Mesh(new THREE.BoxGeometry(0.6,0.05,0.6),new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xfff9c4,emissiveIntensity:0.9}));fix.position.set(x,H-0.03,z);scene.add(fix);
  });
  addFloorPlane(W,D,makeFloorTex());
  addCeilingPlane(W,D,H,0xfaf0ff);
  [{w:W,h:H,color:0xe0f7fa,x:0,y:H/2,z:-D/2,ry:0},{w:W,h:H,color:0xfce4ec,x:0,y:H/2,z:D/2,ry:Math.PI},
   {w:D,h:H,color:0xfffde7,x:-W/2,y:H/2,z:0,ry:Math.PI/2},{w:D,h:H,color:0xe8f5e9,x:W/2,y:H/2,z:0,ry:-Math.PI/2}
  ].forEach(d=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(d.w,d.h),new THREE.MeshStandardMaterial({color:d.color,roughness:0.75,side:THREE.DoubleSide}));m.position.set(d.x,d.y,d.z);m.rotation.y=d.ry;m.receiveShadow=true;scene.add(m);});
  addPanel(6,2.8,0x26c6da,0,2.4,-D/2+0.02);addPanel(1.8,1.6,0xe91e63,-4,2.8,-D/2+0.02);addPanel(1.8,1.6,0xffd600,4,2.8,-D/2+0.02);
  addPanel(2,1.4,0x7c4dff,-W/2+0.02,2.5,-4,Math.PI/2);addPanel(2,1.4,0xff7043,-W/2+0.02,2.5,4,Math.PI/2);
  addPanel(2,1.4,0x00e676,W/2-0.02,2.5,-4,-Math.PI/2);addPanel(2,1.4,0xff4081,W/2-0.02,2.5,4,-Math.PI/2);
  painting(-W/2+0.05,2.5,-1,Math.PI/2,0xfb8c00);painting(-W/2+0.05,2.5,3,Math.PI/2,0x7c4dff);
  painting(W/2-0.05,2.5,1,-Math.PI/2,0xe91e63);painting(W/2-0.05,2.5,-3,-Math.PI/2,0x00b0ff);
  const bMat=new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.4});
  const cmMat=new THREE.MeshStandardMaterial({color:0xfff8e1,roughness:0.6});
  [{w:W,x:0,z:-D/2,ry:0},{w:W,x:0,z:D/2,ry:Math.PI},{w:D,x:-W/2,z:0,ry:Math.PI/2},{w:D,x:W/2,z:0,ry:-Math.PI/2}].forEach(d=>{
    const b=new THREE.Mesh(new THREE.BoxGeometry(d.w,0.14,0.04),bMat);b.position.set(d.x,0.07,d.z);b.rotation.y=d.ry;scene.add(b);
    const c=new THREE.Mesh(new THREE.BoxGeometry(d.w,0.12,0.1),cmMat);c.position.set(d.x,H-0.06,d.z);c.rotation.y=d.ry;scene.add(c);
  });
  receptionDesk(0,-9);
  hotelSofa(-7.5,-7.5,0);hotelSofa(7.5,-7.5,Math.PI);hotelSofa(-8.5,0,Math.PI/2);hotelSofa(8.5,0,-Math.PI/2);hotelSofa(-2,7,Math.PI);hotelSofa(2,7,0);
  roundTable(-3.5,-2);roundTable(3.5,2);roundTable(0,4.5);roundTable(-5,4);
  lamp(-8,-8);lamp(8,-8);lamp(-8,8);lamp(8,8);lamp(0,-7);lamp(0,7);
  hotelPlant(-6.5,3.5);hotelPlant(6.5,-3.5);hotelPlant(1.5,7.5);hotelPlant(-1.5,-7.5);
  pillar(-7,-7);pillar(7,-7);pillar(-7,7);pillar(7,7);
}
function makeFloorTex(){
  const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');
  for(let x=0;x<8;x++)for(let y=0;y<8;y++){
    ctx.fillStyle=(x+y)%2===0?'#f5e6c8':'#a8d8ea';ctx.fillRect(x*64,y*64,64,64);
    ctx.strokeStyle='rgba(0,0,0,0.09)';ctx.strokeRect(x*64+1,y*64+1,62,62);
  }
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(5,5);return t;
}
function addFloorPlane(W,D,tex){const m=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({map:tex,roughness:0.45}));m.rotation.x=-Math.PI/2;m.receiveShadow=true;scene.add(m);}
function addCeilingPlane(W,D,H,color){const m=new THREE.Mesh(new THREE.PlaneGeometry(W,D),new THREE.MeshStandardMaterial({color,roughness:0.8}));m.rotation.x=Math.PI/2;m.position.y=H;scene.add(m);}
function addPanel(w,h,color,x,y,z,ry=0){const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshStandardMaterial({color,roughness:0.5}));m.position.set(x,y,z);m.rotation.y=ry;scene.add(m);}
function painting(x,y,z,ry,color){const g=new THREE.Group();g.add(makeMesh(new THREE.BoxGeometry(0.06,1.3,1.7),new THREE.MeshStandardMaterial({color:0xc8963c,metalness:0.5})));const art=makeMesh(new THREE.PlaneGeometry(1.5,1.1),new THREE.MeshStandardMaterial({color}));art.position.z=0.04;g.add(art);g.position.set(x,y,z);g.rotation.y=ry;scene.add(g);}
function hotelSofa(x,z,rotY){const g=new THREE.Group();const mat=new THREE.MeshStandardMaterial({color:0xf48fb1,roughness:0.9});const amat=new THREE.MeshStandardMaterial({color:0xe91e63,roughness:0.9});const cmat=new THREE.MeshStandardMaterial({color:0xfce4ec,roughness:0.8});addTo(g,new THREE.BoxGeometry(2.6,0.38,1.05),mat,[0,0.19,0]);addTo(g,new THREE.BoxGeometry(2.6,0.75,0.2),mat,[0,0.7,-0.42]);addTo(g,new THREE.BoxGeometry(0.2,0.5,1.05),amat,[-1.2,0.44,0]);addTo(g,new THREE.BoxGeometry(0.2,0.5,1.05),amat,[1.2,0.44,0]);[-0.75,0,0.75].forEach(ox=>{const cush=makeMesh(new THREE.SphereGeometry(0.27,8,8),cmat);cush.scale.y=0.55;cush.position.set(ox,0.48,0.08);g.add(cush);});g.position.set(x,0,z);g.rotation.y=rotY;g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);const isLong=Math.abs(Math.sin(rotY))<0.5;if(isLong)bc(x,z,1.4,0.65);else bc(x,z,0.65,1.4);}
function roundTable(x,z){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.82,0.82,0.07,20),new THREE.MeshStandardMaterial({color:0xf3e5f5,roughness:0.3}),[0,0.78,0]);addTo(g,new THREE.CylinderGeometry(0.92,0.88,0.02,20),new THREE.MeshStandardMaterial({color:0xfce4ec,roughness:0.9}),[0,0.815,0]);addTo(g,new THREE.CylinderGeometry(0.055,0.1,0.78,8),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.4}),[0,0.39,0]);addTo(g,new THREE.CylinderGeometry(0.04,0.065,0.22,8),new THREE.MeshStandardMaterial({color:0x26c6da}),[0,0.9,0]);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.95);}
function lamp(x,z){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.13,0.13,0.07,12),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.6}),[0,0.035,0]);addTo(g,new THREE.CylinderGeometry(0.03,0.03,2.3,8),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.75}),[0,1.15,0]);const shade=makeMesh(new THREE.ConeGeometry(0.38,0.52,16,1,true),new THREE.MeshStandardMaterial({color:0xfff9c4,side:THREE.DoubleSide,roughness:0.85}));shade.rotation.x=Math.PI;shade.position.y=2.5;g.add(shade);const pl=new THREE.PointLight(0xfff5e0,0.75,7);pl.position.y=2.3;g.add(pl);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.2);}
function hotelPlant(x,z){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.19,0.14,0.42,10),new THREE.MeshStandardMaterial({color:0xe64a19,roughness:0.9}),[0,0.21,0]);addTo(g,new THREE.CylinderGeometry(0.18,0.18,0.05,10),new THREE.MeshStandardMaterial({color:0x4e342e,roughness:1}),[0,0.44,0]);const fol=makeMesh(new THREE.SphereGeometry(0.42,10,10),new THREE.MeshStandardMaterial({color:0x2e7d32,roughness:0.9}));fol.scale.y=1.25;fol.position.y=1.0;g.add(fol);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.42);}
function pillar(x,z){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.28,0.28,5.2,12),new THREE.MeshStandardMaterial({color:0xfff8e1,roughness:0.6}),[0,2.6,0]);addTo(g,new THREE.CylinderGeometry(0.38,0.28,0.2,12),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.35}),[0,5.3,0]);addTo(g,new THREE.CylinderGeometry(0.28,0.38,0.2,12),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.35}),[0,-0.1,0]);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});scene.add(g);cc(x,z,0.32);}
function receptionDesk(x,z){const g=new THREE.Group();addTo(g,new THREE.BoxGeometry(6.2,1.1,1.3),new THREE.MeshStandardMaterial({color:0x5d4037,roughness:0.8}),[0,0.55,0]);addTo(g,new THREE.BoxGeometry(6.4,0.07,1.45),new THREE.MeshStandardMaterial({color:0xd7ccc8,roughness:0.2,metalness:0.1}),[0,1.14,0]);const sign=makeMesh(new THREE.BoxGeometry(3,0.4,0.05),new THREE.MeshStandardMaterial({color:0x00e5ff,emissive:0x00e5ff,emissiveIntensity:0.65}));sign.position.set(0,1.52,0.68);g.add(sign);const dl=new THREE.PointLight(0x00e5ff,0.5,4);dl.position.set(0,1.6,1);g.add(dl);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);bc(x,z,3.1,0.7);}

// ═══════════════════════════════════════════════════
//  MAP 2 — SUGARLAND
// ═══════════════════════════════════════════════════

function buildSugarland(){
  const W=20,D=20;
  scene.background=new THREE.Color(0x87ceeb);scene.fog=new THREE.FogExp2(0xc5e8ff,0.020);
  scene.add(new THREE.AmbientLight(0xfff0f8,0.6));scene.add(new THREE.HemisphereLight(0x87ceeb,0x66bb6a,0.45));
  const sun=new THREE.DirectionalLight(0xfffde7,1.2);sun.position.set(10,15,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);scene.add(sun);
  addFloorPlane(W,D,makeSugarFloorTex());
  buildCandyFence(W,D);
  // Fence boundary colliders (slightly inside visual fence)
  const fw=9.6;
  bc(0,-fw,fw,0.3); bc(0,fw,fw,0.3);
  bc(-fw,0,0.3,fw); bc(fw,0,0.3,fw);
  cottonCandy(-5.5,-5.5,0xf48fb1);cottonCandy(6,4,0xce93d8);cottonCandy(-7,3,0x80deea);cottonCandy(4,7.5,0xfff176);cottonCandy(0.5,-1,0xf8bbd0);cottonCandy(-3,6,0xb39ddb);
  lollipop(-3,-4,0xff4081);lollipop(5.5,2,0xff9800);lollipop(-6.5,5,0x7c4dff);lollipop(3,-7,0x00e5ff);lollipop(-1,7,0x69f0ae);lollipop(7.5,-3,0xe91e63);
  cakeTable(-3.5,2.5);cakeTable(4,-2);cakeTable(-1.5,-5.5);cakeTable(6,-6);
  gingerbreadHouse(-7.5,-7.5);
  [[-6.5,-6.5],[6.5,-6.5],[-6.5,6.5],[6.5,6.5]].forEach(([x,z])=>candyCanePillar(x,z));
  for(let i=0;i<8;i++) gumdrop(Math.cos(i*Math.PI/4)*2.8,Math.sin(i*Math.PI/4)*2.8,PALETTE[i]);
  [[-4,1],[3,-5],[-6,0],[0,-8],[8,1],[5,5]].forEach(([x,z])=>gumdrop(x,z,PALETTE[Math.floor(Math.random()*PALETTE.length)]));
}
function makeSugarFloorTex(){const c=document.createElement('canvas');c.width=c.height=512;const ctx=c.getContext('2d');ctx.fillStyle='#66bb6a';ctx.fillRect(0,0,512,512);[{x:60,y:80,r:40,col:'#a5d6a7'},{x:200,y:150,r:35,col:'#c8e6c9'},{x:350,y:80,r:50,col:'#81c784'},{x:450,y:300,r:45,col:'#a5d6a7'},{x:100,y:400,r:55,col:'#c8e6c9'},{x:300,y:400,r:40,col:'#81c784'}].forEach(p=>{ctx.fillStyle=p.col;ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();});const dc=['#ff80ab','#ea80fc','#82b1ff','#ffff8d','#ccff90'];for(let i=0;i<40;i++){ctx.fillStyle=dc[i%dc.length];ctx.beginPath();ctx.arc(Math.random()*512,Math.random()*512,3+Math.random()*5,0,Math.PI*2);ctx.fill();}const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(4,4);return t;}
function buildCandyFence(W,D){const pm=new THREE.MeshStandardMaterial({color:0xff1744,roughness:0.6}),rm=new THREE.MeshStandardMaterial({color:0xffffff,roughness:0.5}),h=W/2;for(let i=-h;i<=h;i+=2){[[i,-h],[i,h],[-h,i],[h,i]].forEach(([x,z])=>{const p=new THREE.Mesh(new THREE.CylinderGeometry(0.08,0.08,1.2,8),pm);p.position.set(x,0.6,z);scene.add(p);});}[[0,-h,W,0],[0,h,W,Math.PI],[-h,0,D,Math.PI/2],[h,0,D,-Math.PI/2]].forEach(([x,z,len,ry])=>{[0.4,0.8].forEach(oy=>{const r=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,len,6),rm);r.position.set(x,oy,z);r.rotation.z=Math.PI/2;r.rotation.y=ry;scene.add(r);});});}
function cottonCandy(x,z,color){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.04,0.04,2.2,8),new THREE.MeshStandardMaterial({color:0xffd54f,roughness:0.5}),[0,1.1,0]);const cloud=makeMesh(new THREE.SphereGeometry(0.7,10,10),new THREE.MeshStandardMaterial({color,roughness:1}));cloud.position.y=2.4;g.add(cloud);for(let i=0;i<6;i++){const a=i*Math.PI/3,r=0.45,bump=makeMesh(new THREE.SphereGeometry(0.38,8,8),new THREE.MeshStandardMaterial({color,roughness:1}));bump.position.set(Math.cos(a)*r,2.3+Math.sin(i)*0.15,Math.sin(a)*r);g.add(bump);}g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.8);}
function lollipop(x,z,color){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.05,0.05,2.5,8),new THREE.MeshStandardMaterial({color:0xff8a80}),[0,1.25,0]);const head=makeMesh(new THREE.SphereGeometry(0.55,12,12),new THREE.MeshStandardMaterial({color,roughness:0.2,metalness:0.1}));head.position.y=2.7;g.add(head);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.25);}
function cakeTable(x,z){const g=new THREE.Group();addTo(g,new THREE.CylinderGeometry(0.9,0.9,0.35,16),new THREE.MeshStandardMaterial({color:0xf48fb1,roughness:0.7}),[0,0.175,0]);addTo(g,new THREE.CylinderGeometry(0.65,0.65,0.3,16),new THREE.MeshStandardMaterial({color:0xf8bbd0,roughness:0.7}),[0,0.5,0]);addTo(g,new THREE.CylinderGeometry(0.4,0.4,0.25,16),new THREE.MeshStandardMaterial({color:0xfce4ec,roughness:0.7}),[0,0.775,0]);const ch=makeMesh(new THREE.SphereGeometry(0.1,8,8),new THREE.MeshStandardMaterial({color:0xf44336,roughness:0.4}));ch.position.y=0.95;g.add(ch);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,1.0);}
function gingerbreadHouse(x,z){const g=new THREE.Group();const wm=new THREE.MeshStandardMaterial({color:0xd4a147,roughness:0.8}),rm=new THREE.MeshStandardMaterial({color:0xe53935,roughness:0.7});addTo(g,new THREE.BoxGeometry(3,2,2.5),wm,[0,1,0]);const roof=makeMesh(new THREE.ConeGeometry(2.2,1.2,4),rm);roof.position.y=2.6;roof.rotation.y=Math.PI/4;g.add(roof);g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});scene.add(g);bc(x,z,1.7,1.4);}
function candyCanePillar(x,z){const g=new THREE.Group();for(let i=0;i<12;i++){const s=makeMesh(new THREE.CylinderGeometry(0.18,0.18,0.38,12),new THREE.MeshStandardMaterial({color:i%2===0?0xff1744:0xffffff,roughness:0.5}));s.position.y=i*0.38+0.19;g.add(s);}g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);cc(x,z,0.22);}
function gumdrop(x,z,color){const g=makeMesh(new THREE.SphereGeometry(0.18,8,8),new THREE.MeshStandardMaterial({color:parseInt(color.replace('#',''),16),roughness:0.3,metalness:0.1}));g.scale.y=1.3;g.position.set(x,0.18,z);g.castShadow=true;scene.add(g);}

// ═══════════════════════════════════════════════════
//  MAP 3 — 🏙️ CITY ROOFTOP  (Phase 4)
// ═══════════════════════════════════════════════════

function buildRooftop(){
  const W=20,D=20;
  scene.background=new THREE.Color(0x050510);
  scene.fog=new THREE.FogExp2(0x0a0a1f,0.022);
  // Night city lighting
  scene.add(new THREE.AmbientLight(0x2040aa,0.3));
  scene.add(new THREE.HemisphereLight(0x101030,0xff6020,0.5)); // cool sky, warm city glow from below
  // Harsh spotlights (security / stadium lights)
  [[-5,-5],[5,-5],[0,7]].forEach(([x,z])=>{
    const sl=new THREE.SpotLight(0xffffff,2.5,25,Math.PI/7,0.4);
    sl.position.set(x,14,z); sl.castShadow=false; scene.add(sl);
    const t=new THREE.Object3D(); t.position.set(x,0,z); scene.add(t); sl.target=t;
  });
  // Neon accent lights
  [0xe91e63,0x00e5ff,0xff9800].forEach((col,i)=>{
    const pl=new THREE.PointLight(col,0.8,8);
    pl.position.set((i-1)*7,0.5,-9); scene.add(pl);
  });

  // Concrete floor
  addFloorPlane(W,D,makeRooftopFloorTex());

  // Parapet walls (low walls around edge)
  const parapetMat=new THREE.MeshStandardMaterial({color:0x546e7a,roughness:0.9});
  [{w:W,x:0,z:-D/2},{w:W,x:0,z:D/2},{w:D,x:-W/2,z:0,ry:Math.PI/2},{w:D,x:W/2,z:0,ry:Math.PI/2}].forEach(d=>{
    const wall=new THREE.Mesh(new THREE.BoxGeometry(d.w||D,0.9,0.3),parapetMat);
    wall.position.set(d.x,0.45,d.z); if(d.ry)wall.rotation.y=d.ry; wall.castShadow=true; scene.add(wall);
  });

  // AC Units
  acUnit(-3,2,1.8,1.2);acUnit(4,-4,2.2,1.4);acUnit(-5,-3,1.5,1.5);acUnit(2,6,2.5,1.2);acUnit(6,1,1.4,1.8);

  // Water Tower (back-right corner)
  waterTower(7,-7);

  // Ventilation Ducts
  ventDuct(0,-4,4,0);ventDuct(2.5,5,3.5,Math.PI/2);ventDuct(-4,6,2.5,0);

  // Skylights (glowing panels on floor, walkable)
  [[-2,0],[3,-2],[-5,4]].forEach(([x,z])=>{
    const sl=new THREE.Mesh(new THREE.BoxGeometry(1.8,0.05,1.2),
      new THREE.MeshStandardMaterial({color:0x80d8ff,emissive:0x40a0ff,emissiveIntensity:0.6,transparent:true,opacity:0.7}));
    sl.position.set(x,0.02,z); scene.add(sl);
    const glow=new THREE.PointLight(0x40a0ff,0.4,3); glow.position.set(x,0.5,z); scene.add(glow);
  });

  // Satellite Dish
  satDish(7,7);

  // Stairwell Exit (back-left corner)
  stairExit(-7.5,-7.5);

  // Billboards
  billboard(-4,-5,0xe91e63);billboard(5,3,0x00e5ff);billboard(-7,4,0xff9800);

  // Pipes connecting AC units to water tower
  [[-3,2],[4,-4],[-5,-3]].forEach(([x,z])=>roofPipe(x,z,7,-7));
}

function makeRooftopFloorTex(){
  const c=document.createElement('canvas');c.width=c.height=512;
  const ctx=c.getContext('2d');
  // Concrete base
  ctx.fillStyle='#546e7a';ctx.fillRect(0,0,512,512);
  // Concrete texture noise
  for(let i=0;i<2000;i++){
    const v=Math.floor(Math.random()*30)-15;
    ctx.fillStyle=`rgba(${v<0?0:255},${v<0?0:255},${v<0?0:255},0.03)`;
    ctx.fillRect(Math.random()*512,Math.random()*512,2,2);
  }
  // Painted stripes (helicopter landing pad style)
  ctx.strokeStyle='rgba(255,255,0,0.25)';ctx.lineWidth=3;
  [[200,0,200,512],[256,0,256,512],[312,0,312,512]].forEach(([x1,y1,x2,y2])=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();});
  // H marking in center
  ctx.strokeStyle='rgba(255,255,255,0.15)';ctx.lineWidth=8;
  ctx.strokeRect(180,180,152,152);
  ctx.beginPath();ctx.moveTo(256,180);ctx.lineTo(256,332);ctx.stroke();
  const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(3,3);return t;
}

function acUnit(x,z,w,d){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x78909c,roughness:0.8});
  addTo(g,new THREE.BoxGeometry(w,0.9,d),mat,[0,0.45,0]);
  // Vent grilles
  const vmat=new THREE.MeshStandardMaterial({color:0x546e7a,roughness:0.9});
  for(let i=0;i<3;i++){const vg=makeMesh(new THREE.BoxGeometry(w*0.7,0.05,0.06),vmat);vg.position.set(0,0.2+i*0.25,d/2+0.01);g.add(vg);}
  // Blower circle
  const bl=makeMesh(new THREE.CylinderGeometry(0.2,0.2,0.05,12),new THREE.MeshStandardMaterial({color:0x37474f}));
  bl.position.set(0,0.9,0);bl.rotation.x=Math.PI/2;g.add(bl);
  g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);
  bc(x,z,w/2+0.05,d/2+0.05);
}

function waterTower(x,z){
  const g=new THREE.Group();
  const wmat=new THREE.MeshStandardMaterial({color:0x795548,roughness:0.85});
  const mmat=new THREE.MeshStandardMaterial({color:0x546e7a,roughness:0.7,metalness:0.3});
  // Tank
  addTo(g,new THREE.CylinderGeometry(1.1,1.1,2.5,14),wmat,[0,3.25,0]);
  // Roof cone
  addTo(g,new THREE.ConeGeometry(1.2,0.8,14),mmat,[0,4.9,0]);
  // Legs (4 poles)
  [[-0.7,-0.7],[0.7,-0.7],[-0.7,0.7],[0.7,0.7]].forEach(([ox,oz])=>{
    addTo(g,new THREE.CylinderGeometry(0.06,0.08,2,8),mmat,[ox,1,oz]);
  });
  // Cross braces
  addTo(g,new THREE.BoxGeometry(2,0.05,0.05),mmat,[0,1.5,0]);
  addTo(g,new THREE.BoxGeometry(0.05,0.05,2),mmat,[0,1.5,0]);
  g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);
  cc(x,z,1.3);
}

function ventDuct(x,z,len,rotY){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x78909c,roughness:0.7,metalness:0.2});
  addTo(g,new THREE.BoxGeometry(len,0.55,0.75),mat,[0,0.27,0]);
  // End caps
  [-len/2,len/2].forEach(ox=>{addTo(g,new THREE.BoxGeometry(0.08,0.55,0.75),new THREE.MeshStandardMaterial({color:0x546e7a})),[ox,0.27,0];});
  // Bolts along sides
  for(let i=0;i<Math.floor(len);i++){
    const b=makeMesh(new THREE.CylinderGeometry(0.04,0.04,0.05,6),new THREE.MeshStandardMaterial({color:0x37474f,metalness:0.5}));
    b.position.set(-len/2+0.5+i,0.56,0);b.rotation.x=Math.PI/2;g.add(b);
  }
  g.position.set(x,0,z);g.rotation.y=rotY;g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);
  if(Math.abs(rotY)<0.1) bc(x,z,len/2,0.45);else bc(x,z,0.45,len/2);
}

function satDish(x,z){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0xeceff1,roughness:0.5,metalness:0.2});
  // Pole
  addTo(g,new THREE.CylinderGeometry(0.06,0.06,1.5,8),new THREE.MeshStandardMaterial({color:0x78909c,metalness:0.4}),[0,0.75,0]);
  // Dish (half-sphere approximated)
  const dish=makeMesh(new THREE.SphereGeometry(0.8,12,8,0,Math.PI*2,0,Math.PI/2),mat);
  dish.position.set(0,1.5,0);dish.rotation.x=Math.PI/4;g.add(dish);
  // Arm
  addTo(g,new THREE.CylinderGeometry(0.03,0.03,0.6,6),new THREE.MeshStandardMaterial({color:0x90a4ae}),[0,1.6,0.3]);
  g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);
  cc(x,z,0.9);
}

function stairExit(x,z){
  const g=new THREE.Group();
  const mat=new THREE.MeshStandardMaterial({color:0x546e7a,roughness:0.9});
  const roof=new THREE.MeshStandardMaterial({color:0x455a64,roughness:0.8});
  addTo(g,new THREE.BoxGeometry(2.5,2.2,2.2),mat,[0,1.1,0]);
  addTo(g,new THREE.BoxGeometry(2.6,0.15,2.3),roof,[0,2.27,0]);
  // Door
  const doorMat=new THREE.MeshStandardMaterial({color:0x212121,roughness:0.7,metalness:0.2});
  addTo(g,new THREE.BoxGeometry(0.8,1.5,0.06),doorMat,[0,0.75,1.13]);
  // Door handle
  addTo(g,new THREE.CylinderGeometry(0.04,0.04,0.25,8),new THREE.MeshStandardMaterial({color:0xd4a047,metalness:0.6}),[0.25,0.75,1.2]);
  // EXIT sign
  const sign=makeMesh(new THREE.BoxGeometry(0.7,0.2,0.04),new THREE.MeshStandardMaterial({color:0x4caf50,emissive:0x4caf50,emissiveIntensity:0.8}));
  sign.position.set(0,2.05,1.14);g.add(sign);
  const gl=new THREE.PointLight(0x4caf50,0.5,3);gl.position.set(0,2.5,2);g.add(gl);
  g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});scene.add(g);
  bc(x,z,1.3,1.2);
}

function billboard(x,z,color){
  const g=new THREE.Group();
  const pmat=new THREE.MeshStandardMaterial({color:0x546e7a,roughness:0.7,metalness:0.2});
  // Poles
  [-0.5,0.5].forEach(ox=>addTo(g,new THREE.CylinderGeometry(0.06,0.08,3.5,8),pmat,[ox,1.75,0]));
  // Board
  addTo(g,new THREE.BoxGeometry(2.5,1.4,0.1),new THREE.MeshStandardMaterial({color:0x263238,roughness:0.8}),[0,3.5,0]);
  // Face (glowing ad)
  const face=makeMesh(new THREE.PlaneGeometry(2.3,1.2),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:0.4}));
  face.position.set(0,3.5,0.06);g.add(face);
  // Neon under-light
  const nl=new THREE.PointLight(color,0.8,6);nl.position.set(0,2.8,0.5);g.add(nl);
  g.position.set(x,0,z);g.traverse(m=>{if(m.isMesh)m.castShadow=true});scene.add(g);
}

function roofPipe(x1,z1,x2,z2){
  const dx=x2-x1,dz=z2-z1,len=Math.sqrt(dx*dx+dz*dz);
  const pipe=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,len,8),new THREE.MeshStandardMaterial({color:0x78909c,metalness:0.3,roughness:0.6}));
  pipe.position.set((x1+x2)/2,0.12,(z1+z2)/2);
  pipe.rotation.y=-Math.atan2(dz,dx);pipe.rotation.z=Math.PI/2;
  scene.add(pipe);
}

// ═══════════════════════════════════════════════════
//  GEOMETRY HELPERS
// ═══════════════════════════════════════════════════

function makeMesh(geo,mat){return new THREE.Mesh(geo,mat);}
function addTo(group,geo,mat,pos=[0,0,0]){const m=makeMesh(geo,mat);m.position.set(...pos);group.add(m);return m;}

// ═══════════════════════════════════════════════════
//  🎩 HAT SYSTEM
// ═══════════════════════════════════════════════════

function addHat(group, hatType){
  if(!hatType||hatType==='none') return;
  const g=new THREE.Group();g.position.y=1.7;
  switch(hatType){
    case 'crown':{
      const gm=new THREE.MeshStandardMaterial({color:0xffd700,metalness:0.7,roughness:0.2});
      addTo(g,new THREE.CylinderGeometry(0.23,0.2,0.12,16),gm,[0,0,0]);
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5,sp=makeMesh(new THREE.ConeGeometry(0.04,0.2,6),gm);sp.position.set(Math.cos(a)*0.17,0.16,Math.sin(a)*0.17);g.add(sp);}
      const gemMat=new THREE.MeshStandardMaterial({color:0xff1744,roughness:0.1,metalness:0.1});
      for(let i=0;i<5;i++){const a=i*Math.PI*2/5+0.3,gem=makeMesh(new THREE.SphereGeometry(0.04,6,6),gemMat);gem.position.set(Math.cos(a)*0.19,0.06,Math.sin(a)*0.19);g.add(gem);}
      break;}
    case 'tophat':{
      const hm=new THREE.MeshStandardMaterial({color:0x1a1a1a,roughness:0.8});
      addTo(g,new THREE.CylinderGeometry(0.15,0.18,0.38,16),hm,[0,0.19,0]);
      addTo(g,new THREE.CylinderGeometry(0.28,0.28,0.03,16),hm,[0,0,0]);
      addTo(g,new THREE.CylinderGeometry(0.155,0.155,0.06,16),new THREE.MeshStandardMaterial({color:0x880000,roughness:0.7}),[0,0.06,0]);
      break;}
    case 'catears':{
      const em=new THREE.MeshStandardMaterial({color:0xff80ab,roughness:0.8});
      const im=new THREE.MeshStandardMaterial({color:0xffcdd2,roughness:0.8});
      [-0.14,0.14].forEach(ox=>{
        const ear=makeMesh(new THREE.ConeGeometry(0.075,0.2,4),em);ear.position.set(ox,0.14,0);ear.rotation.z=ox<0?-0.15:0.15;g.add(ear);
        const inner=makeMesh(new THREE.ConeGeometry(0.04,0.12,4),im);inner.position.set(ox,0.14,0.02);inner.rotation.z=ox<0?-0.15:0.15;g.add(inner);
      });break;}
    case 'cap':{
      const cm=new THREE.MeshStandardMaterial({color:0x1565c0,roughness:0.7});
      const top=makeMesh(new THREE.SphereGeometry(0.22,12,8,0,Math.PI*2,0,Math.PI/2),cm);top.scale.y=0.6;g.add(top);
      addTo(g,new THREE.CylinderGeometry(0.28,0.28,0.03,16,1,false,Math.PI*0.75,Math.PI*1.3),cm,[0,0.02,0.12]);
      addTo(g,new THREE.CylinderGeometry(0.04,0.04,0.04,8),new THREE.MeshStandardMaterial({color:0x0d47a1}),[0,0.13,0]);
      break;}
    case 'halo':{
      const hm=new THREE.MeshStandardMaterial({color:0xfff176,emissive:0xffd600,emissiveIntensity:0.7,metalness:0.3});
      addTo(g,new THREE.TorusGeometry(0.2,0.03,8,24),hm,[0,0.28,0]);
      const glow=new THREE.PointLight(0xffd600,0.6,2);glow.position.y=0.28;g.add(glow);
      break;}
  }
  group.add(g);
}

// ═══════════════════════════════════════════════════
//  PLAYER CHARACTER
// ═══════════════════════════════════════════════════

function createChar(hexColor,name,customization){
  const g=new THREE.Group();
  const bodyC=customization?.skinColor
    ?parseInt(customization.skinColor.replace('#',''),16)
    :(typeof hexColor==='number'?hexColor:parseInt(String(hexColor).replace('#',''),16));
  const c=bodyC;
  // Shared camo material — all body parts use the same instance
  // so one uniform update applies to the entire character
  const bodyMat = createCamoMaterial(c);
  const lLeg=addCharPart(g,new THREE.BoxGeometry(0.23,0.56,0.23),bodyMat,[-0.16,0.28,0]);
  const rLeg=addCharPart(g,new THREE.BoxGeometry(0.23,0.56,0.23),bodyMat,[ 0.16,0.28,0]);
  const body=addCharPart(g,new THREE.BoxGeometry(0.56,0.72,0.28),bodyMat,[0,0.9,0]);
  const lArm=addCharPart(g,new THREE.BoxGeometry(0.19,0.62,0.19),bodyMat,[-0.38,0.88,0]);
  const rArm=addCharPart(g,new THREE.BoxGeometry(0.19,0.62,0.19),bodyMat,[ 0.38,0.88,0]);
  const head=addCharPart(g,new THREE.BoxGeometry(0.44,0.44,0.44),bodyMat,[0,1.48,0]);
  const eyeC=c===0xff4500?0xffff00:0x222222;
  const eyeM=new THREE.MeshStandardMaterial({color:eyeC});
  addCharPart(g,new THREE.SphereGeometry(0.045,6,6),eyeM,[-0.1,1.52,0.22]);
  addCharPart(g,new THREE.SphereGeometry(0.045,6,6),eyeM,[ 0.1,1.52,0.22]);
  // Hat
  if(customization?.hat) addHat(g,customization.hat);
  g.userData={lLeg,rLeg,body,lArm,rArm,head,color:c,bodyMat,walkT:0,moving:false,isGhost:false,emote:null,emoteT:0};
  if(name){const sp=makeLabel(name);sp.position.y=2.45;g.add(sp);}
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});
  return g;
}
function addCharPart(group,geo,mat,pos){const m=new THREE.Mesh(geo,mat);m.position.set(...pos);group.add(m);return m;}
function makeLabel(name){
  const cv=document.createElement('canvas');cv.width=256;cv.height=64;
  const ctx=cv.getContext('2d');ctx.fillStyle='rgba(0,0,0,0.55)';ctx.fillRect(4,8,248,48);
  ctx.fillStyle='#fff';ctx.font='bold 26px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name.slice(0,14),128,32);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));
  sp.scale.set(1.6,0.42,1);return sp;
}
function spawnPlayer(pdata){
  const hex=parseInt((pdata.bodyColor||'#ffffff').replace('#',''),16);
  const mesh=createChar(hex,pdata.name,pdata.customization);
  mesh.position.set(pdata.position.x,0,pdata.position.z);mesh.rotation.y=pdata.rotY||0;
  // Tag every child mesh with playerId for raycaster hit-detection
  mesh.traverse(m=>{ if(m.isMesh) m.userData.playerId = pdata.id; });
  scene.add(mesh); playerMeshes[pdata.id]=mesh;
  if(pdata.role==='seeker') setSeekerGlow(pdata.id,true);
}
function setCharColor(id,colorStr){
  const mesh=playerMeshes[id]; if(!mesh) return;
  const c=parseInt(colorStr.replace('#',''),16);
  if(mesh.userData.bodyMat){
    // Direct colour update on the shared camo material (no clone = shader preserved)
    mesh.userData.bodyMat.color.setHex(c);
  } else {
    // Fallback for ghost / hat sub-materials
    mesh.traverse(m=>{
      if(m.isMesh&&m.material&&m.material.color){
        const cur=m.material.color.getHex();
        if(cur!==0xffff00&&cur!==0x222222&&cur!==0xffd700&&cur!==0xff1744&&cur!==0xfff176&&cur!==0x1a1a1a&&cur!==0xff80ab&&cur!==0x1565c0){
          m.material.color.setHex(c);
        }
      }
    });
  }
  mesh.userData.color=c;
}
function applyPose(id,pose){
  const m=playerMeshes[id];if(!m)return;
  m.scale.set(1,1,1);m.position.y=0;
  if(pose==='crouch'){m.scale.y=0.58;m.position.y=-0.35;}
  else if(pose==='wall-flat'){m.scale.z=0.12;}
}
// ─ Seeker glow / un-ghost ───────────────────────────────────────────────
function setSeekerGlow(id, on){
  const mesh=playerMeshes[id]; if(!mesh) return;
  // Remove old glow
  ['seekerGlow','seekerCorona'].forEach(n=>{ const o=mesh.getObjectByName(n); if(o) mesh.remove(o); });
  if(!on) return;
  const light=new THREE.PointLight(0xFF4500,1.0,5);
  light.name='seekerGlow'; light.position.set(0,1.2,0); mesh.add(light);
  const corona=makeMesh(
    new THREE.SphereGeometry(0.8,8,8),
    new THREE.MeshBasicMaterial({color:0xFF4500,transparent:true,opacity:0.07,side:THREE.BackSide,depthWrite:false})
  );
  corona.name='seekerCorona'; corona.position.y=0.8; mesh.add(corona);
}
function unGhost(id){
  const mesh=playerMeshes[id]; if(!mesh) return;
  mesh.traverse(m=>{
    if(m.isMesh&&m.material&&m.material.transparent){
      m.material=m.material.clone();
      m.material.transparent=false; m.material.opacity=1; m.material.depthWrite=true;
    }
  });
  mesh.userData.isGhost=false;
}
function pulseSeekerGlows(){
  const t=clock.getElapsedTime();
  Object.values(playerMeshes).forEach(mesh=>{
    const gl=mesh.getObjectByName('seekerGlow');
    if(gl) gl.intensity=0.7+Math.sin(t*3)*0.35;
  });
}
function makeGhost(id){
  const mesh=playerMeshes[id]; if(!mesh) return;
  const ghostMat=new THREE.MeshStandardMaterial({
    color:0x9090cc, transparent:true,
    opacity:id===myId?0.55:0.28, depthWrite:false, roughness:0.5,
  });
  mesh.traverse(m=>{
    if(m.isMesh&&m.material){
      const cur=m.material.color?.getHex();
      if(cur===0xffff00||cur===0x222222) return;
      m.material=ghostMat;
    }
  });
  mesh.userData.bodyMat=null; mesh.userData.isGhost=true;
}

// ═══════════════════════════════════════════════════
//  😊  EMOTES  (Phase 4)
// ═══════════════════════════════════════════════════

// ─ Desktop fallback: E key toggles the flat button row ──────────────
function toggleEmotePanel(){
  emotePanelOpen=!emotePanelOpen;
  const el=document.getElementById('emoteRow');
  if(el) el.style.display=emotePanelOpen?'flex':'none';
}

// ─ Radial Emote Wheel (mobile hold-and-drag) ─────────────────
function initEmoteWheel(){
  if(ewInitialized) return;
  ewInitialized=true;

  // Build wheel DOM from EW_DEFS if not already in HTML
  let wheel=document.getElementById('emoteWheel');
  if(!wheel){
    wheel=document.createElement('div');
    wheel.id='emoteWheel';
    wheel.innerHTML=`
      <div class="ew-bg"></div>
      <div class="ew-center"></div>
      ${EW_DEFS.map(d=>`
        <div class="ew-item" id="ewi-${d.key}"
             style="--tx:${d.tx}px;--ty:${d.ty}px">
          ${EMOTES.find(e=>e.key===d.key)?.emoji||''}
          <span>${d.key}</span>
        </div>`).join('')}
      <div class="ew-hint">release to emote</div>
    `;
    document.getElementById('gameContainer')?.appendChild(wheel);
  }

  const btn=document.getElementById('emoteWheelBtn');
  if(!btn) return;

  // ── TOUCH (mobile): press → show wheel, drag → highlight, lift → trigger ──
  btn.addEventListener('touchstart', e=>{
    e.preventDefault();
    const r=btn.getBoundingClientRect();
    ewCenter={ x:r.left+r.width/2, y:r.top+r.height/2 };
    ewShowWheel(ewCenter.x, ewCenter.y);
  },{ passive:false });

  btn.addEventListener('touchmove', e=>{
    e.preventDefault();
    if(!ewActive) return;
    const t=e.touches[0];
    ewUpdateHighlight(t.clientX-ewCenter.x, t.clientY-ewCenter.y);
  },{ passive:false });

  btn.addEventListener('touchend', e=>{
    e.preventDefault();
    if(ewHighlighted){ triggerEmote(ewHighlighted); lastEmote=ewHighlighted; }
    else if(ewActive){ triggerEmote(lastEmote); } // quick tap = repeat last
    ewHideWheel();
  },{ passive:false });

  btn.addEventListener('touchcancel', e=>{ e.preventDefault(); ewHideWheel(); },{ passive:false });

  // ── MOUSE (desktop): click shows wheel too (so it works without keyboard) ──
  btn.addEventListener('mousedown', e=>{
    e.preventDefault();
    const r=btn.getBoundingClientRect();
    ewCenter={ x:r.left+r.width/2, y:r.top+r.height/2 };
    ewShowWheel(ewCenter.x, ewCenter.y);
  });
  document.addEventListener('mousemove', e=>{
    if(!ewActive) return;
    ewUpdateHighlight(e.clientX-ewCenter.x, e.clientY-ewCenter.y);
  });
  document.addEventListener('mouseup', e=>{
    if(!ewActive) return;
    if(ewHighlighted){ triggerEmote(ewHighlighted); lastEmote=ewHighlighted; }
    ewHideWheel();
  });
}

function ewShowWheel(cx, cy){
  const wheel=document.getElementById('emoteWheel');
  if(!wheel) return;
  // Clamp to screen so wheel stays visible
  const R=100; // half of 200px wheel
  const sx=Math.max(R, Math.min(innerWidth-R,  cx));
  const sy=Math.max(R, Math.min(innerHeight-R, cy));
  wheel.style.left=sx+'px';
  wheel.style.top =sy+'px';
  wheel.classList.remove('ew-hide');
  wheel.classList.add('ew-visible');
  ewActive=true; ewHighlighted=null;
  EW_DEFS.forEach(d=>document.getElementById('ewi-'+d.key)?.classList.remove('hl'));
  SFX.emote?.();
}

function ewHideWheel(){
  const wheel=document.getElementById('emoteWheel');
  if(wheel){
    wheel.classList.remove('ew-visible');
    wheel.classList.add('ew-hide');
    setTimeout(()=>wheel.classList.remove('ew-hide'), 200);
  }
  ewActive=false; ewHighlighted=null;
}

function ewUpdateHighlight(dx, dy){
  const dist=Math.sqrt(dx*dx+dy*dy);
  const DEAD=24; // px dead-zone from center
  if(dist<DEAD){
    if(ewHighlighted){ document.getElementById('ewi-'+ewHighlighted)?.classList.remove('hl'); ewHighlighted=null; }
    const hint=document.querySelector('.ew-hint');
    if(hint) hint.textContent='release to emote';
    return;
  }
  // Math angle: 0=right, 90=up (flip screen-y)
  const mathAngle=(Math.atan2(-dy, dx)*180/Math.PI+360)%360;
  // Find closest emote angle (circular distance)
  const closest=EW_DEFS.reduce((best,e)=>{
    const diff=Math.abs(((mathAngle-e.angle+180+360)%360)-180);
    const bd  =Math.abs(((mathAngle-best.angle+180+360)%360)-180);
    return diff<bd?e:best;
  });
  if(closest.key!==ewHighlighted){
    if(ewHighlighted) document.getElementById('ewi-'+ewHighlighted)?.classList.remove('hl');
    ewHighlighted=closest.key;
    document.getElementById('ewi-'+ewHighlighted)?.classList.add('hl');
    const emoji=EMOTES.find(e=>e.key===ewHighlighted)?.emoji||'';
    const hint=document.querySelector('.ew-hint');
    if(hint) hint.textContent=`${emoji} ${ewHighlighted}`;
    SFX.pose?.(); // soft click on each sector change
  }
}

function triggerEmote(key){
  socket.emit('emote',{key});
  SFX.emote();
}

function playEmote(id,key){
  const mesh=playerMeshes[id];if(!mesh)return;
  mesh.userData.emote=key;mesh.userData.emoteT=0;
  const emoji=EMOTES.find(e=>e.key===key)?.emoji||'❓';
  showEmojiParticle(mesh.position,emoji);
}

function showEmojiParticle(worldPos,emoji){
  const cv=document.createElement('canvas');cv.width=cv.height=128;
  const ctx=cv.getContext('2d');ctx.font='80px serif';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(emoji,64,64);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));
  sp.scale.set(1.2,1.2,1);sp.position.set(worldPos.x,3.0,worldPos.z);
  scene.add(sp);
  emoteParticles.push({sprite:sp,startTime:clock.getElapsedTime()});
}

function updateEmoteParticles(){
  const now=clock.getElapsedTime();
  for(let i=emoteParticles.length-1;i>=0;i--){
    const p=emoteParticles[i];const t=now-p.startTime;
    if(t>2.2){scene.remove(p.sprite);emoteParticles.splice(i,1);continue;}
    p.sprite.position.y=3.0+t*0.4;p.sprite.material.opacity=Math.max(0,1-t/2);
  }
}

// ═══════════════════════════════════════════════════
//  WALKING ANIMATION + EMOTE ANIMATION
// ═══════════════════════════════════════════════════

function animateChars(dt){
  Object.entries(playerMeshes).forEach(([id,m])=>{
    const u=m.userData;if(!u.lLeg) return;
    // Emote animation takes priority
    if(u.emote){
      u.emoteT+=dt;
      const t=u.emoteT;
      switch(u.emote){
        case 'wave':
          u.rArm.rotation.z=Math.sin(t*8)*0.6+0.4;
          u.rArm.rotation.x=0;break;
        case 'celebrate':
          u.lArm.rotation.z=-Math.PI/3-Math.abs(Math.sin(t*5))*0.3;
          u.rArm.rotation.z= Math.PI/3+Math.abs(Math.sin(t*5))*0.3;
          if(u.body) u.body.position.y=0.9+Math.abs(Math.sin(t*6))*0.1;break;
        case 'sleep':
          u.lArm.rotation.x=0.4;u.rArm.rotation.x=0.4;
          if(u.head) u.head.rotation.x=0.3;break;
        case 'taunt':
          u.rArm.rotation.z=Math.PI/2;u.rArm.rotation.x=Math.sin(t*5)*0.3;break;
      }
      if(u.emoteT>2){u.emote=null;u.emoteT=0;u.lArm.rotation.set(0,0,0);u.rArm.rotation.set(0,0,0);if(u.head)u.head.rotation.x=0;if(u.body)u.body.position.y=0.9;}
      return;
    }
    // Walk animation
    if(u.moving){
      const prev=u.walkT; u.walkT+=dt*9;
      const s=Math.sin(u.walkT);
      u.lLeg.rotation.x= s*0.44;u.rLeg.rotation.x=-s*0.44;
      u.lArm.rotation.x=-s*0.32;u.rArm.rotation.x= s*0.32;
      if(u.body) u.body.position.y=0.9+Math.abs(Math.sin(u.walkT*2))*0.04;
      if(id===myId&&Math.floor(prev/Math.PI)!==Math.floor(u.walkT/Math.PI)) SFX.footstep();
    }else{
      u.lLeg.rotation.x=lerp(u.lLeg.rotation.x,0,0.2);u.rLeg.rotation.x=lerp(u.rLeg.rotation.x,0,0.2);
      u.lArm.rotation.x=lerp(u.lArm.rotation.x,0,0.2);u.rArm.rotation.x=lerp(u.rArm.rotation.x,0,0.2);
      if(u.body) u.body.position.y=lerp(u.body.position.y,0.9,0.2);
    }
  });
}
function lerp(a,b,t){return a+(b-a)*t;}

// ═══════════════════════════════════════════════════
//  MOVEMENT & GAME LOOP
// ═══════════════════════════════════════════════════

const SPEED=5.5;
function updateMovement(dt){
  if(!myMesh) return;
  // Seekers are frozen during prep — they cannot spy on hiders
  if(gameState==='prep' && myRole==='seeker'){ myMesh.userData.moving=false; return; }
  const spd=myRole==='ghost'?SPEED*0.55:SPEED;
  const fwd=new THREE.Vector3(-Math.sin(camTheta),0,-Math.cos(camTheta));
  const right=new THREE.Vector3(Math.cos(camTheta),0,-Math.sin(camTheta));
  let dx=0,dz=0;
  if(keys['KeyW']||keys['ArrowUp'])    {dx+=fwd.x;  dz+=fwd.z;}
  if(keys['KeyS']||keys['ArrowDown'])  {dx-=fwd.x;  dz-=fwd.z;}
  if(keys['KeyA']||keys['ArrowLeft'])  {dx-=right.x;dz-=right.z;}
  if(keys['KeyD']||keys['ArrowRight']) {dx+=right.x;dz+=right.z;}
  dx+=fwd.x*(-joystick.y)+right.x*joystick.x;
  dz+=fwd.z*(-joystick.y)+right.z*joystick.x;
  const len=Math.sqrt(dx*dx+dz*dz);
  if(len>0.001){
    dx/=len;dz/=len;
    let nx=myMesh.position.x+dx*spd*dt, nz=myMesh.position.z+dz*spd*dt;
    nx=Math.max(-WALL_LIM,Math.min(WALL_LIM,nx));
    nz=Math.max(-WALL_LIM,Math.min(WALL_LIM,nz));
    if(myRole!=='ghost')[nx,nz]=resolveCollision(nx,nz);
    myMesh.position.x=nx;myMesh.position.z=nz;
    myMesh.rotation.y=Math.atan2(dx,dz);myMesh.userData.moving=true;
    socket.emit('move',{pos:{x:nx,y:0,z:nz},rotY:myMesh.rotation.y});
  }else{myMesh.userData.moving=false;}
}
function updateCamera(){
  if(!myMesh) return;
  const px=myMesh.position.x,pz=myMesh.position.z;
  camera.position.set(px+camDist*Math.sin(camTheta)*Math.cos(camPhi),camDist*Math.sin(camPhi)+1.2,pz+camDist*Math.cos(camTheta)*Math.cos(camPhi));
  camera.lookAt(px,1.0,pz);
}

function loop(){
  if(!animating) return;
  requestAnimationFrame(loop);
  const dt=clock.getDelta();
  updateMovement(dt);updateCamera();animateChars(dt);updateDetectRing(dt);updateEmoteParticles();
  camoTick+=dt;if(camoTick>1.5){camoTick=0;computeCamoScore();}
  updateMinimap();
  pulseSeekerGlows();
  // Tick time uniform on all camo materials (drives noise animation)
  { const t=clock.getElapsedTime();
    Object.values(playerMeshes).forEach(m=>{
      if(m.userData.bodyMat?.userData.camoUniforms)
        m.userData.bodyMat.userData.camoUniforms.utime.value=t;
    }); }
  updateCrosshair();
  updateShimmer(dt);
  // Detection cooldown tick
  if(detectionCooldown > 0) detectionCooldown = Math.max(0, detectionCooldown - dt);
  renderer.render(scene,camera);
}

// ═══════════════════════════════════════════════════
//  CAMO SCORE
// ═══════════════════════════════════════════════════

// ── Scan directions for raycasting ──────────────────────────────
const _SCAN_DIRS = [
  [1,0,0],[-1,0,0],[0,0,1],[0,0,-1],
  [0.707,0,0.707],[-0.707,0,0.707],[0.707,0,-0.707],[-0.707,0,-0.707],
  [0,-1,0], // floor
].map(d=>new THREE.Vector3(...d).normalize());

function computeEnhancedCamoScore(){
  if(!myMesh || myRole!=='hider' || !scene) return;

  const bodyC = new THREE.Color(myMesh.userData.color || 0xffffff);
  const pos   = myMesh.position.clone(); pos.y += 0.8; // sample at chest height
  _scanRay.far = 4.5;

  // ── 1. Raycast 9 directions, collect surface colours ──────────
  const hits = [];
  _SCAN_DIRS.forEach(dir => {
    _scanRay.set(pos, dir);
    const ix = _scanRay.intersectObjects(scene.children, true);
    const h  = ix.find(i => i.object.isMesh && !i.object.userData.playerId);
    if(h?.object.material?.color){
      const sc = h.object.material.color;
      const w  = 1 / (h.distance + 0.3);              // closer = more weight

      // Luminance-weighted Delta-E approximation (perceptual colour distance)
      const dr = bodyC.r - sc.r, dg = bodyC.g - sc.g, db = bodyC.b - sc.b;
      const de = Math.sqrt(dr*dr*0.299 + dg*dg*0.587 + db*db*0.114);
      const match = Math.max(0, 1 - de * 2.2);        // de ≥ 0.45 → 0% match

      hits.push({ match, w, color: sc.clone(), dist: h.distance });
    }
  });

  // ── 2. Colour proximity factor (0-100, weight 55%) ────────────
  let colorFactor = 0;
  let bestEnvColor = new THREE.Color(0.55, 0.55, 0.55);
  if(hits.length){
    const W = hits.reduce((s,h)=>s+h.w, 0);
    colorFactor = hits.reduce((s,h)=>s+h.match*h.w, 0) / W * 100;
    // Weighted-average env colour for shader
    bestEnvColor.setRGB(
      hits.reduce((s,h)=>s+h.color.r*h.w,0)/W,
      hits.reduce((s,h)=>s+h.color.g*h.w,0)/W,
      hits.reduce((s,h)=>s+h.color.b*h.w,0)/W,
    );
  }

  // ── 3. Surface proximity factor (0-100, weight 20%) ───────────
  const minDist       = hits.length ? Math.min(...hits.map(h=>h.dist)) : 4.5;
  const proximityFactor = Math.max(0, 1 - minDist/3) * 100;

  // ── 4. Pose bonus (0-15 pts) ──────────────────────────────────
  const poseBonus = curPose==='wall-flat' ? 15 : curPose==='crouch' ? 8 : 0;

  // ── 5. Movement penalty (0-25 pts) ────────────────────────────
  const movePenalty = myMesh.userData.moving ? 25 : 0;

  // ── 6. Final weighted score ───────────────────────────────────
  const raw  = colorFactor*0.55 + proximityFactor*0.20 + poseBonus - movePenalty;
  camoScore  = Math.max(0, Math.min(100, Math.round(raw)));

  // ── 7. Push to camo bar + shader uniforms ─────────────────────
  updateCamoUI(camoScore, { colorFactor, proximityFactor, poseBonus, movePenalty });

  if(myMesh.userData.bodyMat?.userData.camoUniforms){
    const u = myMesh.userData.bodyMat.userData.camoUniforms;
    u.envColor.value.copy(bestEnvColor);
    u.camoScore.value = camoScore / 100;
  }

  socket.emit('camoUpdate', { score: camoScore });
}

// Keep old name as alias (called in loop)
const computeCamoScore = computeEnhancedCamoScore;
function updateCamoUI(score, breakdown){
  const fill=document.getElementById('camoFill'),num=document.getElementById('camoNum');
  if(!fill||!num) return;
  fill.style.width=score+'%'; num.textContent=score+'%';
  if(score>=70) num.style.color='#69f0ae';
  else if(score>=40) num.style.color='#ffeb3b';
  else num.style.color='#ff5252';

  // Breakdown line (shows contributing factors)
  if(breakdown){
    const d=document.getElementById('camoDetail'); if(!d) return;
    const parts=[];
    parts.push(`🎨${Math.round(breakdown.colorFactor)}%`);
    parts.push(`📍${Math.round(breakdown.proximityFactor)}%`);
    if(breakdown.poseBonus)  parts.push(`🕴️+${breakdown.poseBonus}`);
    if(breakdown.movePenalty) parts.push(`⚡-${breakdown.movePenalty}`);
    d.textContent = parts.join('  ');
  }
}

// ═══════════════════════════════════════════════════
//  MOBILE CONTROLS
// ═══════════════════════════════════════════════════

function initJoystick(){
  if(joyInitd||!window.nipplejs) return;joyInitd=true;
  const jm=nipplejs.create({zone:document.getElementById('joystickZone'),mode:'static',position:{left:'50%',top:'50%'},color:'rgba(255,255,255,0.35)',size:110});
  jm.on('move',(_,d)=>{const a=d.angle.radian,f=Math.min(d.force,1);joystick.x=Math.cos(a)*f;joystick.y=Math.sin(a)*f;});
  jm.on('end',()=>{joystick.x=0;joystick.y=0;});
}
function initCameraControls(){
  const cv = document.getElementById('gameCanvas');

  // ── TOUCH: track each finger by its identifier ──────────────────
  // This prevents the joystick touch and camera-drag touch from
  // interfering — each gets its own identity tracked across events.
  let camId   = -1;          // identifier of the camera-rotation finger
  let camLast = {x:0,y:0};
  let pinchIds = [];          // [id0, id1] of the two pinch fingers
  let pinchD0  = 0;

  function p2d(a,b){ const dx=a.clientX-b.clientX,dy=a.clientY-b.clientY; return Math.sqrt(dx*dx+dy*dy); }

  // Is this touch landing inside the joystick zone?
  function onJoystick(touch){
    const el=document.getElementById('joystickZone');
    if(!el) return false;
    const r=el.getBoundingClientRect();
    return touch.clientX>=r.left && touch.clientX<=r.right &&
           touch.clientY>=r.top  && touch.clientY<=r.bottom;
  }
  // Is this touch on any UI button?
  function onButton(touch){
    const el=document.elementFromPoint(touch.clientX,touch.clientY);
    return el && (el.tagName==='BUTTON'||el.closest('#actionBtns')||el.closest('#emoteRow')||el.closest('#paintPanel')||el.closest('.ew-item'));
  }

  cv.addEventListener('touchstart', e=>{
    const all = Array.from(e.touches);

    // Two-finger → start / update pinch
    if(all.length >= 2){
      if(pinchIds.length < 2){
        pinchIds = [all[0].identifier, all[1].identifier];
        pinchD0  = p2d(all[0], all[1]);
      }
      camId = -1; // cancel any single-touch drag
      return;
    }

    // Single finger
    const t = e.changedTouches[0];
    if(onJoystick(t) || onButton(t)) return; // let nipplejs / buttons handle it
    if(camId === -1){
      camId   = t.identifier;
      camLast = {x:t.clientX, y:t.clientY};
    }
  },{passive:true});

  cv.addEventListener('touchmove', e=>{
    const all = Array.from(e.touches);

    // Pinch zoom (2 fingers)
    if(pinchIds.length === 2 && all.length >= 2){
      const t0 = all.find(t=>t.identifier===pinchIds[0]);
      const t1 = all.find(t=>t.identifier===pinchIds[1]);
      if(t0 && t1){
        const d = p2d(t0,t1);
        camDist = Math.max(CAM_D_MIN, Math.min(CAM_D_MAX, camDist+(pinchD0-d)*0.03));
        pinchD0 = d;
      }
      return; // don't also rotate while pinching
    }

    // Camera rotation (1 tracked finger)
    const ct = all.find(t=>t.identifier===camId);
    if(ct){
      camTheta -= (ct.clientX-camLast.x)*0.005;
      camPhi    = Math.max(0.1, Math.min(1.25, camPhi-(ct.clientY-camLast.y)*0.005));
      camLast   = {x:ct.clientX, y:ct.clientY};
    }
  },{passive:true});

  cv.addEventListener('touchend', e=>{
    Array.from(e.changedTouches).forEach(t=>{
      if(t.identifier === camId) camId = -1;
      if(pinchIds.includes(t.identifier)){
        pinchIds = pinchIds.filter(id=>id!==t.identifier);
        // One finger lifted from pinch → surviving finger becomes camera drag
        if(pinchIds.length === 1){
          const rem = Array.from(e.touches).find(tt=>tt.identifier===pinchIds[0]);
          if(rem && !onJoystick(rem) && !onButton(rem)){
            camId   = rem.identifier;
            camLast = {x:rem.clientX, y:rem.clientY};
          }
          pinchIds = [];
        }
      }
    });
  },{passive:true});

  cv.addEventListener('touchcancel', ()=>{ camId=-1; pinchIds=[]; },{passive:true});

  // ── MOUSE (desktop) ─────────────────────────────────────────────
  let mDown=false, mLast={x:0,y:0};
  cv.addEventListener('mousedown',e=>{if(paintOpen)return;mDown=true;mLast={x:e.clientX,y:e.clientY};});
  document.addEventListener('mousemove',e=>{
    if(!mDown)return;
    camTheta -= (e.clientX-mLast.x)*0.004;
    camPhi    = Math.max(0.1,Math.min(1.25,camPhi-(e.clientY-mLast.y)*0.004));
    mLast     = {x:e.clientX,y:e.clientY};
  });
  document.addEventListener('mouseup',()=>{mDown=false;});
  cv.addEventListener('wheel',e=>{
    camDist=Math.max(CAM_D_MIN,Math.min(CAM_D_MAX,camDist+e.deltaY*0.01));
  },{passive:true});
}

// ═══════════════════════════════════════════════════
//  PAINT SYSTEM
// ═══════════════════════════════════════════════════

function buildPalette(){
  const c=document.getElementById('swatches');c.innerHTML='';
  PALETTE.forEach(col=>{const d=document.createElement('div');d.className='swatch';d.style.background=col;d.onclick=()=>paintSelf(col);c.appendChild(d);});
  document.getElementById('cpick').addEventListener('input',e=>paintSelf(e.target.value));
}
function togglePaint(){if(myRole!=='hider')return toast('Only hiders can paint! 🦎');paintOpen=!paintOpen;document.getElementById('paintPanel').style.display=paintOpen?'block':'none';}
function paintSelf(color){curColor=color;setCharColor(myId,color);socket.emit('paintBody',{color});SFX.paint();document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('sel',s.style.backgroundColor===color||s.style.background===color));}
function onCanvasClick(e){
  if(myRole==='seeker' && gameState==='hunt'){ attemptDetection(); return; }
  if(!paintOpen) return;
  renderer.render(scene,camera);const gl=renderer.getContext(),px=new Uint8Array(4);
  const cy=renderer.domElement.height-Math.round(e.clientY*devicePixelRatio);
  const cx=Math.round(e.clientX*devicePixelRatio);
  gl.readPixels(cx,cy,1,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
  if(px[0]+px[1]+px[2]<10) return;
  const col=`#${px[0].toString(16).padStart(2,'0')}${px[1].toString(16).padStart(2,'0')}${px[2].toString(16).padStart(2,'0')}`;
  paintSelf(col);toast('Sampled! 🎨');
}

// ═══════════════════════════════════════════════════
//  POSE SYSTEM
// ═══════════════════════════════════════════════════

function cyclePose(){
  if(myRole!=='hider') return toast('Only hiders can pose!');
  const i=POSES.indexOf(curPose);curPose=POSES[(i+1)%POSES.length];
  applyPose(myId,curPose);socket.emit('setPose',{pose:curPose});SFX.pose();
  toast(`Pose: ${curPose} 🕴️`);
}

// ═══════════════════════════════════════════════════
//  TAGGING
// ═══════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  🎯  CROSSHAIR DETECTION SYSTEM
// ═══════════════════════════════════════════════════════════════

const _ray = new THREE.Raycaster();
let aimingAtPlayer    = null;   // player ID currently in crosshair
let aimingSuspicion   = 0;      // 0-100
let detectionCooldown = 0;      // seconds remaining
let shimmerT          = 0;

// ── Suspicion formula ────────────────────────────────────────────
function calcSuspicion(dist, camo, isMoving){
  const dF = Math.max(0, 1 - dist / 18);
  const cF = 1 - camo / 100;
  const mB = isMoving ? 0.35 : 0;
  return Math.min(100, Math.max(0,
    Math.round((dF*0.25 + cF*0.4 + mB + dF*cF*0.35) * 100)
  ));
}

// ── Crosshair + suspicion ring update (every frame) ─────────────
function updateCrosshair(){
  const ch = document.getElementById('crosshair');
  if(!ch) return;
  if(myRole !== 'seeker' || gameState !== 'hunt'){
    ch.style.display = 'none'; return;
  }
  ch.style.display = 'block';

  if(detectionCooldown > 0 || !myMesh){
    ch.className = 'cd';
    setSuspicionRing(0, '');
    const lbl = document.getElementById('chLabel');
    if(lbl) lbl.textContent = detectionCooldown > 0 ? detectionCooldown.toFixed(1)+'s' : '';
    return;
  }

  _ray.setFromCamera(new THREE.Vector2(0,0), camera);
  const targets = [];
  Object.entries(playerMeshes).forEach(([id, mesh])=>{
    if(id===myId||!mesh||mesh.userData.isGhost) return;
    mesh.traverse(m=>{ if(m.isMesh) targets.push(m); });
  });
  const hits = _ray.intersectObjects(targets, false);

  const lbl = document.getElementById('chLabel');
  if(hits.length > 0){
    const hitId = hits[0].object.userData.playerId;
    if(hitId && playerMeshes[hitId]){
      const dist   = myMesh.position.distanceTo(playerMeshes[hitId].position);
      const camo   = hiderCamoScores[hitId] || 0;
      const moving = playerMeshes[hitId].userData.moving || false;
      const s      = calcSuspicion(dist, camo, moving);
      aimingAtPlayer = hitId; aimingSuspicion = s;
      if(s >= 60){
        ch.className='hi'; setSuspicionRing(s,'#ff4444');
        if(lbl) lbl.textContent='SUSPICIOUS';
      } else if(s >= 30){
        ch.className='md'; setSuspicionRing(s,'#ffeb3b');
        if(lbl) lbl.textContent='Possible';
      } else {
        ch.className='lo'; setSuspicionRing(s,'rgba(255,255,255,.3)');
        if(lbl) lbl.textContent='';
      }
      return;
    }
  }
  aimingAtPlayer = null; aimingSuspicion = 0;
  ch.className = '';
  setSuspicionRing(0, '');
  if(lbl) lbl.textContent = '';
}

function setSuspicionRing(pct, color){
  const ring = document.getElementById('chRingFill');
  if(!ring) return;
  const circ = 2 * Math.PI * 22;
  ring.style.strokeDasharray = `${circ * pct/100} ${circ}`;
  ring.style.stroke = color || 'transparent';
}

// ── Fire detection attempt ───────────────────────────────────────
function tryTag(){ attemptDetection(); }

function attemptDetection(){
  if(myRole !== 'seeker' || gameState !== 'hunt') return;
  if(detectionCooldown > 0){ toast(`⏳ ${detectionCooldown.toFixed(1)}s cooldown`, 800); return; }
  socket.emit('detectAttempt', { targetId: aimingAtPlayer || null });
  SFX.tag();
}

// ── Reveal flash on caught chameleon ────────────────────────────
function revealEffect(id){
  const mesh = playerMeshes[id]; if(!mesh) return;
  let fc = 0;
  const fi = setInterval(()=>{
    mesh.traverse(m=>{
      if(m.isMesh && m.material && m.material.emissive){
        const on = fc % 2 === 0;
        m.material.emissive.setRGB(on?1:0, on?1:0, on?1:0);
        m.material.emissiveIntensity = on ? 1.2 : 0;
      }
    });
    fc++;
    if(fc >= 8){
      clearInterval(fi);
      mesh.traverse(m=>{
        if(m.isMesh && m.material && m.material.emissive){
          m.material.emissive.setScalar(0);
          m.material.emissiveIntensity = 1;
        }
      });
    }
  }, 80);
}

// ── Screen flash (green=hit, red=miss) ──────────────────────────
function showDetectFlash(hit){
  const el = document.getElementById('detectFlash');
  if(!el) return;
  el.className = ''; void el.offsetWidth;
  el.className = hit ? 'hit' : 'miss';
}

// ── Shimmer: moving hiders glow faintly (rewards observation) ───
function updateShimmer(dt){
  if(myRole !== 'seeker' || gameState !== 'hunt') return;
  shimmerT += dt;
  Object.entries(playerMeshes).forEach(([id, mesh])=>{
    if(id === myId || mesh.userData.isGhost) return;
    const camo   = hiderCamoScores[id] || 0;
    const moving = mesh.userData.moving || false;
    mesh.traverse(m=>{
      if(!m.isMesh || !m.material || !m.material.emissive) return;
      if(moving){
        const maxI = (1 - camo/100) * 0.13;
        const i    = Math.abs(Math.sin(shimmerT * 12)) * maxI;
        m.material.emissive.setRGB(i, i*0.7, 0);
      } else {
        const r = m.material.emissive.r;
        if(r > 0.001) m.material.emissive.multiplyScalar(0.88);
        else          m.material.emissive.setScalar(0);
      }
    });
  });
}

// ═══════════════════════════════════════════════════
//  HUD HELPERS
// ═══════════════════════════════════════════════════

function refreshRoleUI(){
  const badge=document.getElementById('myRoleBadge');
  const camoBar=document.getElementById('camoBar');
  const tagBtn=document.getElementById('tagBtn'),paintBtn=document.getElementById('paintBtn'),poseBtn=document.getElementById('poseBtn');
  const emoteRow=document.getElementById('emoteRow');
  if(myRole==='seeker'){
    badge.textContent='👁️ SEEKER';badge.style.background='rgba(255,69,0,0.45)';badge.style.color='#FF6030';
    if(tagBtn)tagBtn.style.display='block';if(paintBtn)paintBtn.style.display='none';if(poseBtn)poseBtn.style.display='none';
    if(camoBar)camoBar.style.display='none';if(detectRing)detectRing.visible=true;
    if(emoteRow)emoteRow.style.display='flex';
  }else if(myRole==='ghost'){
    badge.textContent='👻 GHOST';badge.style.background='rgba(150,150,200,0.35)';badge.style.color='#b0b8ff';
    if(tagBtn)tagBtn.style.display='none';if(paintBtn)paintBtn.style.display='none';if(poseBtn)poseBtn.style.display='none';
    if(camoBar)camoBar.style.display='none';if(detectRing)detectRing.visible=false;
    if(emoteRow)emoteRow.style.display='flex';
  }else{
    badge.textContent='🦎 HIDER';badge.style.background='rgba(105,240,174,0.25)';badge.style.color='#69f0ae';
    if(tagBtn)tagBtn.style.display='none';if(paintBtn)paintBtn.style.display='block';if(poseBtn)poseBtn.style.display='block';
    if(camoBar)camoBar.style.display='block';if(detectRing)detectRing.visible=false;
    if(emoteRow)emoteRow.style.display='flex';
  }
}
function buildHiderIcons(players){
  const el=document.getElementById('hiderIcons');el.innerHTML='';
  Object.values(players).filter(p=>p.role==='hider').forEach(p=>{
    const s=document.createElement('span');s.className='hider-icon';s.id='hicon_'+p.id;s.textContent='🦎';s.title=p.name;el.appendChild(s);
  });
}
function markTagged(id){const el=document.getElementById('hicon_'+id);if(el)el.classList.add('tagged');}
function startCountdown(seconds,label){
  clearInterval(timerIval);let t=seconds;timerCount=seconds;
  const ph=document.getElementById('phaseLabel'),td=document.getElementById('timerDisplay');
  ph.textContent=label;ph.className='phase-'+label;td.textContent=fmt(t);
  timerIval=setInterval(()=>{t--;timerCount=t;td.textContent=fmt(t);if(t<=10&&t>0){if(t<=5)SFX.urgentBeep();else SFX.beep();}if(t<=0)clearInterval(timerIval);},1000);
}
function fmt(s){return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;}
let toastTmr=null;
function toast(msg,ms=2200){const el=document.getElementById('toast');el.textContent=msg;el.style.display='block';clearTimeout(toastTmr);toastTmr=setTimeout(()=>el.style.display='none',ms);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ═══════════════════════════════════════════════════
//  STATS LEADERBOARD
// ═══════════════════════════════════════════════════

function renderStats(winner,stats,round={}){
  if(!stats) return;
  // Round score banner
  const {round:r,maxRounds:mr,sw=0,hw=0,isMatchOver}=round;
  const roundBanner=mr>1
    ?`<div style="text-align:center;margin-bottom:10px">
        <span style="font-size:.82em;color:#aaa">Round ${r||1} of ${mr} &nbsp;|&nbsp;</span>
        <span style="color:#FF6030">Seekers ${sw}</span>
        <span style="color:#aaa"> — </span>
        <span style="color:#69f0ae">Hiders ${hw}</span>
      </div>`
    :'';
  stats._roundBanner=roundBanner;
  const seekerNames=stats.seekers.map(s=>s.name).join(', ');
  const rows=stats.hiders.map(h=>{
    const status=h.survived?`<span style="color:#69f0ae">🦎 Survived!</span>`:`<span style="color:#ff5252">💥 Tagged${h.taggedAt!=null?' at '+h.taggedAt+'s':''}`;
    const bar=`<div style="display:inline-block;width:${h.camoScore}px;height:6px;background:linear-gradient(90deg,#ff4444,#ffeb3b,#69f0ae);border-radius:3px;vertical-align:middle;margin-right:4px"></div><span style="font-size:.75em;color:#aaa">${h.camoScore}%</span>`;
    return `<tr style="border-bottom:1px solid rgba(255,255,255,0.07)"><td style="padding:7px 8px">${esc(h.name)}</td><td style="padding:7px 8px">${status}</td><td style="padding:7px 8px">${bar}</td></tr>`;
  }).join('');
  document.getElementById('resMsg').innerHTML=`
    ${stats._roundBanner||''}
    <div style="font-size:.82em;color:#aaa;margin-bottom:8px">👁️ Seekers: <strong style="color:#FF6030">${esc(seekerNames)}</strong></div>
    <table style="width:100%;border-collapse:collapse;font-size:.88em;text-align:left">
      <thead><tr style="color:#888;font-size:.75em;border-bottom:1px solid rgba(255,255,255,0.15)"><th style="padding:4px 8px">Player</th><th style="padding:4px 8px">Result</th><th style="padding:4px 8px">Camo</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${stats.topCamo?.score>0?`<div style="margin-top:8px;font-size:.8em;color:#ffeb3b">🎨 Best camo: <strong>${esc(stats.topCamo.name)}</strong> — ${stats.topCamo.score}%</div>`:''}
    <div style="margin-top:6px;font-size:.75em;color:#555">Hunt lasted ${stats.huntDuration}s</div>`;
}

// ═══════════════════════════════════════════════════
//  SOCKET EVENTS
// ═══════════════════════════════════════════════════

socket.on('roomState',room=>{
  refreshPlayerList(room.players);
  Object.values(room.players).forEach(p=>playerData[p.id]={role:p.role,name:p.name,customization:p.customization||{}});
  if(room.hostId===socket.id&&!isHost){isHost=true;document.getElementById('startBtn').style.display='block';document.getElementById('waitMsg').style.display='none';toast('You are now the host! 👑');}
});
socket.on('hostChanged',({newHostId})=>{if(newHostId===socket.id){isHost=true;document.getElementById('startBtn').style.display='block';document.getElementById('waitMsg').style.display='none';toast('You are now the host! 👑');}});
socket.on('playerJoined',p=>{playerData[p.id]={role:p.role,name:p.name,customization:p.customization||{}};toast(`${p.name} joined! 👋`);SFX.ping();});
socket.on('playerLeft',({id,name})=>{toast(`${name} left 👋`);if(playerMeshes[id]){scene?.remove(playerMeshes[id]);delete playerMeshes[id];}delete playerData[id];document.getElementById('hicon_'+id)?.remove();delete hiderCamoScores[id];});
socket.on('moved',({id,pos,rotY})=>{const m=playerMeshes[id];if(!m)return;const wasSame=Math.abs(m.position.x-pos.x)<0.01&&Math.abs(m.position.z-pos.z)<0.01;m.userData.moving=!wasSame;m.position.set(pos.x,m.position.y,pos.z);m.rotation.y=rotY;});
socket.on('bodyPainted',({id,color})=>{if(id!==myId)setCharColor(id,color);});
socket.on('poseChanged',({id,pose})=>{if(id!==myId)applyPose(id,pose);});
socket.on('camoScores', scores => {
  Object.assign(hiderCamoScores, scores);
  // Push camo score into each remote player's shader uniform
  // and estimate their environment colour via raycasting
  Object.entries(scores).forEach(([id, score]) => {
    if(id === myId) return;
    const mesh = playerMeshes[id];
    if(!mesh?.userData.bodyMat?.userData.camoUniforms) return;
    const u = mesh.userData.bodyMat.userData.camoUniforms;
    u.camoScore.value = score / 100;
    estimateEnvColor(mesh.position, u.envColor.value);
  });
});
socket.on('detectionResult',({hit, cooldown})=>{
  detectionCooldown = cooldown;
  if(hit){ showDetectFlash(true); toast('🎯 Chameleon found!', 2000); }
  else { showDetectFlash(false); SFX.denied();
    if(cooldown>=2) toast('⚫ Miss — environment hit (2s cooldown)', 1800); }
});

socket.on('emote',({id,key})=>{
  playEmote(id,key);
  if(id===myId) toast(`${EMOTES.find(e=>e.key===key)?.emoji||''} ${key}!`);
});

socket.on('gameStarted',({room,prepTime})=>{
  gameState='prep'; myRole=room.players[socket.id]?.role||'hider';
  Object.values(room.players).forEach(p=>playerData[p.id]={role:p.role,name:p.name,customization:p.customization||{}});
  enterGame(room);
  Object.values(room.players).forEach(p=>setCharColor(p.id,p.bodyColor));
  startCountdown(prepTime,'PREP'); SFX.prepStart();
  const mapNames={hotel:'🏨 Penguin Hotel',sugarland:'🍭 Sugarland',rooftop:'🏙️ City Rooftop'};
  setTimeout(()=>toast(`Map: ${mapNames[room.map]||room.map}`,3000),600);

  if(myRole==='seeker'){
    // ── SEEKER: full blackout screen for entire prep ──
    const sov=document.getElementById('seekerPrepOverlay');
    if(sov){
      sov.style.display='flex';
      // Animate floating background dots for visual interest
      const dotsEl=document.getElementById('sovDots');
      if(dotsEl && !dotsEl.dataset.built){
        dotsEl.dataset.built='1';
        for(let i=0;i<18;i++){
          const d=document.createElement('div'); d.className='sov-dot';
          const sz=20+Math.random()*80;
          d.style.cssText=`width:${sz}px;height:${sz}px;left:${Math.random()*100}%;animation-duration:${4+Math.random()*6}s;animation-delay:${Math.random()*4}s;`;
          dotsEl.appendChild(d);
        }
      }
    }
    let t=prepTime;
    const spoEl=document.getElementById('spoTimer');
    const spoSub=document.getElementById('spoSub');
    if(spoEl) spoEl.textContent=t;
    const si=setInterval(()=>{
      t--;
      if(spoEl) spoEl.textContent=t;
      if(spoSub && t<=5) spoSub.textContent='Get ready to hunt...';
      if(t<=0) clearInterval(si);
    },1000);
  } else {
    // ── HIDER: brief 3-second "game starting" banner, then free to play ──
    const ov=document.getElementById('prepOverlay');
    document.getElementById('prepMsg').textContent='🎨 Paint and hide! '+prepTime+'s on the clock';
    document.getElementById('prepNum').textContent=prepTime;
    if(ov) ov.style.display='flex';
    // Dismiss after 3s so hiders can immediately start painting + moving
    setTimeout(()=>{ if(ov) ov.style.display='none'; }, 3000);
  }
});
socket.on('huntStarted',({huntTime})=>{
  gameState='hunt';
  // Dismiss all prep overlays
  document.getElementById('prepOverlay').style.display='none';
  const sov=document.getElementById('seekerPrepOverlay');
  if(sov){
    sov.classList.add('sov-fadeout');
    setTimeout(()=>{ sov.style.display='none'; sov.classList.remove('sov-fadeout'); }, 500);
  }
  startCountdown(huntTime,'HUNT'); SFX.huntStart();
  setTimeout(()=>{
    const msg=myRole==='seeker'?'👁️ GO! Find all the hiders!':'🦎 Stay hidden — seeker is coming!';
    toast(msg, 3500);
  }, 600);
});
socket.on('playerDetected',({id, name, taggedBy})=>{
  revealEffect(id); markTagged(id);
  setTimeout(()=>{ setCharColor(id,'#cc3333'); makeGhost(id); }, 650);
  if(id===myId){
    SFX.tagged();
    setTimeout(()=>{ myRole='ghost'; refreshRoleUI(); }, 650);
    toast('💥 You were found! Spectating as ghost 👻', 4000);
  } else { SFX.ping(); toast(`🎯 ${name} found by ${taggedBy}!`); }
  if(playerData[id]) playerData[id].role='ghost';
});

// Infection mode: tagged hider becomes seeker — un-ghost + add glow
socket.on('roleChanged',({id,role,color})=>{
  if(playerData[id]) playerData[id].role=role;
  if(role==='seeker'){
    unGhost(id);           // remove ghost transparency
    setCharColor(id,color);
    setSeekerGlow(id,true);
  } else {
    setCharColor(id,color);
    setSeekerGlow(id,false);
  }
  if(id===myId){myRole=role;refreshRoleUI();SFX.roleChange();toast('🦠 You are now a SEEKER! Hunt them!',3500);}
});

socket.on('gameOver',({winner,reason,stats,round,maxRounds:mr,seekerWins:sw,hiderWins:hw,isMatchOver,matchWinner})=>{
  clearInterval(timerIval);
  currentRound=round||1; maxRounds=mr||1; seekerWins=sw||0; hiderWins=hw||0;
  const iWon=(winner==='hiders'&&(myRole==='hider'||myRole==='ghost'))||(winner==='seekers'&&myRole==='seeker');
  iWon?SFX.win():SFX.lose();

  if(isMatchOver){
    document.getElementById('resEmoji').textContent=matchWinner==='seekers'?'👁️':matchWinner==='hiders'?'🦎':'🤝';
    document.getElementById('resTitle').textContent=
      matchWinner==='seekers'?'Seekers Win the Match!':
      matchWinner==='hiders' ?'Hiders Win the Match!':'It\'s a Draw!';
  } else {
    document.getElementById('resEmoji').textContent=winner==='seekers'?'👁️':'🦎';
    document.getElementById('resTitle').textContent=winner==='seekers'?'Seekers Win!':'Hiders Win!';
  }
  renderStats(winner,stats,{round,maxRounds:mr,sw,hw,isMatchOver,matchWinner});
  document.getElementById('resultOverlay').style.display='flex';
  // Show/hide Next Round button
  const nrBtn=document.getElementById('nextRoundBtn');
  const nrMsg=document.getElementById('nextRoundMsg');
  if(nrBtn&&nrMsg){
    if(!isMatchOver){
      nrBtn.style.display=isHost?'block':'none';
      nrMsg.style.display=isHost?'none':'block';
      nrMsg.textContent='Waiting for host to start next round…';
    } else {
      nrBtn.style.display='none'; nrMsg.style.display='none';
    }
  }
});

socket.on('playerDisconnected',({id,name})=>{
  toast(`${name} disconnected — waiting 20s for reconnect… ⚡`);
  if(playerMeshes[id]){
    // Dim disconnected player
    playerMeshes[id].traverse(m=>{ if(m.isMesh&&m.material){m.material=m.material.clone();m.material.opacity=0.35;m.material.transparent=true;} });
  }
});

socket.on('playerRejoined',({id,oldId,name})=>{
  toast(`${name} reconnected! 🔌`);
  // Remap mesh from old ID to new ID
  if(playerMeshes[oldId]&&oldId!==id){
    playerMeshes[id]=playerMeshes[oldId];
    delete playerMeshes[oldId];
    // Restore opacity
    playerMeshes[id].traverse(m=>{ if(m.isMesh&&m.material){m.material=m.material.clone();m.material.opacity=1;m.material.transparent=false;} });
  }
  if(playerData[oldId]){playerData[id]=playerData[oldId];delete playerData[oldId];}
});

socket.on('reconnected',({me,room})=>{
  myId=socket.id;myRole=me.role;roomCode=room.code;
  toast('Reconnected! 🔌',3000);
  // Re-enter the game world
  if(room.state!=='lobby'){ enterGame(room); }
});

socket.on('returnedToLobby',room=>{
  gameState='lobby';myRole='hider';
  currentRound=0;seekerWins=0;hiderWins=0;
  document.getElementById('resultOverlay').style.display='none';
  Object.values(room.players).forEach(p=>{
    if(playerMeshes[p.id]){
      playerMeshes[p.id].userData.isGhost=false;
      setSeekerGlow(p.id,false);
    }
    playerData[p.id]={role:'hider',name:p.name,customization:p.customization||{}};
    setCharColor(p.id,p.bodyColor);applyPose(p.id,'stand');
  });
  refreshRoleUI();refreshPlayerList(room.players);toast('Back to lobby! 🏨');
});

// ── Init customization UI on page load ─────────────────────────
document.addEventListener('DOMContentLoaded',()=>{ initCustomizationUI(); initIntro(); });
if(document.readyState==='complete'||document.readyState==='interactive'){ initCustomizationUI(); initIntro(); }

// ═══════════════════════════════════════════════════
//  🎬  INTRO VIDEO SCENE
// ═══════════════════════════════════════════════════

let introDone = false;

function initIntro(){
  const screen = document.getElementById('introScreen');
  const video  = document.getElementById('introVideo');
  const title  = document.getElementById('introTitle');
  if (!screen || !video) return;

  // Show title overlay after 1.5 s (mid-video)
  setTimeout(() => title?.classList.add('visible'), 1500);

  // Auto-dismiss when video finishes
  video.addEventListener('ended', dismissIntro);

  // Tap ANYWHERE on the intro screen to skip (mobile-friendly)
  screen.addEventListener('touchstart', (e) => {
    // Small delay so accidental touches don't fire immediately
    e.preventDefault();
    dismissIntro();
  }, { passive: false });

  // Click anywhere on desktop also skips
  screen.addEventListener('click', dismissIntro);

  // Keyboard: any key skips
  document.addEventListener('keydown', function onKey(){
    dismissIntro();
    document.removeEventListener('keydown', onKey);
  });

  // Safety: auto-dismiss after 15 s even if video stalls
  setTimeout(dismissIntro, 15000);

  // Try to play (browsers may block autoplay without user gesture;
  // if blocked we auto-show lobby immediately)
  const playPromise = video.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      // Autoplay blocked — show lobby straight away
      screen.style.display = 'none';
      introDone = true;
    });
  }
}

function dismissIntro(){
  if (introDone) return;
  introDone = true;
  const screen = document.getElementById('introScreen');
  const video  = document.getElementById('introVideo');
  if (!screen) return;
  // Fade out then hide
  screen.classList.add('fading');
  if (video) video.pause();
  setTimeout(() => { screen.style.display = 'none'; }, 680);
}
