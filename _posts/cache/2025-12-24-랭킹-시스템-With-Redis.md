---
title: 랭킹 시스템 With Redis
categories: Cache
layout: post
tags:
  - Spring
  - Cache
date: 2025-12-24
excerpt: Redis를 활용해 랭킹 시스템을 개발합니다.
image_thumbnail: /assets/images/posts/redis.png
---
# 랭킹 시스템
--- 
이커머스 서비스를 보면 흔하게 “인기도순”으로 상품을 정렬하여 보이거나 하는 조회 페이지를 많이 볼 수 있습니다.
아래는 29cm의 Best 상품 목록입니다.
![[29cm-best.png]]

저는 이런 상품에 대한 랭킹 시스템을 간단하게 구현해려고 합니다.

# Redis Zset
첫번째로는 이 랭킹에 대한 인기도 데이터를 “어디에" 저장할까? 에 대한 고민이 있었습니다.

일단 이 도메인 특성을 고민해야했습니다.
- 오래된 인기도 데이터는 필요가 없다.
- 인기도 순으로 정렬된 데이터가 필요하다.
- 인기도 순의 “조회”의 목적을 가지므로, 조회의 성능이 중요하다.

결론적으로 내린 결론은 **“Redis Zset”** 이였습니다.

Redis는 인메모리 데이터베이스로 매우 빠르게 조회할 수 있습니다.
그리고 TTL을 설정하여 데이터를 얼마나 보존할 것인지 결정할 수 있습니다.
또한 Redis 서버가 다운되어 메모리 기반의 데이터가 휘발되더라도 AOF, RDB 등의 백업 정책을 지원하여 다시 복구도 가능했습니다.

그리고 다양한 String, Bitmaps, Lists, Hashes등의 많은 자료형을 지원합니다.
저는 이 중에서도 상품을 인기도 순으로 “정렬”을 해야하므로 zset 자료형을 사용하기로 했습니다.

zset 자료형은 아래와 같이 데이터를 저장합니다.
![[zset-구조.png]]
## Key Namespace
Redis는 내부적으로 모든 Key를 평평한 공간(flat namespace)에 저장합니다.
즉, Key를 통해 내부 공간을 분리해야 조회를 할 수 있습니다.

저는 이 상품 랭킹 시스템에서 나눌 수 있는 부분을 아래와 같이 정의했습니다.
- 인기도가 존재하는 시간
- 상품의 카테고리 (아우터, 티셔츠, 신발 ..etc)

그럼 namespace를 다음과 같이 정의할 수 있습니다.
`ranking:{상품 카테고리}:yyyy-MM-dd`

이런 경우 상품 카테고리 별로 namespace를 정의해야되므로 상품 카테고리는 `all`로 하여 `ranking:all:yyyy-MM-dd` 형식으로 구현했습니다.

# 인기도 누적
---
상품의 인기도는 많은 요소로 인해 결정이 될 수 있습니다.
저는 크게 아래의 요소로 인기도를 결정했습니다.
- 상품의 상세 조회 수
- 상품의 좋아요 수
- 상품의 구매 수

그럼 이 “사건”이 일어났을 때 Redis를 통해 인기도 점수를 누적해야합니다.
즉, 상품 상세 조회, 좋아요, 구매라는 “이벤트”가 발생했을 때, 점수를 누적해야 한다고 판단했습니다.
때문에 카프카를 통해 “이벤트”가 발생했을 때, 점수를 누적하도록 구현했습니다.

아래는 간단하게 구현한 상품 조회의 예시입니다.

**상품 조회 서비스**
``` java
@Transactional  
public ProductDetail getProductDetail(GetProductDetailQuery query) {  
    ProductId productId = new ProductId(query.getProductId());  
	
	// 이벤트 발행을 위한 아웃박스 저장
    eventOutboxRepository.save(outbox);  
    
    return cacheRepository.findDetailBy(productId)  
            .orElseGet(() -> {  
                Product product = productRepository.getById(productId);  
                Brand brand = brandRepository.getBrandById(product.getBrandId());  
                ProductDetail productDetail = ProductDetail.create(product, brand);  
                cacheRepository.save(productDetail);  
  
                return productDetail;  
            });  
}
```

이제 아웃박스를 통해 저장된 이벤트가 발행되면 아래와 같이 컨슈머에서 인기도를 증가시킵니다.

**컨슈머**
``` java
@KafkaListener(  
        topics = {"${spring.kafka.topic.product-detail-viewed}"},  
        containerFactory = KafkaConfig.BATCH_LISTENER,  
        groupId = "increase-product-view-ranking-score"  
)  
public void listen(  
        List<ConsumerRecord<Object, String>> records,  
        Acknowledgment acknowledgment  
) {  
    records.stream()  
            .map(event -> JacksonUtil.convertToObject(event.value(), IncreaseProductViewRankingScoreEvent.class))  
            .map(IncreaseProductViewRankingScoreEvent::toCommand)  
            .forEach(service::increase);  
  
    acknowledgment.acknowledge();  
}
```

**상품 조회 서비스** 
``` java
@InboxEvent(  
        aggregateType = "PRODUCT",  
        eventType = "INCREASE_PRODUCT_VIEW_RANKING_SCORE",  
        eventIdField = "eventId",  
        aggregateIdField = "productId"  
)  
public void increase(IncreaseProductViewRankingScoreCommand command) {  
    ProductId productId = new ProductId(command.productId());  
    productRankingCacheRepository.increaseDaily(productId, LocalDate.now(), weight);  
}
```

상품 조회 서비스를 보면 `weight`를 지정한 것을 볼 수 있습니다.
이 weight는 무엇을 의미할까요? 그것을 말하기 전에 이 “인기도”라는 것이 어떤 것을 의미하는 지 고민할 필요가 있었습니다.

