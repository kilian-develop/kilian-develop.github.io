---
title: Kafka Connect 와 Spring Batch를 활용한 서비스 마이그레이션
categories: Spring
layout: post
tags:
  - SpringBatch
  - Spring
  - Kafka
  - Kafka-connect
date: 2025-10-05
---
# 개요
카피킬러 표절검사에는 문서를 전처리하는 시스템이 도입되어 있습니다.
사용자가 업로드하는 문서를 표절검사하기 전 문서를 검사를 돌릴 수 있는 형식으로 변경하는 시스템입니다.
이 시스템이 이전 다른 표절검사 시스템과 결합되어 있어, 검사와 서비스의 의존성을 분리한 새로운 시스템으로 구축했습니다.
예전의 시스템을 레거시 시스템이라고 부르겠습니다.
레거시 시스템에는 여전히 남겨진 데이터가 있기 때문에 아래와 같이 시스템을 이원화 할 수 밖에 없는 상황입니다.
![[Untitled diagram _ Mermaid Chart-2025-09-12-053218.png]]
당연하게 데이터 베이스를 마이그레이션해서 새로운 문서 전처리 모듈로 일원화 해야했고 어떻게 구현했는지 공유하고자 합니다.

# 마이그레이션 대상
우선 마이그레이션을 위해 그 대상을 특정해야만 했습니다.
전처리 모듈을 반영 한 후 부터 일부 데이터는 전처리 모듈에 존재하기 때문에 카피킬러 서비스의 데이터베이스에서 대상을 특정 지어야만 했습니다.
카피킬러 DB에는 레거시 서비스의 데이터와 문서 전처리 모듈의 데이터를 테이블을 분리하여 관리 중이였습니다.
이제 쿼리를 통해 마이그레이션 대상을 특정 지을 수 있습니다.

이제 Spring Batch를 통해 마이그레이션 대상을 조회해야 합니다.
하지만 직접 운영 중인 카피킬러 DB에 마이그레이션 여부인 flag값을 추가하고 배치 어플리케이션이 운영 DB에 직접 붙어서 동작하는 것은 그리 좋은 방법 같지는 않아보입니다.

때문에 **특정된 대상 데이터들을 마이그레이션을 위한 새로운 DB에 저장하고 조회하도록 하는 것으로 결정하게되었습니다.**

# Kafka Connect
마이그레이션 대상 데이터를 저장하려고 하니 필요한 문제가 생겼습니다.
일반적으로 생각하기에는 아래와 같은 방식으로 마이그레이션을 생각합니다.
1. API를 통해 카피킬러 서비스에서 마이그레이션 대상 테이블을 조회
2. 조회된 대상 테이블을 Spring Batch를 통해 저장

하지만 이를 위해 카피킬러 서비스에 비즈니스가 아닌 마이그레이션을 위한 API를 추가 개발해야하고
실제로 마이그레이션하는 배치가 아닌 부가적인 Job을 Spring Batch를 통해 관리해야 하기 때문에 어플리케이션이 부하가 발생합니다. 

때문에 카피킬러 데이터베이스와 마이그레이션 데이터베이스 간의 데이터 스트림이 필요했습니다.
그러다 생각한 것이 ==Kafka Connect==입니다.

