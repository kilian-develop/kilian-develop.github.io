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
excerpt: 레거시 시스템에서 신규 전처리 시스템으로 대용량 데이터를 마이그레이션한 경험을 공유합니다. Kafka Connect로 데이터 스트림을 구축하고, Spring Batch와 RxJava를 활용한 병렬 처리로 성능을 13배 향상시켰습니다.
image_thumbnail: /assets/images/posts/spring-batch.png
---
# 문제 관측

이전에 만든 표절검사 서비스를 리팩토링하면서 새로운 문서 전처리 시스템을 만들게 되었습니다.

**기존 상황**:
- 카피킬러 서비스의 "표절검사"와 "문서 전처리"가 강하게 결합되어 있었습니다
- 검사 로직과 전처리 로직이 하나의 모듈에 뒤섞여 있어서 유지보수가 힘들었습니다
- 레거시 시스템에는 아직 처리되지 않은 데이터가 남아 있었습니다

**고민이 생겼습니다**:
전처리 로직을 별도의 시스템으로 분리하면서, 레거시 데이터베이스의 수십만 건 데이터를 새 시스템으로 옮겨야 했습니다. 문제는 단순한 데이터 이동이 아니라는 것이었습니다.

- 사용자 문서가 텍스트로 저장되어 있는데, 이를 문장 단위로 분할하고 가공해야 합니다
- 데이터 크기가 작게는 KB에서 크게는 MB를 넘습니다
- 수십만 건을 일일이 처리하면... 얼마나 걸릴까요?

![[Untitled diagram _ Mermaid Chart-2025-09-12-053218.png]]

이 글에서는 **수십만 건의 대용량 데이터를 어떻게 효율적으로 마이그레이션했는지**, 그 과정에서 겪은 고민과 선택을 공유하려고 합니다.

# 마이그레이션 대상 특정하기

처음 생각했던 방법은 간단했습니다.

"Spring Batch에서 카피킬러 DB를 직접 조회하면 되지 않을까?"

하지만 곧 문제들이 보였습니다.

**문제점**:
1. 마이그레이션 여부를 추적할 flag를 운영 DB에 추가해야 함
   - 운영 중인 서비스에 구조 변경을 강요하는 것은 좋은 방법이 아니었습니다
2. 배치 애플리케이션이 운영 DB에 직접 붙어야 함
   - 배치가 실패하면 운영 DB에도 영향을 미칠 수 있습니다
3. 대상 데이터를 한 번 조회한 후, 또 조회할 때의 중복 처리가 복잡해집니다

**결정한 방식**:
"마이그레이션 대상이 되는 데이터를 별도의 임시 DB에 먼저 저장한 후, 그걸 기반으로 배치를 처리하자"

이렇게 하면 운영 시스템에 영향을 주지 않으면서도, 마이그레이션 과정을 추적할 수 있었습니다.

# 데이터 파이프라인 구축하기: Kafka Connect와의 만남

이제 새로운 문제가 생겼습니다.

"대상 데이터를 임시 DB에 저장하려면, 카피킬러 DB에서는 어떻게 가져올까?"

## 첫 번째 시도: 간단한 방법

가장 먼저 생각했던 것은 이것이었습니다.

1. 카피킬러 서비스에 조회 API 추가
2. Spring Batch에서 API로 데이터 조회
3. 임시 DB에 저장

흔해 보이는 방법이지만, 문제가 있었습니다.

**문제점**:
1. 카피킬러에 비즈니스와 무관한 API를 추가해야 합니다
   - 마이그레이션을 위한 API는 향후 제거될 일회성 코드인데, 메인 서비스에 남음
2. 배치 애플리케이션에서 API를 호출하면서 중복 처리, 실패 처리 등의 복잡성 증가
3. 수십만 건의 데이터를 하나하나 조회하면... 얼마나 걸릴까요?

"여기서 다른 방법이 있을까?"

라고 고민하다 찾은 것이 **Kafka Connect**였습니다.

## Kafka Connect로 방향 전환

Kafka Connect는 이런 특징이 있습니다.

