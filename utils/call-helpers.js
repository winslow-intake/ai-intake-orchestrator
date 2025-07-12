 import { twilioClient } from '../services/twilio-client.js';
 
 // Function to hang up the call
  const hangupCall = async () => {
    if (callSid) {
      try {
        console.log(`📞 Hanging up call: ${callSid}`);
        await twilioClient.calls(callSid).update({ status: 'completed' });
        console.log('✅ Call hung up successfully');
      } catch (error) {
        console.error('❌ Error hanging up call:', error);
      }
    }
  };