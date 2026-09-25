# AI Intake Orchestrator

Production-oriented Node.js orchestration service for real-time AI voice intake, qualification, scheduling, and downstream workflow automation.

The system connects Twilio telephony with ElevenLabs conversational AI and external services including Airtable and n8n to handle inbound calls, capture structured lead data, qualify prospects, and trigger follow-up workflows.

## Live Technical Demo

See the system operating end-to-end, including real inbound AI voice calls, qualification, scheduling, and downstream workflow automation:

https://langstonandwells.com/demo-videos

## What the System Does

A typical inbound workflow:

1. A prospect calls the firm's phone number.
2. Twilio routes the call into the orchestration service.
3. The service establishes a real-time WebSocket connection between Twilio and ElevenLabs.
4. The AI voice agent conducts the conversation and collects relevant intake information.
5. Structured data is extracted from the interaction and passed into downstream workflows.
6. Qualification logic determines the appropriate next action.
7. Qualified prospects can be routed into consultation scheduling.
8. Airtable and n8n handle CRM updates, notifications, and additional workflow automation.

The goal is to automate the intake process while preserving the firm's existing operational systems.

## Technical Architecture

### Telephony
Twilio handles inbound calls and real-time audio streaming.

### AI Voice Layer
ElevenLabs provides the conversational AI agent used for natural-language intake and qualification.

### Orchestration Layer
A custom Node.js/Express service manages:

- Twilio and ElevenLabs connectivity
- Real-time WebSocket audio routing
- Session state
- Event handling
- Validation and error handling
- Integration logic
- Downstream service communication

### Data and Workflow Layer
Structured call data is passed into Airtable and n8n for:

- Lead records
- Qualification results
- Transcripts
- Workflow routing
- Internal notifications
- Follow-up automation

### Scheduling
Qualified prospects can be routed into automated consultation scheduling and confirmation workflows.

## Technology Stack

- JavaScript / Node.js
- Express
- REST APIs
- WebSockets
- Webhooks
- Twilio
- ElevenLabs AI
- Airtable
- n8n
- Render
- Zoom API

## Engineering Considerations

### Real-Time Audio

Voice interactions require bidirectional, low-latency audio streaming. The orchestration layer manages the real-time connection between the telephony and conversational AI services.

### Reliability

The service includes connection lifecycle management, validation, error handling, and session cleanup to improve reliability during live calls.

### Structured Data Extraction

Conversation outputs are converted into structured fields that downstream systems can use for qualification, CRM updates, scheduling, and automation.

### Modular Integrations

The architecture separates voice orchestration from downstream workflow automation, making it easier to modify integrations without rebuilding the core calling infrastructure.

## Why I Built It

I built this system to solve a practical intake problem: inbound leads often require immediate response, but manual intake creates delays and inconsistent data collection.

Rather than replacing a firm's existing systems, the architecture was designed to integrate with the tools already in place and automate the workflow around them.

The project required translating a business workflow into a working technical system spanning telephony, conversational AI, APIs, real-time streaming, structured data, scheduling, and workflow automation.

## Business Impact

Deployments of the broader intake system:

- Reduced average lead response time from 30-120 minutes to under 60 seconds.
- Increased booked consultations through automated qualification and routing.
- Automated intake, structured data capture, scheduling, and follow-up workflows.
- Reduced manual operational work without requiring firms to replace their existing systems.

## Repository Scope

This repository contains the Node.js orchestration layer responsible for connecting Twilio, ElevenLabs, and downstream services.

Client-specific configuration, credentials, production data, and proprietary workflow logic are not included.

## About the Project

This project was designed and built by Eli Lustbader as part of Winslow Intake Systems.

For a visual walkthrough and working demonstrations:

https://langstonandwells.com/demo-videos

LinkedIn:
https://www.linkedin.com/in/eli-lustbader
