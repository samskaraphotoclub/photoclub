# The Conscious Frame – photo club website

The website of the Photography Club of Samskara Germany e.V. (https://samskara-germany.de/). A lightweight club website: plain HTML, one CSS file and a few small scripts, no frameworks, no web fonts, no cookies or tracking. The gallery is for members only. Members sign in with a personal invite code to see the photos, comment, vote and share their own photos from their phones. An admin approves each photo before it appears. A public exhibition shows chosen photos to everyone, with the photographers' permission.

## How it fits together

- **The website** is hosted free on GitHub Pages. It holds the pages, the weekly theme and the polls, but no photos. Visitors see the theme, polls, club information, the exhibition, and an invitation to sign in.
- **The photo inbox** is a small free program on Cloudflare (`inbox/worker.js`). It keeps members' photos private until an admin decides, then keeps the approved photos in the gallery. It only hands photos to people signed in with an invite code (or the admin password), through links that stop working within a day. Photos in the exhibition are the exception: anyone can see those.
- **The exhibition** (`exhibition.html`) is public. Admins choose its photos, but only photos whose photographer agreed: members tick a box when they share a photo, or an admin ticks it after asking them. On every visit, the home page shows visitors one exhibition photo at random (gently tilted, like a print), and everyone a few more below.
- **Series** are long-term projects members add photos to, starting with **Life in Germany**. Members choose a series when they share a photo. Each series has a section on the members' home page and a filter in the gallery and the exhibition. Admins add, rename or close series on the admin page's **Home page** tab.
- **Members** sign in once on each phone with their invite code. They browse the gallery, comment, vote, and send photos on the Share a photo page (`submit.html`). Photos are resized on the phone first.
- **Admins** use the admin page (`admin.html`) to approve or decline photos, edit or delete photos in the gallery, invite or remove members, choose Photos of the week, edit the home page and post photos directly. Approved photos appear in the gallery straight away.
- **Comments:** members comment under each photo, with their name shown, and can add smileys. Members can delete their own comments; admins can delete any. Members can **Report** someone else's comment: the admin page's **Comments** tab then shows it at the top, with who reported it and why, to delete or keep. The person who wrote it never sees who reported it.
- **Malayalam:** titles, descriptions, comments, names and the weekly theme can be in Malayalam, English or both. The site marks Malayalam text so phones use their own Malayalam font (no download), with more room between lines. Members type it with their phone's Malayalam keyboard; the About page explains how.
- **Votes:** each member has 3 votes a week for photos added that week (weeks run Monday to Sunday, Berlin time). Votes are secret. For members, the home page shows last week's three most-voted photos as a fan of prints, picked automatically each Monday; until a week with votes has ended, it shows the newest photos.
- **Theme archive** (`archive.html`, members only): every weekly theme, saved when an admin publishes the home page, with that week's most-voted photos.
- **Photos keep their shape:** nothing is cropped anywhere. Photos sit in rows of equal height, each as wide as its shape needs, so portraits stay portrait and panoramas stay wide.
- **Dark mode:** the moon/sun button in the header switches between light and dark. The site starts the way the phone is set, and each phone remembers its choice.
- **Impressum and privacy policy** (`impressum.html`, `datenschutz.html`), linked at the bottom of every page. The highlighted parts of the Impressum (address, board, register entry) must be filled in with the association's details; have the board check both pages, as they were written without legal advice.

## Setting it up

Allow about 45 minutes the first time. It costs nothing.

### 1. Put the site online (GitHub Pages)

1. Create a new public repository on GitHub, for example `photoclub`.
2. Upload everything in this folder to the root of the repository ("Add file" > "Upload files", or with git).
3. In the repository go to **Settings > Pages**. Under "Build and deployment" choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute or two the site is at `https://YOUR-USERNAME.github.io/photoclub/`.

The repository is public, but it holds no photos and no passwords: photos live in the inbox, and the admin's token and password stay on the admin's phone.

### 2. Create a GitHub token for the admin page

This lets the admin page change the home page (theme and polls) and connect the site to the inbox.

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

**A new code for a member:** if someone's code has been shared by mistake, admin page > **Members** > **New code**. Their old code stops working straight away, on every phone; their photos, comments and votes stay theirs. Send them the new message the page shows.

**Removing a member:** admin page > **Members** > **Remove**. Their code stops working straight away, including in the gallery. Their photos and comments stay; delete them in the **Gallery** and **Comments** tabs if needed.

**Photos of the week:** the home page shows last week's top three by itself. The admin page's **Votes** tab shows how this week's voting is going (only admins see the numbers), and **Show the top 3 on the home page** saves them as Photos of the week in the theme archive.

**The exhibition:** admin page > **Gallery** > **Edit** on a photo > tick **In the public exhibition** > **Save**. The box says whether the photographer agreed when sharing it; if not, ask them first. Untick it to take the photo out: it goes off the Exhibition page straight away. When approving a photo, the same box is on its card.

**Reported comments:** the **Comments** tab shows how many are waiting, e.g. Comments (1). **Delete comment** removes it; **Keep it** clears the report.

**Comments:** admin page > **Comments** lists the latest 60 comments, newest first, each with a **Delete** button.

**Backup:** once a month, admin page > **Settings** > **Download backup**. It saves the gallery's photos with their details, members and their invite codes, comments and votes as one .zip file. Keep it somewhere private, because it contains the invite codes. Once the gallery has hundreds of photos, do this on a computer.

**Restore:** admin page > **Settings** > **Restore from a backup** > choose the backup file. The page lists the photos and members that are missing now; tick the ones to bring back. Their comments, votes and sent-photo history come back with them. Nothing already in the club is changed or deleted, and codes replaced with **New code** never come back. Into an empty inbox (say, after setting up a new Cloudflare account), everything is ticked. Cloudflare's free plan allows roughly 200 restored photos a day, so a big gallery takes a few days: choose the file again the next day and it carries on.

**Limits for members:** each member can send 5 photos a week, have up to 10 waiting at once, post 20 comments a day (up to 1,000 characters each) and give 3 votes a week. To change the photo or vote numbers, set `WEEKLY_LIMIT` or `VOTES_PER_WEEK` in the inbox settings (see `inbox/SETUP.md`).

**More than one admin:** each admin needs the inbox admin password, which is enough for approving, the gallery, members, votes and comments. The **Home page** tab also needs a GitHub token. GitHub's limited tokens only work for the repository owner or members of a GitHub organisation, so for several admins who edit the home page, move the repository into a free GitHub organisation and give each admin their own token.

## Edit the rest

- **Theme of the week and polls:** admin page > **Home page**. Choose whether the theme is for this week or next, change the text, pick a photo for each poll (members see it; visitors don't), and tap **Publish home page**. The theme also goes into the theme archive.
- **Series:** admin page > **Home page** > **Series**. Add a series, change its name or description, or untick **Open for new photos** to close it (its photos stay), then **Save series**.
- **Impressum and privacy policy:** `impressum.html` and `datenschutz.html`. Replace the highlighted parts (`<span class="fill">…</span>`) with the real details.
- **Other text:** each page is its own file (`index.html`, `about.html`, `gallery.html`, `submit.html`). On GitHub, open the file, click the pencil icon, change the words between the `>` and `<` marks, and click **Commit changes**. Leave the `<!-- ... -->` marker lines in `index.html` alone; the admin page uses them.
- **Club name:** search and replace "The Conscious Frame" in all `.html` and `.webmanifest` files.
- **Footer link and copyright:** the last lines of `index.html`, `about.html` and `gallery.html` (the link to samskara-germany.de and "© 2026 Samskara Germany e.V. All rights reserved."). The About page's joining button links there too.
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
index.html             Home: theme of the week, polls, photos from the exhibition; for members also last week's top three, series and the newest photos
gallery.html           The members-only gallery: sign-in, category and series filters, photo viewer
exhibition.html        The public exhibition
archive.html           The theme archive, for members
impressum.html         Impressum (legal notice)
datenschutz.html       Privacy policy (Datenschutzerklärung)
about.html             How the club works, feedback rules, joining, FAQ
submit.html            Share a photo: members send photos for approval
admin.html             Admin: approve photos, gallery, members, votes, comments, home page, post a photo, settings
404.html               Shown for missing pages
style.css              All styles
club.js                Signing in, loading the gallery and exhibition from the inbox, and the rows of photos
viewer.js              Photo tiles and the photo viewer, used by the gallery and exhibition
gallery.js             The gallery page: photos, filters, comments (with Report) and votes
exhibition.js          The exhibition page
archive.js             The theme archive page
home.js                The home page's photos
theme.js               The light/dark switch
photo-tools.js         Resizing and camera settings, used by submit.html and admin.html
publish.js             Changes to the site on GitHub, used by admin.html
backup.js              The admin page's Backup button
config.js              The inbox address (written by the admin page)
inbox/worker.js        The photo inbox and gallery, runs on Cloudflare
inbox/SETUP.md         How to set up the photo inbox
logo.webp              Logo in the header
logo-badge.webp        Logo in the footer
favicon.ico            Browser-tab icon
icons/, *.webmanifest  Home-screen icons for the site, Share a photo and admin pages
.nojekyll              Tells GitHub Pages to serve the files as they are
```
