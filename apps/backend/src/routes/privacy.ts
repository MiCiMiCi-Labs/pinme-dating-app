import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getPrivacy, updatePrivacy } from '../controllers/privacy';

const router = Router();

router.use(requireAuth);

// GET /api/v1/privacy/me
router.get('/me', getPrivacy);

// PUT /api/v1/privacy/me   { discoverable?, showDistance?, showOnlineStatus? }
router.put('/me', updatePrivacy);

export default router;
