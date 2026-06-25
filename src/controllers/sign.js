// src/controllers/sign.js

import bcrypt from 'bcrypt';
import connectDB from '../db/index.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { logger } from '../logger.js';

dotenv.config();  // Load environment variables

// Create nodemailer transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const SALT_ROUNDS = 10;
const JWT_EXPIRATION = '10h'; // Match database session duration

// Login User
export const loginAdmin = async (req, res) => {
    const { email, password } = req.body;
    const deviceId = req.headers['x-device-id'];

    if (!email || !password || !deviceId) {
        return res.status(400).json({
            success: false,
            message: 'Email, password and device ID are required'
        });
    }

    let connection;
    let retryCount = 0;
    const maxRetries = 3;
    
    while (retryCount < maxRetries) {
        try {
            const pool = await connectDB();
            connection = await pool.getConnection();

            await connection.beginTransaction();

            try {
                // First try to find user in the users table
                const [users] = await connection.query(
                    `SELECT u.*, r.role_name 
                     FROM users u 
                     JOIN roles r ON u.role_id = r.id 
                     WHERE u.email = ? 
                     FOR UPDATE NOWAIT`,
                    [email]
                );

                // If not found in users table, try admin table
                const [admins] = await connection.query(
                    'SELECT id, email, password, username, "admin" as role_name FROM admin WHERE email = ? FOR UPDATE NOWAIT',
                    [email]
                );

                // Combine results
                const user = users[0] || admins[0];

                if (!user) {
                    await connection.rollback();
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid credentials'
                    });
                }

                // Validate password
                const isValidPassword = await bcrypt.compare(password, user.password);
                if (!isValidPassword) {
                    // Record failed login attempt
                    await connection.query(
                        'INSERT INTO login_history (entity_type, entity_id, device_id, is_active) VALUES (?, ?, ?, false)',
                        [user.role_name, user.id, deviceId]
                    );
                    
                    await connection.commit();
                    return res.status(401).json({
                        success: false,
                        message: 'Invalid credentials'
                    });
                }

                // Clean up old sessions (older than 24 hours)
                await connection.query(
                    'UPDATE login_history SET is_active = false, logout_time = CURRENT_TIMESTAMP WHERE entity_id = ? AND entity_type = ? AND is_active = true AND last_activity < DATE_SUB(NOW(), INTERVAL 24 HOUR)',
                    [user.id, user.role_name]
                );

                // Deactivate ALL existing active sessions for this user
                await connection.query(
                    'UPDATE login_history SET is_active = false, logout_time = CURRENT_TIMESTAMP WHERE entity_id = ? AND entity_type = ? AND is_active = true',
                    [user.id, user.role_name]
                );

                // Create new login session
                const [loginResult] = await connection.query(
                    'INSERT INTO login_history (entity_type, entity_id, device_id, is_active) VALUES (?, ?, ?, true)',
                    [user.role_name, user.id, deviceId]
                );

                // Generate JWT token with extended expiration
                const token = jwt.sign(
                    {
                        userId: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role_name,
                        isAdmin: user.role_name === 'admin', // Explicitly set isAdmin based on role
                        brand_id: user.brand_id || null,
                        business_center_id: user.business_center_id || null,
                        deviceId,
                        sessionId: loginResult.insertId
                    },
                    process.env.JWT_SECRET,
                    { expiresIn: JWT_EXPIRATION }
                );

                await connection.commit();

                res.json({
                    success: true,
                    data: {
                        id: user.id,
                        username: user.username,
                        email: user.email,
                        role: user.role_name,
                        isAdmin: user.role_name === 'admin', // Also include in response
                        brand_id: user.brand_id || null,
                        business_center_id: user.business_center_id || null,
                        token
                    }
                });

                // Successfully processed, break out of retry loop
                break;

            } catch (error) {
                await connection.rollback();
                throw error;
            }

        } catch (error) {
            console.error('Login error:', error);
            retryCount++;

            if (retryCount === maxRetries) {
                return res.status(500).json({
                    success: false,
                    message: 'Server error, please try again',
                    error: error.message
                });
            }

            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, retryCount) * 1000));
        } finally {
            if (connection) {
                connection.release();
            }
        }
    }
};

