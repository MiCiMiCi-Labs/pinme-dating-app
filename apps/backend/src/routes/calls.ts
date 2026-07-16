import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import {
  registerVoipDevice,
  unregisterVoipDevice,
  startCall,
  getIncomingCalls,
  getActiveCall,
  getCall,
  getCallLiveKitToken,
  acceptCall,
  declineCall,
  cancelCall,
  endCall,
  failCall,
} from '../controllers/callSessions';

const router = Router();
router.use(requireAuth);

router.post('/devices', registerVoipDevice);
router.delete('/devices/:token', unregisterVoipDevice);

router.get('/incoming', getIncomingCalls);
// Must be registered before GET /:callId — otherwise Express would match
// "active" as a :callId value (same literal-segment-matching pitfall noted
// for /:callId/livekit-token vs the old /:matchId/token).
router.get('/active', getActiveCall);
router.post('/:matchId/start', startCall);
router.get('/:callId', getCall);
router.post('/:callId/livekit-token', getCallLiveKitToken);
router.post('/:callId/accept', acceptCall);
router.post('/:callId/decline', declineCall);
router.post('/:callId/cancel', cancelCall);
router.post('/:callId/end', endCall);
router.post('/:callId/fail', failCall);

export default router;
