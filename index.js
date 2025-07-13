import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fetch from 'node-fetch';
// import { twilioClient } from './services/twilio-client.js';
import { handleWebSocketConnection } from './services/websocket-handler.js';
import { handleOutboundWebSocketConnection } from './services/outbound-websocket-handler.js';
import outboundRoutes from './routes/outbound.js';
import customLLMRoutes from './services/custom-llm-handler.js';
import conversationInitRoutes from './services/conversation-init-webhook.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'AI Intake Server Running', timestamp: new Date().toISOString() });
});

// Debug: Log all requests to /api/*
app.use('/api/*', (req, res, next) => {
  console.log('🔍 API Request:', req.method, req.path, req.body);
  next();
});

// Routes
app.use('/outbound', outboundRoutes);
app.use('/api', customLLMRoutes);  // Custom LLM endpoints (can remove later)
app.use('/api', conversationInitRoutes);  // ElevenLabs webhook endpoints

// 🎯 TWILIO WEBHOOK - This is what your Twilio phone number should call
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from Twilio:', req.body);
  
  // Return TwiML that rings first, then connects to our WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="3"/>
  <Connect>
    <Stream url="wss://${req.get('host')}/media" />
  </Connect>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

// WebSocket connection handling with path routing
wss.on('connection', (ws, req) => {
  const path = req.url;
  console.log('🔌 WebSocket connection on path:', path);
  
  if (path === '/media-outbound') {
    // Handle outbound calls
    handleOutboundWebSocketConnection(ws);
  } else {
    // Default to inbound handler
    handleWebSocketConnection(ws);
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AI Intake Server running on port ${PORT}`);
  console.log(`📞 Twilio webhook: https://your-app.onrender.com/voice`);
  console.log(`🤖 Custom LLM endpoint: https://your-app.onrender.com/api/custom-llm/{callSid}`);
  console.log(`🎯 ElevenLabs webhook: https://your-app.onrender.com/api/conversation-init`);
  console.log('✅ Ready for voice calls via Twilio → ElevenLabs');
});