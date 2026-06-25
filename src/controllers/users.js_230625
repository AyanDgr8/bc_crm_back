// src/controllers/users.js

import connectDB from '../db/index.js';

// Create a new user
export const createUser = async (req, res) => {
    console.log('Received user creation request:', req.body);

    const {
        username,
        department,
        email,
        mobile_num,
        mobile_num_2,
        team_id,
        designation
    } = req.body;

    // Validate required fields
    if (!username || !email || !mobile_num || !team_id) {
        console.log('Missing fields:', { username, email, mobile_num, team_id });
        return res.status(400).json({ 
            error: 'Missing required fields: username, email, mobile_num, and team_id are required',
            received: { username, email, mobile_num, team_id }
        });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    try {
        const pool = connectDB();
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Check if user already exists in the same team
            const [existingUser] = await conn.query(
                'SELECT * FROM team_members WHERE (email = ? OR username = ? OR mobile_num = ?) AND team_id = ?',
                [email, username, mobile_num, team_id]
            );

            if (existingUser.length > 0) {
                await conn.rollback();
                let errorField = '';
                if (existingUser[0].email === email) errorField = 'email';
                else if (existingUser[0].username === username) errorField = 'username';
                else errorField = 'mobile number';
                
                return res.status(400).json({ 
                    error: `A user with this ${errorField} already exists in the selected team`,
                    field: errorField.replace(' ', '_')
                });
            }

            // Create user
            const [userResult] = await conn.query(
                'INSERT INTO team_members (username, department, email, mobile_num, mobile_num_2, team_id) VALUES (?, ?, ?, ?, ?, ?)',
                [username, department, email, mobile_num, mobile_num_2, team_id]
            );

            await conn.commit();

            res.status(201).json({
                success: true,
                message: 'User created successfully',
                user_id: userResult.insertId
            });

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all users with their teams
export const getAllUsers = async (req, res) => {
    const pool = connectDB();
    let connection;
    try {
        connection = await pool.getConnection();

        // Get all team members with their team info
        const [users] = await connection.query(`
            SELECT tm.*, t.team_name
            FROM team_members tm
            LEFT JOIN teams t ON tm.team_id = t.id
            ORDER BY tm.created_at DESC
        `);

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Get team members for a specific team
export const getTeamMembers = async (req, res) => {
    const pool = connectDB();
    let connection;
    try {
        connection = await pool.getConnection();

        // Get team members
        const [users] = await connection.query(`
            SELECT tm.*, t.team_name
            FROM team_members tm
            LEFT JOIN teams t ON tm.team_id = t.id
            WHERE tm.team_id = ?
            ORDER BY tm.created_at DESC
        `, [req.params.teamId]);

        res.json({
            success: true,
            data: users
        });
    } catch (error) {
        console.error('Error fetching team members:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Update team member
export const updateTeamMember = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const { memberId } = req.params;
        const {
            username,
            department,
            designation,
            email,
            mobile_num,
            mobile_num_2
        } = req.body;

        // Start transaction
        await connection.beginTransaction();

        // Check if team member exists
        const [existingMember] = await connection.query(
            'SELECT * FROM team_members WHERE id = ?',
            [memberId]
        );

        if (existingMember.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team member not found'
            });
        }

        // Update team member
        const [result] = await connection.query(
            `UPDATE team_members 
             SET username = ?, 
                 designation = ?,
                 department = ?,
                 email = ?,
                 mobile_num = ?,
                 mobile_num_2 = ?
             WHERE id = ?`,
            [
                username,
                designation,
                department,
                email,
                mobile_num,
                mobile_num_2,
                memberId
            ]
        );

        // Commit transaction
        await connection.commit();

        res.json({
            success: true,
            message: 'Team member updated successfully'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error updating team member:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating team member',
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Delete team member
export const deleteTeamMember = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const { memberId } = req.params;

        // Start transaction
        await connection.beginTransaction();

        // Check if team member exists
        const [existingMember] = await connection.query(
            'SELECT * FROM team_members WHERE id = ?',
            [memberId]
        );

        if (existingMember.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team member not found'
            });
        }

        // Delete team member
        await connection.query(
            'DELETE FROM team_members WHERE id = ?',
            [memberId]
        );

        // Commit transaction
        await connection.commit();

        res.json({
            success: true,
            message: 'Team member deleted successfully'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error deleting team member:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting team member',
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
