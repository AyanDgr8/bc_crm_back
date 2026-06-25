// src/controllers/newnum.js

import connectDB from '../db/index.js';

// Function to check if customer exists by phone number
export const checkCustomerByPhone = async (req, res) => {
  const { phone_no_primary, teamName } = req.params;

  console.log('Received request params:', { phone_no_primary, teamName });

  try {
    // Establish database connection
    const connection = await connectDB();

    // Query to check if customer exists with both phone and team
    const query = 'SELECT * FROM customers WHERE phone_no_primary = ? AND QUEUE_NAME = ?';
    const values = [phone_no_primary, teamName];
    
    console.log('Executing query:', {
      query,
      values,
      phone_no_primary: typeof phone_no_primary,
      teamName: typeof teamName
    });
    
    const [rows] = await connection.execute(query, values);
    
    console.log('Query results:', {
      rowCount: rows?.length,
      firstRow: rows?.[0]
    });

    // If customer exists, return their data
    if (rows && rows.length > 0) {
      console.log('Customer found, sending response');
      res.status(200).json({
        exists: true,
        customer: rows[0],
        message: 'Customer found'
      });
    } else {
      console.log('No customer found, sending 404');
      res.status(404).json({
        exists: false,
        message: 'Customer not found',
        params: { phone_no_primary, teamName }
      });
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      exists: false,
      message: 'Failed to check customer',
      error: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
};

export const insertPrimaryNum = async(req, res)=>{
  const { phone_no_primary } = req.params;

  console.log('Received request params:', { phone_no_primary });

  try {
    // Establish database connection
    const connection = await connectDB();

    // Query to check if customer exists
    const query = 'INSERT INTO customers (phone_no_primary) VALUES (?)';
    const values = [phone_no_primary];
    
    console.log('Executing query:', {
      query,
      values,
      phone_no_primary: typeof phone_no_primary
    });
    
    const [rows] = await connection.execute(query, values);
    
    console.log('Query results:', {
      rowCount: rows?.affectedRows,
      insertId: rows?.insertId
    });

    // If customer exists, return their data
    if (rows && rows.affectedRows > 0) {
      console.log('Customer inserted, sending response');
      res.status(200).json({
        exists: true,
        message: 'Customer inserted',
        insertId: rows.insertId
      });
    } else {
      console.log('Failed to insert customer, sending 500');
      res.status(500).json({
        exists: false,
        message: 'Failed to insert customer',
        error: 'Insertion failed'
      });
    }
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({
      exists: false,
      message: 'Failed to insert customer',
      error: error.message
    });
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch (err) {
        console.error('Error closing connection:', err);
      }
    }
  }
};
