/**
 * Sidebar & TOC Parallax Effect
 *
 * 스크롤 속도에 맞춰 프로필(page-sidebar)과 목차(toc-wrapper)가 동일한 속도로 움직이는 parallax 효과
 */

(function() {
  'use strict';

  const sidebar = document.querySelector('.page-sidebar');
  const tocWrapper = document.querySelector('.toc-wrapper');

  // sidebar가 없으면 스크립트 종료
  if (!sidebar) {
    return;
  }

  let ticking = false;
  let lastScrollY = 0;

  /**
   * Parallax 이동값 계산 및 적용
   */
  function updateParallax() {
    const scrollY = window.scrollY;
    const sidebarHeight = sidebar.offsetHeight;
    const viewportHeight = window.innerHeight;

    // parallax 효과: 스크롤의 30% 정도만 움직임
    let translateY = scrollY * 0.3;

    // 프로필이 화면 상단 근처에서 멈추도록 제한
    // viewportHeight의 35% 지점에서 멈춤
    const maxTranslateY = Math.max(0, viewportHeight * 0.35 - sidebarHeight / 2);
    translateY = Math.min(translateY, maxTranslateY);

    sidebar.style.transform = `translateY(${translateY}px)`;

    // TOC도 동일한 패턴으로 움직이기
    if (tocWrapper) {
      tocWrapper.style.transform = `translateY(${translateY}px)`;
    }

    ticking = false;
  }

  /**
   * 스크롤 이벤트 핸들러 (requestAnimationFrame으로 최적화)
   */
  function onScroll() {
    lastScrollY = window.scrollY;

    if (!ticking) {
      window.requestAnimationFrame(updateParallax);
      ticking = true;
    }
  }

  /**
   * 초기 설정
   */
  function init() {
    // 초기 상태 설정
    sidebar.style.transition = 'none';
    if (tocWrapper) {
      tocWrapper.style.transition = 'none';
    }
    updateParallax();

    // 스크롤 이벤트 리스너 추가
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // DOM이 준비되면 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
