# The Conscious Frame – photo club website

The website of the Photography Club of Samskara Germany e.V. (https://samskara-germany.de/). A lightweight club website: plain HTML, one CSS file and a few small scripts, no frameworks, no web fonts, no cookies or tracking. The gallery is for members only. Members sign in with a personal invite code to see the photos, comment, give hearts and share their own photos from their phones. An admin approves each photo before it appears. A public exhibition shows chosen photos to everyone, with the photographers' permission.

## How it fits together

- **The website** is hosted free on GitHub Pages. It holds the pages and the monthly theme, but no photos. Visitors see the theme, club information, the exhibition, downloads, and an invitation to sign in.
- **The photo inbox** is a small free program on Cloudflare (`inbox/worker.js`). It keeps members' photos private until an admin decides, then keeps the approved photos in the gallery. It only hands photos to people signed in with an invite code (or the admin password), through links that stop working within a day. Photos in the exhibition are the exception: anyone can see those.
- **The exhibition** is public and sits on the home page (`index.html#exhibition`, shown by `exhibition.js`; the old `exhibition.html` forwards there, photo links included). Admins choose its photos, but only photos whose photographer agreed: members tick a box when they share a photo, or an admin ticks it after asking them. On every visit, the home page shows visitors one exhibition photo at random (gently tilted, like a print), and everyone a few more below.
- **Downloads** (`downloads.html`) are posters, cheat sheets, guides and forms the admins share on the admin page's **Downloads** tab: a PDF, image, Word, Excel or PowerPoint file, or a ZIP, up to 20 MB each, kept in the inbox. Each one is either for everyone or for members only. The home page shows the newest three. PDFs and images get a preview, made on the admin's phone (PDFs with Mozilla's pdf.js, kept in `vendor/pdfjs`).
- **36 frames** (`frames/`) is offline since 18 Nov 2026 while the club asks MoMA (and Magnum Photos) for permission to show the photos: it's out of the menu, the footer and the home card, the photographer pages are gone, and `frames/index.html` is a short public notice. It was 36 photographs each by 23 photographers, in order of birth, shown from MoMA's website only after a member tapped Show. To bring it back, set `SHOW_PHOTOS = True` in `make_frames.py`, rebuild 36 frames and the Masters pages, and put 36 frames back in the menu, footer and home card and the photo wording back on the privacy page (see commit 4834fa5 for how they looked). `USE_MAGNUM` in the same file decides whether Raghu Rai, Alex Webb, Herbert List and Thomas Hoepker come back too.
- **Masters of photography** (`masters/`) are pages about great photographers, for members only: a start page (`masters/index.html`) and one page each for 65 photographers in order of birth, each with a short life, six photos with notes and exercises. 56 link to their photos on moma.org (the 23 from 36 frames, the 23 added on 19 Nov 2026 from `masters23.py`, and ten more women added the same day from `women.py`, which have Masters pages only); five pages never show photos and link to the museums that hold the work instead: Vivian Maier's (`maier.py`, the Chicago History Museum and the Block Museum at Northwestern) and Sabine Weiss's, Evelyn Richter's, Mary Ellen Mark's and Dayanita Singh's (`linked.py`, the Centre Pompidou, the Kunstpalast and several American museums); Raghu Rai, Alex Webb, Herbert List and Thomas Hoepker link to magnumphotos.com (Magnum answered on 19 Nov 2026 that its images may only be used in the classroom, so the club only links to them; `photos_for()` in `make_frames.py` keeps their pages link-only even if `SHOW_PHOTOS` comes back on). A card on the home page links to them (and, while 36 frames is online, each page links to the same photographer there and back). The pages are built by `make_masters_all.py` (kept in the club's Claude project), which takes the photos from the 36 frames builder. The text for the 18 photographers added in November 2026 is in `masters18.py`, next to the builders. They're locked the same way as the handbook and use the same `HANDBOOK_KEY` secret. The masters' own photographs are never stored or shown here: while `SHOW_PHOTOS` is off (since 18 Nov 2026), each page keeps the club's text, the six photos to study become notes with a link to the photo on moma.org, and there's no Eighteen more section or Show button. If MoMA's picture doesn't load, the page links to it on moma.org instead. The pages are generated and locked when they're built, so changes go through a rebuild.
- **The Photography Handbook** (`handbook/`) is the club's handbook as web pages, for members only, with twenty chapters and their exercises, a glossary, an index and a search box. A card on the home page links to it. Everything in `handbook/` is locked except the cover picture: visitors see a sign-in form, and a signed-in member's browser gets the key from the inbox and opens the pages, pictures and search there. The inbox needs the `HANDBOOK_KEY` secret for this (see `inbox/SETUP.md`); until it has it, the handbook says it opens soon. The pages use the site's header, footer, `style.css` and `theme.js`; their own look is in `handbook/handbook.css`. Members can tick off exercises, and each phone remembers its ticks. The pages are generated from the book's text and locked when they're built, so every change, even a typo, is made in the book and the pages rebuilt.
- **Series** are long-term projects members add photos to, starting with **Life in Germany**. Members choose a series when they share a photo. Each series has a section on the members' home page and a filter in the gallery and the exhibition. Admins add, rename or close series on the admin page's **Home page** tab.
- **Members** sign in once on each phone with their invite code. They browse the gallery, comment, give hearts, and send photos on the Share a photo page (`submit.html`). Photos are resized on the phone first.
- **Admins** use the admin page (`admin.html`) to approve or decline photos, edit or delete photos in the gallery, invite or remove members, choose Photos of the month, edit the home page and post photos directly. Approved photos appear in the gallery straight away.
- **Comments:** members comment under each photo, with their name shown, and can add smileys. Members can delete their own comments; admins can delete any. Members can **Report** someone else's comment: the admin page's **Comments** tab then shows it at the top, with who reported it and why, to delete or keep. The person who wrote it never sees who reported it.
- **Malayalam:** titles, descriptions, comments, names and the monthly theme can be in Malayalam, English or both. The site marks Malayalam text so phones use their own Malayalam font (no download), with more room between lines. Members type it with their phone's Malayalam keyboard; the About page explains how.
- **Hearts:** members tap the heart beside a photo's title to give it a heart: any photo, new or old, one heart per photo, up to 20 a day (`HEARTS_PER_DAY`). A heart can be taken back on the day it's given (for mis-taps); after that it stays. Each photo shows its number of hearts on the photo and its thumbnail, updated as hearts come in; who gave which stays secret. Each month's favourites are the photos that got the most hearts during that month (so an old favourite only gains hearts from members who hadn't given it one yet). For members, the home page shows last month's three favourites as a fan of prints, picked automatically on the 1st; until a month with hearts has ended, it shows the newest photos. (Votes before October 2026 became hearts, dated the week or month they were given.)
- **Monthly themes:** one theme a month on the home page; members share a photo that fits before the month ends. The hearts given during the month decide its favourites.
- **Several categories and series per photo:** members and admins tick every category and series that fits (a photo can be Street and Night, in Life in Germany and From the Dining Table). The photo shows under each of them in the gallery's filters. Older photos with one of each are unchanged.
- **Series** start with Life in Germany and From the Dining Table. Series added to the site later are offered once to clubs that already saved their own list; removing one in the admin page keeps it removed.
- **Names and member IDs:** every member has a permanent ID (in their member record), which stays when they change their name or get a new code. Photos in the gallery, comments, event sign-ups and the photographer lines carry it, so they always show the member's current name. Members change their own name on the Share a photo page (About you), once every 30 days (`POST /me/name`; fixing capitals or spaces doesn't count); admins rename anyone in the Members tab. Names must be different from every other member's, ignoring capitals, spaces and dots, and words like Admin are kept for the club. The admin page shows each member's earlier names, and old links to a photographer page with an earlier name still work. The inbox keeps its own list of who is who (`member-ids`, with every code each member has had, never sent to pages); the first request after updating the inbox makes it and gives existing members, photos and lines their IDs.
- **Editing your own photo:** in the gallery, the photographer sees **Edit details** under their photo and can change its description and camera settings (`POST /photo/ID/details`, checked against who sent it). The photo keeps its name, so its hearts and comments stay. Admins can still change everything on the admin page's Gallery tab.
- **Photographer pages** (members only): `gallery.html?by=NAME` shows one member's photos, with the picture and line they added about themselves on the Share a photo page (the phone crops the picture to a square and makes it small; it shows as a round icon, or their initials if they haven't added one). `photographers.html` lists everyone who has shared photos. Admins can remove a line or a picture in the Members tab.
- **Theme entries:** members tick "This is my entry for the monthly theme" when sharing. The gallery has a filter for the current theme, `gallery.html?theme=2026-10` lists a month's entries, and the archive shows each month's entries and the ones with the most hearts.
- **Feedback welcome or Just sharing:** chosen for each photo when sharing (admins can change it). The viewer shows it, and the gallery has a Feedback welcome filter.
- **Learning** (`learning/index.html`, in the menu where Events used to be) is for members only and is locked like the Masters pages (built by `make_masters_all.py` with `learning_page.py`, same `HANDBOOK_KEY`, same edition). It has the **Masters challenge**: each month an admin picks one photographer from the Masters of photography pages and one of their five exercises, on the admin page's **Learning** tab, up to two months ahead. Members see a month's challenge only once the month starts. When sharing a photo, members tick "This is my attempt at this month's Masters challenge" (the Send your attempt button on the Learning page ticks it for them); the photo keeps the month (`mc`), the Learning page shows the attempts under the challenge, and the gallery viewer links back to it. Admins can untick it before approving, or in the gallery later. Past challenges stay on the page with their attempts, and the page links to the handbook and the Masters pages (and to 36 frames when it's online). The list of photographers and exercise titles for the admin page and the share form is in `learning/masters-list.js` (public: titles only, made by the same builder). The challenges need the inbox program from 17 Nov 2026; with an older one the page says the challenge starts soon. A Before and after section was considered and left for later.
- **Events** (`events.html`) are hidden since 17 Nov 2026: they're out of the menu, the footer and the home page, but the page, `events.js`, the admin page's Events tab and the saved events (and sign-ups) are all still there. To bring them back, put the Events link back in the menu and footer and the Coming up section back on the home page (see git history, commit "Learning instead of Events").
- **The theme plan:** the admin page's Home page tab has the 24 planned themes (November 2026 to October 2028): one tap fills in the month's theme. The plan is a copy of the "Monthly themes and series" doc; change `PLAN` in `admin.html` to change it.
- **WhatsApp:** the admin page has Share on WhatsApp buttons for the theme, last month's top three, this month's Masters challenge and each event. They open WhatsApp with the message ready; you choose the group.
- **Storage meter:** admin page > Settings > Storage shows how much of the free 1 GB is used and how many more photos fit. The Gallery tab warns at 80%.
- **Theme archive** (`archive.html`, members only): every monthly theme, saved when an admin publishes the home page, with the photos that got the most hearts that month, counted once the month is over.
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

This lets the admin page change the home page (the theme of the month) and connect the site to the inbox.

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

**A new code for a member:** if someone's code has been shared by mistake, admin page > **Members** > **New code**. Their old code stops working straight away, on every phone; their photos, comments and hearts stay theirs. Send them the new message the page shows.

**Removing a member:** admin page > **Members** > **Remove**, then one of:
- **Remove, keep their photos:** their code stops working straight away; their photos and comments stay in the gallery under their name, their picture and line go.
- **Delete everything they shared:** for when someone asks for their data to be deleted. Deletes their photos (with the comments on them), their comments on other photos, the hearts they gave, their event sign-ups, photos waiting for approval, picture and line, and then the member. A lot can be involved, so the page does it in parts; if Cloudflare's daily limit runs out part-way, their code has already stopped working and **Finish deleting** carries on the next day.

**Renaming a member:** admin page > **Members** > **Rename**. Their photos, comments and sign-ups show the new name at once. Members can also change their own name once a month.

**Taking a month out of the theme archive:** admin page > **Home page** > **Theme archive** lists the months that are over, with their number of entries. **Take out of the archive** hides a month (say, one with too few entries) from the members' Theme archive page; its photos stay in the gallery, just no longer marked as entries for that theme. **Bring back** puts it back as it was. The current month can't be taken out: publish another theme instead.

**Photos of the month:** the home page shows last month's three favourites by itself. The admin page's **Hearts** tab shows this month's hearts so far and last month's (only admins see the numbers), and **Show the top 3 on the home page** sets them as Photos of the month. You rarely need it: the home page shows last month's favourites anyway.

**The exhibition:** admin page > **Gallery** > **Edit** on a photo > tick **In the public exhibition** > **Save**. The box says whether the photographer agreed when sharing it; if not, ask them first. Untick it to take the photo out: it goes off the Exhibition page straight away. When approving a photo, the same box is on its card.

**Reported comments:** the **Comments** tab shows how many are waiting, e.g. Comments (1). **Delete comment** removes it; **Keep it** clears the report.

**Comments:** admin page > **Comments** lists the latest 60 comments, newest first, each with a **Delete** button.

**Backup:** once a month, admin page > **Settings** > **Download backup**. It saves the gallery's photos with their details, members and their invite codes, comments, hearts and the downloads as one .zip file. Keep it somewhere private, because it contains the invite codes. Once the gallery has hundreds of photos, do this on a computer.

**Restore:** admin page > **Settings** > **Restore from a backup** > choose the backup file. The page lists the photos and members that are missing now; tick the ones to bring back. Their comments, hearts and sent-photo history come back with them. Nothing already in the club is changed or deleted, and codes replaced with **New code** never come back. Into an empty inbox (say, after setting up a new Cloudflare account), everything is ticked. Cloudflare's free plan allows roughly 200 restored photos a day, so a big gallery takes a few days: choose the file again the next day and it carries on.

**Limits for members:** each member can send 5 photos a week, have up to 10 waiting at once, post 20 comments a day (up to 1,000 characters each) and give 20 hearts a day. To change the photo or heart numbers, set `WEEKLY_LIMIT` or `HEARTS_PER_DAY` in the inbox settings (see `inbox/SETUP.md`).

**More than one admin:** each admin needs the inbox admin password, which is enough for approving, the gallery, members, hearts and comments. The **Home page** tab also needs a GitHub token. GitHub's limited tokens only work for the repository owner or members of a GitHub organisation, so for several admins who edit the home page, move the repository into a free GitHub organisation and give each admin their own token.

## Edit the rest

- **Theme of the month:** admin page > **Home page**. Choose whether the theme is for this month or next, change the text (or take it from the plan), and tap **Publish home page**. The theme also goes into the theme archive.
- **Downloads:** admin page > **Downloads**. Choose the file, give it a title and kind, tick **Visitors can download it too** if it's for everyone, and tap **Share the file**. Edit, share on WhatsApp or delete it in the list below.
- **Series:** admin page > **Home page** > **Series**. Add a series, change its name or description, or untick **Open for new photos** to close it (its photos stay), then **Save series**.
- **Impressum and privacy policy:** `impressum.html` and `datenschutz.html`. Replace the highlighted parts (`<span class="fill">…</span>`) with the real details.
- **Other text:** each page is its own file (`index.html`, `about.html`, `gallery.html`, `submit.html`). On GitHub, open the file, click the pencil icon, change the words between the `>` and `<` marks, and click **Commit changes**. Leave the `<!-- ... -->` marker lines in `index.html` alone; the admin page uses them.
- **Club name:** search and replace "The Conscious Frame" in all `.html` and `.webmanifest` files.
- **Footer link and copyright:** the last lines of `index.html`, `about.html` and `gallery.html` (the link to samskara-germany.de and "© 2026 Samskara Germany e.V. All rights reserved."). The About page's joining button links there too.
- **Logo:** replace `logo.webp` (header), `logo-badge.webp` (footer), `favicon.ico` (browser tab) and the three PNGs in `icons/` (home screen).
- **Colours:** the top of `style.css`.
- **Time zone** (when months and weeks start): `TIMEZONE` in the inbox settings. It's set to Europe/Berlin.
- **Categories:** the chips at the top of `gallery.html` and the matching lines in `style.css` (search for `c-night`), the lists in `submit.html` and `admin.html`, and `CATEGORIES` in `inbox/worker.js`.

## Limits worth knowing

**Cloudflare (free):** 1 GB of storage, 100,000 requests a day and 1,000 saved changes a day. The photos are kept here. Phone photos come out at about 0.5–1.2 MB each after resizing (large and thumbnail together), so 1 GB holds roughly 1,000 photos. Deleting photos frees the space again. An approved photo uses 9 saved changes, a comment 3, a heart 2 and a shared file 3, so even a busy day of 50 photos, 60 comments and 75 hearts stays under the daily limit. Downloads count towards the 1 GB too; the storage meter on the admin page includes them. Each photo someone views is one request; phones keep photos for a day, so 25 members use only a few thousand a day.

**GitHub Pages (free):** the site itself is small. GitHub allows about 10 site rebuilds an hour, which only matters when you publish the home page several times in a row. GitHub Pages isn't meant for running a business, such as a shop. A club site is fine.

iPhones and iPads save photos as JPEG. Android and desktop browsers save WebP, which is about 30% smaller. Both work everywhere.

## Keeping it safe

What protects the club:
- **Invite codes** are 12 random characters (about a billion billion possibilities), so they can't be guessed. The sign-in link's code is taken out of the address bar as soon as the page has read it.
- **Guessing is slowed down:** after 20 wrong codes or admin passwords from one connection in a quarter of an hour, that connection waits 15 minutes. Each member can make up to 60 changes (photos, comments, hearts, sign-ups, profile) in 10 minutes, which keeps a stuck or misused phone from using up the free plan's 1,000 saved changes a day.
- **Everything members write** (names, titles, comments, lines about themselves, events) is shown as plain text, never as page code. Names can't hide characters that flip text direction.
- **Photos** are re-saved on the phone before they're sent, which drops the location (GPS) the camera stored in them. The inbox only accepts real JPEG, WebP and (for downloads) PDF, image, Office and ZIP files, checked by their first bytes, and browsers are told never to treat them as anything else.
- **The admin page** won't open inside another site's frame, sends no address to other sites, and opens PDFs (for download previews) with code execution switched off.
- **Photo links** work for 12 to 24 hours, then the pages fetch new ones.

What admins should do:
- Use a **long admin password** (a phrase of four or five words is good), and change it if it might have been seen (`inbox/SETUP.md`, Changing the admin password).
- Use a **fine-grained GitHub token** for this repository only, as in step 2, and tap **Remove token and password from this phone** in Settings on any phone you hand on or share.
- Keep **backups** private: they contain the invite codes.
- Set `ALLOWED_ORIGIN` in the inbox settings to the site's address.
- Publish only the club's own pages from this GitHub account: every GitHub Pages site of one account shares the browser storage where codes and the admin settings are kept.

## Files

```
index.html             Home: theme of the month, the exhibition, the newest downloads; for members also last month's top three, series and the newest photos
gallery.html           The members-only gallery: sign-in, category and series filters, photo viewer
exhibition.html        Forwards to the exhibition on the home page (kept so old links work)
frames/                36 frames: offline since 18 Nov 2026, index.html is a short public notice (made by make_frames.py)
archive.html           The theme archive, for members
photographers.html     The photographers, for members
learning/              Learning, for members: index.html (the Masters challenge, locked like the Masters pages), learning.js (fills in the
                       challenge and attempts), masters-list.js (photographers and exercise titles, for the admin page and the share form)
events.html            Events (hidden from the menu since 17 Nov 2026, kept with its data)
downloads.html         Downloads: posters, cheat sheets, guides and forms
handbook/              The Photography Handbook, for members: index.html (start page), one page per chapter, glossary.html, topics.html (index),
                       each a sign-in form with the page locked inside; img/*.bin and search.bin (pictures and search text, locked);
                       img/cover.webp (for the home page card); handbook.css; handbook.js (opening the pages, contents, search, exercise ticks)
masters/              Masters of photography, for members: index.html and one page per photographer (each a sign-in form with the page locked inside),
                       img/cover.webp (for the home page card), masters.css, masters.js (opening the page, showing museum photos on a tap)
impressum.html         Impressum (legal notice)
datenschutz.html       Privacy policy (Datenschutzerklärung)
about.html             Who we are, joining, questions
working.html           Working: how the club works (themes, hearts, downloads, Learning, exhibition), series, feedback rules, your photos
submit.html            Share a photo: members send photos for approval
admin.html             Admin: approve photos, gallery, members, hearts, comments, home page, Learning, events, downloads, post a photo, settings
404.html               Shown for missing pages
style.css              All styles
club.js                Signing in, loading the gallery and exhibition from the inbox, and the rows of photos
viewer.js              Photo tiles and the photo viewer, used by the gallery and exhibition
gallery.js             The gallery page: photos, filters, comments (with Report) and hearts
exhibition.js          The exhibition on the home page
archive.js             The theme archive page
photographers.js       The photographers page
events.js              The events page, calendar files and links, used by the admin page too
downloads.js           The downloads list, used by the Downloads, home and admin pages
home.js                The home page's photos
theme.js               The light/dark switch
photo-tools.js         Resizing and camera settings, used by submit.html and admin.html
publish.js             Changes to the site on GitHub, used by admin.html
backup.js              The admin page's Backup button
vendor/pdfjs/          Mozilla's pdf.js 3.11.174 (Apache License 2.0), for PDF previews on the admin page
config.js              The inbox address (written by the admin page)
inbox/worker.js        The photo inbox and gallery, runs on Cloudflare
inbox/SETUP.md         How to set up the photo inbox
logo.webp              Logo in the header
logo-badge.webp        Logo in the footer
favicon.ico            Browser-tab icon
icons/, *.webmanifest  Home-screen icons for the site, Share a photo and admin pages
.nojekyll              Tells GitHub Pages to serve the files as they are
```
