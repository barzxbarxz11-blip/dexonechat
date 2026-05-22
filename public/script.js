// Global variables
let socket;
let currentUser = null;
let currentChatUser = null;
let typingTimeout = null;
let currentToken = localStorage.getItem('token');

// Check auth
if (!currentToken && !window.location.href.includes('login.html') && !window.location.href.includes('register.html')) {
  window.location.href = 'login.html';
}

// Load user data
const userData = JSON.parse(localStorage.getItem('user') || '{}');
currentUser = userData;

// DOM elements
const messagesContainer = document.getElementById('messagesContainer');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const usersList = document.getElementById('usersList');
const currentUsername = document.getElementById('currentUsername');
const userAvatar = document.getElementById('userAvatar');
const chatUsername = document.getElementById('chatUsername');
const chatStatus = document.getElementById('chatStatus');
const chatAvatar = document.getElementById('chatAvatar');
const chatInputContainer = document.getElementById('chatInputContainer');
const typingIndicator = document.getElementById('typingIndicator');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const attachBtn = document.getElementById('attachBtn');
const menuChatBtn = document.getElementById('menuChatBtn');
const chatMenuModal = document.getElementById('chatMenuModal');
const searchUser = document.getElementById('searchUser');

// Init UI
if (currentUsername && userData.username) {
  currentUsername.innerText = userData.username;
  userAvatar.innerText = userData.username.charAt(0).toUpperCase();
}

// Connect socket
function connectSocket() {
  socket = io({
    transports: ['websocket', 'polling']
  });
  
  socket.on('connect', () => {
    console.log('Socket connected');
    socket.emit('user_online', currentUser.id);
    loadUsers();
    loadChats();
  });
  
  socket.on('new_private_message', (message) => {
    if (currentChatUser && message.from_user === currentChatUser.id) {
      appendMessage(message, false);
      scrollToBottom();
      socket.emit('mark_as_read', {
        message_id: message.id,
        from_user: message.from_user,
        to_user: currentUser.id
      });
    }
    loadChats();
  });
  
  socket.on('message_sent', (message) => {});
  
  socket.on('user_typing', (data) => {
    if (currentChatUser && data.from_user === currentChatUser.id) {
      if (data.is_typing) {
        typingIndicator.innerText = `${currentChatUser.username} sedang mengetik...`;
      } else {
        typingIndicator.innerText = '';
      }
    }
  });
  
  socket.on('user_status_change', (data) => {
    loadUsers();
    if (currentChatUser && currentChatUser.id === data.userId) {
      chatStatus.innerText = data.online ? 'Online' : 'Offline';
    }
  });
  
  socket.on('message_read', (data) => {});
}

// Load users list
async function loadUsers() {
  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': currentToken }
    });
    const users = await res.json();
    displayUsers(users);
  } catch (err) {
    console.error(err);
  }
}

function displayUsers(users) {
  if (!usersList) return;
  
  let html = '';
  users.forEach(user => {
    html += `
      <div class="user-item" onclick="selectUser(${user.id}, '${user.username.replace(/'/g, "\\'")}')">
        <div class="user-avatar">
          ${user.username.charAt(0).toUpperCase()}
          ${user.online ? '<span class="online-dot"></span>' : ''}
        </div>
        <div class="user-info-text">
          <div class="user-name">${escapeHtml(user.username)}</div>
          <div class="user-last-message">${user.online ? 'Online' : 'Offline'}</div>
        </div>
      </div>
    `;
  });
  
  usersList.innerHTML = html || '<div style="color:white;padding:16px;">Belum ada user lain</div>';
  
  if (searchUser) {
    searchUser.addEventListener('input', (e) => {
      const keyword = e.target.value.toLowerCase();
      const items = usersList.querySelectorAll('.user-item');
      items.forEach(item => {
        const name = item.querySelector('.user-name')?.innerText.toLowerCase() || '';
        item.style.display = name.includes(keyword) ? 'flex' : 'none';
      });
    });
  }
}

// Load chat list
async function loadChats() {
  try {
    const res = await fetch('/api/chats', {
      headers: { 'Authorization': currentToken }
    });
    const chats = await res.json();
  } catch (err) {
    console.error(err);
  }
}

