import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getCurrentUser, syncCurrentUser } from '../controllers/auth';

const router = Router();

router.post('/sync', authMiddleware, syncCurrentUser);
router.get('/me', authMiddleware, getCurrentUser);

export default router;
