const express = require('express');
const bodyParser = require('body-parser');
const WebSocket = require('ws');
const http = require('http');
require('dotenv').config();
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server
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

    ws.on('message', async (message) => {
        try {
            const msg = JSON.parse(message);

            switch (msg.event) {
                case 'start':
                    streamSid = msg.start.streamSid;
                    console.log(`🚀 Stream started: ${streamSid}`);

                    const websocketUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${process.env.ELEVENLABS_AGENT_ID}`;
                    console.log('🔗 Connecting to ElevenLabs...');

                    elevenLabsWs = new WebSocket(websocketUrl, {
                        headers: {
                            'xi-api-key': process.env.ELEVENLABS_API_KEY
                        }
                    });

                    elevenLabsWs.on('open', () => {
                        console.log('🎙️ Connected to ElevenLabs');

                        // Send initial prompt to open the session
                        elevenLabsWs.send(JSON.stringify({
                            text: "Hello, thank you for calling. How can I help you?",
                            voice: {
                                voice_id: process.env.ELEVENLABS_VOICE_ID
                            }
                        }));
                    });

                    elevenLabsWs.on('message', (data) => {
                        try {
                            const response = JSON.parse(data);
                            console.log('📨 ElevenLabs message:', response.type);

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
                        } catch (error) {
                            console.error('❌ Error processing ElevenLabs message:', error);
                        }
                    });

                    elevenLabsWs.on('close', () => {
                        console.log('🔌 ElevenLabs connection closed');
                    });

                    elevenLabsWs.on('error', (error) => {
                        console.error('❌ ElevenLabs WebSocket error:', error);
                    });
                    break;

                case 'media':
                    console.log('📦 Received media event from Twilio');
                    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
                        elevenLabsWs.send(JSON.stringify({
                            audio: {
                                mime_type: 'audio/mulaw;rate=8000',
                                data: msg.media.payload
                            }
                        }));
                    } else {
                        console.log('❌ ElevenLabs WebSocket not open — skipping audio send');
                    }
                    break;

                case 'stop':
                    console.log('🛑 Stream stopped');
                    if (elevenLabsWs) {
                        elevenLabsWs.close();
                    }
                    break;

                default:
                    console.log(`Unknown event: ${msg.event}`);
            }
        } catch (error) {
            console.error('❌ Error processing Twilio message:', error);
        }
    });

    ws.on('close', () => {
        console.log('📴 Twilio WebSocket closed');
        if (elevenLabsWs) {
            elevenLabsWs.close();
        }
    });

    ws.on('error', (error) => {
        console.error('❌ Twilio WebSocket error:', error);
        if (elevenLabsWs) {
            elevenLabsWs.close();
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