// Logout Admin
export const logoutAdmin = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        await connection.beginTransaction();

        const deviceId = req.headers['x-device-id'];
        const adminId = req.user?.id;
        const sessionId = req.user?.sessionId;

        if (!adminId || !deviceId) {
            await connection.rollback();
            return res.status(400).json({ 
                success: false,
                message: 'Admin ID and Device ID are required' 
            });
        }

        // Update login history to mark session as inactive
        const [result] = await connection.query(
            `UPDATE login_history 
             SET is_active = false, 
                 logout_time = CURRENT_TIMESTAMP 
             WHERE entity_type = 'admin' 
             AND entity_id = ? 
             AND device_id = ? 
             AND is_active = true`,
            [adminId, deviceId]
        );

        await connection.commit();

        if (result.affectedRows === 0) {
            return res.status(200).json({ 
                success: true,
                message: 'Already logged out' 
            });
        }

        res.status(200).json({ 
            success: true,
            message: 'Logged out successfully' 
        });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        logger.error('Admin logout error:', error);
        res.status(500).json({ 
            success: false,
            message: 'Failed to logout',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Fetch Current Admin
export const fetchCurrentAdmin = async (req, res) => {
    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get admin details
        const [admins] = await connection.query(
            'SELECT id, username, email FROM admin WHERE id = ?',
            [req.user.id]
        );
        
        if (admins.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found'
            });
        }

        const admin = admins[0];

        // Send success response with admin information
        res.status(200).json({
            success: true,
            data: {
                id: admin.id,
                username: admin.username,
                email: admin.email,
                isAdmin: true
            }
        });
    } catch (error) {
        logger.error('Error fetching current admin:', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Forgot Password for Users
export const forgotPassword = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();

        // First check users table
        const [users] = await connection.query(
            `SELECT u.id, u.email, u.username, r.role_name 
             FROM users u 
             JOIN roles r ON u.role_id = r.id 
             WHERE u.email = ?`,
            [email]
        );

        // If not found in users, check admin table
        const [admins] = await connection.query(
            'SELECT id, email, username, "admin" as role_name FROM admin WHERE email = ?',
            [email]
        );

        const user = users[0] || admins[0];

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Email address not found'
            });
        }

        // Generate a JWT token for password reset
        const resetToken = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role_name,
                isAdmin: user.role_name === 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Create reset URL with token
        const resetUrl = `${process.env.FRONTEND_URL}reset-password/${resetToken}`;

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset Request</h1>
                <p>Hello ${user.username},</p>
                <p>You requested a password reset for your account. Click the link below to reset your password:</p>
                <a href="${resetUrl}" style="
                    background-color: #EF6F53;
                    color: white;
                    padding: 10px 20px;
                    text-decoration: none;
                    border-radius: 5px;
                    display: inline-block;
                    margin: 20px 0;
                ">Reset Password</a>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
                <p>Best regards,<br>Multycomm Team</p>
            `
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({
            success: true,
            message: 'Password reset link has been sent to your email'
        });

    } catch (error) {
        logger.error('Error in forgot password:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send reset email',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Send OTP (Reset Password Link)
export const sendOTP = async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({
            success: false,
            message: 'Email is required'
        });
    }

    let connection;
    try {
        const pool = await connectDB();
        connection = await pool.getConnection();
        
        // First check users table
        const [users] = await connection.query(
            `SELECT u.id, u.email, u.username, r.role_name 
             FROM users u 
             JOIN roles r ON u.role_id = r.id 
             WHERE u.email = ?`,
            [email]
        );

        // If not found in users, check admin table
        const [admins] = await connection.query(
            'SELECT id, email, username, "admin" as role_name FROM admin WHERE email = ?',
            [email]
        );

        const user = users[0] || admins[0];
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Email address not found'
            });
        }

        // Generate a JWT token for password reset
        const resetToken = jwt.sign(
            {
                userId: user.id,
                email: user.email,
                role: user.role_name,
                isAdmin: user.role_name === 'admin'
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Create reset URL with token
        const resetLink = `${process.env.FRONTEND_URL}reset-password/${resetToken}`;

        // Email content
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: email,
            subject: 'Password Reset Request',
            html: `
                <h1>Password Reset Request</h1>
                <p>Hello ${user.username},</p>
                <p>We received a request to reset your password. Here are your account details:</p>
                <ul>
                    <li>Username: ${user.username}</li>
                    <li>Email: ${email}</li>
                </ul>
                <p>Click the link below to reset your password:</p>
                <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #EF6F53; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a>
                <p>If you didn't request this password reset, please ignore this email or contact support.</p>
                <p>Best regards,<br>Multycomm Team</p>
            `
        };

        // Send email
        await transporter.sendMail(mailOptions);

        res.status(200).json({
            success: true,
            message: 'Password reset link has been sent to your email'
        });

    } catch (error) {
        logger.error('Error sending OTP:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to send password reset link',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};

// Reset Password with Token
export const resetPasswordWithToken = async (req, res) => {
    try {
        const { id, token } = req.params;
        const { newPassword } = req.body;

        // Password validation
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
        }

        // Check for at least one number
        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one number' });
        }

        // Verify token
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(400).json({ message: "Invalid or expired token" });
            }

            // Verify that the token was generated for this user
            if (decoded.userId !== parseInt(id)) {
                return res.status(400).json({ message: "Invalid token for this user" });
            }

            try {
                const connection = await connectDB();
                
                // Hash the new password
                const hashedPassword = await bcrypt.hash(newPassword, 10);
                
                // Update password only - updated_at will be automatically updated
                await connection.query(
                    'UPDATE admin SET password = ? WHERE id = ?',
                    [hashedPassword, id]
                );

                res.status(200).json({ message: 'Password reset successful' });
            } catch (error) {
                logger.error('Error updating password:', error);
                res.status(500).json({ message: 'Failed to update password' });
            }
        });
    } catch (error) {
        logger.error('Error resetting password:', error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Reset Password
export const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    try {
        // Password validation
        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        // Check for at least one uppercase letter
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one uppercase letter' });
        }

        // Check for at least one lowercase letter
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one lowercase letter' });
        }

        // Check for at least one number
        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ message: 'Password must contain at least one number' });
        }

        // Verify JWT token
        jwt.verify(token, process.env.JWT_SECRET, async (err, decoded) => {
            if (err) {
                return res.status(400).json({ message: 'Invalid or expired token' });
            }

            try {
                const pool = await connectDB();
                const connection = await pool.getConnection();
                
                try {
                    // Hash the new password
                    const hashedPassword = await bcrypt.hash(newPassword, 10);
                    
                    // Begin transaction
                    await connection.beginTransaction();

                    if (decoded.isAdmin) {
                        // Update admin password
                        const [result] = await connection.query(
                            'UPDATE admin SET password = ? WHERE id = ? AND email = ?',
                            [hashedPassword, decoded.userId, decoded.email]
                        );
                        if (result.affectedRows === 0) {
                            throw new Error('Admin not found');
                        }
                    } else {
                        // Update user password
                        const [result] = await connection.query(
                            'UPDATE users SET password = ? WHERE id = ? AND email = ?',
                            [hashedPassword, decoded.userId, decoded.email]
                        );
                        if (result.affectedRows === 0) {
                            throw new Error('User not found');
                        }
                    }

                    // Commit transaction
                    await connection.commit();

                    // Clear any active sessions for this user
                    await connection.query(
                        'UPDATE login_history SET is_active = false, logout_time = CURRENT_TIMESTAMP WHERE entity_id = ? AND entity_type = ? AND is_active = true',
                        [decoded.userId, decoded.role]
                    );

                    res.status(200).json({ 
                        success: true,
                        message: 'Password reset successful' 
                    });

                } catch (error) {
                    await connection.rollback();
                    throw error;
                } finally {
                    connection.release();
                }

            } catch (error) {
                logger.error('Error updating password:', error);
                res.status(500).json({ 
                    success: false,
                    message: 'Failed to update password',
                    error: error.message 
                });
            }
        });
    } catch (error) {
        logger.error('Error resetting password:', error);
        res.status(500).json({ 
            success: false,
            message: 'Server error',
            error: error.message 
        });
    }
};

// Check session status
export const checkSession = async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    const deviceId = req.headers['x-device-id'];

    if (!token || !deviceId) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required',
            forceLogout: true
        });
    }

    let connection;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true }); // Ignore JWT expiration
        const pool = await connectDB();
        connection = await pool.getConnection();

        // Update last_activity and check if session is still active
        const [result] = await connection.query(
            'UPDATE login_history SET last_activity = CURRENT_TIMESTAMP WHERE entity_id = ? AND device_id = ? AND entity_type = ? AND is_active = 1',
            [decoded.userId, deviceId, decoded.role]
        );

        // Check if session was found and updated
        if (result.affectedRows === 0) {
            return res.status(401).json({
                success: false,
                message: 'Session expired due to inactivity',
                forceLogout: true
            });
        }

        // Session is valid
        res.status(200).json({
            success: true,
            message: 'Session is valid'
        });
    } catch (error) {
        logger.error(`Check session error: ${error.message}`);
        res.status(401).json({
            success: false,
            message: 'Your session has expired.',
            forceLogout: true
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};
