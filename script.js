let token = localStorage.getItem('nook_token');
let currentUser = JSON.parse(localStorage.getItem('nook_user'));
let currentNook = null;
let socket;

// --- QUICK SWITCH LOGIN UI ---
function loadRecentAccounts() {
  const recent = JSON.parse(localStorage.getItem('recent_accounts') || '[]');
  const area = document.getElementById('quick-switch-area');
  const list = document.getElementById('recent-accounts-list');
  
  if (recent.length > 0) {
    area.style.display = 'block';
    list.innerHTML = '';
    recent.forEach(acc => {
      const btn = document.createElement('button');
      btn.className = 'recent-account-btn';
      btn.innerHTML = `<span>${acc.username}</span> <span style="opacity:0.5">Switch</span>`;
      btn.onclick = () => {
        document.getElementById('auth-username').value = acc.username;
        document.getElementById('auth-password').focus();
      };
      list.appendChild(btn);
    });
  }
}
loadRecentAccounts();

// --- SOCKET CONNECTION ---
if (token) {
  socket = io({ auth: { token } });
  
  socket.on('connect_error', (err) => {
    if (err.message === 'Invalid token') {
      localStorage.clear();
      location.reload();
    }
  });

  socket.on('nookCreated', (nook) => {
    const li = document.createElement('li');
    li.innerText = nook.name;
    li.onclick = () => joinNook(nook);
    document.getElementById('nooks-list').appendChild(li);
  });

  socket.on('newNookMessage', (msg) => {
    const div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = `<div class="user">${msg.user}</div><div class="text">${msg.text}</div>`;
    document.getElementById('messages-area').appendChild(div);
    document.getElementById('messages-area').scrollTop = 999999;
  });

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

  socket.on('donateLinkUpdated', (link) => { document.getElementById('donate-link').href = link; });
}

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
  
  // Setup User Profile UI
  document.getElementById('display-username').innerText = currentUser.username;
  document.getElementById('user-avatar-letter').innerText = currentUser.username.charAt(0).toUpperCase();
  if (currentUser.is_dev) document.getElementById('dev-settings-btn').style.display = 'flex';
  
  loadDonateLink();
}

// --- LOGOUT & SWITCH ACCOUNT ---
document.getElementById('logout-btn').onclick = () => {
  localStorage.removeItem('nook_token');
  localStorage.removeItem('nook_user');
  location.reload();
};

document.getElementById('switch-account-btn').onclick = () => {
  // Save current user to recent accounts for quick switching later
  let recent = JSON.parse(localStorage.getItem('recent_accounts') || '[]');
  recent = recent.filter(u => u.username !== currentUser.username); // prevent duplicates
  recent.unshift({ username: currentUser.username }); // add to front
  if (recent.length > 3) recent.pop(); // keep only last 3
  
  localStorage.setItem('recent_accounts', JSON.stringify(recent));
  
  // Now log out
  localStorage.removeItem('nook_token');
  localStorage.removeItem('nook_user');
  location.reload();
};

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
  if(name && socket) socket.emit('sendFriendRequest', name);
};

document.getElementById('create-nook-btn').onclick = () => {
  const name = document.getElementById('create-nook-input').value;
  if(name && socket) socket.emit('createNook', name);
};

function joinNook(nook) {
  currentNook = nook;
  if(socket) socket.emit('joinNook', nook.id);
  document.getElementById('messages-area').innerHTML = '';
  document.getElementById('message-form').style.display = 'flex';
  document.getElementById('current-view-title').innerText = `# ${nook.name}`;
}

document.getElementById('message-form').onsubmit = (e) => {
  e.preventDefault();
  const input = document.getElementById('message-input');
  if(input.value && currentNook && socket) {
    socket.emit('sendNookMessage', { nookId: currentNook.id, channel: 'general', text: input.value });
    input.value = '';
  }
};

// --- DEV SETTINGS ---
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