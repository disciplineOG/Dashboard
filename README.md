# My Dashboard — Personal Life Dashboard

A single-file web app that acts as your personal command center — tracking your day, health, money, goals, and learning in one place. It runs entirely in your browser, syncs across devices via Firebase, and can be installed on your phone like a native app.

## What you get

- **Overview tab** — a summary of everything at a glance, so you always know where things stand
- **Today tab** — a daily view of your tasks and events for the current day
- **Health tab** — log fitness, symptoms, medications, or any wellness data you want to track
- **Expenses tab** — record spending and track your budget with your local currency
- **Prep tab** — plan and track your upskilling, study goals, and career readiness
- **Goals tab** — set personal and professional goals and track your progress over time
- **Offline-ready PWA** — install it on your phone home screen and it works even without internet
- **Optional sharing** — give a read-only password to a partner or family member so they can view without editing

## What you need

- A GitHub account (free — sign up at [github.com](https://github.com))
- A Google account (for Firebase sync — the free tier is more than enough for personal use)
- A phone or computer with a modern browser (Safari, Chrome, or Firefox)

## Setup in 4 steps

### Step 1 — Fork the repository

Forking means making your own personal copy of this project on GitHub, hosted under your own account.

1. Make sure you are signed in to GitHub.
2. On this repository's page, click the **Fork** button in the top-right corner.
3. On the next screen, leave everything as-is and click **Create fork**.
4. You now have your own copy at `https://github.com/disciplineOG/Dashboard`.

Now turn on GitHub Pages so the app is publicly accessible:

5. In your forked repository, click **Settings** (the gear icon in the top menu).
6. In the left sidebar, click **Pages**.
7. Under "Branch", click the dropdown that says "None" and select **main**.
8. Leave the folder set to **/ (root)**.
9. Click **Save**.

GitHub will now build your site. It takes about 1–2 minutes. Your app will be live at:

```
https://disciplineog.github.io/Dashboard/
```

If you have forked this repo under your own account, your URL will follow the same pattern: `https://YOURUSERNAME.github.io/Dashboard/` — check the Pages settings screen to confirm.

---

### Step 2 — Set up Firebase (for sync across devices)

> This step is optional. If you only use one device and do not need your data to sync anywhere, skip this entirely and use the app in local-only mode. Your data will be saved in your browser.

Firebase is a free service from Google that stores your data in the cloud so it stays in sync across your phone, tablet, and computer.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with your Google account.
2. Click **Add project**. Give it any name (e.g. "my-dashboard"). Click **Continue**.
3. On the next screen, toggle off **Enable Google Analytics** — it is not needed. Click **Create project**.
4. Wait about 10 seconds for Firebase to set things up, then click **Continue**.
5. You are now on the project overview page. Click the **Web icon** (it looks like `</>`) to add a web app to your project.
6. Give it any nickname (e.g. "dashboard"). Do **not** check the box for "Firebase Hosting" — you are using GitHub Pages for that. Click **Register app**.
7. Firebase will show you a block of code. Find the part that looks like this:

   ```js
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "yourproject.firebaseapp.com",
     databaseURL: "https://yourproject-default-rtdb.region.firebasedatabase.app",
     projectId: "yourproject",
     storageBucket: "yourproject.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123...:web:abc..."
   };
   ```

   Keep this page open — you will need these values in Step 3.

8. Click **Continue to console**.
9. In the left sidebar, click **Build** → **Realtime Database**.
10. Click **Create database**.
11. Choose the server location closest to you (e.g. United States, Europe, Asia). Click **Next**.
12. Select **Start in test mode**. Click **Enable**.
13. Your database is now ready.

> **Note on security:** Test mode allows open read/write access for 30 days. For personal use this is fine to start. After you are comfortable with the app, go to Realtime Database → Rules and tighten the rules. See the Troubleshooting section below for a reminder when the 30 days expire.

---

### Step 3 — Open your app and complete setup

Go to your GitHub Pages URL from Step 1. The first time you open the app, a setup wizard appears automatically. It has three steps.

---

**Step 1 of 3 — App Basics (required)**

- **App Name** — whatever you want to call it (e.g. "Bargav's Dashboard")
- **Currency Symbol** — your local currency symbol. The default is ₹ — change it to `$`, `€`, `£`, or whatever you use. This appears throughout the Expenses tab.
- **Hosting URL** — paste your GitHub Pages URL here: `https://disciplineog.github.io/Dashboard/`. This is used when the app generates sharing links. Leave it blank if you are running locally.

Click **Next →** to continue.

---

**Step 2 of 3 — Firebase Sync (optional)**

Paste each value from the `firebaseConfig` block you saw in Firebase Step 7 above:

| Field in the wizard | Key in firebaseConfig |
|---|---|
| API Key | `apiKey` |
| Auth Domain | `authDomain` |
| Database URL | `databaseURL` |
| Project ID | `projectId` |
| Storage Bucket | `storageBucket` |
| Messaging Sender ID | `messagingSenderId` |
| App ID | `appId` |

If you do not want Firebase right now, click **Skip — configure Firebase later in App Settings** and continue.

---

**Step 3 of 3 — Passwords (optional)**

- **Admin password** — your private password for full access (read, write, and settings). Leave blank if you do not want a login screen at all.
- **Read-only password** — a separate password you can share with others. People who enter this password can view your dashboard but cannot edit anything. Leave blank if you do not need sharing.
- **Login screen hint** — optional text shown below the password field on the login screen (e.g. "Enter your name to continue"). Leave blank to use the default.

> Passwords are stored as SHA-256 hashes — the app never stores your password in plain text.

Click **Finish Setup**. The page will reload and your dashboard is ready to use.

---

### Step 4 — Add to your phone's home screen

Adding the app to your home screen makes it behave like a native app — it opens full screen with no browser bar, loads fast, and works offline.

**iPhone or iPad (Safari):**

1. Open your GitHub Pages URL in **Safari** (it must be Safari, not Chrome, on iOS).
2. Tap the **Share button** — the square with an arrow pointing up, at the bottom of the screen.
3. Scroll down in the share sheet and tap **Add to Home Screen**.
4. Give it a name (e.g. "Dashboard") and tap **Add**.

**Android (Chrome):**

1. Open your GitHub Pages URL in **Chrome**.
2. Tap the **three-dot menu** (⋮) in the top-right corner.
3. Tap **Add to Home screen** (on some phones it says "Install app").
4. Tap **Add**.

The app icon will now appear on your home screen and open full-screen, just like a downloaded app.

**Optional — set a custom home screen icon:**
Upload a square image named `icon-192.png` (192×192 pixels or larger) to the root of your repository. It can be any photo, logo, or image you like. If you skip this, the browser will fall back to a generic bookmark icon automatically — the app still works fine either way.

---

## Sharing with someone (read-only access)

If you set a read-only password during setup (Step 3 of 3 above), sharing is simple:

1. Send your partner or family member your GitHub Pages URL.
2. Tell them the read-only password (separately — not in the same message as the URL, for safety).
3. They open the URL, enter the read-only password, and can browse your dashboard.

They will be able to see everything but will not be able to add, edit, or delete any data.

---

## Changing settings later

You do not need to redo the setup wizard to change your settings. At any time:

1. Open the app.
2. Tap the **menu icon** (☰) in the top-right corner.
3. Tap **App Settings**.

From there you can update your app name, currency, Firebase configuration, and passwords whenever you like.

---

## Troubleshooting

**"I get a 404 error when I open the app"**

This almost always means your repository is set to **private**. GitHub Pages only works with public repositories on a free GitHub account.

To fix it:

1. Go to your repository on GitHub.
2. Click **Settings**.
3. Scroll down to the **Danger Zone** section at the bottom.
4. Click **Change repository visibility** and set it to **Public**.

Your app and its data are still protected — the app has its own password system (set up in the wizard). Making the repository public just means someone can read the source code, not access your data. There are no passwords, API keys, or personal data stored in the code itself.

---

**"The app shows a blank page or doesn't load"**

Wait 2–3 minutes after enabling GitHub Pages and try again. GitHub needs a moment to build and publish your site for the first time. If it still does not load after 5 minutes, go back to Settings → Pages and confirm the branch is set to `main` and the folder is `/ (root)`.

---

**"Data isn't syncing across my devices"**

Make sure the **Database URL** is entered correctly in App Settings. It should look exactly like:

```
https://your-project-default-rtdb.REGION.firebasedatabase.app
```

Check for typos, extra spaces, or a missing `https://`. You can copy it directly from the Firebase Console under Build → Realtime Database.

---

**"I forgot my admin password"**

Since passwords are stored as hashes, there is no way to recover the original. The easiest fix:

1. Open your forked repository on GitHub.
2. Click on `index.html` to open the file, then click the **pencil icon** to edit it.
3. Search for the stored password hash and delete it (or set a new one by going through App Settings once you are back in).
4. Alternatively, look for the app's settings key in the browser's local storage (DevTools → Application → Local Storage) and clear it to reset the wizard.
5. Commit your change and wait 1–2 minutes for GitHub Pages to redeploy.

---

**"Firebase says 'Permission denied'"**

Your Realtime Database test mode has likely expired (it lasts 30 days). To fix it:

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and open your project.
2. Click **Build** → **Realtime Database**.
3. Click the **Rules** tab.
4. Replace the contents with:

```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

5. Click **Publish**.

This re-opens access. For a more secure setup in the long run, consider restricting rules to specific paths or adding Firebase Authentication.

---

**"The PWA / home screen icon is not working"**

The app requires being served over HTTPS for PWA features to work. GitHub Pages always uses HTTPS, so as long as you are using your `github.io` URL (not opening the file locally from your computer), it should work. Make sure you are opening the full URL in Safari (iOS) or Chrome (Android) before adding to your home screen.
