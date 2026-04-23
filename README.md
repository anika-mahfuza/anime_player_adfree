# AniStream Monorepo

This repo is now split into two deployable apps:

- `frontend/`: static Next.js frontend for Cloudflare Pages
- `backend/`: standalone Node API for Render, Railway, Fly.io, or Vercel

## Local development

1. `cd backend && npm install`
2. `cd frontend && npm install`
3. Frontend local env is `frontend/.env.local` and points to `http://localhost:3001`
4. Backend local env is `backend/.env`
5. From the repo root run `npm run dev:backend`
6. In a second terminal run `npm run dev:frontend`

The frontend expects `NEXT_PUBLIC_API_BASE_URL` to point at the backend.

## Deploy

### Frontend

- Root directory: `frontend`
- Build command: `npm install && npm run build`
- Output directory: `out`
- Environment variable: `NEXT_PUBLIC_API_BASE_URL=https://your-backend-domain`

### Backend

- Root directory: `backend`
- Start command: `npm install && npm run start`
- Health check: `/health`

For Vercel, deploy the `backend/` folder directly. `backend/vercel.json` rewrites all requests to the API entrypoint.
