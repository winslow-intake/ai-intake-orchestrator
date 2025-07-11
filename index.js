import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// 👇 Twilio hits this route to start the call
app.post('/twiml', (req, res) => {
  const twiml = `
    <Response>
      <Connect>
        <Stream url="wss://ai-media-server.onrender.com/media" />
      </Connect>
    </Response>
  `;
  res.type('text/xml');
  res.send(twiml);
});

// 👇 Optional: media stream WebSocket
wss.on('connection', (ws) => {
  console.log('🔗 WebSocket connected');

  ws.on('message', async (message) => {
    console.log('📦 Received media chunk');

    try {
      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ audio: message }),
      });

      const result = await response.json();
      console.log('📝 Transcription:', result);
    } catch (err) {
      console.error('❌ ElevenLabs error:', err);
    }
  });

  ws.on('close', () => console.log('🔌 WebSocket disconnected'));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
