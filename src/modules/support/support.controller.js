import { pool } from '../../config/db.js';
import { dispatchNotification } from '../../utils/notificationDispatcher.js';
import { notifySuperAdmin } from '../notifications/notif.service.js';
import { uploadToCloudinary } from '../../config/cloudinary.js';

export const createTicket = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { subject, category, priority, message } = req.body;
    if (!subject || (!message && (!req.files || (!req.files.image && !req.files.attachment && !req.files.file)))) {
      return res.status(400).json({ success: false, message: 'Subject and message or photo required.' });
    }
    
    const [admins] = await pool.query('SELECT fullName, email, gymName, phone FROM user WHERE id = ?', [adminId]);
    if (!admins.length) return res.status(404).json({ success: false, message: 'Admin not found.' });
    const admin = admins[0];
    const ticketNumber = 'TKT-' + Date.now() + '-' + adminId;

    let attachmentUrl = null;
    if (req.files && (req.files.image || req.files.attachment || req.files.file)) {
      const fileToUpload = req.files.image || req.files.attachment || req.files.file;
      try {
        attachmentUrl = await uploadToCloudinary(fileToUpload, 'support/tickets');
      } catch (err) {
        console.error("❌ Cloudinary upload error on ticket create:", err.message);
      }
    }

    const [result] = await pool.query(
      `INSERT INTO support_ticket (adminId, adminName, adminEmail, gymName, ticketNumber, subject, category, priority, status, attachmentUrl, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, NOW(), NOW())`,
      [adminId, admin.fullName || '', admin.email || '', admin.gymName || '', ticketNumber, subject, category || 'General', priority || 'Medium', attachmentUrl]
    );
    const ticketId = result.insertId;
    await pool.query(
      'INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, attachmentUrl, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
      [ticketId, adminId, 'Admin', message || '', attachmentUrl]
    );

    const attachmentNotice = attachmentUrl ? `\n\n📷 Attachment Image:\n${attachmentUrl}` : '';

    // 1. Email confirmation to Admin who raised ticket
    dispatchNotification({
      category: 'support_ticket_created',
      toEmail: admin.email,
      toPhone: admin.phone || null,
      toUserId: adminId,
      softwareName: admin.gymName || 'Gym Management',
      subject: `Support Ticket #${ticketNumber} Created - ${admin.gymName || 'Gym Management'}`,
      message: `Hello ${admin.fullName || 'Admin'},\n\nYour support ticket has been successfully created.\n\nTicket Details:\nTicket ID: #${ticketNumber}\nSoftware: ${admin.gymName || 'Gym Management'}\nSubject: ${subject}\nCategory: ${category || 'General'}\nPriority: ${priority || 'Medium'}\n\nIssue Description:\n${message || 'Photo attached'}${attachmentNotice}\n\nOur support team will review and get back to you shortly.\n\nThank you,\nKiaan Technology Pvt Ltd`,
      isSystemEvent: true,
      customChannels: ['EMAIL', 'IN_APP']
    }).catch(err => console.error("❌ Email to Admin failed on ticket create:", err.message));

    // 2. Email & In-App Notification to SuperAdmin
    notifySuperAdmin(
      `🚨 New Support Ticket Alert!\n\nAdmin Name: ${admin.fullName || 'Admin'}\nAdmin Email: ${admin.email}\nSoftware: ${admin.gymName || 'Gym Management'}\nTicket ID: #${ticketNumber}\nSubject: ${subject}\nCategory: ${category || 'General'}\nPriority: ${priority || 'Medium'}\nCreated Date/Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n\nIssue Description:\n${message || 'Photo attached'}${attachmentNotice}\n\nDashboard Link: https://gym-newss.kiaantechnology.com/superadmin/support`,
      "NEW_SUPPORT_TICKET",
      { subject: `New Support Ticket #${ticketNumber} - ${admin.gymName || 'Gym Management'}`, targetEmail: 'support@kiaantechnology.com' }
    ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket create:", err.message));

    return res.json({ success: true, message: 'Ticket created.', ticketId, ticketNumber, attachmentUrl });
  } catch (err) { console.error(err); return res.status(500).json({ success: false, message: err.message }); }
};

