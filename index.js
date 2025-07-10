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

// ... [imports and setup unchanged] ...

wss.on('connection', (ws) => {
    console.log('📞 New WebSocket connection from Twilio');

    let streamSid = null;
    let elevenLabsWs = null;
    let elevenLabsReady = false;
    const mediaBuffer = [];

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);

            switch (msg.event) {
                case 'start':
                    streamSid = msg.start.streamSid;
                    console.log(`🚀 Stream started: ${streamSid}`);

                    const websocketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVENLABS_AGENT_ID}`;
                    elevenLabsWs = new WebSocket(websocketUrl, {
                        headers: {
                            'xi-api-key': process.env.ELEVENLABS_API_KEY
                        }
                    });

                    elevenLabsWs.on('open', () => {
                        console.log('🎙️ Connected to ElevenLabs');
                        elevenLabsWs.send(JSON.stringify({
                            type: 'start_session',
                            audio_format: 'pcm_mulaw',
                            sample_rate: 8000
                        }));
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const response = JSON.parse(data);
                            if (response.type === 'session_started') {
                                elevenLabsReady = true;
                                console.log('✅ ElevenLabs session started — flushing buffer');
                                mediaBuffer.forEach((payload) => elevenLabsWs.send(JSON.stringify(payload)));
                                mediaBuffer.length = 0;
                            }

                            if (response.type === 'audio' && response.audio_event) {
                                ws.send(JSON.stringify({
                                    event: 'media',
                                    streamSid: streamSid,
                                    media: { payload: response.audio_event.audio_base_64 }
                                }));
                            }

                            if (response.type === 'interruption') {
                                ws.send(JSON.stringify({
                                    event: 'clear',
                                    streamSid: streamSid
                                }));
                            }
                        } catch (err) {
                            console.error('❌ Error in ElevenLabs message:', err);
                        }
                    });

                    elevenLabsWs.on('close', () => console.log('🔌 ElevenLabs closed'));
                    elevenLabsWs.on('error', (err) => console.error('❌ ElevenLabs error:', err));
                    break;

                case 'media':
                    const payload = {
                        audio: {
                            mime_type: 'audio/mulaw;rate=8000',
                            data: Buffer.from(msg.media.payload, 'base64').toString('base64')
                        }
                    };
                    if (elevenLabsReady && elevenLabsWs?.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify(payload));
                    } else {
                        mediaBuffer.push(payload);
                        console.log('⏳ ElevenLabs not ready yet. Buffering audio chunk.');
                    }
                    break;

                case 'stop':
                    console.log('🛑 Stream stopped');
                    if (elevenLabsWs) elevenLabsWs.close();
                    break;

                default:
                    console.log(`Unknown event: ${msg.event}`);
            }
        } catch (err) {
            console.error('❌ Error in WS message handler:', err);
        }
    });

    ws.on('close', () => {
        console.log('📴 Twilio WebSocket closed');
        if (elevenLabsWs) elevenLabsWs.close();
    });

    ws.on('error', (err) => {
        console.error('❌ Twilio WS error:', err);
        if (elevenLabsWs) elevenLabsWs.close();
    });
});


server.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
});
