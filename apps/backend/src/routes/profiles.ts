import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import { getMyProfile, updateMyProfile } from '../controllers/profiles';

const router = Router();

// GET /api/profile/me
// GET /api/v1/profiles/me
router.get('/me', authMiddleware, getMyProfile);

// PUT /api/profile/me
// PUT /api/v1/profiles/me
router.put('/me', authMiddleware, updateMyProfile);

export default router;
