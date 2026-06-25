// src/controllers/whatsapp.js

import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    Browsers,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    isJidBroadcast
} from '@whiskeysockets/baileys';
import { logger } from '../logger.js';
import connectDB from '../db/index.js';
import NodeCache from '@cacheable/node-cache';
import P from 'pino';

// Store active instances
export const instances = {};

const baileysLogger = P({ timestamp: () => `,"time":"${new Date().toJSON()}"` });
baileysLogger.level = 'silent';
const msgRetryCounterCache = new NodeCache();

const usernameToCanonicalInstanceId = (username = '') => {
    const firstName = String(username).trim().split(/\s+/)[0] || 'user';
    const normalized = firstName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return `${normalized || 'user'}_1`;
};

const resolveCanonicalInstance = async (conn, req, requestedInstanceId) => {
    const registerId = req.user.email;
    const canonicalInstanceId = usernameToCanonicalInstanceId(req.user.username || registerId);
    const userKey = req.user.userId || req.user.id || registerId.split('@')[0];

    const [existingForUser] = await conn.query(
        'SELECT * FROM instances WHERE register_id = ? LIMIT 1',
        [registerId]
    );

    if (existingForUser.length > 0) {
        const current = existingForUser[0];
        if (current.instance_id === canonicalInstanceId) {
            return { instanceId: canonicalInstanceId, registerId, row: current };
        }

        const [canonicalOwner] = await conn.query(
            'SELECT register_id FROM instances WHERE instance_id = ? LIMIT 1',
            [canonicalInstanceId]
        );

        const finalInstanceId = canonicalOwner.length && canonicalOwner[0].register_id !== registerId
            ? `${canonicalInstanceId}_${userKey}`
            : canonicalInstanceId;

        if (instances[current.instance_id]) {
            instances[finalInstanceId] = instances[current.instance_id];
            delete instances[current.instance_id];
        }

        await conn.query(
            'UPDATE instances SET instance_id = ?, updated_at = NOW() WHERE register_id = ?',
            [finalInstanceId, registerId]
        );

        return {
            instanceId: finalInstanceId,
            registerId,
            row: { ...current, instance_id: finalInstanceId }
        };
    }

    const [requestedOwner] = requestedInstanceId
        ? await conn.query('SELECT register_id FROM instances WHERE instance_id = ? LIMIT 1', [requestedInstanceId])
        : [[]];

    const finalInstanceId = requestedOwner.length && requestedOwner[0].register_id !== registerId
        ? `${canonicalInstanceId}_${userKey}`
        : canonicalInstanceId;

    await conn.query(
        'INSERT INTO instances (instance_id, register_id, status) VALUES (?, ?, ?)',
        [finalInstanceId, registerId, 'disconnected']
    );

    return {
        instanceId: finalInstanceId,
        registerId,
        row: { instance_id: finalInstanceId, register_id: registerId, status: 'disconnected' }
    };
};

const getAuthFolder = (instanceId) => {
    const userDir = path.resolve('..', 'auth_info');
    return {
        userDir,
        authFolder: path.join(userDir, `instance_${instanceId}`)
    };
};

const setInstanceStatus = async (instanceId, status) => {
    let conn;
    try {
        const pool = connectDB();
        conn = await pool.getConnection();
        await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', [status, instanceId]);
    } catch (dbError) {
        logger.error(`DB update failed while setting WhatsApp status "${status}"`, dbError);
    } finally {
        if (conn) conn.release();
    }
};

