import express from 'express';
import fetch from 'node-fetch';
const router = express.Router();

router.post('/trigger', async (req, res) => {
  try {
    const { 
      phoneNumber, 
      firstName, 
      caseType,             
      caseDescription,      
      whenIncidentOccurred, 
      consentToContact,     
      lead_score,           
      record_id,            
      appointment_status,   
      scheduled_time,       
      meeting_link,         
      ngrokUrl              
    } = req.body;

    if (consentToContact !== 'true') {
      return res.status(400).json({ 
        success: false, 
        error: 'No consent to contact' 
      });
    }

    console.log('🚀 Triggering outbound call to:', phoneNumber);
    console.log('📋 Context:', { firstName, caseType, whenIncidentOccurred, lead_score, record_id, appointment_status, scheduled_time, meeting_link });

    const elevenLabsResponse = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_OUTBOUND_AGENT_ID,
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
        to_number: phoneNumber,
        from_number: process.env.TWILIO_OUTBOUND_PHONE_NUMBER,
        amd: true,
        amd_behavior_on_machine: "hangup",
        conversation_initiation_client_data: {
          type: "conversation_initiation_client_data",
          dynamic_variables: {
            user_name: firstName || "valued client",
            case_type: caseType || "personal injury case",
            incident_date: whenIncidentOccurred || "recently",
            case_description: caseDescription || "",
            lead_score: typeof lead_score !== 'undefined' ? lead_score : 0,
            record_id: record_id || "",
            appointment_status: appointment_status || "",
            scheduled_time: scheduled_time || "",
            meeting_link: meeting_link || ""
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

module.exports = router;
