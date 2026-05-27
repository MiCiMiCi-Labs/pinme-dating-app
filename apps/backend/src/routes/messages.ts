import { Router } from 'express';

// GET  /api/v1/messages/:matchId          (paginated)
// POST /api/v1/messages/:matchId          (send message)
// POST /api/v1/messages/:matchId/read     (mark all as read)

const router = Router();

export default router;
