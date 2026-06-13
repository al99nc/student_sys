import sqlite3
import os
import sys

# Add the backend directory to sys.path so we can import settings
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))
try:
    from app.core.config import settings
except ImportError:
    print("Could not import settings, falling back to default students.db")
    class MockSettings:
        DATABASE_URL = "sqlite:///./students.db"
    settings = MockSettings()

def migrate():
    db_url = settings.DATABASE_URL
    if not db_url.startswith("sqlite:///"):
        print(f"Skipping migration: DATABASE_URL is not SQLite ({db_url})")
        return

    db_path = db_url.replace("sqlite:///", "")
    # Handle relative paths if needed, assuming we run from backend root or scripts dir
    if not os.path.isabs(db_path):
        # Try to find it relative to backend root
        backend_root = os.path.join(os.path.dirname(__file__), "..")
        potential_path = os.path.join(backend_root, db_path)
        if os.path.exists(potential_path):
            db_path = potential_path
        else:
            print(f"Database file not found at {potential_path}")
            # If it doesn't exist, SQLAlchemy might create it later, but we can't migrate it now.
            # However, the user said it's a "real database", so it should exist.
            # Let's check the current working directory too.
            if os.path.exists(db_path):
                db_path = os.path.abspath(db_path)
            else:
                print(f"Database file not found at {db_path} either.")
                return

    print(f"Migrating database at: {db_path}")
    
    # Try common sqlite names if it's the 0-byte default one
    if os.path.basename(db_path) == "students.db" and os.path.getsize(db_path) == 0:
        alt_path = os.path.join(os.path.dirname(db_path), "students_db.sqlite")
        if os.path.exists(alt_path):
            print(f"Detected 0-byte students.db, switching to {alt_path}")
            db_path = alt_path

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # Check if column exists
        cursor.execute("PRAGMA table_info(lectures)")
        columns = [row[1] for row in cursor.fetchall()]
        
        if "study_time_seconds" not in columns:
            print("Adding column 'study_time_seconds' to 'lectures' table...")
            cursor.execute("ALTER TABLE lectures ADD COLUMN study_time_seconds INTEGER DEFAULT 0")
            conn.commit()
            print("Migration successful.")
        else:
            print("Column 'study_time_seconds' already exists.")

    except sqlite3.OperationalError as e:
        print(f"Error during migration: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    migrate()
