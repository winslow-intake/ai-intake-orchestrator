import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import WebSocket from 'ws';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👇 Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'AI Intake Orchestrator Running',
    timestamp: new Date().toISOString()
  });
});

// 👇 Twilio webhook - returns TwiML to start WebSocket connection
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from Twilio:', req.body?.From);
  
  const twiml = `
    <Response>
      <Connect>
        <Stream url="wss://${req.get('host')}/media" />
      </Connect>
    </Response>
  `;
  
  res.type('text/xml');
  res.send(twiml);
});

// 👇 ElevenLabs post-call webhook - saves data to Airtable
app.post('/webhook/elevenlabs', async (req, res) => {
  console.log('🎯 Received webhook from ElevenLabs:', req.body);

  try {
    const { conversation_id, status, transcript, analysis } = req.body;

    if (status === 'completed' && analysis) {
      const intakeData = typeof analysis === 'string' ? JSON.parse(analysis) : analysis;
      console.log('📋 Extracted intake data:', intakeData);

      await processIntakeData({
        conversation_id,
        transcript,
        ...intakeData
      });

      res.json({ success: true, message: 'Data processed successfully' });
    } else {
      console.log('⏳ Call not yet completed or no analysis data');
      res.json({ success: true, message: 'Acknowledged' });
    }

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 👇 WebSocket connection for Twilio media streams
wss.on('connection', (ws, req) => {
  console.log('🔗 WebSocket connected from Twilio');
  
  let elevenLabsWs = null;
  let callSid = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.event) {
        case 'connected':
          console.log('📞 Twilio stream connected');
          break;
          
        case 'start':
          console.log('🎬 Stream started for call:', data.start.callSid);
          callSid = data.start.callSid;
          
          // Connect to ElevenLabs Conversational AI
          await connectToElevenLabs(ws, data.start);
          break;
          
        case 'media':
          // Forward audio to ElevenLabs
          if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
            const audioMessage = {
              type: 'audio',
              audio_event: {
                audio_base_64: data.media.payload,
                sample_rate: 8000,
                encoding: 'mulaw'
              }
            };
            elevenLabsWs.send(JSON.stringify(audioMessage));
          }
          break;
          
        case 'stop':
          console.log('🛑 Stream stopped');
          if (elevenLabsWs) {
            elevenLabsWs.close();
          }
          break;
      }
    } catch (error) {
      console.error('❌ Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Twilio WebSocket disconnected');
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });

  // Store ElevenLabs connection reference
  ws.setElevenLabsConnection = (connection) => {
    elevenLabsWs = connection;
  };
});

// 👇 Connect to ElevenLabs Conversational AI
async function connectToElevenLabs(twilioWs, startData) {
  try {
    console.log('🚀 Connecting to ElevenLabs...');
    
    const agentId = process.env.ELEVENLABS_AGENT_ID || 'agent_01jzrf596af7vr8vkavc0bgaz2';
    const apiKey = process.env.ELEVENLABS_API_KEY;
    
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY is required');
    }

    const elevenLabsWsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`;
    
    const elevenLabsWs = new WebSocket(elevenLabsWsUrl, {
      headers: {
        'xi-api-key': apiKey,
      }
    });

    elevenLabsWs.on('open', () => {
      console.log('✅ Connected to ElevenLabs');
      
      // Send conversation config
      const config = {
        type: 'conversation_initiation_metadata',
        conversation_initiation_metadata: {
          conversation_id: `twilio_${startData.callSid}`,
          user_id: startData.callSid,
        }
      };
      
      elevenLabsWs.send(JSON.stringify(config));
    });

    elevenLabsWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        switch (message.type) {
          case 'audio':
            // Send audio back to Twilio
            const audioMessage = {
              event: 'media',
              streamSid: startData.streamSid,
              media: {
                payload: message.audio_event.audio_base_64
              }
            };
            twilioWs.send(JSON.stringify(audioMessage));
            break;
            
          case 'interruption':
            console.log('⏸️ User interrupted');
            break;
            
          case 'ping':
            elevenLabsWs.send(JSON.stringify({ type: 'pong' }));
            break;
            
          case 'conversation_ended':
            console.log('🏁 Conversation ended');
            break;
        }
      } catch (error) {
        console.error('❌ Error processing ElevenLabs message:', error);
      }
    });

    elevenLabsWs.on('error', (error) => {
      console.error('❌ ElevenLabs WebSocket error:', error);
    });

    elevenLabsWs.on('close', () => {
      console.log('🔌 ElevenLabs connection closed');
    });

    // Store the connection
    twilioWs.setElevenLabsConnection(elevenLabsWs);

  } catch (error) {
    console.error('❌ Failed to connect to ElevenLabs:', error);
  }
}

// 👇 Process intake data and save to Airtable
async function processIntakeData(data) {
  try {
    console.log('💾 Processing intake data for Airtable...');

    const airtableRecord = {
      fields: {
        'First Name': data['First Name'] || '',
        'Last Name': data['Last Name'] || '',
        'Phone': data['Phone'] || '',
        'Email': data['Email'] || '',
        'Source': 'Phone Call - AI Intake',
        'Lead Status': 'New Lead',
        'Case Type': data['Case Type'] || 'Other Personal Injury',
        'Case Description': data['Case Description'] || '',
        'Date of Incident': data['Date of Incident'] || '',
        'Consent to Contact': data['Consent to Contact'] || 'No',
        'Lead Score': calculateLeadScore(data),
        'Created Date': new Date().toISOString()
      }
    };

    await saveToAirtable(airtableRecord);

    if (process.env.N8N_WEBHOOK_URL) {
      await triggerN8nWorkflow(airtableRecord);
    }

  } catch (error) {
    console.error('❌ Error in processIntakeData:', error);
    throw error;
  }
}

function calculateLeadScore(data) {
  let score = 50;
  
  // Higher score for recent incidents
  if (data['Date of Incident']) {
    const incidentText = data['Date of Incident'].toLowerCase();
    if (incidentText.includes('today') || incidentText.includes('yesterday')) score += 20;
    if (incidentText.includes('this week') || incidentText.includes('last week')) score += 15;
  }
  
  // Higher score for serious cases
  if (data['Case Description']) {
    const description = data['Case Description'].toLowerCase();
    if (description.includes('hospital') || description.includes('emergency')) score += 30;
    if (description.includes('surgery') || description.includes('fracture')) score += 25;
    if (description.includes('pain') || description.includes('injury')) score += 10;
  }
  
  // Consent bonus
  if (data['Consent to Contact'] === 'Yes') score += 10;
  
  // Contact completeness bonus
  if (data['Phone'] && data['Email']) score += 15;
  
  return Math.min(score, 100);
}

async function saveToAirtable(record) {
  try {
    const config = {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Leads`;
    const response = await fetch(url, {
      method: 'POST',
      headers: config.headers,
      body: JSON.stringify(record)
    });

    const result = await response.json();
    console.log('📥 Saved to Airtable:', result.id);
  } catch (error) {
    console.error('❌ Failed to save to Airtable:', error);
  }
}

async function triggerN8nWorkflow(recordData) {
  try {
    const response = await fetch(process.env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'ai-intake-phone',
        data: recordData
      })
    });
    console.log('✅ Triggered n8n workflow');
  } catch (error) {
    console.error('❌ Failed to trigger n8n:', error);
  }
}

server.listen(PORT, () => {
  console.log(`🚀 AI Intake Orchestrator running on port ${PORT}`);
  console.log(`📞 Configure Twilio webhook: https://your-domain.com/voice`);
});