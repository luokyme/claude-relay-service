#!/bin/bash

# Build web/admin-spa and publish the generated dist files to the web-dist branch.
# The script uses a temporary git worktree so the current working tree is not switched.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

REMOTE="${REMOTE:-}"
BRANCH="${BRANCH:-web-dist}"
SOURCE_BRANCH="${SOURCE_BRANCH:-dev}"
PUSH_MODE="${PUSH_MODE:-force-with-lease}"
COMMIT_MESSAGE="${COMMIT_MESSAGE:-}"
SKIP_INSTALL="${SKIP_INSTALL:-false}"

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

show_help() {
    cat <<EOF
用法: $0 [选项]

构建 web/admin-spa 并推送 dist 到 web-dist 分支。

选项:
  --remote <name>       Git remote，默认: 当前分支 upstream remote，无法识别时使用 origin
  --source-branch <name>源码分支，默认: dev
  --branch <name>       发布分支，默认: web-dist
  --message <message>   自定义提交信息
  --no-install          跳过依赖安装检查
  --push-mode <mode>    push 模式: force-with-lease | force | normal，默认: force-with-lease
  -h, --help            显示帮助

环境变量也可用:
  REMOTE=dev SOURCE_BRANCH=dev BRANCH=web-dist COMMIT_MESSAGE="build: xxx" $0
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --remote)
            REMOTE="${2:-}"
            shift 2
            ;;
        --branch)
            BRANCH="${2:-}"
            shift 2
            ;;
        --source-branch)
            SOURCE_BRANCH="${2:-}"
            shift 2
            ;;
        --message)
            COMMIT_MESSAGE="${2:-}"
            shift 2
            ;;
        --no-install)
            SKIP_INSTALL=true
            shift
            ;;
        --push-mode)
            PUSH_MODE="${2:-}"
            shift 2
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            print_error "未知选项: $1"
            show_help
            exit 1
            ;;
    esac
done

if [[ "$PUSH_MODE" != "force-with-lease" && "$PUSH_MODE" != "force" && "$PUSH_MODE" != "normal" ]]; then
    print_error "--push-mode 只支持 force-with-lease | force | normal"
    exit 1
fi

command -v git >/dev/null 2>&1 || {
    print_error "未找到 git"
    exit 1
}

command -v npm >/dev/null 2>&1 || {
    print_error "未找到 npm"
    exit 1
}

ROOT_DIR="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$ROOT_DIR" ]; then
    print_error "请在 Git 仓库内运行"
    exit 1
fi

cd "$ROOT_DIR"

if [ -z "$REMOTE" ]; then
    CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || true)"
    if [ -n "$CURRENT_BRANCH" ]; then
        REMOTE="$(git config --get "branch.${CURRENT_BRANCH}.remote" || true)"
    fi
    REMOTE="${REMOTE:-origin}"
fi

if [ -z "$REMOTE" ] || [ -z "$BRANCH" ] || [ -z "$SOURCE_BRANCH" ]; then
    print_error "remote、source branch 和 publish branch 不能为空"
    exit 1
fi

if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
    print_error "Git remote 不存在: $REMOTE"
    exit 1
fi

if [ ! -f "web/admin-spa/package.json" ]; then
    print_error "未找到 web/admin-spa/package.json，请在项目仓库运行"
    exit 1
fi

TEMP_ARTIFACT_DIR=""
TEMP_WORKTREE_DIR=""
LOCAL_BRANCH=""

cleanup() {
    if [ -n "$TEMP_WORKTREE_DIR" ] && [ -d "$TEMP_WORKTREE_DIR" ]; then
        git worktree remove --force "$TEMP_WORKTREE_DIR" >/dev/null 2>&1 || true
    fi
    if [ -n "$LOCAL_BRANCH" ]; then
        git branch -D "$LOCAL_BRANCH" >/dev/null 2>&1 || true
    fi
    if [ -n "$TEMP_ARTIFACT_DIR" ] && [ -d "$TEMP_ARTIFACT_DIR" ]; then
        rm -rf "$TEMP_ARTIFACT_DIR"
    fi
}
trap cleanup EXIT

PUSH_URL="$(git remote get-url --push "$REMOTE")"
DIST_COMMIT=""
DIST_DATE=0

if ! git show-ref --verify --quiet "refs/heads/$SOURCE_BRANCH"; then
    print_error "本地源码分支不存在: $SOURCE_BRANCH"
    exit 1
fi

print_info "发布目标: $REMOTE/$BRANCH ($PUSH_URL)"
print_info "先推送源码分支: $SOURCE_BRANCH -> $REMOTE/$SOURCE_BRANCH"
git push "$REMOTE" "$SOURCE_BRANCH:$SOURCE_BRANCH"

print_info "读取远程源码分支最新提交..."
git fetch "$REMOTE" "$SOURCE_BRANCH"
SOURCE_COMMIT_FULL="$(git rev-parse FETCH_HEAD)"
SOURCE_COMMIT="$(git rev-parse --short FETCH_HEAD)"
SOURCE_DATE="$(git log -1 --format=%ct FETCH_HEAD)"
SOURCE_DATE_TEXT="$(git log -1 --format=%ci FETCH_HEAD)"
SOURCE_MESSAGE="$(git log -1 --format=%s FETCH_HEAD)"

