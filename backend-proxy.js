'use strict';

const express = require('express');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.X_ZOHO_CATALYST_LISTEN_PORT || process.env.PORT || 3000;

// Allow embedding in Zoho CRM web tabs (and other Zoho products)
const FRAME_ANCESTORS = [
    "'self'",
    'https://*.zoho.com',
    'https://*.zoho.eu',
    'https://*.zoho.in',
    'https://*.zoho.com.au',
    'https://*.zoho.jp',
    'https://*.zohocloud.ca',
].join(' ');

app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', `frame-ancestors ${FRAME_ANCESTORS}`);
    res.removeHeader('X-Frame-Options');
    next();
});

// Middleware
app.use(express.json());

// Serve static files from the app directory
app.use(express.static(path.join(__dirname)));

// Proxy route to handle Zoho CRM API requests
app.post('/api/zoho', async (req, res) => {
    const { endpoint, headers, data } = req.body;

    if (!endpoint) {
        return res.status(400).json({ message: 'Endpoint is required.' });
    }

    try {
        const response = await axios.post(endpoint, data, { headers });
        return res.json(response.data);
    } catch (error) {
        return res.status(error.response.status).json({ message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