// Initialize WhatsApp connection
export const initializeSock = async (instanceId, registerId, options = {}) => {
    try {
        logger.info(`Initializing WhatsApp connection for instance ${instanceId}`);
        
        // keep auth outside src & back folders so nodemon doesn't watch it
        const { userDir, authFolder } = getAuthFolder(instanceId);

        if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
        if (options.fresh && fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }
        if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const { version, isLatest } = await fetchLatestBaileysVersion();
        logger.info(`Using WA v${version.join('.')}, isLatest: ${isLatest}`);

        const sock = makeWASocket({
            version,
            logger: baileysLogger,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
            },
            msgRetryCounterCache,
            generateHighQualityLinkPreview: true,
            printQRInTerminal: false,
            shouldIgnoreJid: (jid) => isJidBroadcast(jid),
            browser: Browsers.macOS('Desktop'),
            connectTimeoutMs: 120000,
            defaultQueryTimeoutMs: 90000,
            keepAliveIntervalMs: 15000,
            retryRequestDelayMs: 500
        });

        const connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Connection timeout'));
            }, 120000);

            let hasResolved = false;

            sock.ev.process(async (events) => {
                if (events['connection.update']) {
                    const update = events['connection.update'];
                    const { connection, qr, lastDisconnect } = update;

                    if (qr && !hasResolved) {
                        try {
                            const url = await qrcode.toDataURL(qr);
                            instances[instanceId] = {
                                sock,
                                qrCode: url,
                                status: 'waiting_for_scan',
                                lastUpdate: new Date(),
                                registerId
                            };
                            await setInstanceStatus(instanceId, 'waiting_for_scan');
                            clearTimeout(timeout);
                            resolve({ qrCode: url });
                            hasResolved = true;
                        } catch (err) {
                            logger.error('Error generating QR code:', err);
                            clearTimeout(timeout);
                            reject(err);
                            hasResolved = true;
                        }
                    }

                    if (connection === 'open') {
                        clearTimeout(timeout);
                        instances[instanceId] = {
                            sock,
                            status: 'connected',
                            lastUpdate: new Date(),
                            registerId
                        };
                        await setInstanceStatus(instanceId, 'connected');

                        if (!hasResolved) {
                            resolve({ connected: true });
                            hasResolved = true;
                        }
                    }

                    if (connection === 'close') {
                        const statusCode = lastDisconnect?.error?.output?.statusCode;
                        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

                        if (!hasResolved) {
                            clearTimeout(timeout);
                            instances[instanceId] = {
                                sock,
                                status: 'disconnected',
                                lastUpdate: new Date(),
                                registerId
                            };
                            await setInstanceStatus(instanceId, 'disconnected');
                            reject(new Error(`WhatsApp connection closed before QR was ready (${statusCode || 'unknown'})`));
                            hasResolved = true;
                            return;
                        }

                        if (shouldReconnect) {
                            if (instances[instanceId]) {
                                instances[instanceId].status = 'reconnecting';
                                instances[instanceId].lastUpdate = new Date();
                            }
                            await setInstanceStatus(instanceId, 'reconnecting');
                            setTimeout(() => initializeSock(instanceId, registerId).catch((err) => {
                                logger.error(`WhatsApp reconnect failed for ${instanceId}: ${err.message}`);
                            }), 5000);
                        } else {
                            if (instances[instanceId]) {
                                instances[instanceId].status = 'disconnected';
                                instances[instanceId].lastUpdate = new Date();
                            }
                            await setInstanceStatus(instanceId, 'disconnected');
                        }
                    }
                }

                if (events['creds.update']) {
                    await saveCreds();
                }
            });
        });

        return connectionPromise;
    } catch (error) {
        logger.error('Error in initializeSock:', error);
        throw error;
    }
};

export const generateQRCode = async (req, res) => {
    let conn;
    try {
        const { instanceId: requestedInstanceId } = req.params;

        const pool = connectDB();
        conn = await pool.getConnection();
        const { instanceId, registerId } = await resolveCanonicalInstance(conn, req, requestedInstanceId);

        const existingInstance = instances[instanceId];
        if (existingInstance?.status === 'connected') {
            return res.json({ success: true, isAuthenticated: true, connected: true, instanceId });
        }

        if (existingInstance?.qrCode) {
            return res.json({
                success: true,
                qrCode: existingInstance.qrCode,
                status: existingInstance.status || 'waiting_for_scan',
                instanceId,
                lastUpdate: existingInstance.lastUpdate
            });
        }

        let result;
        try {
            result = await initializeSock(instanceId, registerId);
        } catch (firstError) {
            logger.warn(`WhatsApp init failed for ${instanceId}, retrying with fresh auth: ${firstError.message}`);
            result = await initializeSock(instanceId, registerId, { fresh: true });
        }

        res.json({ success: true, instanceId, ...result });

    } catch (error) {
        logger.error('QR code generation error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate QR code' });
    } finally {
        if (conn) conn.release();
    }
};

