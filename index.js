const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const inboundRoutes = require('./routes/inbound');
const webhookRoutes = require('./routes/webhook');

app.use('/inbound', inboundRoutes);
app.use('/webhook', webhookRoutes);

app.get('/', (req, res) => {
  res.send('🤖 AI Intake Orchestrator is running');
});

// WebSocket server for Twilio Media Streams
const wss = new WebSocket.Server({ server, path: '/media-stream' });

wss.on('connection', (ws) => {
  console.log('📞 New WebSocket connection from Twilio');

  let streamSid = null;
  let elevenLabsWs = null;
  let elevenLabsReady = false;

  ws.on('message', async (message) => {
    try {
      const msg = JSON.parse(message);

      switch (msg.event) {
        case 'start':
          streamSid = msg.start.streamSid;
          console.log(`🚀 Stream started: ${streamSid}`);

          // Connect to ElevenLabs
          const websocketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVENLABS_AGENT_ID}`;
          console.log('🔗 Connecting to ElevenLabs...');

          elevenLabsWs = new WebSocket(websocketUrl, {
            headers: {
              'xi-api-key': process.env.ELEVENLABS_API_KEY
            }
          });

          elevenLabsWs.on('open', () => {
            console.log('🎙️ Connected to ElevenLabs');
            elevenLabsWs.send(JSON.stringify({
              type: 'start_session',
              audio_format: 'mulaw',
              sample_rate: 8000
            }));
          });

          elevenLabsWs.on('message', (data) => {
            try {
              const response = JSON.parse(data);
              console.log('📨 ElevenLabs message:', response.type);

              if (response.type === 'session_started') {
                console.log('✅ ElevenLabs session started');
                elevenLabsReady = true;
              }

              if (response.type === 'audio' && response.audio_event) {
                ws.send(JSON.stringify({
                  event: 'media',
                  streamSid,
                  media: { payload: response.audio_event.audio_base_64 }
                }));
              }

              if (response.type === 'interruption') {
                ws.send(JSON.stringify({ event: 'clear', streamSid }));
              }
            } catch (err) {
              console.error('❌ Error parsing ElevenLabs message:', err);
            }
          });

          elevenLabsWs.on('close', () => {
            console.log('🔌 ElevenLabs connection closed');
          });

          elevenLabsWs.on('error', (err) => {
            console.error('❌ ElevenLabs error:', err);
          });

          break;

        case 'media':
          if (!elevenLabsReady) {
            console.log('⏳ ElevenLabs not ready yet. Dropping audio chunk.');
            return;
          }

          if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
            elevenLabsWs.send(JSON.stringify({
              type: 'audio_chunk',
              data: msg.media.payload
            }));
          } else {
            console.log('❌ ElevenLabs WebSocket not open — skipping audio send');
          }
          break;

        case 'stop':
          console.log('🛑 Stream stop
