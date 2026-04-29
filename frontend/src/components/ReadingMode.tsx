import { useAppStore } from "../lib/store";
import styles from "./ReadingMode.module.css";

export function ReadingMode() {
  const { setMode, context } = useAppStore();
  
  // For UI implementation proof-of-concept, we'll mock the projection status 
  // as "STALE" to demonstrate the banner from `44-reading-mode.md`
  const projectionStatus = "STALE"; 

  return (
    <div className={styles.container}>
      {/* 投影状态 Banner (Projection Status Banner) */}
      {projectionStatus === "STALE" && (
        <div className={styles.staleBanner}>
          <div className={styles.bannerLeft}>
            <span className={styles.bannerStatus}>投影状态：已过期</span>
            <span className={styles.bannerDesc}>底层设定已有变更，当前阅读的可能不是最新版本。</span>
          </div>
          <button className={styles.refreshBtn}>刷新投影</button>
        </div>
      )}

      {/* 顶部栏 (Top Bar) */}
      <div className={styles.topBar}>
        <div className={styles.contextGroup}>
          <span className={styles.modeText}>阅读模式</span>
          <span className={styles.divider}>/</span>
          <span className={styles.titleText}>{context.workTitle || "未定作品"}  [切换]</span>
        </div>
        <button 
          className={styles.backBtn}
          onClick={() => setMode("workbench")}
        >
          返回工作台
        </button>
      </div>

      {/* 主阅读区域 (Main Area) */}
      <div className={styles.mainArea}>
        
        {/* 侧边目录 (TOC Sidebar) */}
        <div className={styles.tocSidebar}>
          <div className={styles.tocTitle}>目录</div>
          <div className={styles.tocList}>
            <div className={styles.tocVolume}>第一卷：遗迹的呼唤</div>
            <div className={styles.tocChapterActive}>第一章 迷雾深处</div>
            <div className={styles.tocChapter}>第二章 守卫的苏醒</div>
            <div className={styles.tocChapter}>第三章 导师的线索</div>
          </div>
        </div>

        {/* 内容展示区 (Reading Content Area) */}
        <div className={styles.readingContentArea}>
          <div className={styles.contentBlock}>
            <h1 className={styles.chapterTitle}>第一章 迷雾深处</h1>
            <div className={styles.paragraph}>
              新历40年，初秋。
            </div>
            <div className={styles.paragraph}>
              灰色的浓雾像是有生命般，在黑石砌成的古老遗迹边缘翻滚。艾林收紧了破旧的防风斗篷，手指下意识地摩挲着口袋里那块冰冷的金属怀表——那是导师留给他的唯一信物。
            </div>
            <div className={styles.paragraph}>
              “你确定是这里吗？”身后的佣兵同伴压低声音，语气中透着紧张。
            </div>
            <div className={styles.paragraph}>
              艾林没有回头，只是凝视着雾气深处隐约可见的巨大机械轮廓。“探测仪的共鸣频率达到了最高值。如果十年前的记录没错，这里就是核心区。”
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
