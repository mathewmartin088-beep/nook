const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'nook_super_secret_cozy_key';

// --- POSTGRESQL DATABASE SETUP ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize Tables and Seed Data
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, is_dev INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS friends (user_id INTEGER, friend_id INTEGER, status TEXT DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS nooks (id SERIAL PRIMARY KEY, name TEXT, owner_id INTEGER);
      CREATE TABLE IF NOT EXISTS nook_members (nook_id INTEGER, user_id INTEGER, role TEXT DEFAULT 'member');
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, nook_id INTEGER, channel_name TEXT, user_id INTEGER, text TEXT, timestamp BIGINT);
    `);
    
    // Seed Mathew
    const mathew = await pool.query('SELECT * FROM users WHERE username = $1', ['mathew']);
    if (mathew.rows.length === 0) {
      const hash = bcrypt.hashSync('devpassword123', 10);
      await pool.query('INSERT INTO users (username, password, is_dev) VALUES ($1, $2, $3)', ['mathew', hash, 1]);
      console.log('🌿 Seeded dev user: mathew');
    }

    // Seed Donate Link
    const link = await pool.query('SELECT * FROM settings WHERE key = $1', ['donate_link']);
    if (link.rows.length === 0) {
      await pool.query('INSERT INTO settings (key, value) VALUES ($1, $2)', ['donate_link', 'https://ko-fi.com/default']);
    }
    console.log('🌿 Database initialized and ready.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
    process.exit(1);
  }
}

initDB();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
  
  const exists = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  if (exists.rows.length > 0) return res.status(400).json({ error: 'Username taken' });

  const hash = bcrypt.hashSync(password, 10);
  const result = await pool.query(
    'INSERT INTO users (username, password, is_dev) VALUES ($1, $2, $3) RETURNING id, username, is_dev',
    [username, hash, 0]
  );
  
  const newUser = result.rows[0];
  const token = jwt.sign({ id: newUser.id, username: newUser.username, is_dev: newUser.is_dev }, JWT_SECRET);
  res.json({ token, user: newUser });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const token = jwt.sign({ id: user.id, username: user.username, is_dev: user.is_dev }, JWT_SECRET);
  res.json({ token, user: { id: user.id, username: user.username, is_dev: user.is_dev } });
});

// --- SETTINGS ROUTES ---
app.get('/api/settings', async (req, res) => {
  const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['donate_link']);
  res.json({ donate_link: result.rows[0]?.value || '#' });
});

app.post('/api/settings/donate', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_dev) return res.status(403).json({ error: 'Mathew only!' });
    
    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      ['donate_link', req.body.link]
    );
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

  socket.on('sendFriendRequest', async (friendName) => {
    const friend = await pool.query('SELECT * FROM users WHERE username = $1', [friendName]);
    if (friend.rows.length > 0 && friend.rows[0].id !== socket.user.id) {
      const exists = await pool.query('SELECT * FROM friends WHERE user_id = $1 AND friend_id = $2', [socket.user.id, friend.rows[0].id]);
      if (exists.rows.length === 0) {
        await pool.query('INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, $3)', [socket.user.id, friend.rows[0].id, 'pending']);
      }
      io.emit('friendRequest', { from: socket.user.username, to: friend.rows[0].username });
    }
  });

  socket.on('createNook', async (nookName) => {
    const result = await pool.query(
      'INSERT INTO nooks (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id',
      [nookName, socket.user.id]
    );
    const newNook = result.rows[0];
    await pool.query('INSERT INTO nook_members (nook_id, user_id, role) VALUES ($1, $2, $3)', [newNook.id, socket.user.id, 'owner']);
    io.emit('nookCreated', newNook);
  });

  socket.on('sendNookMessage', async (data) => {
    const result = await pool.query(
      'INSERT INTO messages (nook_id, channel_name, user_id, text, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id, nook_id, channel_name, text, timestamp',
      [data.nookId, data.channel, socket.user.id, data.text, Date.now()]
    );
    const msg = { ...result.rows[0], user: socket.user.username };
    io.to(`nook_${data.nookId}`).emit('newNookMessage', msg);
  });

  socket.on('joinNook', (nookId) => { 
    socket.join(`nook_${nookId}`); 
  });

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
