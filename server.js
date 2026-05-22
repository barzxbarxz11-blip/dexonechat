const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(cors());

// Buat folder uploads jika belum ada
if (!fs.existsSync('./public/uploads')) {
  fs.mkdirSync('./public/uploads', { recursive: true });
}

// Database setup
const db = new sqlite3.Database('./database.sqlite');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    avatar TEXT,
    online INTEGER DEFAULT 0,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS private_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user INTEGER,
    to_user INTEGER,
    message TEXT,
    image TEXT,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(from_user) REFERENCES users(id),
    FOREIGN KEY(to_user) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS blocked_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    blocked_user_id INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(blocked_user_id) REFERENCES users(id)
  )`);
});

// File upload setup
const storage = multer.diskStorage({
  destination: './public/uploads/',
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// JWT Secret
const JWT_SECRET = 'obsidianae_super_secret_key_3480';

// Middleware auth
function authenticateToken(req, res, next) {
  const token = req.headers['authorization'];
  if (!token) return res.status(401).json({ error: 'Token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

// ============ API ENDPOINTS ============

// Register
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan password wajib diisi' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  
  db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
    [username, hashedPassword], 
    function(err) {
      if (err) {
        return res.status(400).json({ error: 'Username sudah digunakan' });
      }
      res.json({ success: true, message: 'Registrasi berhasil!' });
    });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Username atau password salah' });
    }
    
    // Update online status
    db.run('UPDATE users SET online = 1, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
    
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
    res.json({ 
      success: true, 
      token, 
      user: { id: user.id, username: user.username, avatar: user.avatar }
    });
  });
});

// Get all users (except current)
app.get('/api/users', authenticateToken, (req, res) => {
  db.all('SELECT id, username, online, last_seen FROM users WHERE id != ?', 
    [req.user.id], 
    (err, users) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(users);
    });
});

// Get chat history with specific user
app.get('/api/messages/:userId', authenticateToken, (req, res) => {
  const otherUserId = req.params.userId;
  const currentUserId = req.user.id;
  
  db.all(`SELECT * FROM private_messages 
    WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)
    ORDER BY created_at ASC`,
    [currentUserId, otherUserId, otherUserId, currentUserId],
    (err, messages) => {
      if (err) return res.status(500).json({ error: err.message });
      
      // Mark messages as read
      db.run(`UPDATE private_messages SET is_read = 1 
        WHERE from_user = ? AND to_user = ?`, [otherUserId, currentUserId]);
      
      res.json(messages);
    });
});

// Get chat list (inbox)
app.get('/api/chats', authenticateToken, (req, res) => {
  const currentUserId = req.user.id;
  
  db.all(`SELECT 
    u.id, u.username, u.online,
    (SELECT message FROM private_messages 
     WHERE (from_user = u.id AND to_user = ?) OR (from_user = ? AND to_user = u.id)
     ORDER BY created_at DESC LIMIT 1) as last_message,
    (SELECT created_at FROM private_messages 
     WHERE (from_user = u.id AND to_user = ?) OR (from_user = ? AND to_user = u.id)
     ORDER BY created_at DESC LIMIT 1) as last_time,
    (SELECT COUNT(*) FROM private_messages 
     WHERE from_user = u.id AND to_user = ? AND is_read = 0) as unread_count
    FROM users u
    WHERE u.id != ?
    AND EXISTS (SELECT 1 FROM private_messages 
      WHERE (from_user = u.id AND to_user = ?) OR (from_user = ? AND to_user = u.id))
    ORDER BY last_time DESC`,
    [currentUserId, currentUserId, currentUserId, currentUserId, currentUserId, currentUserId, currentUserId],
    (err, chats) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(chats || []);
    });
});

// Block user
app.post('/api/block/:userId', authenticateToken, (req, res) => {
  const blockedUserId = req.params.userId;
  const currentUserId = req.user.id;
  
  db.run('INSERT OR IGNORE INTO blocked_users (user_id, blocked_user_id) VALUES (?, ?)',
    [currentUserId, blockedUserId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Unblock user
app.delete('/api/block/:userId', authenticateToken, (req, res) => {
  const blockedUserId = req.params.userId;
  const currentUserId = req.user.id;
  
  db.run('DELETE FROM blocked_users WHERE user_id = ? AND blocked_user_id = ?',
    [currentUserId, blockedUserId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Delete chat history
app.delete('/api/chat/:userId', authenticateToken, (req, res) => {
  const otherUserId = req.params.userId;
  const currentUserId = req.user.id;
  
  db.run(`DELETE FROM private_messages 
    WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)`,
    [currentUserId, otherUserId, otherUserId, currentUserId],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
});

// Upload image
app.post('/api/upload', authenticateToken, upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  res.json({ imageUrl: `/uploads/${req.file.filename}` });
});

// ============ SOCKET.IO ============
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('user_online', (userId) => {
    onlineUsers.set(userId, socket.id);
    db.run('UPDATE users SET online = 1 WHERE id = ?', [userId]);
    io.emit('user_status_change', { userId, online: true });
  });
  
  socket.on('private_message', async (data) => {
    const { from_user, to_user, message, image } = data;
    
    db.run(`INSERT INTO private_messages (from_user, to_user, message, image, is_read) 
      VALUES (?, ?, ?, ?, ?)`,
      [from_user, to_user, message, image, 0],
      function(err) {
        if (err) return;
        
        const messageData = {
          id: this.lastID,
          from_user,
          to_user,
          message,
          image,
          created_at: new Date().toISOString()
        };
        
        const receiverSocketId = onlineUsers.get(to_user);
        if (receiverSocketId) {
          io.to(receiverSocketId).emit('new_private_message', messageData);
          db.run('UPDATE private_messages SET is_read = 1 WHERE id = ?', [this.lastID]);
        }
        
        socket.emit('message_sent', messageData);
      });
  });
  
  socket.on('typing', (data) => {
    const { from_user, to_user, is_typing } = data;
    const receiverSocketId = onlineUsers.get(to_user);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('user_typing', { from_user, is_typing });
    }
  });
  
  socket.on('mark_as_read', (data) => {
    const { message_id, from_user, to_user } = data;
    db.run('UPDATE private_messages SET is_read = 1 WHERE id = ?', [message_id]);
    
    const senderSocketId = onlineUsers.get(from_user);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message_read', { message_id, to_user });
    }
  });
  
  socket.on('disconnect', () => {
    let disconnectedUserId = null;
    for (let [userId, socketId] of onlineUsers.entries()) {
      if (socketId === socket.id) {
        disconnectedUserId = userId;
        onlineUsers.delete(userId);
        break;
      }
    }
    if (disconnectedUserId) {
      db.run('UPDATE users SET online = 0, last_seen = CURRENT_TIMESTAMP WHERE id = ?', [disconnectedUserId]);
      io.emit('user_status_change', { userId: disconnectedUserId, online: false });
    }
  });
});

// Serve static files
app.use('/uploads', express.static('public/uploads'));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});