export const getMyTickets = async (req, res) => {
  try {
    const adminId = req.user.id;
    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE adminId = ? ORDER BY updatedAt DESC', [adminId]);
    return res.json({ success: true, tickets });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getAllTickets = async (req, res) => {
  try {
    const { status, priority } = req.query;
    let query = 'SELECT * FROM support_ticket WHERE 1=1';
    const params = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (priority) { query += ' AND priority = ?'; params.push(priority); }
    query += ' ORDER BY updatedAt DESC';
    const [tickets] = await pool.query(query, params);
    const formattedTickets = tickets.map(t => ({ ...t, imageUrl: t.imageUrl || t.attachmentUrl }));
    return res.json({ success: true, tickets: formattedTickets });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getTicketById = async (req, res) => {
  try {
    const { id } = req.params;
    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const [replies] = await pool.query('SELECT * FROM support_ticket_reply WHERE ticketId = ? ORDER BY createdAt ASC', [id]);
    
    const formattedTicket = { ...tickets[0], imageUrl: tickets[0].imageUrl || tickets[0].attachmentUrl };
    const formattedReplies = replies.map(r => ({
      ...r,
      imageUrl: r.imageUrl || r.attachmentUrl
    }));

    return res.json({ success: true, ticket: formattedTicket, replies: formattedReplies });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const replyToTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const senderId = req.user.id;
    const senderRole = req.user.role || 'Admin';
    if (!message && (!req.files || (!req.files.image && !req.files.attachment && !req.files.file))) {
      return res.status(400).json({ success: false, message: 'Message or photo required.' });
    }

    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const ticket = tickets[0];

    let attachmentUrl = null;
    if (req.files && (req.files.image || req.files.attachment || req.files.file)) {
      const fileToUpload = req.files.image || req.files.attachment || req.files.file;
      try {
        attachmentUrl = await uploadToCloudinary(fileToUpload, 'support/replies');
      } catch (err) {
        console.error("❌ Cloudinary upload error on ticket reply:", err.message);
      }
    }

    await pool.query(
      'INSERT INTO support_ticket_reply (ticketId, senderId, senderRole, message, attachmentUrl, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
      [id, senderId, senderRole, message || '', attachmentUrl]
    );
    
    const isSuperAdmin = (senderRole || '').toLowerCase().includes('superadmin') || (senderRole || '').toLowerCase().includes('subadmin');
    const newStatus = isSuperAdmin ? 'Replied' : ticket.status;
    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [newStatus, id]);

    const softwareTitle = ticket.gymName || 'Gym Management';
    const attachmentNotice = attachmentUrl ? `\n\n📷 Attachment Image:\n${attachmentUrl}` : '';

    if (isSuperAdmin) {
      // SuperAdmin replied -> Send Email to Admin
      dispatchNotification({
        category: 'support_ticket_replied',
        toEmail: ticket.adminEmail,
        toUserId: ticket.adminId,
        softwareName: softwareTitle,
        subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`,
        message: `Hello ${ticket.adminName || 'Admin'},\n\nYour support ticket has been updated by our support team.\n\nTicket:\n#${ticket.ticketNumber}\n\nIssue:\n${ticket.subject}\n\nResponse:\n${message || 'Photo attached'}${attachmentNotice}\n\nStatus:\n${newStatus}\n\nYou can view the complete ticket from your dashboard:\nhttps://gym-newss.kiaantechnology.com/admin/support\n\nThank you,\nKiaan Technology Pvt Ltd`,
        isSystemEvent: true,
        customChannels: ['EMAIL', 'IN_APP']
      }).catch(err => console.error("❌ Email to Admin failed on ticket reply:", err.message));
    } else {
      // Admin replied -> Send Email to SuperAdmin
      notifySuperAdmin(
        `📩 Admin Reply on Support Ticket #${ticket.ticketNumber}\n\nAdmin Name: ${ticket.adminName || 'Admin'}\nAdmin Email: ${ticket.adminEmail}\nSoftware: ${softwareTitle}\nSubject: ${ticket.subject}\nStatus: ${newStatus}\n\nAdmin Response:\n${message || 'Photo attached'}${attachmentNotice}\n\nDashboard Link: https://gym-newss.kiaantechnology.com/superadmin/support`,
        "TICKET_REPLY",
        { subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`, targetEmail: 'support@kiaantechnology.com' }
      ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket reply:", err.message));
    }

    return res.json({ success: true, message: 'Reply sent.', attachmentUrl });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const updateTicketStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['Open', 'Replied', 'Closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });

    const [tickets] = await pool.query('SELECT * FROM support_ticket WHERE id = ?', [id]);
    if (!tickets.length) return res.status(404).json({ success: false, message: 'Ticket not found.' });
    const ticket = tickets[0];

    await pool.query('UPDATE support_ticket SET status = ?, updatedAt = NOW() WHERE id = ?', [status, id]);

    const isClosed = status === 'Closed';
    const statusText = isClosed ? 'Closed / Resolved' : status;
    const softwareTitle = ticket.gymName || 'Gym Management';

    // Email to Admin
    dispatchNotification({
      category: 'support_ticket_status',
      toEmail: ticket.adminEmail,
      toUserId: ticket.adminId,
      softwareName: softwareTitle,
      subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`,
      message: `Hello ${ticket.adminName || 'Admin'},\n\nYour support ticket status has been updated.\n\nTicket:\n#${ticket.ticketNumber}\n\nIssue:\n${ticket.subject}\n\nStatus:\n${statusText}\n\nYou can view the complete ticket from your dashboard:\nhttps://gym-newss.kiaantechnology.com/admin/support\n\nThank you,\nKiaan Technology Pvt Ltd`,
      isSystemEvent: true,
      customChannels: ['EMAIL', 'IN_APP']
    }).catch(err => console.error("❌ Email to Admin failed on ticket status update:", err.message));

    // Email to SuperAdmin
    notifySuperAdmin(
      `🔔 Support Ticket Status Alert!\n\nTicket ID: #${ticket.ticketNumber}\nAdmin Name: ${ticket.adminName || 'Admin'}\nSoftware: ${softwareTitle}\nSubject: ${ticket.subject}\nNew Status: ${statusText}\nUpdated At: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`,
      "TICKET_STATUS_UPDATE",
      { subject: `Support Ticket #${ticket.ticketNumber} Updated - ${softwareTitle}`, targetEmail: 'support@kiaantechnology.com' }
    ).catch(err => console.error("❌ Email to SuperAdmin failed on ticket status update:", err.message));

    return res.json({ success: true, message: 'Status updated.' });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};

export const getTicketCounts = async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT COUNT(*) as total, SUM(status='Open') as open_count, SUM(status='Replied') as replied_count, SUM(status='Closed') as closed_count FROM support_ticket`);
    return res.json({ success: true, counts: rows[0] });
  } catch (err) { return res.status(500).json({ success: false, message: err.message }); }
};
