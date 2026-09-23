#!/usr/bin/env bash
# One-time setup for npm trusted publishing (see docs/releasing.md).
# Publishes packages that do not exist on npm yet, attaches the release.yml trusted
# publisher to each package, and lets GitHub Actions create pull requests. Safe to re-run.
set -euo pipefail

REGISTRY="https://registry.npmjs.org/"
REPO="birdcar/pi-extensions"
WORKFLOW="release.yml"
NPM_TRUST=(npx --yes npm@11.20.0 trust)
# In publish order (write-for depends on services); new packages must be added here.
PACKAGES=(packages/services packages/write-for)

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "!! run this from inside $REPO" >&2
  exit 1
}
cd "$ROOT"

for tool in node npm npx bun gh curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "!! $tool is required" >&2
    exit 1
  fi
done
if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "!! run gh auth login first" >&2
  exit 1
fi

pkg_field() { node -p "require('./$1/package.json').$2"; }
http_status() { curl -s -o /dev/null -w '%{http_code}' "$1" || true; }

if ! npm_user="$(npm whoami --registry="$REGISTRY" 2>/dev/null)"; then
  echo "== not logged in to $REGISTRY, running npm login"
  npm login --registry="$REGISTRY" || true
  if ! npm_user="$(npm whoami --registry="$REGISTRY" 2>/dev/null)"; then
    echo "!! npm login did not complete" >&2
    exit 1
  fi
fi
echo "== logged in to npm as $npm_user"

# Only a definite 404 counts as missing, so an unreachable registry never leads to a publish.
missing=()
for dir in "${PACKAGES[@]}"; do
  name="$(pkg_field "$dir" name)"
  code="$(http_status "$REGISTRY${name/\//%2f}")"
  case "$code" in
    200) echo "== $name is already on npm, skipping publish" ;;
    404)
      echo "== $name is not on npm yet"
      missing+=("$dir")
      ;;
    *)
      echo "!! could not check $name on $REGISTRY (HTTP $code)" >&2
      exit 1
      ;;
  esac
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "== running bun run check before publishing"
  if ! bun run check; then
    echo "!! bun run check failed, nothing was published" >&2
    exit 1
  fi
fi

echo "== if npm asks for 2FA, choose \"skip for 5 minutes\" on the npm website so the remaining calls run without further prompts"

# A failed publish is re-checked on the version endpoint: the package document can 404 on a
# lagging read replica right after a publish, while the version endpoint reads authoritatively.
published=
for dir in ${missing[@]+"${missing[@]}"}; do
  name="$(pkg_field "$dir" name)"
  version="$(pkg_field "$dir" version)"
  echo "== publishing $name@$version"
  if (cd "$dir" && npm publish --access public --registry="$REGISTRY"); then
    published="${published:+$published,}$name"
  elif [ "$(http_status "$REGISTRY${name/\//%2f}/$version")" = 200 ]; then
    echo "== $name@$version showed up after the failed publish (replica lag), continuing"
  else
    echo "!! publish of $name failed" >&2
    exit 1
  fi
  sleep 2
done

# npm only asks for 2FA when stdin and stdout are a terminal and fails with EOTP otherwise, so
# `trust github` keeps stdout on the terminal (fd 3) while its stderr is captured, and a
# captured `trust list` that hits EOTP runs once more on the terminal to authenticate.
exec 3>&1
trust_list() { "${NPM_TRUST[@]}" list "$1" --registry="$REGISTRY"; }
login_hint() {
  echo "!! if npm rejected the token (tokens that bypass 2FA cannot manage trust), run npm login --registry=$REGISTRY and re-run" >&2
}

trusted=
for dir in "${PACKAGES[@]}"; do
  name="$(pkg_field "$dir" name)"
  listed=yes
  list="$(trust_list "$name" 2>&1)" || listed=
  if [ -z "$listed" ] && [ -t 0 ] && [ -t 1 ] && [[ $list == *EOTP* || $list == *"one-time pass"* ]]; then
    echo "== npm needs 2FA to read the trusted publishers of $name"
    trust_list "$name" || true
    listed=yes
    list="$(trust_list "$name" 2>&1)" || listed=
  fi
  if [ -n "$listed" ]; then
    if [[ $list == *"$REPO"* && $list == *"$WORKFLOW"* ]]; then
      echo "== $name already trusts $REPO ($WORKFLOW), skipping"
      continue
    fi
  else
    printf '%s\n' "$list" >&2
    answer=
    { printf 'Could not read trusted publishers for %s. Create one anyway? [y/N] ' "$name" >/dev/tty; } 2>/dev/null || true
    { read -r answer </dev/tty; } 2>/dev/null || true
    if [ "$answer" != y ]; then
      echo "!! not creating a trusted publisher for $name" >&2
      login_hint
      exit 1
    fi
  fi
  echo "== trusting $name -> $REPO ($WORKFLOW)"
  if err="$("${NPM_TRUST[@]}" github "$name" --file "$WORKFLOW" --repo "$REPO" --allow-publish --yes --registry="$REGISTRY" 2>&1 >&3)"; then
    trusted="${trusted:+$trusted,}$name"
  elif [[ $err == *E409* || $err == *"409 Conflict"* ]]; then
    echo "== $name already has a trusted publisher (409); verify it names $REPO $WORKFLOW"
  else
    printf '%s\n' "$err" >&2
    echo "!! trust failed for $name" >&2
    login_hint
    exit 1
  fi
  sleep 2
done

if ! prs="$(gh api "repos/$REPO/actions/permissions/workflow" --jq .can_approve_pull_request_reviews)"; then
  echo "!! could not read the Actions workflow permissions of $REPO" >&2
  exit 1
fi
if [ "$prs" = true ]; then
  actions="already enabled"
  echo "== GitHub Actions can already create pull requests in $REPO"
elif gh api -X PUT "repos/$REPO/actions/permissions/workflow" \
  -f default_workflow_permissions=read -F can_approve_pull_request_reviews=true >/dev/null; then
  actions=enabled
  echo "== allowed GitHub Actions to create pull requests in $REPO"
else
  echo "!! could not enable Actions pull-request creation" >&2
  exit 1
fi

echo "== done: published=${published:-none}; trusted=${trusted:-none}; actions-prs=$actions"
