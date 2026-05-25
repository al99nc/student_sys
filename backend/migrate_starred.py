import os
from sqlalchemy import create_engine, text

DATABASE_URL = "postgresql://postgres:123456@localhost:5432/student_sys"

engine = create_engine(DATABASE_URL)

def migrate():
    cols = [
        ("is_starred", "BOOLEAN DEFAULT FALSE"),
        ("source_text", "TEXT"),
    ]
    for col_name, col_type in cols:
        with engine.connect() as conn:
            print(f"Checking for {col_name} column in flashcards table...")
            try:
                conn.execute(text(f"ALTER TABLE flashcards ADD COLUMN {col_name} {col_type};"))
                conn.commit()
                print(f"Successfully added {col_name} column.")
            except Exception as e:
                if "already exists" in str(e):
                    print(f"Column {col_name} already exists.")
                else:
                    print(f"Error adding column {col_name}: {e}")

if __name__ == "__main__":
    migrate()
