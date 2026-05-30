# DanielBot — Shift Management Telegram Bot

A Telegram bot for managing event staff shifts. Admins create shifts via an interactive wizard; staff sign up and cancel using inline buttons. The shift post updates itself live.

---

## Quick Start

```bash
# 1. Clone / unzip the project
cd danielbot

# 2. Install dependencies
npm install

# 3. Configure
cp .env.example .env
# Edit .env — set BOT_TOKEN and ADMIN_IDS

# 4. Run
npm start
# or for development with auto-reload:
npm run dev
```

---

## Configuration (`.env`)

| Variable    | Description |
|-------------|-------------|
| `BOT_TOKEN` | Your bot token from [@BotFather](https://t.me/BotFather) |
| `ADMIN_IDS` | Comma-separated Telegram user IDs of initial admins (e.g. `123456789,987654321`) |

---

## Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/myshifts` | Show shifts you are signed up for |
| `/help` | Show help |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/newshift` | Create a shift via step-by-step wizard |
| `/shifts` | List all shifts |
| `/shift_<id>` | Manage a specific shift (edit / delete / post) |
| `/users` | List all known users |
| `/ban <id>` | Ban a user |
| `/unban <id>` | Unban a user |
| `/makeadmin <id>` | Promote user to admin |
| `/removeadmin <id>` | Demote admin |
| `/adminhelp` | Show admin command reference |

---

## How It Works

### Creating a Shift

1. Admin runs `/newshift`
2. Bot asks for each field one by one: date, location, dress code, start time, end time, required staff count
3. After the last field the bot posts the shift message with **[✅ Sign Up]** and **[❌ Cancel]** buttons
4. The shift is stored in the database and the message is linked to it

### Signing Up / Cancelling

- Any non-banned user can tap **✅ Sign Up** — the message updates instantly
- Tapping again shows "already signed up"
- Tapping **❌ Cancel** removes the user and refreshes the message
- Once full, Sign Up shows "🔴 Shift is full"

### Editing a Shift

- `/shift_<id>` → **✏️ Edit** button → choose field → enter new value
- The original shift post is updated automatically

### Deleting a Shift

- `/shift_<id>` → **🗑 Delete** — removes the shift and its Telegram post

### Reminders

The bot sends a private reminder to every participant **60 minutes** and **30 minutes** before their shift starts.

---

## Project Structure

```
danielbot/
├── src/
│   ├── index.js              # Entry point
│   ├── reminders.js          # Cron-based shift reminders
│   ├── db/
│   │   ├── database.js       # SQLite connection + migrations
│   │   └── queries.js        # All DB operations
│   ├── scenes/
│   │   └── shiftScenes.js    # Create & Edit wizard scenes
│   ├── commands/
│   │   ├── admin.js          # Admin command handlers
│   │   ├── user.js           # User command handlers
│   │   └── callbacks.js      # Inline button callbacks
│   ├── helpers/
│   │   └── format.js         # Shift message formatting
│   └── middleware/
│       ├── guards.js         # adminOnly / notBanned middleware
│       └── trackUser.js      # Auto-upsert user on every interaction
├── data/                     # SQLite DB (auto-created)
├── .env.example
├── .gitignore
└── package.json
```

---

## Database Schema

```sql
users               -- Telegram users (id, username, first_name, last_name, is_admin, is_banned)
shifts              -- Shift records (date, location, dress_code, start_time, end_time, required, chat_id, message_id)
shift_participants  -- Join table (shift_id, user_id) — UNIQUE constraint prevents duplicates
```
