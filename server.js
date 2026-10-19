const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'nook_super_secret_cozy_key';

// --- DATABASE SETUP ---
const db = new Database('nook.db');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, is_dev INTEGER DEFAULT 0);
  CREATE TABLE IF NOT EXISTS friends (user_id INTEGER, friend_id INTEGER, status TEXT DEFAULT 'pending');
  CREATE TABLE IF NOT EXISTS nooks (id INTEGER PRIMARY KEY, name TEXT, owner_id INTEGER);
  CREATE TABLE IF NOT EXISTS nook_members (nook_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member');
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, nook_id INTEGER, channel_name TEXT, user_id INTEGER, text TEXT, timestamp INTEGER);
`);

// Seed "mathew" as the dev user if they don't exist
const mathew = db.prepare('SELECT * FROM users WHERE username = ?').get('mathew');
if (!mathew) {
  const hash = bcrypt.hashSync('devpassword123', 10); // Default password for Mathew
  db.prepare('INSERT INTO users (username, password, is_dev) VALUES (?, ?, 1)').run('mathew', hash);
}

// Seed default donate link
const donateLink = db.prepare('SELECT * FROM settings WHERE key = ?').get('donate_link');
if (!donateLink) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('donate_link', 'https://ko-fi.com/your_default_link');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  
  const exists = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (exists) return res.status(400).json({ error: 'Username taken' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run(username, hash);
  const token = jwt.sign({ id: result.lastInsertRowid, username, is_dev: 0 }, JWT_SECRET);
  res.json({ token, user: { id: result.lastInsertRowid, username, is_dev: 0 } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, is_dev: user.is_dev }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, is_dev: user.is_dev } });
});

// --- SETTINGS ROUTE (Dev Only) ---
app.get('/api/settings', (req, res) => {
  const link = db.prepare('SELECT value FROM settings WHERE key = ?').get('donate_link');
  res.json({ donate_link: link.value });
});

app.post('/api/settings/donate', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_dev) return res.status(403).json({ error: 'Mathew only!' });
    
    db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(req.body.link, 'donate_link');
    io.emit('donateLinkUpdated', req.body.link);
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// --- SOCKET LOGIC ---
const activeUsers = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log(`🌿 ${socket.user.username} entered the nook`);
  activeUsers.set(socket.id, socket.user);
  io.emit('userList', Array.from(activeUsers.values()));

  // Friend Requests
  socket.on('sendFriendRequest', (friendName) => {
    const friend = db.prepare('SELECT * FROM users WHERE username = ?').get(friendName);
    if (friend && friend.id !== socket.user.id) {
      db.prepare('INSERT OR IGNORE INTO friends (user_id, friend_id) VALUES (?, ?)').run(socket.user.id, friend.id);
      io.emit('friendRequest', { from: socket.user.username, to: friend.username });
    }
  });

  // Nook (Group) Creation
  socket.on('createNook', (nookName) => {
    const result = db.prepare('INSERT INTO nooks (name, owner_id) VALUES (?, ?)').run(nookName, socket.user.id);
    db.prepare('INSERT INTO nook_members (nook_id, user_id, role) VALUES (?, ?, ?)').run(result.lastInsertRowid, socket.user.id, 'owner');
    io.emit('nookCreated', { id: result.lastInsertRowid, name: nookName });
  });

  // Chat Messages
  socket.on('sendNookMessage', (data) => {
    const msg = { nookId: data.nookId, channel: data.channel, user: socket.user.username, text: data.text, timestamp: Date.now() };
    db.prepare('INSERT INTO messages (nook_id, channel_name, user_id, text, timestamp) VALUES (?, ?, ?, ?, ?)')
      .run(data.nookId, data.channel, socket.user.id, data.text, msg.timestamp);
    io.to(`nook_${data.nookId}`).emit('newNookMessage', msg);
  });

  socket.on('joinNook', (nookId) => {
    socket.join(`nook_${nookId}`);
  });

  // Calling Signaling (Framework for WebRTC)
  socket.on('initiateCall', (targetUserId) => {
    const targetSocket = Array.from(activeUsers.entries()).find(([id, u]) => u.id == targetUserId);
    if (targetSocket) {
      io.to(targetSocket[0]).emit('incomingCall', { from: socket.user });
    }
  });

  socket.on('disconnect', () => {
    activeUsers.delete(socket.id);
    io.emit('userList', Array.from(activeUsers.values()));
  });
});

server.listen(PORT, () => console.log(`🌿 nook V2 running on port ${PORT}`));