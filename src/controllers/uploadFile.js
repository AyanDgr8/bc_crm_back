// // src/controllers/uploadFile.js

// import connectDB from '../db/index.js';
// import { v4 as uuid } from 'uuid';

// // Use a Map to store upload data temporarily
// const uploadDataStore = new Map();

// // Helper function to format date
// const formatDate = (dateStr) => {
//     if (!dateStr) return null;
    
//     // Convert to string and trim
//     const strDate = String(dateStr).trim();
//     if (!strDate) return null;

//     try {
//         // First try to handle Excel date number (days since December 30, 1899)
//         const numericDate = Number(strDate.replace(/[^0-9]/g, ''));
//         if (!isNaN(numericDate)) {
//             // Excel date starting point (December 30, 1899)
//             const excelEpoch = new Date(1899, 11, 30);
//             const date = new Date(excelEpoch.getTime() + (numericDate * 24 * 60 * 60 * 1000));
            
//             // Validate the resulting date
//             if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
//                 return date.toISOString().slice(0, 10);
//             }
//         }

//         // Try DD/MM/YYYY format
//         const parts = strDate.split('/');
//         if (parts.length === 3) {
//             const day = parseInt(parts[0], 10);
//             const month = parseInt(parts[1], 10);
//             const year = parseInt(parts[2], 10);

//             if (day > 0 && day <= 31 && 
//                 month > 0 && month <= 12 && 
//                 year >= 2000 && year <= 2100) {
//                 const paddedDay = day.toString().padStart(2, '0');
//                 const paddedMonth = month.toString().padStart(2, '0');
//                 return `${year}-${paddedMonth}-${paddedDay}`;
//             }
//         }

//         // Try parsing as regular date string
//         const date = new Date(strDate);
//         if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= 2100) {
//             return date.toISOString().slice(0, 10);
//         }

//         console.warn(`Invalid date format for value: ${strDate}`);
//         return null;
//     } catch (error) {
//         console.error(`Error formatting date: ${strDate}`, error);
//         return null;
//     }
// };

// export const uploadCustomerData = async (req, res) => {
//     try {
//         const { headerMapping, customerData } = req.body;

//         if (!headerMapping || typeof headerMapping !== 'object' || Object.keys(headerMapping).length === 0) {
//             return res.status(400).json({ message: 'Invalid header mapping provided' });
//         }

//         if (!Array.isArray(customerData) || customerData.length === 0) {
//             return res.status(400).json({ message: 'customerData must be a non-empty array.' });
//         }

//         const pool = await connectDB();
//         const connection = await pool.getConnection();

//         try {
//             await connection.beginTransaction();

//             // Get valid agent usernames from users table
//             const [userResults] = await connection.query(
//                 'SELECT username, team_id FROM users'
//             );
            
//             if (userResults.length === 0) {
//                 return res.status(400).json({ 
//                     message: 'No users found in the system.' 
//                 });
//             }

//             // Create a map of valid usernames and their team_ids
//             const validAgents = new Map(userResults.map(user => [user.username, user.team_id]));

//             // Check for duplicates first
//             const duplicates = [];
//             const newRecords = [];
//             const invalidAgentRecords = [];

//             // Process each record
//             for (const record of customerData) {
//                 const phone = record[headerMapping['phone_no_primary']];
//                 const email = record[headerMapping['email_id']];
//                 const firstName = record[headerMapping['first_name']];
//                 const agentName = record[headerMapping['agent_name']];

//                 // Skip empty records
//                 if (!firstName || !phone || !agentName) {
//                     continue;
//                 }

//                 // Check if agent exists
//                 if (!validAgents.has(agentName)) {
//                     invalidAgentRecords.push({
//                         record,
//                         error: `Invalid agent name: ${agentName}`
//                     });
//                     continue;
//                 }

//                 // Build duplicate check query
//                 const duplicateQuery = `
//                     SELECT * FROM customers 
//                     WHERE (phone_no_primary = ? OR (? IS NOT NULL AND email_id = ?))
//                     AND first_name = ?
//                 `;

//                 const queryParams = [
//                     phone,
//                     email,
//                     email,
//                     firstName
//                 ];

//                 const [existingRecords] = await connection.query(duplicateQuery, queryParams);

