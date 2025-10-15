---
title: Kafka Custom Partitioner 적용기
categories: Kafka
layout: post
tags:
  - Kafka
date: 2025-10-14
excerpt: 프로필별 트래픽 제어와 우선순위 기반 처리를 위한 Kafka Custom Partitioner 구현 사례. 검색엔진의 부하 분산과 긴급 요청의 빠른 처리를 동시에 해결합니다.
---
# 개요
카피킬러 표절검사 과정 중에는 ==후보군 추출==이라는 프로세스가 존재합니다.
후보군 추출은 사내 문서들을 탐색하는 검색엔진을 통해 진행됩니다.

검색엔진은 검색 범위에 따라 ==프로필==별로 나누어져 있습니다.
프로필의 종류는 아래 5가지입니다:
- BLACK_HOLE
- COC
- UNION
- GROUP
- DOMAIN

현재 이 검색엔진으로의 요청은 Kafka의 Consumer를 통해 이벤트를 받아 처리하고 있습니다.
검색엔진이 받을 수 있는 부하는 Worker에 따라 한정되어 있습니다.

여기서 아래의 두 가지 요구사항을 만족해야 합니다:
1. **프로필별 트래픽 제어**
   - 프로필에 해당하는 검색엔진별로 Worker에 따라 수용할 수 있는 트래픽이 다릅니다.
   - 프로필별로 부하를 통제할 수 있어야 합니다.
2. **우선순위 기반 처리**
   - 검색엔진의 속도보다 요청이 많아 요청이 밀려있는 경우, 특정 요청을 빠르게 처리할 수 있어야 합니다.

현재 요구사항을 만족해야 하는 문제 상황을 도식화하면 아래와 같습니다:

![[현재 문제.png]]

---
# Spring Kafka 파티셔너
## 파티셔너란?
Spring Kafka의 파티셔너는 **메시지를 어떤 파티션으로 보낼지 결정하는 컴포넌트**입니다. Kafka 토픽은 여러 파티션으로 구성될 수 있는데, 파티셔너가 각 메시지를 적절한 파티션에 분배하는 역할을 합니다.
## 주요 특징
**파티션 분배 전략**
- 파티셔너는 메시지의 키(key)를 기반으로 파티션을 결정합니다.
- 같은 키를 가진 메시지는 항상 같은 파티션으로 전송되어 순서가 보장됩니다.

**기본 파티셔너**
- Spring Kafka는 기본적으로 `DefaultPartitioner`를 사용합니다.
- 키가 있으면 해시값을 이용해 파티션을 선택하고, 키가 없으면 라운드 로빈 방식으로 분배합니다.

**커스텀 파티셔너**
- 비즈니스 로직에 맞게 커스텀 파티셔너를 구현할 수 있습니다.
- `Partitioner` 인터페이스를 구현하여 원하는 분배 전략을 적용할 수 있습니다.

## 파티셔닝 흐름
프로듀서가 메시지를 전송하면 파티셔너가 메시지의 키와 값, 토픽 정보를 받아 파티션 번호를 반환합니다. 이후 해당 파티션으로 메시지가 전송되고, 컨슈머는 할당된 파티션에서 메시지를 읽어옵니다.

![[파티셔너 동작.png]]
1. **Producer**에서 4개의 메시지 생성 (일부는 키 있음, 일부는 키 없음)
2. **Partitioner**가 각 메시지를 분석
3. 키가 있으면 해시 계산으로 파티션 결정
4. 키가 없으면 라운드 로빈으로 분배
5. 결정된 **Partition**으로 메시지 전송
6. 각 **Consumer**가 할당된 파티션에서 메시지 소비

같은 키(user-A)를 가진 메시지는 항상 같은 파티션(Partition 1)으로 가는 것을 확인할 수 있습니다.

---

# 커스텀 파티셔너 설계
## 파티션과 처리량의 관계
각 파티션은 독립적으로 처리될 수 있는 단위입니다.
파티션이 많을수록 더 많은 컨슈머가 동시에 메시지를 처리할 수 있어 전체 처리량(throughput)이 증가합니다.

**예시:**
- 파티션 1개 → 컨슈머 1개만 활용 가능 → 초당 1만 메시지 처리
- 파티션 10개 → 컨슈머 10개 활용 가능 → 초당 10만 메시지 처리

## 프로필별 파티션 분리
첫 번째 요구사항인 "프로필별로 Worker에 따라 수용할 수 있는 트래픽이 다르다"를 만족하기 위해 **프로필별로 파티션 수를 조절**하여 부하를 통제합니다.

