ALTER TABLE tickets RENAME TO tickets_old;

-- 2. создаём новую с pin TEXT
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pin TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'NEW',
  attempts INTEGER DEFAULT 0,
  terminal_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (terminal_id) REFERENCES terminals(id)
);

-- 3. переносим активные тикеты
INSERT INTO tickets (pin, amount, status, attempts, terminal_id, created_at)
SELECT pin, amount, status, attempts, terminal_id, created_at
FROM tickets_old;

-- 4. удаляем старую
DROP TABLE tickets_old;