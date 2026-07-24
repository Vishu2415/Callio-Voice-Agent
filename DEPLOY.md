# 🚀 Callio — EC2 Deploy Reference

## Server Info
| Key | Value |
|-----|-------|
| **IP** | `13.221.52.161` |
| **Domain** | `https://callio.in` |
| **User** | `ubuntu` |
| **App Dir** | `~/Callio-Voice-Agent` |
| **Process Manager** | PM2 |

---

## ✅ Standard Deploy (After Code Push to GitHub)

```bash
cd ~/Callio-Voice-Agent
git pull
pm2 restart all
```

---

## 🔍 Check Logs

```bash
# Live tail logs
pm2 logs callio-app

# Last 50 lines
pm2 logs callio-app --lines 50

# Error logs only
pm2 logs callio-app --err --lines 40

# Log file location
cat /home/ubuntu/.pm2/logs/callio-app-out.log | tail -40
cat /home/ubuntu/.pm2/logs/callio-app-error.log | tail -40
```

---

## 🔄 PM2 Commands

```bash
pm2 status               # Check all running processes
pm2 restart all          # Restart all processes
pm2 restart callio-app   # Restart specific app
pm2 stop callio-app      # Stop app
pm2 start ecosystem.config.js  # Start from config
pm2 save                 # Save process list (persist after reboot)
pm2 monit                # Live CPU/Memory monitor
```

---

## 🌐 Nginx Commands

```bash
sudo nginx -t                        # Test config syntax
sudo systemctl reload nginx          # Reload config
sudo systemctl restart nginx         # Full restart
sudo systemctl status nginx          # Check status
sudo cat /etc/nginx/sites-available/callio  # View nginx config
```

---

## 🔐 SSL (Let's Encrypt / Certbot)

```bash
sudo certbot renew --dry-run         # Test cert renewal
sudo certbot certificates            # List certs and expiry
```

---

## 🛠️ Manual App Start (if PM2 not running)

```bash
cd ~/Callio-Voice-Agent
npm install          # Install any new dependencies
pm2 start server.js --name callio-app
pm2 save
```

---

## 📁 Important Files

| File | Purpose |
|------|---------|
| `server.js` | Main Node.js backend |
| `app.html` | Client dashboard UI |
| `app.js` | Dashboard frontend logic |
| `index.html` | Public landing page |
| `.env` | Environment variables (never commit!) |
| `config.json` | App config (public URL, etc.) |
| `calls_db.json` | Call history database |
| `agents_db.json` | Agent configs database |

---

## ⚙️ Environment Variables (`.env`)

```
GEMINI_API_KEY=...
VOBIZ_AUTH_ID=...
VOBIZ_AUTH_TOKEN=...
PUBLIC_URL=https://callio.in
```

---

## 🤖 Active AI Model

```
gemini-3.1-flash-live-preview
```

---

## 📝 Quick Deploy Checklist

- [ ] Push changes to GitHub (`git push`)
- [ ] SSH into EC2
- [ ] `cd ~/Callio-Voice-Agent && git pull`
- [ ] `pm2 restart all`
- [ ] `pm2 logs callio-app --lines 20` — verify no errors
- [ ] Test on `https://callio.in`
