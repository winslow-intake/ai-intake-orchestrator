import express from 'express';
import axios from 'axios';
const router = express.Router();

// 🔥 Main ElevenLabs Webhook Handler
router.post('/elevenlabs', async (req, res) => {
  console.log('🎯 Received webhook from ElevenLabs:', req.body);

  try {
    // Extract data from ElevenLabs webhook structure
    const webhookData = req.body.data;
    
    if (webhookData && webhookData.status === 'done' && webhookData.analysis) {
      const analysisData = webhookData.analysis.data_collection_results;
      
      console.log('📋 Extracted analysis data:', analysisData);

      await processIntakeData({
        conversation_id: webhookData.conversation_id,
        transcript: webhookData.transcript,
        analysis: analysisData,
        transcript_summary: webhookData.analysis.transcript_summary
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

    // Extract values from ElevenLabs data collection results
    const analysisData = data.analysis || {};
    
    const airtableRecord = {
      fields: {
        'First Name': analysisData['First Name']?.value || '',
        'Last Name': analysisData['Last Name']?.value || '',
        'Phone': analysisData['Phone']?.value || '',
        'Email': analysisData['Email']?.value || '',
        'Case Type': analysisData['Case Type']?.value || '',
        'Case Description': analysisData['Case Description']?.value || '',
        'Date of Incident': analysisData['Date of Incident']?.value || '',
        'Consent to Contact': analysisData['Consent to Contact']?.value === 'yes',
        'Conversation ID': data.conversation_id || '',
        'Transcript Summary': data.transcript_summary || '',
        'Source': 'Phone Call - AI Intake',
        'Lead Status': 'New Lead',
        'Lead Score': calculateLeadScore(analysisData),
        'Created Date': new Date().toISOString()
      }
    };

    console.log('📊 Final Airtable record:', airtableRecord);

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
    console.log('✅ Saved to Airtable:', res.data.id);
  } catch (error) {
    console.error('❌ Failed to save to Airtable:', error.response?.data || error.message);
  }
}

// 📊 Calculate lead score based on ElevenLabs data
function calculateLeadScore(data) {
  let score = 50;
  
  // Check if incident was recent
  const incidentDate = data['Date of Incident']?.value;
  if (incidentDate) {
    const dateText = incidentDate.toLowerCase();
    if (dateText.includes('today') || dateText.includes('yesterday')) {
      score += 20;
    } else if (dateText.includes('week')) {
      score += 10;
    }
  }
  
  // Check case type importance
  const caseType = data['Case Type']?.value;
  if (caseType) {
    const type = caseType.toLowerCase();
    if (type.includes('vehicle') || type.includes('car')) {
      score += 15;
    } else if (type.includes('medical')) {
      score += 20;
    }
  }
  
  // Check if we have email
  const email = data['Email']?.value;
  if (email && email.includes('@')) {
    score += 10;
  }
  
  // Check if consent given
  if (data['Consent to Contact']?.value === 'yes') {
    score += 15;
  }
  
  return Math.min(score, 100);
}

async function triggerN8nWorkflow(recordData) {
  try {
    await axios.post(process.env.N8N_WEBHOOK_URL, {
      source: 'ai-intake-phone',
      data: recordData,
      timestamp: new Date().toISOString()
    });
    console.log('✅ Triggered n8n workflow');
  } catch (error) {
    console.error('❌ Failed to trigger n8n:', error.response?.data || error.message);
  }
}

export default router;