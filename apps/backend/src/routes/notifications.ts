import { Router } from 'express';
import { registerPushToken } from '../controllers/notifications';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// POST /api/v1/notifications/register-token
router.post('/register-token', registerPushToken);

export default router;
