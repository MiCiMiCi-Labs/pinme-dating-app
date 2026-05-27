import { Router } from 'express';

// POST /api/v1/swipes        { targetId, action: LIKE | DISLIKE | SUPER_LIKE }
// GET  /api/v1/swipes/feed   (paginated candidate list)

const router = Router();

export default router;
