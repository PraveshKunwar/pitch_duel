CREATE TABLE matches (
  id BIGSERIAL PRIMARY KEY,
  game_id UUID NOT NULL UNIQUE,
  player1_id BIGINT NOT NULL REFERENCES users(id),
  player2_id BIGINT NOT NULL REFERENCES users(id),
  winner_id BIGINT REFERENCES users(id),
  rating_delta INT,
  status TEXT NOT NULL CHECK (status IN ('active', 'finished', 'abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  CHECK (player1_id <> player2_id),
  CHECK (winner_id IS NULL OR winner_id IN (player1_id, player2_id)),
  CHECK (
    status <> 'finished'
    OR (winner_id IS NOT NULL AND rating_delta IS NOT NULL AND ended_at IS NOT NULL)
  )
);

CREATE INDEX matches_player1_idx ON matches (player1_id, started_at DESC);
CREATE INDEX matches_player2_idx ON matches (player2_id, started_at DESC);

CREATE TABLE match_rounds (
  match_id BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  round_no SMALLINT NOT NULL CHECK (round_no BETWEEN 1 AND 5),
  stat TEXT NOT NULL CHECK (stat IN ('attack', 'defending', 'passing')),
  card1_id TEXT NOT NULL,
  card2_id TEXT NOT NULL,
  winner_id BIGINT NOT NULL REFERENCES users(id),
  PRIMARY KEY (match_id, round_no)
);
