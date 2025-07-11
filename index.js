import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/media' });

const PORT = process.env.PORT || 3000;
const HOST = process.env.PUBLIC_HOST || 'localhost';

app.use(express.urlencoded({ extended: true }));

app.post('/twiml', (req, res) => {
  res.type('text/xml');
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${HOST}/media" />
      </Connect>
    </Response>
  `);
});

wss.on('connection', (ws) => {
  console.log('🔗 WebSocket connected to Twilio media stream');

  let sessionId = null;

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());

    if (msg.event === 'start') {
      sessionId = msg.start.callSid;
      console.log(`📞 Call started: ${sessionId}`);
    }

    if (msg.event === 'media' && msg.media?.payload) {
      const audioBuffer = Buffer.from(msg.media.payload, 'base64');

      const response = await fetch(`https://api.elevenlabs.io/v1/speech-to-text`, {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio: audioBuffer.toString('base64'),
          encoding: 'mulaw',
          sample_rate: 8000,
          agent_id: process.env.ELEVENLABS_AGENT_ID,
        })
      });

      const result = await response.json();
      if (result?.text) {
        console.log(`🗣️ Transcription: ${result.text}`);
      }
    }

    if (msg.event === 'stop') {
      console.log(`⛔ Call ended: ${sessionId}`);
    }
  });

  ws.on('close', () => {
    console.log(`❌ WebSocket disconnected`);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server live at http://localhost:${PORT}`);
});
