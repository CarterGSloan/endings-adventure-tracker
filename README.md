# Endings — Adventure Tracker

A small installable web app for tracking which endings you've reached in
Choose Your Own Adventure books. Add books, add endings as you find them,
check them off, and jot notes on how you got there.

Everything is stored locally on the device, in the browser's IndexedDB.
Nothing is sent to a server — there is no server. See "Why no backend?"
below for the reasoning.

## Deploying it (GitHub Pages, free forever)

1. Create a new **public** repository on GitHub (Settings → required for
   free Pages hosting on a personal GitHub account).
2. Copy every file in this folder into the repository, preserving the
   folder structure (`vendor/` and `icons/` must stay as subfolders).
3. Commit and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
4. On GitHub: **Settings → Pages → Source → Deploy from a branch**, pick
   `main` and `/ (root)`, save.
5. After a minute or two, your app is live at
   `https://<your-username>.github.io/<your-repo>/`.

No build step, no `npm install`, no server to run. It's just static files.

## Installing it on an iPhone or iPad

1. Open the GitHub Pages URL in **Safari** (must be Safari, not Chrome,
   for "Add to Home Screen" to create a proper installed app on iOS).
2. Tap the **Share** button → **Add to Home Screen**.
3. It now opens full-screen, with its own icon, like a regular app —
   this is the PWA `manifest.json` and `service-worker.js` at work.

## Using it on more than one device

There is no account system and no sync server, so two devices won't
automatically see the same data. To move data from one device to
another:

1. On the device with the data: **Settings (gear icon) → Export**.
   This saves a `.json` file.
2. Get that file onto the second device (AirDrop, iCloud Drive, email
   to yourself — whatever's easiest).
3. On the second device: **Settings → Import**, pick the file. Importing
   merges by book title, so importing the same file twice won't create
   duplicates.

This is manual rather than automatic. See "Why no backend?" for why that
trade-off was made on purpose, and what the upgrade path looks like if
automatic sync ever becomes worth the added complexity.

## Why no backend?

An earlier draft of this plan proposed a self-hosted backend (PocketBase)
running on a cloud VM or a Raspberry Pi, to sync data automatically
between an iPhone and an iPad. That's a reasonable design for an app with
many users or a real need for real-time sync — but for one person
tracking her own reading, it adds a server to patch and keep running,
a domain or IP to manage, and a whole new category of "something broke
and now the app doesn't load" that doesn't exist if there's no server at
all.

The zero-backend version meets the original "never requires payment"
requirement even more completely than a self-hosted server does: there
is no VM, no uptime to maintain, no account to keep active, and nothing
running anywhere that could need attention. The entire app is static
files on GitHub Pages (free, forever, for a public repo) plus the
browser's own built-in storage.

**If automatic multi-device sync becomes worth it later**, two options
worth considering, roughly in order of how much complexity they add:
- Store the exported JSON file in a private GitHub repo and have the app
  read/write it via GitHub's REST API with a personal access token —
  no server to run, GitHub *is* the backend, still entirely free.
- Stand up the original PocketBase-on-a-VM design from the earlier plan,
  once there's an actual reason (e.g. she's actively reading on both
  devices in the same sitting and the manual export/import is genuinely
  getting in the way) rather than because it's more "proper."

## Project structure

```
index.html          App shell: library view + book view + dialogs
styles.css           All styling — see the "design tokens" comment block
app.js                All app logic: Dexie setup, rendering, CRUD, export/import
manifest.json          PWA metadata (name, icons, colors)
service-worker.js       Offline caching of the app shell
vendor/dexie.min.js     Dexie.js (IndexedDB wrapper), vendored locally — Apache 2.0
icons/                  App icons for the home-screen install
```

**Why vendor Dexie instead of loading it from a CDN?** Two reasons: a CDN
is one more third party the app depends on being online and free
forever, and the service worker can only reliably cache a script for
offline use if it's served from the same origin as the app. Vendoring it
removes both concerns at once. Dexie is Apache 2.0 licensed — free to
use, modify, and redistribute, with no paid tier of the library itself
(Dexie Cloud is a separate, optional paid product that this app does not
use).

**Why no React/Vite/TypeScript build step?** For an app this size, a
build toolchain is mostly a source of future breakage with no real
benefit: a few years from now, `npm install` on an old project can fail
because some transitive dependency was deprecated or a Node version
changed, none of which affects a plain HTML/CSS/JS site. Plain files
deployed as-is will keep working as long as browsers exist, which is the
right trade-off for something meant to quietly keep working for years
with zero maintenance.

## Data model

Each **book** has: title, author, series (optional), a known total
endings count (optional — leave blank if you don't know how many
endings the book has), and notes.

Each **ending** belongs to one book, and has: a label (what happens),
a page or reference, the path/choices that led there, notes, an optional
1–5 rating, a reached/unreached status, and an optional "spoiler" flag
that hides its notes behind a tap until you choose to reveal them.
