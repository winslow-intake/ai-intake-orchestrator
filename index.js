import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import fetch from 'node-fetch';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 👇 Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'AI Intake Orchestrator Running',
    timestamp: new Date().toISOString(),
    websocket_url: `wss://${req.get('host')}/media`
  });
});

// 👇 Twilio webhook - this is what Twilio calls when someone dials your number
app.post('/voice', (req, res) => {
  console.log('📞 Incoming call from Twilio:', req.body);
  
  // Get the host from the request to build the correct WebSocket URL
  const host = req.get('host');
  const wsUrl = `wss://${host}/media`;
  
  const twiml = `
    <Response>
      <Say>Please hold while we connect you to our AI assistant.</Say>
      <Connect>
        <Stream url="${wsUrl}" />
      </Connect>
    </Response>
  `;
  
  res.type('text/xml');
  res.send(twiml);
});

// 👇 Twilio status callbacks
app.post('/status', (req, res) => {
  console.log('📡 Twilio call status:', req.body);
  res.sendStatus(200);
});

// 👇 ElevenLabs webhook handler
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

// 👇 WebSocket connection for media streaming
wss.on('connection', (ws, req) => {
  console.log('🔗 WebSocket connected from:', req.socket.remoteAddress);

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📦 Received message type:', data.event);

      // Handle different Twilio stream events
      switch (data.event) {
        case 'connected':
          console.log('📞 Stream connected:', data);
          break;
        case 'start':
          console.log('🎬 Stream started:', data.start);
          // Here you would typically initialize your ElevenLabs connection
          break;
        case 'media':
          console.log('🎵 Media chunk received, payload size:', data.media.payload.length);
          // Forward audio to ElevenLabs for processing
          await forwardToElevenLabs(data.media);
          break;
        case 'stop':
          console.log('🛑 Stream stopped');
          break;
      }
    } catch (error) {
      console.error('❌ Error processing WebSocket message:', error);
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket disconnected');
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

// 👇 Forward audio to ElevenLabs
async function forwardToElevenLabs(mediaData) {
  try {
    // This is where you'd implement the ElevenLabs Conversational AI integration
    // For now, just log that we received audio
    console.log('🎯 Would forward to ElevenLabs:', {
      timestamp: mediaData.timestamp,
      sequenceNumber: mediaData.sequenceNumber
    });

    // Example of what you'd do:
    // 1. Convert Twilio's audio format to what ElevenLabs expects
    // 2. Send to ElevenLabs WebSocket
    // 3. Receive response from ElevenLabs
    // 4. Convert back to Twilio format
    // 5. Send back to Twilio via WebSocket

  } catch (error) {
    console.error('❌ Error forwarding to ElevenLabs:', error);
  }
}

// 👇 Process intake data and save to Airtable
async function processIntakeData(data) {
  try {
    console.log('💾 Processing intake data for Airtable...');

    const airtableRecord = {
      fields: {
        'First Name': extractFirstName(data.name),
        'Last Name': extractLastName(data.name),
        'Phone': data.phone,
        'Source': 'Phone Call - AI Intake',
        'Lead Status': 'New Lead',
        'Case Type': mapCaseType(data.accident_type),
        'Case Description': data.extra_notes || data.accident_type,
        'Date of Incident': data.accident_date,
        'Consent to Contact': data.consent_given === 'yes',
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

// 👇 Helper functions
function extractFirstName(fullName) {
  if (!fullName) return '';
  return fullName.split(' ')[0] || '';
}

function extractLastName(fullName) {
  if (!fullName) return '';
  const parts = fullName.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function mapCaseType(accidentType) {
  if (!accidentType) return 'Other';
  const type = accidentType.toLowerCase();
  if (type.includes('car') || type.includes('vehicle')) return 'Vehicle or Pedestrian Accident';
  if (type.includes('slip') || type.includes('fall')) return 'Slip/Fall in Public Place';
  if (type.includes('work') || type.includes('job')) return 'Workers Compensation';
  return 'Other Personal Injury';
}

function calculateLeadScore(data) {
  let score = 50;
  if (data.urgency_flag?.includes('hospital')) score += 30;
  if (data.consent_given === 'yes') score += 10;
  if (data.phone?.length > 5) score += 10;
  if (data.extra_notes?.length > 20) score += 10;
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
  console.log(`📞 Webhook URL: http://localhost:${PORT}/voice`);
  console.log(`🌐 WebSocket URL: ws://localhost:${PORT}/media`);
});