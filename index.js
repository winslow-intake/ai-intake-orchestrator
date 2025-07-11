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
app.use(express.json({ limit: '10mb' })); // Increase limit for ElevenLabs webhooks
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

// 🎯 WEBSOCKET CONNECTION - Simplified approach based on ElevenLabs docs
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
        // Twilio sends μ-law encoded audio - ElevenLabs should handle this if agent is configured correctly
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

// 🎯 POST-CALL WEBHOOK - ElevenLabs calls this after the conversation ends
app.post('/webhook/elevenlabs', async (req, res) => {
  console.log('📋 Post-call webhook received');
  
  try {
    // Extract only the data collection results (the important stuff)
    const postCallData = req.body;
    const dataCollection = postCallData?.data?.analysis?.data_collection_results || {};
    
    // Convert to our Airtable format
    const intakeData = {
      'First Name': dataCollection['First Name']?.value || '',
      'Last Name': dataCollection['Last Name']?.value || '',
      'Phone': dataCollection['Phone']?.value || '',
      'Email': dataCollection['Email']?.value || '',
      'Case Type': dataCollection['Case Type']?.value || '',
      'Case Description': dataCollection['Case Description']?.value || '',
      'Date of Incident': dataCollection['Date of Incident']?.value || '',
      'Consent to Contact': dataCollection['Consent to Contact']?.value || '',
      'Conversation ID': postCallData?.data?.conversation_id || '',
      'Call Duration': postCallData?.data?.metadata?.call_duration_secs || 0,
      'Transcript Summary': postCallData?.data?.analysis?.transcript_summary || ''
    };
    
    console.log('📊 Extracted intake data:', intakeData);
    
    // Only save if we got some actual data
    if (Object.values(intakeData).some(value => value && value !== '')) {
      await saveToAirtable(intakeData);
      
      // Trigger n8n workflow with clean data
      if (process.env.N8N_WEBHOOK_URL) {
        await triggerN8nWorkflow(intakeData);
      }
    } else {
      console.log('⚠️ No meaningful data collected, skipping save');
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
  console.log('⚠️  IMPORTANT: Configure Marcus agent audio format to μ-law 8000 Hz!');
});