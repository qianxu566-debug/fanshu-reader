set -euo pipefail
git add -- history/*.json.gz
if git diff --cached --quiet; then exit 0; fi
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
git commit -m "保存番茄每日实测记录 $(TZ=Asia/Shanghai date +%F)"
git pull --rebase origin main
git push origin HEAD:main
