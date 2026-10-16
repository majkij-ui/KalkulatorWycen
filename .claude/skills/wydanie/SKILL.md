---
name: wydanie
description: Release routine for the NonoiseMedia Hub, run by the main session — fetch, merge finished session branches into v3/project-hub in a sensible order, test and type-check, compare real data read-only before vs after, build the desktop app, swap it into /Applications only while the hub is closed, update the plan doc and report. Use when M.J. says „wydanie", „zrób wydanie", „scal i zainstaluj", „release" or asks to merge sessions and install the new hub.
---

# Wydanie (merge → check → build → install)

Only the main session releases. Feature sessions push their own `claude/…` branch and never merge, write
the real data folder or install the app.

Hard rules:
- **Real data is read-only** in this routine: `~/Library/Application Support/com.michal.nonoisehub/`.
  Record `shasum` + mtimes of `*.json` before and after the checks; they must be identical.
- **Never delete the installed app**: move it aside, then copy the new one.
- **The hub must be closed** before swapping the app (it keeps data in memory and saves on close).
- Doc conflicts: keep both sides. Code conflicts: understand both changes; ask M.J. if a rule differs.
- Commits end with the `Co-Authored-By` line from the session's attribution reminder.

## 1. Fetch and pick the branches

```bash
git fetch origin
```

```bash
git log --oneline origin/v3/project-hub..origin/<branch>
```

List the finished session branches (their notes / „as built" sections say what they changed). Merge
order: foundations first (data/storage, e.g. F1), then independent features, then whatever builds on
them (plan §4 tables say what needs what). Two branches touching the same screen: the smaller one first.

## 2. Merge in the main checkout

Main checkout: `/Users/michal/Documents/VibeCoding/QuoteGen` on `v3/project-hub` (its `src-tauri/target`
is warm; a worktree build compiles Rust from scratch). It must be clean (`git status`).

```bash
git merge --ff-only origin/v3/project-hub
```

```bash
git merge --no-ff origin/<branch> -m "Merge <session> into v3/project-hub"
```

Typical conflicts and what to do:
- `docs/PLAN-*.md` „as built" sections, `ARCHITECTURE.md`: keep both sides, in merge order.
- `SCHEMAS` in `scripts/data.mts`, `AUTO_BACKUP_FILES` in `lib/auto-backup.ts`: keep every entry
  (a new collection must be in both — `auto-backup.test.ts` checks the backup list).
- `src-tauri/capabilities/default.json`: union of the permissions, keep both descriptions.
- `git commit` without paths also takes anything already staged; check `git show --stat` before pushing.

After each merge run the tests (step 3) before the next one, so a failure points at one branch.

## 3. Tests and types

```bash
npm test
```

```bash
npx tsc --noEmit
```

Both must pass with **0 errors**. Note the test count for the report.

## 4. Real data, read-only: before vs after

Record the data folder first (own command, nothing else in it):

```bash
cd "$HOME/Library/Application Support/com.michal.nonoisehub" && shasum *.json && ls -lT *.json
```

Make a scratch worktree of the previous release (the commit before the merges) in the session
scratchpad, link `node_modules`, and run the check script with each tree:

```bash
git worktree add --detach "$SCRATCH/old" <previous-release-sha>
```

```bash
ln -s "$PWD/node_modules" "$SCRATCH/old/node_modules"
```

```bash
CHECK_TODAY=$(date +%F) node --import "$SCRATCH/old/scripts/register-ts.mjs" .claude/skills/wydanie/real-data-check.mts "$SCRATCH/old" > "$SCRATCH/old.json"
```

```bash
CHECK_TODAY=$(date +%F) node --import ./scripts/register-ts.mjs .claude/skills/wydanie/real-data-check.mts . > "$SCRATCH/new.json"
```

Compare: every saved quote's `computed` financials (sumaNetto, koszty, podatek, zysk, marzaPct) old vs
new, and new vs `stored`; Finance per year (revenue, tax, costs, profit, plan, fixed costs). Any
difference must be explained by a merged change that intends it (say which), otherwise stop and
investigate. If a merge changes what Finance shows, update the script to call the same functions as
`components/finance/finance-section.tsx`. Then re-run the `shasum` command: identical to before.
Remove the scratch worktree (`rm` the `node_modules` link, `git worktree remove`).

## 5. Build

```bash
npm run tauri:build
```

Building is fine while the hub runs. The bundle lands in `src-tauri/target/release/bundle/macos/`.

## 6. Install (only with the hub closed)

Check as its **own** command — `pgrep -f` matches the text of the command that runs it, so a compound
command that also contains the app path reports a false „open":

```bash
pgrep -fl "NonoiseMedia Hub"
```

Output = the hub is open: ask M.J. to close it (Cmd+Q) and check again. Never kill it. Empty = closed:

```bash
APP="/Applications/NonoiseMedia Hub.app"; NEW="src-tauri/target/release/bundle/macos/NonoiseMedia Hub.app"; ASIDE="$SCRATCH/NonoiseMedia Hub.previous-$(date +%Y%m%d-%H%M).app"; mv "$APP" "$ASIDE" && ditto "$NEW" "$APP" && cmp "$NEW/Contents/MacOS/app" "$APP/Contents/MacOS/app" && echo INSTALLED
```

(Use the variables; check the binary name in `Contents/MacOS/` if `cmp` can't find it.)

## 7. Push and update the plan

```bash
git push origin v3/project-hub
```

In the plan doc (`docs/PLAN-AFTER-TEST-DRIVE.md` §4, „Merged and installed …" paragraph): date, branches
in merge order, conflicts and how they were resolved, test count, real-data results (quotes identical,
Finance year totals), what is waiting for M.J. (patches not applied, desktop-only checks). Commit and push.

## 8. Report to M.J. (short, Polish is fine)

- what was merged, in which order; conflicts;
- tests / tsc;
- real data: N quotes identical, Finance year totals (before = after, or the intended difference);
- installed: yes / waiting for the hub to close; where the previous app was moved;
- the desktop-only checks from each branch's „as built" section, as a list for M.J. to click through
  (e.g. F1: `backups/auto-…` folder appears at start, `company.json` created on the first start and read
  after a restart).
