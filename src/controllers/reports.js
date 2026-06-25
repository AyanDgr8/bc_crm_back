// src/controllers/reports.js

import dotenv from 'dotenv';
import imaps from 'imap-simple';
import { simpleParser } from 'mailparser';
import { parse } from 'csv-parse/sync';
import connectDB from '../db/index.js';
import { logger } from '../logger.js';
import _ from 'lodash';

dotenv.config();

// IMAP configuration – always use ayan@multycomm.com credentials
const getImapConfig = async (user, connection) => {
    // Always use the same email and password for fetching reports
    const email = 'ayan@multycomm.com';
    const password = 'snwb pexk avoq lnyl';
    
    logger.info(`Using fixed email ${email} for IMAP connection`);
    
    return {
        imap: {
            user: email,
            password: password,
            host: process.env.IMAP_HOST || 'imap.gmail.com',
            port: Number(process.env.IMAP_PORT) || 993,
            tls: true,
            tlsOptions: { rejectUnauthorized: false }, // allow self-signed certs if corporate MITM
            authTimeout: 10000
        }
    };
};

// Helper to trim CSV header keys (handles trailing spaces, weird capitals, BOM)
const trimKeys = obj => Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [k.replace(/^\uFEFF/, '').trim(), v])
);

// Column definitions for explicit mapping
const INBOUND_COLS = [
    'ID', 'Call ID', 'Other Leg Call ID', 'Start Time', 'Caller ID Name', 'Caller ID Number',
    'Dialed Number', 'Callee ID Name', 'Callee ID Number', 'Duration seconds', 'Billing seconds', 'Hangup Cause'
];
const OUTBOUND_COLS = [
    'ID', 'Call ID', 'Other Leg Call ID', 'Call Start Time', 'Hangup time',
    'Caller ID Name', 'Caller ID Number', 'User Name', 'Extension', 'User email', 'Dialed Number',
    'Outbound Dialed Number', 'Duration seconds', 'Billing seconds (Talked Duration)', 'Wait Duration',
    'Hangup Cause', 'Media Recording ID', 'Media Name'
];

// Robust CSV parser that tries multiple delimiters
function parseCsv(content) {
    const tryDelims = [',', ';', '\t'];
    for (const delim of tryDelims) {
        const records = parse(content, {
            columns: true,
            delimiter: delim,
            skip_empty_lines: true,
            relax_column_count: true,
            relax_quotes: true,
            trim: true
        });
        if (records.length) return records;
    }
    return [];
}

// Try to decode CSV buffer, detecting common encodings (UTF-8, UTF-16LE, UTF-16BE)
function bufferToText(buf) {
    // UTF-8 BOM
    if (buf.slice(0,3).equals(Buffer.from([0xEF,0xBB,0xBF]))) {
        return buf.toString('utf8');
    }
    // Heuristic: if every second byte is 0x00 -> UTF-16LE
    let isUtf16le = true;
    for (let i=0; i<32 && i+1<buf.length; i+=2) {
        if (buf[i+1] !== 0x00) { isUtf16le = false; break; }
    }
    if (isUtf16le) return buf.toString('utf16le');
    // UTF-16BE heuristic: first byte zero for ascii chars
    let isUtf16be = true;
    for (let i=0; i<32 && i+1<buf.length; i+=2) {
        if (buf[i] !== 0x00) { isUtf16be = false; break; }
    }
    if (isUtf16be) return buf.toString('utf16be');
    // fallback utf8
    return buf.toString('utf8');
}

/**
 * Download unseen e-mails sent from "config@multycomm.com" to the logged-in user,
 * extract CSV attachments and persist each record into the proper table based on report type.
 *
 * Route example:   GET /reports/fetch
 */
