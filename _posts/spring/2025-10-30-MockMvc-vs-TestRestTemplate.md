---
title: MockMvc vs TestRestTemplate
categories: Spring
layout: post
tags:
  - Spring
  - 테스트
date: 2025-10-30
excerpt: MockMvc와 TestRestTemplate의 차이점을 알아봅니다.
image_thumbnail: /assets/images/posts/SpringTestRestTemplate.jpg
---
# MockMvc vs TestRestTemplate, API 통합 테스트에서의 선택

## 문제 

Service 계층을 통합 테스트로 검증했습니다. 이제 API 계층도 테스트해야 했습니다.

API 테스트 방식을 찾다 보니 `MockMvc`와 `TestRestTemplate`이라는 두 가지 선택지가 있었습니다. 둘 다 Spring Boot에서 제공하는 테스트 도구인데, 어떤 차이가 있는지 명확하지 않았습니다.

- MockMvc는 빠르고 가볍지만, 정말 실제 API처럼 동작하는지 확신할 수 없었습니다
- TestRestTemplate은 실제 서버를 띄우는데, 그만한 가치가 있는지 의문이었습니다

API 계층은 **외부 클라이언트와의 계약**입니다. 
클라이언트는 HTTP를 통해 우리의 API를 호출합니다. 
그렇다면 테스트도 **실제 HTTP를 통해 이루어져야 하는 게 아닐까**라는 생각이 들었습니다.

## 다양한 시도

---

### MockMvc 방식: 모의 서블릿 환경에서의 테스트

