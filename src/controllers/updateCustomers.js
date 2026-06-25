// src/controllers/updateCustomers.js

import connectDB from '../db/index.js';  

export const updateCustomer = async (req, res) => {
    const pool = await connectDB();
    let connection;
    try {
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }
  
      connection = await pool.getConnection();
      await connection.beginTransaction();
  
      const customerId = req.params.id;
      const updates = req.body;
  
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No valid updates provided.' });
      }
  
      // Get the current customer details with a lock to prevent concurrent updates
      const [customerRows] = await connection.execute(
        'SELECT * FROM customers WHERE id = ? FOR UPDATE NOWAIT',
        [customerId]
      );
  
      if (customerRows.length === 0) {
        return res.status(404).json({ error: 'Customer not found.' });
      }
  
      const customer = customerRows[0];
      const cUniqueId = customer.C_unique_id;
      let newTeamId = customer.team_id; // Default to existing team_id

      // If QUEUE_NAME is being updated, validate it first
      if (updates.QUEUE_NAME && updates.QUEUE_NAME !== customer.QUEUE_NAME) {
        const [teamRows] = await connection.execute(
          'SELECT id FROM teams WHERE team_name = ?',
          [updates.QUEUE_NAME]
        );
        if (teamRows.length === 0) {
          await connection.rollback();
          return res.status(400).json({ 
            error: 'Invalid team name provided.',
            details: `Team '${updates.QUEUE_NAME}' does not exist.`
          });
        }
        newTeamId = teamRows[0].id; // Capture the new team_id
      }

      // Define allowed fields and their types
      const allowedFields = {
        first_name: 'string',
        middle_name: 'string',
        last_name: 'string',
        phone_no_primary: 'number',
        phone_no_secondary: 'number',
        whatsapp_num: 'number',
        email_id: 'string',
        date_of_birth: 'date',
        gender: 'string',
        address: 'string',
        country: 'string',
        company_name: 'string',
        designation: 'string',
        website: 'string',
        other_location: 'string',
        contact_type: 'string',
        source: 'string',
        disposition: 'string',
        QUEUE_NAME: 'string',
        agent_name: 'string',
        comment: 'string',
        scheduled_at: 'datetime'
      };

      // Helper function to normalize date values
      const normalizeDateValue = (value, type) => {
        if (!value) return null;
        
        if (type === 'date') {
          try {
            const date = new Date(value);
            if (isNaN(date.getTime())) return value;
            // Convert to IST by adding 5 hours and 30 minutes
            date.setHours(date.getHours() + 5);
            date.setMinutes(date.getMinutes() + 30);
            return date.toISOString().slice(0, 10);
          } catch (e) {
            return value;
          }
        }
        
        if (type === 'datetime') {
          try {
            const date = new Date(value);
            if (isNaN(date.getTime())) return value;
            // Convert to IST by adding 5 hours and 30 minutes
            date.setHours(date.getHours() + 5);
            date.setMinutes(date.getMinutes() + 30);
            return date.toISOString().slice(0, 19).replace('T', ' ');
          } catch (e) {
            return value;
          }
        }
        
        return value;
      };

      // Check for recent updates to prevent duplicate entries
      const fieldToUpdate = Object.keys(updates)[0];
      const newValue = normalizeDateValue(Object.values(updates)[0], allowedFields[fieldToUpdate] || 'string');
      
      const [recentUpdates] = await connection.execute(
        `SELECT * FROM updates_customer 
         WHERE customer_id = ? 
         AND field = ?
         AND new_value = ?
         AND updated_at >= DATE_SUB(NOW(), INTERVAL 5 SECOND)`,
        [customerId, fieldToUpdate, newValue]
      );
  
      if (recentUpdates.length > 0) {
        await connection.rollback();
        return res.status(409).json({ 
          message: 'This exact update was just made to this record. Please try again.',
          details: 'Duplicate update prevented'
        });
      }

      // Process only the fields that are actually changing
      const fieldsToUpdate = [];
      const updateValues = [];
      const updateLogs = [];

      for (const [field, newValue] of Object.entries(updates)) {
        // Skip if field is not in allowed list
        if (!allowedFields[field]) continue;

        const fieldType = allowedFields[field];
        const oldValue = customer[field];
        const normalizedNewValue = normalizeDateValue(newValue, fieldType);
        const normalizedOldValue = normalizeDateValue(oldValue, fieldType);

        // Skip if values are equal after normalization
        if (normalizedNewValue === normalizedOldValue) continue;
        if (!normalizedNewValue && !normalizedOldValue) continue;

        fieldsToUpdate.push(`${field} = ?`);
        updateValues.push(normalizedNewValue);
        updateLogs.push({
          field,
          oldValue: normalizedOldValue,
          newValue: normalizedNewValue
        });
      }

      // Only proceed if there are actual changes
      if (fieldsToUpdate.length > 0) {
        // Add last_updated to the update
        fieldsToUpdate.push('last_updated = NOW()');
        
        // Update the customers table first
        const updateQuery = `UPDATE customers SET ${fieldsToUpdate.join(', ')} WHERE id = ?`;
        updateValues.push(customerId);
        await connection.execute(updateQuery, updateValues);

        // If the scheduled_at field was updated, create a corresponding scheduler record
        const schedChange = updateLogs.find(l => l.field === 'scheduled_at');
        if (schedChange) {
          // Prevent duplicate scheduler entries for the exact same datetime
          const [existing] = await connection.execute(
            `SELECT id FROM scheduler WHERE customer_id = ? AND scheduled_at = ? LIMIT 1`,
            [customerId, schedChange.newValue]
          );
          if (existing.length === 0) {
            await connection.execute(
              `INSERT INTO scheduler (customer_id, C_unique_id, scheduled_at, status, created_by, team_id, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                customerId,
                cUniqueId,
                schedChange.newValue,
                'pending',
                req.user.username,
                newTeamId,
                'Follow-up call'
              ]
            );
          }
        }

        // Log the changes using the insertChangeLog function
        await insertChangeLog(connection, customerId, cUniqueId, updateLogs, req.user.username, newTeamId);

        await connection.commit();

        res.status(200).json({ 
          message: 'Customer details updated successfully.',
          updatedFields: updateLogs.map(log => log.field),
          customerId,
          C_unique_id: cUniqueId
        });
      } else {
        await connection.rollback();
        res.status(400).json({ 
          message: 'No changes were made.',
          details: 'All provided values were identical to current values'
        });
      }

    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Error updating customer details:', error);
      res.status(500).json({ 
        error: 'Failed to update customer details.',
        details: error.message 
      });
    } finally {
      if (connection) {
        connection.release();
      }
    }
};

// **************

// Function to insert change log entries
export const insertChangeLog = async (connection, customerId, C_unique_id, changes, username, teamId) => {
  try {
    // Ensure all required fields are present
    if (!customerId || !username || !teamId) {
      throw new Error('Missing required fields for change log');
    }

    // Insert each change as a separate record
    for (const change of changes) {
      const query = `
        INSERT INTO updates_customer (
          customer_id, C_unique_id, field, 
          old_value, new_value, updated_by, 
          updated_at, team_id
        ) VALUES (?, ?, ?, ?, ?, ?, CONVERT_TZ(NOW(), 'UTC', 'Asia/Kolkata'), ?)
      `;

      const params = [
        customerId,
        C_unique_id || null,
        change.field || null,
        change.oldValue || null,
        change.newValue || null,
        username,
        teamId
      ];

      await connection.execute(query, params);
    }
  } catch (error) {
    console.error('Error inserting change log:', error);
    throw error;
  }
};

export const historyCustomer = async (req, res) => {
  try {
    // Check if user exists in request
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const connection = await connectDB();
    const { customerId, C_unique_id, changes } = req.body;

    // Validate required fields
    if (!customerId || !changes || !Array.isArray(changes)) {
      return res.status(400).json({ 
        message: 'Missing required fields',
        required: ['customerId', 'changes (array)'],
        received: req.body
      });
    }

    // First get the customer to check authorization
    const [customer] = await connection.execute(
      'SELECT agent_name FROM customers WHERE id = ?',
      [customerId]
    );

    if (customer.length === 0) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    // Check authorization
    if (req.user.role !== 'super_admin' && req.user.role !== 'business_head' && req.user.role !== 'team_leader' && customer[0].agent_name !== req.user.username) {
      return res.status(403).json({ 
        message: 'You are not authorized to log changes for this customer',
        user: req.user,
        customerAgent: customer[0].agent_name
      });
    }

    // Insert the changes
    await insertChangeLog(
      connection,
      customerId,
      C_unique_id,
      changes,
      req.user.username
    );

    res.status(200).json({ 
      message: 'Changes logged successfully',
      changeCount: changes.length
    });
  } catch (error) {
    console.error('Error logging changes:', error);
    res.status(500).json({ 
      message: 'Failed to log changes', 
      error: error.message,
      user: req.user
    });
  }
};


// Function to fetch change history for a customer
const getChangeHistory = async (connection, customerId) => {
  const fetchHistoryQuery = `
    SELECT * FROM updates_customer 
    WHERE customer_id = ? 
    ORDER BY updated_at DESC, id DESC`;

  const [changeHistory] = await connection.execute(fetchHistoryQuery, [customerId]);
  return changeHistory;
};

// Main function to handle logging and fetching change history
export const gethistoryCustomer = async (req, res) => {
    try {
        // Check if user exists in request
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        const connection = await connectDB();
        const { customerId, C_unique_id, changes } = req.body;

        // Validate required fields
        if (!customerId || !changes || !Array.isArray(changes)) {
            return res.status(400).json({ 
                message: 'Missing required fields',
                required: ['customerId', 'changes (array)'],
                received: req.body
            });
        }

        // First get the customer to check authorization
        const [customer] = await connection.execute(
            'SELECT agent_name, team_id FROM customers WHERE id = ?',
            [customerId]
        );

        if (customer.length === 0) {
            return res.status(404).json({ message: 'Customer not found' });
        }

        // Check authorization
        if (req.user.role !== 'super_admin' && req.user.role !== 'business_head' && req.user.role !== 'team_leader' && customer[0].agent_name !== req.user.username) {
            return res.status(403).json({ 
                message: 'You are not authorized to log changes for this customer',
                user: req.user,
                customerAgent: customer[0].agent_name
            });
        }

        // Log changes using the insertChangeLog function
        await insertChangeLog(connection, customerId, C_unique_id, changes, req.user.username, customer[0].team_id);

        // Fetch and return the updated history
        const history = await getChangeHistory(connection, customerId);

        res.status(200).json({
            message: 'Change history updated successfully',
            history
        });

    } catch (error) {
        console.error('Error in gethistoryCustomer:', error);
        res.status(500).json({ 
            error: 'Failed to process request',
            details: error.message
        });
    }
};
