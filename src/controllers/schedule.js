// src/controllers/schedule.js

import connectDB from '../db/index.js';  

// Helper function to get user's role and business center info
const getUserInfo = async (connection, username) => {
    const [userInfo] = await connection.execute(`
        SELECT 
            u.id as user_id,
            u.role_id,
            r.role_name,
            u.brand_id,
            u.business_center_id,
            tm.team_id
        FROM users u
        JOIN roles r ON u.role_id = r.id
        LEFT JOIN team_members tm ON tm.username = u.username
        WHERE u.username = ?
    `, [username]);

    return userInfo.length ? userInfo[0] : null;
};

// Base fields to select
const baseFields = `
    s.*, 
    c.*, 
    t.team_name,
    bc.business_name as business_center_name,
    b.brand_name,
    TIMESTAMPDIFF(MINUTE, NOW(), s.scheduled_at) as minutes_until_call
    FROM scheduler s
    JOIN customers c ON c.id = s.customer_id
    JOIN teams t ON t.id = s.team_id
    JOIN business_center bc ON bc.id = t.business_center_id
    JOIN brand b ON b.id = t.brand_id
`;

// Function to get reminders based on user role and time condition
const fetchReminders = async (connection, userInfo, isAllReminders = false) => {
    const { role_name: role, business_center_id: businessCenterId, team_id: teamId, brand_id } = userInfo;
    const params = [];
    
    // Time condition for reminders
    const timeCondition = isAllReminders 
        ? `s.scheduled_at IS NOT NULL AND s.scheduled_at > NOW() AND s.status = 'pending'`
        : `s.scheduled_at IS NOT NULL AND s.scheduled_at > NOW() AND s.status = 'pending' AND 
           (TIMESTAMPDIFF(MINUTE, NOW(), s.scheduled_at) <= 15)`;

    let sql;
    if (role === 'admin') {
        sql = `SELECT ${baseFields} WHERE ${timeCondition} ORDER BY s.scheduled_at ASC`;
    } else if (role === 'receptionist') {
        sql = `SELECT ${baseFields} WHERE t.business_center_id = ? AND ${timeCondition} ORDER BY s.scheduled_at ASC`;
        params.push(businessCenterId);
    } else if (role === 'brand_user') {
        sql = `SELECT ${baseFields} WHERE t.brand_id = ? AND ${timeCondition} ORDER BY s.scheduled_at ASC`;
        params.push(brand_id);
    } else {
        sql = `SELECT ${baseFields} WHERE s.team_id = ? AND ${timeCondition} ORDER BY s.scheduled_at ASC`;
        params.push(teamId);
    }

    const [rows] = await connection.execute(sql, params);
    return rows.map(row => ({
        ...row,
        priority: row.minutes_until_call <= 1 ? 'high' : 
                  row.minutes_until_call <= 5 ? 'high' : 'medium'
    }));
};

// Function to get reminders
export const getReminders = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const userInfo = await getUserInfo(connection, req.user.username);
        if (!userInfo) {
            return res.status(404).json({ message: 'User  not found' });
        }

        const reminders = await fetchReminders(connection, userInfo);
        res.status(200).json(reminders);
    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ message: 'Failed to fetch reminders', error: error.message });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Function to get all reminders for a user
export const getAllReminders = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const userInfo = await getUserInfo(connection, req.user.username);
        if (!userInfo) {
            return res.status(404).json({ message: 'User  not found' });
        }

        const reminders = await fetchReminders(connection, userInfo, true);
        res.status(200).json(reminders);
    } catch (error) {
        console.error('Error fetching all reminders:', error);
        res.status(500).json({ message: 'Failed to fetch all reminders', error: error.message });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Function to get scheduled records with customer and assignment info
export const getScheduleRecords = async (req, res) => {
    let connection;
    try {
        connection = await connectDB();
        const query = `
            SELECT 
                c.customer_name, 
                s.scheduled_at
            FROM scheduler s
            JOIN customers c ON s.customer_id = c.id
            ORDER BY s.scheduled_at DESC, s.id DESC
        `;
        const [records] = await connection.query(query);

        // Check if request body is empty
        const hasBody = req.body && Object.keys(req.body).length > 0;
        
        // If no body, return records directly
        if (!hasBody) {
            return res.status(200).json({
                success: true,
                count: records.length,
                data: records
            });
        }

        // Allow remapping field names if requested
        const {
            customer_name = "customer_name",
            scheduled_at = "scheduled_at"
        } = req.body;

        const mappedRecords = records.map(record => ({
            [customer_name]: record.customer_name,
            [scheduled_at]: record.scheduled_at
        }));

        return res.status(200).json({
            success: true,
            count: mappedRecords.length,
            data: mappedRecords
        });

    } catch (error) {
        console.error("Error in getScheduleRecords:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
