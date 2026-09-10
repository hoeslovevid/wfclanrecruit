function jump(id, label) {
  return `<a href="/privacy" data-jump="${id}">${label}</a>`;
}

export function privacyView() {
  return `
    <section class="page-hero">
      <p class="eyebrow">Legal</p>
      <h1>Privacy Policy</h1>
      <p class="lead">This page explains what WF Clan Recruit collects, why, who sees it, how long it stays, and how you can opt out. It describes this website as it works today, not a generic template.</p>
      <p class="muted">Last updated 10 September 2026. This site is independent and is not affiliated with Digital Extremes, Warframe, Discord, or Google.</p>
    </section>

    <section class="policy-page">
      <article class="panel policy-summary">
        <p class="kicker">At a glance</p>
        <h2>What you should know first</h2>
        <ul class="policy-bullets">
          <li>You can browse the board without an account. We do not require cookies to read listings.</li>
          <li>We do not run ads, analytics pixels, or social tracking scripts.</li>
          <li>If you sign in, we store account, Discord, and (if you verify) Warframe Forum details so you can post.</li>
          <li>Verifying makes your Warframe name findable by clan leaders adding a recruiter to their own listing.</li>
          <li>Listings you publish are public, including images, any YouTube video you link, Discord invites, and whatever you write in the post. Each listing has a shareable URL.</li>
          <li>You can report a dead or dishonest listing. Reports are not public; only admins can read them.</li>
          <li>You can download your data, remove listings, sign out, or delete your account from the ${jump("opt-out", "opt-out section")} or your <a href="/account" data-link>account page</a>.</li>
        </ul>
      </article>

      <nav class="panel policy-toc" aria-label="On this page">
        <p class="kicker">Contents</p>
        <ol>
          <li>${jump("who", "Who we are")}</li>
          <li>${jump("scope", "What this policy covers")}</li>
          <li>${jump("browse", "Browsing without an account")}</li>
          <li>${jump("collect", "Information we collect")}</li>
          <li>${jump("sources", "How we collect it")}</li>
          <li>${jump("use", "How we use it")}</li>
          <li>${jump("legal-bases", "Legal bases")}</li>
          <li>${jump("cookies", "Cookies and local storage")}</li>
          <li>${jump("public", "What is public")}</li>
          <li>${jump("share", "Who we share data with")}</li>
          <li>${jump("transfers", "International transfers")}</li>
          <li>${jump("retention", "How long we keep data")}</li>
          <li>${jump("security", "Security")}</li>
          <li>${jump("children", "Children")}</li>
          <li>${jump("opt-out", "Your rights and how to opt out")}</li>
          <li>${jump("california", "California, other US state, and GDPR notes")}</li>
          <li>${jump("automated", "Automated checks")}</li>
          <li>${jump("changes", "Changes")}</li>
          <li>${jump("contact", "Contact")}</li>
          <li>${jump("definitions", "Definitions")}</li>
        </ol>
      </nav>

      <article class="panel policy-section" id="who">
        <p class="kicker">01</p>
        <h2>Who we are</h2>
        <p>WF Clan Recruit (“we”, “us”, “the site”) is an independent Warframe clan and alliance recruitment board. We publish public listings so players can find groups and join Discord servers.</p>
        <p>We are not Digital Extremes Ltd., Warframe, Discord Inc., Google LLC, Jina AI, or Railway. Those companies have their own policies for the services they provide.</p>
        <p>For privacy purposes, the operator of this website is the controller of personal data processed on WF Clan Recruit. Hosting currently runs on Railway. Source code is published at <a href="https://github.com/hoeslovevid/wfclanrecruit" target="_blank" rel="noopener noreferrer">github.com/hoeslovevid/wfclanrecruit</a>.</p>
      </article>

      <article class="panel policy-section" id="scope">
        <p class="kicker">02</p>
        <h2>What this policy covers</h2>
        <p>This policy applies to the WF Clan Recruit website, its application programming interface (API), listing images stored on this host under <code>/uploads/</code> or on Cloudflare R2, and account features such as Discord sign-in and Warframe Forum verification.</p>
        <p>It does not cover:</p>
        <ul class="policy-bullets">
          <li>Discord servers you join from a listing. Those communities set their own rules and collect their own data.</li>
          <li>Warframe, Steam, PlayStation, Xbox, Nintendo, or forums.warframe.com, except for the verification check described below.</li>
          <li>Other websites linked from a listing, and YouTube, which serves any video a listing embeds.</li>
          <li>Your internet provider, browser, or device, which may keep their own logs.</li>
        </ul>
        <p>By using the site you acknowledge this policy. You do not have to create an account to read it or to browse listings.</p>
      </article>

      <article class="panel policy-section" id="browse">
        <p class="kicker">03</p>
        <h2>Browsing without an account</h2>
        <p>Anyone can open the home, clan, alliance, guide, privacy, sitemap, and robots pages without signing in. In that mode we do not create a user record for you.</p>
        <p>Your browser will still make ordinary web requests to load the page, styles, logo, fonts, and listing data. The hosting provider can see technical request data such as IP address, date, URL, and browser type. We do not write those values into our application database, and we do not use them to build a marketing profile.</p>
        <p>Optional on-device data while browsing:</p>
        <ul class="policy-bullets">
          <li><strong>Theme preference.</strong> If you use the light/dark switch, the choice is stored only in your browser as <code>wfr-theme</code>. We never send that value to our server.</li>
          <li><strong>Message alerts.</strong> If you sign in, Sound ping and Desktop alert live in your account menu. Those choices stay in your browser as <code>wfr-alerts</code>. Desktop alerts use the browser’s notification permission; we do not get a push subscription, and nothing is sent when this site is closed.</li>
          <li><strong>Saved listings.</strong> If you save a clan, alliance, or player post, the shortlist stays in your browser as <code>wfr-saves</code>. If you are signed in, we also store that list on your account so it follows you to another device. Unsave or delete the account to drop it from the server.</li>
          <li><strong>Composer drafts.</strong> If you start a listing and leave, the text is stored in your browser as <code>wfr-drafts</code>. Images are not kept in the draft. If you are signed in, we also store those drafts on your account. Publishing or deleting the account clears them from the server.</li>
          <li><strong>Recently viewed.</strong> Opening a listing remembers the last ten on this device as <code>wfr-viewed</code>. We never send that list to our server.</li>
          <li><strong>Browse filters.</strong> The last filters you used on Clans, Alliances, or Players stay in your browser as <code>wfr-filters</code>. Reset on that directory, or clear this site’s data, forgets them. We never send that map to our server.</li>
          <li><strong>Google Fonts.</strong> The page loads Rajdhani from Google’s font servers. Google may process your IP address under Google’s policies. Blocking that request still lets the site run on your system fonts.</li>
        </ul>
      </article>

      <article class="panel policy-section" id="collect">
        <p class="kicker">04</p>
        <h2>Information we collect</h2>
        <p>We collect only what the product needs to run a public board and to keep posting from being trivial for bots.</p>

        <h3>Account data (if you sign in)</h3>
        <div class="policy-table-wrap">
          <table class="policy-table">
            <thead>
              <tr><th>Data</th><th>Stored?</th><th>Shown on the public board?</th></tr>
            </thead>
            <tbody>
              <tr><td>Internal user id</td><td>Yes</td><td>Not as a profile page. Listing API responses include the owner id of a post.</td></tr>
              <tr><td>Username on this site</td><td>Yes</td><td>Not as a directory. Clan posts can include a leader name you type.</td></tr>
              <tr><td>Password hash</td><td>Yes, hashed. Discord accounts get a random unused password.</td><td>No</td></tr>
              <tr><td>Account created time</td><td>Yes</td><td>No</td></tr>
              <tr><td>Admin flag</td><td>Yes, for staff accounts. An existing admin can grant this from the staff page by choosing an account on this site, or by pasting a Discord user id. If that person has not signed in yet, we store the id until they do.</td><td>No</td></tr>
              <tr><td>Discord user id</td><td>Yes</td><td>No</td></tr>
              <tr><td>Discord display name</td><td>Yes</td><td>No. Visible to you on your account page.</td></tr>
              <tr><td>Discord email</td><td>Yes, if Discord returns one</td><td>No. We do not print it on listings or in the public API account object.</td></tr>
              <tr><td>Discord email-verified flag</td><td>Checked at sign-in in production; not stored as its own field</td><td>No</td></tr>
              <tr><td>Forum profile URL</td><td>Yes, after you paste a profile link</td><td>No</td></tr>
              <tr><td>Verified Warframe name (derived from that profile)</td><td>Yes, after you paste a profile link</td><td>Not on its own. Once you verify, a clan leader adding a recruiter to their own listing can find you by typing part of this name. It becomes public on a listing only if you own one or accept a recruiter invite.</td></tr>
              <tr><td>Forum verification code</td><td>Yes, until you verify</td><td>No, except you place it on your Warframe Forum About Me yourself</td></tr>
              <tr><td>Forum verified flag and timestamps</td><td>Yes</td><td>No</td></tr>
              <tr><td>Recruiter roster</td><td>Which listings you were invited to, which you accepted, and whether each one gave you edit access</td><td>Only after you accept, and only your in-game name, which then appears on that listing as a contact. A pending invite is never public, and neither is whether you can edit.</td></tr>
              <tr><td>Online status</td><td>Your choice of status and how long to hold it is stored. Whether you are online right now is held in memory only and is lost when the server restarts.</td><td>Yes. If you own a listing, an online dot can appear on it. Set your status to Invisible to stop this.</td></tr>
              <tr><td>Saved listings and listing drafts</td><td>Yes, if you are signed in. Otherwise they stay only in this browser.</td><td>No</td></tr>
              <tr><td>Session token</td><td>Yes, in the database and in an HTTP-only cookie</td><td>No</td></tr>
            </tbody>
          </table>
        </div>

        <h3>Listing data (if you publish)</h3>
        <p>Clan and alliance posts are meant to be public. We store whatever you submit, including:</p>
        <ul class="policy-bullets">
          <li>Name, tag, headline, summary, and full post body (including formatting and any links you insert)</li>
          <li>Platform, region, language, status, member counts, MR, clan tier, founded year</li>
          <li>Playstyles you pick, including Warframe-specific tags such as Archon, Eidolon, or Cross-save</li>
          <li>Leader name, Discord invite URL, optional alliance link</li>
          <li>Uploaded images (each up to 2 MB; we resize them on save and store WebP files on this host or Cloudflare R2) and optional YouTube links, of which we store only the video id</li>
          <li>Created time, last bump time, paused flag, optional pause note, hidden flag, invite check result, and the owner id of the account that posted it</li>
        </ul>
        <p>Do not put private phone numbers, home addresses, government IDs, or passwords in a listing. Recruits and search engines can see public posts.</p>

        <h3>Reports</h3>
        <p>Anyone can send a listing report (dead invite, inactive, fake, stolen name, or other). We store the reason, optional details, listing id and name, time, status, and the reporter’s account id if they were signed in. Reports are not shown on the public board.</p>

        <h3>On-site messages</h3>
        <p>If you use Messages, we store the plain text you write, who is in the conversation, the listing it is about, and whether you muted that thread on your side. Messages are not shown on the public board. The other person in the thread can read them. Muting does not hide the chat from them.</p>

        <h3>Technical data we do not store in the app database</h3>
        <ul class="policy-bullets">
          <li>We do not store IP addresses, GPS, payment cards, or device advertising IDs in the application database. Production uses Postgres tables (users, sessions, clans, alliances, players, reports, admin_grants) when <code>DATABASE_URL</code> is set. Local development can use a <code>db.json</code> file instead.</li>
          <li>We do not keep Discord OAuth access or refresh tokens after sign-in finishes.</li>
          <li>We do not store the HTML of your Warframe Forum profile after the verification check. We only keep whether the code matched, plus the profile URL and name.</li>
          <li>The host (Railway) and any reverse proxy may still log IPs and user agents for security and uptime. Those logs are not a feature of this app and are not used to target ads.</li>
        </ul>
      </article>

      <article class="panel policy-section" id="sources">
        <p class="kicker">05</p>
        <h2>How we collect it</h2>
        <ul class="policy-bullets">
          <li><strong>Directly from you.</strong> Forms, file uploads, Discord OAuth consent, forum profile URL, and buttons such as bump, pause, report, edit, sign out, export, or delete.</li>
          <li><strong>From Discord.</strong> If you choose Continue with Discord, Discord sends us an OAuth code. We exchange it for a short-lived token and read <code>/users/@me</code> with scopes <code>identify</code> and <code>email</code>. We then drop the Discord token. When you publish or bump a listing, and on a periodic re-check, we ask Discord whether the invite code is still valid; Discord sees that invite code.</li>
          <li><strong>From Warframe Forums, through a reader.</strong> Direct fetches from our server are blocked by Cloudflare. When you confirm verification, we ask a browser-based reader to load your public About Me tab and check for your one-time code. That request includes the public profile URL you gave us.</li>
          <li><strong>Automatically.</strong> Session cookies after sign-in; theme and message-alert choices in local storage if you set them; a live message stream (Server-Sent Events) while you are signed in and the site is open; standard HTTPS request metadata at the host.</li>
        </ul>
      </article>

      <article class="panel policy-section" id="use">
        <p class="kicker">06</p>
        <h2>How we use it</h2>
        <div class="policy-table-wrap">
          <table class="policy-table">
            <thead>
              <tr><th>Purpose</th><th>Data involved</th></tr>
            </thead>
            <tbody>
              <tr><td>Show the public recruitment board</td><td>Listing fields, images, YouTube video ids</td></tr>
              <tr><td>Let you sign in and stay signed in</td><td>Discord profile, session cookie, password hash for local/admin login</td></tr>
              <tr><td>Stop throwaway Discord accounts from flooding posts</td><td>Discord id (account age), verified-email check in production</td></tr>
              <tr><td>Tie a poster to a Warframe Forum identity</td><td>Forum URL, verification code, verified flag</td></tr>
              <tr><td>Let you edit, bump, pause, or remove your posts</td><td>Owner id, session, listing records</td></tr>
              <tr><td>Keep names and tags unique, hide stale or paused Discord buttons</td><td>Listing name, tag, bump time, paused flag, invite check</td></tr>
              <tr><td>Show a preview when a listing URL is pasted in Discord or similar</td><td>Public title, headline, summary, and listing image</td></tr>
              <tr><td>Handle “report this listing”</td><td>Report reason, optional details, reporter id if signed in</td></tr>
              <tr><td>Let signed-in people message about a listing</td><td>Message text, thread membership, mute choice</td></tr>
              <tr><td>Let you keep a saved shortlist and listing drafts across devices</td><td>Saved listing ids and composer text, only if you are signed in</td></tr>
              <tr><td>Ping you about a new message while this site is open</td><td>Sender name and a short preview, only in a browser notification if you turned Desktop alert on</td></tr>
              <tr><td>Enforce cooldowns (new listing 15 minutes, bump 12 hours, forum check a few seconds)</td><td>Timestamps on listings and the last forum check</td></tr>
              <tr><td>Moderation by staff</td><td>Admins can hide or remove any listing, read reports, and grant or revoke staff</td></tr>
              <tr><td>Security and abuse handling</td><td>Sessions, Discord ids, host logs</td></tr>
              <tr><td>Honor download and deletion requests</td><td>Your account record and listings</td></tr>
            </tbody>
          </table>
        </div>
        <p>We do <strong>not</strong> use your data to send marketing email, to sell leads, to train a public AI model as a product feature, or to run advertising auctions. Discord email is stored as part of the Discord snapshot and is not used for a newsletter.</p>
      </article>

      <article class="panel policy-section" id="legal-bases">
        <p class="kicker">07</p>
        <h2>Legal bases</h2>
        <p>If you are in the UK, EEA, Switzerland, or a similar regime, we rely on these bases:</p>
        <ul class="policy-bullets">
          <li><strong>Legitimate interests.</strong> Running a public clan board, preventing spam, keeping sessions, hosting the site, and securing it. You can object as described under opt-out. Browsing logs at the host fall here.</li>
          <li><strong>Contract / steps to post.</strong> If you create an account and publish, we process account and listing data to provide that service.</li>
          <li><strong>Consent.</strong> Discord OAuth (you can cancel on Discord’s screen). Optional theme storage in your browser. Optional message-alert choices and, if you turn Desktop alert on, the browser notification permission. Optional Google Fonts (you can block third-party fonts). You may withdraw consent by signing out, deleting the account, clearing site data, turning those toggles off, or blocking fonts.</li>
          <li><strong>Legal obligation.</strong> We may keep or disclose a narrow record if required by law, a valid order, or to defend the service.</li>
        </ul>
      </article>

      <article class="panel policy-section" id="cookies">
        <p class="kicker">08</p>
        <h2>Cookies and local storage</h2>
        <p>We do not use advertising cookies or a cookie banner, because we do not drop non-essential tracking cookies.</p>
        <div class="policy-table-wrap">
          <table class="policy-table">
            <thead>
              <tr><th>Name</th><th>Type</th><th>Duration</th><th>Purpose</th><th>How to opt out</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><code>wfr_session</code></td>
                <td>HTTP-only cookie, SameSite=Lax, Secure in production</td>
                <td>30 days</td>
                <td>Keep you signed in</td>
                <td>Sign out, or delete your account, or clear cookies for this site</td>
              </tr>
              <tr>
                <td><code>wfr_oauth</code></td>
                <td>HTTP-only cookie</td>
                <td>10 minutes</td>
                <td>Protect the Discord login round-trip (state and next page)</td>
                <td>Wait for expiry, or finish/cancel Discord login. Not set unless you start Discord sign-in</td>
              </tr>
              <tr>
                <td><code>wfr-theme</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it</td>
                <td>Remember light or dark</td>
                <td>Toggle the theme, or clear this site’s data in your browser. The site still works</td>
              </tr>
              <tr>
                <td><code>wfr-alerts</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it</td>
                <td>Remember Sound ping and Desktop alert</td>
                <td>Turn the toggles off in the account menu, or clear this site’s data. Desktop alerts also follow the site’s notification permission in your browser</td>
              </tr>
              <tr>
                <td><code>wfr-saves</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it</td>
                <td>Remember listings you saved. Signed in, we also store the list on your account</td>
                <td>Unsave them from Settings or a listing, or clear this site’s data</td>
              </tr>
              <tr>
                <td><code>wfr-drafts</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it or publish</td>
                <td>Remember listing text you were writing</td>
                <td>Publish the listing, or clear this site’s data. Signed-in drafts also live on the account until you publish or delete</td>
              </tr>
              <tr>
                <td><code>wfr-viewed</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it</td>
                <td>Remember the last ten listings you opened</td>
                <td>Clear this site’s data</td>
              </tr>
              <tr>
                <td><code>wfr-filters</code></td>
                <td>Browser local storage, not a cookie</td>
                <td>Until you clear it</td>
                <td>Remember the last filters on Clans, Alliances, and Players</td>
                <td>Reset on that directory, or clear this site’s data</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>The session cookie is necessary if you want to stay signed in. You can refuse it by not signing in. Browsing still works.</p>
        <p>We do not currently change behavior based on a Global Privacy Control or Do Not Track header, because we do not run a sale/share advertising stack those signals are meant to stop. Blocking cookies in your browser will sign you out and will not stop public listing pages from loading.</p>
      </article>

      <article class="panel policy-section" id="public">
        <p class="kicker">09</p>
        <h2>What is public</h2>
        <p>Treat every listing as public. That includes Discord invite links, leader names, screenshots, linked video, a pause note if the leader wrote one, and the full post. Listing URLs also expose an Open Graph title, description, and image so Discord and similar apps can show a card. Other visitors, scrapers, and archives may copy public pages. Removing a listing from this site does not erase copies someone else already saved.</p>
        <p>Forum verification requires you to put a short code on your Warframe Forum About Me. That code is public on Digital Extremes’ forums until you delete it. After you verify here, you should remove the code from About Me if you do not want it sitting on the forum.</p>
        <p>Verifying a Warframe Forum profile makes your verified Warframe name findable when a clan leader adds a recruiter. The box on their listing suggests names as they type: it needs at least two characters, returns at most eight names, and only a signed-in leader can run it, and only against a listing they own. It offers nothing else about you — no Discord name, no email, no listings you are on — and it never suggests someone who is already a recruiter on that listing. This is how a leader can add you without you first having to hand them your exact spelling. If you have not verified a forum profile, you are not in it at all.</p>
        <p>A listing can be handed to someone else. The owner offers it by your verified Warframe name, and nothing moves until you accept: while the offer is pending, only you and that listing's owner can see it. Accepting makes the post yours — your verified name becomes the one recruits whisper, and the previous owner keeps edit access but can no longer delete it. Declining leaves everything as it was.</p>
        <p>Whoever answers whispers on a listing is shown with a label the owner types — "Leader", "Recruiter", or whatever that clan calls the role. It is a title only: it never changes what anyone can do to the post, and it is published alongside your verified name.</p>
        <p>A clan leader can invite you to be a recruiter on their listing. Nothing is published until you accept: while an invite is pending, only you and that listing's owner can see it. Once you accept, your in-game name and online status appear on their public post so recruits can whisper you, and you can leave from your account page at any time.</p>
        <p>An invite says what it is for. A plain recruiter only answers whispers. An owner can instead give you edit access, which lets you change that post — its text, images, tags and links — as well as bump and pause it; the owner can grant or withdraw that at any time, and it takes effect immediately. Nobody but the owner can delete a listing, decide who else is on it, or change what anyone else there can do. An owner who gives you edit access can see the same about you as before: nothing new is collected, and nothing new is published.</p>
        <p>While you have the site open, your listing can show an online dot so recruits can tell whether it is worth whispering you. New accounts start as Online; pick Invisible in the status menu to turn it off, and nothing about your presence is published. The status is self-declared, including “Online in game” — we cannot see what you are doing in Warframe.</p>
        <p>Your Discord email, Discord id, password hash, session tokens, and on-site messages are not shown on listing cards.</p>
      </article>

      <article class="panel policy-section" id="share">
        <p class="kicker">10</p>
        <h2>Who we share data with</h2>
        <p>We do not sell personal information. We do not share it with data brokers. We do pass data to processors and platforms that make the product work:</p>
        <div class="policy-table-wrap">
          <table class="policy-table">
            <thead>
              <tr><th>Recipient</th><th>Why</th><th>What they may see</th></tr>
            </thead>
            <tbody>
              <tr><td>Railway (hosting and optional Postgres)</td><td>Run the app and store listings. When Cloudflare R2 is not configured, listing images stay on this host</td><td>The same data we store, plus ordinary server logs</td></tr>
              <tr><td>Cloudflare R2</td><td>Store and serve listing images</td><td>The image files you upload, and ordinary request logs when someone loads those images</td></tr>
              <tr><td>Discord</td><td>Sign-in and invite checks</td><td>That you authorized this app; Discord already has your Discord account. Invite lookups send the invite code</td></tr>
              <tr><td>Jina AI reader (<code>r.jina.ai</code>)</td><td>Read a public About Me page when Cloudflare blocks our server</td><td>The public forum profile URL you submitted, at the moment you click to check</td></tr>
              <tr><td>Google Fonts</td><td>Load Rajdhani</td><td>Your IP and browser when the font CSS and files load</td></tr>
              <tr><td>YouTube (Google)</td><td>Play a video a listing embeds</td><td>Your IP and browser when the player loads on a listing page. We embed through <code>youtube-nocookie.com</code>, so YouTube does not set its usual tracking cookies unless you press play</td></tr>
              <tr><td>Warframe Forums / Digital Extremes</td><td>You publish the code on About Me; we only read that public tab</td><td>Whatever you put on your forum profile</td></tr>
              <tr><td>Other visitors</td><td>The board is public</td><td>Listing content and uploads</td></tr>
              <tr><td>Authorities or a successor</td><td>Only if legally required, or if the project is handed to a new operator who continues the same board</td><td>Relevant records</td></tr>
            </tbody>
          </table>
        </div>
        <p>If you click Join Discord on a listing, you leave this site and Discord’s policy applies. We do not receive a copy of messages you send inside that server.</p>
      </article>

      <article class="panel policy-section" id="transfers">
        <p class="kicker">11</p>
        <h2>International transfers</h2>
        <p>The operator, Railway, Cloudflare, Discord, Google, Jina, and Digital Extremes may process data in the United States, Canada, the EU, or other countries. Those countries may not provide the same legal remedies as your home country. We transfer data because the services above are what this board uses, not because we sell a worldwide marketing list.</p>
      </article>

      <article class="panel policy-section" id="retention">
        <p class="kicker">12</p>
        <h2>How long we keep data</h2>
        <ul class="policy-bullets">
          <li><strong>Public listings</strong> until you or a moderator remove them, or you delete your account (which also removes your listings and uploads). A moderator hide takes a listing off the public board but keeps the owner’s record until it is removed.</li>
          <li><strong>Listing reports</strong> until an admin resolves them or the project is shut down. Deleting your account clears your reporter id from reports you filed; the report text can remain for moderation history.</li>
          <li><strong>Account records</strong> until you delete the account, or an admin deletes it for abuse or shutdown.</li>
          <li><strong>On-site messages</strong> until you leave the conversation or delete your account. Leaving a chat removes it from your inbox; the other person keeps their copy unless they leave too.</li>
          <li><strong>Sessions</strong> 30 days from issue, or until you sign out. Signing out removes that session token, and expired session records are deleted automatically. Other devices stay signed in until those sessions expire or you delete the account.</li>
          <li><strong>OAuth cookie</strong> 10 minutes.</li>
          <li><strong>Forum verification code</strong> on our side until you verify. The copy on Warframe Forums stays until you edit About Me.</li>
          <li><strong>Recruiter roster</strong> until you leave the listing, the owner removes you, the listing is deleted, or you delete your account, which withdraws you from every listing you recruited for.</li>
          <li><strong>Online status</strong> your chosen status until you change it or delete your account. The live “online right now” signal is memory-only: it expires about two and a half minutes after your last heartbeat, and a server restart clears it.</li>
          <li><strong>Admin grants</strong> until another admin revokes them. A Discord id waiting for first sign-in is dropped when that person signs in (it becomes an admin flag on their account) or when the grant is cancelled.</li>
          <li><strong>Theme</strong> in your browser until you clear it.</li>
          <li><strong>Message-alert choices</strong> in your browser until you clear them or turn the toggles off.</li>
          <li><strong>Recently viewed and browse filters</strong> in your browser until you clear them.</li>
          <li><strong>Saved listings and drafts</strong> in your browser, and on the account if you are signed in, until you unsave, publish, or delete the account.</li>
          <li><strong>Host logs and backups</strong> according to Railway’s systems, and Cloudflare’s logs for listing images on R2. A deleted account is removed from the live database we control, and its listing images are deleted from this host and from R2; a host backup from before deletion might exist until that backup rotates. We do not keep a separate marketing archive.</li>
        </ul>
      </article>

      <article class="panel policy-section" id="security">
        <p class="kicker">13</p>
        <h2>Security</h2>
        <p>No website is perfectly secure. Measures we do use:</p>
        <ul class="policy-bullets">
          <li>HTTPS in production, Secure and HTTP-only session cookies, SameSite=Lax</li>
          <li>Passwords stored as hashes, not plain text</li>
          <li>Discord tokens not saved after login</li>
          <li>Production posting requires Discord (minimum account age, default 7 days) and a verified forum profile</li>
          <li>Upload type and size limits, checked against the file type rather than its name</li>
          <li>Uploads are served as inert downloads, so a file cannot run code on this site</li>
          <li>Rate limits on sign-in, sign-up, verification checks, listing creates, and reports</li>
          <li>Post HTML is sanitized before display</li>
        </ul>
        <p>Do not reuse a unique password you care about on a local demo login. Production sign-in is Discord, not a password you invent for this site.</p>
      </article>

      <article class="panel policy-section" id="children">
        <p class="kicker">14</p>
        <h2>Children</h2>
        <p>This site is a game-recruitment board. It is not directed at children under 13, and we do not knowingly collect personal information from children under 13. Discord’s and Warframe’s own age rules also apply. If you believe a child under 13 created an account here, use account deletion if you control it, or contact us via the GitHub repository so we can remove it.</p>
      </article>

      <article class="panel policy-section" id="opt-out">
        <p class="kicker">15</p>
        <h2>Your rights and how to opt out</h2>
        <p>You can do almost everything yourself. You do not need to email us to stop posting, to leave the site, or to erase an ordinary account.</p>

        <h3>If you only browse</h3>
        <ul class="policy-bullets">
          <li><strong>Do nothing.</strong> There is no account to delete.</li>
          <li><strong>Opt out of the theme store.</strong> Clear this site’s cookies and local storage, or use your browser’s site-data controls. The light/dark switch will forget your choice.</li>
          <li><strong>Opt out of message alerts.</strong> Turn Sound ping and Desktop alert off in the account menu, or revoke this site’s notification permission in your browser. Those alerts only fire while the site is open; we do not send them after you close the tab.</li>
          <li><strong>Opt out of Google Fonts.</strong> Block <code>fonts.googleapis.com</code> and <code>fonts.gstatic.com</code> with a browser extension or network filter. Pages still load.</li>
          <li><strong>Opt out of host logs.</strong> You cannot fully opt out of the fact that visiting a website creates a request. Use a VPN if you want to hide your IP from the host. We still will not put that IP in our app database.</li>
        </ul>

        <h3>If you signed in</h3>
        <div class="policy-table-wrap">
          <table class="policy-table">
            <thead>
              <tr><th>Goal</th><th>How</th></tr>
            </thead>
            <tbody>
              <tr><td>Stop this browser from being signed in</td><td>Click Sign out. That clears <code>wfr_session</code> and drops that session from our database.</td></tr>
              <tr><td>See what we store</td><td>Open <a href="/account" data-link>your account</a> and download a JSON copy with Download my data.</td></tr>
              <tr><td>Correct listing text, Discord invite, or images</td><td>Edit the listing from your account page.</td></tr>
              <tr><td>Take a listing off the board</td><td>Pause recruiting (hides Discord) or remove it from your account page. Removing deletes that post’s uploads. A moderator can hide a listing from the public board without deleting it.</td></tr>
              <tr><td>Report a listing</td><td>Open the listing URL and use Report this listing. You do not need an account.</td></tr>
              <tr><td>Stop appearing in the recruiter search</td><td>Delete the account. Verification is what puts you there, and it is also what lets you publish a listing or answer whispers, so there is no way to stay verified and stay out of it.</td></tr>
              <tr><td>Stop being verified on a forum URL</td><td>Delete the account, or paste a different profile URL (that resets verification). Also delete the code from Warframe Forum About Me.</td></tr>
              <tr><td>Erase the account</td><td>Delete my account on the account page. This removes your user row, sessions, listings you own, and those uploads. Admin accounts cannot use this button so the board cannot be locked out.</td></tr>
              <tr><td>Revoke Discord access</td><td>Discord → User Settings → Authorized Apps → remove WF Clan Recruit. Also delete the account here, or we will still have the Discord id we already stored until you delete.</td></tr>
              <tr><td>Object to Discord or forum checks</td><td>Do not sign in / do not verify. You can still browse. You cannot publish without them in production.</td></tr>
              <tr><td>Opt out of the forum reader</td><td>Do not click the verification check. We only call the reader when you ask us to confirm the code.</td></tr>
            </tbody>
          </table>
        </div>
        <p>Deleting the account cannot pull your post out of someone else’s screenshot, Discord, or search cache. It also cannot edit Warframe Forums; you must remove the About Me code there yourself.</p>
        <p>If a listing was copied before you removed it, ask that copy’s host. We can only control this site’s live database and upload folder.</p>
      </article>

      <article class="panel policy-section" id="california">
        <p class="kicker">16</p>
        <h2>California, other US state, and GDPR notes</h2>
        <p><strong>Categories collected</strong> (California-style): identifiers (username, Discord id, email, session token), customer records (account timestamps), internet activity (pages you request, at the host), user content (listings, uploads, and on-site messages), and inference limited to “this Discord account is old enough / email verified / forum code matched.” We do not collect precise geolocation, biometric, or payment data.</p>
        <p><strong>Sale and share.</strong> We do not sell personal information and we do not share it for cross-context behavioral advertising. There is no “Do Not Sell” cookie because we are not in that business. If that changes, this policy will change first.</p>
        <p><strong>Sensitive data.</strong> Discord email may be treated as personal information. We do not use it to infer health, union, or religious data. Do not put sensitive data in a public listing.</p>
        <p><strong>Retention</strong> is described above. <strong>Sources</strong> are you, Discord, and the public forum profile you point us at.</p>
        <p><strong>GDPR-style rights</strong> we support in product: access and portability (Download my data), rectification (edit listings; Discord name refreshes on next Discord login), erasure (delete account / remove listing), restriction and objection (stop using posting features, sign out, do not verify). We do not run automated advertising profiles.</p>
        <p>You may also complain to your local data protection authority. We would rather you use in-app deletion first because it is faster and does not require posting personal data on GitHub.</p>
      </article>

      <article class="panel policy-section" id="automated">
        <p class="kicker">17</p>
        <h2>Automated checks</h2>
        <p>These checks can refuse sign-in or posting without a human in the loop:</p>
        <ul class="policy-bullets">
          <li>Discord snowflake id used to estimate account age (default 7 days)</li>
          <li>Discord <code>verified</code> email required in production</li>
          <li>Forum About Me must contain your current code</li>
          <li>Discord invite lookup (reject invalid or expired invites on publish, bump, and a periodic re-check)</li>
          <li>Unique clan/alliance name and tag</li>
          <li>Stale listings (21 days without a bump hide Join Discord)</li>
          <li>Moderator hide (a listing can be taken off the public board without deleting the owner’s record)</li>
          <li>Listing, bump, report, and forum-check rate limits</li>
        </ul>
        <p>That is anti-abuse gating, not a credit score and not ad targeting. There is no appeal form inside the app. If you believe a check failed in error, sign in with a Discord account that meets the rules, wait the cooldown, or open a GitHub issue without posting secrets.</p>
      </article>

      <article class="panel policy-section" id="changes">
        <p class="kicker">18</p>
        <h2>Changes</h2>
        <p>If we add analytics, ads, new OAuth scopes, email newsletters, or a new host, we will update this page and the “Last updated” date. Material new tracking would also need a matching product change, which this policy would describe. Continued use after an update means the new text applies. If you disagree, sign out, delete the account, and stop using the site.</p>
      </article>

      <article class="panel policy-section" id="contact">
        <p class="kicker">19</p>
        <h2>Contact</h2>
        <p>Use in-app tools first: <a href="/account" data-link>account page</a> for download and deletion, Sign out in the header, and Remove on each listing.</p>
        <p>For operator issues, the public repository is <a href="https://github.com/hoeslovevid/wfclanrecruit" target="_blank" rel="noopener noreferrer">github.com/hoeslovevid/wfclanrecruit</a>. GitHub issues are public. Do not paste session cookies, Discord tokens, emails, or passwords there.</p>
        <p>This page is a description of our practices. It is not legal advice and does not create extra rights beyond applicable law and the controls we actually ship.</p>
      </article>

      <article class="panel policy-section" id="definitions">
        <p class="kicker">20</p>
        <h2>Definitions</h2>
        <dl class="policy-defs">
          <div><dt>Personal data</dt><dd>Information that identifies you or can reasonably be linked to you, such as a Discord id or email.</dd></div>
          <div><dt>Listing</dt><dd>A clan or alliance post on this board.</dd></div>
          <div><dt>Processor / service provider</dt><dd>A vendor that handles data for us, such as the host, not for its own advertising.</dd></div>
          <div><dt>Sell</dt><dd>Exchanging personal information for money. We do not do this.</dd></div>
          <div><dt>Share (CPRA)</dt><dd>Disclosing personal information for cross-context behavioral advertising. We do not do this.</dd></div>
          <div><dt>Session</dt><dd>A random token that proves you already signed in, kept in an HTTP-only cookie.</dd></div>
        </dl>
        <div class="row guide-actions">
          <a class="btn btn-primary" href="/browse" data-link>Back to the board</a>
          <a class="btn btn-ghost" href="/account" data-link>Account and data controls</a>
        </div>
      </article>
    </section>
  `;
}
