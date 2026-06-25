// src/controllers/downloadFile.js

import connectDB from '../db/index.js';

export const getQueueNames = async (req, res) => {
    try {
        const db = connectDB();
        // Simpler query without joins initially to debug
        const sql = `
            SELECT DISTINCT QUEUE_NAME 
            FROM customers 
            WHERE QUEUE_NAME IS NOT NULL 
            ORDER BY QUEUE_NAME
        `;

        const [results] = await db.query(sql);
        console.log('Queue names results:', results); // Debug log

        return res.json({
            success: true,
            data: results
        });
    } catch (error) {
        console.error('Database error in getQueueNames:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch queue names'
        });
    }
};

export const downloadCustomerData = async (req, res) => {
    try {
        const db = connectDB();
        const { startDate, endDate, queueName } = req.query;

        // Validate required parameters
        if (!startDate || !endDate || !queueName) {
            return res.status(400).json({ 
                success: false,
                message: 'Start date, end date, and queue name are required' 
            });
        }

        // Simpler query without joins initially
        const sql = `
            SELECT 
                id,
                C_unique_id,
                customer_name,
                phone_no_primary,
                phone_no_secondary,
                email_id,
                address,
                country,
                QUEUE_NAME,
                disposition,
                agent_name,
                comment,
                date_created,
                last_updated,
                scheduled_at
            FROM customers
            WHERE date_created BETWEEN ? AND ?
            AND QUEUE_NAME = ?
            ORDER BY date_created DESC
        `;

        const [results] = await db.query(sql, [startDate, endDate, queueName]);
        console.log('Download results count:', results.length); // Debug log

        return res.json({
            success: true,
            data: results
        });

    } catch (error) {
        console.error('Database error in downloadCustomerData:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to download customer data'
        });
    }
};