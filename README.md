# StudyAI - Student Study Assistant

Upload lecture PDFs and get AI-generated MCQs, summaries, and key concepts.

## Tech Stack
- **Backend**: FastAPI, SQLAlchemy, SQLite
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS
- **AI**: OpenAI API (configurable)

## Quick Start

### Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add your AI_API_KEY (optional - works with mock data too)
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.local.example .env.local
npm run dev
```

Open http://localhost:3000

## API Docs
Visit http://localhost:8000/docs for interactive API documentation.

## Features
- JWT authentication (signup/login)
- PDF upload and text extraction
- AI-powered content generation (MCQs, summary, key concepts)
- Interactive quiz interface
- Works without AI API key (uses mock data)

## Environment Variables

### Backend (.env)
| Variable | Default | Description |
|----------|---------|-------------|
| SECRET_KEY | dev-secret | JWT secret key |
| AI_API_KEY | (empty) | OpenAI API key |
| AI_MODEL | gpt-3.5-turbo | AI model to use |
| DATABASE_URL | sqlite:///./students.db | Database URL |

### Frontend (.env.local)
| Variable | Default | Description |
|----------|---------|-------------|
| NEXT_PUBLIC_API_URL | http://localhost:8000 | Backend API URL |
