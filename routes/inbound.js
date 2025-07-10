const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  console.log('📞 Inbound call received:', req.body);
  
  try {
    // Return TwiML that streams directly to ElevenLabs agent WebSocket
    const twiml = `
      <Response>
        <Connect>
          <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_01jzrf596af7vr8kvavc0bgaz2&xi_api_key=${process.env.ELEVENLABS_API_KEY}" />
        </Connect>
      </Response>
    `;

    res.type('text/xml');
    res.send(twiml);

  } catch (error) {
    console.error('❌ Error starting call:', error);
    
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