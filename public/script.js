const socket = io();
let username = '';

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const usernameInput = document.getElementById('username-input');
const joinBtn = document.getElementById('join-btn');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const typingIndicator = document.getElementById('typing-indicator');

let typingTimeout;

joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (name) {
    username = name;
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    messageInput.focus();
  }
});

usernameInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') joinBtn.click();
});

messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (text) {
    socket.emit('sendMessage', { user: username, text });
    messageInput.value = '';
    socket.emit('typing', { user: '' }); // stop typing indicator
  }
});

messageInput.addEventListener('input', () => {
  socket.emit('typing', { user: username });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', { user: '' });
  }, 1500);
});

socket.on('messageHistory', (history) => {
  messagesContainer.innerHTML = '';
  history.forEach(msg => appendMessage(msg, msg.user === username));
  scrollToBottom();
});

socket.on('newMessage', (msg) => {
  appendMessage(msg, msg.user === username);
  scrollToBottom();
});

socket.on('userTyping', (user) => {
  if (user && user !== username) {
    typingIndicator.textContent = `${user} is typing...`;
    typingIndicator.classList.remove('hidden');
  } else {
    typingIndicator.classList.add('hidden');
  }
});

function appendMessage(msg, isOwn) {
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'own' : 'other'}`;
  
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  div.innerHTML = `
    ${!isOwn ? `<span class="user">${escapeHtml(msg.user)}</span>` : ''}
    <span class="text">${escapeHtml(msg.text)}</span>
    <span class="time">${time}</span>
  `;
  messagesContainer.appendChild(div);
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}