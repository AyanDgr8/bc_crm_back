// // src/controllers/whatsapp.js

// import fs from 'fs';
// import path from 'path';
// import qrcode from 'qrcode';
// import { makeWASocket, DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys';
// import { logger } from '../logger.js';
// import connectDB from '../db/index.js';

// // Store active instances
// export const instances = {};

// // Initialize WhatsApp connection
// export const initializeSock = async (instanceId, registerId) => {
//     try {
//         logger.info(`Initializing WhatsApp connection for instance ${instanceId}`);
        
//         const userDir = path.join(process.cwd(), 'users');
//         const authFolder = path.join(userDir, `instance_${instanceId}`);

//         if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
//         if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

//         const { state, saveCreds } = await useMultiFileAuthState(authFolder);

//         const sock = makeWASocket({
//             auth: state,
//             printQRInTerminal: false,
//             browser: ["Chrome (Linux)", "", ""],
//             connectTimeoutMs: 120000,
//             defaultQueryTimeoutMs: 90000,
//             keepAliveIntervalMs: 15000,
//             emitOwnEvents: true,
//             markOnlineOnConnect: true,
//             retryRequestDelayMs: 500
//         });

//         // Save credentials whenever updated
//         sock.ev.on('creds.update', saveCreds);

//         // Create connection promise
//         const connectionPromise = new Promise((resolve, reject) => {
//             const timeout = setTimeout(() => {
//                 reject(new Error('Connection timeout'));
//             }, 120000);

//             let hasResolved = false;

//             sock.ev.on('connection.update', async (update) => {
//                 const { connection, qr, lastDisconnect } = update;
                
//                 if (qr && !hasResolved) {
//                     try {
//                         const url = await qrcode.toDataURL(qr);
//                         instances[instanceId] = {
//                             sock,
//                             qrCode: url,
//                             status: 'disconnected',
//                             lastUpdate: new Date(),
//                             registerId
//                         };
                        
//                         if (!hasResolved) {
//                             resolve({ qrCode: url });
//                             hasResolved = true;
//                         }
//                     } catch (err) {
//                         logger.error('Error generating QR code:', err);
//                         reject(err);
//                     }
//                 }

//                 if (connection === 'open') {
//                     clearTimeout(timeout);
                    
//                     instances[instanceId] = {
//                         sock,
//                         status: 'connected',
//                         lastUpdate: new Date(),
//                         registerId
//                     };

//                     // Update database status
//                     const conn = await connectDB();
//                     await conn.query(
//                         'UPDATE instances SET status = ? WHERE instance_id = ?',
//                         ['connected', instanceId]
//                     );

//                     await saveCreds();

//                     if (!hasResolved) {
//                         resolve({ connected: true });
//                         hasResolved = true;
//                     }
//                 }

//                 if (connection === 'close') {
//                     const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                    
//                     if (shouldReconnect) {
//                         instances[instanceId] = {
//                             ...instances[instanceId],
//                             status: 'reconnecting',
//                             lastUpdate: new Date()
//                         };
                        
//                         // Update database status
//                         const conn = await connectDB();
//                         await conn.query(
//                             'UPDATE instances SET status = ? WHERE instance_id = ?',
//                             ['reconnecting', instanceId]
//                         );

//                         setTimeout(async () => {
//                             try {
//                                 const instance = instances[instanceId];
//                                 if (instance?.sock === sock) {
//                                     await saveCreds();
//                                     delete instances[instanceId];
//                                     await initializeSock(instanceId, registerId);
//                                 }
//                             } catch (error) {
//                                 logger.error('Reconnection error:', error);
//                             }
//                         }, 5000);
//                     } else {
//                         instances[instanceId] = {
//                             ...instances[instanceId],
//                             status: 'disconnected',
//                             lastUpdate: new Date()
//                         };

//                         // Update database status
//                         const conn = await connectDB();
//                         await conn.query(
//                             'UPDATE instances SET status = ? WHERE instance_id = ?',
//                             ['disconnected', instanceId]
//                         );

//                         if (!hasResolved) {
//                             reject(new Error('Connection closed'));
//                         }
//                     }
//                 }
//             });
//         });

//         return connectionPromise;
//     } catch (error) {
//         logger.error('Error in initializeSock:', error);
//         throw error;
//     }
// };

// // Controller functions
// export const generateQRCode = async (req, res) => {
//     try {
//         const { instanceId } = req.params;
//         const registerId = req.user.email;

//         // Check if instance exists and belongs to user
//         const conn = await connectDB();
//         const [instance] = await conn.query(
//             'SELECT * FROM instances WHERE instance_id = ? AND register_id = ?',
//             [instanceId, registerId]
//         );

//         if (!instance.length) {
//             return res.status(404).json({ 
//                 success: false, 
//                 message: 'Instance not found or unauthorized' 
//             });
//         }

//         const existingInstance = instances[instanceId];
//         if (existingInstance?.status === 'connected') {
//             return res.json({ success: true, isAuthenticated: true });
//         }

//         if (existingInstance) {
//             try {
//                 if (existingInstance.sock) {
//                     await existingInstance.sock.logout().catch(() => {});
//                     await existingInstance.sock.end().catch(() => {});
//                 }
//                 delete instances[instanceId];
//             } catch (error) {
//                 logger.error('Cleanup error:', error);
//             }
//         }

//         const result = await initializeSock(instanceId, registerId);
        
//         if (result.connected) {
//             return res.json({ success: true, isAuthenticated: true });
//         }

