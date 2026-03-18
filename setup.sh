#!/bin/bash
set -e
echo "Setting up Students Study Assistant..."

# Backend
echo "Setting up backend..."
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
mkdir -p uploads
echo "Backend setup complete!"

# Frontend
echo "Setting up frontend..."
cd ../frontend
npm install
cp .env.local.example .env.local
echo "Frontend setup complete!"

echo ""
echo "Setup complete!"
echo "1. Edit backend/.env and add your AI_API_KEY (or leave empty to use mock data)"
echo "2. Run: cd backend && source venv/bin/activate && uvicorn app.main:app --reload"
echo "3. Run: cd frontend && npm run dev"
