// src/controllers/teams.js

import connectDB from '../db/index.js';

// Create a new team
export const createTeam = async (req, res) => {
    const { team_name, tax_id, reg_no, team_detail, team_address, team_country, team_prompt, team_phone, team_email, business_center_id } = req.body;
    const created_by = req.user.userId; // Get userId from auth middleware
    
    console.log('User object:', req.user); // Add logging to see user object
    console.log('Brand ID from user:', req.user.brand_id); // Add specific brand_id logging

    try {
        const pool = connectDB();
        const conn = await pool.getConnection();

        try {
            await conn.beginTransaction();

            // Check user permissions
            if (req.user.role !== 'brand_user' && req.user.role !== 'business_admin') {
                await conn.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'Insufficient permissions to create a team'
                });
            }

            // For business_admin, verify they have access to the business center
            if (req.user.role === 'business_admin') {
                if (!business_center_id || business_center_id !== req.user.business_center_id) {
                    await conn.rollback();
                    return res.status(403).json({
                        success: false,
                        message: 'Business admin can only create teams for their assigned business center'
                    });
                }
            }

            // Get brand limits and current count
            const [brandLimits] = await conn.query(
                'SELECT companies FROM brand WHERE id = ?',
                [req.user.brand_id]
            );

            const [currentCount] = await conn.query(
                'SELECT COUNT(*) as count FROM teams WHERE brand_id = ?',
                [req.user.brand_id]
            );

            if (currentCount[0].count >= brandLimits[0].companies) {
                await conn.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Cannot create more teams. Brand limit (${brandLimits[0].companies}) reached.`
                });
            }

            // Convert spaces to underscores in team_name
            const formattedTeamName = team_name.replace(/\s+/g, '_');

            // Check if team already exists for this brand or business center
            const [existingTeam] = await conn.query(
                `SELECT id FROM teams 
                 WHERE (team_name = ? AND brand_id = ?) 
                 OR (team_name = ? AND business_center_id = ?)`,
                [formattedTeamName, req.user.brand_id, formattedTeamName, business_center_id]
            );

            if (existingTeam.length > 0) {
                await conn.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Team name already exists in this brand or business center'
                });
            }

            // If business_center_id is provided, verify it belongs to the user's brand
            if (business_center_id) {
                const [businessCenter] = await conn.query(
                    'SELECT brand_id FROM business_center WHERE id = ? AND brand_id = ?',
                    [business_center_id, req.user.brand_id]
                );
                
                if (businessCenter.length === 0) {
                    await conn.rollback();
                    return res.status(400).json({
                        success: false,
                        message: 'Business center does not belong to your brand'
                    });
                }
            }

            // Create new team with formatted team name
            const insertQuery = `
                INSERT INTO teams (
                    team_name, tax_id, reg_no, team_detail, team_address, 
                    team_country, team_prompt, team_phone, team_email, 
                    team_type, created_by, brand_id, business_center_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
            
            const insertParams = [
                formattedTeamName, tax_id, reg_no, team_detail, team_address,
                team_country, team_prompt, team_phone, team_email,
                'company', created_by, req.user.brand_id, business_center_id || null
            ];

            console.log('Creating team with params:', {
                team_name: formattedTeamName,
                brand_id: req.user.brand_id,
                business_center_id: business_center_id || null
            });

            try {
                const [result] = await conn.query(insertQuery, insertParams);
                console.log('Insert succeeded:', result);

                // Verify the insert by selecting the created team with its relationships
                const [verifyTeam] = await conn.query(
                    `SELECT t.*, 
                            bc.business_name as business_center_name,
                            b.brand_name
                     FROM teams t 
                     LEFT JOIN business_center bc ON t.business_center_id = bc.id
                     LEFT JOIN brand b ON t.brand_id = b.id
                     WHERE t.id = ?`,
                    [result.insertId]
                );

                if (!verifyTeam[0]) {
                    console.error('Team not found after creation');
                    await conn.rollback();
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to verify team creation'
                    });
                }

                if (!verifyTeam[0].brand_id) {
                    console.error('Team created but brand_id is null:', verifyTeam[0]);
                    await conn.rollback();
                    return res.status(500).json({
                        success: false,
                        message: 'Failed to save brand_id'
                    });
                }

                console.log('Verification of inserted team:', verifyTeam[0]);

                await conn.commit();
                res.status(201).json({
                    success: true,
                    teams: [{
                        message: 'Team created successfully',
                        team_id: result.insertId,
                        team_details: verifyTeam[0]
                    }]
                });
            } catch (error) {
                console.error('Error creating team:', error);
                await conn.rollback();
                
                // Check for duplicate entry errors
                if (error.code === 'ER_DUP_ENTRY') {
                    return res.status(400).json({
                        success: false,
                        message: 'Team name must be unique within a brand and business center'
                    });
                }

                res.status(500).json({
                    success: false,
                    message: 'Failed to create team',
                    error: error.message
                });
            }

        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }

    } catch (error) {
        console.error('Error creating team:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Get all teams
export const getAllTeams = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        let query = `
            SELECT t.*, 
                   bc.business_name as business_center_name,
                   b.brand_name
            FROM teams t 
            LEFT JOIN business_center bc ON t.business_center_id = bc.id
            LEFT JOIN brand b ON t.brand_id = b.id
            WHERE 1=1
        `;
        const params = [];

        // Filter based on user role
        if (req.user.role === 'brand_user') {
            query += ' AND t.brand_id = ?';
            params.push(req.user.brand_id);
        } else if (req.user.role === 'business_admin') {
            query += ' AND t.business_center_id = ?';
            params.push(req.user.business_center_id);
        }

        const [teams] = await conn.query(query, params);

        res.json({
            success: true,
            teams
        });

    } catch (error) {
        console.error('Error getting teams:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting teams',
            error: error.message
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get teams by business ID
export const getTeamsByBusinessId = async (req, res) => {
    const businessId = req.params.businessId;
    let conn;

    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        // Verify user has access to this business center
        if (req.user.role === 'business_admin' && req.user.business_center_id !== parseInt(businessId)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied to this business center'
            });
        }

        // For brand_user, verify the business center belongs to their brand
        if (req.user.role === 'brand_user') {
            const [businessCenter] = await conn.query(
                'SELECT id FROM business_center WHERE id = ? AND brand_id = ?',
                [businessId, req.user.brand_id]
            );

            if (businessCenter.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this business center'
                });
            }
        }

        const [teams] = await conn.query(
            `SELECT t.*, 
                    bc.business_name as business_center_name,
                    b.brand_name
             FROM teams t 
             LEFT JOIN business_center bc ON t.business_center_id = bc.id
             LEFT JOIN brand b ON t.brand_id = b.id
             WHERE t.business_center_id = ?`,
            [businessId]
        );

        res.json({
            success: true,
            teams
        });

    } catch (error) {
        console.error('Error getting teams:', error);
        res.status(500).json({
            success: false,
            message: 'Error getting teams',
            error: error.message
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get team by name
export const getTeamByName = async (req, res) => {
    const pool = connectDB();
    let connection;
    try {
        connection = await pool.getConnection();
        const teamName = req.params.teamName;
        const user = req.user;
        
        console.log('Fetching team by name:', teamName);
        console.log('Full user object:', user);

        // Convert spaces to underscores in team name for DB query
        const formattedTeamName = teamName.replace(/\s+/g, '_');

        // If user role is not in req.user, try to get it from decoded token
        const userRole = user.role || (req.decodedToken ? req.decodedToken.role : null);
        console.log('User role:', userRole);

        let query;
        let params;

        if (userRole === 'brand_user') {
            // For brand users, get team that matches the name and brand_id
            const brandId = req.decodedToken?.brand_id || user.brand_id;
            console.log('Using brand_id for query:', brandId);
            
            query = `
                SELECT 
                    t.*,
                    a.username as created_by_name,
                    bc.id as business_center_id,
                    bc.business_name as business_center_name,
                    bc.business_address as business_center_address,
                    bc.business_phone as business_center_phone,
                    bc.business_email as business_center_email
                FROM teams t
                LEFT JOIN business_center bc ON t.business_center_id = bc.id
                LEFT JOIN admin a ON t.created_by = a.id
                WHERE t.team_name = ? 
                AND bc.brand_id = ?
                ORDER BY t.created_at DESC`;
            params = [formattedTeamName, brandId];
        } else {
            // For other users, get team by name with business center info
            query = `
                SELECT 
                    t.*,
                    a.username as created_by_name,
                    bc.id as business_center_id,
                    bc.business_name as business_center_name,
                    bc.business_address as business_center_address,
                    bc.business_phone as business_center_phone,
                    bc.business_email as business_center_email
                FROM teams t 
                LEFT JOIN admin a ON t.created_by = a.id
                LEFT JOIN business_center bc ON t.business_center_id = bc.id
                WHERE t.team_name = ?
                ORDER BY t.created_at DESC`;
            params = [formattedTeamName];
        }

        console.log('Executing query:', query, 'with params:', params);

        // First, let's check if the team exists
        const [teams] = await connection.query(query, params);
        
        if (teams.length === 0) {
            // If no team found, return available teams for the brand/business center
            let availableTeamsQuery;
            let availableTeamsParams;

            if (userRole === 'brand_user') {
                availableTeamsQuery = `
                    SELECT DISTINCT t.team_name 
                    FROM teams t 
                    JOIN business_center bc ON t.business_center_id = bc.id 
                    WHERE bc.brand_id = ?`;
                availableTeamsParams = [brandId];
            } else {
                availableTeamsQuery = `SELECT DISTINCT team_name FROM teams`;
                availableTeamsParams = [];
            }

            const [availableTeams] = await connection.query(availableTeamsQuery, availableTeamsParams);
            return res.status(404).json({ 
                success: false,
                message: `Team "${teamName}" not found. Available teams: ${availableTeams.map(t => t.team_name.replace(/_/g, ' ')).join(', ')}` 
            });
        }

        // Format the response to include both team and business center info
        const team = teams[0];
        const response = {
            team: {
                ...team,
                team_name: team.team_name.replace(/_/g, ' ')
            },
            business_center: {
                id: team.business_center_id,
                name: team.business_center_name,
                address: team.business_center_address,
                phone: team.business_center_phone,
                email: team.business_center_email
            }
        };

        console.log('Formatted response:', response);
        res.json(response);

    } catch (error) {
        console.error('Error fetching team:', error);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Update team
export const updateTeam = async (req, res) => {
    const { team_name, tax_id, reg_no, team_detail, team_address, team_country, team_prompt, team_phone, team_email } = req.body;
    const teamId = req.params.id;
    let conn;

    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.beginTransaction();

        // Convert spaces to underscores in team_name if provided
        const formattedTeamName = team_name ? team_name.replace(/\s+/g, '_') : undefined;

        // Check if team exists and belongs to user's brand/business center
        const [existingTeam] = await conn.query(
            'SELECT * FROM teams WHERE id = ?',
            [teamId]
        );

        if (existingTeam.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // If user is brand_user, verify they have access to this team
        if (req.user.role === 'brand_user') {
            const [teamAccess] = await conn.query(
                `SELECT t.id 
                 FROM teams t 
                 LEFT JOIN business_center bc ON t.business_center_id = bc.id 
                 WHERE t.id = ? AND (t.brand_id = ? OR bc.brand_id = ?)`,
                [teamId, req.user.brand_id, req.user.brand_id]
            );

            if (teamAccess.length === 0) {
                await conn.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to update this team'
                });
            }
        }

        // If updating team name, check if new name already exists
        if (formattedTeamName) {
            const [nameExists] = await conn.query(
                `SELECT id FROM teams 
                 WHERE team_name = ? AND id != ? AND 
                 (brand_id = ? OR business_center_id = ?)`,
                [formattedTeamName, teamId, existingTeam[0].brand_id, existingTeam[0].business_center_id]
            );

            if (nameExists.length > 0) {
                await conn.rollback();
                return res.status(400).json({
                    success: false,
                    message: 'Team name already exists in this brand or business center'
                });
            }
        }

        // Build update query dynamically based on provided fields
        const updates = [];
        const params = [];
        
        if (formattedTeamName) {
            updates.push('team_name = ?');
            params.push(formattedTeamName);
        }
        if (tax_id !== undefined) {
            updates.push('tax_id = ?');
            params.push(tax_id);
        }
        if (reg_no !== undefined) {
            updates.push('reg_no = ?');
            params.push(reg_no);
        }
        if (team_detail !== undefined) {
            updates.push('team_detail = ?');
            params.push(team_detail);
        }
        if (team_address !== undefined) {
            updates.push('team_address = ?');
            params.push(team_address);
        }
        if (team_country !== undefined) {
            updates.push('team_country = ?');
            params.push(team_country);
        }
        if (team_prompt !== undefined) {
            updates.push('team_prompt = ?');
            params.push(team_prompt);
        }
        if (team_phone !== undefined) {
            updates.push('team_phone = ?');
            params.push(team_phone);
        }
        if (team_email !== undefined) {
            updates.push('team_email = ?');
            params.push(team_email);
        }

        if (updates.length === 0) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: 'No fields to update'
            });
        }

        // Add teamId to params
        params.push(teamId);

        // Update team
        const [result] = await conn.query(
            `UPDATE teams SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(500).json({
                success: false,
                message: 'Failed to update team'
            });
        }

        // Get updated team data
        const [updatedTeam] = await conn.query(
            `SELECT t.*, 
                    bc.business_name as business_center_name,
                    b.brand_name
             FROM teams t 
             LEFT JOIN business_center bc ON t.business_center_id = bc.id
             LEFT JOIN brand b ON t.brand_id = b.id
             WHERE t.id = ?`,
            [teamId]
        );

        await conn.commit();

        res.json({
            success: true,
            message: 'Team updated successfully',
            team: updatedTeam[0]
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error updating team:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating team',
            error: error.message
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Delete team
export const deleteTeam = async (req, res) => {
    const teamId = req.params.id;
    let conn;

    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.beginTransaction();

        // Check if team exists and belongs to user's brand/business center
        const [existingTeam] = await conn.query(
            'SELECT * FROM teams WHERE id = ?',
            [teamId]
        );

        if (existingTeam.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // If user is brand_user, verify they have access to this team
        if (req.user.role === 'brand_user') {
            const [teamAccess] = await conn.query(
                `SELECT t.id 
                 FROM teams t 
                 LEFT JOIN business_center bc ON t.business_center_id = bc.id 
                 WHERE t.id = ? AND (t.brand_id = ? OR bc.brand_id = ?)`,
                [teamId, req.user.brand_id, req.user.brand_id]
            );

            if (teamAccess.length === 0) {
                await conn.rollback();
                return res.status(403).json({
                    success: false,
                    message: 'You do not have permission to delete this team'
                });
            }
        }

        // Check if team has any members
        const [teamMembers] = await conn.query(
            'SELECT COUNT(*) as count FROM team_members WHERE team_id = ?',
            [teamId]
        );

        if (teamMembers[0].count > 0) {
            await conn.rollback();
            return res.status(400).json({
                success: false,
                message: 'Cannot delete team that has members. Please remove all team members first.'
            });
        }

        // Delete team
        const [result] = await conn.query(
            'DELETE FROM teams WHERE id = ?',
            [teamId]
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(500).json({
                success: false,
                message: 'Failed to delete team'
            });
        }

        await conn.commit();

        res.json({
            success: true,
            message: 'Team deleted successfully'
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error deleting team:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting team',
            error: error.message
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};
