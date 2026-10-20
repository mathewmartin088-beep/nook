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
