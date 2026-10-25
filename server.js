const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const DISK_COUNT = 4;

app.use(express.static(path.join(__dirname, 'public')));

// { roomId: { rods, moves, players: Map<socketId, name> } }
const games = new Map();

function createGame(roomId) {
  const rods = [[], [], []];
  for (let size = DISK_COUNT; size >= 1; size--) rods[0].push(size);
  const game = { roomId, rods, moves: 0, players: new Map() };
  games.set(roomId, game);
  return game;
}

function publicState(game) {
  return {
    roomId: game.roomId,
    rods: game.rods,
    moves: game.moves,
    players: Array.from(game.players.values()),
    solved: game.rods[2].length === DISK_COUNT,
  };
}

function adminSnapshot() {
  return Array.from(games.values()).map(g => {
    const s = publicState(g);
    return { ...s, playerCount: g.players.size };
  });
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // --- Игрок ---
  socket.on('join', ({ roomId, name }) => {
    if (!roomId) return;
    const game = games.get(roomId) || createGame(roomId);

    // если переподключение — сохраняем имя
    const finalName = (name || socket.data.name || 'Игрок').trim().slice(0, 30)
      || 'Игрок';
    socket.data.name = finalName;
    socket.data.roomId = roomId;

    game.players.set(socket.id, finalName);
    socket.join(`room:${roomId}`);

    io.to(`room:${roomId}`).emit('state', publicState(game));
    io.to('admin').emit('admin:update', adminSnapshot());
  });

  socket.on('move', ({ from, to }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const game = games.get(roomId);
    if (!game) return;
    if (from === to) return;

    const disk = game.rods[from][game.rods[from].length - 1];
    if (disk === undefined) return;
    const topTo = game.rods[to][game.rods[to].length - 1];
    if (topTo !== undefined && topTo < disk) {
      socket.emit('error-msg', 'Нельзя класть больший диск на меньший!');
      return;
    }

    game.rods[from].pop();
    game.rods[to].push(disk);
    game.moves++;

    io.to(`room:${roomId}`).emit('state', publicState(game));
    io.to('admin').emit('admin:update', adminSnapshot());
  });

  socket.on('reset', () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const old = games.get(roomId);
    const game = createGame(roomId);
    if (old) game.players = old.players;
    io.to(`room:${roomId}`).emit('state', publicState(game));
    io.to('admin').emit('admin:update', adminSnapshot());
  });

  // --- Админ ---
  socket.on('admin:subscribe', () => {
    socket.join('admin');
    socket.emit('admin:update', adminSnapshot());
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    if (roomId) {
      const game = games.get(roomId);
      if (game) {
        game.players.delete(socket.id);
        io.to(`room:${roomId}`).emit('state', publicState(game));
        io.to('admin').emit('admin:update', adminSnapshot());
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
});