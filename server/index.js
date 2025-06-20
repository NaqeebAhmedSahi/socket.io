require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.io and Express
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/pinAuth', {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('Connected to MongoDB'))
.catch(err => console.error('MongoDB connection error:', err));

// Define Session Schema
const sessionSchema = new mongoose.Schema({
  pin: { type: String, required: true, unique: true },
  socketId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: '1h' } // Auto-delete after 1 hour
});

const Session = mongoose.model('Session', sessionSchema);

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle PIN entry
  socket.on('enter-pin', async (pin) => {
    try {
      // Check if PIN already exists
      const existingSession = await Session.findOne({ pin });
      
      if (existingSession) {
        // Notify the existing session to logout
        io.to(existingSession.socketId).emit('force-logout', { message: 'Logged in from another device' });
        
        // Update the session with new socket ID
        await Session.updateOne({ pin }, { socketId: socket.id });
        
        // Notify the new client that they overwrote an existing session
        socket.emit('pin-status', { status: 'overwritten', pin });
      } else {
        // Create new session
        await Session.create({ pin, socketId: socket.id });
        socket.emit('pin-status', { status: 'success', pin });
      }
    } catch (err) {
      console.error('Error handling PIN:', err);
      socket.emit('pin-error', { message: 'Error processing PIN' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    await Session.deleteOne({ socketId: socket.id });
  });
});

// Basic route
app.get('/', (req, res) => {
  res.send('PIN Auth Server');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});