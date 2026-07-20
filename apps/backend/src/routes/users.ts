import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { deleteAccount, getUserById, heartbeat } from '../controllers/users';

const router = Router();

router.use(requireAuth);

// POST /api/v1/users/heartbeat
router.post('/heartbeat', heartbeat);

// DELETE /api/v1/users/me
router.delete('/me', deleteAccount);

// GET /api/v1/users/:id
router.get('/:id', getUserById);

export default router;