//                 if (existingRecords.length > 0) {
//                     duplicates.push({
//                         new_record: record,
//                         existing_record: existingRecords[0],
//                         agent_name: agentName,
//                         team_id: validAgents.get(agentName)
//                     });
//                 } else {
//                     newRecords.push({
//                         ...record,
//                         agent_name: agentName,
//                         team_id: validAgents.get(agentName)
//                     });
//                 }
//             }

//             // If there are invalid agents, return error
//             if (invalidAgentRecords.length > 0) {
//                 await connection.rollback();
//                 return res.status(400).json({
//                     success: false,
//                     message: 'Invalid agent names found',
//                     invalidRecords: invalidAgentRecords
//                 });
//             }

//             // Generate a unique upload ID
//             const uploadId = uuid();
            
//             // Store the processed data with agent information
//             uploadDataStore.set(uploadId, {
//                 newRecords,
//                 duplicates,
//                 headerMapping,
//                 validAgents: Object.fromEntries(validAgents)
//             });

//             await connection.commit();

//             res.json({
//                 success: true,
//                 message: 'Upload processed successfully',
//                 duplicates: duplicates.map(d => ({
//                     new_record: d.new_record,
//                     existing_record: d.existing_record,
//                     agent_name: d.agent_name
//                 })),
//                 duplicateCount: duplicates.length,
//                 totalRecords: customerData.length,
//                 uniqueRecords: newRecords.length,
//                 uploadId
//             });

//         } catch (error) {
//             await connection.rollback();
//             throw error;
//         } finally {
//             connection.release();
//         }

//     } catch (error) {
//         console.error('Error processing upload:', error);
//         res.status(500).json({ 
//             success: false,
//             message: 'Failed to process upload',
//             error: error.message
//         });
//     }
// };

// export const confirmUpload = async (req, res) => {
//     let connection;
//     let recordsUploaded = 0;
    
//     try {
//         const { uploadId, proceed, duplicateActions } = req.body;

//         if (!uploadId) {
//             return res.status(400).json({ 
//                 success: false,
//                 message: 'Upload ID is required' 
//             });
//         }

//         if (!proceed) {
//             uploadDataStore.delete(uploadId);
//             return res.json({ 
//                 success: true,
//                 message: 'Upload cancelled',
//                 recordsUploaded: 0
//             });
//         }

//         const uploadData = uploadDataStore.get(uploadId);
//         if (!uploadData) {
//             return res.status(404).json({ 
//                 success: false,
//                 message: 'Upload data not found or expired. Please try uploading again.' 
//             });
//         }

//         const { duplicates = [], newRecords = [], headerMapping } = uploadData;
//         const pool = await connectDB();
//         connection = await pool.getConnection();

//         await connection.beginTransaction();

//         // Process new records first
//         if (newRecords && newRecords.length > 0) {
//             // Get the latest C_unique_id
//             const [lastIdResult] = await connection.query(
//                 'SELECT C_unique_id FROM customers ORDER BY CAST(SUBSTRING(C_unique_id, 4) AS UNSIGNED) DESC LIMIT 1'
//             );
            
//             const lastId = lastIdResult[0]?.C_unique_id || 'MC_0';
//             const lastNumericPart = parseInt(lastId.split('_')[1]) || 0;
//             let nextId = lastNumericPart + 1;

//             // First, get all column names in order
//             const [columns] = await connection.query('SHOW COLUMNS FROM customers');
//             const columnNames = columns.map(col => col.Field)
//                 .filter(name => !['id', 'date_created', 'last_updated', 'scheduled_at'].includes(name));

//             const insertQuery = `INSERT INTO customers (${columnNames.join(', ')}) VALUES ?`;

//             const values = newRecords.map(record => {
//                 const values = [];
//                 columnNames.forEach(colName => {
//                     if (colName === 'C_unique_id') {
//                         values.push(`MC_${nextId++}`);
//                     } else {    
//                         const value = colName === 'date_of_birth' 
//                             ? formatDate(record[headerMapping[colName]])
//                             : record[headerMapping[colName]] || null;
//                         values.push(value);
//                     }
//                 });
//                 return values;
//             });

//             const [insertResult] = await connection.query(insertQuery, [values]);
//             recordsUploaded += insertResult.affectedRows;
//         }

