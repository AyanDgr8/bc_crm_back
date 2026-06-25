// src/controllers/reportWebhook.js

import dotenv from 'dotenv';
import connectDB from '../db/index.js';
import { logger } from '../logger.js';

dotenv.config();

/**
 * Webhook endpoint to fetch data based on extension linked to team members
 * This webhook allows retrieving call reports and user data based on extension numbers
 * 
 * Route example: POST /reports/webhook
 */
export const handleExtensionWebhook = async (req, res) => {
    let pool, connection;
    try {
        // Get extension from request body
        const { extension } = req.body;
        
        if (!extension) {
            return res.status(400).json({
                success: false,
                message: 'Extension is required'
            });
        }
        
        logger.info(`Extension webhook called for extension: ${extension}`);
        
        pool = await connectDB();
        connection = await pool.getConnection();
        
        // First, find the team member with this extension
        const [teamMembers] = await connection.query(
            `SELECT tm.*, t.team_name, t.id as team_id
             FROM team_members tm
             LEFT JOIN teams t ON tm.team_id = t.id
             WHERE tm.extension = ?`,
            [extension]
        );
        
        if (teamMembers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No team member found with this extension'
            });
        }
        
        const teamMember = teamMembers[0];
        logger.info(`Found team member: ${teamMember.username} for extension ${extension}`);
        
        // Get call reports for this extension
        // First check if reports_outbound_calls table has Extension column
        const [outboundColumns] = await connection.query(
            `SHOW COLUMNS FROM reports_outbound_calls LIKE 'Extension'`
        );
        
        let callReports = [];
        
        if (outboundColumns.length > 0) {
            // Get outbound call reports for this extension
            const [outboundReports] = await connection.query(
                `SELECT * FROM reports_outbound_calls 
                 WHERE Extension = ? 
                 ORDER BY \`Call Start Time\` DESC LIMIT 100`,
                [extension]
            );
            
            callReports = outboundReports;
        } else {
            // Try with User Name if Extension column doesn't exist
            const [outboundReports] = await connection.query(
                `SELECT * FROM reports_outbound_calls 
                 WHERE \`User Name\` = ? 
                 ORDER BY \`Call Start Time\` DESC LIMIT 100`,
                [teamMember.username]
            );
            
            callReports = outboundReports;
        }
        
        // Get user charges for this extension
        const [userCharges] = await connection.query(
            `SELECT * FROM reports_user_charges 
             WHERE extension = ? 
             ORDER BY created_at DESC LIMIT 50`,
            [extension]
        );
        
        // Get scheduled calls for this team member
        const [scheduledCalls] = await connection.query(
            `SELECT s.*, c.customer_name, c.phone_number 
             FROM scheduler s
             LEFT JOIN customers c ON s.customer_id = c.id
             WHERE s.created_by = ? 
             ORDER BY s.schedule_time DESC LIMIT 50`,
            [teamMember.id]
        );
        
        // Get customer records assigned to this team member
        const [customerRecords] = await connection.query(
            `SELECT c.* 
             FROM customers c
             WHERE c.agent_name = ? AND c.team_id = ?
             ORDER BY c.created_at DESC LIMIT 50`,
            [teamMember.username, teamMember.team_id]
        );
        
        // Return all the collected data
        res.json({
            success: true,
            teamMember: {
                id: teamMember.id,
                username: teamMember.username,
                email: teamMember.email,
                extension: teamMember.extension,
                department: teamMember.department,
                team: teamMember.team_name,
                team_id: teamMember.team_id
            },
            reports: {
                callReports,
                userCharges,
                scheduledCalls,
                customerRecords,
                totalCalls: callReports.length,
                totalCharges: userCharges.length,
                totalScheduled: scheduledCalls.length,
                totalCustomers: customerRecords.length
            }
        });
        
    } catch (error) {
        logger.error('Error in extension webhook:', error);
        if (res && !res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to process extension webhook',
                error: error.message
            });
        }
    } finally {
        if (connection) connection.release();
    }
};

/**
 * Webhook endpoint to fetch team data based on extension
 * This returns all team members that belong to the same team as the extension owner
 * 
 * Route example: POST /reports/team-webhook
 */
export const handleTeamExtensionWebhook = async (req, res) => {
    let pool, connection;
    try {
        // Get extension from request body
        const { extension } = req.body;
        
        if (!extension) {
            return res.status(400).json({
                success: false,
                message: 'Extension is required'
            });
        }
        
        logger.info(`Team extension webhook called for extension: ${extension}`);
        
        pool = await connectDB();
        connection = await pool.getConnection();
        
        // First, find the team member with this extension
        const [teamMembers] = await connection.query(
            `SELECT tm.team_id
             FROM team_members tm
             WHERE tm.extension = ?`,
            [extension]
        );
        
        if (teamMembers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'No team member found with this extension'
            });
        }
        
        const teamId = teamMembers[0].team_id;
        
        // Get all team members from the same team
        const [teamData] = await connection.query(
            `SELECT tm.*, t.team_name
             FROM team_members tm
             LEFT JOIN teams t ON tm.team_id = t.id
             WHERE tm.team_id = ?
             ORDER BY tm.username`,
            [teamId]
        );
        
        // Get team statistics
        const [teamStats] = await connection.query(
            `SELECT 
                COUNT(DISTINCT c.id) as total_customers,
                COUNT(DISTINCT s.id) as total_scheduled_calls
             FROM teams t
             LEFT JOIN customers c ON c.team_id = t.id
             LEFT JOIN scheduler s ON s.team_id = t.id
             WHERE t.id = ?`,
            [teamId]
        );
        
        // Return team data
        res.json({
            success: true,
            team: {
                id: teamId,
                members: teamData.map(member => ({
                    id: member.id,
                    username: member.username,
                    email: member.email,
                    extension: member.extension,
                    department: member.department,
                    mobile: member.mobile_num
                })),
                stats: teamStats[0],
                memberCount: teamData.length
            }
        });
        
    } catch (error) {
        logger.error('Error in team extension webhook:', error);
        if (res && !res.headersSent) {
            res.status(500).json({
                success: false,
                message: 'Failed to process team extension webhook',
                error: error.message
            });
        }
    } finally {
        if (connection) connection.release();
    }
};

// Note: To wire these controllers, add something like:
// router.post('/reports/webhook', handleExtensionWebhook);
// router.post('/reports/team-webhook', handleTeamExtensionWebhook);


