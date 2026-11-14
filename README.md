# Pitch Duel

Requires Node 22+ and Docker.

## Demo

<video src="./demo.mp4" controls width="720" title="Pitch Duel demo">
  <a href="./demo.mp4">Watch the demo (MP4)</a>
</video>

[Watch demo.mp4](./demo.mp4)

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
