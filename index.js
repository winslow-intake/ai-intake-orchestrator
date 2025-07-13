import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fetch from 'node-fetch';
import { handleWebSocketConnection } from './services/websocket-handler.js';
// REMOVED: import { handleOutboundWebSocketConnection } from './services/outbound-websocket-handler.js';
import outboundRoutes from './routes/outbound.js';
// REMOVED: import customLLMRoutes from './services/custom-llm-handler.js';
// REMOVED: import conversationInitRoutes from './services/conversation-init-webhook.js';

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

// Routes
app.use('/outbound', outboundRoutes);
// REMOVED: Custom LLM and webhook routes - no longer needed

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

// WebSocket connection handling - ONLY for inbound calls now
wss.on('connection', (ws, req) => {
  console.log('🔌 WebSocket connection established');
  // Always use inbound handler - no more path routing needed
  handleWebSocketConnection(ws);
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AI Intake Server running on port ${PORT}`);
  console.log(`📞 Twilio inbound webhook: https://your-app.onrender.com/voice`);
  console.log(`🎯 Outbound trigger: https://your-app.onrender.com/outbound/trigger`);
  console.log('✅ Ready for voice calls via Twilio → ElevenLabs');
});