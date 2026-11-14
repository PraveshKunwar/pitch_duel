# Pitch Duel

Requires Node 22+ and Docker.

<iframe width="560" height="315" src="https://www.youtube.com/embed/video-id" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
## Run locally

```bash
git clone git@github.com:PraveshKunwar/pitch_duel.git
cd pitch_duel
cp .env.example .env
docker compose up -d postgres redis
cd server && npm ci && npm run migrate && npm run dev
```

In another terminal:

```bash
cd client && npm ci && npm run dev
```

Open http://localhost:5173
