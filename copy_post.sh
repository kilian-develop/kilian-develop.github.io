#!/bin/bash

# Usage: ./copy_post.sh "파일명" "카테고리명"
# Example: ./copy_post.sh "Datadog Trace 적용기.md" "apm"

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 \"파일명\" \"카테고리명\""
    echo "Example: $0 \"Datadog Trace 적용기.md\" \"apm\""
    exit 1
fi

FILENAME="$1"
CATEGORY="$2"

# .md 확장자가 없으면 추가
if [[ ! "$FILENAME" =~ \.md$ ]]; then
    FILENAME="${FILENAME}.md"
fi

# iCloud Obsidian 경로
OBSIDIAN_BASE="$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/kilian"

# 파일 검색
SOURCE_PATH=$(find "$OBSIDIAN_BASE" -name "$FILENAME" -type f | head -n 1)

# 대상 디렉토리
TARGET_DIR="_posts/$CATEGORY"

# 파일 존재 확인
if [ -z "$SOURCE_PATH" ]; then
    echo "Error: 파일을 찾을 수 없습니다: $FILENAME"
    echo "검색 경로: $OBSIDIAN_BASE"
    exit 1
fi

echo "파일 발견: $SOURCE_PATH"

# 카테고리 디렉토리 생성 (없으면)
if [ ! -d "$TARGET_DIR" ]; then
    echo "디렉토리 생성: $TARGET_DIR"
    mkdir -p "$TARGET_DIR"
fi

# 파일 복사
echo "파일 복사 중..."
cp "$SOURCE_PATH" "$TARGET_DIR/"

if [ $? -eq 0 ]; then
    echo "✓ 복사 완료: $TARGET_DIR/$FILENAME"
else
    echo "Error: 파일 복사 실패"
    exit 1
fi
