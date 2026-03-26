const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ─── DATABASE SETUP ───────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'db', 'streambattle.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    target_bpm INTEGER NOT NULL,
    avg_bpm REAL NOT NULL,
    ur REAL NOT NULL,
    score INTEGER NOT NULL,
    grade TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_scores_username ON scores(username);
  CREATE INDEX IF NOT EXISTS idx_scores_target ON scores(target_bpm);
`);

const insertScore = db.prepare(`
  INSERT INTO scores (username, target_bpm, avg_bpm, ur, score, grade)
  VALUES (@username, @target_bpm, @avg_bpm, @ur, @score, @grade)
`);

const getLeaderboard = db.prepare(`
  SELECT username, target_bpm, avg_bpm, ur, score, grade, created_at
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY username, target_bpm ORDER BY score DESC) as rn
    FROM scores
  )
  WHERE rn = 1
  ORDER BY score DESC
  LIMIT 100
`);

const getLeaderboardByTarget = db.prepare(`
  SELECT username, target_bpm, avg_bpm, ur, score, grade, created_at
  FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY username ORDER BY score DESC) as rn
    FROM scores WHERE target_bpm = ?
  )
  WHERE rn = 1
  ORDER BY score DESC
  LIMIT 50
`);

const getUserBest = db.prepare(`
  SELECT target_bpm, MAX(score) as best_score, avg_bpm, ur, grade
  FROM scores WHERE username = ?
  GROUP BY target_bpm
