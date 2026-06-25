// src/controllers/sendWhatsapp.js

import connectDB from '../db/index.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../logger.js';

dotenv.config();

const WHATSAPP_API_URL = 'http://localhost:8448';
const DEVICE_ID = 'f7cc71ef-852d-454c-8edb-c017c39e23b5';

/**
 * Send WhatsApp notification when a new customer is added
 * @param {Object} customerData - Customer information
 * @param {string} teamPhone - Team phone number to send notification to
 * @returns {Promise} - Resolves when message is sent
 */
export const sendCustomerNotification = async (customerData, teamPhone) => {
    const {
        customer_name,
        phone_no_primary,
        phone_no_secondary,
        email_id,
        address,
        country,
        designation,
        QUEUE_NAME,
        disposition,
        comment,
        C_unique_id
    } = customerData;

    // Format the message content
    const messageContent = `*New Customer Query - ${customer_name || 'N/A'}*

Dear ${QUEUE_NAME || 'Team'},
    We've received a query from a new customer that requires your attention. Below are the details collected:

Customer Information:
    *Name* : ${customer_name || 'N/A'}
    *Phone* : ${phone_no_primary || 'N/A'}
    *Alt Phone* : ${phone_no_secondary || 'N/A'}
    *Email* : ${email_id || 'N/A'}
    *Address* : ${address || 'N/A'}
    *Country* : ${country || 'N/A'}
    *Designation* : ${designation || 'N/A'}
    *Disposition* : ${disposition || 'N/A'}
    *Unique ID* : ${C_unique_id || 'N/A'}
    *Message* : ${comment || 'N/A'}

Please take appropriate action based on the customer's requirements
Best regards,
CRM System`;

    try {
        // First, login to get the auth token
        const loginResponse = await axios.post(`${WHATSAPP_API_URL}/login`, {
            email: process.env.WHATSAPP_EMAIL || 'ayan@multycomm.com',
            password: process.env.WHATSAPP_PASSWORD || 'Ayan1012'
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-device-id': DEVICE_ID
            }
        });

        const authToken = loginResponse.data.token;

        // Send the WhatsApp message
        await axios.post(`${WHATSAPP_API_URL}/AyanDGR8/send-message`, {
            messages: [{
                number: teamPhone,
                text: messageContent
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            }
        });

        logger.info(`WhatsApp notification sent successfully for customer: ${customer_name}`);
    } catch (error) {
        logger.error('Error sending WhatsApp notification:', error);
        throw error;
    }
};

// Send new customer WhatsApp notification
export const sendNewCustomerWhatsApp = async (req, res) => {
    let connection;
    try {
        const { customerId, teamId } = req.body;

        if (!customerId || !teamId) {
            return res.status(400).json({
                success: false,
                message: 'Customer ID and Team ID are required'
            });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get team phone number
        const [teams] = await connection.query(
            'SELECT team_phone FROM teams WHERE id = ?',
            [teamId]
        );

        if (!teams || teams.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // Get customer details
        const [customers] = await connection.query(
            'SELECT * FROM customers WHERE id = ?',
            [customerId]
        );

        if (!customers || customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Send WhatsApp notification
        await sendCustomerNotification(customers[0], teams[0].team_phone);

        res.json({
            success: true,
            message: 'WhatsApp notification sent successfully'
        });

    } catch (error) {
        logger.error('Error in sendNewCustomerWhatsApp:', error);
        
        // Check for connection refused error
        if (error.code === 'ECONNREFUSED' || (error.cause && error.cause.code === 'ECONNREFUSED')) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp service is disconnected',
                error: {
                    code: 'ECONNREFUSED',
                    message: 'Unable to connect to WhatsApp service'
                }
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp notification',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};