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

// 👇 ElevenLabs conversation initiation webhook
app.post('/voice', (req, res) => {
  console.log('🔗 ElevenLabs conversation initiation:', JSON.stringify(req.body, null, 2));
  console.log('🔗 Headers:', JSON.stringify(req.headers, null, 2));
  
  try {
    // Return conversation initiation data
    const response = {
      conversation_initiation_client_data: {
        dynamic_variables: {},
        overrides: {}
      }
    };
    
    console.log('📤 Sending response:', JSON.stringify(response, null, 2));
    res.status(200).json(response);
    
  } catch (error) {
    console.error('❌ Error in /voice endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
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

// 👇 WebSocket connection for media streaming (legacy - not used with native ElevenLabs integration)
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

// 👇 Forward audio to ElevenLabs (legacy - not used with native integration)
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
  console.log(`📞 Webhook URL: http://localhost:${PORT}/voice`);
  console.log(`🌐 WebSocket URL: ws://localhost:${PORT}/media`);
});