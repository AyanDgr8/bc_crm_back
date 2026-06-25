// src/controllers/roles/receptionist.js

import connectDB from '../../db/index.js';
import nodemailer from 'nodemailer';

// Create a new receptionist
export const createReceptionist = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        const {
            receptionist_name,
            receptionist_phone,
            receptionist_email,
            business_center_id,
            rec_other_detail
        } = req.body;

        // Validate required fields
        if (!receptionist_name || !business_center_id) {
            return res.status(400).json({ message: 'Receptionist name and business center are required' });
        }

        // Check if business center exists and get brand_id and business_email
        const [businessCenter] = await conn.query(
            'SELECT id, brand_id, business_name, business_email, business_password FROM business_center WHERE id = ?',
            [business_center_id]
        );

        if (businessCenter.length === 0) {
            return res.status(404).json({ message: 'Business center not found' });
        }

        if (!businessCenter[0].business_email || !businessCenter[0].business_password) {
            return res.status(400).json({ message: 'Business center email or password not configured' });
        }

        // Create transporter with business center credentials
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: businessCenter[0].business_email,
                pass: businessCenter[0].business_password
            }
        });

        // Get brand limits and current count
        const [brandLimits] = await conn.query(
            'SELECT receptionist as receptionist_limit FROM brand WHERE id = ?',
            [businessCenter[0].brand_id]
        );

        const [currentCount] = await conn.query(
            `SELECT COUNT(*) as count FROM receptionist r 
             JOIN business_center bc ON r.business_center_id = bc.id 
             WHERE bc.brand_id = ?`,
            [businessCenter[0].brand_id]
        );

        if (currentCount[0].count >= brandLimits[0].receptionist_limit) {
            return res.status(400).json({ 
                message: `Cannot create more receptionists. Brand limit (${brandLimits[0].receptionist_limit}) reached.` 
            });
        }

        // Check if email already exists
        if (receptionist_email) {
            const [existingReceptionist] = await conn.query(
                'SELECT id FROM receptionist WHERE receptionist_email = ?',
                [receptionist_email]
            );

            if (existingReceptionist.length > 0) {
                return res.status(400).json({ message: 'Email already exists' });
            }
        }

        await conn.beginTransaction();

        const [result] = await conn.query(
            `INSERT INTO receptionist (
                receptionist_name,
                receptionist_phone,
                receptionist_email,
                business_center_id,
                rec_other_detail
            ) VALUES (?, ?, ?, ?, ?)`,
            [
                receptionist_name,
                receptionist_phone,
                receptionist_email,
                business_center_id,
                rec_other_detail || ''
            ]
        );

        await conn.commit();

        // Send welcome email
        if (receptionist_email) {
            try {
                const mailOptions = {
                    from: businessCenter[0].business_email,
                    to: receptionist_email,
                    subject: 'Welcome to ' + businessCenter[0].business_name,
                    html: `
                        <p>Dear ${receptionist_name},</p>
                        <p>Your account has been created as a receptionist in the ${businessCenter[0].business_name}.</p>
                        <p>Your login credentials:</p>
                        <ul>
                            <li>Username: ${receptionist_email}</li>
                            <li>Default password: 12345678</li>
                        </ul>
                        <a href="${process.env.FRONTEND_URL}login" style="display: inline-block; padding: 10px 20px; background-color: #1976d2; color: white; text-decoration: none; border-radius: 5px;">Login Now</a>
                        <p>Please change your password after your first login for security purposes.</p>
                        <p>Best regards,<br>Team ${businessCenter[0].business_name} </p>
                    `
                };

                await transporter.sendMail(mailOptions);
                console.log('Welcome email sent to receptionist:', receptionist_email);
            } catch (emailError) {
                console.error('Error sending welcome email:', emailError);
                // Don't fail the request if email sending fails
            }
        }

        res.status(201).json({
            message: 'Receptionist created successfully',
            id: result.insertId
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error creating receptionist:', error);
        res.status(500).json({ message: 'Error creating receptionist', error: error.message });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get all receptionists
export const getAllReceptionists = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        // Get user role from the request
        const userRole = req.user.role;
        const businessCenterId = req.user.business_center_id;
        const brandId = req.user.brand_id;

        let query = `
            SELECT r.*, bc.business_name 
            FROM receptionist r
            LEFT JOIN business_center bc ON r.business_center_id = bc.id
        `;

        let params = [];

        // Filter based on role
        if (userRole === 'business_admin' && businessCenterId) {
            // Business admin can only see receptionists from their business center
            query += ' WHERE bc.id = ?';
            params.push(businessCenterId);
        } else if ((userRole === 'brand_admin' || userRole === 'brand_user') && brandId) {
            // Brand admin and brand users can see all receptionists from their brand's business centers
            query += ' WHERE bc.brand_id = ?';
            params.push(brandId);
        } else if (userRole !== 'admin') {
            // If not an admin and no valid business_center_id or brand_id, return empty list
            return res.json([]);
        }
        // System admin can see all receptionists (no additional WHERE clause)

        query += ' ORDER BY r.created_at DESC';

        const [receptionists] = await conn.query(query, params);
        res.json(receptionists);

    } catch (error) {
        console.error('Error fetching receptionists:', error);
        res.status(500).json({ message: 'Error fetching receptionists' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Get receptionist by ID
export const getReceptionistById = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const [receptionist] = await conn.query(
            `SELECT r.*, bc.business_name 
             FROM receptionist r
             LEFT JOIN business_center bc ON r.business_center_id = bc.id
             WHERE r.id = ?`,
            [req.params.id]
        );

        if (receptionist.length === 0) {
            return res.status(404).json({ message: 'Receptionist not found' });
        }

        res.json(receptionist[0]);

    } catch (error) {
        console.error('Error fetching receptionist:', error);
        res.status(500).json({ message: 'Error fetching receptionist' });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Update receptionist
export const updateReceptionist = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        const {
            receptionist_name,
            receptionist_phone,
            receptionist_email,
            business_center_id,
            rec_other_detail
        } = req.body;

        // Validate required fields
        if (!receptionist_name || !business_center_id) {
            return res.status(400).json({ message: 'Receptionist name and business center are required' });
        }

        // Check if business center exists
        const [businessCenter] = await conn.query(
            'SELECT id FROM business_center WHERE id = ?',
            [business_center_id]
        );

        if (businessCenter.length === 0) {
            return res.status(404).json({ message: 'Business center not found' });
        }

        // Get current receptionist details to check if email is being changed
        const [currentReceptionist] = await conn.query(
            'SELECT receptionist_email FROM receptionist WHERE id = ?',
            [req.params.id]
        );

        if (currentReceptionist.length === 0) {
            return res.status(404).json({ message: 'Receptionist not found' });
        }

        await conn.beginTransaction();

        const [result] = await conn.query(
            `UPDATE receptionist SET
                receptionist_name = ?,
                receptionist_phone = ?,
                receptionist_email = ?,
                business_center_id = ?,
                rec_other_detail = ?
            WHERE id = ?`,
            [
                receptionist_name,
                receptionist_phone,
                receptionist_email,
                business_center_id,
                rec_other_detail,
                req.params.id
            ]
        );

        // If email has changed, update the corresponding user's email
        if (receptionist_email && receptionist_email !== currentReceptionist[0].receptionist_email) {
            const [updateUser] = await conn.query(
                `UPDATE users u
                 INNER JOIN roles r ON u.role_id = r.id
                 SET u.email = ?
                 WHERE u.business_center_id = ? AND r.role_name = 'receptionist' AND u.username = ?`,
                [receptionist_email, business_center_id, receptionist_name]
            );

            if (updateUser.affectedRows === 0) {
                console.warn(`No receptionist user found to update email for receptionist ${receptionist_name}`);
            }
        }

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Receptionist not found' });
        }

        await conn.commit();

        const [updatedReceptionist] = await conn.query(
            'SELECT * FROM receptionist WHERE id = ?',
            [req.params.id]
        );

        res.json({
            message: 'Receptionist updated successfully',
            receptionist: updatedReceptionist[0]
        });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error updating receptionist:', error);
        res.status(500).json({ message: 'Error updating receptionist: ' + error.message });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};

// Delete receptionist
export const deleteReceptionist = async (req, res) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.beginTransaction();

        // First get the receptionist details to find corresponding user
        const [receptionist] = await conn.query(
            'SELECT receptionist_name, receptionist_email FROM receptionist WHERE id = ?',
            [req.params.id]
        );

        if (receptionist.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Receptionist not found' });
        }

        // Delete the corresponding user first (due to foreign key constraints)
        await conn.query(
            'DELETE FROM users WHERE username = ? AND email = ? AND role_id = (SELECT id FROM roles WHERE role_name = "receptionist")',
            [receptionist[0].receptionist_name, receptionist[0].receptionist_email]
        );

        // Then delete the receptionist
        const [result] = await conn.query(
            'DELETE FROM receptionist WHERE id = ?',
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Receptionist not found' });
        }

        await conn.commit();
        res.json({ message: 'Receptionist and associated user account deleted successfully' });

    } catch (error) {
        if (conn) {
            await conn.rollback();
        }
        console.error('Error deleting receptionist:', error);
        res.status(500).json({ message: 'Error deleting receptionist', error: error.message });
    } finally {
        if (conn) {
            conn.release();
        }
    }
};
