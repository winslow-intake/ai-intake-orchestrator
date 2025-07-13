import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fetch from 'node-fetch';
// import { twilioClient } from './services/twilio-client.js';
import { handleWebSocketConnection } from './services/websocket-handler.js';
import outboundRoutes from './routes/outbound.js';
import customLLMRoutes from './services/custom-llm-handler.js';  // NEW LINE

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

// Outbound route
app.use('/outbound', outboundRoutes);
app.use('/api', customLLMRoutes);  // NEW LINE - Custom LLM endpoints

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

wss.on('connection', handleWebSocketConnection);  // UNCHANGED - Still using original handler

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AI Intake Server running on port ${PORT}`);
  console.log(`📞 Twilio webhook: https://your-app.onrender.com/voice`);
  console.log(`🤖 Custom LLM endpoint: https://your-app.onrender.com/api/custom-llm/{callSid}`);  // NEW LINE
  console.log('✅ Ready for voice calls via Twilio → ElevenLabs');
});