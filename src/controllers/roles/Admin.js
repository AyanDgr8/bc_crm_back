// src/controllers/roles/Admin.js

import bcrypt from 'bcrypt';
import connectDB from '../../db/index.js';  
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const createAdmin = async () => {
    // Admin credentials
    const username = 'Mohit Goel';
    const email = 'mohit@multycomm.com';
    const plainPassword = 'WELcome@123';
    
    try {
        // Hash the password
        const hashedPassword = await bcrypt.hash(plainPassword, 10);
        
        // Get database connection pool
        const pool = connectDB();
        
        // Get a connection from the pool
        const connection = await pool.getConnection();
        
        try {
            await connection.beginTransaction();

            // Check if admin already exists
            const [existingAdmin] = await connection.query(
                'SELECT id FROM admin WHERE email = ? OR username = ?',
                [email, username]
            );

            let adminId;

            if (existingAdmin.length > 0) {
                console.log('Admin already exists. Updating password...');
                await connection.query(
                    'UPDATE admin SET password = ? WHERE email = ?',
                    [hashedPassword, email]
                );
                adminId = existingAdmin[0].id;
            } else {
                // Create new admin
                const [result] = await connection.query(
                    'INSERT INTO admin (username, email, password) VALUES (?, ?, ?)',
                    [username, email, hashedPassword]
                );
                adminId = result.insertId;
            }

            // Get admin role id
            const [roles] = await connection.query(
                'SELECT id FROM roles WHERE role_name = ?',
                ['admin']
            );

            if (roles.length === 0) {
                throw new Error('Admin role not found in roles table');
            }

            // Check if user record exists
            const [existingUser] = await connection.query(
                'SELECT id FROM users WHERE email = ?',
                [email]
            );

            if (existingUser.length > 0) {
                // Update existing user
                await connection.query(
                    'UPDATE users SET password = ?, username = ? WHERE email = ?',
                    [hashedPassword, username, email]
                );
            } else {
                // Create corresponding user record
                await connection.query(
                    'INSERT INTO users (username, email, password, role_id) VALUES (?, ?, ?, ?)',
                    [username, email, hashedPassword, roles[0].id]
                );
            }

            await connection.commit();
            console.log('Admin created successfully!');
            console.log('Username:', username);
            console.log('Email:', email);
            console.log('Password:', plainPassword);
            console.log('Please save these credentials securely.');

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error('Error creating Admin:', error);
    }
};

// Run the function
createAdmin();
