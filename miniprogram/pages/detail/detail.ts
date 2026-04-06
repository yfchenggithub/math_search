import type { DetailSectionView } from "../../utils/detail-content";
import { getDetailDocument } from "../../utils/detail-content";
import { handleInvalidAccess } from "../../utils/router";

type TouchPoint = {
  pageX: number;
  pageY: number;
};

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
    transformStyle: "transform: translate3d(0px, 0px, 0) scale(1);",
    zoomActive: false,
    scaleLabel: "100%",
  },

  scale: 1,
  lastScale: 1,

  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,

  minScale: 1,
  maxScale: 4,

  gesture: {
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
  },

  lastTapTime: 0,
  ticking: false,

  containerWidth: 0,
  containerHeight: 0,
  contentWidth: 0,
  contentHeight: 0,

  velocityX: 0,
  velocityY: 0,
  lastMoveTime: 0,
  lastMoveX: 0,
  lastMoveY: 0,
  inertiaId: 0,
  measureTimer: 0,

  raf(callback: Function) {
    return setTimeout(() => callback(), 16);
  },

  onLoad(options: Record<string, string | undefined>) {
    const id = (options.id || "").trim();
    const detail = getDetailDocument(id);

    if (!detail) {
      handleInvalidAccess("未找到对应内容");
      return;
    }

    this.resetTransform(false);

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
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
    }, () => {
      this.scheduleMeasure();
    });
  },

  onUnload() {
    clearTimeout(this.inertiaId);
    clearTimeout(this.measureTimer);
  },

  onReady() {
    this.scheduleMeasure();
  },

  onRenderReady() {
    this.scheduleMeasure();
  },

  scheduleMeasure() {
    clearTimeout(this.measureTimer);

    this.measureTimer = setTimeout(() => {
      this.measureContent();
    }, 80) as unknown as number;
  },

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

      if (this.scale <= 1.01 || this.contentWidth === 0 || this.contentHeight === 0) {
        this.contentWidth = content.width || this.containerWidth;
        this.contentHeight = content.height || this.containerHeight;
      }

      if (this.scale > 1.01) {
        this.rebound();
      }
    });
  },

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

  onToggleZoom() {
    if (this.scale > 1.01) {
      this.resetTransform();
      return;
    }

    const centerX = this.containerWidth ? this.containerWidth / 2 : 0;
    const centerY = this.containerHeight ? this.containerHeight / 2 : 0;

    this.zoomTo(1.8, centerX, centerY);
  },

  getTouches(e: WechatMiniprogram.TouchEvent): TouchPoint[] {
    return e.touches as unknown as TouchPoint[];
  },

  getDistance(touches: TouchPoint[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getCenter(touches: TouchPoint[]) {
    return {
      x: (touches[0].pageX + touches[1].pageX) / 2,
      y: (touches[0].pageY + touches[1].pageY) / 2,
    };
  },

  buildTransformStyle() {
    return `transform: translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale});`;
  },

  syncTransformState() {
    this.setData({
      transformStyle: this.buildTransformStyle(),
      zoomActive: this.scale > 1.01,
      scaleLabel: `${Math.round(this.scale * 100)}%`,
    });
  },

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

  applyResistance(value: number, min: number, max: number) {
    if (value >= min && value <= max) {
      return value;
    }

    if (value < min) {
      return min + (value - min) * 0.35;
    }

    return max + (value - max) * 0.35;
  },

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

  stopInertia() {
    clearTimeout(this.inertiaId);
  },

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

  handleDoubleTap(e: WechatMiniprogram.TouchEvent) {
    const now = Date.now();

    if (now - this.lastTapTime < 300 && e.touches.length === 1) {
      const point = this.getTouches(e)[0];

      if (this.scale > 1.01) {
        this.resetTransform();
      } else {
        this.zoomTo(2, point.pageX, point.pageY);
      }
    }

    this.lastTapTime = now;
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    this.stopInertia();
    this.handleDoubleTap(e);

    const touches = this.getTouches(e);

    if (touches.length === 2) {
      this.gesture.startDistance = this.getDistance(touches);
      this.gesture.startScale = this.scale;
      this.velocityX = 0;
      this.velocityY = 0;
    }

    if (touches.length === 1 && this.scale > 1.01) {
      this.gesture.startX = touches[0].pageX - this.lastTranslateX;
      this.gesture.startY = touches[0].pageY - this.lastTranslateY;
      this.lastMoveTime = Date.now();
      this.lastMoveX = touches[0].pageX;
      this.lastMoveY = touches[0].pageY;
    }
  },

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
        const rawX = touches[0].pageX - this.gesture.startX;
        const rawY = touches[0].pageY - this.gesture.startY;
        const bounds = this.calcBounds();

        this.translateX = this.applyResistance(rawX, bounds.minX, bounds.maxX);
        this.translateY = this.applyResistance(rawY, bounds.minY, bounds.maxY);

        const now = Date.now();
        const deltaTime = now - this.lastMoveTime;

        if (deltaTime > 0) {
          this.velocityX = ((touches[0].pageX - this.lastMoveX) / deltaTime) * 16;
          this.velocityY = ((touches[0].pageY - this.lastMoveY) / deltaTime) * 16;
          this.lastMoveTime = now;
          this.lastMoveX = touches[0].pageX;
          this.lastMoveY = touches[0].pageY;
        }
      }

      this.syncTransformState();
      this.ticking = false;
    });
  },

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

  resetTransform(syncData = true) {
    this.scale = 1;
    this.lastScale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.lastTranslateX = 0;
    this.lastTranslateY = 0;
    this.velocityX = 0;
    this.velocityY = 0;

    if (syncData) {
      this.syncTransformState();
    }
  },
});
