import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createSwipe } from '../controllers/swipes';

const router = Router();

router.use(requireAuth);

// POST /api/v1/swipes  { targetId, action: LIKE | DISLIKE | SUPER_LIKE }
router.post('/', createSwipe);

export default router;