> [!info]
> Kafka Connect는 Apache Kafka®와 다른 데이터 시스템 간에 확장 가능하고 안정적인 데이터 스트리밍을 위한 도구입니다. Kafka에서 대용량 데이터 세트를 주고받는 커넥터를 빠르게 정의할 수 있습니다. Kafka Connect는 전체 데이터베이스를 수집하거나 모든 애플리케이션 서버의 메트릭을 Kafka 토픽으로 수집하여 짧은 지연 시간으로 스트림 처리에 사용할 수 있도록 합니다. 내보내기 커넥터는 Kafka 토픽의 데이터를 Elasticsearch와 같은 보조 인덱스 또는 Hadoop과 같은 배치 시스템으로 전달하여 오프라인 분석을 수행할 수 있습니다. 
> 출처 : [confluent 공식문서](https://docs.confluent.io/platform/current/connect/index.html)

Kafka Connect의 장점은 아래와 같습니다.
- **개발 생산성 향상** : Kafka Connect는 미리 구축된 커넥터들을 제공해서 개발 시간을 크게 단축시킵니다. 데이터베이스, 클라우드 서비스, 검색 엔진, 메시징 시스템 등 수백 개의 커넥터가 이미 존재합니다. 따라서 개발자가 직접 프로듀서나 컨슈머 코드를 작성할 필요 없이 설정만으로도 데이터 파이프라인을 구축할 수 있습니다.
- **운영의 단순화** : Kafka Connect는 선언적 설정 방식을 사용합니다. JSON 기반의 설정 파일로 데이터 소스, 변환 규칙, 대상 시스템을 정의하면 되므로 복잡한 코딩 없이도 데이터 파이프라인을 관리할 수 있습니다. REST API를 통해 커넥터의 생성, 수정, 삭제 모니터링이 가능하여 운영 업무가 매우 간단해집니다.
- **확장성과 내결함성** : Kafka Connect는 분산 모드로 실행될 때 여러 워커 노드에 걸쳐 커넥터 작업을 분산시킵니다. 워커 노드가 실패하면 다른 노드가 자동으로 작업을 인계받아 높은 가용성을 보장합니다. 또한 처리량이 증가하면 워커 노드를 추가하여 수평적으로 확장할 수 있습니다.
- **Exactly-Once 보장** : Kafka Connect는 오프셋 관리를 통해 정확히 한 번(exactly-once) 전송을 보장합니다. 소스 커넥터는 읽은 데이터의 위치를 Kafka의 내부 토픽에 저장하고, 싱크 커넥터는 처리한 데이터의 오프셋을 추적합니다. 시스템 장애나 재시작 시에도 중복 처리나 데이터 손실 없이 정확한 지점부터 재개할 수 있습니다.
- **병렬 처리와 파티셔닝** : Kafka Connect는 Kafka의 파티셔닝 메커니즘을 활용하여 대용량 데이터를 병렬로 처리합니다. 하나의 커넥터가 여러 태스크로 분할되어 각각 다른 파티션을 처리하므로, 데이터양이 증가해도 처리 성능이 선형적으로 확장됩니다. 예를 들어, 대용량 데이터베이스 테이블을 여러 파티션으로 나누어 동시에 읽어올 수 있습니다.
- **증분 데이터 로딩** : 대용량 데이터베이스에서 전체 데이터를 매번 처리하는 것은 비효율적입니다. Kafka Connect는 타임스탬프, 증분 ID 등을 활용한 증분 로딩을 지원하여 변경된 데이터만 효율적으로 처리할 수 있습니다. 이는 처리 시간과 리소스를 대폭 절약합니다.

Spring Batch를 통해 마이그레이션 대상을 저장하는 로직을 구현한다면 대상에 대한 중복 처리, 오류 발생 시의 에러 핸들링 등을 코드로 관리해야 하기 때문에 복잡성이 크게 증가합니다.
병렬 처리와 파티셔닝, 증분 데이터 로딩을 통해 대용량 데이터 처리에서 장점을 발휘합니다.

이제 의문이 생길 수 있습니다. 그럼 대상 테이블을 저장할 것이 아니라 마이그레이션 데이터를 Kafka Connect를 통해서 마이그레이션하면 되는 게 아닌가? 입니다.
하지만 마이그레이션할 데이터는 사용자가 업로드 할 문서의 텍스트를 문장 단위로 분할한 데이터입니다.
즉, 작게는 KB단위에서 크게는 MB단위가 넘는 텍스트입니다.
이런 텍스트를 이벤트를 통해 발행하게 되면 Kafka 클러스터에 많은 부하가 발생하고 Kafka를 쓰고있는 다른 서비스에 큰 영향을 끼칠 수 있습니다.
또한 오래 운영된 시스템이기에 복잡한 요구사항이 추가될 수 있어서 대상 테이블을 조회하는 단순작업과는 달랐습니다.

# Spring Batch 최적화
Spring Batch에서는 아래 이미지와 같이 Reader를 통해 데이터를 청크 단위로 조회하여 Processor가 단건 씩 처리하고 Writer가 청크 단위로 쓰도록 되어있습니다.

![[Spring Batch Step 구조도.png]]
저는 초기에 Kafka Connect를 통해 저장된 데이터를 Reader 통해 조회하고 Processor에서 API를 통해 조회 후 ItemWriter에서 데이터베이스에 저장하도록 구현했습니다.
실제로 실행해본 결과 1000건의 데이터를 마이그레이션 하는데 10분이 넘는 시간이 걸렸습니다.
작은 데이터가 아닌 수 억건의 데이터를 마이그레이션해야 하는 상황에서 이 정도의 처리 속도는 언제 끝날지 모르는 처리속도였습니다.

처음에는 `StepExecutor`를 `Virtual Thead` 기반으로 변경하고 `ItemReader`를 동시성을 보장하기 위해 `SynchronizedItemStreamReader`로 변경했습니다.
`
```java
@Bean  
public TaskExecutor taskExecutor() {  
    SimpleAsyncTaskExecutor executor = new SimpleAsyncTaskExecutor("migration-batch-");  
    executor.setVirtualThreads(true); // Spring Boot 3.2+ 에서 사용 가능  
    executor.setConcurrencyLimit(300); // Virtual Thread는 많은 동시 실행을 허용  
    return executor;  
}
```
``` java
@Bean  
@StepScope  
public ItemReader<MigrationTarget> synchronizedMigrationTargetItemReader(  
        MigrationTargetRepository repository,  
        @Value("${batch.migration.limit}") int limit  
) {  
    MigrationReader delegate = new MigrationReader(repository, limit);  
    return new SynchronizedItemStreamReaderBuilder<MigrationTarget>()  
            .delegate(delegate)  
            .build();  
}
```

Step을 Virtual Thread를 통해 동시 수행하고 동시성을 보장하여 성능은 향상이 됐지만 여전히 5분이 넘는 시간이 소요됐습니다. 고민하고 구글링 하던 중 카카오 기술문서 에서 인사이트를 받았습니다.

[Spring Batch 애플리케이션 성능 향상을 위한 주요 팁 \| 카카오페이 기술 블로그](https://tech.kakaopay.com/post/spring-batch-performance/)

요지는 이렇습니다.
1. Step의 Processor를 삭제하고 Writer에서 청크단위로 처리
2. API, DB Write를 멀티 스레드 (위 문서에서는 RxKotlin)를 활용하여 병렬 처리

## Processor 삭제
Processor를 과감히 제거하고 마이그레이션 대상을 Writer에서 직접 변경하도록 수정했습니다.
``` java
@Bean  
public Step migrationStep(  
        JobRepository jobRepository,  
        PlatformTransactionManager transactionManager,  
        MigrationSkipListener skipListener,  
        ItemReader<MigrationTarget> synchronizedMigrationTargetItemReader,  
        @Value("${batch.migration.chunk:50}") int chunk  
) {  
    return new StepBuilder("migrationStep", jobRepository)  
            .<MigrationTarget, MigrationTarget>chunk(chunk, transactionManager)  
            .reader(synchronizedMigrationTargetItemReader)  
            .writer(itemWriter)  
			// ... 추가 설정
            .build();  
}
```

```java
@Override  
public void write(Chunk<? extends MigrationTarget> chunk) { // Migration 대상 조회 
	// 구현
}
```

## 병렬 처리
그리고 위 문서에서는 RxKotlin을 사용해서 처리했지만 Java 어플리케이션을 선택했기 때문에 API 요청을 RxJava를 통해 구현했습니다.
![[RxJava병렬처리.png]]

병렬 처리를 위해 데이터를 여러 개의 “레일”로 분할합니다. 이 경우, 레일의 수는 `Schedulers.io()`를 사용하여 시스템에 적합한 수로 선택합니다. **레일로 병렬로 주문 API를 호출하면 동일한 150ms 대기 시간 동안에 레일 수만큼 처리되므로 성능이 향상됩니다.** 그런 다음, 병렬 처리된 데이터를 다시 `sequential()`으로 병합합니다.

### API 병렬 처리
``` java
public List<MigrationResult> executeParallelApiCalls(List<MigrationTarget> targets) {  
    return Observable.fromIterable(targets)  
            .flatMap(target -> processTargetToResult(target).toObservable(), 100) // 최대 100개 동시 처리  
            .toList()  
            .timeout((long) API_CALL_TIMEOUT_SECONDS * targets.size(), TimeUnit.SECONDS) // 전체 타임아웃  
            .doOnSubscribe(disposable -> log.debug("Starting parallel API calls for {} targets", targets.size()))  
            .doOnSuccess(results -> log.info("Completed parallel API calls, got {} results", results.size()))  
            .doOnError(throwable -> log.error("Error during parallel API calls", throwable))  
            .blockingGet();  
}
```
```java
private Single<MigrationResult> executeApiCallsForTarget(MigrationTarget target, PreprocessJob job) {  
    // API 호출을 병렬로 수행  
    Single<Sentences> sentencesSingle = Single.fromCallable(() ->  
                    windowClient.getSentences(target.getTicketKey()))  
            .subscribeOn(Schedulers.io())  
            .timeout(API_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)  
            .doOnSubscribe(disposable -> log.debug("Starting sentences for target: {}", target.getTicketKey()))  
            .doOnSuccess(result -> log.debug("Sentences completed for target: {}", target.getTicketKey()))  
            .doOnError(throwable -> log.error("Sentences failed for target: {}, error: {}",  
                    target.getTicketKey(), throwable.getMessage()));  
  
    return sentencesSingle  
            .map(sentences -> createMigrationResult(target, job, sentences))  
            .doOnSuccess(result -> {  
                log.debug("All API calls completed for target: {}", target.getTicketKey());  
                target.setPreprocessId(job.getId().value());  
                target.setMigrated(true); // 마이그레이션 완료 표시  
            })  
            .doOnError(throwable ->  
                    log.error("Failed to create migration result for target: {}",  
                            target.getTicketKey(), throwable)  
            );  
}
```

### DB 병렬 처리
데이터 베이스는 
- MongoDB에 문장 텍스트를 저장
- MigrationTarget에 완료 UPDATE
- PreprocessJob (새로운 모듈의 애그리거트 루트) 저장
위 세가지 데이터를 저장해야합니다. 주의할 점은 두 가지가 있습니다.
- 단 건씩 저장할 경우 잦은 Connection과 I/O Blocking으로 인한 지연발생
- 단순 insert의 경우 중복 실행의 경우 중복된 데이터가 저장될 수 있는 위험 발생 (Exactly-once 보장 필요)

위 주의 사항으로 인해 아래와 같이 구현합니다.
- 데이터베이스 bulk연산
- UNIQUE 제약 조건을 통해 UPSERT로 구현
즉 bulkUpsert로 구현하도록 합니다. 데이터베이스 별 세부 bulkUpsert 로직은 첨부하지 않겠습니다.

아무리 bulk로 연산하더라도 세 번의 데이터베이스 저장의 Blocking이 발생하기 때문에 이 또한 병렬로 처리합니다.

```java
public void executeParallelDbWrites(List<MigrationResult> migrationResults) {  
    // 데이터 추출  
    List<MigrationTarget> targets = migrationResults.stream()  
            .map(MigrationResult::getTarget)  
            .toList();  
    List<PreprocessJob> jobs = migrationResults.stream()  
            .map(MigrationResult::getJob)  
            .toList();  
    List<SentenceExtract> sentenceExtracts = migrationResults.stream()  
            .map(MigrationResult::getSentenceExtract)  
            .toList();  
  
    // 각 테이블별 삽입을 Completable로 생성  
    Completable targetsWrite = Completable.fromAction(() -> {  
                log.debug("Writing {} migration targets", targets.size());  
                migrationTargetRepository.bulkUpsert(targets);  
            }).subscribeOn(Schedulers.io())  
            .timeout(DB_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)  
            .doOnSubscribe(disposable -> log.debug("Starting migration targets write"))  
            .doOnComplete(() -> log.debug("Migration targets write completed"));  
  
    Completable jobsWrite = Completable.fromAction(() -> {  
                log.debug("Writing {} preprocess jobs", jobs.size());  
                preprocessJobRepository.bulkUpsert(jobs);  
            }).subscribeOn(Schedulers.io())  
            .timeout(DB_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)  
            .doOnSubscribe(disposable -> log.debug("Starting preprocess jobs write"))  
            .doOnComplete(() -> log.debug("Preprocess jobs write completed"));  
  
    Completable sentencesWrite = Completable.fromAction(() -> {  
                log.debug("Writing {} sentence extracts", sentenceExtracts.size());  
                sentenceExtractRepository.bulkUpsert(sentenceExtracts);  
            }).subscribeOn(Schedulers.io())  
            .timeout(DB_WRITE_TIMEOUT_SECONDS, TimeUnit.SECONDS)  
            .doOnSubscribe(disposable -> log.debug("Starting sentence extracts write"))  
            .doOnComplete(() -> log.debug("Sentence extracts write completed"));  
  
    // 모든 삽입 작업을 병렬로 실행하고 완료 대기  
    Completable.merge(List.of(targetsWrite, jobsWrite, sentencesWrite))  
            .doOnSubscribe(disposable -> log.debug("Starting all parallel DB writes"))  
            .doOnComplete(() -> log.info("All parallel DB writes completed successfully"))  
            .doOnError(throwable -> log.error("Error during parallel DB writes", throwable))  
            .blockingAwait();  
}
```

# Exception 처리
Writer에 API 요청과 함께 DB Write까지 집중되어있다보니 Exception 처리의 이슈가 발생합니다.
에러에는 두 가지 종류가 발생합니다.

- 개발자가 예상할 수 있는 Exception (`Checked Exception`)
- 개발자가 예상치 못한 Exception (`Unchecked Exception`)

예상할 수 있는 예외는 다음과 같았습니다.
- 카피킬러 서비스에는 데이터가 존재하지만 레거시 시스템에는 데이터가 존재하지 않는 경우 (HTTP 404)
- API 요청 스펙이 잘 못된 경우 (HTTP 400)
- 서비스 논리 오류
	- 예를 들어 이전에는 지원했지만 현재 서비스에서 지원하지 않는 데이터의 경우

이제 Spring Batch를 통해 위와 같은 예외를 처리해야합니다.
Spring Bach에서 Writer에서 예외가 발생한 경우 다음과 같이 동작합니다.
![[Spring Batch 예외처리.png]]
- 위 그림에서 Writer에서 item4번에서 예외가 발생했다면 다시 Chunk 단위로 ItemReader로 돌아간다.
- 캐싱된 데이터로 itemReader는 itemProcessor로 넘긴다.
- itemProcessor는 이전처럼 **청크 단위만큼 item을 처리하고 한 번에 writer로 넘기는 게 아니라 단건 처리 후 writer로 ==단건==을 넘긴다.**
- 단건 처리에서 예외가 발생한 경우 Skip을 수행하게 된다.

Checked Exception의 경우는 Skip을 통해 정의했습니다.
``` java
@Bean  
public Step migrationStep(  
	// ...
) {  
    return new StepBuilder("migrationStep", jobRepository)  
            .<MigrationTarget, MigrationTarget>chunk(chunk, transactionManager) 
            .reader(synchronizedMigrationTargetItemReader)  
            .writer(itemWriter)  
            .taskExecutor(taskExecutor())  
            .faultTolerant()  
            .retry(DataAccessException.class)  
            .retryLimit(3)  
            .skipLimit(1000)  
            .skip(UnsupportedOperationException.class)  
            .skip(DomainException.class)  
            .skip(HttpClientException.NotFound.class)  
            .listener(skipListener)  
            .build();  
}
```

SkipListener에서는 아래와 같이 수행합니다.
- 에러 로깅
- 마이그레이션 대상 업데이트
- 예외 메시지와 예외가 발생한 대상에 대한 데이터 저장

이제 Skip을 수행하는 경우 아래와 같은 로직을 수행합니다.
```java
@Slf4j  
@Component  
@RequiredArgsConstructor  
public class MigrationSkipListener implements SkipListener<MigrationTarget, MigrationTarget> {  
  
    private final MigrationTargetRepository migrationTargetRepository;  
    private final ExpectedMigrationTargetRepository expectedMigrationTargetRepository;  
  
    @Override  
    public void onSkipInWrite(MigrationTarget item, Throwable t) {  
        log.error(// 예외 에러 로깅);  
        item.setMigrated(true); // 다시 마이그레이션 하지 않도록 세팅 
  
        if (t instanceof HttpClientException.NotFound) {  
            expectedMigrationTargetRepository.save(ExpectedMigrationTarget.of(item, 1, t.getMessage()));   // 특정 에러 발생 시 DB에 데이터 저장
        }  
  
        if (t instanceof DomainException exception) {  
        expectedMigrationTargetRepository.save(ExpectedMigrationTarget.of(item, exception.getCode().getCode(), t.getMessage()));  // 특정 에러 발생 시 DB에 데이터 저장
        }  
  
        migrationTargetRepository.bulkUpsert(List.of(item));  //migration target 업데이트
    }  
}
```

사실 한 가지 더 발생할 수 있는 예외가 있습니다.
이 문서에 대한 데이터가 수십 MB가 될 수도 있다고 했는데 MongoDB에서는 최대 16MB의 BSON 데이터를 저장할 수 있습니다. Java에서는 이 데이터가 초과 되는 경우 `BsonMaximumSizeExceededException`이 발생합니다.
[MongoDB 제한 및 임계값 - 데이터베이스 매뉴얼 - MongoDB Docs](https://www.mongodb.com/ko-kr/docs/manual/reference/limits/)

이 문제를 해결하기 위한 방법으로 MongoDB에서는 GridFS라는 파일 시스템을 지원합니다.
[GridFS - 데이터베이스 매뉴얼 - MongoDB Docs](https://www.mongodb.com/ko-kr/docs/manual/core/gridfs/)

bulkUpsert 중에 특정 레코드에 `BsonMaximumSizeExceededException`이 발생하는 경우 GridFS를 통해 저장해야합니다.
하지만 Chunk 단위로 bulkUpsert를 수행하기 때문에 초과되는 대상을 특정 짓기 어려운 문제가 존재했습니다.

위 Spring Batch의 Writer의 예외처리를 다시보면 예외 발생 시 단 건씩 재수행하는 것을 알 수 있습니다.
제가 생각한 해결방법은 다음과 같습니다.
1. 저는 그래서 Writer의 chunk의 Size가 1개인 경우를 특정
2. 문서에 대한 단건 저장 시 BSON 저장 시도 후 `BsonMaximumSizeExceededException`에러 발생 시 GridFS로 저장하도록 수정
3. 단 건 수행 시에는 bulkUpsert대신 2번 방식으로 단건 저장 수행

코드는 아래와 같습니다.

**단건 저장 시도** 
```java
@Override  
public SentenceExtract save(SentenceExtract extract) {  
    try {  
        return repository.save(SentenceExtractMongoEntity.from(extract)).toDomain(); // 저장 시도 
    } catch (BsonMaximumSizeExceededException exception) {  // 에러발생
        List<SentenceMongoEntity> sentenceMongoEntities = extract.fetchSentences().stream()  
                .map(SentenceMongoEntity::from)  
                .toList();  
  
        String jsonData = JsonUtil.convertToString(sentenceMongoEntities);  
        ObjectId fileId = gridFsTemplate.store(  
                new ByteArrayInputStream(jsonData.getBytes()),  
                "sentences_" + extract.getJobId().value() + ".json",  
                "application/json",  
                new Document("jobId", extract.getJobId().value())  
        );  // GridFS 저장
  
        return repository.save(SentenceExtractMongoEntity.of(extract, fileId.toString())).toDomain();  // FileId 저장
    }  
}
```

**ItemWriter**
```java
public void write(Chunk<? extends MigrationTarget> chunk) {  
    List<MigrationTarget> migrationTargets = List.copyOf(chunk.getItems());  
  
    log.info("Processing {} migration targets with parallel API calls", migrationTargets.size());  
  
    if (migrationTargets.size() == 1) {  
        List<MigrationResult> migrationResults = apiCaller.executeParallelApiCalls(migrationTargets);  // 병렬 API 요청
        dbWriter.executeParallelDbWritesSingle(migrationResults); // 단건 저장 로직 포함
        return;  
    }  
    //.. 구현
}
```


예상 불가능한 Exception의 경우에는 `JobExecutionListener`를 통해 Job의 Status가 `FAILED`인 경우 알람을 받을 수 있도록 했습니다.

```java
@Slf4j  
@Component  
@RequiredArgsConstructor  
public class MigrationBatchExceptionHandler implements JobExecutionListener {  
  
    private final BatchDeadLetterSender deadLetterSender;  
  
    @Override  
    public void afterJob(JobExecution jobExecution) {  
        if (jobExecution.getStatus() == BatchStatus.FAILED) {  
            List<Throwable> failureExceptions = jobExecution.getAllFailureExceptions();  
  
            failureExceptions.forEach(throwable -> {  
                Throwable cause = throwable.getCause();  
                log.error(new ErrorLog(Collections.emptyList(), cause.getMessage(), cause.getStackTrace()).toJsonString());  
                deadLetterSender.send(cause.getMessage());  
            });  
        }  
    }  
}
```

```java
@Bean  
public Job migrationJob(  
        JobRepository jobRepository,  
        Step migrationStep,  
        MigrationBatchExceptionHandler exceptionHandler  
) {  
    return new JobBuilder("migrationJob", jobRepository)  
            .start(migrationStep)  
            .listener(exceptionHandler)  
            .build();  
}
```

# 결과 확인
결과 확인을 위해 마이그레이션 대상에 마이그레이션 완료 시간을 확인한다.

최초 대상 완료 시간 `2025-09-12 08:10:47`
마지막 대상 완료 시간 `2025-09-12 08:11:31`

최종적으로 10분넘게 걸리던 마이그레이션을 44초 정도로 단축했음을 확인할 수 있었습니다.
이 결과 역시 개발 환경에서 수행한 결과로 데이터베이스 사양이 낮아 레거시 시스템의 API 응답속도가 1초가 넘게 걸리는 것을 감안하면 운영환경에서는 더 큰 차이를 보일 것으로 예상됩니다.

