import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getMatches, unmatch } from '../controllers/matches';
import {
  getCallPreference,
  updateCallPreference,
  createCallInvitation,
} from '../controllers/callPreference';

const router = Router();

router.use(requireAuth);

// GET /api/v1/matches
router.get('/', getMatches);

// DELETE /api/v1/matches/:matchId  (soft delete via unmatchedAt)
router.delete('/:matchId', unmatch);

// Private 1:1 voice calling authorization (see docs/private-voice-calling-spec.md)
router.get('/:matchId/call-preference', getCallPreference);
router.put('/:matchId/call-preference', updateCallPreference);
router.post('/:matchId/call-invitation', createCallInvitation);

export default router;
