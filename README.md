<p align="center">
  <img src="docs/screenshots/logo.png" width="96" alt="PinMe logo" />
</p>

<h1 align="center">PinMe</h1>
<p align="center"><em>Pin your heart. Meet your person.</em></p>

<p align="center">
  A location-based dating app with swipe matching, real-time chat, private voice calling,
  live voice rooms, and AI/vision-assisted safety features.
</p>

---

## Overview

PinMe is a full-stack dating app built as a monorepo: an Expo/React Native client and a
Node/Express API backed by PostgreSQL. It covers the full dating-app loop — discovery,
matching, chat — plus a few things most portfolio dating apps skip: **native 1:1 voice
calling with CallKit/VoIP push, live group voice rooms, AWS-verified profile photos, and
AI-generated reply suggestions.**

## Screenshots

<table>
  <tr>
    <td><img src="docs/screenshots/discover.jpg" width="220" alt="Discover / swipe" /></td>
    <td><img src="docs/screenshots/filters.jpg" width="220" alt="Discovery filters" /></td>
    <td><img src="docs/screenshots/matches.jpg" width="220" alt="Matches" /></td>
    <td><img src="docs/screenshots/messages.jpg" width="220" alt="Messages list" /></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/chat.jpg" width="220" alt="Chat with voice messages and call history" /></td>
    <td><img src="docs/screenshots/voice-call.jpg" width="220" alt="In-app voice call" /></td>
    <td><img src="docs/screenshots/callkit-lockscreen.jpg" width="220" alt="Native iOS CallKit incoming call" /></td>
    <td><img src="docs/screenshots/profile.jpg" width="220" alt="Profile completion" /></td>
  </tr>
</table>

## Features

- **Discovery & matching** — swipe cards with distance/age/gender filters, mutual-match
  detection, and a "who liked you" queue.
- **Real-time chat** — text, images, GIFs, and voice messages, with typing/read state and
  reply-to threading.
- **AI reply assistant** — tone-selectable (warm / playful / curious) reply suggestions
  generated from conversation context via Groq's LLM API.
- **Private 1:1 voice calling** — LiveKit-powered calls with native iOS CallKit integration
  and VoIP push (APNs) so incoming calls ring like a real phone call, even from the
  background/killed state.
- **Voice rooms** — multi-participant live audio rooms (drop-in voice chat, not 1:1),
  with host controls and mic/speaker toggling.
- **Photo verification** — first profile photo is checked with AWS Rekognition for content
  moderation and face detection before it's accepted.
- **Flexible auth** — Supabase-backed sign-in via Apple, Google, Facebook, or phone OTP.
- **Privacy controls** — block/report, discoverability toggle, and distance-hiding.

## Tech stack

**Mobile** — React Native (Expo SDK 54), Expo Router, TypeScript, React Query,
LiveKit React Native SDK, react-native-callkeep + VoIP push for native calling.

**Backend** — Node.js, Express, TypeScript, Prisma ORM, PostgreSQL.

**Platform services** — Supabase (Auth, Postgres hosting, Storage), LiveKit (voice
infrastructure), AWS Rekognition (photo moderation/face verification), Groq (LLM reply
suggestions), Apple Push Notification service (VoIP + standard push).

## Monorepo layout

```
apps/
  mobile/    Expo/React Native client
  backend/   Express API + Prisma schema
docs/        Feature specs, screenshots
```

## Getting started

```bash
npm install

# Backend (needs a .env — see apps/backend/.env.example)
npm run backend

# Mobile (needs a dev client build — this app uses native modules,
# so it won't run in plain Expo Go)
npm run mobile
```
