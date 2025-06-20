require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configure CORS for production and development
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.CLIENT_URL 
    : "http://localhost:3000",
  methods: ["GET", "POST", "OPTIONS"],
  credentials: true
};

// Configure Socket.io with proper settings for Vercel
const io = socketIo(server, {
  cors: corsOptions,
  path: '/socket.io',  // Important for Vercel routing
  transports: ['websocket', 'polling']
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Serve static files from React in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/build')));
}

// Connect to MongoDB with enhanced error handling
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};
connectDB();

// Define Session Schema with validation
const sessionSchema = new mongoose.Schema({
  pin: { 
    type: String, 
    required: true, 
    unique: true,
    minlength: 4,
    maxlength: 10,
    validate: {
      validator: (v) => /^\d+$/.test(v),
      message: 'PIN must contain only numbers'
    }
  },
  socketId: { 
    type: String, 
    required: true 
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: '1h' 
  }
});

const Session = mongoose.model('Session', sessionSchema);

// Enhanced Socket.io connection with error handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle PIN entry with validation
  socket.on('enter-pin', async (pin, callback) => {
    try {
      if (!pin || pin.length < 4) {
        throw new Error('PIN must be at least 4 characters');
      }

      const existingSession = await Session.findOne({ pin });
      
      if (existingSession) {
        // Notify existing session
        io.to(existingSession.socketId).emit('force-logout', { 
          message: 'Logged in from another device',
          timestamp: Date.now()
        });
        
        // Update session atomically
        await Session.findOneAndUpdate(
          { pin }, 
          { socketId: socket.id, createdAt: new Date() }
        );
        
        callback({ status: 'overwritten', pin });
      } else {
        await Session.create({ pin, socketId: socket.id });
        callback({ status: 'success', pin });
      }
    } catch (err) {
      console.error('PIN handling error:', err);
      callback({ status: 'error', message: err.message });
    }
  });

  // Handle disconnection with cleanup
  socket.on('disconnect', async () => {
    console.log('Client disconnected:', socket.id);
    try {
      await Session.deleteOne({ socketId: socket.id });
    } catch (err) {
      console.error('Session cleanup error:', err);
    }
  });

  // Heartbeat to keep connection alive
  socket.on('ping', (cb) => cb());
});

// API routes
app.get('/api/status', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Serve React app for all other routes in production
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});