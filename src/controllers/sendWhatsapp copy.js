// src/controllers/sendWhatsapp.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
import connectDB from '../db/index.js';
import qrcode from 'qrcode';

// Store active instances
export const instances = {};

// Error codes
const ERROR_CODES = {
    WHATSAPP_NOT_CONNECTED: 'WHATSAPP_NOT_CONNECTED',
    WHATSAPP_CONNECTING: 'WHATSAPP_CONNECTING',
    SOCKET_NOT_AUTHENTICATED: 'SOCKET_NOT_AUTHENTICATED',
    INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
    WHATSAPP_NOT_READY: 'WHATSAPP_NOT_READY'
};

// Initialize WhatsApp socket
const initializeSock = async (instanceId) => {
    try {
        // Initialize auth state
        const userDir = path.join(process.cwd(), 'users');
        const authFolder = path.join(userDir, `instance_${instanceId}`);

        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
        if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);

        // Create socket with proper configuration
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ["Chrome (Linux)", "", ""],
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 15000
        });

        // Create a promise that resolves when QR code is generated or connection is established
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 60000); // 1 minute timeout

            let hasResolved = false;
            let reconnectAttempts = 0;
            const maxReconnectAttempts = 3;

            // Handle connection updates
            sock.ev.on('connection.update', async (update) => {
                const { connection, qr, lastDisconnect } = update;

                if (qr && !hasResolved) {
                    try {
                        const url = await qrcode.toDataURL(qr);
                        instances[instanceId] = {
                            sock,
                            qrCode: url,
                            status: 'disconnected',
                            lastUpdate: new Date()
                        };
                        
                        if (!hasResolved) {
                            resolve({ qrCode: url });
                            hasResolved = true;
                        }
                    } catch (err) {
                        reject(err);
                    }
                }

                if (connection === 'open') {
                    clearTimeout(timeout);
                    instances[instanceId] = {
                        sock,
                        status: 'connected',
                        lastUpdate: new Date()
                    };
                    await saveCreds();
                    
                    if (!hasResolved) {
                        resolve({ connected: true });
                        hasResolved = true;
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                    
                    if (shouldReconnect && reconnectAttempts < maxReconnectAttempts) {
                        reconnectAttempts++;
                        instances[instanceId] = {
                            ...instances[instanceId],
                            status: 'reconnecting',
                            lastUpdate: new Date()
                        };
                        
                        const delay = Math.min(Math.pow(2, reconnectAttempts) * 1000, 5000);
                        setTimeout(async () => {
                            try {
                                await saveCreds();
                                delete instances[instanceId];
                                await initializeSock(instanceId);
                            } catch (error) {
                                if (!hasResolved) {
                                    reject(error);
                                }
                            }
                        }, delay);
                    } else {
                        instances[instanceId] = {
                            ...instances[instanceId],
                            status: 'disconnected',
                            lastUpdate: new Date()
                        };
                        if (!hasResolved) {
                            reject(new Error(ERROR_CODES.WHATSAPP_NOT_CONNECTED));
                        }
                    }
                }
            });

            // Save credentials whenever updated
            sock.ev.on('creds.update', saveCreds);
        });
    } catch (error) {
        throw error;
    }
};

// Initialize WhatsApp connection
export const initWhatsApp = async (req, res) => {
    let dbConnection;
    try {
        // Get first name from username for instance ID
        const fullName = req.user.username;
        const instanceId = fullName.split(' ')[0]; // Get first name only

        const pool = await connectDB();
        dbConnection = await pool.getConnection();

        // Check if instance exists
        const [rows] = await dbConnection.execute(
            'SELECT * FROM instances WHERE instance_id = ?',
            [instanceId]
        );

        if (rows.length === 0) {
            // Create new instance record
            await dbConnection.execute(
                'INSERT INTO instances (instance_id, status, register_id) VALUES (?, ?, ?)',
                [instanceId, 'initializing', req.user.email]
            );
        }

        // Update instance status
        await dbConnection.execute(
            'UPDATE instances SET status = ? WHERE instance_id = ?',
            ['initializing', instanceId]
        );

        // Initialize socket
        const result = await initializeSock(instanceId);

        res.json({
            success: true,
            message: 'WhatsApp initialized successfully',
            qrCode: result.qrCode,
            connected: result.connected,
            status: instances[instanceId]?.status || 'initializing',
            instanceId
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to initialize WhatsApp',
            error: error.message
        });
    } finally {
        if (dbConnection) {
            dbConnection.release();
        }
    }
};