- 상품을 많이 조회했으면 인기가 많은 것일까?
- 좋아요를 많이 클릭했으면 인기가 많은 것일까?
- 구매를 많이 했으면 인기가 많은 것일까?

즉, 우리가 행하려는 이 행위에 “인기도”라는 점수를 매기기 위해서는 그 “비중”을 결정해야했습니다.
그래서 내가 어떤 특정 상품을 주문할 때 위 행위의 케이스를 생각해보면 아래와 같았습니다.

- 조회는 단순히 그냥 보러 들어올 수 있다.
- 좋아요는 나중에 다시보고 싶은 상품에 좋아요를 한다. 
- 구매는 신중이 생각하고 정말 사고싶은 물품을 구매한다.

때문에 이 비중에 따라 이 인기도의 점수를 결정할 필요가 있었고 그 점수를 `weight`로 결정했습니다.

## Redis 구현
Redis의 zset은 많은 연산을 제공합니다.
어떤 연산을 제공하는지는 인터넷을 통해 많이 공유되고 있으므로 사용한 연산만 알아보겠습니다.

일단 점수를 누적하기위해 `increaseScore`를 통해 점수를 누적합니다.

```java
/**  
 * Increment the score of element with {@code value} in sorted set by {@code increment}.  
 * * @param key must not be {@literal null}.  
 * @param value the value.  
 * @param delta the delta to add. Can be negative.  
 * @return {@literal null} when used in pipeline / transaction.  
 * @see <a href="https://redis.io/commands/zincrby">Redis Documentation: ZINCRBY</a>  
 */  
@Nullable  
Double incrementScore(K key, V value, double delta);
```

저는 위에서 언급했던 것 처럼 각 값을 아래와 같이 설정했습니다.
- key : `ranking:all:yyyy-MM-dd`  형식의 네임스페이스
- value : 상품의 ID
- score : 각 행위의 weight

그리고 아래와  같이 구현했습니다.
``` java
@Override  
public void increaseDaily(String productId, LocalDate date, Double score) {  
    String key = RANKING_KEY_PREFIX + date.format(DATE_FORMATTER);  
    redisTemplate.opsForZSet().incrementScore(key, productId, score);  
    redisTemplate.expire(key, Duration.ofDays(TTL_DAYS));  
}
```

# Cold Start
저는 키를 `ranking:all:yyyy-MM-dd` 로 설정했습니다.
여기서 `yyyy-MM-dd`로 저장하겠다는 의미는 하루하루 데일리로 랭킹을 관리하겠다는 의미가 있습니다.
랭킹을 조회한다면 하루의 단위로 랭킹을 조회하겠다는 의미가 됩니다.

그럼 여기서 고민이 하나 생겼습니다.

“다음날 00시 00분에는 캐시가 사라져서 아무 목록도 안나오게 되면 어떡하지?”

즉, 사용자는 23시 59분에 이어서 인기 있었던 상품을 계속 보고 싶을 수 있지만 다음날에 막 넘어가는 시점에서는 아무것도 조회가 되지 않을 수 있습니다. 이 문제를 “Cold Start”라고 부릅니다. 

저는 이 문제를 해결하기위해 스케쥴러를 통해 전날 23시 50분에 다음날로 옮겨야 합니다.
하지만 여기서 또 문제가 발생합니다.

이렇게 계속 이어서 점수를 그대로 옮긴다면 랭킹이 갱신되지 않고 보이는 상품만 계속해서 보이게되는 문제가 발생할 수 있습니다.
때문에 이전처럼 가중치(weight)을 두어 전날 점수의 일정 비율만큼만 이관을 해야했습니다.

모든 Redis의 상품 캐시를 전부 우리 어플리케이션 메모리에 올리고 다시 다음날 점수로 넣는다면 메모리 이슈가 발생할 위험이 크다고 판단하여 고민 중에 Redis에서 적절한 기능을 제공하는 것을 확인했습니다.

바로 `unionAndStore`입니다.
이 기능은 다른 키들에 있는 값들을 Aggregate하여 새로운 키에 해당하는 값으로 옮겨줍니다.

구현은 아래와 같습니다.
```java
@Override  
public void carryOverWithWeights(String sourceKey, String destKey, Double weight) {  
    redisTemplate.opsForZSet().unionAndStore(  
            sourceKey,  
            Collections.emptyList(),  
            destKey,  
            Aggregate.SUM,  
            Weights.of(weight)  
    );  
    redisTemplate.expire(destKey, Duration.ofDays(TTL_DAYS));  
}
```

# 그래서 잘 구현됐을까?
사실 제가 구현한 이 방식에는 위 예시처럼 29cm과 같은 서비스에서는 운영하지 못할 방식이라고 생각했습니다.
그 이유는 29cm과 같은 서비스에서는 성별, 상품 카테고리 등 다양한 검색 조건들이 존재합니다.

위와 같이 Redis zset으로 구현하는 경우 성별 x 상품 고리 x … 로 어림잡아도 수천, 수 만개의 zset을 만들어야합니다. 이는 비정상적이고 운영할 수 없게 됩니다.

그래서 실제로 29cm과 같은 서비스에서는 어떻게 상품의 인기도를 관리하면서 저런 수 많은 필터 조건을 통해 검색까지 할 수 있을까 고민이되었습니다.

아마 짐작으로는 매일 상품 주문, 조회, 좋아요 등 많은 데이터들을 매일 집계하고 집계된 데이터들을 통해서 ElasticSearch와 같은 빠르게 조회할 수 있는 데이터베이스에 저장하지 않을까? 라는 생각이 들었습니다.

이 또한 추측이고, 확신이 될 때까지 많은 공부와 노력이 들겠구나.. 라는 생각이 들었습니다.