//         if (result.qrCode) {
//             return res.json({ success: true, qrCode: result.qrCode });
//         }

//         throw new Error('Failed to generate QR code or establish connection');
//     } catch (error) {
//         logger.error('QR code generation error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: 'Failed to generate QR code' 
//         });
//     }
// };

// export const getConnectionStatus = async (req, res) => {
//     try {
//         const { instanceId } = req.params;
//         const registerId = req.user.email;

//         // Check if instance exists and belongs to user
//         const conn = await connectDB();
//         const [instance] = await conn.query(
//             'SELECT * FROM instances WHERE instance_id = ? AND register_id = ?',
//             [instanceId, registerId]
//         );

//         if (!instance.length) {
//             return res.status(404).json({ 
//                 success: false, 
//                 message: 'Instance not found or unauthorized' 
//             });
//         }

//         const instanceData = instances[instanceId];
//         if (!instanceData) {
//             return res.json({
//                 success: true,
//                 status: 'disconnected',
//                 message: 'WhatsApp is not connected'
//             });
//         }

//         res.json({
//             success: true,
//             status: instanceData.status,
//             message: `WhatsApp is ${instanceData.status}`,
//             qrCode: instanceData.qrCode,
//             lastUpdate: instanceData.lastUpdate
//         });
//     } catch (error) {
//         logger.error('Status check error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: 'Failed to check connection status' 
//         });
//     }
// };

// export const resetInstance = async (req, res) => {
//     try {
//         const { instanceId } = req.params;
//         const registerId = req.user.email;

//         // Check if instance exists and belongs to user
//         const conn = await connectDB();
//         const [instance] = await conn.query(
//             'SELECT * FROM instances WHERE instance_id = ? AND register_id = ?',
//             [instanceId, registerId]
//         );

//         if (!instance.length) {
//             return res.status(404).json({ 
//                 success: false, 
//                 message: 'Instance not found or unauthorized' 
//             });
//         }

//         const instanceData = instances[instanceId];
//         if (instanceData?.sock) {
//             await instanceData.sock.logout().catch(() => {});
//             await instanceData.sock.end().catch(() => {});
//         }

//         delete instances[instanceId];

//         // Delete auth files
//         const authFolder = path.join(process.cwd(), 'users', `instance_${instanceId}`);
//         if (fs.existsSync(authFolder)) {
//             fs.rmSync(authFolder, { recursive: true, force: true });
//         }

//         // Update database status
//         await conn.query(
//             'UPDATE instances SET status = ? WHERE instance_id = ?',
//             ['disconnected', instanceId]
//         );

//         res.json({ 
//             success: true, 
//             message: 'Instance reset successfully' 
//         });
//     } catch (error) {
//         logger.error('Reset error:', error);
//         res.status(500).json({ 
//             success: false, 
//             message: 'Failed to reset instance' 
//         });
//     }
// };

// // Instance management functions
// export const saveInstanceToDB = async (req, res) => {
//     try {
//         const { register_id } = req.body;
//         const conn = await connectDB();

//         // Check if admin exists
//         const [admin] = await conn.query(
//             'SELECT * FROM admin WHERE email = ?',
//             [register_id]
//         );

//         if (!admin.length) {
//             return res.status(404).json({
//                 success: false,
//                 message: 'Admin not found'
//             });
//         }

//         // Check if instance already exists
//         const [existingInstance] = await conn.query(
//             'SELECT * FROM instances WHERE register_id = ?',
//             [register_id]
//         );

//         if (existingInstance.length > 0) {
//             return res.status(400).json({
//                 success: false,
//                 message: 'Instance already exists for this admin'
//             });
//         }

//         // Insert new instance - instance_id will be auto-generated by trigger
//         const [result] = await conn.query(
//             'INSERT INTO instances (register_id, status) VALUES (?, ?)',
//             [register_id, 'disconnected']
//         );

//         // Get the created instance
//         const [newInstance] = await conn.query(
//             'SELECT i.*, a.name as admin_name FROM instances i JOIN admin a ON i.register_id = a.email WHERE i.id = ?',
//             [result.insertId]
//         );

//         res.json({
//             success: true,
//             message: 'Instance created successfully',
//             instance: newInstance[0]
//         });
//     } catch (error) {
//         logger.error('Error creating instance:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to create instance'
//         });
//     }
// };

// export const getUserInstances = async (req, res) => {
//     try {
//         const { register_id } = req.params;
//         const conn = await connectDB();

//         // Get admin's instances
//         const [instances] = await conn.query(
//             'SELECT i.*, a.name FROM instances i JOIN admin a ON i.register_id = a.email WHERE i.register_id = ?',
//             [register_id]
//         );

//         res.json({
//             success: true,
//             instances: instances.map(instance => ({
//                 ...instance,
//                 instance_number: instance.name.split(' ')[0]
//             }))
//         });
//     } catch (error) {
//         logger.error('Error fetching instances:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to fetch instances'
//         });
//     }
// };

// export const updateInstance = async (req, res) => {
//     try {
//         const { instance_id } = req.params;
//         const { status } = req.body;
//         const conn = await connectDB();

//         // Update instance status
//         await conn.query(
//             'UPDATE instances SET status = ?, updated_at = NOW() WHERE instance_id = ?',
//             [status, instance_id]
//         );

//         res.json({
//             success: true,
//             message: 'Instance updated successfully'
//         });
//     } catch (error) {
//         logger.error('Error updating instance:', error);
//         res.status(500).json({
//             success: false,
//             message: 'Failed to update instance'
//         });
//     }
// };
