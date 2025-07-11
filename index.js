import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';

const app = express();
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

// 👇 ElevenLabs conversation initiation webhook (if needed)
app.post('/voice', (req, res) => {
  console.log('🔗 ElevenLabs conversation initiation');
  res.json({
    conversation_initiation_client_data: {
      dynamic_variables: {},
      overrides: {}
    }
  });
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

app.listen(PORT, () => {
  console.log(`🚀 AI Intake Orchestrator running on port ${PORT}`);
});