import sqlite3
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "students_db.sqlite")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

if "bot_sessions" not in tables:
    print("bot_sessions table does not exist — nothing to migrate.")
    conn.close()
    sys.exit(0)

# Read existing data
rows = cursor.execute("SELECT id, chat_id, email, jwt, state, expires_at, created_at FROM bot_sessions").fetchall()

# Drop old table
cursor.execute("DROP TABLE bot_sessions")

# Recreate with TEXT type for timezone-aware datetime storage
cursor.execute("""
    CREATE TABLE bot_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id VARCHAR(32) UNIQUE,
        email VARCHAR NOT NULL,
        jwt VARCHAR,
        state VARCHAR(20) NOT NULL DEFAULT 'waiting_email',
        expires_at TEXT NOT NULL,
        created_at TEXT
    )
""")

# Re-insert with timezone-aware ISO format
for row in rows:
    id_, chat_id, email, jwt, state, expires_at, created_at = row
    # expires_at was stored as naive ISO string (e.g. "2024-01-01 12:00:00.123456")
    # Convert to aware ISO format
    if expires_at:
        if "+" not in expires_at and "Z" not in expires_at and "z" not in expires_at:
            expires_at = expires_at.replace(" ", "T")
            if "." not in expires_at:
                expires_at += "+00:00"
            else:
                expires_at += "+00:00"
    if created_at:
        if "+" not in created_at and "Z" not in created_at and "z" not in created_at:
            created_at = created_at.replace(" ", "T")
            if "." not in created_at:
                created_at += "+00:00"
            else:
                created_at += "+00:00"

    cursor.execute(
        "INSERT INTO bot_sessions (id, chat_id, email, jwt, state, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (id_, chat_id, email, jwt, state, expires_at, created_at),
    )

conn.commit()
conn.close()
print(f"Migrated {len(rows)} bot_sessions rows.")
