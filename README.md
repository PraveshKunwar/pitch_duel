# Pitch Duel

Requires Node 22+ and Docker.

<video src="demo.mp4" width="320" height="240" controls></video>
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
