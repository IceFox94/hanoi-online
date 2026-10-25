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

// Состояние всех комнат: { roomId: { rods, moves, players: Set } }
const games = new Map();

function createGame(roomId) {
  const rods = [[], [], []];
  for (let size = DISK_COUNT; size >= 1; size--) rods[0].push(size);
  const game = { roomId, rods, moves: 0, players: 0 };
  games.set(roomId, game);
  return game;
}

function publicState(game) {
  return {
    roomId: game.roomId,
    rods: game.rods,
    moves: game.moves,
    players: game.players,
    solved: game.rods[2].length === DISK_COUNT,
  };
}

function adminSnapshot() {
  return Array.from(games.values()).map(publicState);
}

io.on('connection', (socket) => {
  console.log('connected:', socket.id);

  // --- Игрок ---
  socket.on('join', ({ roomId }) => {
    if (!roomId) return;
    const game = games.get(roomId) || createGame(roomId);
    socket.join(`room:${roomId}`);
    socket.data.roomId = roomId;
    game.players = io.sockets.adapter.rooms.get(`room:${roomId}`)?.size || 1;

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
    const game = createGame(roomId);
    // сохраняем счётчик игроков
    game.players = io.sockets.adapter.rooms.get(`room:${roomId}`)?.size || 1;
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
        game.players = io.sockets.adapter.rooms.get(`room:${roomId}`)?.size || 0;
        io.to('admin').emit('admin:update', adminSnapshot());
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});