**예시: 전체 파티션 수가 50개일 때**
- BLACK_HOLE: 0~9 (10개)
- COC: 10~19 (10개)
- UNION: 20~29 (10개)
- GROUP: 30~39 (10개)
- DOMAIN: 40~49 (10개)

## 우선순위별 파티션 분리
두 번째 요구사항인 "밀려있는 요청 중 특정 요청을 빠르게 처리"를 만족하기 위해 프로필 내부에서도 **우선순위별로 파티션을 분리**합니다.

**우선순위는 세 단계로 정의:**
- LOW
- MIDDLE
- HIGH

**예시: BLACK_HOLE 파티션 (0~9) 분배**
- 0~5: LOW (6개)
- 6~8: MIDDLE (3개)
- 9: HIGH (1개)

## 효과
이러한 설계를 통해:
1. 하나의 토픽에서 여러 프로필의 이벤트를 처리하면서도 프로필별로 부하를 분산할 수 있습니다.
2. LOW, MIDDLE 파티션에 요청이 많이 쌓여 대기 중이더라도, 비어있는 HIGH 파티션에 이벤트를 발행하여 우선 처리할 수 있습니다.

---
# 구현
## Partitioner 인터페이스
Kafka의 파티션을 분리했으면, 이제 이벤트 발행 시 프로필과 우선순위에 맞는 파티션으로 이벤트가 전송되도록 **Custom Partitioner**를 구현해야 합니다.

Custom Partitioner는 `Partitioner` 인터페이스를 구현하여 만듭니다:
```java
public interface Partitioner extends Configurable, Closeable {

    int partition(String topic, Object key, byte[] keyBytes, Object value, byte[] valueBytes, Cluster cluster);

    void close();

    default void onNewBatch(String topic, Cluster cluster, int prevPartition) {
    }
}
```

여기서 `partition()` 메서드의 반환값인 `int`는 메시지가 전송될 파티션 번호를 의미합니다.
## Key 설계
파티셔너는 이벤트의 ==Key== 값을 통해 어떤 파티션으로 갈지 결정합니다.
이를 위해 Key를 다음과 같은 형식으로 정의했습니다:

**형식:** `{프로필}-{우선순위}-{UUID}`

**예시:** `BLACK_HOLE-HIGH-550e8400-e29b-41d4-a716-446655440000`

- **프로필**: 어떤 검색엔진 그룹으로 갈지 결정
- **우선순위**: 해당 프로필 내에서 어떤 우선순위 파티션으로 갈지 결정
- **UUID**: 같은 프로필과 우선순위 내에서 파티션을 균등하게 분산

## 1. 설정 클래스 정의
먼저 각 프로필별 파티션 수와 우선순위별 비율을 설정할 수 있는 구조를 정의했습니다.

```java
@ConfigurationProperties(prefix = "kafka.partitioning")
public record PartitioningConfig(
        Map<ProfileType, ProfilePartitioningConfig> profiles
) {
}
```

- **profiles**: 프로필 타입별로 파티션 설정을 관리하는 Map
- `@ConfigurationProperties`를 통해 application.yml에서 설정값을 주입받습니다.

```java
public record ProfilePartitioningConfig(
        int partitionCount,
        PriorityRatioConfig priorityRatio
) {
}
```

- **partitionCount**: 해당 프로필에 할당할 파티션 개수
- **priorityRatio**: LOW, MIDDLE, HIGH 우선순위별 파티션 비율 설정

```java
public record PriorityRatioConfig(
        int low,
        int middle,
        int high
) {
    public int getTotalRatio() {
        return low + middle + high;
    }
}
```

- **low, middle, high**: 각 우선순위별 비율 (예: 6:3:1)
- **getTotalRatio()**: 전체 비율의 합을 계산하여 파티션 분배 시 사용

## 2. CustomPartitioner 구현
Kafka의 `Partitioner` 인터페이스를 구현하여 커스텀 파티셔닝 로직을 작성했습니다.

