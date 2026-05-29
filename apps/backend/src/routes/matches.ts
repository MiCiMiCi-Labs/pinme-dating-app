import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getMatches, unmatch } from '../controllers/matches';

const router = Router();

router.use(requireAuth);

// GET /api/v1/matches
router.get('/', getMatches);

// DELETE /api/v1/matches/:matchId  (soft delete via unmatchedAt)
router.delete('/:matchId', unmatch);

export default router;
