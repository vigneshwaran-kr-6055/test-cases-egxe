// config.example.js

/**
 * API Configuration Template for Zoho CRM
 *
 * Instructions for securing your credentials:
 * 1. Create a new file named 'config.js'.
 * 2. Copy the content of this file into 'config.js'.
 * 3. Replace 'YOUR_ZOHO_API_CLIENT_ID', 'YOUR_ZOHO_API_CLIENT_SECRET', and 'YOUR_ZOHO_REFRESH_TOKEN'
 *    with your actual Zoho CRM API credentials.
 * 4. Ensure that 'config.js' is added to your .gitignore file to prevent it from being tracked.
 */

const config = {
    zoho: {
        clientId: 'YOUR_ZOHO_API_CLIENT_ID',
        clientSecret: 'YOUR_ZOHO_API_CLIENT_SECRET',
        refreshToken: 'YOUR_ZOHO_REFRESH_TOKEN',
    }
};

module.exports = config;
