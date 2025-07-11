require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');

const webhookRoutes = require('./routes/webhook');
const inboundRoutes = require('./routes/inbound');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/media' });

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/webhook', webhookRoutes);
app.use('/inbound', inboundRoutes);

app.get('/twiml', (req, res) => {
  res.type('text/xml');
  res.send(`
    <Response>
      <Connect>
        <Stream url="wss://${process.env.PUBLIC_HOST}/media" />
      </Connect>
    </Response>
  `);
});

// WebSocket: Handles incoming Twilio call audio, sends to ElevenLabs
wss.on('connection', async (ws) => {
  console.log('📞 Incoming WebSocket connection from Twilio');

  try {
    const response = await axios.post(
      `https://api.elevenlabs.io/v1/agents/${process.env.ELEVENLABS_AGENT_ID}/interactions`,
      {
        agent_id: process.env.ELEVENLABS_AGENT_ID,
        text_input: 'Hi there! How can I help you today?'
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const audio = Buffer.from(response.data.audio, 'base64');
    ws.send(audio);
    console.log('🎙️ AI response sent');

  } catch (err) {
    console.error('❌ ElevenLabs error:', err.response?.data || err.message);
  }

  ws.on('close', () => console.log('📴 Twilio WebSocket closed'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🟢 Server listening on port ${PORT}`);
});
