const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'nook_super_secret_cozy_key';
const DB_FILE = 'db.json';

// --- JSON DATABASE SETUP ---
let db = { users: [], friends: [], nooks: [], nook_members: [], settings: [], messages: [] };

if (fs.existsSync(DB_FILE)) {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
  // Seed "mathew" as the dev user
  const hash = bcrypt.hashSync('devpassword123', 10);
  db.users.push({ id: 1, username: 'mathew', password: hash, is_dev: 1 });
  db.settings.push({ key: 'donate_link', value: 'https://ko-fi.com/default' });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function getNextId(arr) {
  return arr.length > 0 ? Math.max(...arr.map(i => i.id)) + 1 : 1;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  if (db.users.find(u => u.username === username)) return res.status(400).json({ error: 'Username taken' });

  const hash = bcrypt.hashSync(password, 10);
  const newUser = { id: getNextId(db.users), username, password: hash, is_dev: 0 };
  db.users.push(newUser);
  saveDB();
  
  const token = jwt.sign({ id: newUser.id, username: newUser.username, is_dev: 0 }, JWT_SECRET);
  res.json({ token, user: { id: newUser.id, username: newUser.username, is_dev: 0 } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find(u => u.username === username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, is_dev: user.is_dev }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, is_dev: user.is_dev } });
});

// --- SETTINGS ROUTE ---
app.get('/api/settings', (req, res) => {
  const link = db.settings.find(s => s.key === 'donate_link');
  res.json({ donate_link: link ? link.value : '#' });
});

app.post('/api/settings/donate', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_dev) return res.status(403).json({ error: 'Mathew only!' });
    
    const setting = db.settings.find(s => s.key === 'donate_link');
    if (setting) setting.value = req.body.link;
    saveDB();
    io.emit('donateLinkUpdated', req.body.link);
    res.json({ success: true });
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
});

// --- SOCKET LOGIC ---
const activeUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) { next(new Error('Invalid token')); }
});

io.on('connection', (socket) => {
  console.log(`🌿 ${socket.user.username} entered the nook`);
  activeUsers.set(socket.id, socket.user);
  io.emit('userList', Array.from(activeUsers.values()));

  socket.on('sendFriendRequest', (friendName) => {
    const friend = db.users.find(u => u.username === friendName);
    if (friend && friend.id !== socket.user.id) {
      const exists = db.friends.find(f => f.user_id === socket.user.id && f.friend_id === friend.id);
      if (!exists) {
        db.friends.push({ user_id: socket.user.id, friend_id: friend.id, status: 'pending' });
        saveDB();
      }
      io.emit('friendRequest', { from: socket.user.username, to: friend.username });
    }
  });

  socket.on('createNook', (nookName) => {
    const newNook = { id: getNextId(db.nooks), name: nookName, owner_id: socket.user.id };
    db.nooks.push(newNook);
    db.nook_members.push({ nook_id: newNook.id, user_id: socket.user.id, role: 'owner' });
    saveDB();
    io.emit('nookCreated', newNook);
  });

  socket.on('sendNookMessage', (data) => {
    const msg = { id: getNextId(db.messages), nookId: data.nookId, channel: data.channel, user: socket.user.username, text: data.text, timestamp: Date.now() };
    db.messages.push(msg);
    saveDB();
    io.to(`nook_${data.nookId}`).emit('newNookMessage', msg);
  });

  socket.on('joinNook', (nookId) => { socket.join(`nook_${nookId}`); });

  socket.on('initiateCall', (targetUserId) => {
    const targetSocket = Array.from(activeUsers.entries()).find(([id, u]) => u.id == targetUserId);
    if (targetSocket) io.to(targetSocket[0]).emit('incomingCall', { from: socket.user });
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('userList', Array.from(activeUsers.values()));
  });
});

server.listen(PORT, () => console.log(`🌿 nook V2 running on port ${PORT}`));