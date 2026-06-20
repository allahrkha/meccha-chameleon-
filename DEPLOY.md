# 🌐 Deploy Meccha Chameleon — Play Anywhere in the World

The game currently works on localhost and local WiFi.
To play with friends online, deploy it to a free cloud host.

---

## Option A — Railway (Recommended, ~2 minutes)

**Free tier:** 500 hours/month, automatic HTTPS, no credit card

### Steps
1. Push your game folder to a GitHub repo:
   ```
   cd chameleon-game
   git init
   git add .
   git commit -m "Initial commit"
   gh repo create meccha-chameleon --public --push
   ```
   (Install GitHub CLI from https://cli.github.com if needed)

2. Go to **https://railway.app** → "New Project" → "Deploy from GitHub repo"

3. Select your `meccha-chameleon` repo → Railway auto-detects the Dockerfile

4. Click **Deploy** — live URL appears in ~60 seconds

5. Share the URL with friends: `https://your-app.up.railway.app`

---

## Option B — Render (Free, sleeps after 15 min idle)

1. Push to GitHub (same as above)
2. Go to **https://render.com** → "New" → "Web Service"
3. Connect GitHub repo → Render detects `render.yaml` automatically
4. Click **Create Web Service**
5. Live in ~3 minutes at `https://meccha-chameleon.onrender.com`

⚠️ **Note:** Free Render services sleep after 15 minutes of inactivity.
The first player to join after a gap may wait ~30 seconds for the server to wake.

---

## Option C — Fly.io (Free, more control)

```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Inside your game folder:
cd chameleon-game
fly launch           # creates fly.toml, detects Dockerfile
fly deploy           # deploys to fly.io
fly open             # opens live URL
```

---

## Option D — Local Network (no internet required)

Share on WiFi with friends in the same house/office:

1. Find your local IP:
   - Mac/Linux: `ifconfig | grep "inet " | grep -v 127`
   - Windows: `ipconfig` → look for IPv4 Address

2. Run the server: `node server.js`

3. Share: `http://192.168.x.x:3000` (your IP, port 3000)

---

## After Deployment

- Your live URL replaces `localhost:3000` — share it with anyone
- Rooms reset when the server restarts (free tier limitation)
- For persistent rooms, upgrade to a paid plan or add a database
- Health check endpoint: `https://your-url/health`
