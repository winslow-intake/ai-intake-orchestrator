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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// 🎯 WEBSOCKET CONNECTION - Handles real-time audio between Twilio and ElevenLabs
wss.on('connection', (ws) => {
  console.log('🔌 New WebSocket connection');
  
  let elevenLabsWs = null;
  let streamSid = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'start') {
        streamSid = data.start.streamSid;
        console.log(`🎬 Stream started: ${streamSid}`);
        
        // 🚀 Connect to ElevenLabs Conversational AI
        const agentId = process.env.ELEVENLABS_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;
        
        if (!agentId || !apiKey) {
          console.error('❌ Missing ELEVENLABS_AGENT_ID or ELEVENLABS_API_KEY');
          return;
        }
        
        // Try direct connection first (for public agents)
        console.log('🚀 Attempting direct connection to ElevenLabs...');
        let elevenLabsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
        
        elevenLabsWs = new WebSocket(elevenLabsUrl);
        
        elevenLabsWs.on('error', async (error) => {
          console.log('❌ Direct connection failed, trying signed URL...');
          
          try {
            // Get signed URL for private agent
            console.log('🔑 Getting signed URL from ElevenLabs...');
            const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
              headers: {
                'xi-api-key': apiKey
              }
            });
            
            if (!signedUrlResponse.ok) {
              console.error('❌ Failed to get signed URL:', signedUrlResponse.statusText);
              return;
            }
            
            const signedUrlData = await signedUrlResponse.json();
            elevenLabsUrl = signedUrlData.signed_url;
            
            console.log('🚀 Connecting to ElevenLabs with signed URL...');
            elevenLabsWs = new WebSocket(elevenLabsUrl);
            
            setupElevenLabsHandlers();
            
          } catch (signedUrlError) {
            console.error('❌ Signed URL connection also failed:', signedUrlError);
          }
        });
        
        function setupElevenLabsHandlers() {
        
        elevenLabsWs.on('open', () => {
          console.log('✅ Connected to ElevenLabs Conversational AI');
          
          // Send conversation initiation message
          const initMessage = {
            type: "conversation_initiation_client_data",
            conversation_config_override: {},
            custom_llm_extra_body: {}
          };
          
          console.log('📤 Sending initiation message to ElevenLabs');
          elevenLabsWs.send(JSON.stringify(initMessage));
        });
        
        elevenLabsWs.on('message', (elevenLabsMessage) => {
          try {
            const elevenLabsData = JSON.parse(elevenLabsMessage);
            console.log('📥 ElevenLabs message:', elevenLabsData.type);
            
            if (elevenLabsData.type === 'conversation_initiation_metadata') {
              console.log('🎬 Conversation initiated successfully');
            }
            
            if (elevenLabsData.type === 'audio' && elevenLabsData.audio_event) {
              // Send audio back to Twilio
              const audioData = elevenLabsData.audio_event.audio_base_64;
              
              const twilioMessage = {
                event: 'media',
                streamSid: streamSid,
                media: {
                  payload: audioData
                }
              };
              
              ws.send(JSON.stringify(twilioMessage));
              console.log('🔊 Forwarded audio to Twilio');
            }
            
            if (elevenLabsData.type === 'agent_response') {
              console.log('💬 Agent response:', elevenLabsData.agent_response_event?.agent_response);
            }
            
            if (elevenLabsData.type === 'conversation_end') {
              console.log('🏁 Conversation ended by ElevenLabs');
              
              // Send hang up to Twilio
              ws.send(JSON.stringify({
                event: 'stop',
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
        }
        
        // Set up handlers for direct connection
        setupElevenLabsHandlers();
      }
      
      if (data.event === 'media') {
        // Forward audio from Twilio to ElevenLabs
        if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
          const audioMessage = {
            user_audio_chunk: data.media.payload
          };
          
          elevenLabsWs.send(JSON.stringify(audioMessage));
        }
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

// 🎯 POST-CALL WEBHOOK - ElevenLabs calls this after the conversation ends
app.post('/webhook/elevenlabs', async (req, res) => {
  console.log('📋 Post-call data from ElevenLabs:', JSON.stringify(req.body, null, 2));
  
  try {
    // Process and save to Airtable
    const intakeData = req.body;
    
    if (intakeData && Object.keys(intakeData).length > 0) {
      await saveToAirtable(intakeData);
      
      // Trigger n8n workflow if configured
      if (process.env.N8N_WEBHOOK_URL) {
        await triggerN8nWorkflow(intakeData);
      }
    }
    
    res.json({ status: 'success', message: 'Data processed successfully' });
    
  } catch (error) {
    console.error('❌ Error processing post-call data:', error);
    res.status(500).json({ status: 'error', message: error.message });
  }
});

// 🗄️ Save intake data to Airtable
async function saveToAirtable(data) {
  try {
    const airtableRecord = {
      fields: {
        'First Name': data['First Name'] || '',
        'Last Name': data['Last Name'] || '',
        'Phone': data['Phone'] || '',
        'Email': data['Email'] || '',
        'Case Type': data['Case Type'] || '',
        'Case Description': data['Case Description'] || '',
        'Date of Incident': data['Date of Incident'] || '',
        'Consent to Contact': data['Consent to Contact'] || '',
        'Lead Score': calculateLeadScore(data),
        'Status': 'New Lead',
        'Created': new Date().toISOString()
      }
    };

    const response = await fetch(`https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(airtableRecord)
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ Saved to Airtable:', result.id);
      return result;
    } else {
      const error = await response.text();
      console.error('❌ Airtable error:', error);
    }
    
  } catch (error) {
    console.error('❌ Error saving to Airtable:', error);
  }
}

// 📊 Calculate lead score
function calculateLeadScore(data) {
  let score = 50;
  
  if (data['Date of Incident']) {
    const incidentText = data['Date of Incident'].toLowerCase();
    if (incidentText.includes('today') || incidentText.includes('yesterday')) {
      score += 20;
    } else if (incidentText.includes('week')) {
      score += 10;
    }
  }
  
  if (data['Case Type']) {
    const caseType = data['Case Type'].toLowerCase();
    if (caseType.includes('vehicle') || caseType.includes('car')) {
      score += 15;
    } else if (caseType.includes('medical')) {
      score += 20;
    }
  }
  
  if (data['Email'] && data['Email'].includes('@')) {
    score += 10;
  }
  
  return Math.min(score, 100);
}

// 🔗 Trigger n8n workflow
async function triggerN8nWorkflow(data) {
  try {
    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event: 'new_lead',
        data: data,
        timestamp: new Date().toISOString()
      })
    });

    if (response.ok) {
      console.log('✅ n8n workflow triggered successfully');
    } else {
      console.error('❌ n8n workflow trigger failed:', response.statusText);
    }
    
  } catch (error) {
    console.error('❌ Error triggering n8n workflow:', error);
  }
}

// Start server
server.listen(PORT, () => {
  console.log(`🚀 AI Intake Server running on port ${PORT}`);
  console.log(`📞 Twilio webhook: https://your-app.onrender.com/voice`);
  console.log(`📋 ElevenLabs webhook: https://your-app.onrender.com/webhook/elevenlabs`);
});