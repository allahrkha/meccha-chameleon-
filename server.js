const express  = require('express');
const http      = require('http');
const { Server} = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors:          { origin:'*' },
  transports:    ['websocket','polling'],
  pingTimeout:   60000,
  pingInterval:  25000,
});

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname,'public')));
app.get('/health', (_,res) => res.json({
  status:'ok',
  rooms:   Object.keys(rooms).length,
  players: Object.values(rooms).reduce((n,r)=>n+Object.keys(r.players).length,0),
}));

const rooms = {};

// ── Pure helpers ───────────────────────────────────────────────
function genCode()  { return Math.random().toString(36).substring(2,6).toUpperCase(); }
function spawnPos() { return { x:(Math.random()-0.5)*14, y:0, z:(Math.random()-0.5)*14 }; }

function tagRange(camo) {
  const s = Math.max(0,Math.min(100,camo||0));
  return 1.5 + (6-1.5)*(1-s/100);
}

// ── Seeker rotation ────────────────────────────────────────────
// Picks the next seeker from a rotating queue and resets all players
function assignRoles(code) {
  if (!rooms[code]) return;
  const plist = Object.values(rooms[code].players).filter(p=>!p.disconnected);
  if (!plist.length) return;

  // Refill queue when empty
  if (!(rooms[code].seekerQueue?.length)) {
    rooms[code].seekerQueue = plist.map(p=>p.id);
  }

  // Pop first ID that is still in the room
  let seekerId;
  while (rooms[code].seekerQueue.length) {
    const id = rooms[code].seekerQueue.shift();
    if (rooms[code].players[id] && !rooms[code].players[id].disconnected) {
      seekerId = id; break;
    }
  }
  if (!seekerId) seekerId = plist[0].id;

  plist.forEach(p => {
    p.role      = p.id === seekerId ? 'seeker' : 'hider';
    p.bodyColor = p.role === 'seeker' ? '#FF4500' : '#ffffff';
    p.tagged    = false; p.taggedAt = null; p.camoScore = 0;
    p.position  = spawnPos();
  });
}

// ── Round lifecycle ────────────────────────────────────────────
function startRound(code, prepTime=30, huntTime=120) {
  if (!rooms[code]) return;
  clearTimeout(rooms[code]._prepTimer);
  clearTimeout(rooms[code]._huntTimer);
  rooms[code].state        = 'prep';
  rooms[code].huntStartTime = null;
  io.to(code).emit('gameStarted', { room:rooms[code], prepTime });

  rooms[code]._prepTimer = setTimeout(() => {
    if (!rooms[code]) return;
    rooms[code].state         = 'hunt';
    rooms[code].huntStartTime = Date.now();
    io.to(code).emit('huntStarted', { huntTime });

    rooms[code]._huntTimer = setTimeout(() => {
      if (!rooms[code] || rooms[code].state!=='hunt') return;
      endRound(code,'hiders','⏰ Time ran out! Hiders survived!');
    }, huntTime*1000);
  }, prepTime*1000);
}

function endRound(code, winner, reason) {
  if (!rooms[code]) return;
  clearTimeout(rooms[code]._huntTimer);
  rooms[code].state = 'results';

  if (winner==='seekers') rooms[code].seekerWins++;
  else                    rooms[code].hiderWins++;
  rooms[code].roundNum++;

  const { roundNum, maxRounds, seekerWins, hiderWins } = rooms[code];
  const isMatchOver = roundNum >= maxRounds;
  let matchWinner   = null;
  if (isMatchOver) {
    if      (seekerWins > hiderWins) matchWinner = 'seekers';
    else if (hiderWins > seekerWins) matchWinner = 'hiders';
    else                             matchWinner = 'draw';
  }

  io.to(code).emit('gameOver', {
    winner, reason,
    stats: buildStats(rooms[code]),
    round: roundNum, maxRounds,
    seekerWins, hiderWins,
    isMatchOver, matchWinner,
  });
}

// ── Stats builder ──────────────────────────────────────────────
function buildStats(room) {
  const players = Object.values(room.players);
  const seekers = players.filter(p=>p.role==='seeker');
  const hiders  = players.filter(p=>p.role!=='seeker');
  const dur     = room.huntStartTime
    ? Math.floor((Date.now()-room.huntStartTime)/1000) : 0;
  const topCamo = hiders.reduce(
    (b,p)=>(p.camoScore||0)>(b.score||0)?{name:p.name,score:p.camoScore||0}:b,
    {name:'—',score:0}
  );
  return {
    seekers:      seekers.map(p=>({name:p.name,tagCount:hiders.filter(h=>h.tagged).length})),
    hiders:       hiders.map(p=>({name:p.name,survived:!p.tagged,taggedAt:p.taggedAt??null,camoScore:p.camoScore||0}))
                        .sort((a,b)=>(b.taggedAt??9999)-(a.taggedAt??9999)),
    huntDuration: dur,
    topCamo,
  };
}

