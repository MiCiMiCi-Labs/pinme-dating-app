import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createReport } from '../controllers/reports';

const router = Router();

router.use(requireAuth);

// POST /api/v1/reports   { reportedId, reason, description? }
router.post('/', createReport);

export default router;
