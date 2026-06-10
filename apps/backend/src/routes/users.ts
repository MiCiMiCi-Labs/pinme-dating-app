import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getUserById } from '../controllers/users';

const router = Router();

router.use(requireAuth);

// GET /api/v1/users/:id
router.get('/:id', getUserById);

export default router;