export const fetchAndInsertReports = async (req, res) => {
    let pool, connection, imap;
    try {
        pool = await connectDB();
        connection = await pool.getConnection();

        // Get query parameters
        const fetchAll = req.query.fetchAll === 'true';
        const days = parseInt(req.query.days || '120', 10);
        
        // Get IMAP configuration dynamically
        const imapConfig = await getImapConfig(req.user, connection);
        
        logger.info(`Email-reports: Connecting to IMAP server ${imapConfig.imap.host} as ${imapConfig.imap.user}`);
        logger.info(`Email-reports: Fetching ${fetchAll ? 'ALL recent' : 'UNSEEN'} emails from MultyComm`);

        // connect to mailbox
        try {
            imap = await imaps.connect(imapConfig);
            await imap.openBox('INBOX');
        } catch (imapError) {
            logger.error('IMAP connection error:', imapError);
            return res.status(500).json({ 
                success: false, 
                message: 'Failed to connect to email server', 
                error: imapError.message,
                details: 'Check your email credentials and server settings'
            });
        }

        // Calculate date for recent emails (if fetchAll is true)
        let searchCriteria;
        if (fetchAll) {
            // Get recent emails (seen or unseen)
            const searchDate = new Date();
            searchDate.setDate(searchDate.getDate() - days);
            const formattedDate = searchDate.toISOString().split('T')[0];
            
            // Use a more flexible search pattern that looks for "config@multycomm.com" anywhere in the From header
            searchCriteria = [
                ['HEADER', 'FROM', 'config@multycomm.com'],
                ['SINCE', formattedDate]
            ];
            logger.info(`Email-reports: Searching for emails since ${formattedDate}`);
        } else {
            // Get only unseen emails (default behavior)
            // Use a more flexible search pattern
            searchCriteria = [
                ['HEADER', 'FROM', 'config@multycomm.com'], 
                'UNSEEN'
            ];
        }
        
        const fetchOptions = { bodies: [''], markSeen: !fetchAll, struct: true };
        const messages = await imap.search(searchCriteria, fetchOptions);
        logger.info(`Email-reports: found ${messages.length} candidate message(s)`);

        if (messages.length === 0) {
            logger.info('No report e-mails found matching criteria');
            return res.json({ 
                success: true, 
                message: 'No reports to process', 
                criteria: {
                    fetchAll,
                    since: fetchAll ? `${days} days ago` : 'N/A'
                }
            });
        }

        // Counters per report type
        const insertedCounts = { inbound: 0, outbound: 0, userCharges: 0 };
        const processedEmails = [];

        // ---------------------------------------------
        // Iterate over each message
        // ---------------------------------------------
        for (const message of messages) {
            const raw = _.flatten(message.parts.filter(p => p.which === '').map(p => p.body))[0];
            const parsed = await simpleParser(raw);
            const subject = parsed.subject || '';
            
            processedEmails.push({
                subject,
                date: parsed.date,
                from: parsed.from?.text,
                hasAttachments: (parsed.attachments || []).length > 0
            });

            let reportType, tableName;
            if (/Inbound Calls Report/i.test(subject)) {
                reportType = 'inbound';
                tableName = 'reports_inbound_calls';
            } else if (/Outbound Calls Report/i.test(subject)) {
                reportType = 'outbound';
                tableName = 'reports_outbound_calls';
            } else if (/Users Charges Report/i.test(subject)) {
                reportType = 'userCharges';
                tableName = 'reports_user_charges';
            } else {
                logger.info(`Skipping unrelated e-mail with subject: "${subject}"`);
                continue; // not one of our report types
            }

            logger.info(`Processing ${reportType} report from e-mail "${subject}"`);
            logger.info(`Attachment filenames: ${(parsed.attachments||[]).map(a=>a.filename).join(', ')}`);

            for (const attachment of parsed.attachments || []) {
                if (!attachment.filename.toLowerCase().endsWith('.csv')) continue;
                logger.info(`Parsing attachment ${attachment.filename}`);

                const csvText = bufferToText(attachment.content);
                logger.info(`CSV preview (first 200 chars): ${csvText.slice(0,200)}`);
                const records = parseCsv(csvText);
                logger.info(`Parsed ${records.length} record(s) from ${attachment.filename}`);

                if (records.length === 0) {
                    logger.warn(`No records parsed from ${attachment.filename}; first 120 chars: ${csvText.slice(0,120)}`);
                }

                await connection.beginTransaction();
                try {
                    for (const record of records) {
                        const r = trimKeys(record);

                        if (reportType === 'userCharges') {
                            // Map explicit columns – header names differ from DB columns.
                            const params = [
                                r['User Name'],
                                r['Extension'],
                                r['Tags'],
                                r['Total Calls'],
                                r['Inbound total calls'],
                                r['Outbound total calls'],
                                r['Minutes'],
                                r['Amount']
                            ];
                            const sql = `INSERT INTO reports_user_charges (user_name, extension, tags, total_calls, inbound_total_calls, outbound_total_calls, minutes, amount) VALUES (?,?,?,?,?,?,?,?)`;
                            await connection.query(sql, params);
                        } else {
                            // Build ordered column/value arrays based on predefined lists
                            const colsList = reportType === 'inbound' ? INBOUND_COLS : OUTBOUND_COLS;
                            // Handle typo: some CSVs have 'aller ID Name'; normalize to 'Caller ID Name'
                            if (r['aller ID Name'] && !r['Caller ID Name']) {
                                r['Caller ID Name'] = r['aller ID Name'];
                            }

                            const placeholders = colsList.map(() => '?').join(',');
                            const sql = `INSERT INTO ${tableName} (${colsList.map(c => `\`${c}\``).join(',')}) VALUES (${placeholders})`;
                            const values = colsList.map(c => r[c] ?? null);
                            await connection.query(sql, values);
                        }

                        insertedCounts[reportType] += 1;
                    }
                    await connection.commit();
                } catch (dbErr) {
                    await connection.rollback();
                    throw dbErr;
                }
            }
        }

        res.json({ 
            success: true, 
            inserted: insertedCounts, 
            processedEmails 
        });
        logger.info(`Email-reports: inserted rows – ${JSON.stringify(insertedCounts)}`);
    } catch (error) {
        logger.error('Error fetching / inserting reports:', error);
        if (connection) await connection.rollback();
        if (res && !res.headersSent) {
            res.status(500).json({ 
                success: false, 
                message: 'Failed to fetch reports', 
                error: error.message 
            });
        }
    } finally {
        if (imap) {
            try { await imap.end(); } catch (_) { /* ignore */ }
        }
        if (connection) connection.release();
    }
};

// ================================
// NEW: fetch rows from reports tables
// Route: GET /reports/table/:type
export const getReportsTable = async (req, res) => {
    const { type } = req.params;
    const valid = {
        inbound: 'reports_inbound_calls',
        outbound: 'reports_outbound_calls',
        charges: 'reports_user_charges'
    };
    const table = valid[type];
    if (!table) {
        return res.status(400).json({ success: false, message: 'Invalid report type' });
    }

    let pool, connection;
    try {
        pool = await connectDB();
        connection = await pool.getConnection();

        // Get user information from the request
        const { user } = req;
        let query = `SELECT * FROM \`${table}\``;
        let params = [];
        
        // Debug user info
        logger.info(`Report access by user: ${user.email}, role: ${user.role}, brand_id: ${user.brand_id}, business_center_id: ${user.business_center_id}`);
        
        // Track if we've applied any filters
        let filterApplied = false;
        
        // Filter records based on user role and ID
        if (user && user.role !== 'admin') { // Admin users can see all records
            // First, find the user's extension and team from team_members table if applicable
            let userExtension = null;
            let userTeamId = null;
            let teamMembers = [];
            
            // Try to find the user in team_members table
            const [userRecord] = await connection.query(
                `SELECT * FROM team_members WHERE email = ?`,
                [user.email]
            );
            
            if (userRecord.length > 0) {
                userExtension = userRecord[0].extension;
                userTeamId = userRecord[0].team_id;
                
                logger.info(`Found user in team_members with extension: ${userExtension}, team_id: ${userTeamId}`);
                
                // Get all team members in the same team
                const [teamMembersResult] = await connection.query(
                    `SELECT * FROM team_members WHERE team_id = ?`,
                    [userTeamId]
                );
                
                teamMembers = teamMembersResult;
                logger.info(`Found ${teamMembers.length} team members in team ${userTeamId}`);
                
                // Log all team members for debugging
                if (teamMembers.length > 0) {
                    const teamEmails = teamMembers.map(tm => tm.email).join(', ');
                    logger.info(`Team member emails: ${teamEmails}`);
                }
            } else {
                logger.info(`User ${user.email} not found in team_members table. Checking if they need to be added.`);
                
                // Check if the user exists in other tables that might indicate their team
                // For example, if they're a receptionist, check the receptionist table
                if (user.role === 'receptionist') {
                    const [receptionistRecord] = await connection.query(
                        `SELECT * FROM receptionist WHERE receptionist_email = ?`,
                        [user.email]
                    );
                    
                    if (receptionistRecord.length > 0) {
                        const businessCenterId = receptionistRecord[0].business_center_id;
                        logger.info(`Found user in receptionist table with business_center_id: ${businessCenterId}`);
                        
                        // Find all team members associated with this business center
                        const [businessTeams] = await connection.query(
                            `SELECT * FROM teams WHERE business_center_id = ?`,
                            [businessCenterId]
                        );
                        
                        if (businessTeams.length > 0) {
                            const teamIds = businessTeams.map(team => team.id);
                            logger.info(`Found teams ${teamIds.join(', ')} for business center ${businessCenterId}`);
                            
                            // Get all members from these teams
                            const placeholders = teamIds.map(() => '?').join(',');
                            const [allTeamMembers] = await connection.query(
                                `SELECT * FROM team_members WHERE team_id IN (${placeholders})`,
                                teamIds
                            );
                            
                            teamMembers = allTeamMembers;
                            logger.info(`Found ${teamMembers.length} team members across all business center teams`);
                            
                            // Log all team members for debugging
                            if (teamMembers.length > 0) {
                                const teamEmails = teamMembers.map(tm => tm.email).join(', ');
                                logger.info(`Team member emails: ${teamEmails}`);
                            }
                        }
                    }
                }
            }
            
            // Define common column names for different report types
            const commonColumns = {
                outbound: ['User email', 'User Name', 'Extension'],
                inbound: ['Caller ID Number', 'Callee ID Number'],
                charges: ['user_name', 'extension']
            };
            
            // Determine which columns to check based on report type
            const reportType = type; // 'inbound', 'outbound', or 'charges'
            const columnsToCheck = commonColumns[reportType] || [];
            
            // First try business_center_id for business_admin and receptionist
            if ((user.role === 'business_admin' || user.role === 'receptionist') && user.business_center_id) {
                const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'business_center_id'`);
                logger.info(`Checking for business_center_id column in ${table}: ${columns.length > 0 ? 'found' : 'not found'}`);
                
                if (columns.length > 0) {
                    query += ' WHERE `business_center_id` = ?';
                    params.push(user.business_center_id);
                    filterApplied = true;
                }
            }
            
            // Try brand_id for brand_user
            if (!filterApplied && user.role === 'brand_user' && user.brand_id) {
                const [columns] = await connection.query(`SHOW COLUMNS FROM \`${table}\` LIKE 'brand_id'`);
                logger.info(`Checking for brand_id column in ${table}: ${columns.length > 0 ? 'found' : 'not found'}`);
                
                if (columns.length > 0) {
                    query += ' WHERE `brand_id` = ?';
                    params.push(user.brand_id);
                    filterApplied = true;
                }
            }
            
            // If team members found, filter by extensions of team members
            if (!filterApplied && teamMembers.length > 0) {
                // Check if Extension column exists in the table
                const [extensionColumn] = await connection.query(
                    `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                     WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
                    [table, 'Extension']
                );
                
                if (extensionColumn[0].count > 0 && reportType === 'outbound') {
                    // Get all extensions from team members
                    const extensions = teamMembers
                        .filter(tm => tm.extension)
                        .map(tm => tm.extension);
                    
                    if (extensions.length > 0) {
                        logger.info(`Filtering by extensions of team members: ${extensions.join(', ')}`);
                        
                        // For MySQL, we need to handle the IN clause differently when using prepared statements
                        const placeholders = extensions.map(() => '?').join(',');
                        query += ` WHERE \`Extension\` IN (${placeholders})`;
                        params.push(...extensions);
                        filterApplied = true;
                    }
                } else if (extensionColumn[0].count > 0 && reportType === 'charges') {
                    // For charges table, the column might be lowercase
                    const extensions = teamMembers
                        .filter(tm => tm.extension)
                        .map(tm => tm.extension);
                    
                    if (extensions.length > 0) {
                        logger.info(`Filtering by extensions of team members in charges: ${extensions.join(', ')}`);
                        
                        // For MySQL, we need to handle the IN clause differently when using prepared statements
                        const placeholders = extensions.map(() => '?').join(',');
                        query += ` WHERE \`extension\` IN (${placeholders})`;
                        params.push(...extensions);
                        filterApplied = true;
                    }
                }
                
                // If we couldn't filter by extension, try filtering by emails of team members
                if (!filterApplied) {
                    const [emailColumn] = await connection.query(
                        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
                        [table, 'User email']
                    );
                    
                    if (emailColumn[0].count > 0) {
                        const emails = teamMembers
                            .filter(tm => tm.email)
                            .map(tm => tm.email);
                        
                        if (emails.length > 0) {
                            logger.info(`Filtering by team emails: ${emails.join(', ')}`);
                            
                            // For MySQL, we need to handle the IN clause differently when using prepared statements
                            const placeholders = emails.map(() => '?').join(',');
                            query += ` WHERE \`User email\` IN (${placeholders})`;
                            params.push(...emails);
                            filterApplied = true;
                        }
                    }
                }
                
                // If we still couldn't filter by email, try filtering by User Name
                if (!filterApplied) {
                    const [userNameColumn] = await connection.query(
                        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
                        [table, 'User Name']
                    );
                    
                    if (userNameColumn[0].count > 0) {
                        const usernames = teamMembers
                            .filter(tm => tm.username)
                            .map(tm => tm.username);
                        
                        if (usernames.length > 0) {
                            logger.info(`Filtering by team usernames: ${usernames.join(', ')}`);
                            
                            // For MySQL, we need to handle the IN clause differently when using prepared statements
                            const placeholders = usernames.map(() => '?').join(',');
                            query += ` WHERE \`User Name\` IN (${placeholders})`;
                            params.push(...usernames);
                            filterApplied = true;
                        }
                    }
                }
            }
            
            // If no team-based filters applied, fall back to individual user filtering
            if (!filterApplied) {
                // Try each of the common columns for this report type
                for (const column of columnsToCheck) {
                    // Check if this column exists in the table
                    const [columnExists] = await connection.query(
                        `SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_NAME = ? AND COLUMN_NAME = ?`,
                        [table, column]
                    );
                    
                    if (columnExists[0].count > 0) {
                        logger.info(`Found matching column ${column} in ${table}`);
                        
                        // Different filtering logic based on column type
                        if (column === 'User email') {
                            query += filterApplied ? ' AND ' : ' WHERE ';
                            query += `\`${column}\` = ?`;
                            params.push(user.email);
                            filterApplied = true;
                            break;
                        } 
                        else if (column === 'Extension' && userExtension) {
                            query += filterApplied ? ' AND ' : ' WHERE ';
                            query += `\`${column}\` = ?`;
                            params.push(userExtension);
                            filterApplied = true;
                            break;
                        }
                        else if (column === 'extension' && userExtension) {
                            query += filterApplied ? ' AND ' : ' WHERE ';
                            query += `\`${column}\` = ?`;
                            params.push(userExtension);
                            filterApplied = true;
                            break;
                        }
                        else if (column === 'User Name') {
                            // For User Name, we need to get the user's extension or full name
                            // from the appropriate table based on their role
                            let userInfoQuery;
                            let userInfoParams = [];
                            
                            if (user.role === 'brand_user') {
                                userInfoQuery = 'SELECT brand_name as name FROM brand WHERE brand_email = ?';
                                userInfoParams = [user.email];
                            } else if (user.role === 'business_admin') {
                                userInfoQuery = 'SELECT business_name as name FROM business_center WHERE business_email = ?';
                                userInfoParams = [user.email];
                            } else if (user.role === 'receptionist') {
                                userInfoQuery = 'SELECT receptionist_name as name FROM receptionist WHERE receptionist_email = ?';
                                userInfoParams = [user.email];
                            }
                            
                            if (userInfoQuery) {
                                const [userInfo] = await connection.query(userInfoQuery, userInfoParams);
                                
                                if (userInfo.length > 0) {
                                    if (userInfo[0].name) {
                                        query += filterApplied ? ' AND ' : ' WHERE ';
                                        query += `\`${column}\` = ?`;
                                        params.push(userInfo[0].name);
                                        filterApplied = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            
            // If we've applied a filter, log it
            if (filterApplied) {
                logger.info(`Applied filter: ${query} with params: ${JSON.stringify(params)}`);
            }
        }
        
        // Add ordering and limit
        query += ' ORDER BY `created_at` DESC LIMIT 1000';
        
        logger.info(`Executing query: ${query} with params: ${JSON.stringify(params)}`);
        const [rows] = await connection.query(query, params);
        
        logger.info(`Query returned ${rows.length} rows`);
        
        res.json({ 
            success: true, 
            rows,
            filteredByUser: params.length > 0 // Indicate if results were filtered
        });
    } catch (err) {
        logger.error('Error fetching report table rows:', err);
        if (res && !res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to fetch rows', error: err.message });
        }
    } finally {
        if (connection) connection.release();
    }
};

// Note: to wire this controller, add something like:
// router.get('/reports/fetch', authMiddleware, fetchAndInsertReports);
// Make sure to set REPORT_EMAIL_USER, REPORT_EMAIL_PASS & IMAP_HOST in .env
