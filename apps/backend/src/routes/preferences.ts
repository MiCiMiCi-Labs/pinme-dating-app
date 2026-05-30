import { Router } from 'express';
import { authMiddleware } from '../middleware/auth';
import {
  getMyPreferences,
  updateMyPreferences,
} from '../controllers/preferences';

const router = Router();

// GET /api/preferences/me
// GET /api/v1/preferences/me
router.get('/me', authMiddleware, getMyPreferences);

// PUT /api/preferences/me
// PUT /api/v1/preferences/me
router.put('/me', authMiddleware, updateMyPreferences);

export default router;
