---
layout: post
date: 2025-10-04
categories: APM
tags:
  - 데이터독
  - 분산추적
  - APM
title: 데이터독 Trace 로컬 환경 설정
excerpt: 로컬 개발 환경에서 Datadog APM을 설정하는 방법을 단계별로 설명합니다. dd-java-agent.jar 설치부터 Docker 기반 Datadog Agent 구성, 애플리케이션 환경 변수 설정까지 실제 적용 과정을 다룹니다.
image_thumbnail: /assets/images/posts/데이터독.jpg
---

# 데이터독 계정 생성
로컬 환경 설정을 위해 데이터독 계정이 필요하다.
[데이터독 사이트](https://app.datadoghq.com/account/login?redirect=f)를 통해 로그인해서 14일 Trial이 가능하다. 

> [!tip]
> 14일 사용이 완료된 경우 Region을 변경해서 다시 14일 사용이 가능하다.

--- 
# 데이터독 APM 수집 원리
데이터독 APM 수집을 시각화 하면 아래와 같다.
![[Datadog Trace 로컬 환경 설정-1.png]]
출처 : [데이터독 공식문서](https://docs.datadoghq.com/ko/tracing/trace_collection/)

**INSTRUMENTED APPICATION WITH DD-TRACE LIBRARY**
- 데이터독 TRACE 라이브러리(이 문서에서는 dd-java-agent.jar)와 함께 어플리케이션을 계측
- 계측된 데이터를 데이터독 에이전트로 전송

**DATADOG-AGENT**
- 전송 받은 애플리케이션 계측 데이터를 DATADOG-BACKEND로 전달

**DATADOG-BACKEND**
- 에이전트가 수집한 데이터를 BACKEND에서 받아 UI로 표현

---
# dd-java-agent.jar (TRACING LIBRARY) 설치
 프로젝트 루트에서 아래 명령어 중 하나를 실행하여 dd-java-agent.jar를 설치한다.
 참고문서 : [데이터독 공식문서](https://docs.datadoghq.com/ko/tracing/trace_collection/automatic_instrumentation/dd_libraries/java/?tab=wget)
``` shell
wget -O dd-java-agent.jar 'https://dtdg.co/latest-java-tracer'
```
```shell
curl -Lo dd-java-agent.jar 'https://dtdg.co/latest-java-tracer'
```

![[Datadog Trace 로컬 환경 설정-7.png]]

---
# 데이터독 에이전트 
`docker-compose.yml`을 통해 데이터독 에이전트를 로컬환경에서 띄운다.
```yml
datadog-agent:  
  image: gcr.io/datadoghq/agent:7  
  networks:  
    - document_preprocessor_network  
  environment:  
    - DD_API_KEY=${DD_API_KEY}  
    - DD_SITE=us5.datadoghq.com  
    - DD_APM_ENABLED=true  
    - DD_LOGS_ENABLED=true  
    - DD_LOGS_CONFIG_CONTAINER_COLLECT_ALL=true  
  volumes:  
    - /var/run/docker.sock:/var/run/docker.sock:ro  
    - /proc/:/host/proc/:ro  
    - /sys/fs/cgroup/:/host/sys/fs/cgroup:ro  
    - /var/lib/docker/containers:/var/lib/docker/containers:ro  
  ports:  
    - "8126:8126"
```
환경 변수로 아래 값들이 필요하다.
- `DD_API_KEY`
- `DD_SITE`

==데이터독 API KEY==를 구하기 위해 아래와 같이 접속한다.
`Organization Settings` > `API Keys`
![[Datadog Trace 로컬 환경 설정-2.png]]
![[Datadog Trace 로컬 환경 설정-3.png]]
API Key가 없는 경우 New Key 버튼을 클릭하여 생성한다.

![[Datadog Trace 로컬 환경 설정-4.png]]
Copy 버튼을 클릭해서 카피한다.

> [!warning]
> Key값은 .env파일로 관리해서 commit되지 않도록 주의한다.


==DD_SITE==값은 데이터독 사이트의 Host를 입력하면 된다.
![[Datadog Trace 로컬 환경 설정-5.png]]

---
# 어플리케이션 환경 변수 설정
**JVM옵션**에는 Tracing Library(dd-java-agent.jar)를 지정해야 한다.
`-javaagent:dd-java-agent.jar`

**Environment variables**(환경 변수)에는 아래 값들을 입력한다.
- `DD_AGENT_HOST` : 데이터독 에이전트의 호스트
- `DD_TRACE_AGENT_PORT` : 8126
- `DD_SERVICE` : 서비스명 (검색 쿼리 시에 service에 검색된다.)
- `DD_ENV` : 환경명 (검색 쿼리 시에 env로 검색된다.)
- `DD_VERSION` : 버전 (서비스 버전을 적으면 좋음)

인텔리제이의 Run/Debug Configuration에 설정하면 아래와 같다.
![[Datadog Trace 로컬 환경 설정-6.png]]

---
# 결과확인
어플리케이션 실행 시에 아래와 같은 로그가 남는다.
```
[dd.trace 2025-08-26 10:19:02:018 +0900] [dd-task-scheduler] INFO datadog.trace.agent.core.StatusLogger - DATADOG TRACER CONFIGURATION {"version":"1.52.1~6b6db17410","os_name":"Mac OS X","os_version":"15.5","architecture":"aarch64","lang":"jvm","lang_version":"21.0.7","jvm_vendor":"Microsoft","jvm_version":"21.0.7+6-LTS","java_class_version":"65.0","http_nonProxyHosts":"local|*.local|169.254/16|*.169.254/16","http_proxyHost":"null","enabled":true,"service":"preprocessor-api","agent_url":"http://localhost:8126","agent_error":false,"debug":false,"trace_propagation_style_extract":["datadog","tracecontext","baggage"],"trace_propagation_style_inject":["datadog","tracecontext","baggage"],"analytics_enabled":false,"priority_sampling_enabled":true,"logs_correlation_enabled":true,"profiling_enabled":false,"remote_config_enabled":true,"debugger_enabled":false,"debugger_exception_enabled":false,"debugger_span_origin_enabled":false,"debugger_distributed_debugger_enabled":false,"appsec_enabled":"ENABLED_INACTIVE","rasp_enabled":true,"telemetry_enabled":true,"telemetry_dependency_collection_enabled":true,"telemetry_log_collection_enabled":true,"dd_version":"1.0","health_checks_enabled":true,"configuration_file":"no config file present","runtime_id":"f88a9a6e-f9ba-4281-975e-c8b9c6011a02","logging_settings":{"levelInBrackets":false,"dateTimeFormat":"'[dd.trace 'yyyy-MM-dd HH:mm:ss:SSS Z']'","logFile":"System.err","configurationFile":"simplelogger.properties","showShortLogName":false,"showDateTime":true,"showLogName":true,"jsonEnabled":false,"showThreadName":true,"defaultLogLevel":"INFO","warnLevelString":"WARN","embedException":false},"cws_enabled":false,"cws_tls_refresh":5000,"datadog_profiler_enabled":false,"datadog_profiler_safe":true,"datadog_profiler_enabled_overridden":false,"data_streams_enabled":false}
```

데이터독 APM Trace에 접속하여 서비스가 정상 연결되었는지 확인한다
![[Datadog Trace 로컬 환경 설정-7-1.png]]