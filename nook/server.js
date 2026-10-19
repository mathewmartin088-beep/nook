const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' } // Allow all origins for simplicity
});

const PORT = process.env.PORT || 10000;
const MESSAGE_HISTORY_LIMIT = 50;
let messageHistory = [];

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  console.log('🌿 A user entered the nook:', socket.id);

  // Send recent history to newly connected users
  socket.emit('messageHistory', messageHistory);

  socket.on('sendMessage', (data) => {
    const message = {
      id: Date.now().toString(),
      user: data.user || 'Anonymous',
      text: data.text,
      timestamp: new Date().toISOString()
    };
    
    messageHistory.push(message);
    if (messageHistory.length > MESSAGE_HISTORY_LIMIT) {
      messageHistory.shift(); // Keep it lightweight
    }

    io.emit('newMessage', message);
  });

  socket.on('typing', (data) => {
    socket.broadcast.emit('userTyping', data.user);
  });

  socket.on('disconnect', () => {
    console.log('🍂 A user left the nook:', socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🌿 nook server is running warmly on port ${PORT}`);
});