# The Conscious Frame – photo club website

A lightweight club website: plain HTML, one CSS file and a few small scripts, no frameworks, no web fonts. The gallery is for members only. Members sign in with a personal invite code to see the photos, comment, vote and share their own photos from their phones. An admin approves each photo before it appears.

## How it fits together

- **The website** is hosted free on GitHub Pages. It holds the pages, the weekly theme and the contests, but no photos. Visitors see the theme, contests and club information, and an invitation to sign in.
- **The photo inbox** is a small free program on Cloudflare (`inbox/worker.js`). It keeps members' photos private until an admin decides, then keeps the approved photos in the gallery. It only hands photos to people signed in with an invite code (or the admin password), through links that stop working within a day.
- **Members** sign in once on each phone with their invite code. They browse the gallery, comment, vote, and send photos on the Share a photo page (`submit.html`). Photos are resized on the phone first.
- **Admins** use the admin page (`admin.html`) to approve or decline photos, edit or delete photos in the gallery, invite or remove members, choose Photos of the week, edit the home page and post photos directly. Approved photos appear in the gallery straight away.
- **Comments:** members comment under each photo, with their name shown, and can add smileys. Members can delete their own comments; admins can delete any.
- **Votes:** each member has 3 votes a week for photos added that week (weeks run Monday to Sunday, Berlin time). Votes are secret. On Monday an admin shows last week's top 3 as Photos of the week on the home page, which members see.

## Setting it up

Allow about 45 minutes the first time. It costs nothing.

### 1. Put the site online (GitHub Pages)

1. Create a new public repository on GitHub, for example `photoclub`.
2. Upload everything in this folder to the root of the repository ("Add file" > "Upload files", or with git).
3. In the repository go to **Settings > Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is at `https://YOUR-USERNAME.github.io/photoclub/`.

The repository is public, but it holds no photos and no passwords: photos live in the inbox, and the admin's token and password stay on the admin's phone.

### 2. Create a GitHub token for the admin page

This lets the admin page change the home page (theme and contests) and connect the site to the inbox.

1. On GitHub: your profile picture > **Settings** > **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**.
2. Repository access: **Only select repositories**, and pick this site's repository.
3. Repository permissions: **Contents: Read and write**. Nothing else is needed.
4. Pick an expiry date (a year is fine), generate it and copy it.

### 3. Set up the photo inbox (Cloudflare)

Follow `inbox/SETUP.md`. You'll end up with an inbox address and an admin password.

### 4. Connect the admin page

1. On your phone open `https://YOUR-USERNAME.github.io/photoclub/admin.html`.
2. In **Settings**, the GitHub username and repository are filled in for you. Paste the token, the inbox address and the admin password, and tap **Save and check**.
3. This also connects the site to the inbox. It goes live a few minutes later.
4. Add the admin page to your home screen so it opens like an app. On iPhone, tap Share > **Add to Home Screen**. On Android, tap the menu > **Add to Home screen**.

The token and password are stored only in that phone's browser. Don't set the admin page up on a shared device. If a phone is lost, delete the token on GitHub, change the admin password in Cloudflare, and set up the admin page again.

## Running the club

**Inviting a member:** admin page > **Members** > type their name > **Create invite code** > **Share** (or **Copy**) to send them the message. The message has a link that signs them straight in. The name you type is the name shown with their photos. Invite yourself too, to see the gallery as a member.

**Approving photos:** admin page > **To approve**. You can fix the title, category and description before you tap **Approve**; the photo is in the gallery straight away. **Decline** lets you add a short note, which the member sees.

**Editing or deleting a photo:** admin page > **Gallery**. **Edit** changes the title, photographer, category or description. **Delete** removes the photo and its comments for good.

**Removing a member:** admin page > **Members** > **Remove**. Their code stops working straight away, including in the gallery. Their photos and comments stay; delete them in the **Gallery** and **Comments** tabs if needed.

**Photos of the week:** every Monday, open admin page > **Votes** and tap **Show the top 3 on the home page**. The tab also shows how this week's voting is going. Only admins see the numbers.