// Get connection status
export const getStatus = async (req, res) => {
    const fullName = req.user.username;
    const instanceId = fullName.split(' ')[0];
    const instance = instances[instanceId];

    // If we have an instance and it's in connecting state, keep showing QR
    const status = instance?.status || 'disconnected';
    const shouldShowQr = status === 'disconnected' || status === 'connecting';

    res.json({
        success: true,
        status: status,
        qrCode: shouldShowQr ? instance?.qrCode : null
    });
};

// Reset WhatsApp connection
export const resetWhatsApp = async (req, res) => {
    let dbConnection;
    const fullName = req.user.username;
    const instanceId = fullName.split(' ')[0];

    try {
        const pool = await connectDB();
        dbConnection = await pool.getConnection();

        // Update instance status to resetting
        await dbConnection.execute(
            'UPDATE instances SET status = ? WHERE instance_id = ?',
            ['resetting', instanceId]
        );

        // Get the current instance
        const instance = instances[instanceId];
        if (instance && instance.sock) {
            try {
                await instance.sock.logout();
                await instance.sock.end();
            } catch (err) {
                console.warn('Error while closing socket:', err);
            }
            delete instances[instanceId];
        }

        // Delete auth files
        const authFolder = path.join(process.cwd(), 'users', `instance_${instanceId}`);
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }

        // Update database status
        await dbConnection.execute(
            'UPDATE instances SET status = ? WHERE instance_id = ?',
            ['disconnected', instanceId]
        );

        // Initialize new connection
        const result = await initializeSock(instanceId);

        res.json({
            success: true,
            message: 'WhatsApp connection reset successfully',
            ...result
        });

    } catch (error) {
        if (dbConnection) {
            try {
                await dbConnection.execute(
                    'UPDATE instances SET status = ? WHERE instance_id = ?',
                    ['error', instanceId]
                );
            } catch (dbError) {
                console.error('Error updating instance status:', dbError);
            }
        }

        res.status(500).json({
            success: false,
            message: 'Failed to reset WhatsApp connection',
            error: error.message
        });
    } finally {
        if (dbConnection) {
            dbConnection.release();
        }
    }
};
// Send new customer WhatsApp notification
export const sendNewCustomerWhatsApp = async (req, res) => {
    let connection;
    try {
        const { customerId, teamId } = req.body;

        if (!customerId || !teamId) {
            return res.status(400).json({
                success: false,
                message: 'Customer ID and Team ID are required'
            });
        }

        const pool = await connectDB();
        connection = await pool.getConnection();

        // Get team phone number
        const [teams] = await connection.query(
            'SELECT team_phone FROM teams WHERE id = ?',
            [teamId]
        );

        if (!teams || teams.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Team not found'
            });
        }

        // Get customer details
        const [customers] = await connection.query(
            'SELECT * FROM customers WHERE id = ?',
            [customerId]
        );

        if (!customers || customers.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Customer not found'
            });
        }

        // Send WhatsApp notification
        await sendCustomerNotification(customers[0], teams[0].team_phone);

        res.json({
            success: true,
            message: 'WhatsApp notification sent successfully'
        });

    } catch (error) {
        logger.error('Error in sendNewCustomerWhatsApp:', error);
        
        // Check for connection refused error
        if (error.code === 'ECONNREFUSED' || (error.cause && error.cause.code === 'ECONNREFUSED')) {
            return res.status(503).json({
                success: false,
                message: 'WhatsApp service is disconnected',
                error: {
                    code: 'ECONNREFUSED',
                    message: 'Unable to connect to WhatsApp service'
                }
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to send WhatsApp notification',
            error: error.message
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
};