'use strict';

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

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
