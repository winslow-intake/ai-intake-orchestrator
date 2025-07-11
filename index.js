require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const fetch = require('node-fetch');

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

// 👇 This WebSocket handles media stream (optional if using separate media server)
wss.on('connection', (ws) => {
  console.log('🔗 WebSocket connected to Twilio media stream');

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
      console.error('❌ Error sending to ElevenLabs:', err);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server live at http://localhost:${PORT}`);
});
