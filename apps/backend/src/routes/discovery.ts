import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getDiscoveryFeed } from '../controllers/discovery';

const router = Router();

router.use(requireAuth);

// GET /api/discovery
// GET /api/v1/discovery
router.get('/', getDiscoveryFeed);

export default router;
