# AniStream Monorepo

AniStream is a split frontend/backend anime streaming app built around a Next.js client and a standalone Node API.

The frontend handles discovery, anime details, search, continue watching, and the watch/player UI.  
The backend handles AniList proxying, homepage aggregation, stream extraction from Anitaku/Gogo, HLS proxying, and skip-time resolution.

## Repo Structure

- `frontend/`
  Next.js app router frontend
- `backend/`
  standalone Node HTTP API
- `package.json`
  root convenience scripts for running both apps

## High-Level Architecture

The app is intentionally split into two pieces:

1. `frontend`
   renders pages, keeps watch progress in local storage, loads anime metadata, and embeds the player.
2. `backend`
   acts as the server-side integration layer for third-party services that are better handled off the client.

That split exists for a few reasons:

- AniList requests can be cached server-side
- stream extraction should not live in the browser
- HLS playlist rewriting and media proxying need a backend
- skip-time provider requests are easier to normalize server-side
- deployment is more flexible because frontend and backend can be hosted separately

## Main User Flow

### Homepage

The homepage lives in `frontend/app/page.js`.

It shows:

- continue watching
- airing right now
- trending this week
- other discovery shelves

How it works:

1. The page first tries a small critical payload for hero + top shelves.
2. It then loads secondary shelves in the background.
3. If AniList fetches fail, it can fall back to Jikan for a degraded but usable homepage.
4. Continue watching is read from local storage using `frontend/hooks/useWatchProgress.js`.

Important behavior:

- homepage cache label is based on a 15 minute cache window
- homepage cards open the dedicated anime details page
- continue watching cards skip details and go straight to the watch page

### Anime Details Page

The dedicated details page lives in `frontend/app/anime/page.jsx`.

This page is the "professional site" middle step between discovery and playback.

It shows:

- title, cover, banner, score, format, status, episode count, duration, studio, genres
- long description
- `Play Now` or `Continue from Episode X`
- a `Seasons` section built from watch-order relations
- similar recommendations

The seasons block is not just direct sequels. It uses the same watch-sequence helper as the watch page, so it can include:

- seasons
- prequels
- sequels
- OVAs
- movies
- specials / side stories / spin-offs when AniList relations expose them

### Watch Page

The watch page lives in `frontend/app/watch/page.jsx`.

This page is focused on playback and episode navigation.

Layout after the player:

1. anime details
2. episodes list
3. seasons/watch-order entries

The episode picker is intentionally at the bottom instead of a side drawer.

How watch page loading works:

1. AniList metadata is loaded for the anime id.
2. Jikan episode data is loaded by MAL id for episode titles and episode counts.
3. The stream URL is requested from the backend.
4. The player starts with the resolved HLS stream.
5. Once the real video duration is known, skip times are requested from the backend using that real duration.

Important detail:

- skip times are no longer fetched with rough estimated durations first
- the page waits for the actual stream duration before asking for skip markers
- this avoids wrong early/late intro/outro buttons caused by different episode cuts

### Search Page

The search page lives in `frontend/app/search/page.jsx`.

It queries anime metadata through the backend AniList proxy and routes normal card clicks to the anime details page.

## Routing

Current main routes:

- `/`
- `/home`
- `/homepage`
- `/search`
- `/anime?id=<anilistId>`
- `/watch?id=<anilistId>`
- `/continue-watching`

Additional polished app routes:

- `frontend/app/not-found.jsx`
  custom not found UI
- `frontend/app/error.jsx`
  custom runtime error UI

Shared route helpers live in `frontend/lib/routes.js`.

## Frontend Internals

### API Base Resolution

Frontend API URL logic lives in `frontend/lib/apiBase.js`.

It supports two important cases:

1. local desktop use
   `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001`
2. phone/LAN testing
   if the site is opened from another device, a localhost API base is rewritten to the page's current hostname while keeping port `3001`

That is why Android can open the frontend on `http://your-pc-ip:3000` and still reach the backend even if the env file still says `localhost:3001`.

### Continue Watching

Continue watching logic lives in `frontend/hooks/useWatchProgress.js`.

It stores progress in local storage under a single key and keeps:

- current episode
- season id
- total episodes
- per-episode watch positions
- per-episode durations
- update timestamp

That powers:

- homepage continue watching
- resume prompts
- resume from timestamp in the player

### Player

The player component lives in `frontend/components/AnimePlayer.jsx`.

It uses:

- `artplayer`
- `hls.js`

The player handles:

- HLS playback
- quality selection
- intro/outro skip buttons
- progress bar markers
- resume from previous position
- next episode autoplay
- periodic progress saving

Skip buttons are driven entirely by skip metadata, not by anything scraped from the stream host itself.

## Backend Internals

### API Entry

The backend entry point is:

- `backend/server.js`
- `backend/src/app.js`

The backend currently exposes:

- `POST /api/anilist`
- `GET /api/home`
- `GET /api/stream`
- `GET /api/hls`
- `GET /api/skip-times`
- `GET /health`

The backend listens on `0.0.0.0`, which allows LAN/mobile access during development.

### AniList Proxy

