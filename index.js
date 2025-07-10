const express = require('express');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
const inboundRoutes = require('./routes/inbound');
const webhookRoutes = require('./routes/webhook');

app.use('/inbound', inboundRoutes);
app.use('/webhook', webhookRoutes);

app.get('/', (req, res) => {
  res.send('🤖 AI Intake Orchestrator is running');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});