# Agent Notes

## Updating `web-dist`

The CRS update script downloads prebuilt admin frontend assets from the
`web-dist` branch. After changing `web/admin-spa`, publish a fresh local build
to `web-dist`; do not build the frontend on the production server.

Use the fork remote for publishing. In this repository that remote is currently
named `dev` and points to `git@github.com:luokyme/claude-relay-service.git`.

Recommended flow:

```bash
# 1. Build locally from the source branch.
cd /home/lkm/ws/lkm/claude-relay-service/web/admin-spa
npm run build

# 2. Publish dist to web-dist without switching the source worktree.
cd /home/lkm/ws/lkm/claude-relay-service
git fetch dev web-dist

tmpdir=$(mktemp -d)
git worktree add --detach "$tmpdir" dev/web-dist

cd "$tmpdir"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
rsync -a --exclude='.git' /home/lkm/ws/lkm/claude-relay-service/web/admin-spa/dist/ ./

git add -A
git commit -m "build: update admin spa dist"
git push dev HEAD:web-dist

cd /home/lkm/ws/lkm/claude-relay-service
git worktree remove --force "$tmpdir"
```

If the build output is unchanged, skip the commit and remove the temporary
worktree:

```bash
git status --short
git worktree remove --force "$tmpdir"
```

After pushing `web-dist`, the server can update with:

```bash
cd /opt/crs/app
CRS_UPDATE_BRANCH=dev crs update
crs restart
```

The server repository must have `origin` set to the fork if it should consume
these custom builds:

```bash
git remote set-url origin https://github.com/luokyme/claude-relay-service.git
```
