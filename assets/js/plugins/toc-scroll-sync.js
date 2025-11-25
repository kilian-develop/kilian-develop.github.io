/**
 * TOC Collapse/Expand with Scroll Synchronization
 *
 * 스크롤 위치에 따라 목차 섹션을 자동으로 펼칩니다.
 * - h2 제목들만 기본적으로 보임
 * - 현재 스크롤 위치의 h2 섹션이 자동으로 펼쳐짐
 * - 하위 제목(h3, h4)들이 펼쳐진 섹션 아래에 표시됨
 */

(function() {
  'use strict';

  // DOM 요소 캐싱
  const tocWrapper = document.querySelector('.toc-wrapper');
  const tocList = document.querySelector('.toc-list');
  const eContent = document.querySelector('.e-content');

  // 요소가 없으면 스크립트 종료
  if (!tocWrapper || !tocList || !eContent) {
    return;
  }

  /**
   * 목차를 계층 구조로 재구성
   */
  function buildHierarchicalToc() {
    const allItems = Array.from(tocList.querySelectorAll('.toc-item'));
    let currentH2 = null;
    let currentH2Sublist = null;
    let currentH3 = null;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      const level = parseInt(item.getAttribute('data-level'));
      const nextItem = allItems[i + 1];
      const nextLevel = nextItem ? parseInt(nextItem.getAttribute('data-level')) : null;

      if (level === 1) {
        // h1 항목 처리
        currentH2 = item;
        currentH2Sublist = null;
        currentH3 = null;

        // 다음 항목이 h2, h3 또는 h4이면 서브리스트 생성
        if (nextLevel === 2 || nextLevel === 3 || nextLevel === 4) {
          currentH2Sublist = document.createElement('ul');
          currentH2Sublist.className = 'toc-sublist toc-level-2';
          item.appendChild(currentH2Sublist);
        }
      } else if (level === 2) {
        // h2 항목 처리
        if (currentH2Sublist) {
          const clonedItem = item.cloneNode(true);
          clonedItem.className = 'toc-item toc-level-2';
          currentH2Sublist.appendChild(clonedItem);
          currentH2 = clonedItem;

          // 다음 항목이 h3 또는 h4이면 서브리스트 생성
          if (nextLevel === 3 || nextLevel === 4) {
            const h2Sublist = document.createElement('ul');
            h2Sublist.className = 'toc-sublist toc-level-3';
            currentH2.appendChild(h2Sublist);
            currentH2Sublist = h2Sublist;
          }
        } else {
          // h1 없이 h2가 나온 경우 (일반적이지 않음)
          currentH2 = item;
          currentH2Sublist = null;
          currentH3 = null;

          if (nextLevel === 3 || nextLevel === 4) {
            currentH2Sublist = document.createElement('ul');
            currentH2Sublist.className = 'toc-sublist toc-level-3';
            item.appendChild(currentH2Sublist);
          }
        }
      } else if (level === 3) {
        // h3 항목 처리
        if (currentH2Sublist) {
          const clonedItem = item.cloneNode(true);
          clonedItem.className = 'toc-item toc-level-3';
          currentH2Sublist.appendChild(clonedItem);
          currentH3 = clonedItem;

          // 다음 항목이 h4이면 서브서브리스트 생성
          if (nextLevel === 4) {
            const h3Sublist = document.createElement('ul');
            h3Sublist.className = 'toc-sublist toc-level-4';
            currentH3.appendChild(h3Sublist);
          }
        }
      } else if (level === 4) {
        // h4 항목 처리
        if (currentH3) {
          let h3Sublist = currentH3.querySelector(':scope > .toc-sublist');
          if (!h3Sublist) {
            h3Sublist = document.createElement('ul');
            h3Sublist.className = 'toc-sublist toc-level-4';
            currentH3.appendChild(h3Sublist);
          }
          const clonedItem = item.cloneNode(true);
          clonedItem.className = 'toc-item toc-level-4';
          h3Sublist.appendChild(clonedItem);
        } else if (currentH2Sublist) {
          // h3 없이 h4만 있는 경우
          const clonedItem = item.cloneNode(true);
          clonedItem.className = 'toc-item toc-level-4';
          currentH2Sublist.appendChild(clonedItem);
        }
      }
    }

    // 원본 h2, h3, h4 항목들 제거 (h1만 남김)
    allItems.forEach(item => {
      const level = parseInt(item.getAttribute('data-level'));
      if (level !== 1) {
        item.remove();
      }
    });
  }

  /**
   * 현재 스크롤 위치의 가장 가까운 헤딩(h1-h4) 찾기
   */
  function getCurrentSection() {
    const allHeadings = eContent.querySelectorAll('h1, h2, h3, h4');
    let current = null;

    for (const heading of allHeadings) {
      const rect = heading.getBoundingClientRect();

      // 헤딩이 뷰포트 상단에서 100px 이내에 보이는가?
      if (rect.top <= 100) {
        current = heading;
      } else {
        break;
      }
    }

    return current;
  }

  /**
   * 모든 하위 목차 접기
   */
  function collapseAll() {
    const sublists = tocList.querySelectorAll('.toc-sublist');
    sublists.forEach(sublist => {
      sublist.classList.remove('expanded');
    });
  }

  /**
   * 특정 헤딩의 경로상 모든 부모 목차 펼치기
   */
  function expandPath(heading) {
    if (!heading || !heading.id) return;

    collapseAll();

    // 해당 헤딩에 해당하는 목차 링크 찾기
    const tocLink = tocList.querySelector(`a[href="#${heading.id}"]`);
    if (!tocLink) return;

    let currentLi = tocLink.closest('li');
    if (!currentLi) return;

    // 현재 항목부터 루트까지 올라가면서 모든 부모의 서브리스트 펼치기
    let parent = currentLi.parentElement;
    while (parent && parent !== tocList) {
      // 부모가 .toc-sublist이면 펼치기
      if (parent.classList.contains('toc-sublist')) {
        parent.classList.add('expanded');
        // 이 서브리스트의 부모 li로 이동
        parent = parent.parentElement?.parentElement;
      } else {
        break;
      }
    }
  }

  /**
   * 현재 활성 항목 강조 및 경로상 모든 목차 펼치기
   */
  function updateActiveItem() {
    const currentSection = getCurrentSection();
    const tocItems = tocList.querySelectorAll('.toc-item a');

    // 모든 항목에서 활성 클래스 제거
    tocItems.forEach(item => {
      item.classList.remove('active');
      item.parentElement.classList.remove('active');
    });

    if (currentSection) {
      // 현재 섹션의 목차 항목 강조
      const activeItem = tocList.querySelector(`a[href="#${currentSection.id}"]`);
      if (activeItem) {
        activeItem.classList.add('active');
        activeItem.parentElement.classList.add('active');
      }

      // 현재 섹션까지의 경로상 모든 부모 목차 펼치기
      expandPath(currentSection);
    }
  }

  /**
   * 스크롤 이벤트 핸들러 (실시간 반응)
   */
  function onScroll() {
    updateActiveItem();
  }


  /**
   * 초기 상태 설정
   */
  function init() {
    // 목차 구조 재구성
    buildHierarchicalToc();

    // 초기 활성 항목 설정
    updateActiveItem();

    // 스크롤 이벤트 리스너 추가 (passive: true로 성능 최적화)
    window.addEventListener('scroll', onScroll, { passive: true });

    // 디버그 로그
    console.log('[TOC] Hierarchical TOC structure initialized');
  }

  // DOM이 준비되면 초기화
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
