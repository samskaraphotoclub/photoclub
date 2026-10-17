# The Conscious Frame – photo club website

A lightweight club website: plain HTML and one CSS file, no frameworks, no web fonts. The public pages work without JavaScript. Members send photos from their phones, and an admin approves each one before it appears in the gallery. Members can also comment on photos and vote for Photos of the week.

The photos and names in the gallery are samples. Replace them with your own.

## How it fits together

- **The website** is hosted free on GitHub Pages.
- **Members** open the Share a photo page (`submit.html`) with their personal invite code, pick a photo and send it. The photo is resized on their phone first.
- **The photo inbox** is a small free program on Cloudflare (`inbox/worker.js`). It keeps sent photos private until an admin decides.
- **Admins** use the admin page (`admin.html`) to approve or decline photos, invite or remove members, and post photos directly. Approving a photo publishes it to the gallery and the home page about a minute later.
- Members see on their Share a photo page whether each photo is waiting, in the gallery, or not accepted (with the admin's note).
- **Comments:** anyone can read the comments under a photo in the gallery. Members write them, signed in with their invite code, and their name is shown. Members can add smileys from the smiley button under the comment box, or from their phone's emoji keyboard. Members can delete their own comments; admins can delete any.
- **Votes:** each member has 3 votes a week for photos added that week (weeks run Monday to Sunday, Berlin time). Votes are secret. On Monday an admin publishes last week's top 3 as Photos of the week on the home page.

## Setting it up

Allow about 30 minutes the first time. It costs nothing.

### 1. Put the site online (GitHub Pages)

1. Create a new public repository on GitHub, for example `photoclub`.
2. Upload everything in this folder to the root of the repository ("Add file" > "Upload files", or with git).
3. In the repository go to **Settings > Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is at `https://YOUR-USERNAME.github.io/photoclub/`.

### 2. Create a GitHub token for the admin page

This lets the admin page publish photos to the site.

1. On GitHub: your profile picture > **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**.
2. Repository access: **Only select repositories**, and pick this site's repository.
3. Repository permissions: **Contents: Read and write**. Nothing else is needed.
4. Pick an expiry date (a year is fine), generate it and copy it.

### 3. Set up the photo inbox (Cloudflare)

Follow `inbox/SETUP.md`. You'll end up with an inbox address and an admin password.

### 4. Connect the admin page

1. On your phone open `https://YOUR-USERNAME.github.io/photoclub/admin.html`.
2. In **Settings**, the GitHub username and repository are filled in for you. Paste the token, the inbox address and the admin password, and tap **Save and check**.
3. This also switches on the Share a photo page for members. It goes live a few minutes later.
4. Add the admin page to your home screen so it opens like an app. On iPhone, tap Share > **Add to Home Screen**. On Android, tap the menu > **Add to Home screen**.

The token and password are stored only in that phone's browser. Don't set the admin page up on a shared device. If a phone is lost, delete the token on GitHub, change the admin password in Cloudflare, and set up the admin page again.

## Running the club

**Inviting a member:** admin page > **Members** > type their name > **Create invite code** > **Share** (or **Copy**) to send them the message. The message has a link that signs them straight in. The name you type is the name shown with their photos.

**Approving photos:** admin page > **To approve**. You can fix the title, category and description before you approve. **Decline** lets you add a short note, which the member sees.

**Removing a member:** admin page > **Members** > **Remove**. Their code stops working straight away. Their photos and comments stay; delete comments in the **Comments** tab if needed.

**Photos of the week:** every Monday, open admin page > **Votes** and tap **Show the top 3 on the home page**. The tab also shows how this week's voting is going. Only admins see the numbers.

**Comments:** admin page > **Comments** lists the latest 60 comments, newest first, each with a **Delete** button.

**Limits for members:** each member can send 5 photos a week, have up to 10 waiting at once, post 20 comments a day and give 3 votes a week. To change the photo or vote numbers, set `WEEKLY_LIMIT` or `VOTES_PER_WEEK` in the inbox settings (see `inbox/SETUP.md`).

**More than one admin:** each admin needs the inbox admin password, and a GitHub token to publish photos. GitHub's limited tokens only work for the repository owner or members of a GitHub organisation, so for several admins move the repository into a free GitHub organisation and give each admin their own token.

**Removing or editing a photo in the gallery:** open `gallery.html` on GitHub and tap the pencil icon. Each photo is one block that starts with `<figure class="tile` and ends with `</figure>`. Edit the text, or delete the whole block. Then delete the two image files in `photos/` if you no longer need them.

## Edit the rest

- **Theme of the week and contests:** admin page > **Home page**. Change the text, pick a photo for each contest, and tap **Publish home page**. Photos of the week are published from the **Votes** tab.
- **Other text:** each page is its own file (`index.html`, `about.html`, `gallery.html`, `submit.html`). On GitHub, open the file, click the pencil icon, change the words between the `>` and `<` marks, and click **Commit changes**. Leave the `<!-- ... -->` marker lines in `index.html` and `gallery.html` alone; the admin page uses them.
- **Club name:** search and replace "The Conscious Frame" in all `.html` and `.webmanifest` files.
- **Contact email:** search and replace `hello@example.com`.
- **Logo:** replace `logo.webp` (header and footer), `favicon.ico` (browser tab) and the three PNGs in `icons/` (home screen).
- **Colours:** the top of `style.css`.
- **Time zone** (when voting weeks start): `TIMEZONE` in the inbox settings, and the `TIMEZONE` line near the top of `members.js` and `publish.js`. It's set to Europe/Berlin.
- **Categories:** the chips at the top of `gallery.html` and the matching lines in `style.css` (search for `c-night`), the lists in `submit.html` and `admin.html`, and `CATEGORIES` in `inbox/worker.js`.

## Limits worth knowing

**GitHub Pages (free):** the site can be up to 1 GB. Phone photos come out at about 200–450 KB each after resizing (large and thumbnail together), so that's roughly 2,000–5,000 photos. Deleted photos still count, because GitHub keeps the file history. Traffic has a soft limit of about 100 GB a month, roughly 200,000 visits. GitHub allows about 10 site rebuilds an hour, so a batch of approvals may take a little while to all show up. GitHub Pages isn't meant for running a business, such as a shop. A club site is fine.

**Cloudflare (free):** 100,000 requests a day, 1 GB of storage, and 1,000 saved changes a day. A photo sent uses 4 saved changes, a comment 3 and a vote 1, so 25 members could send 50 photos, write 150 comments and give 75 votes in a day and still use less than half.

iPhones and iPads save photos as JPEG. Android and desktop browsers save WebP, which is about 30% smaller. Both work everywhere.

## Files

```
index.html             Home: theme of the week, photos of the week, newest photos, contests
gallery.html           All photos, category filters, photo viewer
about.html             How the club works, feedback rules, joining, FAQ
submit.html            Share a photo: members send photos for approval
admin.html             Admin: approve photos, members, post a photo, settings
404.html               Shown for missing pages
style.css              All styles
photo-tools.js         Resizing and camera settings, used by submit.html and admin.html
publish.js             Publishing to GitHub, used by admin.html
members.js             Comments and votes in the gallery's photo viewer
config.js              The inbox address (written by the admin page)
inbox/worker.js        The photo inbox, runs on Cloudflare
inbox/SETUP.md         How to set up the photo inbox
photos/                Each photo as NAME.webp or NAME.jpg (large) and NAME-sm (thumbnail)
logo.webp              Logo in the header and footer
favicon.ico            Browser-tab icon
icons/, *.webmanifest  Home-screen icons for the site, Share a photo and admin pages
.nojekyll              Tells GitHub Pages to serve the files as they are
```
