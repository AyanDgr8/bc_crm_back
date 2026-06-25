// src/controllers/roles/businessCenter.js

import connectDB from '../../db/index.js';
import nodemailer from 'nodemailer';

// Create a new business center
export const createBusiness = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const {
            business_name,
            business_phone,
            business_whatsapp,
            business_email,
            business_password,
            business_person,
            business_address,
            business_country,
            business_tax_id,
            business_reg_no,
            other_detail,
            brand_id
        } = req.body;

        // Validate required fields
        if (!business_name || !business_email || !business_person || !brand_id) {
            return res.status(400).json({ message: 'Business name, email, person name and brand ID are required' });
        }

        // Get brand details for sending email
        const [brand] = await conn.query(
            'SELECT brand_name, brand_email, brand_password, centers as centers_limit FROM brand WHERE id = ?',
            [brand_id]
        );

        if (!brand || brand.length === 0) {
            return res.status(404).json({ message: 'Brand not found' });
        }

        if (!brand[0].brand_email) {
            return res.status(400).json({ message: 'Brand email or password not configured' });
        }

        // Check brand limits
        const [currentCount] = await conn.query(
            'SELECT COUNT(*) as count FROM business_center WHERE brand_id = ?',
            [brand_id]
        );

        if (currentCount[0].count >= brand[0].centers_limit) {
            return res.status(400).json({ 
                message: `Cannot create more business centers. Brand limit (${brand[0].centers_limit}) reached.` 
            });
        }

        // Check if email already exists
        const [existingBusiness] = await conn.query(
            'SELECT id FROM business_center WHERE business_email = ?',
            [business_email]
        );

        if (existingBusiness.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        await conn.beginTransaction();

        // Create business center (user will be created by trigger)
        const [result] = await conn.query(
            `INSERT INTO business_center (
                business_name, business_phone, business_whatsapp, business_email,
                business_password, business_person, business_address, business_country,
                business_tax_id, business_reg_no, other_detail, brand_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                business_name, business_phone, business_whatsapp, business_email,
                business_password, business_person, business_address, business_country,
                business_tax_id, business_reg_no, other_detail, brand_id
            ]
        );

        await conn.commit();

        // Get the new business details
        const [newBusiness] = await conn.query(
            'SELECT * FROM business_center WHERE id = ?',
            [result.insertId]
        );

        // Send welcome email using brand's email
        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: brand[0].brand_email,
                    pass: brand[0].brand_password
                }
            });

            const mailOptions = {
                from: `${brand[0].brand_name} <${brand[0].brand_email}>`,
                to: business_email,
                subject: `Welcome to ${brand[0].brand_name}`,
                html: `
                    <p>Dear ${business_person},</p>
                    <p>Your business center account has been created in ${brand[0].brand_name}.</p>
                    <p>Your login credentials:</p>
                    <ul>
                        <li>Username: ${business_email}</li>
                        <li>Default password: 12345678</li>
                    </ul>
                    <a href="${process.env.FRONTEND_URL}login" style="display: inline-block; padding: 10px 20px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 5px;">Login Now</a>
                    <p>Please change your password after your first login for security purposes.</p>
                    <p>Best regards,<br>Team ${brand[0].brand_name}</p>
                `
            };

            await transporter.sendMail(mailOptions);
            
            res.status(201).json({
                message: 'Business center created successfully and welcome email sent',
                business: newBusiness[0]
            });
        } catch (emailError) {
            console.error('Error sending welcome email:', emailError);
            res.status(201).json({
                message: 'Business center created successfully but welcome email could not be sent',
                business: newBusiness[0],
                emailError: true
            });
        }
    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error creating business:', error);
        res.status(500).json({ message: 'Error creating business', error: error.message });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get all businesses
export const getAllBusinesses = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const user = req.user;

        let query = 'SELECT * FROM business_center';
        let params = [];

        // If user is business_admin, only show their assigned business center
        if (user.role === 'business_admin') {
            query += ' WHERE id = ?';
            params.push(user.business_center_id);
        } else if (!user.isAdmin && user.brand_id) {
            // For brand users, only show businesses in their brand
            query += ' WHERE brand_id = ?';
            params.push(user.brand_id);
        }

        query += ' ORDER BY created_at DESC';

        const [businesses] = await conn.query(query, params);

        if (businesses.length === 0) {
            return res.status(404).json({ message: 'No business centers found' });
        }

        res.json(businesses);
    } catch (error) {
        console.error('Error fetching businesses:', error);
        res.status(500).json({ message: 'Error fetching businesses' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get business by ID
export const getBusinessById = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const [business] = await conn.query(
            'SELECT * FROM business_center WHERE id = ?',
            [req.params.id]
        );

        if (business.length === 0) {
            return res.status(404).json({ message: 'Business not found' });
        }

        res.json(business[0]);

    } catch (error) {
        console.error('Error fetching business:', error);
        res.status(500).json({ message: 'Error fetching business' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Update business
export const updateBusiness = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const {
            business_name,
            business_phone,
            business_whatsapp,
            business_email,
            business_password,
            business_person,
            business_address,
            business_country,
            business_tax_id,
            business_reg_no,
            other_detail,
            brand_id
        } = req.body;

        await conn.beginTransaction();

        // First get the current business details to check if email is being changed
        const [currentBusiness] = await conn.query(
            'SELECT business_email FROM business_center WHERE id = ?',
            [req.params.id]
        );

        if (currentBusiness.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Business not found' });
        }

        // Update business_center
        const [result] = await conn.query(
            `UPDATE business_center SET
                business_name = ?,
                business_phone = ?,
                business_whatsapp = ?,
                business_email = ?,
                business_password = ?,
                business_person = ?,
                business_address = ?,
                business_country = ?,
                business_tax_id = ?,
                business_reg_no = ?,
                other_detail = ?,
                brand_id = ?
            WHERE id = ?`,
            [
                business_name,
                business_phone,
                business_whatsapp,
                business_email,
                business_password,
                business_person,
                business_address,
                business_country,
                business_tax_id,
                business_reg_no,
                other_detail,
                brand_id,
                req.params.id
            ]
        );

        // If email has changed, update the corresponding user's email
        if (business_email && business_email !== currentBusiness[0].business_email) {
            const [updateUser] = await conn.query(
                `UPDATE users u
                 INNER JOIN roles r ON u.role_id = r.id
                 SET u.email = ?
                 WHERE u.business_center_id = ? AND r.role_name = 'business_admin'`,
                [business_email, req.params.id]
            );

            if (updateUser.affectedRows === 0) {
                console.warn(`No business_admin user found to update email for business center ${req.params.id}`);
            }
        }

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Business not found' });
        }

        await conn.commit();

        const [updatedBusiness] = await conn.query(
            'SELECT * FROM business_center WHERE id = ?',
            [req.params.id]
        );

        res.json({
            message: 'Business updated successfully',
            business: updatedBusiness[0]
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error updating business:', error);
        res.status(500).json({ message: 'Error updating business: ' + error.message });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Delete business
export const deleteBusiness = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.beginTransaction();

        // First delete associated users
        await conn.query(
            'DELETE FROM users WHERE business_center_id = ?',
            [req.params.id]
        );

        // Then delete the business center
        const [result] = await conn.query(
            'DELETE FROM business_center WHERE id = ?',
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Business not found' });
        }

        await conn.commit();

        res.json({ message: 'Business and associated users deleted successfully' });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error deleting business:', error);
        res.status(500).json({ message: 'Error deleting business' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get business details with teams and receptionists
export const getBusinessDetails = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const businessId = req.params.id;

        // Get business details with teams and their members
        const [business] = await conn.query(
            `SELECT 
                bc.*,
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'team_id', t.id,
                        'team_name', t.team_name,
                        'team_detail', t.team_detail,
                        'associates', (
                            SELECT JSON_ARRAYAGG(
                                JSON_OBJECT(
                                    'id', tm.id,
                                    'username', tm.username,
                                    'email', tm.email,
                                    'designation', tm.designation
                                )
                            )
                            FROM team_members tm
                            WHERE tm.team_id = t.id
                        )
                    )
                ) as companies,
                (
                    SELECT JSON_ARRAYAGG(
                        JSON_OBJECT(
                            'id', r.id,
                            'name', r.receptionist_name,
                            'email', r.receptionist_email,
                            'phone', r.receptionist_phone
                        )
                    )
                    FROM receptionist r
                    WHERE r.business_center_id = bc.id
                ) as receptionists
            FROM business_center bc
            LEFT JOIN teams t ON t.business_center_id = bc.id
            WHERE bc.id = ?
            GROUP BY bc.id`,
            [businessId]
        );

        if (business.length === 0) {
            return res.status(404).json({ message: 'Business not found' });
        }

        res.json(business[0]);

    } catch (error) {
        console.error('Error fetching business details:', error);
        res.status(500).json({ message: 'Error fetching business details' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get teams for a business center
export const getBusinessTeams = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const businessId = req.params.id;

        const [teams] = await conn.query(
            `SELECT t.*, u.username as created_by_name 
             FROM teams t 
             JOIN users u ON t.created_by = u.id 
             WHERE t.business_center_id = ?
             ORDER BY t.created_at DESC`,
            [businessId]
        );

        res.json({
            teams: teams
        });

    } catch (error) {
        console.error('Error fetching teams:', error);
        res.status(500).json({ message: 'Error fetching teams' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get all teams in a business center
export const getAllBusinessTeams = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const businessId = req.params.id;

        const [teams] = await conn.query(
            `SELECT t.*, 
                COUNT(tm.id) as total_associates,
                JSON_ARRAYAGG(
                    JSON_OBJECT(
                        'id', tm.id,
                        'username', tm.username,
                        'email', tm.email,
                        'designation', tm.designation
                    )
                ) as associates
            FROM teams t
            LEFT JOIN team_members tm ON tm.team_id = t.id
            WHERE t.business_center_id = ?
            GROUP BY t.id
            ORDER BY t.created_at DESC`,
            [businessId]
        );

        res.json(teams);

    } catch (error) {
        console.error('Error fetching business teams:', error);
        res.status(500).json({ message: 'Error fetching business teams' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get all receptionists in a business center
export const getBusinessReceptionists = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const businessId = req.params.id;

        const [receptionists] = await conn.query(
            `SELECT * FROM receptionist 
            WHERE business_center_id = ?
            ORDER BY created_at DESC`,
            [businessId]
        );

        res.json(receptionists);

    } catch (error) {
        console.error('Error fetching business receptionists:', error);
        res.status(500).json({ message: 'Error fetching business receptionists' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Create teams for a business center
export const createBusinessTeams = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const businessId = req.params.id;
        const { teams } = req.body;
        const userId = req.user.userId; // Get user ID from JWT token

        if (!Array.isArray(teams)) {
            return res.status(400).json({ message: 'Teams must be an array' });
        }

        await conn.beginTransaction();

        // Get brand_id from business center
        const [businessCenter] = await conn.query(
            'SELECT brand_id FROM business_center WHERE id = ?',
            [businessId]
        );

        if (businessCenter.length === 0) {
            await conn.rollback();
            throw new Error('Business center not found');
        }

        const brand_id = businessCenter[0].brand_id;

        const createdTeams = [];
        for (const team of teams) {
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
            } = team;

            if (!team_name) {
                await conn.rollback();
                return res.status(400).json({ message: 'Team name is required for all teams' });
            }

            // Convert spaces to underscores in team_name
            const formattedTeamName = team_name.replace(/\s+/g, '_');

            // Check if team already exists for this brand or business center
            const [existingTeam] = await conn.query(
                `SELECT id FROM teams 
                 WHERE (team_name = ? AND brand_id = ?) 
                 OR (team_name = ? AND business_center_id = ?)`,
                [formattedTeamName, brand_id, formattedTeamName, businessId]
            );

            if (existingTeam.length > 0) {
                await conn.rollback();
                return res.status(400).json({
                    message: `Team "${team_name}" already exists in this brand or business center`
                });
            }

            // Create the team
            const [result] = await conn.query(
                `INSERT INTO teams (
                    team_name, tax_id, reg_no, team_phone, team_email,
                    team_address, team_country, team_prompt, team_detail,
                    team_type, created_by, brand_id, business_center_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    formattedTeamName, tax_id, reg_no, team_phone, team_email,
                    team_address, team_country, team_prompt, team_detail,
                    'company', userId, brand_id, businessId
                ]
            );

            createdTeams.push({
                id: result.insertId,
                team_name: formattedTeamName,
                tax_id,
                reg_no,
                team_phone,
                team_email,
                team_address,
                team_country,
                team_prompt,
                team_detail,
                business_center_id: businessId,
                brand_id,
                created_by: userId
            });
        }

        await conn.commit();
        
        res.status(201).json({
            message: 'Teams created successfully',
            teams: createdTeams
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error creating teams:', error);
        res.status(500).json({ message: 'Error creating teams' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Create an associate for a business center
export const createBusinessAssociate = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const businessId = req.params.id;
        const { username, email, mobile_num, mobile_num_2, team_id, department, designation } = req.body;

        // Start transaction
        await conn.beginTransaction();

        try {
            // Validate required fields
            if (!username || !email || !mobile_num || !team_id) {
                throw new Error('Username, email, mobile number, and team ID are required');
            }

            // Check if team belongs to the business center and get brand_id
            const [teamCheck] = await conn.query(
                'SELECT t.id, bc.brand_id FROM teams t JOIN business_center bc ON t.business_center_id = bc.id WHERE t.id = ? AND t.business_center_id = ?',
                [team_id, businessId]
            );

            if (teamCheck.length === 0) {
                throw new Error('Invalid team ID for this business center');
            }

            // Get brand limits and current count
            const [brandLimits] = await conn.query(
                'SELECT associates FROM brand WHERE id = ?',
                [teamCheck[0].brand_id]
            );

            const [currentCount] = await conn.query(
                `SELECT COUNT(*) as count FROM team_members tm 
                 JOIN teams t ON tm.team_id = t.id 
                 JOIN business_center bc ON t.business_center_id = bc.id 
                 WHERE bc.brand_id = ?`,
                [teamCheck[0].brand_id]
            );

            if (currentCount[0].count >= brandLimits[0].associates) {
                throw new Error(`Cannot create more associates. Brand limit (${brandLimits[0].associates}) reached.`);
            }

            // Check for existing user with same username or email only within the same team
            const [existingUser] = await conn.query(
                'SELECT id FROM team_members WHERE (username = ? OR email = ? OR mobile_num = ?) AND team_id = ?',
                [username, email, mobile_num, team_id]
            );

            if (existingUser.length > 0) {
                throw new Error('Username, email, or mobile number already exists in this team');
            }

            // Create the team member
            const [result] = await conn.query(
                `INSERT INTO team_members (
                    username,
                    email,
                    mobile_num,
                    mobile_num_2,
                    department,
                    designation,
                    team_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [username, email, mobile_num, mobile_num_2, department, designation, team_id]
            );

            await conn.commit();

            res.status(201).json({
                message: 'Associate created successfully',
                associate: {
                    id: result.insertId,
                    username,
                    email,
                    mobile_num,
                    mobile_num_2,   
                    department,
                    designation,
                    team_id
                }
            });

        } catch (error) {
            await conn.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error creating associate:', error);
        res.status(400).json({ 
            message: error.message || 'Error creating associate',
            field: error.field
        });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get business counts
export const getBusinessCounts = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const businessId = req.params.id;

        // First get the brand_id for this business center
        const [business] = await conn.query(
            'SELECT brand_id FROM business_center WHERE id = ?',
            [businessId]
        );

        if (business.length === 0) {
            return res.status(404).json({ message: 'Business center not found' });
        }

        const brandId = business[0].brand_id;

        // Get total teams count for the brand
        const [teamsCount] = await conn.query(
            `SELECT COUNT(*) as count FROM teams t 
             WHERE t.brand_id = ? OR EXISTS (
                SELECT 1 FROM business_center bc 
                WHERE bc.id = t.business_center_id AND bc.brand_id = ?
             )`,
            [brandId, brandId]
        );

        // Get total receptionists count for the brand
        const [receptionistsCount] = await conn.query(
            `SELECT COUNT(*) as count FROM receptionist r 
             JOIN business_center bc ON r.business_center_id = bc.id 
             WHERE bc.brand_id = ?`,
            [brandId]
        );

        // Get total associates count for the brand
        const [associatesCount] = await conn.query(
            `SELECT COUNT(*) as count FROM team_members tm 
             JOIN teams t ON tm.team_id = t.id 
             WHERE t.brand_id = ? OR EXISTS (
                SELECT 1 FROM business_center bc 
                WHERE bc.id = t.business_center_id AND bc.brand_id = ?
             )`,
            [brandId, brandId]
        );

        res.json({
            totalTeams: teamsCount[0].count,
            totalReceptionists: receptionistsCount[0].count,
            totalAssociates: associatesCount[0].count
        });

    } catch (error) {
        console.error('Error getting business counts:', error);
        res.status(500).json({ message: 'Error getting business counts' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get teams for a business center (receptionist access)
export const getBusinessCenterTeams = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const businessCenterId = req.params.id;
        const user = req.user;

        // Verify user is a receptionist and has access to this business center
        if (user.role !== 'receptionist') {
            return res.status(403).json({ 
                message: 'Access denied. Only receptionists can access this endpoint.'
            });
        }

        // Check if user has access to this business center
        const [userAccess] = await conn.query(
            `SELECT u.* 
             FROM users u
             WHERE u.id = ? 
             AND u.business_center_id = ?
             AND u.role_id = (SELECT id FROM roles WHERE role_name = 'receptionist')`,
            [user.userId, businessCenterId]
        );

        if (userAccess.length === 0) {
            return res.status(403).json({ 
                message: 'Access denied. Receptionist does not belong to this business center.'
            });
        }

        // Get teams for this business center
        const [teams] = await conn.query(
            `SELECT t.*, u.username as created_by_name 
             FROM teams t 
             JOIN users u ON t.created_by = u.id 
             WHERE t.business_center_id = ?
             ORDER BY t.created_at DESC`,
            [businessCenterId]
        );

        res.json({
            teams: teams
        });

    } catch (error) {
        console.error('Error fetching business center teams:', error);
        res.status(500).json({ message: 'Error fetching teams' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};
