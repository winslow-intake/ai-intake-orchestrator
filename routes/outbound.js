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
      whenIncidentOccurred, // "When Incident Occurred"
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
    console.log('📋 Context:', { firstName, caseType, whenIncidentOccurred });
    
    // Call ElevenLabs Outbound API directly
    const elevenLabsResponse = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_OUTBOUND_AGENT_ID,
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID, // Required - get from ElevenLabs dashboard
        to_number: phoneNumber, // Changed from 'to' to 'to_number'
        from_number: process.env.TWILIO_OUTBOUND_PHONE_NUMBER, // Changed from 'from' to 'from_number'
        
        // Enable Twilio's answering machine detection
        amd: true,
        amd_behavior_on_machine: "hangup", // Hang up immediately on voicemail detection
        
        // Pass custom variables through conversation_initiation_client_data
        conversation_initiation_client_data: {
          type: "conversation_initiation_client_data",
          dynamic_variables: {
            user_name: firstName || "valued client",
            case_type: caseType || "personal injury case",
            incident_date: whenIncidentOccurred || "recently",
            case_description: caseDescription || ""
          }
          // Removed conversation_config_override - use agent's default Marcus persona
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