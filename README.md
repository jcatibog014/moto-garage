# Moto Garage

A web app for a buy-and-sell business that tracks every motorcycle and car: what it was bought for and when, what was spent on it (transport, repair, parts, documents, cleaning), and what it sold for. It works out the total cost, profit and days in stock for each unit, and shows totals on a dashboard.

- **Dashboard**: units in stock, money tied up in stock, profit this month, total profit, total sales, average profit per unit, recent sales, and the units that have been in stock the longest.
- **Units**: search and filter by type and status, plus an **Export CSV** button for Excel or backups.
- **Unit page**: a cost breakdown, an expense list with a quick "Add expense" form, and a **Mark as sold** form that shows the profit as you type the price.
- Amounts are in Philippine Pesos (₱). Works on phones and computers.

Data is stored in [Supabase](https://supabase.com) (free plan). Everyone on the team logs in and sees the same records.

## One-time setup

### 1. Create the database
1. Sign up at [supabase.com](https://supabase.com) and create a **New project** (the free plan is enough). Pick the region closest to you (for example Singapore).
2. Open **SQL Editor** → **New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.

### 2. Allow only your team to log in
1. Go to **Authentication** → **Sign In / Providers** → **Email** and turn **off** "Allow new users to sign up".
2. Go to **Authentication** → **Users** → **Add user** → **Create new user**. Enter each team member's email and password and tick **Auto Confirm User**.

### 3. Connect the app
1. Go to **Project Settings** → **API** (or **Data API** / **API Keys**).
2. Copy the **Project URL** and the **anon public** key (or the **publishable** key) into [`js/config.js`](js/config.js):

```js
window.MOTO_CONFIG = {
  SUPABASE_URL: 'https://abcdefgh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
};
```

The anon key is meant to be used in the browser. The data is protected by row level security in the schema, so only logged-in users can read or change it. **Never** put the `service_role` / secret key in this file.

## Run it on your computer

There's no build step. From this folder:

```sh
npx serve .
```

Then open http://localhost:3000.

## Put it online (free)

Since the repository is private, use Netlify or Vercel. Both can deploy private GitHub repos for free:

- **Netlify**: Add new site → Import an existing project → GitHub → `moto-garage`. Leave the build command empty and set the publish directory to `.`.
- **Vercel**: Add New → Project → import `moto-garage`, with Framework Preset **Other** and no build command.

Every push to `main` then updates the live site. Open the link on your phone and use **Add to Home Screen** to get it like an app.

## How profit is calculated

```
Total cost = Purchase price + all expenses
Profit     = Sale price − Total cost
```

The `unit_summary` view in `supabase/schema.sql` computes these, so the dashboard, list, CSV and unit page always agree.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page shell: top bar, navigation, main view |
| `css/styles.css` | All styles (mobile-first) |
| `js/config.js` | Supabase URL and anon key |
| `js/app.js` | Login, pages, forms, saving data, CSV export |
| `supabase/schema.sql` | Database tables, the summary view and security rules |
