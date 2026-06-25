// src/middlewares/auth.js

import jwt from 'jsonwebtoken';
import dotenv from "dotenv";
import connectDB from '../db/index.js';

dotenv.config();  // Load environment variables

export const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(403).json({ message: "Access denied. No token provided." });
    }

    // Validate token format
    if (typeof token !== 'string' || !/^[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*$/.test(token)) {
        return res.status(401).json({ message: "Invalid token format." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        console.log('Decoded token:', decoded);

        // Support both id and userId in token payload
        const userId = decoded.userId || decoded.id;
        if (!userId) {
            console.error('Invalid token payload:', decoded);
            return res.status(401).json({ 
                success: false,
                message: "Invalid token payload" 
            });
        }

        const pool = await connectDB();
        const connection = await pool.getConnection();
        try {
            // Store full decoded token
            req.decodedToken = decoded;

            // Check if user is admin based on role
            const isAdmin = decoded.role === 'admin' || decoded.isAdmin === true;

            // Set essential user info including role and brand_id
            req.user = {
                userId: userId,
                username: decoded.username,
                email: decoded.email,
                role: decoded.role || (isAdmin ? 'admin' : 'user'),
                isAdmin: isAdmin,
                brand_id: decoded.brand_id,
                business_center_id: decoded.business_center_id
            };

            // Only check for brand_id if user is not an admin
            if (!isAdmin && !decoded.brand_id) {
                return res.status(403).json({ 
                    message: "Access denied. Brand ID not found.",
                    details: "Non-admin users must have an associated brand."
                });
            }

            console.log('Set request user:', req.user);
            next();
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error('Token verification error:', error);
        return res.status(401).json({ message: "Invalid token." });
    }
};
