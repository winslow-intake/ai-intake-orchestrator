const express = require('express');
const axios = require('axios');
const router = express.Router();

router.post('/', async (req, res) => {
  console.log('📞 Inbound call received:', req.body);
  
  try {
    // Start conversation with ElevenLabs agent
    const conversationResponse = await axios.post(
      'https://api.elevenlabs.io/v1/convai/conversations',
      {
        agent_id: 'agent_01jzrf596af7vr8kvavc0bgaz2'
      },
      {
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );

    const conversationId = conversationResponse.data.conversation_id;
    console.log('✅ Started ElevenLabs conversation:', conversationId);

    // Store conversation ID for webhook tracking
    // We'll use this to match webhook data back to this call
    const callSid = req.body.CallSid;
    
    // Return TwiML that streams audio to ElevenLabs
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://api.elevenlabs.io/v1/convai/conversations/${conversationId}/ws?xi-api-key=${process.env.ELEVENLABS_API_KEY}" />
        </Connect>
      </Response>
    `;

    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    console.error('❌ Error starting ElevenLabs conversation:', error);
    
    // Fallback TwiML
    const fallbackTwiml = `
      <Response>
        <Say voice="alice">I'm sorry, but our AI assistant is temporarily unavailable. Please call back in a few minutes.</Say>
        <Hangup />
      </Response>
    `;
    
    res.type('text/xml');
    res.send(fallbackTwiml);
  }
});

module.exports = router;