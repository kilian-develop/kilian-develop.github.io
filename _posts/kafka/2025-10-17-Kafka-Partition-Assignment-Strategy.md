---
title: Kafka Partition Assignment Strategy
categories: Kafka
layout: post
tags:
  - Kafka
  - Consumer
  - Partition Assignment
date: 2025-10-17
excerpt: Kafka Consumer Group의 파티션 할당 방식을 상세히 분석합니다.
image_thumbnail: /assets/images/posts/kafka.png
---

# 개요
---
Kafka의 Consumer는 Topic의 여러 Partition에서 메시지를 소비합니다.
하나의 Consumer Group에 여러 Consumer가 있을 때, **어떤 Consumer가 어떤 Partition을 담당할지 결정하는 과정**을 **Partition Assignment(파티션 할당)**라고 합니다.

이 할당 방식에 따라 **메시지 처리 순서, 부하 분산, 리밸런싱 성능**이 크게 달라집니다.

# Partition Assigner란?
---
## 정의
**Kafka Partition Assignment Strategy** 는 Consumer Group의 Consumer들에게 Topic의 Partition을 분배하는 알고리즘을 구현한 전략입니다.

## 필요한 이유
- **부하 분산**: Partition을 Consumer에 균등하게 분배
- **메시지 순서 보장**: 같은 Partition의 메시지는 순서가 보장됨
- **높은 가용성**: Consumer 추가/제거 시 자동으로 재할당

## 할당이 발생하는 시점
```
1. Consumer Group 최초 구성 시
2. Consumer 추가/제거 시 (리밸런싱)
3. Partition 수 변경 시
4. Rebalance 트리거 시
```


# Partition Assigner의 종류
---
Kafka에서 제공하는 주요 Assigner는 4가지입니다:

1. **RangeAssigner** (기본값)
2. **RoundRobinAssigner**
3. **StickyAssigner**
4. **CooperativeStickyAssigner**

## 설정 방법

```properties
# consumer.properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.RangeAssigner
```

또는 여러 개를 지정 가능:

```properties
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssigner,org.apache.kafka.clients.consumer.RangeAssigner
```


# 1. RangeAssigner (범위 기반 할당)
---
## 개요
**Topic별로** Partition을 연속된 범위로 나누어 Consumer에 순서대로 할당합니다.

## 할당 방식
![RangeAssignor_방식](/assets/images/posts/RangeAssignor_방식.png)

- Default Assignor
- 토픽 별로 Partition 순서대로 Consumer에게 할당된다.
- Partition 개수보다 Consumer 개수가 더 크면, Partition을 할당받지 못하는 Consumer가 발생할 수 있다.


# 2. RoundRobinAssigner (라운드 로빈 할당)
---
## 개요
모든 Topic의 Partition을 **하나씩 순회하면서** Consumer에 할당합니다.

## 할당 방식
![RoundRobinAssigner_방식](/assets/images/posts/RoundRobinAssigner_방식.png)
- Round Robin 방식으로 Partition들과 Consumer들을 분배하여 할당한다.
- Topic 관계없이, Partition 순서대로 Consumer에 할당한다.
- Partition이 추가되거나 삭제되어 Reassign(재할당)이 발생하면, Consumer가 기존에 처리하던 Partition을 다시 할당받을 수 있다는 보장이 없다.

**할당 불균형 발생**
![RoundRobinAssigner_불균형](/assets/images/posts/RoundRobinAssigner_불균형.png)
Consumer 간 Subscribe 해오는 Topic이 다를 경우, **할당 불균형이 발생할 수 있다.**



# 3. StickyAssigner (끈기 있는 할당)
---
## 개요
**부하 균형**과 **Rebalancing 최소화**를 동시에 달성하려는 Assigner입니다.

![StickyAssigner_방식](/assets/images/posts/StickyAssigner_방식.png)

- Round Robin 방식보다 균형적이면서, Range 방식보다 Reblancing 오버헤드를 줄인 방식입니다.
- 가능한 한 균형적으로 할당을 보장합니다. -> Consumer A가 Consumer B에 비해 2개 이상 더 적은 Topic Partition이 할당된 경우, Consumer A에 할당된 Topic의 나머지 Partition들은 Consumer B에게 할당되지 않습니다.
- 재할당이 발생했을 경우, 기존 할당을 최대한 많이 보존한다. -> Topic Partition의 Consumer 간 이동 오버헤드를 줄입니다.

**재할당 방식**
**상황: Consumer 1 제거**
![StickyAssigner_consmer_삭제](/assets/images/posts/StickyAssigner_consmer_삭제.png)

- Round Robin Assignor의 경우 할당 방식과 마찬가지로 순서대로 다시 할당된다. -> **전체를 다시 할당**
- Sticky Assignor의 경우 제거 전 상태에서 할당이 끊긴 Partition들을 최대한 분산되게 할당한다. -> **기존 할당은 유지하면서, 나머지 부분을 할당**

# 4. CooperativeStickyAssigner (협력적 끈기 있는 할당)
---
## 개요
**StickyAssigner의 개선 버전**입니다. Kafka 2.5.0부터 도입되었으며, **"Stop the World" 방식의 Rebalancing을 없애고 협력적 리밸런싱을 지원**합니다.

**Eager Rebalancing 프로토콜**은 하나의 Consumer가 Consumer Group에 새로 추가되거나 삭제되면, Group 내 모든 Consumer가 작업을 멈추고 다시 JoinRequest부터 시작하여 Partition을 할당받습니다.

- 안전하지만, Reassign 동안 작업을 수행할 수 없습니다.
- 변하지 않는 Partition 역시 Reassign이 발생합니다.  

**Incremental Cooperative Rebalancing 프로토콜**은 Eager Rebalancing 프로토콜의 단점을 보완하기 위해 만들어졌습니다.

- Consumer A가 Partition 1, Partition 2를 작업하고 있는 도중, Consumer B가 Consumer Group에 들어온다면 Consumer B에게 할당시킬 Parititon 2만 작업을 중지하고 Partition 1은 Reassign 과정에도 Consume이 진행됩니다.
- 문제점: Consumer는 자신의 Partition 중 어느 것을 다른 곳으로 재할당 시켜야 하는지 모릅니다.  

**Cooperative Sticky Assignor 프로토콜**은 Incremental Cooperative Rebalancing 프로토콜의 문제점을 해결하기 위해서 만들어졌습니다.

- Rebalancing을 두 번 수행합니다.
- Apache kafka 2.5에서 추가되었습니다.
- 하나의 Consumer가 Consumer Group에 새로 추가되거나 삭제될 때, 각 Consumer들은 보유하고 있는 Partition 들을 그대로 보유하고 그 정보를 Group Coordinator에게 보냅니다.
- Sync Group Response를 받을 때, Group Coordinator로부터 어떤 Partition을 Reassign 할 것인지 정보를 받습니다.
- 이후 소유권을 이전시킬 Partition만 Revoke를 시키고 나머지 Partition은 정상 동작하면서 Rebalancing 작업을 한 번 더 수행합니다.
- 빈번히 Rebalancing 작업이 이루어지는 상황이거나 Scale In/Out으로 인한 다운 타임이 우려될 때 사용하면 좋습니다.
