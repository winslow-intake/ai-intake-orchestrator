import WebSocket from 'ws';
import fetch from 'node-fetch';
import { hangupCall } from '../utils/call-helpers.js';
import { storeCallContext } from './custom-llm-handler.js';

export function handleOutboundWebSocketConnection(ws) {
  console.log('🔌 Outbound WebSocket connection established');
  
  let elevenLabsWs = null;
  let streamSid = null;
  let callSid = null;
  let callContext = {};
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === 'start') {
        streamSid = data.start.streamSid;
        callSid = data.start.callSid;
        
        // Extract custom parameters from Twilio
        const customParams = data.start.customParameters || {};
        callContext = {
          firstName: customParams.firstName,
          caseType: customParams.caseType,
          incidentDate: customParams.incidentDate,
          callType: 'outbound'
        };
        
        console.log(`🎬 Outbound stream started: ${streamSid}, Call SID: ${callSid}`);
        console.log('📋 Call context:', callContext);
        
        // Store context for Custom LLM endpoint
        storeCallContext(callSid, callContext);
        
        // Connect to ElevenLabs
        const agentId = process.env.ELEVENLABS_OUTBOUND_AGENT_ID;
        const apiKey = process.env.ELEVENLABS_API_KEY;
        
        if (!agentId || !apiKey) {
          console.error('❌ Missing ELEVENLABS_OUTBOUND_AGENT_ID or ELEVENLABS_API_KEY');
          await hangupCall(callSid);
          return;
        }
        
        try {
          console.log('🔑 Getting signed URL for outbound agent...');
          const signedUrlResponse = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, {
            headers: {
              'xi-api-key': apiKey
            }
          });
          
          if (!signedUrlResponse.ok) {
            console.error('❌ Failed to get signed URL:', signedUrlResponse.statusText);
            await hangupCall(callSid);
            return;
          }
          
          const signedUrlData = await signedUrlResponse.json();
          console.log('✅ Got signed URL for outbound agent');
          
          elevenLabsWs = new WebSocket(signedUrlData.signed_url);
          
          elevenLabsWs.on('open', () => {
            console.log('✅ Connected to ElevenLabs Outbound Agent');
            
            // Send initial context (optional, if ElevenLabs supports it)
            const contextMessage = {
              type: 'conversation_context',
              context: callContext
            };
            elevenLabsWs.send(JSON.stringify(contextMessage));
          });
          
          elevenLabsWs.on('message', (elevenLabsMessage) => {
            try {
              const elevenLabsData = JSON.parse(elevenLabsMessage);
              
              if (elevenLabsData.type === 'audio' && elevenLabsData.audio_event) {
                // Forward audio from ElevenLabs to Twilio
                const audioData = elevenLabsData.audio_event.audio_base_64;
                
                const twilioMessage = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                    payload: audioData
                  }
                };
                
                ws.send(JSON.stringify(twilioMessage));
              }
              
              if (elevenLabsData.type === 'agent_response') {
                console.log('💬 Outbound agent said:', elevenLabsData.agent_response_event?.agent_response);
              }
              
              if (elevenLabsData.type === 'conversation_end') {
                console.log('🏁 Outbound conversation ended');
                ws.send(JSON.stringify({
                  event: 'stop',
                  streamSid: streamSid
                }));
                hangupCall(callSid);
              }
              
            } catch (error) {
              console.error('❌ Error processing ElevenLabs message:', error);
            }
          });
          
          elevenLabsWs.on('close', () => {
            console.log('🔌 ElevenLabs outbound connection closed');
            hangupCall(callSid);
          });
          
          elevenLabsWs.on('error', (error) => {
            console.error('❌ ElevenLabs outbound WebSocket error:', error);
            hangupCall(callSid);
          });
          
        } catch (error) {
          console.error('❌ Error setting up ElevenLabs outbound connection:', error);
          await hangupCall(callSid);
        }
      }
      
      if (data.event === 'media' && elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
        // Forward audio from Twilio to ElevenLabs
        const audioMessage = {
          user_audio_chunk: data.media.payload
        };
        
        elevenLabsWs.send(JSON.stringify(audioMessage));
      }
      
      if (data.event === 'stop') {
        console.log('🛑 Outbound stream stopped');
        if (elevenLabsWs) {
          elevenLabsWs.close();
        }
      }
      
    } catch (error) {
      console.error('❌ Error processing outbound WebSocket message:', error);
      await hangupCall(callSid);
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Twilio outbound WebSocket closed');
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });
  
  ws.on('error', (error) => {
    console.log('❌ Twilio outbound WebSocket error:', error);
    if (elevenLabsWs) {
      elevenLabsWs.close();
    }
  });
}