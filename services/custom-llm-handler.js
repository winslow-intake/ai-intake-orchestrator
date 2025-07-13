import express from 'express';

const router = express.Router();

// Store active call contexts
const callContexts = new Map();

// Helper to store context for a call
export function storeCallContext(callSid, context) {
  callContexts.set(callSid, {
    ...context,
    timestamp: new Date()
  });
  
  // Clean up old contexts after 30 minutes
  setTimeout(() => {
    callContexts.delete(callSid);
  }, 30 * 60 * 1000);
}

// Test endpoint to manually store context
router.post('/custom-llm/:callSid/context', (req, res) => {
  const { callSid } = req.params;
  const context = req.body;
  
  storeCallContext(callSid, context);
  
  res.json({
    success: true,
    message: `Context stored for call ${callSid}`,
    context
  });
});

// Custom LLM endpoint that ElevenLabs will call
router.post('/custom-llm/:callSid', (req, res) => {
  const { callSid } = req.params;
  const { prompt, conversation_history } = req.body;
  
  console.log('🤖 Custom LLM request for call:', callSid);
  console.log('📝 Prompt from ElevenLabs:', prompt);
  
  // Get the context for this specific call
  const context = callContexts.get(callSid);
  
  if (!context) {
    console.log('⚠️ No context found for call:', callSid);
    return res.json({
      response: "I'm calling from Winslow Law Firm. How can I help you today?"
    });
  }
  
  // Build personalized response based on context
  let systemPrompt = `You are a compassionate legal intake specialist from Winslow Law Firm. 
  You are calling ${context.firstName || 'a potential client'} who recently submitted a form about a ${context.caseType || 'legal matter'}.`;
  
  if (context.incidentDate) {
    systemPrompt += ` The incident occurred on ${context.incidentDate}.`;
  }
  
  // Initial greeting
  if (!conversation_history || conversation_history.length === 0) {
    return res.json({
      response: `Hello, is this ${context.firstName}? This is Sarah from Winslow Law Firm. 
      I'm calling about the ${context.caseType} case you submitted. 
      I wanted to follow up and see if you had a few minutes to discuss what happened${context.incidentDate ? ' on ' + context.incidentDate : ''}.`
    });
  }
  
  // For ongoing conversation, provide context-aware guidance
  return res.json({
    system_prompt: systemPrompt,
    response: prompt // Let ElevenLabs handle the actual response generation with context
  });
});

export default router;