- **선언적 설정**: JSON 설정만으로 DB 간 데이터 동기화 가능
- **높은 신뢰성**: 오프셋 관리로 중복 없이 정확히 한 번만 처리
- **병렬 처리**: 대용량 데이터를 자동으로 분산 처리
- **커넥터 생태계**: 많은 데이터베이스가 이미 지원됩니다

이렇게 하면 카피킬러 DB → 임시 DB로의 자동 동기화가 가능했습니다.

**하지만 여기서 또 다른 질문이 생겼습니다**.

"그럼 마이그레이션할 데이터 자체도 Kafka를 통해서 옮기면 되지 않을까?"

### 왜 Kafka Connect로는 최종 데이터를 옮기지 않았나?

마이그레이션할 데이터를 다시 생각해봤습니다.

- 사용자 문서의 텍스트를 문장 단위로 **분할**해서 저장해야 합니다
- 각 문장이 단순 텍스트가 아니라 여러 메타데이터가 포함됩니다
- 데이터 크기가 작게는 KB에서 MB를 넘습니다

만약 이것을 Kafka 이벤트로 처리하면?

1. Kafka 클러스터에 엄청난 부하
2. 다른 서비스들이 사용하는 Kafka 토픽에도 영향
3. 복잡한 가공 로직을 이벤트 처리로 표현하기 어려움

**결론**:
- **Kafka Connect**: 대상 데이터 조회용 (단순하고 안정적)
- **Spring Batch**: 최종 마이그레이션용 (복잡한 로직 처리 가능)

# Spring Batch 최적화

Kafka Connect를 통해 대상 데이터를 모았으니, 이제 실제 마이그레이션을 해야 했습니다.

## 첫 번째 구현: 표준적인 방식

Spring Batch의 기본 구조는 이렇게 되어 있습니다.

![[Spring Batch Step 구조도.png]]

```
Reader → Processor → Writer
(청크 단위)  (개건별)  (청크 단위)
```

자연스럽게 이렇게 구현했습니다.

1. Reader: Kafka Connect 데이터 조회
2. Processor: API 호출해서 최종 데이터 가져오기
3. Writer: DB에 저장

**그리고 실행해봤습니다.**

결과는... 1000건에 **10분이 넘게 걸렸습니다.**

상황을 계산해봤습니다.
- 데이터: 수십만 건
- 현재 속도: 1000건에 10분
- 전체 소요 시간: 1000시간??? 🤦

이것은 말도 안 되는 속도였습니다. 뭔가 잘못되었다는 것이 명백했습니다.

## 병목 지점 찾기

"왜 이렇게 느린가?"
처리 흐름을 자세히 보니:

1. Reader에서 1개씩 읽음 (그 동안 다른 것은 대기)
2. Processor에서 API 호출 (평균 150ms)
3. 청크가 모이면 Writer 실행

문제는 **순차 처리**였습니다. API 호출이 끝날 때까지 다음 데이터를 읽지 않고 있었던 것입니다.

"아, 이것을 동시에 처리하면 되지 않을까?"

라는 생각이 들었습니다.

## 두 번째 시도: Virtual Thread와 멀티스레드
Spring Batch에서의 Chunk 단위의 Task 처리를 VirtualThead를 통해 비동기 처리하도록 수정했습니다.
이로써 하나의 chunk 작업이 처리가 안되더라도 동시에 처리될 수 있도록 수정했습니다.

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

```java
// Virtual Thread 활성화
executor.setVirtualThreads(true);
executor.setConcurrencyLimit(300);
```

그리고 `SynchronizedItemStreamReader`로 동시성 안전성을 보장했습니다.
**결과**: 5분으로 개선됨

하지만 여전히 하나의 Task에서 많은 I/O Blocking이 발생하기 때문에 더 최적화 할 수 있는 부분이 남아 있을 것이라 생각이 들었습니다.