AniList proxy logic lives in `backend/src/anilist.js`.

It exists to:

- avoid pushing all AniList traffic directly from the client
- add short-lived caching
- normalize timeouts and errors

Current cache behavior:

- search-like queries: about 3 minutes
- homepage-style multi-page queries: about 15 minutes
- other page queries: about 5 minutes

### Homepage Aggregation

Homepage aggregation lives in `backend/src/home.js`.

This endpoint builds a richer homepage payload than a single raw AniList query.

It:

- caches the full homepage payload for 15 minutes
- fetches airing schedule data from AniList
- fetches multiple shelves in parallel
- builds a better `airing` list using actual schedule episode numbers

This is why the homepage can show sections like "Airing Right Now" with more useful episode data.

### Stream Extraction

Stream extraction logic lives in `backend/src/stream.js`.

This is one of the most important backend pieces.

What it does:

1. receives anime title + episode + optional metadata hints
2. searches Anitaku/Gogo with multiple title variants
3. scores candidate results
4. fetches the chosen category page
5. extracts episode links
6. opens the episode page
7. extracts available server URLs
8. resolves the final playable stream URL
9. returns that URL to the frontend

The matching logic uses more than title alone. It also scores against:

- release year
- format
- total episode count
- duration
- season markers in the title

That extra scoring is there to reduce wrong matches for sequels, split cours, movies, and similarly named entries.

Important limitation:

- the scraper does not provide intro/outro timestamps
- it only resolves the actual video source

### HLS Proxy

HLS proxy logic lives in `backend/src/hls.js`.

This endpoint:

- fetches master/media playlists
- rewrites nested playlist and segment URLs back through `/api/hls`
- forwards media requests with the correct referer/origin headers

This is what makes the extracted stream usable inside the frontend player without the browser directly dealing with all upstream restrictions.

### Skip Times

Skip-time logic lives in `backend/src/skip-times.js`.

Current provider order:

1. AniSkip
2. Anime Skip

How it works:

1. the frontend sends MAL id, AniList id, episode number, and the real video duration
2. the backend tries AniSkip first
3. if needed, it tries safe fallback related ids only
4. if AniSkip still fails, it tries Anime Skip by AniList id
5. the backend normalizes the returned timestamps to fit the actual stream duration

That last step matters because provider data and the scraped stream can be based on different episode cuts.

Current normalization strategy:

- intro-like segments stay anchored near the start
- outro-like segments stay anchored near the end
- mid-episode segments like recap can be scaled

This is why skip markers remain more accurate even when provider episode length and actual stream length do not exactly match.

Also important:

- unsafe fallback ids such as unrelated relation types are filtered out
- this prevents borrowing skip times from the wrong anime

## External Data Sources

This project currently uses these upstream sources:

- AniList
  metadata, relations, recommendations, search, airing data
- Jikan
  fallback lists and episode titles/count pages
- Anitaku / Gogo
  stream discovery and episode source extraction
- AniSkip
  intro/outro/recap timestamps
- Anime Skip
  secondary skip-time provider

## Local Development

Install dependencies:

1. `npm install`
2. `npm --prefix backend install`
3. `npm --prefix frontend install`

Run locally in two terminals:

1. `npm run dev:backend`
2. `npm run dev:frontend`

Frontend local env:

`frontend/.env.local`

Example:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

Backend local env:

`backend/.env`

Optional envs can be added there if needed later.

## Build Commands

Root shortcuts:

- `npm run build:frontend`
- `npm run build:backend`
- `npm run lint:frontend`

Direct package scripts:

- `npm --prefix frontend run dev`
- `npm --prefix frontend run build`
- `npm --prefix backend run dev`
- `npm --prefix backend run start`
- `npm --prefix backend run build`

## Deployment

### Frontend

Recommended:

- deploy `frontend/` separately
- set root directory to `frontend`
- set `NEXT_PUBLIC_API_BASE_URL` to the deployed backend URL

### Backend

Recommended:

- deploy `backend/` separately
- use `npm run start`
- expose `/health` for health checks

The backend is suitable for services like:

- Render
- Railway
- Fly.io
- Vercel

## Why The App Is Structured This Way

This codebase is trying to balance three different needs:

1. fast anime discovery UI
2. a backend capable of stream extraction and proxying
3. a player experience that feels closer to a full anime streaming site

That is why the app has:

- a separate details page before playback
- local continue-watching state
- route aliases and custom error pages
- server-side cached AniList access
- stream extraction and HLS rewriting on the backend
- skip-time provider normalization based on real stream duration

## Known Constraints

- stream sources depend on third-party hosts and can break if upstream markup changes
- skip times depend on external providers and are not guaranteed for every anime
- some brand new shows may have no skip data yet
- exact skip accuracy can still vary if a provider and the actual stream use very different cuts

## Summary

In short:

- AniList powers metadata and discovery
- Jikan fills some gaps and fallback cases
- Anitaku/Gogo provides stream discovery
- the backend turns all of that into frontend-safe APIs
- the frontend turns it into a homepage, details page, watch page, and resume flow

That is the current end-to-end architecture of the app.