// Select user to chat
async function selectUser(userId, username) {
  currentChatUser = { id: userId, username };
  
  chatUsername.innerText = username;
  chatAvatar.innerText = username.charAt(0).toUpperCase();
  chatInputContainer.style.display = 'block';
  
  try {
    const res = await fetch(`/api/messages/${userId}`, {
      headers: { 'Authorization': currentToken }
    });
    const messages = await res.json();
    
    messagesContainer.innerHTML = '';
    messages.forEach(msg => {
      appendMessage(msg, msg.from_user === currentUser.id);
    });
    scrollToBottom();
    
    const usersRes = await fetch('/api/users', {
      headers: { 'Authorization': currentToken }
    });
    const users = await usersRes.json();
    const selectedUser = users.find(u => u.id == userId);
    if (selectedUser) {
      chatStatus.innerText = selectedUser.online ? 'Online' : 'Offline';
    }
  } catch (err) {
    console.error(err);
  }
}

// Append message to chat
function appendMessage(msg, isOwn) {
  const div = document.createElement('div');
  div.className = `message ${isOwn ? 'message-own' : 'message-other'}`;
  
  const time = new Date(msg.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  
  let content = '';
  if (msg.image) {
    content += `<img src="${msg.image}" class="message-image" onclick="previewImage('${msg.image}')">`;
  }
  if (msg.message) {
    content += `<div>${escapeHtml(msg.message)}</div>`;
  }
  
  div.innerHTML = `
    <div class="message-bubble">
      ${content}
      <div class="message-time">
        ${time}
        ${isOwn ? '<span class="message-status">✓✓</span>' : ''}
      </div>
    </div>
  `;
  
  messagesContainer.appendChild(div);
}

// Send message
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !pendingImage) return;
  
  const messageData = {
    from_user: currentUser.id,
    to_user: currentChatUser.id,
    message: text || '',
    image: pendingImage || null
  };
  
  socket.emit('private_message', messageData);
  messageInput.value = '';
  pendingImage = null;
}

// Typing indicator
messageInput?.addEventListener('input', () => {
  if (!currentChatUser) return;
  
  socket.emit('typing', {
    from_user: currentUser.id,
    to_user: currentChatUser.id,
    is_typing: true
  });
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    socket.emit('typing', {
      from_user: currentUser.id,
      to_user: currentChatUser.id,
      is_typing: false
    });
  }, 1000);
});

sendBtn?.addEventListener('click', sendMessage);
messageInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Emoji picker
emojiBtn?.addEventListener('click', () => {
  emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'flex' : 'none';
});

function addEmoji(emoji) {
  messageInput.value += emoji;
  messageInput.focus();
}

// Image upload
let pendingImage = null;

attachBtn?.addEventListener('click', async () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('image', file);
    
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Authorization': currentToken },
      body: formData
    });
    
    const data = await res.json();
    if (data.imageUrl) {
      pendingImage = data.imageUrl;
      showImagePreview(pendingImage);
    }
  };
  input.click();
});

function showImagePreview(url) {
  const preview = document.createElement('div');
  preview.className = 'image-preview';
  preview.innerHTML = `
    <img src="${url}">
    <button onclick="this.parentElement.remove()">✕</button>
  `;
  document.body.appendChild(preview);
}

function previewImage(url) {
  showImagePreview(url);
}

// Delete chat
async function deleteChat() {
  if (!currentChatUser) return;
  
  if (confirm(`Hapus semua chat dengan ${currentChatUser.username}?`)) {
    await fetch(`/api/chat/${currentChatUser.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': currentToken }
    });
    messagesContainer.innerHTML = '<div class="no-chat-selected">Chat telah dihapus</div>';
    closeModal();
    loadChats();
  }
}

// Block user
async function blockUser() {
  if (!currentChatUser) return;
  
  await fetch(`/api/block/${currentChatUser.id}`, {
    method: 'POST',
    headers: { 'Authorization': currentToken, 'Content-Type': 'application/json' }
  });
  alert(`${currentChatUser.username} telah diblokir`);
  closeModal();
}

menuChatBtn?.addEventListener('click', () => {
  chatMenuModal.style.display = 'flex';
});

function closeModal() {
  chatMenuModal.style.display = 'none';
}

// Sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

// Logout
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = 'login.html';
}

// Helper functions
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function scrollToBottom() {
  if (messagesContainer) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Initialize
if (currentToken && currentUser.id) {
  connectSocket();
}

document.addEventListener('click', (e) => {
  if (emojiPicker && emojiBtn && !emojiBtn.contains(e.target) && !emojiPicker.contains(e.target)) {
    emojiPicker.style.display = 'none';
  }
});

function initEmojiPicker() {
  const emojis = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];
  
  if (emojiPicker) {
    let emojiHtml = '<div class="emoji-list">';
    emojis.forEach(emoji => {
      emojiHtml += `<span onclick="addEmoji('${emoji}')">${emoji}</span>`;
    });
    emojiHtml += '</div>';
    emojiPicker.innerHTML = emojiHtml;
  }
}

initEmojiPicker();