// ═══════════════════════════════════════════════════
//  SOCKET HANDLERS
// ═══════════════════════════════════════════════════
io.on('connection', socket => {
  console.log('+', socket.id);

  // ── Create Room ──────────────────────────────────
  socket.on('createRoom', (data, cb) => {
    const { name, customization, token } = data;
    let code; do { code=genCode(); } while(rooms[code]);
    rooms[code] = {
      code, hostId:socket.id, players:{}, state:'lobby',
      mode:'normal', map:'hotel',
      roundNum:0, maxRounds:1, seekerWins:0, hiderWins:0,
      seekerQueue:[],
    };
    rooms[code].players[socket.id] = {
      id:socket.id, name:name||'Player', role:'hider',
      position:spawnPos(), rotY:0, bodyColor:'#ffffff',
      pose:'stand', tagged:false, camoScore:0, taggedAt:null,
      customization:customization||{skinColor:'#f5c9a0',hat:'none'},
      token:token||null, disconnected:false,
    };
    socket.join(code); socket.data.roomCode=code;
    cb({ok:true,code,me:rooms[code].players[socket.id],room:rooms[code]});
    io.to(code).emit('roomState',rooms[code]);
  });

  // ── Join Room ────────────────────────────────────
  socket.on('joinRoom', (data, cb) => {
    let { code, name, customization, token } = data;
    code = (code||'').toUpperCase().trim();
    if (!rooms[code]) return cb({ok:false,err:'Room not found'});

    // ── Reconnect path: token matches disconnected player ──
    if (token && rooms[code].state!=='lobby') {
      const match = Object.values(rooms[code].players)
                          .find(p=>p.token===token && p.disconnected);
      if (match) {
        clearTimeout(match._discTimer);
        match.disconnected = false;
        const oldId = match.id;
        delete rooms[code].players[oldId];
        match.id = socket.id;
        rooms[code].players[socket.id] = match;
        socket.join(code); socket.data.roomCode=code;
        socket.emit('reconnected',{me:match,room:rooms[code]});
        socket.to(code).emit('playerRejoined',{id:socket.id,oldId,name:match.name});
        io.to(code).emit('roomState',rooms[code]);
        return cb({ok:true,code,me:match,room:rooms[code],reconnected:true});
      }
    }

    if (rooms[code].state!=='lobby') return cb({ok:false,err:'Game already in progress'});

    const count = Object.keys(rooms[code].players).length;
    rooms[code].players[socket.id] = {
      id:socket.id, name:name||`Player${count+1}`, role:'hider',
      position:spawnPos(), rotY:0, bodyColor:'#ffffff',
      pose:'stand', tagged:false, camoScore:0, taggedAt:null,
      customization:customization||{skinColor:'#f5c9a0',hat:'none'},
      token:token||null, disconnected:false,
    };
    socket.join(code); socket.data.roomCode=code;
    cb({ok:true,code,me:rooms[code].players[socket.id],room:rooms[code]});
    socket.to(code).emit('playerJoined',rooms[code].players[socket.id]);
    io.to(code).emit('roomState',rooms[code]);
  });

  // ── Move ─────────────────────────────────────────
  socket.on('move', ({pos,rotY}) => {
    const code=socket.data.roomCode;
    if (!code||!rooms[code]) return;
    const p=rooms[code].players[socket.id]; if (!p) return;
    if (rooms[code].state==='prep' && p.role==='seeker') return;
    p.position=pos; p.rotY=rotY;
    socket.to(code).emit('moved',{id:socket.id,pos,rotY});
  });

  // ── Camo Update ──────────────────────────────────
  socket.on('camoUpdate', ({score}) => {
    const code=socket.data.roomCode;
    if (!rooms[code]) return;
    const p=rooms[code].players[socket.id];
    if (p && p.role==='hider') {
      p.camoScore=Math.max(0,Math.min(100,Math.round(score)));
      const camoMap={};
      Object.values(rooms[code].players).forEach(pl=>{if(pl.role==='hider')camoMap[pl.id]=pl.camoScore;});
      io.to(code).emit('camoScores',camoMap);
    }
  });

  // ── Start Game (Round 1) ─────────────────────────
  socket.on('startGame', (data, cb) => {
    const code=socket.data.roomCode;
    if (!rooms[code]) return;
    if (rooms[code].hostId!==socket.id) return cb&&cb({ok:false,err:'Only host can start'});
    const plist=Object.values(rooms[code].players).filter(p=>!p.disconnected);
    if (plist.length<2) return cb&&cb({ok:false,err:'Need at least 2 players'});

    rooms[code].mode      = data.mode||'normal';
    rooms[code].map       = data.map||'hotel';
    rooms[code].maxRounds = parseInt(data.rounds)||1;
    rooms[code].roundNum  = 0;
    rooms[code].seekerWins= 0; rooms[code].hiderWins=0;
    rooms[code].seekerQueue=[];           // fresh queue for new match

    assignRoles(code);
    if (cb) cb({ok:true});
    startRound(code);
  });

  // ── Next Round (host triggers after round ends) ──
  socket.on('nextRound', () => {
    const code=socket.data.roomCode;
    if (!rooms[code]||rooms[code].hostId!==socket.id) return;
    if (rooms[code].roundNum>=rooms[code].maxRounds) return;
    assignRoles(code);
    startRound(code);
  });

  // ── Tag Player ───────────────────────────────────
  socket.on('tagPlayer', ({targetId}) => {
    const code=socket.data.roomCode;
    if (!rooms[code]||rooms[code].state!=='hunt') return;
    const seeker=rooms[code].players[socket.id];
    const target=rooms[code].players[targetId];
    if (!seeker||seeker.role!=='seeker') return;
    if (!target||target.tagged) return;

    const dx=seeker.position.x-target.position.x;
    const dz=seeker.position.z-target.position.z;
    const dist=Math.sqrt(dx*dx+dz*dz);
    const maxDist=tagRange(target.camoScore);
    if (dist>maxDist) {
      const tip=target.camoScore>60?' (well hidden!)':'';
      return socket.emit('tagFailed',{reason:`Too far — ${Math.round(dist*10)/10}m away, need ${Math.round(maxDist*10)/10}m${tip}`});
    }

    target.tagged  = true;
    target.taggedAt= rooms[code].huntStartTime
      ? Math.floor((Date.now()-rooms[code].huntStartTime)/1000) : null;

    io.to(code).emit('playerTagged',{id:targetId,name:target.name,taggedBy:seeker.name,taggedAt:target.taggedAt});

    if (rooms[code].mode==='infection') {
      target.role='seeker'; target.bodyColor='#FF4500';
      io.to(code).emit('roleChanged',{id:targetId,role:'seeker',color:'#FF4500'});
    }

    const alive=Object.values(rooms[code].players).filter(p=>p.role==='hider'&&!p.tagged);
    if (!alive.length) endRound(code,'seekers','👁️ All hiders found! Seekers win!');
  });

  // ── Paint / Pose / Emote ─────────────────────────
  socket.on('paintBody', ({color}) => {
    const code=socket.data.roomCode; if (!rooms[code]) return;
    const p=rooms[code].players[socket.id];
    if (p&&p.role==='hider'){p.bodyColor=color;socket.to(code).emit('bodyPainted',{id:socket.id,color});}
  });
  socket.on('setPose', ({pose}) => {
    const code=socket.data.roomCode; if (!rooms[code]) return;
    const p=rooms[code].players[socket.id];
    if (p){p.pose=pose;socket.to(code).emit('poseChanged',{id:socket.id,pose});}
  });
  socket.on('emote', ({key}) => {
    const code=socket.data.roomCode; if (!rooms[code]) return;
    io.to(code).emit('emote',{id:socket.id,key});
  });

  // ── Reset to Lobby ───────────────────────────────
  socket.on('resetLobby', () => {
    const code=socket.data.roomCode;
    if (!rooms[code]||rooms[code].hostId!==socket.id) return;
    clearTimeout(rooms[code]._prepTimer); clearTimeout(rooms[code]._huntTimer);
    Object.values(rooms[code].players).forEach(p=>{
      p.role='hider';p.bodyColor='#ffffff';p.tagged=false;
      p.taggedAt=null;p.camoScore=0;p.position=spawnPos();
    });
    rooms[code].state='lobby';rooms[code].roundNum=0;
    rooms[code].seekerWins=0;rooms[code].hiderWins=0;rooms[code].seekerQueue=[];
    io.to(code).emit('returnedToLobby',rooms[code]);
  });

  // ── Disconnect ───────────────────────────────────
  socket.on('disconnect', () => {
    const code=socket.data.roomCode;
    if (!code||!rooms[code]) return console.log('-',socket.id);
    const p=rooms[code].players[socket.id];
    const name=p?.name||'Someone';

    if (p && rooms[code].state!=='lobby') {
      // Keep slot for 20 s so they can reconnect
      p.disconnected=true;
      p._discTimer=setTimeout(()=>{
        if (!rooms[code]||!rooms[code].players[socket.id]) return;
        delete rooms[code].players[socket.id];
        io.to(code).emit('playerLeft',{id:socket.id,name});
        cleanRoom(code);
      },20000);
      io.to(code).emit('playerDisconnected',{id:socket.id,name});
    } else {
      if (p) delete rooms[code].players[socket.id];
      io.to(code).emit('playerLeft',{id:socket.id,name});
      cleanRoom(code);
    }
    console.log('-',socket.id);
  });

  function cleanRoom(code) {
    if (!rooms[code]) return;
    const active=Object.values(rooms[code].players).filter(p=>!p.disconnected);
    if (!active.length) {
      clearTimeout(rooms[code]._prepTimer); clearTimeout(rooms[code]._huntTimer);
      delete rooms[code]; return console.log(`Room ${code} closed`);
    }
    if (rooms[code].hostId===socket.id) {
      rooms[code].hostId=active[0].id;
      io.to(code).emit('hostChanged',{newHostId:rooms[code].hostId});
    }
    io.to(code).emit('roomState',rooms[code]);
  }
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`\n🦎 Meccha Chameleon → http://localhost:${PORT}\n`));
