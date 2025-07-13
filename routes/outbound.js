import express from 'express';
import fetch from 'node-fetch';

const router = express.Router();

// Endpoint that n8n will call when new Airtable record appears
router.post('/trigger', async (req, res) => {
  try {
    const { 
      phoneNumber, 
      firstName, 
      caseType,           // "Case Type" from Airtable
      caseDescription,    // "Case Description" - what happened
      whenIncidentOccured, // "When Incident Occured"
      consentToContact,    // "Consent to Contact" - should be "true"
      ngrokUrl            // For local testing only
    } = req.body;
    
    // Check consent before calling
    if (consentToContact !== 'true') {
      return res.status(400).json({ 
        success: false, 
        error: 'No consent to contact' 
      });
    }
    
    console.log('🚀 Triggering outbound call to:', phoneNumber);
    console.log('📋 Context:', { firstName, caseType, whenIncidentOccured });
    
    // Call ElevenLabs Outbound API directly
    const elevenLabsResponse = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_OUTBOUND_AGENT_ID,
        to: phoneNumber,
        from: process.env.TWILIO_OUTBOUND_PHONE_NUMBER,
        
        // Pass custom variables through conversation_initiation_client_data
        conversation_initiation_client_data: {
          type: "conversation_initiation_client_data",
          dynamic_variables: {
            user_name: firstName || "valued client",
            case_type: caseType || "personal injury case",
            incident_date: whenIncidentOccured || "recently",
            case_description: caseDescription || ""
          },
          conversation_config_override: {
            agent: {
              prompt: {
                prompt: `You are a compassionate legal intake specialist from Winslow Law Firm calling {{user_name}} about their {{case_type}} that occurred on {{incident_date}}. Be warm, professional, and gather important details about their case.`
              },
              first_message: `Hello, is this {{user_name}}? This is Sarah from Winslow Law Firm. I'm calling about the {{case_type}} you submitted regarding an incident on {{incident_date}}. Do you have a few minutes to discuss what happened?`
            }
          }
        }
      })
    });
    
    if (!elevenLabsResponse.ok) {
      const errorText = await elevenLabsResponse.text();
      console.error('❌ ElevenLabs API error:', elevenLabsResponse.status, errorText);
      throw new Error(`ElevenLabs API error: ${elevenLabsResponse.status} ${errorText}`);
    }
    
    const result = await elevenLabsResponse.json();
    console.log('✅ Call initiated successfully:', result);
    
    res.json({ 
      success: true, 
      callId: result.call_id,
      message: `Call initiated to ${phoneNumber}`,
      details: result
    });
    
  } catch (error) {
    console.error('❌ Error triggering outbound call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Status webhook endpoint (ElevenLabs will call this)
router.post('/status', (req, res) => {
  console.log('📊 Call status update from ElevenLabs:', req.body);
  res.sendStatus(200);
});

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Outbound service ready',
    timestamp: new Date().toISOString()
  });
});

export default router;