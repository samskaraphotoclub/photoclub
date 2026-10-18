# Setting up the photo inbox

The photo inbox is a small program that runs on Cloudflare's free plan. It keeps photos that members send private until an admin approves or declines them, keeps the approved photos in the members-only gallery, and stores members' comments and weekly votes. Only people with an invite code can see the gallery, send photos, comment or vote, and only the admin password can see waiting photos and vote counts.

**Already set up the inbox before the gallery became members-only?** Repeat point 3 of step 3 with the new `worker.js` (Edit code, replace everything, Deploy). Your members, comments and votes stay as they are.

You set it up once, in the Cloudflare dashboard, in about 15 minutes. You don't need to install anything. Cloudflare sometimes renames menu items, so the names below may differ slightly.

## 1. Create a Cloudflare account

Sign up at https://dash.cloudflare.com/sign-up. The free plan is enough.

## 2. Create the storage

1. In the dashboard, find **Workers KV** (under **Storage & databases**, or use the search box).
2. **Create** a namespace called `conscious-frame-inbox`.

## 3. Create the inbox program (Worker)

1. Go to **Workers & Pages** and choose **Create** > **Create Worker** (start from the "Hello World" example).
2. Name it `conscious-frame-inbox` and click **Deploy**.
3. Click **Edit code**. Delete all the example code, paste in everything from `worker.js` (in this folder), and click **Deploy**.

## 4. Connect the storage

1. Open the Worker, then **Settings** > **Bindings** > **Add** > **KV namespace**.
2. Variable name: `INBOX` (exactly like that, in capitals).
3. KV namespace: `conscious-frame-inbox`. Save.

## 5. Add the settings

Open the Worker, then **Settings** > **Variables and Secrets** > **Add**:

| Name | Type | Value |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Secret | A long password, at least 12 characters. Share it only with club admins. |
| `ALLOWED_ORIGIN` | Text | Your site's address without anything after the domain, for example `https://yourname.github.io` |
| `WEEKLY_LIMIT` | Text | Optional. How many photos each member can send per 7 days. Default 5. |
| `VOTES_PER_WEEK` | Text | Optional. How many votes each member can give per week. Default 3. |
| `TIMEZONE` | Text | Optional. When voting weeks start, for example `Europe/Berlin` (the default) or `Europe/London`. |

Save and deploy.

## 6. Check it works

On the Worker's overview page, copy its address. It looks like `https://conscious-frame-inbox.yourname.workers.dev`. Open it in a browser. You should see:

```
{"ok":true,"service":"photo inbox"}
```

## 7. Connect the admin page

Open the site's admin page (`admin.html`) > **Settings**. Paste the inbox address and the admin password, and tap **Save and check**. This also connects the gallery and the Share a photo page to the inbox a few minutes later.

Then invite your first member: **Members** > type a name > **Create invite code** > **Share**.

## If something goes wrong

- **"Wrong admin password":** the password on the admin page must match `ADMIN_PASSWORD` exactly, including capitals.
- **"Set an ADMIN_PASSWORD secret of at least 12 characters":** add the secret (step 5), or make it longer.
- **"The inbox has no storage connected":** add the KV binding called `INBOX` (step 4).
- **The admin page says it can't reach the inbox:** check the inbox address, and that `ALLOWED_ORIGIN` is your site's address with `https://` and no slash at the end.
- **Members get "The photo is missing" when they send a photo:** open the Worker's **Settings**, and set the **Compatibility date** to today's date.

## Updating the inbox program

When `worker.js` changes (new features), open the Worker in Cloudflare > **Edit code**, select everything in the editor, paste the new `worker.js` over it and tap **Deploy**. Nothing stored is lost: members, photos, comments and votes stay. The site keeps working while you do it.

## Changing the admin password

Change `ADMIN_PASSWORD` in the Worker's settings, then enter the new password in **Settings** on each admin's phone. The password also signs the gallery's photo links, so members who have the gallery open just reload the page to see the photos again.

## What it costs

Nothing for a club this size. The free plan allows 1 GB of storage, 100,000 requests a day and 1,000 saved changes a day.

- **Storage:** the gallery's photos are kept here. Each photo takes about 0.5–1.2 MB (large version and thumbnail), so 1 GB holds roughly 1,000 photos. Deleting photos in the admin page's Gallery tab frees the space again. Waiting photos are removed as soon as they're approved or declined; comments take very little space.
- **Saved changes:** an approved photo uses 9 (4 when it's sent, 5 when it's approved), a comment 3 and a vote 1, so even a busy day of 50 photos, 60 comments and 75 votes stays under the limit.
- **Requests:** each photo someone opens is one request. Phones keep the photos for a day, so 25 members use only a few thousand a day.
