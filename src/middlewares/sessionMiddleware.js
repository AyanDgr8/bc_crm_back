// src/middleware/sessionMiddleware.js

import connectDB from '../db/index.js';
import jwt from 'jsonwebtoken';
import { logger } from '../logger.js';

// List of paths that don't require session validation
const excludedPaths = ['/login', '/logout', '/check-session', '/forgot-password', '/reset-password'];
    
export const validateSession = async (req, res, next) => {
    if (excludedPaths.includes(req.path)) {
        return next();
    }

    const token = req.headers.authorization?.split(' ')[1];
    const deviceId = req.headers['x-device-id'];

    if (!token || !deviceId) {
        logger.warn('Missing token or device ID');
        return res.status(401).json({ 
            message: 'Authentication required',
            forceLogout: true
        });
    }

    // Only refresh or create session logs when performing WhatsApp connection-related actions
    const shouldRefresh = req.path.startsWith('/whatsapp/init') ||
                          req.path.startsWith('/whatsapp/reset');

    let connection;
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const pool = connectDB();
        connection = await pool.getConnection();

        // Use a shorter transaction with retry logic
        let retries = 3;
        while (retries > 0) {
            try {
                await connection.beginTransaction();

                // Clean up old sessions. Multiple active sessions are allowed for
                // the same user, including other tabs and devices.
                await connection.execute(
                    'UPDATE login_history SET is_active = false, logout_time = NOW() WHERE entity_id = ? AND entity_type = ? AND is_active = true AND TIMESTAMPDIFF(HOUR, login_time, NOW()) >= 24',
                    [decoded.userId, decoded.role]
                );

                // Get active session for this user and device
                const [sessions] = await connection.execute(
                    'SELECT * FROM login_history WHERE entity_id = ? AND entity_type = ? AND device_id = ? AND is_active = true AND TIMESTAMPDIFF(HOUR, login_time, NOW()) < 24 ORDER BY login_time DESC LIMIT 1',
                    [decoded.userId, decoded.role, deviceId]
                );

                if (sessions.length === 0) {
                    // Create a new session for this device
                    await connection.execute(
                        'INSERT INTO login_history (entity_type, entity_id, device_id, login_time, is_active) VALUES (?, ?, ?, NOW(), true)',
                        [decoded.role, decoded.userId, deviceId]
                    );
                    
                    logger.info(`Created new session for user ${decoded.userId} on device ${deviceId}`);
                } else {
                    if (shouldRefresh) {
                        // Avoid overwhelming DB: update only if last update > 60s ago
                        const [updateResult] = await connection.execute(
                            'UPDATE login_history SET last_activity = NOW() WHERE id = ? AND TIMESTAMPDIFF(SECOND, last_activity, NOW()) >= 60',
                            [sessions[0].id]
                        );
                        if (updateResult.affectedRows === 0) {
                            // Skip log if no row updated
                            await connection.commit();
                            break;
                        }
                        logger.info(`Updated session ${sessions[0].id} for user ${decoded.userId}`);
                    }
                }

                // No active sessions found, allow new session
                req.userId = decoded.userId;
                await connection.commit();
                break; // Success, exit retry loop
            } catch (deadlockError) {
                if (deadlockError.code === 'ER_LOCK_DEADLOCK' || deadlockError.code === 'ER_LOCK_WAIT_TIMEOUT') {
                    await connection.rollback();
                    retries--;
                    if (retries === 0) {
                        throw new Error('Max retries reached for session validation');
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries))); // Exponential backoff
                } else {
                    throw deadlockError; // Re-throw if it's not a deadlock error
                }
            }
        }
        next();
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                logger.error('Error rolling back transaction:', rollbackError);
            }
        }
        
        logger.error('Session validation error:', error);
        
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                message: 'Invalid or expired token',
                forceLogout: true
            });
        }
        
        return res.status(500).json({ 
            message: 'An error occurred during session validation',
            forceLogout: true
        });
    } finally {
        if (connection) {
            try {
                connection.release();
            } catch (releaseError) {
                logger.error('Error releasing connection:', releaseError);
            }
        }
    }
};