if git ls-remote --exit-code --heads "$REMOTE" "$BRANCH" >/dev/null 2>&1; then
    print_info "读取远程发布分支最新提交: $REMOTE/$BRANCH"
    git fetch "$REMOTE" "$BRANCH"
    DIST_COMMIT="$(git rev-parse FETCH_HEAD)"
    DIST_DATE="$(git log -1 --format=%ct FETCH_HEAD)"
    DIST_DATE_TEXT="$(git log -1 --format=%ci FETCH_HEAD)"

    if [ "$SOURCE_DATE" -le "$DIST_DATE" ]; then
        print_success "$BRANCH 已是最新，无需构建"
        echo "  $SOURCE_BRANCH: $SOURCE_COMMIT_FULL ($SOURCE_DATE_TEXT)"
        echo "  $BRANCH: $DIST_COMMIT ($DIST_DATE_TEXT)"
        exit 0
    fi
else
    print_warning "远程分支 $REMOTE/$BRANCH 不存在，将创建"
fi

BUILD_TIME="$(date -u +"%Y-%m-%d %H:%M:%S UTC")"
print_info "构建前端..."
(
    cd web/admin-spa

    if [ "$SKIP_INSTALL" != "true" ] && [ ! -d "node_modules" ]; then
        if [ -f "package-lock.json" ]; then
            print_info "安装前端依赖: npm ci"
            npm ci
        else
            print_info "安装前端依赖: npm install"
            npm install
        fi
    fi

    npm run build
)

if [ ! -f "web/admin-spa/dist/index.html" ]; then
    print_error "构建失败，未找到 web/admin-spa/dist/index.html"
    exit 1
fi

TEMP_ARTIFACT_DIR="$(mktemp -d)"
print_info "复制构建产物到临时目录: $TEMP_ARTIFACT_DIR"
if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete web/admin-spa/dist/ "$TEMP_ARTIFACT_DIR/"
else
    cp -R web/admin-spa/dist/. "$TEMP_ARTIFACT_DIR/"
fi

echo "$SOURCE_COMMIT_FULL" > "$TEMP_ARTIFACT_DIR/SOURCE_COMMIT"
cat > "$TEMP_ARTIFACT_DIR/README.md" <<EOF
# Claude Relay Service - Web Frontend Build

This branch contains pre-built frontend assets for Claude Relay Service.

Do not edit files in this branch directly.

- Source branch: $SOURCE_BRANCH
- Source commit: $SOURCE_COMMIT_FULL
- Source commit date: $SOURCE_DATE_TEXT
- Build time: $BUILD_TIME
EOF

print_info "准备临时 worktree..."
TEMP_WORKTREE_DIR="$(mktemp -d)"
rm -rf "$TEMP_WORKTREE_DIR"
LOCAL_BRANCH="publish-${BRANCH//\//-}-$$"

if [ -n "$DIST_COMMIT" ]; then
    print_info "基于远程发布分支创建临时 worktree: $REMOTE/$BRANCH"
    git worktree add -B "$LOCAL_BRANCH" "$TEMP_WORKTREE_DIR" "$DIST_COMMIT"
else
    print_warning "创建 orphan 发布分支 worktree"
    git worktree add --detach "$TEMP_WORKTREE_DIR" HEAD
    (
        cd "$TEMP_WORKTREE_DIR"
        git checkout --orphan "$LOCAL_BRANCH"
    )
fi

print_info "写入 web-dist 内容..."
set +e
(
    cd "$TEMP_WORKTREE_DIR"
    git rm -rf . >/dev/null 2>&1 || true
    find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +

    if command -v rsync >/dev/null 2>&1; then
        rsync -a --delete --exclude='.git' "$TEMP_ARTIFACT_DIR/" ./
    else
        cp -R "$TEMP_ARTIFACT_DIR"/. ./
    fi

    git add -A

    if git diff --cached --quiet; then
        print_success "web-dist 没有变化，无需推送"
        exit 20
    fi

    if [ -z "$COMMIT_MESSAGE" ]; then
        COMMIT_MESSAGE="$SOURCE_MESSAGE"
    fi

    git commit -m "$COMMIT_MESSAGE"

    case "$PUSH_MODE" in
        force-with-lease)
            if [ -n "$DIST_COMMIT" ]; then
                git push --force-with-lease="refs/heads/$BRANCH:$DIST_COMMIT" "$REMOTE" "HEAD:$BRANCH"
            else
                git push "$REMOTE" "HEAD:$BRANCH"
            fi
            ;;
        force)
            git push --force "$REMOTE" "HEAD:$BRANCH"
            ;;
        normal)
            git push "$REMOTE" "HEAD:$BRANCH"
            ;;
    esac
)
status=$?
set -e
if [ "$status" -eq 20 ]; then
    exit 0
fi
if [ "$status" -ne 0 ]; then
    print_error "发布 web-dist 失败"
    exit "$status"
fi

print_success "已构建并推送到 $REMOTE/$BRANCH"
