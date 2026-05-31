import sys
import getpass
import bcrypt
from sqlalchemy import text
from app.db.database import SessionLocal
from app.models.models import User

def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def create_admin():
    print("--- CortexQ Admin Creation Tool ---")
    email = input("Enter admin email: ").strip().lower()
    if not email:
        print("Email is required.")
        return

    password = getpass.getpass("Enter admin password: ")
    confirm = getpass.getpass("Confirm password: ")

    if password != confirm:
        print("Passwords do not match.")
        return
    
    if len(password) < 8:
        print("Password too short (min 8 chars).")
        return

    db = SessionLocal()
    try:
        # Check if user exists
        user = db.query(User).filter(User.email == email).first()
        hashed = get_password_hash(password)

        if user:
            print(f"User {email} already exists. Upgrading to admin...")
            user.is_admin = 1
            user.hashed_password = hashed
        else:
            print(f"Creating new admin user: {email}")
            user = User(
                email=email,
                is_admin=1,
                hashed_password=hashed,
                plan="enterprise"  # Admins get enterprise by default
            )
            db.add(user)
        
        db.commit()
        print(f"✅ Success! {email} is now an admin.")
    except Exception as e:
        db.rollback()
        print(f"❌ Error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    create_admin()
