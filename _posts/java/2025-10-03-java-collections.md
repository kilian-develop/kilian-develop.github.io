---
layout: post
title: "Java Collections Framework 완벽 가이드"
date: 2025-10-03 23:45:00 +0900
categories: java
tags: [java, collections, data-structures]
---

Java Collections Framework의 주요 인터페이스와 구현체들을 살펴보겠습니다.

## List 인터페이스

순서가 있는 컬렉션으로, 중복 요소를 허용합니다.

### ArrayList
- 동적 배열 구조
- 인덱스 기반 빠른 접근
- 삽입/삭제 시 요소 이동 필요

```java
List<String> arrayList = new ArrayList<>();
arrayList.add("Hello");
arrayList.add("World");
```

### LinkedList
- 이중 연결 리스트 구조
- 삽입/삭제가 빠름
- 인덱스 접근 시 순차 탐색 필요

## Set 인터페이스

중복을 허용하지 않는 컬렉션입니다.

### HashSet
- 해시 테이블 기반
- O(1) 평균 시간 복잡도

### TreeSet
- 이진 탐색 트리 기반
- 정렬된 순서 유지

## Map 인터페이스

키-값 쌍을 저장하는 컬렉션입니다.