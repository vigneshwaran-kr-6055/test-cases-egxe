// dashboard-script.js

// Zoho CRM API integration
const axios = require('axios');

const ZOHO_CRM_BASE_URL = 'https://www.zohoapis.com/crm/v2';
const CLIENT_ID = 'your_client_id';
const CLIENT_SECRET = 'your_client_secret';
const REFRESH_TOKEN = 'your_refresh_token';

let accessToken = '';

async function getAccessToken() {
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', {
        params: {
            refresh_token: REFRESH_TOKEN,
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'refresh_token'
        }
    });
    accessToken = response.data.access_token;
}

async function fetchData(module) {
    if (!accessToken) await getAccessToken();
    const response = await axios.get(`${ZOHO_CRM_BASE_URL}/${module}`, {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` }
    });
    return response.data;
}

async function renderDashboard() {
    try {
        const leads = await fetchData('Leads');
        const contacts = await fetchData('Contacts');
        // Manipulate the data as per your needs for rendering

        // Example: Displaying fetched data in console
        console.log('Leads:', leads);
        console.log('Contacts:', contacts);

        // Code to render the dashboard with fetched data goes here...
    } catch (error) {
        console.error('Error fetching data from Zoho CRM:', error);
    }
}

// Event listener or function call to render the dashboard
renderDashboard();