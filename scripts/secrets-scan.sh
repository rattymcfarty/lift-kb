#!/bin/bash
# Secret / PII scanner for a PUBLIC repository. No dependencies (bash + git + grep).
#
#   scripts/secrets-scan.sh            scan what is STAGED (used by the pre-commit hook)
#   scripts/secrets-scan.sh --tree     scan every tracked file in the working tree
#   scripts/secrets-scan.sh --history  scan every commit's added lines + author emails
#
# Exit 0 = clean, 1 = findings. Add the marker  secrets-scan:allow  on a line
# to waive a deliberate, reviewed match (e.g. a documented placeholder).
set -uo pipefail
# Run the last stage of a pipeline in the current shell, so findings recorded
# by `report` inside `| while read` loops are not lost to a subshell.
shopt -s lastpipe
cd "$(git rev-parse --show-toplevel)"
MODE="${1:---staged}"

# Files that may legitimately be named like secrets (they are scripts/docs ABOUT secrets).
EXCLUDE_RE='^(scripts/secrets-scan\.sh|scripts/hooks/)'
NAME_RE='(\.jks|\.keystore|\.p12|\.pfx|\.pem|\.key|\.p8|\.mobileprovision|\.provisionprofile|\.enc)$|(^|/)(credentials\.json|google-services\.json|GoogleService-Info\.plist|gradle\.properties|local\.properties|id_rsa[^/]*|\.env(\..*)?)$'
CONTENT_RE='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(storePassword|keyPassword|STORE_PASSWORD|KEY_PASSWORD)[[:space:]]*[=:][[:space:]]*["'"'"']?[A-Za-z0-9+/_-]{8,}'
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
EMAIL_OK='(users\.noreply\.github\.com|noreply@anthropic\.com|@example\.(com|org)|@localhost|git@stash|@types/|@expo|@react|@babel|@drizzle|@testing|@[a-z-]+/)'
IP_RE='\b(192\.168\.[0-9]{1,3}\.[0-9]{1,3}|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3})\b'
fail=0
report() { echo "  ✗ $*"; fail=1; }

scan_text() { # $1 = label, stdin = lines of "path:line:text"
  local label="$1" line
  while IFS= read -r line; do
    [[ "$line" == *"secrets-scan:allow"* ]] && continue
    report "$label: $line"
  done
}

files_for_mode() {
  case "$MODE" in
    --staged) git diff --cached --name-only --diff-filter=ACMR ;;
    --tree)   git ls-files ;;
  esac
}

if [ "$MODE" = "--history" ]; then
  echo "scanning full history…"
  git log --all --diff-filter=A --name-only --format= | sort -u | grep -E -e "$NAME_RE" | grep -vE -e "$EXCLUDE_RE" \
    | while read -r f; do report "history: sensitive filename was committed: $f"; done
  # added lines only
  git log --all -p --no-color -U0 --format='@@commit %h' \
    | awk '/^@@commit /{c=$2} /^\+\+\+ b\//{f=substr($0,7)} /^\+[^+]/{print c" "f":"substr($0,2)}' \
    | grep -vE -e " (package-lock\.json|assets/kb/snapshot/)" \
    | grep -E -e "$CONTENT_RE" | scan_text "history: secret-like value"
  git log --all --format='%ae' | sort -u | grep -vE -e "$EMAIL_OK" \
    | while read -r e; do report "history: commit author email not on the allow-list: $e (see lift-app docs/ops/SECRETS_POLICY.md §4)"; done
else
  files="$(files_for_mode)"
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    [[ "$f" =~ $EXCLUDE_RE ]] && continue
    [ -f "$f" ] || continue
    if [[ "$f" =~ $NAME_RE ]]; then report "sensitive filename: $f"; continue; fi
    case "$f" in *.png|*.jpg|*.jpeg|*.webp|*.ttf|*.otf|*.ico|*.zip|*.gz|*.apk|*.aab) continue;; esac
    grep -nIE -e "$CONTENT_RE" -- "$f" 2>/dev/null | sed "s#^#$f:#" | scan_text "secret-like value"
    grep -nIE -e "$EMAIL_RE" -- "$f" 2>/dev/null | grep -vE -e "$EMAIL_OK" | sed "s#^#$f:#" | scan_text "personal email"
    grep -nIE -e "$IP_RE" -- "$f" 2>/dev/null | sed "s#^#$f:#" | scan_text "private IP address"
  done <<< "$files"
fi

if [ "$fail" -ne 0 ]; then
  echo "secrets-scan: FAILED — fix the items above (or add the marker 'secrets-scan:allow' to a reviewed line)."
  exit 1
fi
echo "secrets-scan: clean ($MODE)"
