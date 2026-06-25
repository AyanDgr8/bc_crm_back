// src/routes/reportRoutes.js

import express from 'express';
import { fetchAndInsertReports, getReportsTable } from '../controllers/reports.js';
import { handleExtensionWebhook, handleTeamExtensionWebhook } from '../controllers/reportWebhook.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// GET /api/reports/fetch – fetch CSV e-mails and insert into DB
router.get('/reports/fetch', authenticateToken, fetchAndInsertReports);
router.get('/reports/table/:type', authenticateToken, getReportsTable);

router.post('/reports/webhook', handleExtensionWebhook);
router.post('/reports/team-webhook', handleTeamExtensionWebhook);

export default router;