```java
@Slf4j
public class CustomPartitioner implements Partitioner {

    private PartitioningConfig partitioningConfig;

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        int totalPartitions = cluster.partitionCountForTopic(topic);

        // 1. Key 검증
        KeyValidator.validate(key);
        String keyString = key.toString();

        // 2. Key에서 프로필과 우선순위 추출
        ProfileType profileType = ProfileKeyExtractor.extractProfileType(keyString);
        Priority priority = ProfileKeyExtractor.extractPriority(keyString);

        // 3. 프로필에 해당하는 설정 조회
        ProfilePartitioningConfig config = partitioningConfig.profiles().get(profileType);

        // 4. 설정된 파티션 수와 실제 토픽의 파티션 수 검증
        int configuredPartitions = config.partitionCount();
        int profilePartitions = configuredPartitions;

        if (configuredPartitions > totalPartitions) {
            log.warn(MessageLogFactory.createFrom(
                configuredPartitions,
                profileType,
                totalPartitions,
                "Configured partitions exceeds total partitions"
            ).toJsonString());
            profilePartitions = totalPartitions;
        }

        // 5. 프로필의 시작 오프셋 계산
        int profileStartOffset = PartitionOffsetCalculator.calculateOffset(
            profileType, partitioningConfig, totalPartitions
        );

        // 6. 우선순위에 따른 최종 파티션 계산
        return PriorityPartitionCalculator.calculatePartition(
                priority,
                config.priorityRatio(),
                profilePartitions,
                profileStartOffset,
                keyString
        );
    }

    @Override
    public void configure(Map<String, ?> configs) {
        Object partitioningConfigObj = configs.get("partitioning.config");
        if (partitioningConfigObj instanceof PartitioningConfig config) {
            this.partitioningConfig = config;
        } else {
            log.error(ErrorLogFactory.createFrom(
                "PartitioningConfig not found in configuration"
            ).toJsonString());
            throw new IllegalStateException("PartitioningConfig is required for CustomPartitioner");
        }
    }

    @Override
    public void close() {
        // 리소스 정리가 필요할 때 구현
    }
}
```

**주요 동작 흐름:**
1. **Key 검증**: `KeyValidator`를 통해 Key의 유효성 검증 (null 체크 및 형식 검증)
2. **Key 파싱**: `{프로필}-{우선순위}-{UUID}` 형식에서 프로필과 우선순위 추출
3. **프로필 설정 조회**: 해당 프로필의 파티션 설정 가져오기
4. **파티션 수 검증**: 설정된 파티션 수가 실제 토픽의 파티션 수를 초과하는지 검증
5. **오프셋 계산**: 이전 프로필들의 파티션 개수를 합산하여 시작 위치 계산
6. **최종 파티션 결정**: 우선순위별 비율에 따라 상대 파티션 계산 후 오프셋 더하기

## 3. Key 추출 유틸리티
Key 문자열에서 프로필과 우선순위를 추출하는 유틸리티 클래스입니다.

```java
public final class ProfileKeyExtractor {

    public static ProfileType extractProfileType(String key) {
        return extractKeyPart(key, 0)
                .map(ProfileKeyExtractor::parseProfileType)
                .orElse(ProfileType.BLACK_HOLE);
    }

    public static Priority extractPriority(String key) {
        return extractKeyPart(key, 1)
                .map(Priority::from)
                .orElseThrow(() -> new IllegalArgumentException("Invalid priority in key: " + key));
    }

    private static Optional<String> extractKeyPart(String key, int index) {
        if (Objects.isNull(key)) {
            return Optional.empty();
        }

        String[] parts = key.split("-");
        if (parts.length <= index) {
            return Optional.empty();
        }

        return Optional.of(parts[index]);
    }
}
```

**동작 방식:**
- Key를 `-`로 분리하여 각 부분을 추출
- 0번 인덱스: 프로필 타입 (예: BLACK_HOLE, COC)
- 1번 인덱스: 우선순위 (예: LOW, MIDDLE, HIGH)
- 파싱 실패 시 기본값(BLACK_HOLE) 반환 또는 예외 발생

## 4. 파티션 오프셋 계산
각 프로필의 시작 파티션 번호를 계산하는 유틸리티입니다.

```java
public final class PartitionOffsetCalculator {

    public static int calculateOffset(ProfileType targetProfile,
                                      PartitioningConfig config,
                                      int totalPartitions) {
        return Arrays.stream(ProfileType.values())
                .takeWhile(profile -> profile != targetProfile)
                .mapToInt(profile -> getProfilePartitionCount(profile, config, totalPartitions))
                .sum();
    }

    private static int getProfilePartitionCount(ProfileType profile,
                                                PartitioningConfig config,
                                                int totalPartitions) {
        return config.profiles()
                .entrySet()
                .stream()
                .filter(entry -> entry.getKey() == profile)
                .findFirst()
                .map(entry -> calculateValidPartitionCount(entry.getValue(), totalPartitions))
                .orElse(0);
    }
}
```

**계산 로직:**
- `ProfileType` enum의 순서대로 순회
- 목표 프로필 이전까지의 모든 프로필의 파티션 개수를 합산

