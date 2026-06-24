import { Router } from 'express';
import { generateReplySuggestions } from '../controllers/ai';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

// POST /api/v1/ai/reply-suggestions { matchId, tone?: warm | playful | curious }
router.post('/reply-suggestions', generateReplySuggestions);

export default router;
