// src/routes/router.js

import express from 'express';
import teamRoutes from './teamRoutes.js';

import {
    searchCustomers,
    getAllCustomers,
    assignCustomerToTeam,
    checkDuplicates,
    getTeamRecords,
    getCustomersByDateRange
} from '../controllers/customers.js';

import { deleteCustomer, deleteMultipleCustomers } from '../controllers/deleteCustomers.js';

import { 
    makeNewRecord, 
    createCustomer, 
    checkExistingCustomer
} from '../controllers/createCustomers.js';

import { updateCustomer, historyCustomer, gethistoryCustomer } from '../controllers/updateCustomers.js';

import { 
    loginAdmin,
    logoutAdmin, 
    fetchCurrentAdmin, forgotPassword, 
    resetPasswordWithToken, resetPassword,
    sendOTP , checkSession 
} from '../controllers/sign.js';

import { getReminders, getAllReminders, getScheduleRecords } from '../controllers/schedule.js';
import { 
    getAllTeams, 
    getTeamsByBusinessId, 
    getTeamByName,
    updateTeam,
    deleteTeam 
} from '../controllers/teams.js';

// import { uploadCustomerData, confirmUpload } from '../controllers/uploadFile.js';
import { downloadCustomerData, getQueueNames } from '../controllers/downloadFile.js';
import { authenticateToken } from '../middlewares/auth.js';
import { checkCustomerByPhone } from '../controllers/newnum.js';

import { sendNewCustomerEmail } from '../controllers/sendEmail.js';

import { 
    sendNewCustomerWhatsApp, sendCustomerNotification
} from '../controllers/sendWhatsapp.js';

import { 
  generateQRCode, 
  getConnectionStatus, 
  resetInstance, 
  saveInstanceToDB, 
  getUserInstances, 
  updateInstance,
  sendMessage 
} from '../controllers/whatsapp.js';

import { validateSession } from '../middlewares/sessionMiddleware.js';

import { createUser, getAllUsers, getTeamMembers, updateTeamMember, deleteTeamMember } from '../controllers/users.js';

import { 
    createBusiness,
    getAllBusinesses,
    getBusinessById,
    updateBusiness,
    deleteBusiness,
    createBusinessTeams, 
    getBusinessTeams, 
    createBusinessAssociate, 
    getBusinessCounts,
    getBusinessCenterTeams
} from '../controllers/roles/businessCenter.js';

import { 
    createBrand,
    getAllBrands,
    getBrandById,
    updateBrand,
    deleteBrand,
    getBrandBusinessCenters,
    getBrandHierarchy,
    getBrandLimits
} from '../controllers/roles/brandCenter.js';

import { 
  createReceptionist,
  getAllReceptionists,
  getReceptionistById,
  updateReceptionist,
  deleteReceptionist
} from '../controllers/roles/receptionist.js';

const router = express.Router();

// Mount team routes
router.use('/team', teamRoutes);

// Add a new route to get all teams
router.get('/teams', authenticateToken, getAllTeams);

// Route for user login
router.post('/login', loginAdmin);

// Route for sending OTP (reset password link)
router.post('/send-otp', sendOTP);

// Route for resetting password with token
router.post('/reset-password/:id/:token', resetPasswordWithToken);

// Route for forgot password
router.post('/forgot-password', forgotPassword);

// Route for resetting password with token
router.post('/reset-password/:token', resetPassword);

// Route for user logout
router.post('/logout', authenticateToken, logoutAdmin);

// Route to check session
router.get('/check-session', validateSession, checkSession);
router.get('/current-user', authenticateToken, fetchCurrentAdmin);

// Team and user management routes
router.post('/users/create', authenticateToken, createUser);
router.get('/users/all', authenticateToken, getAllUsers);
router.get('/players/users', authenticateToken, getAllUsers);
router.get('/players/teams', authenticateToken, getAllTeams);
router.get('/business/:businessId/teams', authenticateToken, getTeamsByBusinessId);
router.get('/business/:businessId/team/:teamId/members', authenticateToken, getTeamMembers);
router.get('/users/team/:teamId', authenticateToken, getTeamMembers);
router.put('/team/:id', authenticateToken, updateTeam);
router.delete('/team/:id', authenticateToken, deleteTeam);

// Team member routes
router.put('/team/member/:memberId', authenticateToken, updateTeamMember);
router.delete('/team/member/:memberId', authenticateToken, deleteTeamMember);