//         // Handle duplicate records based on individual actions
//         if (duplicates && duplicates.length > 0) {
//             for (const [index, duplicate] of duplicates.entries()) {
//                 const action = duplicateActions[index] || 'skip';
//                 if (action === 'skip') continue;

//                 const record = duplicate.new_record;
//                 const existingRecord = duplicate.existing_record;
                
//                 if (action === 'append') {
//                     // Get the base C_unique_id from the existing record
//                     const baseId = existingRecord.C_unique_id.split('__')[0]; // Get the base part before any __
                    
//                     // Find all records with this base ID to determine next suffix
//                     const [suffixResults] = await connection.query(
//                         'SELECT C_unique_id FROM customers WHERE C_unique_id LIKE ? OR C_unique_id = ? ORDER BY CAST(SUBSTRING_INDEX(C_unique_id, "__", -1) AS UNSIGNED) DESC LIMIT 1',
//                         [`${baseId}__%`, baseId]
//                     );
                    
//                     let newCUniqueId;
//                     if (suffixResults.length === 0 || suffixResults[0].C_unique_id === baseId) {
//                         // No suffixed records exist yet
//                         newCUniqueId = `${baseId}__1`;
//                     } else {
//                         // Get the highest suffix and increment
//                         const currentId = suffixResults[0].C_unique_id;
//                         const currentSuffix = parseInt(currentId.split('__')[1]);
//                         newCUniqueId = `${baseId}__${currentSuffix + 1}`;
//                     }

//                     // Get column names
//                     const [columns] = await connection.query('SHOW COLUMNS FROM customers');
//                     const columnNames = columns.map(col => col.Field)
//                         .filter(name => !['id', 'date_created', 'last_updated', 'scheduled_at'].includes(name));

//                     const insertQuery = `INSERT INTO customers (${columnNames.join(', ')}) VALUES (${columnNames.map(() => '?').join(', ')})`;
                    
//                     const values = columnNames.map(colName => {
//                         if (colName === 'C_unique_id') {
//                             return newCUniqueId;
//                         } else {
//                             const value = colName === 'date_of_birth'
//                                 ? formatDate(record[headerMapping[colName]])
//                                 : record[headerMapping[colName]] || null;
//                             return value;
//                         }
//                     });

//                     const [insertResult] = await connection.query(insertQuery, values);
//                     recordsUploaded += insertResult.affectedRows;

//                 } else if (action === 'replace') {
//                     // Get column names for update
//                     const [columns] = await connection.query('SHOW COLUMNS FROM customers');
//                     const columnNames = columns.map(col => col.Field)
//                         .filter(name => !['id', 'C_unique_id', 'date_created', 'last_updated', 'scheduled_at'].includes(name));

//                     const updateQuery = `UPDATE customers SET ${
//                         columnNames.map(col => `${col} = ?`).join(', ')
//                     } WHERE phone_no_primary = ? AND first_name = ?`;

//                     const values = columnNames.map(colName => {
//                         const value = colName === 'date_of_birth'
//                             ? formatDate(record[headerMapping[colName]])
//                             : record[headerMapping[colName]] || null;
//                         return value;
//                     });

//                     // Add WHERE clause values
//                     values.push(record[headerMapping['phone_no_primary']]);
//                     values.push(record[headerMapping['first_name']]);

//                     const [updateResult] = await connection.query(updateQuery, values);
//                     recordsUploaded += updateResult.affectedRows;
//                 }
//             }
//         }

//         await connection.commit();
//         uploadDataStore.delete(uploadId);

//         res.status(200).json({ 
//             success: true,
//             message: `Successfully processed ${recordsUploaded} records`,
//             recordsUploaded
//         });
        
//     } catch (error) {
//         console.error('Error in confirmUpload:', error);
        
//         if (connection) {
//             try {
//                 await connection.rollback();
//             } catch (rollbackError) {
//                 console.error('Error rolling back transaction:', rollbackError);
//             }
//         }

//         res.status(500).json({ 
//             success: false,
//             message: 'Failed to process upload confirmation',
//             error: error.message
//         });
//     } finally {
//         if (connection) {
//             try {
//                 connection.release();
//             } catch (releaseError) {
//                 console.error('Error releasing connection:', releaseError);
//             }
//         }
//     }
// };