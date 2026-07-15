import { Router } from 'express';
import { getChats } from '../controllers/chats';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// GET /api/v1/chats
router.get('/', getChats);

export default router;
