// src/controllers/createCustomer.js

import connectDB from '../db/index.js';


export const makeNewRecord = async (req, res) => {
    let connection;
    try {
        // Check if user exists in request
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        connection = await connectDB();

        // Constants for ENUM values matching database schema exactly
        const VALID_DISPOSITIONS = ['call_back', 'schedule_visit', 'office_visit', 'urgent_required', 'interested', 'utility_call', 'emergency'];

        // Validation functions
        const validateEnum = (value, validValues, defaultValue) => {
            if (!value) return defaultValue;
            const normalizedValue = value.toString().toLowerCase().trim();
            return validValues.includes(normalizedValue) ? normalizedValue : defaultValue;
        };

        const validateVarchar = (value, maxLength) => {
            if (!value) return null;
            return value.toString().substring(0, maxLength);
        };

        const validateMobileNumber = (value) => {
            if (!value) return null;
            // Remove any non-digit characters
            const digits = value.toString().replace(/\D/g, '');
            // Check if the number has more than 12 digits
            if (digits.length > 12) {
                throw new Error('Phone number cannot exceed 12 digits');
            }
            return digits;
        };

        // Function to format date for MySQL
        const formatMySQLDateTime = (date) => {
            if (!date) return null;
            if (date instanceof Date) {
                return date.toISOString().slice(0, 19).replace('T', ' ');
            }
            if (typeof date === 'string' && date.includes('T')) {
                if (date.includes('00:00:00')) {
                    return date.slice(0, 10);
                }
                return date.slice(0, 19).replace('T', ' ');
            }
            return date;
        };

        // Extract variables from req.body
        const {
            customer_name,
            phone_no_primary, phone_no_secondary,
            email_id, address, country, 
            QUEUE_NAME,
            disposition, designation, agent_name, comment,
            scheduled_at
        } = req.body;

        const errors = [];

        // Validate phone numbers to ensure they are provided
        if (!phone_no_primary) {
            errors.push('Phone number is required.');
        }

        // Validate phone numbers
        try {
            if (!phone_no_primary) {
                errors.push('Phone number is required.');
            } else {
                validateMobileNumber(phone_no_primary);
            }
            if (phone_no_secondary) validateMobileNumber(phone_no_secondary);
        } catch (error) {
            errors.push(error.message);
        }

        // Helper to check if value is non-null and non-empty
        const isValidValue = (value) => {
            return value !== undefined && value !== null && value !== '';
        };

        // Check for duplicates in the database
        const conditions = [];
        const params = [];

        // Add conditions for each field that needs to be checked
        if (isValidValue(phone_no_primary)) {
            conditions.push('(phone_no_primary = ? AND phone_no_primary IS NOT NULL AND phone_no_primary != "")');
            params.push(phone_no_primary);
        }
        if (isValidValue(phone_no_secondary)) {
            conditions.push('(phone_no_secondary = ? AND phone_no_secondary IS NOT NULL AND phone_no_secondary != "")');
            params.push(phone_no_secondary);
        }

        if (conditions.length > 0) {
            const [existRecords] = await connection.query(`
                SELECT phone_no_primary, phone_no_secondary
                FROM customers 
                WHERE ${conditions.join(' OR ')}
            `, params);

            // Check which fields are in use and push appropriate messages
            if (existRecords.length > 0) {
                existRecords.forEach(record => {
                    if (isValidValue(phone_no_primary) && isValidValue(record.phone_no_primary) && record.phone_no_primary === phone_no_primary) {
                        errors.push('This phone number is already registered in our system');
                    }
                    if (isValidValue(phone_no_secondary) && isValidValue(record.phone_no_secondary) && record.phone_no_secondary === phone_no_secondary) {
                        errors.push('This secondary phone number is already registered in our system');
                    }
                });
            }
        }

        // If there are validation errors, return them
        if (errors.length > 0) {
            return res.status(400).json({ errors });
        }

        // Validate all fields
        const validatedData = {
            customer_name: validateVarchar(customer_name, 100),
            phone_no_primary: validateMobileNumber(phone_no_primary),
            phone_no_secondary: validateMobileNumber(phone_no_secondary),
            email_id: validateVarchar(email_id, 100),
            address: address || null,
            country: validateVarchar(country, 15),
            QUEUE_NAME: validateVarchar(QUEUE_NAME, 100),
            designation: validateVarchar(designation, 100),
            disposition: validateEnum(disposition, VALID_DISPOSITIONS, 'call_back'),
            agent_name: validateVarchar(agent_name || req.user.username, 100),
            comment: validateVarchar(comment, 255),
            scheduled_at: formatMySQLDateTime(scheduled_at) || formatMySQLDateTime(new Date())
        };

        // Get the last C_unique_id for this QUEUE_NAME
        const [lastIdResult] = await connection.query(
            'SELECT C_unique_id FROM customers WHERE QUEUE_NAME = ? ORDER BY C_unique_id DESC LIMIT 1',
            [validatedData.QUEUE_NAME]
        );

        let nextUniqueId;
        if (lastIdResult.length === 0) {
            // First record for this QUEUE_NAME
            nextUniqueId = `${validatedData.QUEUE_NAME}_1`;
        } else {
            // Extract the number from the last ID and increment it
            const lastId = lastIdResult[0].C_unique_id;
            const lastNumber = parseInt(lastId.split('_').pop());
            nextUniqueId = `${validatedData.QUEUE_NAME}_${lastNumber + 1}`;
        }

        const sql = `INSERT INTO customers (
                customer_name, phone_no_primary, phone_no_secondary,
                email_id, address, country, designation,
                disposition, agent_name, C_unique_id, comment, scheduled_at, QUEUE_NAME
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        const values = [
            validatedData.customer_name,
            validatedData.phone_no_primary,
            validatedData.phone_no_secondary,
            validatedData.email_id,
            validatedData.address,
            validatedData.country,
            validatedData.designation,
            validatedData.disposition,
            validatedData.agent_name,
            nextUniqueId,
            validatedData.comment,
            validatedData.scheduled_at,
            validatedData.QUEUE_NAME
        ];

        // Begin transaction
        await connection.beginTransaction();

        // Insert the record
        const [result] = await connection.query(sql, values);

        // Commit the transaction
        await connection.commit();

        // Return success response
        return res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            customerId: result.insertId,
            C_unique_id: nextUniqueId
        });

    } catch (error) {
        console.error('Error in makeNewRecord:', error);

        // Rollback transaction if it was started
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error('Error rolling back transaction:', rollbackError);
            }
        }

        // Return error response
        return res.status(500).json({
            success: false,
            message: 'Failed to create customer',
            error: error.message
        });
    } finally {
        // Release connection if it was acquired
        if (connection) {
            try {
                connection.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
};

// Function to check for duplicates
const checkDuplicates = async (connection, phone_no_primary, phone_no_secondary, email_id, QUEUE_NAME) => {
    const query = `
        SELECT * FROM customers 
        WHERE QUEUE_NAME = ? AND (
            phone_no_primary = ? OR 
            phone_no_secondary = ? OR 
            (email_id = ? AND email_id IS NOT NULL)
        ) 
        ORDER BY id DESC
        LIMIT 1`;

    const [duplicates] = await connection.query(query, [
        QUEUE_NAME,
        phone_no_primary,
        phone_no_secondary,
        email_id
    ]);

    if (duplicates.length > 0) {
        return {
            exists: true,
            existing_record: duplicates[0]
        };
    }

    return { exists: false };
};

// Function to generate next C_unique_id
const generateNextUniqueId = async (connection, QUEUE_NAME, existingId = null) => {
    if (existingId) {
        // For duplicates, append __1, __2, etc.
        const parts = existingId.split('__');
        const basePart = parts[0];
        
        // Get the highest suffix for this base ID
        const [maxSuffixResult] = await connection.query(
            'SELECT C_unique_id FROM customers WHERE C_unique_id LIKE ? ORDER BY C_unique_id DESC LIMIT 1',
            [`${basePart}\_\_%`]
        );

        if (maxSuffixResult.length === 0) {
            return `${basePart}__1`;
        }

        const currentSuffix = parseInt(maxSuffixResult[0].C_unique_id.split('__').pop()) || 0;
        return `${basePart}__${currentSuffix + 1}`;
    }

    // For new records, get the latest number for this QUEUE_NAME
    const [lastIdResult] = await connection.query(
        'SELECT C_unique_id FROM customers WHERE QUEUE_NAME = ? AND C_unique_id NOT LIKE "%\_\_%" ORDER BY id DESC LIMIT 1',
        [QUEUE_NAME]
    );

    if (lastIdResult.length === 0) {
        return `${QUEUE_NAME}_1`;
    }

    const lastId = lastIdResult[0].C_unique_id;
    const baseNumber = parseInt(lastId.split('_')[1]) || 0;
    return `${QUEUE_NAME}_${baseNumber + 1}`;
};

export const createCustomer = async (req, res) => {
    const pool = await connectDB();
    let connection;
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const { 
            customer_name, phone_no_primary, phone_no_secondary, 
            email_id, address, country, disposition, designation,
            QUEUE_NAME, comment, scheduled_at 
        } = req.body;

        // Check if user is an admin
        const [adminResult] = await connection.query(
            'SELECT id FROM admin WHERE id = ?',
            [req.user.userId]
        );
        const isAdmin = adminResult.length > 0;

        // Get team_id based on QUEUE_NAME
        const [teamResult] = await connection.query(
            'SELECT id FROM teams WHERE team_name = ?',
            [QUEUE_NAME]
        );

        if (!teamResult || teamResult.length === 0) {
            throw new Error('Invalid team name');
        }

        const team_id = teamResult[0].id;

        // Format scheduled_at or set to NULL if empty
        const formattedScheduledAt = scheduled_at && scheduled_at.trim() !== '' 
            ? new Date(scheduled_at).toISOString().slice(0, 19).replace('T', ' ')
            : null;

        // Check for duplicates
        const duplicates = await checkDuplicates(
            connection, 
            phone_no_primary, 
            phone_no_secondary, 
            email_id,
            QUEUE_NAME
        );

        // First try to get the next sequential ID
        let C_unique_id = `${QUEUE_NAME}_1`;
        let retryCount = 0;
        const maxRetries = 10;

        while (retryCount < maxRetries) {
            try {
                // Get the latest ID for this team
                const [lastIdResult] = await connection.query(
                    'SELECT C_unique_id FROM customers WHERE QUEUE_NAME = ? AND team_id = ? ORDER BY id DESC LIMIT 1',
                    [QUEUE_NAME, team_id]
                );

                if (lastIdResult.length > 0) {
                    const lastId = lastIdResult[0].C_unique_id;
                    const baseNumber = parseInt(lastId.split('_')[1]) || 0;
                    C_unique_id = `${QUEUE_NAME}_${baseNumber + 1}`;
                }

                // Try to insert with this ID
                const [result] = await connection.query(
                    `INSERT INTO customers (
                        customer_name, 
                        phone_no_primary, 
                        phone_no_secondary,
                        email_id, 
                        address,
                        country, 
                        designation,
                        disposition, 
                        QUEUE_NAME, 
                        team_id,
                        agent_name, 
                        C_unique_id, 
                        comment, 
                        scheduled_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        customer_name,
                        phone_no_primary,
                        phone_no_secondary || null,
                        email_id || null,
                        address || null,
                        country || null,
                        designation || null,
                        disposition || 'interested',
                        QUEUE_NAME,
                        team_id,
                        isAdmin ? null : req.user.username,
                        C_unique_id,
                        comment || null,
                        formattedScheduledAt
                    ]
                );

                await connection.commit();

                res.json({
                    success: true,
                    message: 'Customer created successfully',
                    customerId: result.insertId,
                    C_unique_id
                });
                return;

            } catch (err) {
                if (err.code === 'ER_DUP_ENTRY' && err.sqlMessage.includes('unique_team_customer_id')) {
                    // If we got a duplicate, try the next number
                    retryCount++;
                    await connection.rollback();
                    continue;
                }
                throw err;
            }
        }

        throw new Error('Failed to generate unique ID after maximum retries');

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error creating customer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create customer',
            error: error.message
        });
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (err) {
                console.error('Error releasing connection:', err);
            }
        }
    }
};