## 카카오페이 기술 블로그와의 만남
구글링을 하다가 발견한 글이 있었습니다.
Step을 Virtual Thread를 통해 동시 수행하고 동시성을 보장하여 성능은 향상이 됐지만 여전히 5분이 넘는 시간이 소요됐습니다. 고민하고 구글링 하던 중 카카오 기술문서 에서 인사이트를 받았습니다.

[Spring Batch 애플리케이션 성능 향상을 위한 주요 팁 \| 카카오페이 기술 블로그](https://tech.kakaopay.com/post/spring-batch-performance/)

요지는 이렇습니다.
1. Step의 Processor를 삭제하고 Writer에서 청크단위로 처리
2. API, DB Write를 멀티 스레드 (위 문서에서는 RxKotlin)를 활용하여 병렬 처리

## 세 번째 시도: Processor 삭제와 Writer 최적화

카카오페이 글의 조언을 따라 Processor를 과감히 제거하기로 결정했습니다. 모든 처리 로직을 Writer에서 청크 단위로 처리하고, 그 안에서 RxJava를 활용해 병렬화하는 방식으로 변경했습니다.
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

## 병렬 처리: RxJava와 레일 기반 처리

카카오페이 글에서는 RxKotlin을 사용했지만, Java 애플리케이션이었기 때문에 RxJava로 구현했습니다.
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

# 결과 및 회고

## 성능 개선 결과

마이그레이션 완료 시간으로 성능을 검증했습니다.

- **첫 대상 처리**: 2025-09-12 08:10:47
- **마지막 대상 처리**: 2025-09-12 08:11:31
- **총 처리 시간**: **44초**

초기 구현의 10분과 비교하면 **약 13배 이상의 성능 개선**입니다.

## 배운 점들

### 1. 기술 선택의 중요성

맨 처음엔 "단순하게 API로 조회하면 되지 않을까"라고 생각했습니다. 하지만 그 선택이 얼마나 운영 복잡도를 높이고 유지보수를 어렵게 만드는지 깨달았습니다.

- **Kafka Connect의 역할**: 데이터 수집은 단순하게, 기술적으로 성숙한 도구에 맡기기
- **Spring Batch의 역할**: 복잡한 비즈니스 로직 처리에 집중하기

기술은 목적을 달성하는 수단일 뿐, "이것을 써야 한다"는 교조는 없습니다.

### 2. 아키텍처와 성능은 밀접하게 연결됨

표준적인 Spring Batch 구조(Reader → Processor → Writer)는 일반적인 사용에 좋지만, 우리의 경우:

- API 호출의 IO 대기 시간이 병목이었습니다
- Processor의 단건 처리 패턴이 이를 악화시켰습니다
- 청크 단위에서 병렬 처리로 전환하니 극적으로 개선되었습니다

아키텍처 결정이 곧 성능 특성을 결정한다는 것을 체감했습니다.

### 3. 성능 최적화는 "측정"에서 시작

10분이라는 느린 속도가 없었다면, 최적화를 시도하지 않았을 것입니다. 그리고 최적화 과정에서:

- Virtual Thread만으로는 부족했습니다 (5분)
- 기술 블로그가 큰 힌트를 줬습니다
- 하지만 그 방법도 "이게 우리 상황에 맞나?" 판단이 필요했습니다

"측정 → 문제 파악 → 가설 수립 → 구현 → 검증"의 사이클이 중요합니다.

### 4. "오픈 소스의 가치"를 느꼈습니다

카카오페이 기술 블로그라는 구체적인 사례가 없었다면, 우리가 이 해결책을 찾기까지 훨씬 오래 걸렸을 것입니다.

개발 커뮤니티에서 경험을 공유하는 것이 얼마나 중요한지 깨달으면서, 앞으로 우리도 그런 경험을 나누고 싶다는 생각이 들었습니다.

---

## 마치며

수십만 건의 대용량 데이터 마이그레이션은 단순한 기술 문제가 아니라, 여러 선택의 연속이었습니다.

- 어떤 기술을 선택할 것인가?
- 왜 느린가?
- 어떻게 개선할 것인가?

각 지점에서 고민하고 시도하면서 배운 것들이 앞으로의 설계 능력을 키울 것 같습니다.

