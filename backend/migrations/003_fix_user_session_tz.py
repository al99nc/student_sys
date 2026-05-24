import sqlite3
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "students_db.sqlite")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

tables = [r[0] for r in cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]

if "user_sessions" not in tables:
    print("user_sessions table does not exist — nothing to migrate.")
    conn.close()
    sys.exit(0)

rows = cursor.execute(
    "SELECT id, user_id, token_hash, ip_address, user_agent, created_at, last_seen_at, expires_at FROM user_sessions"
).fetchall()

cursor.execute("DROP TABLE user_sessions")

cursor.execute("""
    CREATE TABLE user_sessions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        created_at TEXT,
        last_seen_at TEXT,
        expires_at TEXT NOT NULL
    )
""")

for row in rows:
    id_, user_id, token_hash, ip_address, user_agent, created_at, last_seen_at, expires_at = row

    for field_name, value in ("created_at", created_at), ("last_seen_at", last_seen_at), ("expires_at", expires_at):
        if value and "+" not in value and "Z" not in value and "z" not in value:
            value = value.replace(" ", "T")
            if "." not in value:
                value += "+00:00"
            else:
                value += "+00:00"
        if field_name == "created_at":
            created_at = value
        elif field_name == "last_seen_at":
            last_seen_at = value
        else:
            expires_at = value

    cursor.execute(
        "INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (id_, user_id, token_hash, ip_address, user_agent, created_at, last_seen_at, expires_at),
    )

conn.commit()
conn.close()
print(f"Migrated {len(rows)} user_sessions rows.")
