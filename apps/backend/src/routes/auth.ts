import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getCurrentUser, syncCurrentUser } from '../controllers/auth';

const router = Router();

// POST /api/auth/sync
// POST /api/v1/auth/sync
router.post('/sync', authMiddleware, syncCurrentUser);

// GET /api/auth/me
// GET /api/v1/auth/me
router.get('/me', authMiddleware, getCurrentUser);

export default router;
