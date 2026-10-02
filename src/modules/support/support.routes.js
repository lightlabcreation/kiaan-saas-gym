import { Router } from 'express';
import { verifyToken } from '../../middlewares/auth.js';
import {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketById,
  replyToTicket,
  updateTicketStatus,
  getTicketCounts
} from './support.controller.js';

const router = Router();

// Admin / Staff / Housekeeping routes
router.post('/', verifyToken(['Admin', 'receptionist', 'RECEPTIONIST', 'manager', 'MANAGER', 'sales_agent', 'SALES_AGENT', 'personaltrainer', 'PERSONALTRAINER', 'generaltrainer', 'GENERALTRAINER', 'Staff', 'STAFF', 'housekeeping', 'HOUSEKEEPING']), createTicket);
router.get('/my', verifyToken(['Admin', 'receptionist', 'RECEPTIONIST', 'manager', 'MANAGER', 'sales_agent', 'SALES_AGENT', 'personaltrainer', 'PERSONALTRAINER', 'generaltrainer', 'GENERALTRAINER', 'Staff', 'STAFF', 'housekeeping', 'HOUSEKEEPING']), getMyTickets);

// SuperAdmin routes
router.get('/all', verifyToken(['Superadmin', 'Subadmin', 'SUPERADMIN', 'SUBADMIN']), getAllTickets);
router.get('/counts', verifyToken(['Superadmin', 'Subadmin', 'SUPERADMIN', 'SUBADMIN']), getTicketCounts);

// Shared
router.get('/:id', verifyToken(), getTicketById);
router.post('/:id/reply', verifyToken(), replyToTicket);
router.patch('/:id/status', verifyToken(['Superadmin', 'Subadmin', 'SUPERADMIN', 'SUBADMIN', 'Admin', 'ADMIN']), updateTicketStatus);

export default router;