// User routes
router.get('/current-queue', authenticateToken, async (req, res) => {
  try {
    // User information is already attached to req by authenticateToken middleware
    const { username, QUEUE_NAME, role } = req.user;
    res.json({ username, QUEUE_NAME, role });
  } catch (error) {
    console.error('Error fetching queue info:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Customer routes
router.get('/customers', authenticateToken, getAllCustomers);
router.get('/customers/search', authenticateToken, searchCustomers);
router.get('/customers/team', authenticateToken, getAllCustomers);
router.get('/customers/assigned', authenticateToken, getAllCustomers);

// Customer CRUD operations
router.post('/customers/create', authenticateToken, createCustomer);
router.put('/customers/:id', authenticateToken, updateCustomer);
router.delete('/customers/:id', authenticateToken, deleteCustomer);
router.post('/customers/delete-multiple', authenticateToken, deleteMultipleCustomers);

// Customer phone number operations
router.get('/team/:teamName/:phone_no', authenticateToken, checkCustomerByPhone);
router.patch('/customers/phone/:phone_no/updates', authenticateToken, updateCustomer);
router.post('/customers/create/:phone_no', authenticateToken, makeNewRecord);

// Customer history
router.get('/customers/log-change/:id', authenticateToken, gethistoryCustomer);
router.post('/customers/log-change', authenticateToken, historyCustomer);

// Customer reminders
router.get('/customers/reminders', authenticateToken, getReminders);
router.get('/customers/getAllReminders', authenticateToken, getAllReminders);

// Route to assign customers to team/agent
router.post('/customers/assign-team', authenticateToken, assignCustomerToTeam);

// Download routes
router.get('/download/queues', authenticateToken, getQueueNames);
router.get('/download/customers', authenticateToken, downloadCustomerData);

// Route to get customers by date range
router.get('/customers/date-range', authenticateToken, getCustomersByDateRange);

// Route to check duplicates
router.post('/customers/check-duplicates', authenticateToken, checkDuplicates);

// Route to get team records with field mapping
router.post('/records_info', getTeamRecords);

// Route to get schedule records with field mapping
router.post('/records_schedule', getScheduleRecords);

// Route to check existing customer
router.get('/customers/check/:phone/:team', checkExistingCustomer)
;

// Email routes
router.post('/send-customer-email', authenticateToken, sendNewCustomerEmail);

// WhatsApp routes
router.post('/send-whatsapp', authenticateToken, sendNewCustomerWhatsApp);

// router.get('/whatsapp/init', authenticateToken, initWhatsApp);
// router.get('/whatsapp/status', authenticateToken, getStatus);
// router.post('/whatsapp/reset', authenticateToken, resetWhatsApp);
router.get('/whatsapp/init/:instanceId', authenticateToken, validateSession, generateQRCode);
router.get('/whatsapp/status/:instanceId', authenticateToken, validateSession, getConnectionStatus);
router.post('/whatsapp/reset/:instanceId', authenticateToken, validateSession, resetInstance);
router.post('/:instanceId/send-message', authenticateToken, validateSession, sendMessage);

// Instance management routes
router.post('/instances', authenticateToken, validateSession, saveInstanceToDB);
router.get('/instances/:register_id', authenticateToken, validateSession, getUserInstances);
router.put('/instances/:instance_id', authenticateToken, validateSession, updateInstance);

// Brand routes
router.post('/brand', authenticateToken, createBrand);
router.get('/brand', authenticateToken, getAllBrands);
router.get('/brand/limits', authenticateToken, getBrandLimits);
router.get('/brand/:id', authenticateToken, getBrandById);
router.put('/brand/:id', authenticateToken, updateBrand);
router.delete('/brand/:id', authenticateToken, deleteBrand);
router.get('/brand/:brandId/business-centers', authenticateToken, getBrandBusinessCenters);
router.get('/brand/:brandId/hierarchy', authenticateToken, getBrandHierarchy);

// Business center routes
router.post('/business', authenticateToken, createBusiness);
router.get('/business', authenticateToken, getAllBusinesses);
router.get('/business/:id', authenticateToken, getBusinessById);
router.get('/business/:id/counts', authenticateToken, getBusinessCounts);
router.put('/business/:id', authenticateToken, updateBusiness);
router.delete('/business/:id', authenticateToken, deleteBusiness);
router.post('/business/:id/teams', authenticateToken, createBusinessTeams);
router.get('/business/:id/teams', authenticateToken, getBusinessTeams);
router.post('/business/:id/associate', authenticateToken, createBusinessAssociate);

// Receptionist routes
router.post('/receptionist', authenticateToken, createReceptionist);
router.get('/receptionist', authenticateToken, getAllReceptionists);
router.get('/receptionist/:id', authenticateToken, getReceptionistById);
router.put('/receptionist/:id', authenticateToken, updateReceptionist);
router.delete('/receptionist/:id', authenticateToken, deleteReceptionist);

// Business center routes for receptionists
router.get('/business-center/:id/teams', authenticateToken, getBusinessCenterTeams);

export default router;
