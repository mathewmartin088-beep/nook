let token = localStorage.getItem('nook_token');
let currentUser = JSON.parse(localStorage.getItem('nook_user'));
let currentNook = null;

const socket = io({ auth: { token } });

// --- AUTH ---
document.getElementById('login-btn').onclick = () => auth('login');
document.getElementById('register-btn').onclick = () => auth('register');

async function auth(action) {
  const username = document.getElementById('auth-username').value;
  const password = document.getElementById('auth-password').value;
  const res = await fetch(`/api/${action}`, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (data.token) {
    localStorage.setItem('nook_token', data.token);
    localStorage.setItem('nook_user', JSON.stringify(data.user));
    location.reload();
  } else { alert(data.error); }
}

if (token) {
  document.getElementById('auth-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');
  if (currentUser.is_dev) document.getElementById('dev-settings-btn').style.display = 'flex';
  loadDonateLink();
}

// --- NAVIGATION ---
document.querySelectorAll('.nav-icon').forEach(icon => {
  icon.onclick = () => {
    document.querySelectorAll('.nav-icon').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.sidebar-view').forEach(v => v.classList.remove('active'));
    icon.classList.add('active');
    const view = icon.dataset.view;
    document.getElementById(`${view}-view`).classList.add('active');
    document.getElementById('current-view-title').innerText = view.charAt(0).toUpperCase() + view.slice(1);
  };
});

// --- FRIENDS & NOOKS ---
document.getElementById('add-friend-btn').onclick = () => {
  const name = document.getElementById('add-friend-input').value;
  if(name) socket.emit('sendFriendRequest', name);
};

document.getElementById('create-nook-btn').onclick = () => {
  const name = document.getElementById('create-nook-input').value;
  if(name) socket.emit('createNook', name);
};

socket.on('nookCreated', (nook) => {
  const li = document.createElement('li');
  li.innerText = nook.name;
  li.onclick = () => joinNook(nook);
  document.getElementById('nooks-list').appendChild(li);
});

function joinNook(nook) {
  currentNook = nook;
  socket.emit('joinNook', nook.id);
  document.getElementById('messages-area').innerHTML = '';
  document.getElementById('message-form').style.display = 'flex';
  document.getElementById('current-view-title').innerText = `# ${nook.name}`;
}

document.getElementById('message-form').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  if(input.value && currentNook) {
    socket.emit('sendNookMessage', { nookId: currentNook.id, channel: 'general', text: input.value });
    input.value = '';
  }
};

socket.on('newNookMessage', (msg) => {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<div class="user">${msg.user}</div><div class="text">${msg.text}</div>`;
  document.getElementById('messages-area').appendChild(div);
  document.getElementById('messages-area').scrollTop = 999999;
});

// --- DEV SETTINGS (MATHW ONLY) ---
document.getElementById('update-donate-btn').onclick = async () => {
  const link = document.getElementById('donate-link-input').value;
  await fetch('/api/settings/donate', {
    method: 'POST', headers: {'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`},
    body: JSON.stringify({ link })
  });
  alert('Donate link updated!');
};

async function loadDonateLink() {
  const res = await fetch('/api/settings');
  const data = await res.json();
  document.getElementById('donate-link').href = data.donate_link;
}
socket.on('donateLinkUpdated', (link) => { document.getElementById('donate-link').href = link; });

// --- ONLINE USERS & CALLING ---
socket.on('userList', (users) => {
  const list = document.getElementById('online-list');
  list.innerHTML = '';
  users.forEach(u => {
    const li = document.createElement('li');
    li.innerText = u.username;
    li.onclick = () => { if(u.id != currentUser.id) socket.emit('initiateCall', u.id); };
    list.appendChild(li);
  });
});

socket.on('incomingCall', (data) => {
  if(confirm(`Incoming call from ${data.from.username}! Answer?`)) {
    alert('Call connected! (WebRTC audio wiring in next step)');
  }
});