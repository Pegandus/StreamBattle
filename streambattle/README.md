# StreamBattle 🎵

Competitive osu! stream speed benchmark. Challenge real players to live 1v1 duels, climb the leaderboard, and prove your BPM.

## Features
- 🎯 Target BPM challenges (160 / 180 / 200 / 220 BPM)
- 🏆 Persistent leaderboard (SQLite database)
- ⚔️ Live 1v1 duels via WebSockets
- 🔍 Quick matchmaking
- 📊 Unstable Rate tracking + grade system (SS → D)

---

## Deploying to Render (Free) — Step by Step

### Step 1 — Create a GitHub account (if you don't have one)
Go to https://github.com and sign up for free.

### Step 2 — Create a new GitHub repository
1. Click the **+** button in the top right → **New repository**
2. Name it `streambattle`
3. Set it to **Public**
4. Click **Create repository**

### Step 3 — Upload your files to GitHub
You have two options:

**Option A — GitHub website (easiest, no terminal needed):**
1. On your new repo page, click **uploading an existing file**
2. Drag and drop ALL the files from this folder:
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `.gitignore`
   - The entire `public/` folder (drag `public/index.html`)
3. Click **Commit changes**

**Option B — Terminal (if you have Node/Git installed):**
```bash
cd streambattle
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/YOUR_USERNAME/streambattle.git
git push -u origin main
```

### Step 4 — Create a Render account
Go to https://render.com and sign up (free — use your GitHub account to sign in).

### Step 5 — Deploy on Render
1. On your Render dashboard, click **New +** → **Web Service**
2. Click **Connect a repository** and select your `streambattle` repo
3. Render will auto-detect the settings from `render.yaml`. Verify:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
4. Click **Create Web Service**
5. Wait ~2 minutes for the build to finish
6. Your site will be live at: `https://streambattle.onrender.com` (or similar)

### Step 6 — Add persistent disk (for the database)
By default Render's free tier resets the filesystem. To keep scores:
1. In your service dashboard, go to **Disks**
2. Click **Add Disk**
3. Set Mount Path to: `/opt/render/project/src/db`
4. Size: 1 GB (free)
5. Click **Save** — Render will redeploy automatically

That's it! Your StreamBattle is now live. 🎉

---

## Running Locally (for testing)

```bash
# Install dependencies
npm install

# Start the server
npm start

# Open http://localhost:3000
```

For live-reload during development:
```bash
npm run dev
```

---

## Project Structure

```
streambattle/
├── server.js          # Backend: Express + Socket.io + SQLite
├── package.json       # Dependencies
├── render.yaml        # Render deployment config
├── .gitignore
├── db/                # SQLite database (auto-created)
│   └── streambattle.db
└── public/
    └── index.html     # Full frontend (single file)
```

---

## Tech Stack
- **Node.js** + **Express** — HTTP server
- **Socket.io** — Real-time WebSocket communication
- **better-sqlite3** — Lightweight embedded database
- **Render** — Free cloud hosting
