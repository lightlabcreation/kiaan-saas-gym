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

// Admin routes
router.post('/', verifyToken(['Admin']), createTicket);
router.get('/my', verifyToken(['Admin']), getMyTickets);

// SuperAdmin routes
router.get('/all', verifyToken(['Superadmin', 'Subadmin']), getAllTickets);
router.get('/counts', verifyToken(['Superadmin', 'Subadmin']), getTicketCounts);

// Shared
router.get('/:id', verifyToken(), getTicketById);
router.post('/:id/reply', verifyToken(), replyToTicket);
router.patch('/:id/status', verifyToken(['Superadmin', 'Subadmin', 'Admin']), updateTicketStatus);

export default router;
