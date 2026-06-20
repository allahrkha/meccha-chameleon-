const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin:'*' },
  transports: ['websocket', 'polling'],
  pingTimeout:  60000,
  pingInterval: 25000,
});

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, res) => res.json({
  status: 'ok',
  rooms:   Object.keys(rooms).length,
  players: Object.values(rooms).reduce((n,r)=>n+Object.keys(r.players).length, 0),
}));

const rooms = {};

function genCode()  { return Math.random().toString(36).substring(2,6).toUpperCase(); }
function spawnPos() { return { x:(Math.random()-0.5)*14, y:0, z:(Math.random()-0.5)*14 }; }

// Camo-adjusted tag range: 6u at 0% camo → 1.5u at 100% camo
function tagRange(camoScore) {
  const s = Math.max(0, Math.min(100, camoScore || 0));
  return 1.5 + (6 - 1.5) * (1 - s / 100);
}

// Build stats payload for gameOver
function buildStats(room) {
  const players = Object.values(room.players);
  const seekers = players.filter(p => p.role === 'seeker');
  const hiders  = players.filter(p => p.role !== 'seeker');
  const huntDuration = room.huntStartTime
    ? Math.floor((Date.now() - room.huntStartTime) / 1000) : 0;

  const hiderStats = hiders.map(p => ({
    name:      p.name,
    survived:  !p.tagged,
    taggedAt:  p.taggedAt  ?? null,
    camoScore: p.camoScore || 0,
  })).sort((a, b) => (b.taggedAt ?? 9999) - (a.taggedAt ?? 9999));

  const topCamo = hiders.reduce(
    (best, p) => (p.camoScore||0) > (best.score||0) ? {name:p.name,score:p.camoScore||0} : best,
    { name:'—', score:0 }
  );

  return {
    seekers:      seekers.map(p => ({ name:p.name, tagCount: hiders.filter(h=>h.tagged).length })),
    hiders:       hiderStats,
    huntDuration,
    topCamo,
  };
}

