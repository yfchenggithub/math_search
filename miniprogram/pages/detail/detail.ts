/**
 * 详情页页面控制器。
 *
 * 这个文件主要解决两件事：
 * 1. 接住 `detail-content.ts` 产出的详情 view model，并把它放到页面 data 中。
 * 2. 管理详情页的阅读交互，尤其是滚动、双击放大、双指缩放、拖拽和平滑回弹。
 *
 * 在整个详情链路中的位置：
 * - `detail-content.ts` 负责“数据适配”，把原始 record 转成页面可消费结构。
 * - 本文件负责“页面状态与交互控制”，不关心原始 schema 的细节。
 * - `detail.wxml / detail.scss` 负责最终视图呈现。
 *
 * 推荐阅读顺序：
 * 1. `onLoad`：详情数据如何进入页面。
 * 2. `scheduleMeasure / measureContent`：页面为什么要测量容器与内容尺寸。
 * 3. `onToggleZoom / zoomTo / rebound`：放大缩小是如何工作的。
 * 4. `onTouchStart / onTouchMove / onTouchEnd`：手势链路如何接管整页阅读。
 */
import { getConclusionDetail } from "../../api/search";
import type {
  DetailDocumentView,
  DetailSectionView,
} from "../../utils/detail-content";
import { buildApiDetailDocument } from "../../utils/detail-api";
import { getDetailDocument } from "../../utils/detail-content";
import { getErrorMessage } from "../../utils/request";
import { handleInvalidAccess } from "../../utils/router";

type TouchPoint = {
  pageX: number;
  pageY: number;
};

/**
 * 详情页的整体执行流程：
 * 1. `onLoad` 根据路由参数读取详情数据，并把基础内容放入页面 data。
 * 2. 页面渲染完成后，调用 `scheduleMeasure` / `measureContent` 获取容器和正文尺寸。
 * 3. 正常状态下由 `scroll-view` 负责纵向阅读滚动。
 * 4. 一旦进入缩放态，页面会改为由 transform + 手势控制视口位置。
 * 5. 缩放结束后，通过 `resetTransform` / `getRestoreScrollTop` 尽量保持阅读位置连续。
 */