`);

// ─── SERVE STATIC FILES ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ─── REST ENDPOINTS ───────────────────────────────────────────────────
app.get('/api/leaderboard', (req, res) => {
  const { target } = req.query;
  const rows = target ? getLeaderboardByTarget.all(parseInt(target)) : getLeaderboard.all();
  res.json(rows);
});

app.get('/api/user/:username', (req, res) => {
  const bests = getUserBest.all(req.params.username);
  res.json(bests);
});

// ─── IN-MEMORY DUEL ROOMS ─────────────────────────────────────────────
const waitingPlayers = new Map(); // username -> socket
const activeRooms    = new Map(); // roomId  -> { players, target, scores, ready }

function makeRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// ─── SOCKET.IO ────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  let currentUser = null;
  let currentRoom = null;

  // ── Register username ──
  socket.on('register', (username) => {
    currentUser = username.trim().slice(0, 20);
    socket.join('user:' + currentUser);
    console.log(`[+] ${currentUser} connected (${socket.id})`);
  });

  // ── Submit score ──
  socket.on('submit_score', (data) => {
    if (!currentUser) return;
    const { target_bpm, avg_bpm, ur, score, grade } = data;
    if (
      typeof target_bpm !== 'number' || typeof avg_bpm !== 'number' ||
      typeof ur !== 'number' || typeof score !== 'number' || typeof grade !== 'string'
    ) return;

    insertScore.run({
      username: currentUser,
      target_bpm: Math.round(target_bpm),
      avg_bpm: parseFloat(avg_bpm.toFixed(2)),
      ur: parseFloat(ur.toFixed(3)),
      score: Math.round(score),
      grade
    });

    // Broadcast updated leaderboard to all
    io.emit('leaderboard_update', getLeaderboard.all());
    socket.emit('score_saved', { ok: true });
  });

  // ── Get leaderboard ──
  socket.on('get_leaderboard', (target) => {
    const rows = target ? getLeaderboardByTarget.all(target) : getLeaderboard.all();
    socket.emit('leaderboard_data', rows);
  });

  // ── Challenge a specific player ──
  socket.on('challenge', ({ opponent, target_bpm }) => {
    if (!currentUser) return;
    const oppSocket = [...io.sockets.sockets.values()].find(
      s => s.rooms.has('user:' + opponent)
    );
    if (!oppSocket) {
      socket.emit('challenge_error', { message: `${opponent} is not online right now.` });
      return;
    }
    const roomId = makeRoomId();
    currentRoom = roomId;
    activeRooms.set(roomId, {
      players: { [currentUser]: socket.id, [opponent]: oppSocket.id },
      target: target_bpm,
      scores: {},
      ready: new Set()
    });
    socket.join(roomId);
    oppSocket.join(roomId);

    // Notify both
    io.to(roomId).emit('duel_invite', {
      roomId,
      challenger: currentUser,
      opponent,
      target_bpm
    });
  });

  // ── Accept duel ──
  socket.on('accept_duel', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (!room) return;
    currentRoom = roomId;
    room.ready.add(currentUser);
    if (room.ready.size >= 2) {
      // Both accepted — start countdown
      io.to(roomId).emit('duel_start', { roomId, target: room.target });
    }
  });

  // ── Decline duel ──
  socket.on('decline_duel', ({ roomId }) => {
    const room = activeRooms.get(roomId);
    if (!room) return;
    io.to(roomId).emit('duel_declined', { by: currentUser });
    activeRooms.delete(roomId);
    currentRoom = null;
  });

  // ── Live BPM update during duel ──
  socket.on('duel_bpm_update', ({ roomId, bpm, ur }) => {
    socket.to(roomId).emit('opponent_bpm', { username: currentUser, bpm, ur });
  });

  // ── Submit duel result ──
  socket.on('duel_result', ({ roomId, avg_bpm, ur, score, grade }) => {
    const room = activeRooms.get(roomId);
    if (!room) return;
    room.scores[currentUser] = { avg_bpm, ur, score, grade };

    // Save to DB
    insertScore.run({
      username: currentUser,
      target_bpm: room.target,
      avg_bpm: parseFloat(avg_bpm.toFixed(2)),
      ur: parseFloat(ur.toFixed(3)),
      score: Math.round(score),
      grade
    });

    // Once both submitted, send result to room
    const playerNames = Object.keys(room.players);
    if (Object.keys(room.scores).length >= playerNames.length) {
      const [p1, p2] = playerNames;
      const s1 = room.scores[p1]?.score || 0;
      const s2 = room.scores[p2]?.score || 0;
      const winner = s1 >= s2 ? p1 : p2;
      io.to(roomId).emit('duel_over', {
        winner,
        scores: room.scores,
        players: playerNames
      });
      activeRooms.delete(roomId);
      io.emit('leaderboard_update', getLeaderboard.all());
    } else {
      // Tell the other player their opponent is done
      socket.to(roomId).emit('opponent_finished', { username: currentUser });
    }
  });

  // ── Quick match (join matchmaking queue) ──
  socket.on('quick_match', ({ target_bpm }) => {
    if (!currentUser) return;
    // Look for someone waiting for same target
    const key = `qm_${target_bpm}`;
    const waiting = waitingPlayers.get(key);
    if (waiting && waiting.username !== currentUser && waiting.socket.connected) {
      // Match found!
      const roomId = makeRoomId();
      currentRoom = roomId;
      activeRooms.set(roomId, {
        players: { [currentUser]: socket.id, [waiting.username]: waiting.socket.id },
        target: target_bpm,
        scores: {},
        ready: new Set([currentUser, waiting.username])
      });
      socket.join(roomId);
      waiting.socket.join(roomId);
      waitingPlayers.delete(key);
      io.to(roomId).emit('duel_start', { roomId, target: target_bpm, quickMatch: true });
    } else {
      // Wait in queue
      waitingPlayers.set(key, { username: currentUser, socket });
      socket.emit('matchmaking_waiting', { target_bpm });
    }
  });

  socket.on('cancel_quick_match', ({ target_bpm }) => {
    const key = `qm_${target_bpm}`;
    const w = waitingPlayers.get(key);
    if (w && w.username === currentUser) waitingPlayers.delete(key);
    socket.emit('matchmaking_cancelled');
  });

  // ── Online players list ──
  socket.on('get_online', () => {
    const online = [...io.sockets.sockets.values()]
      .map(s => [...s.rooms].find(r => r.startsWith('user:')))
      .filter(Boolean)
      .map(r => r.replace('user:', ''));
    socket.emit('online_list', online);
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    if (currentUser) console.log(`[-] ${currentUser} disconnected`);
    if (currentRoom) {
      socket.to(currentRoom).emit('opponent_disconnected', { username: currentUser });
      activeRooms.delete(currentRoom);
    }
    // Remove from matchmaking
    for (const [key, val] of waitingPlayers.entries()) {
      if (val.username === currentUser) waitingPlayers.delete(key);
    }
  });
});

// ─── START ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`StreamBattle running on http://localhost:${PORT}`);
});