**Comments:** admin page > **Comments** lists the latest 60 comments, newest first, each with a **Delete** button.

**Limits for members:** each member can send 5 photos a week, have up to 10 waiting at once, post 20 comments a day and give 3 votes a week. To change the photo or vote numbers, set `WEEKLY_LIMIT` or `VOTES_PER_WEEK` in the inbox settings (see `inbox/SETUP.md`).

**More than one admin:** each admin needs the inbox admin password, which is enough for approving, the gallery, members, votes and comments. The **Home page** tab also needs a GitHub token. GitHub's limited tokens only work for the repository owner or members of a GitHub organisation, so for several admins who edit the home page, move the repository into a free GitHub organisation and give each admin their own token.

## Edit the rest

- **Theme of the week and contests:** admin page > **Home page**. Change the text, pick a photo for each contest (members see it; visitors don't), and tap **Publish home page**.
- **Other text:** each page is its own file (`index.html`, `about.html`, `gallery.html`, `submit.html`). On GitHub, open the file, click the pencil icon, change the words between the `>` and `<` marks, and click **Commit changes**. Leave the `<!-- ... -->` marker lines in `index.html` alone; the admin page uses them.
- **Club name:** search and replace "The Conscious Frame" in all `.html` and `.webmanifest` files.
- **Contact email:** search and replace `hello@example.com`.
- **Logo:** replace `logo.webp` (header), `logo-badge.webp` (footer), `favicon.ico` (browser tab) and the three PNGs in `icons/` (home screen).
- **Colours:** the top of `style.css`.
- **Time zone** (when voting weeks start): `TIMEZONE` in the inbox settings. It's set to Europe/Berlin.
- **Categories:** the chips at the top of `gallery.html` and the matching lines in `style.css` (search for `c-night`), the lists in `submit.html` and `admin.html`, and `CATEGORIES` in `inbox/worker.js`.

## Limits worth knowing

**Cloudflare (free):** 1 GB of storage, 100,000 requests a day and 1,000 saved changes a day. The photos are kept here. Phone photos come out at about 0.5–1.2 MB each after resizing (large and thumbnail together), so 1 GB holds roughly 1,000 photos. Deleting photos frees the space again. An approved photo uses 9 saved changes, a comment 3 and a vote 1, so even a busy day of 50 photos, 60 comments and 75 votes stays under the daily limit. Each photo someone views is one request; phones keep photos for a day, so 25 members use only a few thousand a day.

**GitHub Pages (free):** the site itself is small. GitHub allows about 10 site rebuilds an hour, which only matters when you publish the home page several times in a row. GitHub Pages isn't meant for running a business, such as a shop. A club site is fine.

iPhones and iPads save photos as JPEG. Android and desktop browsers save WebP, which is about 30% smaller. Both work everywhere.

## Files

```
index.html             Home: theme of the week, contests; for members also Photos of the week and the newest photos
gallery.html           The members-only gallery: sign-in, category filters, photo viewer
about.html             How the club works, feedback rules, joining, FAQ
submit.html            Share a photo: members send photos for approval
admin.html             Admin: approve photos, gallery, members, votes, comments, home page, post a photo, settings
404.html               Shown for missing pages
style.css              All styles
club.js                Signing in and loading the gallery from the inbox, used by the gallery and home page
gallery.js             The gallery page: photos, viewer, comments and votes
home.js                The home page's photos, for members
photo-tools.js         Resizing and camera settings, used by submit.html and admin.html
publish.js             Changes to the site on GitHub, used by admin.html
config.js              The inbox address (written by the admin page)
inbox/worker.js        The photo inbox and gallery, runs on Cloudflare
inbox/SETUP.md         How to set up the photo inbox
logo.webp              Logo in the header
logo-badge.webp        Logo in the footer
favicon.ico            Browser-tab icon
icons/, *.webmanifest  Home-screen icons for the site, Share a photo and admin pages
.nojekyll              Tells GitHub Pages to serve the files as they are
```