MockMvc는 **Servlet Container 없이** DispatcherServlet을 직접 호출하는 방식입니다. 실제 서버를 띄우지 않고 웹 계층을 테스트합니다.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
public class UserApiMockMvcTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void 회원가입_테스트() throws Exception {
        mockMvc.perform(post("/api/v1/users/join")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                    {"identifier": "user123", "email": "user@example.com",
                     "birthday": "2000-01-15", "gender": "MALE"}
                    """))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.identifier").value("user123"));
    }
}
```

**MockMvc의 장점:**
- 실제 서버를 띄우지 않아서 테스트가 매우 빠릅니다
- DispatcherServlet을 직접 호출하므로 가볍습니다
- 컨트롤러 로직에 집중한 단위 테스트에 적합합니다

**MockMvc의 한계:**
- **Servlet Container가 없습니다** - 실제 웹 서버 환경을 시뮬레이션하지 않습니다
- 실제 네트워크 통신을 하지 않습니다
- 실제 HTTP 요청/응답 처리를 거치지 않습니다
- 직렬화/역직렬화가 모의 환경에서만 검증됩니다
- HTTP 프로토콜의 모든 세부사항을 완전히 검증할 수 없습니다
- Servlet Container에 의존하는 기능(필터, 서블릿, 인터셉터의 실제 순서 등)을 온전히 테스트하지 못합니다

---

### TestRestTemplate 방식: 실제 HTTP 통신을 통한 테스트

TestRestTemplate은 **실제 Servlet Container(예: Tomcat)를 띄우고**, 그 서버에 실제 HTTP 요청을 보내는 방식입니다. 즉, 클라이언트가 실제로 서버에 접근하는 것과 동일한 환경에서 테스트합니다.

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
public class UserApiTestRestTemplateTest {

    @Autowired
    private TestRestTemplate testRestTemplate;

    @Test
    void 회원가입_테스트() {
        // given
        UserV1Dto.JoinUserRequest request = new UserV1Dto.JoinUserRequest(
            "user123", "user@example.com", "2000-01-15", "MALE"
        );

        // when
        ResponseEntity<ApiResponse<UserV1Dto.JoinUserResponse>> response =
            testRestTemplate.postForEntity(
                "/api/v1/users/join",
                request,
                new ParameterizedTypeReference<ApiResponse<UserV1Dto.JoinUserResponse>>() {}
            );

        // then
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().data().identifier()).isEqualTo("user123");
    }
}
```

**TestRestTemplate의 장점:**
- 실제 임베디드 서버를 띄워서 테스트합니다
- 실제 HTTP 요청을 보내고 응답을 받습니다
- 전체 애플리케이션 스택(Controller → Service → Domain → Database)을 검증합니다
- 실제 클라이언트가 사용하는 것과 동일한 환경에서 테스트합니다
- HTTP 직렬화/역직렬화 문제를 조기에 발견할 수 있습니다

**TestRestTemplate의 한계:**
- 실제 서버를 띄워야 하므로 테스트 속도가 느립니다
- 더 많은 메모리와 리소스를 사용합니다

## 적용/채택한 방식

---

**나는 TestRestTemplate을 선택했습니다.**

### 이유 1: 계층별 테스트 전략이 명확했기 때문입니다

```
Domain 계층     → Unit 테스트 (도메인 규칙 검증)
Service 계층    → 통합 테스트 (비즈니스 시나리오 검증)
API 계층        → End-to-End 테스트 (HTTP 프로토콜 검증)
```

- **Domain 계층**: `UserTest.java`, `UserPointTest.java` 등으로 Unit 테스트를 작성했습니다
- **Service 계층**: `JoinUserServiceIntegrationTest.java`, `UserPointServiceIntegrationTest.java` 등으로 통합 테스트를 작성했습니다
- **API 계층**: Service 계층의 통합 테스트만으로는 HTTP 계층을 검증할 수 없습니다

### 이유 2: API 계층에서 검증해야 할 것들입니다

API 계층은 **클라이언트와 서버 간의 계약(HTTP 프로토콜)**입니다. 

다음을 검증해야 합니다:

1. **HTTP 요청 매핑**: API 라우팅이 제대로 되는가?
2. **DTO 직렬화/역직렬화**: JSON ↔ 객체 변환이 실제로 수행되는가?
3. **HTTP 상태 코드**: 정확한 HTTP 상태 코드를 반환하는가?
4. **응답 포맷**: 클라이언트가 기대하는 형식의 응답을 주는가?
5. **HTTP 헤더 처리**: 커스텀 헤더를 제대로 처리하는가?

이 모든 것을 **실제 HTTP 통신**에서 검증해야 합니다.

### 실제 코드 적용 예시

#### BaseClass: ApiIntegrationTest

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ExtendWith(MySqlTestContainersExtension.class)
public class ApiIntegrationTest {

    @Autowired
    protected TestRestTemplate testRestTemplate;

    @Autowired
    private DatabaseCleanUp databaseCleanUp;

    @AfterEach
    void databaseCleanUp() {
        databaseCleanUp.truncateAllTables();
    }
}
```

모든 API 통합 테스트가 상속하는 베이스 클래스입니다:
- `webEnvironment = RANDOM_PORT`: 실제 포트에서 임베디드 서버를 띄웁니다
- `@ExtendWith(MySqlTestContainersExtension.class)`: 실제 데이터베이스(테스트 컨테이너)에서 테스트합니다
- `@AfterEach`: 각 테스트 후 데이터베이스를 정리합니다

#### 회원가입 API 테스트

```java
@Nested
@DisplayName("회원가입")
class 회원가입 {

    @Nested
    @DisplayName("정상 요청인 경우")
    class 정상_요청인_경우 {

        @Test
        @DisplayName("생성된 유저의 정보를 반환한다.")
        void 생성된_유저의_정보를_반환한다() {
            // given
            UserV1Dto.JoinUserRequest request = new UserV1Dto.JoinUserRequest(
                    "user123",
                    "user@example.com",
                    "2000-01-15",
                    "MALE"
            );

            // when - 실제 HTTP POST 요청을 보냅니다
            ResponseEntity<ApiResponse<UserV1Dto.JoinUserResponse>> response =
                    testRestTemplate.exchange(
                            "/api/v1/users/join",
                            HttpMethod.POST,
                            new HttpEntity<>(request),
                            new ParameterizedTypeReference<>() {}
                    );

            // then - 실제 HTTP 응답을 검증합니다
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody()).isNotNull();
                        assertThat(response.getBody().data().identifier()).isEqualTo("user123");
            assertThat(response.getBody().data().email()).isEqualTo("user@example.com");
            assertThat(response.getBody().data().birthday()).isEqualTo("2000-01-15");
            assertThat(response.getBody().data().gender()).isEqualTo("MALE");
        }
    }
}
```

#### 커스텀 헤더 처리 테스트

MockMvc도 `.header()` 메서드로 헤더를 설정할 수 있습니다:

```java
// MockMvc 방식
mockMvc.perform(get("/api/v1/users/points")
    .header("X-USER-ID", "kilian"))
    .andExpect(status().isOk());
```

하지만 TestRestTemplate은 실제 HTTP 헤더를 전송합니다:

```java
@Nested
@DisplayName("포인트 조회")
class 포인트_조회 {

    @Nested
    @DisplayName("성공할 경우")
    class 성공할_경우 {

        @BeforeEach
        void setUp() {
            joinUserService.joinUser(new JoinUserCommand(
                    "kilian",
                    "kilian@gmail.com",
                    "1997-10-08",
                    "MALE"
            ));
        }

        @Test
        @DisplayName("보유 포인트를 응답으로 반환한다.")
        void 보유_포인트를_응답으로_반환한다() {
            // given - 실제 HTTP 헤더를 설정합니다
            String userIdentifier = "kilian";
            HttpHeaders headers = new HttpHeaders();
            headers.set("X-USER-ID", userIdentifier);
            HttpEntity<Void> httpEntity = new HttpEntity<>(headers);

            // when - 실제 HTTP GET 요청을 보냅니다
            ResponseEntity<ApiResponse<UserV1Dto.GetUserPointResponse>> response =
                    testRestTemplate.exchange(
                            "/api/v1/users/points",
                            HttpMethod.GET,
                            httpEntity,
                            new ParameterizedTypeReference<>() {}
                    );

            // then - 실제 HTTP 응답을 검증합니다
            assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
            assertThat(response.getBody().data().balance()).isEqualTo(0);
        }
    }
}
```

MockMvc와의 핵심 차이:
- **MockMvc**: Servlet Container 없이 모의 서블릿 환경에서 헤더를 처리합니다
- **TestRestTemplate**: 실제 Servlet Container(Tomcat 등)에서 실제 HTTP 통신으로 헤더를 전송합니다

#### 에러 응답 검증

```java
@Nested
@DisplayName("성별이 없는 경우")
class 성별이_없는_경우 {

    @Test
    @DisplayName("400 Bad Request 응답을 반환한다.")
    void badRequest응답을_반환한다() {
        // given - 필수 필드가 없는 잘못된 요청
        UserV1Dto.JoinUserRequest request = new UserV1Dto.JoinUserRequest(
                "user123",
                "user@example.com",
                "2000-01-15",
                null  // 성별이 없습니다
        );

        // when
        ResponseEntity<ApiResponse<Void>> response =
                testRestTemplate.exchange(
                        "/api/v1/users/join",
                        HttpMethod.POST,
                        new HttpEntity<>(request),
                        new ParameterizedTypeReference<>() {}
                );

        // then - 실제 클라이언트가 받는 HTTP 상태 코드를 검증합니다
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    }
}
```

## 결과

---

### 테스트 아키텍처

![테스트 아키텍처](/assets/images/posts/테스트아키텍쳐.png){: width="250" }

### TestRestTemplate의 이점

1. **실제 환경 모사**: 실제 클라이언트의 HTTP 요청과 동일하게 테스트합니다
2. **조기 오류 발견**: HTTP 직렬화/역직렬화 문제를 개발 단계에서 발견합니다
3. **신뢰도 향상**: 개발 환경에서 동작하는 것이 운영 환경에서도 동작할 확률이 높습니다
4. **계층별 책임 분리**: Service까지의 통합 테스트와 구분되어 각 계층의 책임이 명확합니다

## 회고

---

처음엔 MockMvc가 일반적인 선택이라고 생각했습니다. 
많은 예제가 MockMvc를 사용하고 있었으니까요.

하지만 깊이 생각해보니 **테스트의 목적이 계층마다 다르다**는 것을 깨달았습니다.

- **Domain 계층 테스트**: 비즈니스 규칙이 맞는지 검증 (Unit 테스트)
- **Service 계층 테스트**: 비즈니스 시나리오가 올바르게 작동하는지 검증 (통합 테스트)
- **API 계층 테스트**: **클라이언트가 기대하는 HTTP 요청/응답이 올바르게 작동하는지 검증** (End-to-End 테스트)

API 계층은 내부 구현이 아니라 **외부 클라이언트와의 인터페이스**입니다. 따라서 실제 HTTP를 통해 테스트해야 합니다.

### MockMvc vs TestRestTemplate 비교표

| 특성                | MockMvc     | TestRestTemplate  |
| ----------------- | ----------- | ----------------- |
| **Servlet Container** | ❌ 없음 (모의 환경) | ✅ 있음 (Tomcat 등 실제 실행) |
| 테스트 범위            | 모의 서블릿 환경   | 전체 애플리케이션 스택      |
| 서버 실행             | 실행하지 않음     | 임베디드 서버 실행        |
| HTTP 통신           | ❌ 하지 않음       | ✅ 실제 HTTP 요청/응답     |
| 테스트 속도            | 빠름          | 느림                |
| DispatcherServlet | Servlet Container 없이 직접 호출 | Servlet Container를 통해 호출 |
| 직렬화/역직렬화          | 모의 환경에서 처리  | 실제 HTTP로 처리       |
| 추천 용도             | 컨트롤러 단위 테스트 | End-to-End 통합 테스트 |


### 결론

---

MockMvc와 TestRestTemplate은 각각의 목적이 다릅니다:

- **MockMvc**: 컨트롤러 로직을 빠르게 검증하고 싶을 때 적합합니다
- **TestRestTemplate**: 실제 클라이언트가 사용하는 것처럼 전체 API를 검증하고 싶을 때 적합합니다
