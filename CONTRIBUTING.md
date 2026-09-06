# Working on this repo

Two people push here. `main` is the deploy branch — Railway builds and releases
every commit that lands on it — so a push to `main` is a production release,
not a save point.

## Branch, then open a PR

```bash
git switch -c short-topic-name     # e.g. listing-feedback, hide-posts
# ...work...
git push -u origin short-topic-name
gh pr create --fill
```

Merge the PR when it is ready. That merge is the deploy.

Do not commit straight to `main`. Not because of ceremony — because both of us
have now rewritten large parts of `src/views.js`, `src/main.js` and
`server/index.js` in the same week. Two of those landed as conflicts that had to
be resolved by hand after the fact. A PR surfaces that overlap before either
side is finished, when it is still cheap to talk about.

## Before you open the PR

```bash
node --test server/*.test.js src/*.test.js
npm run build
```

Both must be clean. There is no CI, so this is the only gate.

Run the app and click through whatever you changed:

```bash
npm run dev        # http://localhost:5173, sign in as leader / recruit1
```

## When main has moved under you

```bash
git fetch origin
git rebase origin/main
```

Resolve, re-run the tests and the build, then push. Prefer this to a merge
commit — the history here is linear and worth keeping that way.

## Notes

- `data/db.json` and `uploads/` are gitignored. Local listings you create while
  testing stay local; delete them when you are done so the dev board is not
  full of "Test Clan".
- Listings written before a schema change still have to render. When you add a
  field, read it through a helper that copes with its absence — see
  `videoList()` in `src/video.js` for the shape — rather than migrating rows.
- The client and the server share `src/data.js`, `src/richtext.js` and
  `src/video.js`. Validation lives there precisely so the two cannot drift.
