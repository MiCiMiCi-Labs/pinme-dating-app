import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getCallToken } from '../controllers/calls';

const router = Router();
router.post('/:matchId/token', requireAuth, getCallToken);
export default router;