Page({
  data: {
    id: "",
    title: "",
    category: "",
    summary: "",
    summaryHtml: "",
    coreFormulaHtml: "",
    sections: [] as DetailSectionView[],
    pdfUrl: "",
    hasPdf: false,
    sourceType: "meta",
    articleScrollTop: 0,
    transformStyle: "transform: translate3d(0px, 0px, 0) scale(1);",
    zoomActive: false,
    scaleLabel: "100%",
  },

  // 当前缩放比例及上一次稳定缩放比例。
  scale: 1,
  lastScale: 1,

  // 当前平移量及上一次稳定平移量。
  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,

  // 允许的缩放范围。最小值保持 1，代表默认阅读态。
  minScale: 1,
  maxScale: 4,

  // 手势中间态。这里保存一次触控过程开始时的关键数据，方便 move 阶段计算增量。
  gesture: {
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
  },

  lastTapTime: 0,
  ticking: false,

  // 视口与正文尺寸信息。
  // 这些数据是后续计算缩放边界、拖拽范围和回弹目标的基础。
  containerWidth: 0,
  containerHeight: 0,
  contentWidth: 0,
  contentHeight: 0,
  viewerLeft: 0,
  viewerTop: 0,
  articleScrollTop: 0,

  velocityX: 0,
  velocityY: 0,
  lastMoveTime: 0,
  lastMoveX: 0,
  lastMoveY: 0,
  inertiaId: 0,
  measureTimer: 0,

  /**
   * 一个极简的 raf 替代品。
   *
   * 小程序环境里并不是每处都方便直接使用浏览器原生 `requestAnimationFrame`，
   * 这里统一用 16ms 定时器模拟一帧，服务回弹和惯性动画。
   */
  raf(callback: Function) {
    return setTimeout(() => callback(), 16);
  },

  /**
   * 详情页的数据加载入口。
   *
   * 当前采用“后端优先，本地降级”的策略：
   * 1. 先请求后端 `/conclusion/{id}`；
   * 2. 如果接口不可用，则自动回退到本地静态内容；
   * 3. 页面交互层继续只消费统一的 `DetailDocumentView`。
   */
  async loadDetail(options: Record<string, string | undefined>) {
    const id = String(options.id || "").trim();

    if (!id) {
      handleInvalidAccess("缺少结论 ID");
      return;
    }

    wx.showLoading({
      title: "加载中...",
    });

    try {
      const detail = await this.resolveDetailDocument(id);

      if (!detail) {
        handleInvalidAccess("未找到对应内容");
        return;
      }

      this.applyDetailDocument(detail);
    } catch (error) {
      handleInvalidAccess(getErrorMessage(error, "详情加载失败"));
    } finally {
      wx.hideLoading();
    }
  },

  /**
   * 优先读取后端详情，失败后回退本地内容。
   */
  async resolveDetailDocument(id: string): Promise<DetailDocumentView | null> {
    try {
      const remoteDetail = await getConclusionDetail(id);
      return buildApiDetailDocument(remoteDetail);
    } catch (error) {
      console.warn("后端详情加载失败，已回退到本地详情内容", error);

      const localDetail = getDetailDocument(id);
      if (localDetail) {
        return localDetail;
      }

      throw error;
    }
  },

  /**
   * 将统一的详情 view model 应用到页面。
   *
   * 这里顺手重置缩放和滚动状态，避免从上一个条目残留交互状态。
   */
  applyDetailDocument(detail: DetailDocumentView) {
    this.resetTransform(false);
    this.articleScrollTop = 0;

    this.setData({
      id: detail.id,
      title: detail.title,
      category: detail.category,
      summary: detail.summary,
      summaryHtml: detail.summaryHtml,
      coreFormulaHtml: detail.coreFormulaHtml,
      sections: detail.sections,
      pdfUrl: detail.pdfUrl,
      hasPdf: detail.hasPdf,
      sourceType: detail.sourceType,
      articleScrollTop: 0,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
    }, () => {
      this.scheduleMeasure();
    });
  },

  /**
   * 详情页入口。
   *
   * 输入：
   * - 路由参数中的 `id`。
   *
   * 输出：
   * - 调用详情适配层拿到统一 view model。
   * - 初始化页面 data。
   * - 重置所有缩放/拖拽状态，确保从上一个详情页切过来时不会残留交互状态。
   */
  onLoad(options: Record<string, string | undefined>) {
    // 详情页现阶段优先走远端接口；后面的旧本地加载逻辑暂时保留，
    // 作为迁移阶段的参考代码，实际运行不会再走到。
    void this.loadDetail(options);
    void this.loadDetail(options);
    return;

    /*
    const id = (options.id || "").trim();
    const detail = getDetailDocument(id);

    if (!detail) {
      handleInvalidAccess("未找到对应内容");
      return;
    }

    this.resetTransform(false);
    this.articleScrollTop = 0;

    this.setData({
      id: detail.id,
      title: detail.title,
      category: detail.category,
      summary: detail.summary,
      summaryHtml: detail.summaryHtml,
      coreFormulaHtml: detail.coreFormulaHtml,
      sections: detail.sections,
      pdfUrl: detail.pdfUrl,
      hasPdf: detail.hasPdf,
      sourceType: detail.sourceType,
      articleScrollTop: 0,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
    }, () => {
      this.scheduleMeasure();
    });
    */
  },

  /**
   * 页面离开时清理定时器，避免动画或尺寸测量在页面销毁后继续运行。
   */
  onUnload() {
    clearTimeout(this.inertiaId);
    clearTimeout(this.measureTimer);
  },

  /**
   * 页面 ready 后做一次尺寸测量。
   * 这是对首屏渲染后的兜底，保证容器和正文尺寸尽快进入计算链路。
   */
  onReady() {
    this.scheduleMeasure();
  },

  /**
   * 页面局部内容重新渲染完成后的回调。
   * 例如 structured sections 渲染完成后，正文高度可能变化，因此需要重新测量。
   */
  onRenderReady() {
    this.scheduleMeasure();
  },

  /**
   * 调度正文尺寸测量。
   *
   * 这里故意做了一个很短的延迟：
   * - 避免连续 setData / 多次局部渲染时频繁触发测量；
   * - 给小程序布局一点稳定时间，减少拿到中间态尺寸的概率。
   */
  scheduleMeasure() {
    clearTimeout(this.measureTimer);

    this.measureTimer = setTimeout(() => {
      this.measureContent();
    }, 80) as unknown as number;
  },

  /**
   * 实际读取视口与正文尺寸。
   *
   * 读取内容：
   * - `.viewer`：可视区域的宽高和页面位置。
   * - `#articleWrapper`：正文包裹层的真实宽高。
   *
   * 这些尺寸决定了：
   * - 缩放时的边界计算；
   * - 居中逻辑；
   * - 回弹目标位置；
   * - 是否需要允许某个方向继续拖拽。
   */
  measureContent() {
    const query = wx.createSelectorQuery().in(this);
    query.select(".viewer").boundingClientRect();
    query.select("#articleWrapper").boundingClientRect();
    query.exec((res) => {
      const viewer = res[0];
      const content = res[1];

      if (!viewer || !content) {
        return;
      }

      this.containerWidth = viewer.width || 0;
      this.containerHeight = viewer.height || 0;
      this.viewerLeft = viewer.left || 0;
      this.viewerTop = viewer.top || 0;

      if (this.scale <= 1.01 || this.contentWidth === 0 || this.contentHeight === 0) {
        this.contentWidth = content.width || this.containerWidth;
        this.contentHeight = content.height || this.containerHeight;
      }

      if (this.scale > 1.01) {
        this.rebound();
      }
    });
  },

  /**
   * 打开 PDF。
   *
   * 使用场景：
   * - 条目提供远程 PDF：先下载到临时路径，再打开。
   * - 条目提供本地/临时 PDF 路径：直接打开。
   *
   * 这段逻辑不参与页面渲染，只负责阅读扩展入口。
   */
  openPdf() {
    const pdfUrl = String(this.data.pdfUrl || "");

    if (!pdfUrl) {
      wx.showToast({
        title: "暂无PDF资源",
        icon: "none",
      });
      return;
    }

    if (/^https?:\/\//i.test(pdfUrl)) {
      wx.showLoading({ title: "加载中..." });

      wx.downloadFile({
        url: pdfUrl,
        success: (res) => {
          wx.hideLoading();

          if (res.statusCode === 200) {
            wx.openDocument({
              filePath: res.tempFilePath,
              fileType: "pdf",
              showMenu: true,
            });
          } else {
            wx.showToast({
              title: "PDF下载失败",
              icon: "none",
            });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({
            title: "PDF打开失败",
            icon: "none",
          });
        },
      });
      return;
    }

    wx.openDocument({
      filePath: pdfUrl,
      fileType: "pdf",
      showMenu: true,
      fail: () => {
        wx.showToast({
          title: "PDF打开失败",
          icon: "none",
        });
      },
    });
  },

  /**
   * 点击统一的“缩放阅读”按钮。
   *
   * 设计意图：
   * - 未放大时：以视口中心为锚点进入放大阅读态。
   * - 已放大时：恢复默认阅读态。
   */
  onToggleZoom() {
    if (this.scale > 1.01) {
      this.resetTransform();
      return;
    }

    this.prepareZoomViewport(() => {
      const centerX = this.containerWidth ? this.containerWidth / 2 : 0;
      const centerY = this.containerHeight ? this.containerHeight / 2 : 0;

      this.zoomTo(1.8, centerX, centerY);
    });
  },

  /**
   * 读取触摸点数组。
   * 单独封装出来，是为了把小程序的触摸类型和页面内部使用的简化坐标结构隔离开。
   */
  getTouches(e: WechatMiniprogram.TouchEvent): TouchPoint[] {
    return e.touches as unknown as TouchPoint[];
  },

  /**
   * 计算双指距离，用于 pinch 缩放。
   */
  getDistance(touches: TouchPoint[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * 计算双指中心点。
   *
   * 缩放时要围绕手指中心做变换，否则会产生“公式放大但焦点漂移”的阅读割裂感。
   */
  getCenter(touches: TouchPoint[]) {
    const first = this.getViewerPoint(touches[0]);
    const second = this.getViewerPoint(touches[1]);

    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  },

  /**
   * 把页面坐标转换成 viewer 内部坐标。
   *
   * 详情页的缩放和平移都是相对于 `.viewer` 视口计算的，
   * 因此所有触点都需要先转换到同一坐标系中。
   */
  getViewerPoint(point: TouchPoint) {
    return {
      x: point.pageX - this.viewerLeft,
      y: point.pageY - this.viewerTop,
    };
  },

  /**
   * 默认阅读态下允许的最大纵向滚动值。
   */
  getMaxScrollTop() {
    return Math.max(0, this.contentHeight - this.containerHeight);
  },

  /**
   * 从缩放态回到普通阅读态时，推算应该还原到哪个 scrollTop。
   *
   * 核心目的是保持“用户正在看的那一块内容”尽量不跳走，
   * 也就是缩放前后维持阅读位置连续。
   */
  getRestoreScrollTop() {
    if (this.scale <= 1.01) {
      return Math.min(this.getMaxScrollTop(), Math.max(0, this.articleScrollTop));
    }

    const visibleTop = -this.translateY / Math.max(this.scale, 1);
    return Math.min(this.getMaxScrollTop(), Math.max(0, visibleTop));
  },

  /**
   * 在进入缩放态之前，把普通 scroll-view 的滚动量折算成 transform 平移量。
   *
   * 为什么需要这一步：
   * - 默认阅读态由 scroll-view 控制纵向滚动。
   * - 缩放态改由 transform 控制整页位置。
   * - 如果不先做坐标系切换，用户一放大页面就会“跳位置”。
   */
  prepareZoomViewport(callback?: () => void) {
    const currentScrollTop = this.articleScrollTop;

    if (currentScrollTop <= 0.5) {
      callback?.();
      return;
    }

    this.translateX = 0;
    this.lastTranslateX = 0;
    this.translateY = -currentScrollTop;
    this.lastTranslateY = this.translateY;
    this.articleScrollTop = 0;

    this.setData({
      articleScrollTop: 0,
      transformStyle: this.buildTransformStyle(),
    }, () => {
      callback?.();
    });
  },

  /**
   * 把当前缩放和平移状态组装成 style 字符串，供 WXML 直接绑定。
   */
  buildTransformStyle() {
    return `transform: translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale});`;
  },

  /**
   * 同步 transform 相关的页面 data。
   *
   * 这里统一更新：
   * - transformStyle：实际视觉变换。
   * - zoomActive：是否处于缩放态。
   * - scaleLabel：右上角显示的百分比。
   */
  syncTransformState() {
    this.setData({
      transformStyle: this.buildTransformStyle(),
      zoomActive: this.scale > 1.01,
      scaleLabel: `${Math.round(this.scale * 100)}%`,
    });
  },

  /**
   * 根据当前内容尺寸和缩放比例，计算可拖拽边界。
   *
   * 规则：
   * - 如果缩放后内容比视口宽/高，则允许在边界内拖动。
   * - 如果缩放后内容仍小于视口，则保持居中，不允许某一方向自由漂移。
   */
  calcBounds() {
    const scaledWidth = this.contentWidth * this.scale;
    const scaledHeight = this.contentHeight * this.scale;

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;

    if (scaledWidth > this.containerWidth) {
      minX = this.containerWidth - scaledWidth;
      maxX = 0;
    } else {
      const centeredX = (this.containerWidth - scaledWidth) / 2;
      minX = centeredX;
      maxX = centeredX;
    }

    if (scaledHeight > this.containerHeight) {
      minY = this.containerHeight - scaledHeight;
      maxY = 0;
    } else {
      const centeredY = (this.containerHeight - scaledHeight) / 2;
      minY = centeredY;
      maxY = centeredY;
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
    };
  },

  /**
   * 越界阻尼。
   *
   * 当用户继续向边界外拖拽时，不是立刻硬性截断，而是给一个衰减后的位移。
   * 这样手感会更柔和，结束后再交给 `rebound` 做正式回弹。
   */
  applyResistance(value: number, min: number, max: number) {
    if (value >= min && value <= max) {
      return value;
    }

    if (value < min) {
      return min + (value - min) * 0.35;
    }

    return max + (value - max) * 0.35;
  },

  /**
   * 回弹到合法边界内。
   *
   * 使用场景：
   * - 手动拖拽结束但位置越界。
   * - 缩放后内容超出边界。
   * - 惯性滑动撞到边界。
   */
  rebound() {
    const bounds = this.calcBounds();
    const targetX = Math.min(bounds.maxX, Math.max(bounds.minX, this.translateX));
    const targetY = Math.min(bounds.maxY, Math.max(bounds.minY, this.translateY));

    const startX = this.translateX;
    const startY = this.translateY;
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      this.translateX = targetX;
      this.translateY = targetY;
      this.lastTranslateX = targetX;
      this.lastTranslateY = targetY;
      this.syncTransformState();
      return;
    }

    const duration = 220;
    const startTime = Date.now();

    const animate = () => {
      let progress = (Date.now() - startTime) / duration;
      if (progress > 1) {
        progress = 1;
      }

      const ease = 1 - Math.pow(1 - progress, 3);
      this.translateX = startX + deltaX * ease;
      this.translateY = startY + deltaY * ease;
      this.syncTransformState();

      if (progress < 1) {
        this.raf(animate);
        return;
      }

      this.lastTranslateX = this.translateX;
      this.lastTranslateY = this.translateY;
    };

    animate();
  },

  /**
   * 以给定中心点为锚执行缩放。
   *
   * 输入：
   * - `targetScale`：目标缩放比例。
   * - `centerX / centerY`：缩放锚点，通常是双指中心或双击点。
   */
  zoomTo(targetScale: number, centerX: number, centerY: number) {
    const clampedScale = Math.max(this.minScale, Math.min(targetScale, this.maxScale));
    const ratio = clampedScale / this.scale;

    this.translateX = centerX - ratio * (centerX - this.translateX);
    this.translateY = centerY - ratio * (centerY - this.translateY);
    this.scale = clampedScale;
    this.lastScale = clampedScale;
    this.syncTransformState();
    this.rebound();
  },

  /**
   * 停止惯性动画。
   */
  stopInertia() {
    clearTimeout(this.inertiaId);
  },

  /**
   * 普通阅读态下记录 scroll-view 的纵向滚动值。
   *
   * 注意：
   * - 只有未放大时，这个 scrollTop 才是有效的主滚动来源。
   * - 进入缩放态后，页面位置改由 transform 控制，因此这里直接忽略。
   */
  onArticleScroll(e: WechatMiniprogram.ScrollViewScroll) {
    if (this.scale > 1.01) {
      return;
    }

    this.articleScrollTop = Number(e.detail.scrollTop || 0);
  },

  /**
   * 启动惯性滑动。
   *
   * 这一步只在缩放态下工作，用于让拖拽结束后的阅读手感更接近原生阅读器。
   * 一旦速度衰减过小，或撞到边界，就停止惯性并回弹。
   */
  startInertia() {
    if (this.scale <= 1.01) {
      return;
    }

    const friction = 0.94;

    const step = () => {
      this.velocityX *= friction;
      this.velocityY *= friction;
      this.translateX += this.velocityX;
      this.translateY += this.velocityY;

      const bounds = this.calcBounds();

      if (
        this.translateX < bounds.minX
        || this.translateX > bounds.maxX
        || this.translateY < bounds.minY
        || this.translateY > bounds.maxY
      ) {
        this.stopInertia();
        this.rebound();
        return;
      }

      this.syncTransformState();

      if (Math.abs(this.velocityX) > 0.12 || Math.abs(this.velocityY) > 0.12) {
        this.inertiaId = this.raf(step) as unknown as number;
      }
    };

    step();
  },

  /**
   * 处理双击缩放。
   *
   * 交互规则：
   * - 当前已放大：双击恢复默认态。
   * - 当前未放大：双击以点击点为中心放大。
   */
  handleDoubleTap(e: WechatMiniprogram.TouchEvent) {
    const now = Date.now();

    if (now - this.lastTapTime < 300 && e.touches.length === 1) {
      const point = this.getViewerPoint(this.getTouches(e)[0]);

      if (this.scale > 1.01) {
        this.resetTransform();
      } else {
        this.prepareZoomViewport(() => {
          this.zoomTo(2, point.x, point.y);
        });
      }
    }

    this.lastTapTime = now;
  },

  /**
   * 触摸开始。
   *
   * 主要职责：
   * - 停掉当前惯性，避免和新的手势冲突。
   * - 识别双击。
   * - 初始化双指缩放所需的起始距离和起始比例。
   * - 初始化单指拖拽所需的起始偏移与速度采样信息。
   */
  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    this.stopInertia();
    this.handleDoubleTap(e);

    const touches = this.getTouches(e);

    if (touches.length === 2) {
      if (this.scale <= 1.01) {
        this.prepareZoomViewport();
      }

      this.gesture.startDistance = this.getDistance(touches);
      this.gesture.startScale = this.scale;
      this.velocityX = 0;
      this.velocityY = 0;
    }

    if (touches.length === 1 && this.scale > 1.01) {
      const point = this.getViewerPoint(touches[0]);
      this.gesture.startX = point.x - this.lastTranslateX;
      this.gesture.startY = point.y - this.lastTranslateY;
      this.lastMoveTime = Date.now();
      this.lastMoveX = point.x;
      this.lastMoveY = point.y;
    }
  },

  /**
   * 触摸移动。
   *
   * 两条主要分支：
   * - 双指：更新缩放比例，并围绕双指中心同步修正平移量。
   * - 单指：在缩放态下拖动画布，并持续记录速度用于后续惯性滑动。
   */
  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    const touches = this.getTouches(e);

    if (touches.length === 1 && this.scale <= 1.01) {
      return;
    }

    if (this.ticking) {
      return;
    }

    this.ticking = true;

    this.raf(() => {
      if (touches.length === 2 && this.gesture.startDistance > 0) {
        const distance = this.getDistance(touches);
        let nextScale = (distance / this.gesture.startDistance) * this.gesture.startScale;
        nextScale = Math.max(this.minScale, Math.min(nextScale, this.maxScale));

        const center = this.getCenter(touches);
        const ratio = nextScale / this.scale;

        this.translateX = center.x - ratio * (center.x - this.translateX);
        this.translateY = center.y - ratio * (center.y - this.translateY);
        this.scale = nextScale;
      }

      if (touches.length === 1 && this.scale > 1.01) {
        const point = this.getViewerPoint(touches[0]);
        const rawX = point.x - this.gesture.startX;
        const rawY = point.y - this.gesture.startY;
        const bounds = this.calcBounds();

        this.translateX = this.applyResistance(rawX, bounds.minX, bounds.maxX);
        this.translateY = this.applyResistance(rawY, bounds.minY, bounds.maxY);

        const now = Date.now();
        const deltaTime = now - this.lastMoveTime;

        if (deltaTime > 0) {
          this.velocityX = ((point.x - this.lastMoveX) / deltaTime) * 16;
          this.velocityY = ((point.y - this.lastMoveY) / deltaTime) * 16;
          this.lastMoveTime = now;
          this.lastMoveX = point.x;
          this.lastMoveY = point.y;
        }
      }

      this.syncTransformState();
      this.ticking = false;
    });
  },

  /**
   * 触摸结束。
   *
   * 结束时会把当前 transform 固化为“稳定状态”，然后根据速度决定：
   * - 进入惯性滑动；
   * - 或直接做边界回弹；
   * - 如果已经接近默认比例，则恢复普通阅读态。
   */
  onTouchEnd() {
    this.lastScale = this.scale;
    this.lastTranslateX = this.translateX;
    this.lastTranslateY = this.translateY;
    this.gesture.startDistance = 0;

    if (this.scale <= 1.01) {
      this.resetTransform();
      return;
    }

    if (Math.abs(this.velocityX) > 1 || Math.abs(this.velocityY) > 1) {
      this.startInertia();
    } else {
      this.rebound();
    }
  },

  /**
   * 重置到默认阅读态。
   *
   * 输入：
   * - `syncData`：
   *   - `true`：同步更新页面 data，真正回到普通阅读态。
   *   - `false`：只重置内部状态，通常用于页面初始化阶段。
   *
   * 这个函数是详情页阅读交互的“总兜底”，很多异常或退出缩放的路径都会回到这里。
   */
  resetTransform(syncData = true) {
    const restoreScrollTop = syncData ? this.getRestoreScrollTop() : 0;

    this.scale = 1;
    this.lastScale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.lastTranslateX = 0;
    this.lastTranslateY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.articleScrollTop = restoreScrollTop;

    if (syncData) {
      this.setData({
        articleScrollTop: restoreScrollTop,
        transformStyle: this.buildTransformStyle(),
        zoomActive: false,
        scaleLabel: "100%",
      });
    }
  },
});
