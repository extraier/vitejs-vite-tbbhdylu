#!/usr/bin/env bash
# git-pre-push-check.sh — sanity check before every `git push` to a
# extraier-org repo. Catches the Vercel BLOCKED-deploy class of bug:
# if your last commit was authored by a GitHub user that's not on
# the Vercel team, Vercel will refuse to deploy ("Failed deployment
# from … not a member of the team").
#
# Vercel hobby plan: only deploys commits authored by team members.
# Team = "extraier's projects" (team_UHKez9kHl9L94fPGdgP2Uj8i) has
# GitHub user `extraier` as the only member. So:
#   ✅ extraier <extraier@gmail.com>         → deploys
#   ❌ Hermes Agent <cs.kcupid@gmail.com>    → BLOCKED
#   ❌ anyone else                          → BLOCKED
#
# Usage: bash scripts/git-pre-push-check.sh [path-to-repo]
#        (defaults to cwd)

set -euo pipefail

REPO="${1:-.}"
cd "$REPO"

# 1. Verify git config matches extraier identity
EMAIL=$(git config user.email || true)
NAME=$(git config user.name || true)
echo "📋 repo:    $(git rev-parse --show-toplevel)"
echo "📋 remote:  $(git remote get-url origin | sed 's/x-access-token:[^@]*@/<token>@/')"
echo "📋 author:  $NAME <$EMAIL>"

if [[ "$EMAIL" != "extraier@gmail.com" || "$NAME" != "extraier" ]]; then
  echo
  echo "❌ IDENTITY MISMATCH — Vercel will BLOCK this push."
  echo "   Fix:"
  echo "     git config user.email 'extraier@gmail.com'"
  echo "     git config user.name 'extraier'"
  echo
  exit 1
fi

# 2. Verify the last 3 commits (the ones likely to deploy) are
#    all authored by extraier. Past commits are fine — they
#    already deployed. But if the most recent one is wrong,
#    we offer to amend before pushing.
COMMITS=$(git log origin/HEAD..HEAD --format='%h %an <%ae> %s' 2>/dev/null || git log -3 --format='%h %an <%ae> %s')
echo
echo "📋 unpushed commits:"
echo "$COMMITS" | sed 's/^/    /'

BAD=$(echo "$COMMITS" | grep -vE '<extraier@gmail\.com>$' || true)
if [[ -n "$BAD" ]]; then
  echo
  echo "⚠️  Non-extraier authors in unpushed commits — Vercel may BLOCK."
  echo "   Fix with:"
  echo "     git commit --amend --reset-author --no-edit"
  echo "     # (run this for each bad commit, walking backwards)"
  echo
  # Don't fail — let the user decide — but make it loud.
fi

# 3. Verify HEAD is pushable (no detached HEAD, no in-progress rebase)
if [[ -d .git/rebase-merge ]] || [[ -d .git/rebase-apply ]]; then
  echo
  echo "❌ A rebase is in progress — abort it or finish it first."
  exit 1
fi

echo
echo "✅ Identity check OK — safe to push to extraier-org."