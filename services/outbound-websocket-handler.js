import WebSocket from 'ws';
import fetch from 'node-fetch';
import { hangupCall } from '../utils/call-helpers.js';
import { storeCallContext } from './conversation-init-webhook.js';

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
          user_name: customParams.user_name,
          case_type: customParams.case_type,
          incident_date: customParams.incident_date,
          callType: 'outbound'
        };
        
        console.log(`🎬 Outbound stream started: ${streamSid}, Call SID: ${callSid}`);
        console.log('📋 Call context:', callContext);
        
        // Store context for the webhook - CRITICAL: Use the call SID as the key
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
          
          // IMPORTANT: Include the call_id in the signed URL request
          // This tells ElevenLabs which context to fetch from your webhook
          const signedUrlResponse = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`, 
            {
              method: 'GET',
              headers: {
                'xi-api-key': apiKey
              }
            }
          );
          
          if (!signedUrlResponse.ok) {
            const errorText = await signedUrlResponse.text();
            console.error('❌ Failed to get signed URL:', signedUrlResponse.status, errorText);
            await hangupCall(callSid);
            return;
          }
          
          const signedUrlData = await signedUrlResponse.json();
          console.log('✅ Got signed URL for outbound agent');
          
          // Add the call_id as a query parameter to the WebSocket URL
          // This helps ElevenLabs identify which call context to fetch
          const wsUrl = new URL(signedUrlData.signed_url);
          wsUrl.searchParams.append('call_id', callSid);
          
          elevenLabsWs = new WebSocket(wsUrl.toString());
          
          elevenLabsWs.on('open', () => {
            console.log('✅ Connected to ElevenLabs Outbound Agent');
            // DO NOT send any custom messages here - ElevenLabs doesn't support them
            // The webhook will be called automatically by ElevenLabs
          });
          
          elevenLabsWs.on('message', (elevenLabsMessage) => {
            try {
              const elevenLabsData = JSON.parse(elevenLabsMessage);
              
              // Log all message types for debugging
              console.log('📥 ElevenLabs message type:', elevenLabsData.type);
              
              if (elevenLabsData.type === 'conversation_initiation_metadata') {
                console.log('🎬 Conversation initiated with metadata:', elevenLabsData);
                // This is where ElevenLabs confirms it has fetched your webhook data
              }
              
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
              
              if (elevenLabsData.type === 'user_transcript') {
                console.log('🗣️ User said:', elevenLabsData.user_transcript_event?.user_transcript);
              }
              
              if (elevenLabsData.type === 'interruption') {
                console.log('🤚 User interrupted');
              }
              
              if (elevenLabsData.type === 'conversation_end') {
                console.log('🏁 Outbound conversation ended');
                ws.send(JSON.stringify({
                  event: 'stop',
                  streamSid: streamSid
                }));
                setTimeout(() => hangupCall(callSid), 100);
              }
              
            } catch (error) {
              console.error('❌ Error processing ElevenLabs message:', error);
            }
          });
          
          elevenLabsWs.on('close', (code, reason) => {
            console.log('🔌 ElevenLabs outbound connection closed:', code, reason);
            if (code !== 1000) { // 1000 is normal closure
              console.error('❌ Abnormal closure. Check ElevenLabs agent configuration.');
            }
            setTimeout(() => hangupCall(callSid), 100);
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
          elevenLabsWs.close(1000, 'Stream stopped');
        }
      }
      
    } catch (error) {
      console.error('❌ Error processing outbound WebSocket message:', error);
      if (callSid) {
        await hangupCall(callSid);
      }
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Twilio outbound WebSocket closed');
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.close(1000, 'Twilio connection closed');
    }
  });
  
  ws.on('error', (error) => {
    console.log('❌ Twilio outbound WebSocket error:', error);
    if (elevenLabsWs && elevenLabsWs.readyState === WebSocket.OPEN) {
      elevenLabsWs.close(1000, 'Twilio error');
    }
  });
}