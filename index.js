import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import WebSocket from 'ws';
import fetch from 'node-fetch';

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

// 🎯 TWILIO WEBHOOK - This is what your Twilio phone number should call
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from Twilio:', req.body);
  
  // Return TwiML that connects to our WebSocket
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${req.get('host')}/media" />
  </Connect>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

// 🎯 WEBSOCKET CONNECTION - Handles Twilio ↔ ElevenLabs audio streaming
wss.on('connection', (ws) => {
  console.log('🔌 WebSocket connection established');
  
  let elevenLabsWs = null;
  let streamSid = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'start') {
        streamSid = data.start.streamSid;
        console.log(`🎬 Stream started: ${streamSid}`);
        
        // 🚀 Connect to ElevenLabs using signed URL approach
        const agentId = process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;
        
        if (!agentId || !apiKey) {
          console.error('❌ Missing ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY');
          return;
        }
        
        try {
          console.log('🔑 Getting signed URL from ElevenLabs...');
          const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
            headers: {
              'xi-api-key': apiKey
            }
          });
          
          if (!signedUrlResponse.ok) {
            console.error('❌ Failed to get signed URL:', signedUrlResponse.statusText, await signedUrlResponse.text());
            return;
          }
          
          const signedUrlData = await signedUrlResponse.json();
          console.log('✅ Got signed URL from ElevenLabs');
          
          elevenLabsWs = new WebSocket(signedUrlData.signed_url);
          
          elevenLabsWs.on('open', () => {
            console.log('✅ Connected to ElevenLabs Conversational AI');
          });
          
          elevenLabsWs.on('message', (elevenLabsMessage) => {
            try {
              const elevenLabsData = JSON.parse(elevenLabsMessage);
              console.log('📥 ElevenLabs message type:', elevenLabsData.type);
              
              if (elevenLabsData.type === 'conversation_initiation_metadata') {
                console.log('🎬 Conversation initiated successfully');
              }
              
              if (elevenLabsData.type === 'audio' && elevenLabsData.audio_event) {
                // Forward audio from ElevenLabs to Twilio
                const audioData = elevenLabsData.audio_event.audio_base_64;
                
                const twilioMessage = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: audioData
                  }
                };
                
                ws.send(JSON.stringify(twilioMessage));
                console.log('🔊 Audio forwarded to Twilio');
              }
              
              if (elevenLabsData.type === 'agent_response') {
                console.log('💬 Agent said:', elevenLabsData.agent_response_event?.agent_response);
              }
              
              if (elevenLabsData.type === 'conversation_end') {
                console.log('🏁 Conversation ended');
                ws.send(JSON.stringify({
                  event: 'stop',
                  streamSid: streamSid
                }));
              }
              
            } catch (error) {
              console.error('❌ Error processing ElevenLabs message:', error);
            }
          });
          
          elevenLabsWs.on('close', (code, reason) => {
            console.log('🔌 ElevenLabs connection closed:', code, reason.toString());
          });
          
          elevenLabsWs.on('error', (error) => {
            console.error('❌ ElevenLabs WebSocket error:', error);
          });
          
        } catch (error) {
          console.error('❌ Error setting up ElevenLabs connection:', error);
        }
      }
      
      if (data.event === 'media' && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        // Forward audio from Twilio to ElevenLabs
        const audioMessage = {
          user_audio_chunk: data.media.payload
        };
        
        elevenLabsWs.send(JSON.stringify(audioMessage));
      }
      
      if (data.event === 'stop') {
        console.log('🛑 Stream stopped');
        if (elevenLabsWs) {
          elevenLabsWs.close();
        }
      }
      
    } catch (error) {
      console.error('❌ Error processing WebSocket message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Twilio WebSocket connection closed');
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AI Intake Server running on port ${PORT}`);
  console.log(`📞 Twilio webhook: https://your-app.onrender.com/voice`);
  console.log('✅ Ready for voice calls via Twilio → ElevenLabs');
});