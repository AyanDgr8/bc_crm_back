// src/controllers/deleteCustomer.js

import connectDB from '../db/index.js';  


// Function to delete from the updates_customer table
const deleteCustomerUpdates = async (connection, customerId) => {
    const deleteUpdatesQuery = `
      DELETE FROM updates_customer 
      WHERE customer_id = ?`;
  
    await connection.execute(deleteUpdatesQuery, [customerId]);
  };
  
  // Function to delete from the customers table
  const deleteCustomerRecord = async (connection, customerId) => {
    const deleteCustomerQuery = `
      DELETE FROM customers 
      WHERE id = ?`;
  
    await connection.execute(deleteCustomerQuery, [customerId]);
  };
  
  // Combined function to handle deleting a customer and associated updates
  export const deleteCustomer = async (req, res) => {
    const customerId = req.params.id;  // Assuming customerId is passed as a URL parameter
    let connection;
  
    try {
      // Check if user exists in request
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }

      // Check for delete_customer permission
      if (!req.user.permissions || !req.user.permissions.includes('delete_customer')) {
        return res.status(403).json({ message: 'You do not have permission to delete customers' });
      }

      if (!customerId || isNaN(customerId)) {
        return res.status(400).json({ message: 'Valid Customer ID is required' });
      }
  
      const pool = await connectDB();
      connection = await pool.getConnection();
      await connection.beginTransaction();
  
      // Delete from updates_customer table first to ensure relational integrity
      await deleteCustomerUpdates(connection, customerId);
  
      // Then delete from customers table
      await deleteCustomerRecord(connection, customerId);
  
      await connection.commit();
      res.status(200).json({ success: true, message: 'Customer deleted successfully!' });
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Error deleting customer and updates:', error);
      res.status(500).json({ message: 'Failed to delete customer and updates' });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  };
  
  // Function to delete multiple customers
  export const deleteMultipleCustomers = async (req, res) => {
    const { customerIds } = req.body;
    let connection;
  
    try {
      // Check if user exists and has appropriate role
      if (!req.user) {
        return res.status(401).json({ message: 'Authentication required' });
      }
  
      if (req.user.role === 'user') {
        return res.status(403).json({ message: 'Insufficient permissions' });
      }
  
      if (!Array.isArray(customerIds) || customerIds.length === 0) {
        return res.status(400).json({ message: 'Invalid customer IDs provided' });
      }
  
      const pool = await connectDB();
      connection = await pool.getConnection();
      await connection.beginTransaction();
  
      // Delete customer updates and records for each customer
      for (const customerId of customerIds) {
        await deleteCustomerUpdates(connection, customerId);
        await deleteCustomerRecord(connection, customerId);
      }
  
      await connection.commit();
      res.json({ success: true, message: `Successfully deleted ${customerIds.length} customers` });
  
    } catch (error) {
      if (connection) {
        await connection.rollback();
      }
      console.error('Error in deleteMultipleCustomers:', error);
      res.status(500).json({ message: 'Failed to delete customers' });
    } finally {
      if (connection) {
        connection.release();
      }
    }
  };