**예시:**
```
BLACK_HOLE: 10개 (파티션 0~9)
COC: 10개 (파티션 10~19)
UNION: 10개 (파티션 20~29) ← 오프셋 = 10 + 10 = 20
```

UNION 프로필의 시작 오프셋은 이전 프로필들(BLACK_HOLE, COC)의 파티션 수를 합산한 20입니다.

## 5. 우선순위별 파티션 계산
프로필 내에서 우선순위에 따라 상대적인 파티션 번호를 계산합니다.

```java
public final class PriorityPartitionCalculator {

    public static int calculatePartition(
            Priority priority,
            PriorityRatioConfig ratioConfig,
            int profilePartitions,
            int profileStartOffset,
            String key
    ) {
        var partitionDistribution = calculatePartitionDistribution(ratioConfig, profilePartitions);
        int relativePartition = calculateRelativePartition(priority, partitionDistribution, key);

        return profileStartOffset + relativePartition;
    }

    private static PartitionDistribution calculatePartitionDistribution(
            PriorityRatioConfig ratioConfig,
            int totalPartitions
    ) {
        int totalRatio = ratioConfig.getTotalRatio();

        int lowPartitions = (ratioConfig.low() * totalPartitions) / totalRatio;
        int middlePartitions = (ratioConfig.middle() * totalPartitions) / totalRatio;
        int highPartitions = totalPartitions - lowPartitions - middlePartitions;

        return new PartitionDistribution(
                Math.max(1, lowPartitions),
                Math.max(1, middlePartitions),
                Math.max(1, highPartitions)
        );
    }

    private static int calculateRelativePartition(
            Priority priority,
            PartitionDistribution distribution,
            String key
    ) {
        int hashCode = Math.abs(Objects.hashCode(key));

        return switch (priority) {
            case LOW -> hashCode % distribution.low();
            case MIDDLE -> distribution.low() + (hashCode % distribution.middle());
            case HIGH -> distribution.low() + distribution.middle() + (hashCode % distribution.high());
        };
    }

    private record PartitionDistribution(int low, int middle, int high) {
    }
}
```

**계산 과정:**
1. **우선순위별 파티션 분배**
   - 비율 설정(예: 6:3:1)에 따라 파티션 개수 계산
   - 최소 1개의 파티션은 보장
2. **상대 파티션 번호 계산**
   - Key의 해시값을 이용하여 같은 우선순위 내에서 분산
   - LOW: 0번부터 시작
   - MIDDLE: LOW 파티션 개수만큼 오프셋 추가
   - HIGH: LOW + MIDDLE 파티션 개수만큼 오프셋 추가
3. **최종 파티션 번호**
   - 프로필 시작 오프셋 + 상대 파티션 번호

**예시 계산:**
```
조건:
- 프로필: BLACK_HOLE (파티션 10개, 시작 오프셋 0)
- 비율 설정: LOW=6, MIDDLE=3, HIGH=1

1단계: 파티션 분배
- LOW: (6/10) * 10 = 6개 (파티션 0~5)
- MIDDLE: (3/10) * 10 = 3개 (파티션 6~8)
- HIGH: 10 - 6 - 3 = 1개 (파티션 9)

2단계: 우선순위가 MIDDLE인 경우
- 상대 파티션 = 6 + (hashCode % 3)
  → 6, 7, 8 중 하나
- 최종 파티션 = 0 (시작 오프셋) + 상대 파티션
  → 6, 7, 8 중 하나
```

---

# 정리
이렇게 구현된 Custom Partitioner는 다음과 같은 특징을 가집니다:

## 주요 특징
1. **프로필별 트래픽 제어**
   - 각 검색엔진의 처리 능력에 맞게 파티션 수를 조절하여 부하 분산
2. **우선순위 기반 처리**
   - 같은 프로필 내에서도 우선순위에 따라 파티션을 분리
   - 긴급 요청의 빠른 처리 보장
3. **유연한 설정**
   - application.yml을 통해 프로필별 파티션 수와 우선순위 비율을 동적으로 조정 가능
4. **안정적인 분산**
   - Key의 해시값을 이용하여 같은 우선순위 내에서 균등하게 분산
5. **관심사의 분리**
   - 각 유틸리티 클래스가 단일 책임을 가짐
   - Optional과 Stream API를 활용한 안전한 코드 작성

## 결과
![[전체흐름.png]]

하나의 토픽에서 여러 프로필의 이벤트를 처리하면서도:
- 각 검색엔진의 부하를 적절히 제어
- 우선순위가 높은 요청을 빠르게 처리

이 두 가지 요구사항을 모두 만족할 수 있게 되었습니다.