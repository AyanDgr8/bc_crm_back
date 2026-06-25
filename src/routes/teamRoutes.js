// src/routes/teamRoutes.js

import express from 'express';
import { createTeam, getAllTeams, getTeamByName } from '../controllers/teams.js';
import { createUser, getAllUsers } from '../controllers/users.js';
import { authenticateToken } from '../middlewares/auth.js';
import connectDB from '../db/index.js';
import XLSX from 'xlsx';

const router = express.Router();

// Team routes
router.post('/players/teams', authenticateToken, createTeam);
router.get('/players/teams', authenticateToken, getAllTeams);

// Get team by name (new route)
router.get('/business/:teamName', authenticateToken, getTeamByName);

// New endpoint for fetching team-specific customer records
router.get('/:teamName', authenticateToken, async (req, res) => {
    const pool = await connectDB();
    let connection;
    try {
        connection = await pool.getConnection();
        const { teamName } = req.params;
        
        const [rows] = await connection.execute(
            `SELECT c.*, tm.username as agent_name 
             FROM customers c 
             LEFT JOIN team_members tm ON c.agent_name = tm.username
             WHERE c.queue_name = ? 
             ORDER BY IFNULL(c.last_updated, '1970-01-01') DESC`,
            [teamName]
        );

        res.json(rows);
    } catch (err) {
        console.error('Error fetching team customers:', err);
        res.status(500).json({ 
            success: false,
            message: 'Failed to fetch team customers',
            error: err.message 
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Get customer by phone number for a specific team
router.get('/:teamName/:phone_no', authenticateToken, async (req, res) => {

    try {
        const pool = await connectDB();
        const connection = await pool.getConnection();

        try {
            const { teamName, phone_no } = req.params;

            const [customers] = await connection.query(
                `SELECT c.* 
                 FROM customers c
                 LEFT JOIN teams t ON c.team_id = t.id
                 WHERE t.team_name = ? AND c.phone_no_primary = ?`,
                [teamName, phone_no]
            );

            if (customers.length === 0) {
                return res.json({
                    success: true,
                    exists: false,
                    message: 'Customer not found',
                    redirect: `/customers/create?team=${teamName}`
                });
            }

            res.json({
                success: true,
                exists: true,
                customer: customers[0]
            });
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

// Update team
router.put('/:teamId', authenticateToken, async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const { teamId } = req.params;
        const {
            team_name,
            tax_id,
            reg_no,
            team_phone,
            team_email,
            team_address,
            team_country,
            team_prompt,
            team_detail
        } = req.body;

        // Start transaction
        await connection.beginTransaction();

        // Update team
        const [result] = await connection.query(
            `UPDATE teams 
             SET team_name = ?, 
                 tax_id = ?,
                 reg_no = ?,
                 team_phone = ?,
                 team_email = ?,
                 team_address = ?,
                 team_country = ?,
                 team_prompt = ?,
                 team_detail = ?
             WHERE id = ?`,
            [
                team_name,
                tax_id,
                reg_no,
                team_phone,
                team_email,
                team_address,
                team_country,
                team_prompt,
                team_detail,
                teamId
            ]
        );

        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // Commit transaction
        await connection.commit();

        res.json({
            success: true,
            message: 'Team updated successfully'
        });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error updating team:', err);
        res.status(500).json({
            success: false,
            message: 'Error updating team',
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Download team and customer data
router.get('/:teamId/download-all-data', authenticateToken, async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const { teamId } = req.params;

        // Get team members data
        const [teamMembers] = await connection.query(
            `SELECT 
                username, department, email, mobile_num, 
                mobile_num_2, designation, created_at
             FROM team_members 
             WHERE team_id = ?`,
            [teamId]
        );

        // Get customers data
        const [customers] = await connection.query(
            `SELECT 
                customer_name, phone_no_primary, phone_no_secondary,
                email_id, address, country, designation, disposition,
                comment, agent_name, date_created, last_updated,
                C_unique_id, scheduled_at
             FROM customers 
             WHERE team_id = ?`,
            [teamId]
        );

        // Create workbook
        const wb = XLSX.utils.book_new();

        // Convert team members to worksheet
        const teamMembersWS = XLSX.utils.json_to_sheet(teamMembers);
        XLSX.utils.book_append_sheet(wb, teamMembersWS, 'Team Members');

        // Convert customers to worksheet
        const customersWS = XLSX.utils.json_to_sheet(customers);
        XLSX.utils.book_append_sheet(wb, customersWS, 'Customers');

        // Generate Excel file
        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Set headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=team_${teamId}_data.xlsx`);
        
        // Send file
        res.send(excelBuffer);

    } catch (err) {
        console.error('Error downloading team data:', err);
        res.status(500).json({
            success: false,
            message: 'Error downloading team data',
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// Delete team
router.delete('/:teamId', authenticateToken, async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        const { teamId } = req.params;

        // Start transaction
        await connection.beginTransaction();

        // Check if team exists and get team name
        const [team] = await connection.query(
            'SELECT team_name FROM teams WHERE id = ?',
            [teamId]
        );

        if (team.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // Get team members data before deletion
        const [teamMembers] = await connection.query(
            `SELECT 
                username, department, email, mobile_num, 
                mobile_num_2, designation, created_at
             FROM team_members 
             WHERE team_id = ?`,
            [teamId]
        );

        // Get customers data before deletion
        const [customers] = await connection.query(
            `SELECT 
                id, customer_name, phone_no_primary, phone_no_secondary,
                email_id, address, country, designation, disposition,
                QUEUE_NAME, comment, date_created, C_unique_id,
                last_updated, agent_name, scheduled_at
             FROM customers 
             WHERE team_id = ?`,
            [teamId]
        );

        // Create workbook with the data
        const wb = XLSX.utils.book_new();

        // Convert team members to worksheet
        const teamMembersWS = XLSX.utils.json_to_sheet(teamMembers);
        XLSX.utils.book_append_sheet(wb, teamMembersWS, 'Team Members');

        // Convert customers to worksheet
        const customersWS = XLSX.utils.json_to_sheet(customers);
        XLSX.utils.book_append_sheet(wb, customersWS, 'Customers');

        // Generate Excel file
        const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        // Delete in correct order due to composite foreign key constraints
        // 1. First nullify the agent_name in customers to break the composite foreign key reference
        await connection.query(
            'UPDATE customers SET agent_name = NULL WHERE team_id = ?',
            [teamId]
        );

        // 2. Delete all customers associated with this team
        await connection.query(
            'DELETE FROM customers WHERE team_id = ?',
            [teamId]
        );

        // 3. Delete all team members
        await connection.query(
            'DELETE FROM team_members WHERE team_id = ?',
            [teamId]
        );

        // 4. Finally delete the team itself
        await connection.query(
            'DELETE FROM teams WHERE id = ?',
            [teamId]
        );

        await connection.commit();

        // Set headers for file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=team_${team[0].team_name}_data.xlsx`);

        // Send file
        res.send(excelBuffer);

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error deleting team:', err);
        res.status(500).json({
            success: false,
            message: 'Error deleting team',
            error: err.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// User management routes
router.post('/players/users', authenticateToken, createUser);
router.get('/players/users', authenticateToken, getAllUsers);

export default router;
