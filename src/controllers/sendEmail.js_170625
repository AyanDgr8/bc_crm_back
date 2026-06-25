// src/controllers/sendEmail.js

import connectDB from '../db/index.js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { logger } from '../logger.js';

dotenv.config();

/**
 * Send email notification when a new customer is added
 * @param {Object} customerData - Customer information
 * @param {string} teamEmail - Team email address to send notification to
 * @returns {Promise} - Resolves when email is sent
 */
export const sendCustomerNotification = async (customerData, teamEmail) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get business center credentials
        const [businessCenter] = await connection.query(
            `SELECT bc.business_email, bc.business_password 
             FROM business_center bc
             INNER JOIN teams t ON t.business_center_id = bc.id
             WHERE t.team_email = ? AND bc.business_email IS NOT NULL`,
            [teamEmail]
        );

        if (!businessCenter.length || !businessCenter[0].business_email || !businessCenter[0].business_password) {
            throw new Error('Business center email credentials not found');
        }

        // Create transporter with business center credentials
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: businessCenter[0].business_email,
                pass: businessCenter[0].business_password
            }
        });

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

        // Format the email content with proper handling of undefined values
        const emailContent = `
            <h2 style="color: #1976d2">New Customer Query - ${customer_name || 'N/A'}</h2>
            <p style="color: #364C63">Dear ${QUEUE_NAME || 'Team'},</p>
            <p style="color: #364C63">We've received a query from a new customer that requires your attention. Below are the details collected:</p>
            <h3 style="color: #EF6F53">Customer Information:</h3>
            <ul>
                <li>Name: ${customer_name || 'N/A'}</li>
                <li>Phone: ${phone_no_primary || 'N/A'}</li>
                <li>Alt Phone: ${phone_no_secondary || 'N/A'}</li>
                <li>Email: ${email_id || 'N/A'}</li>
                <li>Address: ${address || 'N/A'}</li>
                <li>Country: ${country || 'N/A'}</li>
                <li>Designation: ${designation || 'N/A'}</li>
                <li>Message: ${comment || 'N/A'}</li>
                <li>Disposition: ${disposition || 'N/A'}</li>
                <li>Unique ID: ${C_unique_id || 'N/A'}</li>
            </ul>
            <p style="color: #364C63">Please take appropriate action based on the customer's requirements.<br>Best regards,<br>CRM System</p>
        `;

        await transporter.sendMail({
            from: businessCenter[0].business_email,
            to: teamEmail,
            subject: `New Customer Query - ${customer_name || 'N/A'}`,
            html: emailContent
        });
        logger.info(`Email notification sent successfully for customer: ${customer_name}`);
    } catch (error) {
        logger.error('Error sending email notification:', error);
        throw error;
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Send new customer email notification
export const sendNewCustomerEmail = async (req, res) => {
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

        // Get team email
        const [teams] = await connection.query(
            'SELECT team_email FROM teams WHERE id = ?',
            [teamId]
        );

        if (teams.length === 0 || !teams[0].team_email) {
            return res.status(404).json({
                success: false,
                message: 'Team not found or team email not set'
            });
        }

        // Get customer details
        const [customers] = await connection.query(
            `SELECT 
                customer_name, phone_no_primary, phone_no_secondary, email_id, address, 
                country, designation, QUEUE_NAME, disposition, comment, C_unique_id
            FROM customers 
            WHERE id = ?`,
            [customerId]
        );

        if (customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Send email notification
        await sendCustomerNotification(customers[0], teams[0].team_email);

        res.json({
            success: true,
            message: 'Email notification sent successfully'
        });

    } catch (error) {
        logger.error('Error in sendNewCustomerEmail:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send email notification',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};