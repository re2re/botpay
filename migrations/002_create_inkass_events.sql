CREATE TABLE IF NOT EXISTS terminals (
  id       INTEGER PRIMARY KEY,
  enabled  INTEGER NOT NULL DEFAULT 1,
  balance  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inkass_events (
  terminal_id  INTEGER    NOT NULL,
  created_at   INTEGER    NOT NULL,
  status       TEXT       NOT NULL DEFAULT 'new',
  PRIMARY KEY (terminal_id, created_at)
);
