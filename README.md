# ARTTUBE backend

## Setup

1. Create `backend/.env` (copy from `.env.example`)
2. Start MongoDB locally (or point `MONGODB_URI` to your cluster)
3. Run:

```bash
cd backend
npm run dev
```

## Routes

### Auth (session stored in MongoDB)
- `POST /api/auth/signup` `{ username, password }`
- `POST /api/auth/login` `{ username, password }`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Media
- `GET /api/media` (list latest)
- `GET /api/media/:id`
- `POST /api/media/upload` (multipart/form-data)
  - `thumbnail`: image file
  - `video`: video file
  - `title`: string
  - `description`: string (optional)

Uploaded files are served at `/uploads/...`

"# ART-TUBE" 
"# ART-TUBE" 
