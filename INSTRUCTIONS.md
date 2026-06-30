# Seeker Journal: Quick Reference Guide

A simple, secure, and clean workflow for managing your private journal.

---

## 1. Updating Your Thoughts
Whenever you edit or add new notes to `_chat.txt`:
1. Open your terminal in the project directory.
2. Run the encryption script:
   ```bash
   python encrypt.py
   ```
3. This automatically packages your local `config.js` settings (like the Google Sheets URL) and WhatsApp chats into the encrypted `posts.json.enc` database file.

---

## 2. Deploying to GitHub Pages
To update your live site, upload **only** the following two files:
* 📤 **`posts.json.enc`** (your encrypted thoughts + database configuration)
* 📤 **`app.js`** (the client application logic)

⚠️ **Do NOT upload the following files (they are ignored by default to protect your privacy):**
* `_chat.txt` (contains your raw unencrypted chats)
* `config.js` (contains your plain-text database credentials)
* `secrets.json` (contains passwords/local settings)

---

## 3. Testing Locally (On Your Computer)
Due to browser security (CORS) rules, you cannot test by double-clicking `index.html` directly. You must run a local server:
1. Open your terminal in the project directory.
2. Start a Python local server:
   ```bash
   python -m http.server 3000
   ```
3. Open your browser and go to: **`http://localhost:3000`**

---

## 4. Troubleshooting
If you see a decryption error on the live website:
* **Wait 1–2 minutes:** GitHub Actions takes a moment to compile and deploy your updates.
* **Hard Refresh:** Clear your browser cache by pressing **Ctrl + F5** (Windows) or **Cmd + Shift + R** (Mac) to fetch the newest files.
