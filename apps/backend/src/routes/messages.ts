import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  getMessages,
  markMessagesRead,
  sendMessage,
} from '../controllers/messages';

const router = Router();

router.use(requireAuth);

// GET /api/v1/messages/:matchId?limit=50&before=2026-05-30T00:00:00.000Z
router.get('/:matchId', getMessages);

// POST /api/v1/messages/:matchId  { content, messageType?: TEXT | IMAGE | GIF }
router.post('/:matchId', sendMessage);

// POST /api/v1/messages/:matchId/read
router.post('/:matchId/read', markMessagesRead);

export default router;
