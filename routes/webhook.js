import express from 'express';
import axios from 'axios';
const router = express.Router();

// 🔥 Main ElevenLabs Webhook Handler
router.post('/elevenlabs', async (req, res) => {
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

// 🔄 Process + Send to Airtable + Trigger n8n
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

// ✅ Airtable Save
async function saveToAirtable(record) {
  try {
    const config = {
      headers: {
        Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      }
    };

    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/Leads`;

    const res = await axios.post(url, record, config);
    console.log('📥 Saved to Airtable:', res.data.id);
  } catch (error) {
    console.error('❌ Failed to save to Airtable:', error.response?.data || error.message);
  }
}

// 🛠️ Helpers
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

async function triggerN8nWorkflow(recordData) {
  try {
    await axios.post(process.env.N8N_WEBHOOK_URL, {
      source: 'ai-intake-phone',
      data: recordData
    });
    console.log('✅ Triggered n8n workflow');
  } catch (error) {
    console.error('❌ Failed to trigger n8n:', error.response?.data || error.message);
  }
}

export default router;