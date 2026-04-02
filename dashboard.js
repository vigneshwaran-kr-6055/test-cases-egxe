// dashboard.js

// API integration functions for Zoho CRM modules

const axios = require('axios');

const ZOHO_CRM_API_BASE_URL = 'https://www.zohoapis.com/crm/v2';

// Function to get records from a specific module
async function getRecords(moduleName) {
    try {
        const response = await axios.get(`${ZOHO_CRM_API_BASE_URL}/${moduleName}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching records:', error);
        throw error;
    }
}

// Function to create a record in a specific module
async function createRecord(moduleName, data) {
    try {
        const response = await axios.post(`${ZOHO_CRM_API_BASE_URL}/${moduleName}`, data);
        return response.data;
    } catch (error) {
        console.error('Error creating record:', error);
        throw error;
    }
}

// Function to update a record in a specific module
async function updateRecord(moduleName, recordId, data) {
    try {
        const response = await axios.put(`${ZOHO_CRM_API_BASE_URL}/${moduleName}/${recordId}`, data);
        return response.data;
    } catch (error) {
        console.error('Error updating record:', error);
        throw error;
    }
}

// Function to delete a record in a specific module
async function deleteRecord(moduleName, recordId) {
    try {
        const response = await axios.delete(`${ZOHO_CRM_API_BASE_URL}/${moduleName}/${recordId}`);
        return response.data;
    } catch (error) {
        console.error('Error deleting record:', error);
        throw error;
    }
}

// Module exports
module.exports = { getRecords, createRecord, updateRecord, deleteRecord };