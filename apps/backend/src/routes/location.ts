import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { upsertLocation } from '../controllers/location';

const router = Router();

router.use(requireAuth);

// PUT /api/v1/location/me   { latitude, longitude, city? }
router.put('/me', upsertLocation);

export default router;
