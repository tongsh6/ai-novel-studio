#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: ./scripts/new_book.sh <BookSlug> [DisplayName]" >&2
  exit 1
fi

book_slug="$1"
display_name="${2:-$1}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
template_dir="$repo_root/books/_template"
target_dir="$repo_root/books/$book_slug"

if [[ ! -d "$template_dir" ]]; then
  echo "Template directory not found: $template_dir" >&2
  exit 1
fi

if [[ -e "$target_dir" ]]; then
  echo "Target already exists: $target_dir" >&2
  exit 1
fi

cp -R "$template_dir" "$target_dir"

while IFS= read -r file; do
  BOOK_NAME="$display_name" BOOK_SLUG="$book_slug" perl -0pi -e 's/__BOOK_NAME__/$ENV{BOOK_NAME}/g; s/__BOOK_SLUG__/$ENV{BOOK_SLUG}/g' "$file"
done < <(rg -l "__BOOK_NAME__|__BOOK_SLUG__" "$target_dir")

echo "Created book workspace: books/$book_slug"