export const getConnectionStatus = async (req, res) => {
    let conn;
    try {
        const { instanceId: requestedInstanceId } = req.params;

        const pool = connectDB();
        conn = await pool.getConnection();
        const { instanceId, row } = await resolveCanonicalInstance(conn, req, requestedInstanceId);

        const instanceData = instances[instanceId];
        const dbStatus = row.status;

        res.json({
            success: true,
            status: instanceData?.status || dbStatus,
            message: `WhatsApp is ${instanceData?.status || dbStatus}`,
            instanceId,
            qrCode: instanceData?.qrCode,
            lastUpdate: instanceData?.lastUpdate
        });
    } catch (error) {
        logger.error('Status check error:', error);
        res.status(500).json({ success: false, message: 'Failed to check connection status' });
    } finally {
        if (conn) conn.release();
    }
};

export const resetInstance = async (req, res) => {
    let conn;
    try {
        const { instanceId: requestedInstanceId } = req.params;

        const pool = connectDB();
        conn = await pool.getConnection();
        const { instanceId } = await resolveCanonicalInstance(conn, req, requestedInstanceId);

        if (instances[instanceId]?.sock) {
            await instances[instanceId].sock.logout().catch(() => {});
        }
        delete instances[instanceId];

        const { authFolder } = getAuthFolder(instanceId);
        if (fs.existsSync(authFolder)) {
            fs.rmSync(authFolder, { recursive: true, force: true });
        }

        await conn.query('UPDATE instances SET status = ? WHERE instance_id = ?', ['disconnected', instanceId]);

        res.json({ success: true, message: 'Instance reset successfully', instanceId });
    } catch (error) {
        logger.error('Reset error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const saveInstanceToDB = async (req, res) => {
    let conn;
    try {
        const { register_id } = req.body;
        const pool = connectDB();
        conn = await pool.getConnection();

        const [user] = await conn.query('SELECT * FROM users WHERE email = ?', [register_id]);
        if (!user.length) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const [existingInstance] = await conn.query('SELECT * FROM instances WHERE register_id = ?', [register_id]);
        if (existingInstance.length > 0) {
            return res.status(400).json({ success: false, message: 'Instance already exists for this user' });
        }

        const [result] = await conn.query('INSERT INTO instances (register_id, status) VALUES (?, ?)', [register_id, 'disconnected']);
        const [newInstance] = await conn.query('SELECT i.*, u.username as user_name FROM instances i JOIN users u ON i.register_id = u.email WHERE i.id = ?', [result.insertId]);

        res.json({ success: true, message: 'Instance created successfully', instance: newInstance[0] });
    } catch (error) {
        logger.error('Error creating instance:', error);
        res.status(500).json({ success: false, message: 'Failed to create instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const getUserInstances = async (req, res) => {
    let conn;
    try {
        const { register_id } = req.params;
        const pool = connectDB();
        conn = await pool.getConnection();

        const [userInstances] = await conn.query('SELECT i.*, u.username FROM instances i JOIN users u ON i.register_id = u.email WHERE i.register_id = ?', [register_id]);

        res.json({ success: true, instances: userInstances });
    } catch (error) {
        logger.error('Error fetching instances:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch instances' });
    } finally {
        if (conn) conn.release();
    }
};

export const updateInstance = async (req, res) => {
    let conn;
    try {
        const { instance_id } = req.params;
        const { status } = req.body;
        const pool = connectDB();
        conn = await pool.getConnection();

        await conn.query('UPDATE instances SET status = ?, updated_at = NOW() WHERE instance_id = ?', [status, instance_id]);

        res.json({ success: true, message: 'Instance updated successfully' });
    } catch (error) {
        logger.error('Error updating instance:', error);
        res.status(500).json({ success: false, message: 'Failed to update instance' });
    } finally {
        if (conn) conn.release();
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { instanceId } = req.params;
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ success: false, message: 'Messages array is required' });
        }

        const instance = instances[instanceId];
        const sock = instance?.sock;
        if (!sock || instance.status !== 'connected') {
            return res.status(400).json({ success: false, message: 'WhatsApp instance not connected' });
        }

        for (const msg of messages) {
            if (!msg.number || !msg.text) continue;
            const jid = msg.number.replace(/\D/g, '') + '@s.whatsapp.net';
            await sock.sendMessage(jid, { text: msg.text });
        }

        return res.json({ success: true, message: 'Messages sent successfully' });
    } catch (error) {
        logger.error('Error sending WhatsApp message:', error);
        return res.status(500).json({ success: false, message: 'Failed to send message', error: error.message });
    }
};
