---
layout: post
title: "Spring Boot 시작하기"
date: 2025-10-03 23:00:00 +0900
categories: spring
tags: [java, spring-boot, backend]
---

Spring Boot를 사용하여 간단한 웹 애플리케이션을 만드는 방법에 대해 알아보겠습니다.

## Spring Boot란?

Spring Boot는 Spring 기반의 애플리케이션을 빠르고 쉽게 만들 수 있도록 도와주는 프레임워크입니다.

## 프로젝트 생성

Spring Initializr를 사용하여 프로젝트를 생성할 수 있습니다:

1. https://start.spring.io/ 접속
2. 필요한 의존성 선택
3. 프로젝트 다운로드

## 기본 구조

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

이렇게 간단하게 Spring Boot 애플리케이션을 시작할 수 있습니다.