io.on('connection', (socket) => {
  console.log('+ Connected:', socket.id);

  // ── Create Room ───────────────────────────────────────────────
  socket.on('createRoom', (data, cb) => {
    const { name, customization } = data;
    let code;
    do { code = genCode(); } while (rooms[code]);
    rooms[code] = { code, hostId:socket.id, players:{}, state:'lobby', mode:'normal', map:'hotel' };
    rooms[code].players[socket.id] = {
      id:socket.id, name:name||'Player', role:'hider',
      position:spawnPos(), rotY:0, bodyColor:'#ffffff',
      pose:'stand', tagged:false, camoScore:0, taggedAt:null,
      customization: customization || { skinColor:'#f5c9a0', hat:'none' },
    };
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok:true, code, me:rooms[code].players[socket.id], room:rooms[code] });
    io.to(code).emit('roomState', rooms[code]);
  });

  // ── Join Room ─────────────────────────────────────────────────
  socket.on('joinRoom', (data, cb) => {
    let { code, name, customization } = data;
    code = (code||'').toUpperCase().trim();
    if (!rooms[code])                  return cb({ ok:false, err:'Room not found' });
    if (rooms[code].state !== 'lobby') return cb({ ok:false, err:'Game already in progress' });
    const count = Object.keys(rooms[code].players).length;
    rooms[code].players[socket.id] = {
      id:socket.id, name:name||`Player${count+1}`, role:'hider',
      position:spawnPos(), rotY:0, bodyColor:'#ffffff',
      pose:'stand', tagged:false, camoScore:0, taggedAt:null,
      customization: customization || { skinColor:'#f5c9a0', hat:'none' },
    };
    socket.join(code);
    socket.data.roomCode = code;
    cb({ ok:true, code, me:rooms[code].players[socket.id], room:rooms[code] });
    socket.to(code).emit('playerJoined', rooms[code].players[socket.id]);
    io.to(code).emit('roomState', rooms[code]);
  });

  // ── Move ──────────────────────────────────────────────────────
  socket.on('move', ({ pos, rotY }) => {
    const code = socket.data.roomCode;
    if (!code || !rooms[code]) return;
    const p = rooms[code].players[socket.id];
    if (!p) return;
    // Block seeker movement during prep (enforced both server + client)
    if (rooms[code].state === 'prep' && p.role === 'seeker') return;
    p.position = pos;
    p.rotY = rotY;
    socket.to(code).emit('moved', { id:socket.id, pos, rotY });
  });

  // ── Camo Update (hiders broadcast their score) ────────────────
  socket.on('camoUpdate', ({ score }) => {
    const code = socket.data.roomCode;
    if (!rooms[code]) return;
    const p = rooms[code].players[socket.id];
    if (p && p.role === 'hider') {
      p.camoScore = Math.max(0, Math.min(100, Math.round(score)));
      // Broadcast camo scores map to room so seekers can see
      const camoMap = {};
      Object.values(rooms[code].players).forEach(pl => {
        if (pl.role === 'hider') camoMap[pl.id] = pl.camoScore;
      });
      io.to(code).emit('camoScores', camoMap);
    }
  });

  // ── Start Game ────────────────────────────────────────────────
  socket.on('startGame', (data, cb) => {
    const { mode } = data;
    const code = socket.data.roomCode;
    if (!rooms[code]) return;
    if (rooms[code].hostId !== socket.id) return cb && cb({ ok:false, err:'Only host can start' });
    const plist = Object.values(rooms[code].players);
    if (plist.length < 2) return cb && cb({ ok:false, err:'Need at least 2 players' });

    plist.forEach((p, i) => {
      p.role = i === 0 ? 'seeker' : 'hider';
      p.bodyColor = p.role === 'seeker' ? '#FF4500' : '#ffffff';
      p.tagged = false; p.taggedAt = null; p.camoScore = 0;
      p.position = spawnPos();
    });

    rooms[code].state = 'prep';
    rooms[code].mode  = mode || 'normal';
    rooms[code].map   = data.map || 'hotel';
    rooms[code].huntStartTime = null;
    if (cb) cb({ ok:true });

    io.to(code).emit('gameStarted', { room:rooms[code], prepTime:30 });

    // Prep → Hunt
    rooms[code]._prepTimer = setTimeout(() => {
      if (!rooms[code]) return;
      rooms[code].state = 'hunt';
      rooms[code].huntStartTime = Date.now();
      io.to(code).emit('huntStarted', { huntTime:120 });

      // Hunt timeout → hiders win
      rooms[code]._huntTimer = setTimeout(() => {
        if (!rooms[code] || rooms[code].state !== 'hunt') return;
        rooms[code].state = 'results';
        io.to(code).emit('gameOver', {
          winner:'hiders',
          reason:'⏰ Time ran out! Hiders survived!',
          stats: buildStats(rooms[code]),
        });
      }, 120000);
    }, 30000);
  });

  // ── Tag Player ────────────────────────────────────────────────
  socket.on('tagPlayer', ({ targetId }) => {
    const code = socket.data.roomCode;
    if (!rooms[code] || rooms[code].state !== 'hunt') return;
    const seeker = rooms[code].players[socket.id];
    const target = rooms[code].players[targetId];
    if (!seeker || seeker.role !== 'seeker') return;
    if (!target || target.tagged) return;

    // ─ Camo-adjusted distance check ─
    const dx = seeker.position.x - target.position.x;
    const dz = seeker.position.z - target.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const maxDist = tagRange(target.camoScore);

    if (dist > maxDist) {
      const camoTip = target.camoScore > 60 ? ' (they are well hidden!)' : '';
      socket.emit('tagFailed', {
        reason:`Too far! ${Math.round(dist*10)/10}m away, need ${Math.round(maxDist*10)/10}m${camoTip}`,
      });
      return;
    }

    // ─ Tag confirmed ─
    target.tagged  = true;
    target.taggedAt = rooms[code].huntStartTime
      ? Math.floor((Date.now() - rooms[code].huntStartTime) / 1000) : null;

    io.to(code).emit('playerTagged', {
      id:targetId, name:target.name,
      taggedAt: target.taggedAt,
      taggedBy: seeker.name,
    });

    // Infection mode → tagged hiders become seekers
    if (rooms[code].mode === 'infection') {
      target.role = 'seeker';
      target.bodyColor = '#FF4500';
      io.to(code).emit('roleChanged', { id:targetId, role:'seeker', color:'#FF4500' });
    }

    // Win condition
    const aliveHiders = Object.values(rooms[code].players).filter(p => p.role==='hider' && !p.tagged);
    if (aliveHiders.length === 0) {
      clearTimeout(rooms[code]._huntTimer);
      rooms[code].state = 'results';
      io.to(code).emit('gameOver', {
        winner:'seekers',
        reason:'👁️ All hiders found! Seekers win!',
        stats: buildStats(rooms[code]),
      });
    }
  });

  // ── Paint Body ────────────────────────────────────────────────
  socket.on('paintBody', ({ color }) => {
    const code = socket.data.roomCode;
    if (!rooms[code]) return;
    const p = rooms[code].players[socket.id];
    if (p && p.role === 'hider') {
      p.bodyColor = color;
      socket.to(code).emit('bodyPainted', { id:socket.id, color });
    }
  });

  // ── Set Pose ──────────────────────────────────────────────────
  socket.on('setPose', ({ pose }) => {
    const code = socket.data.roomCode;
    if (!rooms[code]) return;
    const p = rooms[code].players[socket.id];
    if (p) { p.pose = pose; socket.to(code).emit('poseChanged', { id:socket.id, pose }); }
  });

  // ── Emote ──────────────────────────────────────────────────────
  socket.on('emote', ({ key }) => {
    const code = socket.data.roomCode;
    if (!rooms[code]) return;
    const p = rooms[code].players[socket.id];
    if (!p) return;
    // Broadcast emote to all players in room including sender
    io.to(code).emit('emote', { id: socket.id, key });
  });

  // ── Reset to Lobby ────────────────────────────────────────────
  socket.on('resetLobby', () => {
    const code = socket.data.roomCode;
    if (!rooms[code] || rooms[code].hostId !== socket.id) return;
    clearTimeout(rooms[code]._prepTimer);
    clearTimeout(rooms[code]._huntTimer);
    Object.values(rooms[code].players).forEach(p => {
      p.role='hider'; p.bodyColor='#ffffff'; p.tagged=false;
      p.taggedAt=null; p.camoScore=0; p.position=spawnPos();
    });
    rooms[code].state = 'lobby';
    io.to(code).emit('returnedToLobby', rooms[code]);
  });

  // ── Disconnect ────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (code && rooms[code]) {
      const name = rooms[code].players[socket.id]?.name || 'Someone';
      delete rooms[code].players[socket.id];
      io.to(code).emit('playerLeft', { id:socket.id, name });
      if (Object.keys(rooms[code].players).length === 0) {
        clearTimeout(rooms[code]._prepTimer);
        clearTimeout(rooms[code]._huntTimer);
        delete rooms[code];
        console.log(`Room ${code} closed (empty)`);
      } else if (rooms[code].hostId === socket.id) {
        rooms[code].hostId = Object.keys(rooms[code].players)[0];
        io.to(code).emit('hostChanged', { newHostId:rooms[code].hostId });
        io.to(code).emit('roomState', rooms[code]);
      } else {
        io.to(code).emit('roomState', rooms[code]);
      }
    }
    console.log('- Disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🦎 Meccha Chameleon server → http://localhost:${PORT}\n`);
});
