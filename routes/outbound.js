import express from 'express';
import twilio from 'twilio';

const router = express.Router();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Endpoint that n8n will call when new Airtable record appears
router.post('/trigger', async (req, res) => {
  try {
    const { 
      phoneNumber, 
      firstName, 
      caseType,           // "Case Type" from Airtable
      caseDescription,    // "Case Description" - what happened
      whenIncidentOccured, // "When Incident Occured"
      consentToContact    // "Consent to Contact" - should be "true"
    } = req.body;
    
    // Check consent before calling
    if (consentToContact !== 'true') {
      return res.status(400).json({ 
        success: false, 
        error: 'No consent to contact' 
      });
    }
    
    console.log('🚀 Triggering outbound call to:', phoneNumber);
    
    // Create URL with parameters for context
    const params = new URLSearchParams({
      firstName: firstName || '',
      caseType: caseType || '',
      incidentDate: whenIncidentOccured || ''
    }).toString();
    
    // Initiate outbound call
    const call = await twilioClient.calls.create({
      to: phoneNumber,
      from: process.env.TWILIO_OUTBOUND_PHONE_NUMBER,
      url: `https://${req.get('host')}/outbound/voice?${params}`,
      statusCallback: `https://${req.get('host')}/outbound/status`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      machineDetection: 'DetectMessageEnd', // For voicemail handling
      asyncAmd: true
    });
    
    res.json({ 
      success: true, 
      callSid: call.sid,
      message: `Call initiated to ${phoneNumber}`
    });
    
  } catch (error) {
    console.error('❌ Error triggering outbound call:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// TwiML endpoint for outbound calls
router.post('/voice', (req, res) => {
  const { firstName, caseType, incidentDate } = req.query;
  
  console.log('📞 Outbound call connected for:', firstName || 'Unknown');
  console.log('📋 Case type:', caseType);
  console.log('📅 Incident date:', incidentDate);
  
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Connect>
    <Stream url="wss://${req.get('host')}/media-outbound">
      <Parameter name="firstName" value="${firstName || ''}" />
      <Parameter name="caseType" value="${caseType || ''}" />
      <Parameter name="incidentDate" value="${incidentDate || ''}" />
      <Parameter name="callType" value="outbound" />
    </Stream>
  </Connect>
</Response>`;
  
  res.type('text/xml');
  res.send(twiml);
});

// Status callback endpoint
router.post('/status', (req, res) => {
  const { CallSid, CallStatus, AnsweredBy } = req.body;
  
  console.log(`📊 Call ${CallSid} status: ${CallStatus}`);
  
  if (AnsweredBy) {
    console.log(`🤖 Answered by: ${AnsweredBy}`);
    // You can handle voicemail detection here
    // AnsweredBy can be: human, machine_start, machine_end_beep, machine_end_silence, machine_end_other
  }
  
  res.sendStatus(200);
});

export default router;