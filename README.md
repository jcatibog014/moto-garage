# Moto Garage

A web app for a buy-and-sell business that tracks every motorcycle and car: what it was bought for and when, what was spent on it (transport, repair, parts, documents, cleaning), and what it sold for. It works out the total cost, profit and days in stock for each unit, and shows totals on a dashboard.

- **Dashboard**: units in stock, money tied up in stock, profit this month, total profit, total sales, average profit per unit, recent sales, and the units that have been in stock the longest.
- **Units**: search and filter by type and status, plus an **Export CSV** button for Excel or backups.
- **Unit page**: a cost breakdown, an expense list with a quick "Add expense" form, and a **Mark as sold** form that shows the profit as you type the price.
- Amounts are in Philippine Pesos (₱). Works on phones and computers.

Data is stored in **Firebase Firestore** on the free Spark plan (no credit card). Only team members listed in `firestore.rules` can log in and see the data.

- Firebase project: `moto-garage-dmem` ([console](https://console.firebase.google.com/project/moto-garage-dmem/overview))
- Live site: https://moto-garage-dmem.web.app

## Adding a team member

1. Firebase console → **Authentication** → **Users** → **Add user**. Enter their email and a password.
2. Add the same email (lowercase) to the list in [`firestore.rules`](firestore.rules).
3. Deploy the rules:

```sh
npx firebase-tools deploy --only firestore:rules
```

To remove someone, delete them in Authentication and remove their email from `firestore.rules`.

## Run it on your computer

There's no build step. From this folder:

```sh
npx serve .
```

Then open http://localhost:3000. It uses the real Firebase data.

## Publish changes to the live site

```sh
npx firebase-tools deploy
```

This uploads the site to Firebase Hosting and deploys the Firestore rules.

## Free plan limits

The Spark plan is free with no card. The limits are 1 GiB of data, 50,000 reads and 20,000 writes per day, and 10 GB of hosting with 360 MB of downloads per day. That's far more than a small dealer needs. If a limit is ever reached, that service pauses until the daily reset. You are never charged.

## How profit is calculated

```
Total cost = Purchase price + all expenses
Profit     = Sale price − Total cost
```

Each unit stores a running `total_expenses`, which is updated in the same write as each expense is added or deleted. The rest is calculated in `summarize()` in `js/app.js`.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell: top bar, navigation, main view |
| `css/styles.css` | All styles (mobile-first) |
| `js/config.js` | Firebase web config (these values are public) |
| `js/app.js` | Login, pages, forms, saving data, CSV export |
| `firestore.rules` | Who can read and write data (the team email list) |
| `firebase.json`, `.firebaserc` | Firebase Hosting and project settings |
