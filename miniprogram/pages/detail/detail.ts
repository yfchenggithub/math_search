type TouchPoint = {
  pageX: number;
  pageY: number;
};

Page({
  data: {
    svgUrl: "/assets/svg/vector/001.svg",
    transformStyle: "",
  },

  // ========================
  // 状态（全部放 JS，不进 data）
  // ========================
  scale: 1,
  lastScale: 1,

  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,

  minScale: 1,
  maxScale: 6,

  // startTouches: [] as WechatMiniprogram.Touch[],
  isMoving: false,

  // ========================
  // 手势状态（核心方案）
  // ========================
  gesture: {
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
  },

  // 双击检测
  lastTapTime: 0,

  // 节流锁
  ticking: false,

  // ========================
  // rAF（兼容小程序）
  // ========================
  raf(callback: Function) {
    return setTimeout(() => callback(), 16); // 约 60FPS
  },

  // ========================
  // 工具：距离计算
  // ========================
  getTouches(e: any): TouchPoint[] {
    return e.touches as unknown as TouchPoint[];
  },

  getDistance(touches: TouchPoint[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  // ========================
  // 工具：中心点
  // ========================
  getCenter(touches: TouchPoint[]) {
    return {
      x: (touches[0].pageX + touches[1].pageX) / 2,
      y: (touches[0].pageY + touches[1].pageY) / 2,
    };
  },

  // ========================
  // 核心：更新 transform（无闪）
  // ========================
  updateTransform() {
    const { scale, translateX, translateY } = this;

    const style = `
      transform: translate3d(${translateX}px, ${translateY}px, 0) scale(${scale});
    `;

    // ✅ 极小更新（只更新 style）
    this.setData({
      transformStyle: style,
    });
  },

  // ========================
  // 双击检测
  // ========================
  handleDoubleTap(e: any) {
    const now = Date.now();
    const delta = now - this.lastTapTime;

    if (delta < 300) {
      // 双击触发
      const touches = this.getTouches(e);
      const point = touches[0];

      if (this.scale === 1) {
        // 放大
        this.animateScale(2, point.pageX, point.pageY);
      } else {
        // 缩小
        this.reset();
      }
    }

    this.lastTapTime = now;
  },

  // ========================
  // 动画缩放（iOS 手感）
  // ========================
  animateScale(targetScale: number, centerX: number, centerY: number) {
    const startScale = this.scale;
    const diff = targetScale - startScale;

    const duration = 200;
    const startTime = Date.now();

    const animate = () => {
      const now = Date.now();
      let progress = (now - startTime) / duration;

      if (progress > 1) progress = 1;

      // ease-out
      const ease = 1 - Math.pow(1 - progress, 3);

      this.scale = startScale + diff * ease;

      this.updateTransform();

      if (progress < 1) {
        this.raf(animate);
      }
    };

    animate();
  },

  // ========================
  // touchstart
  // ========================
  onTouchStart(e: any) {
    this.handleDoubleTap(e);

    const touches = this.getTouches(e);

    if (touches.length === 2) {
      this.gesture.startDistance = this.getDistance(touches);
      this.gesture.startScale = this.scale;
    }

    if (touches.length === 1) {
      this.gesture.startX = touches[0].pageX - this.lastTranslateX;
      this.gesture.startY = touches[0].pageY - this.lastTranslateY;
    }
  },

  // ========================
  // touchmove（核心）
  // ========================
  onTouchMove(e: any) {
    if (this.ticking) return;
    this.ticking = true;

    this.raf(() => {
      const touches = this.getTouches(e);

      if (touches.length === 2) {
        // ===== 双指缩放 =====
        const distance = this.getDistance(touches);

        let newScale =
          (distance / this.gesture.startDistance) * this.gesture.startScale;

        newScale = Math.max(this.minScale, Math.min(newScale, this.maxScale));

        // ✅ 缩放中心补偿（关键！防漂移）
        const center = this.getCenter(touches);
        const scaleRatio = newScale / this.scale;

        this.translateX = center.x - scaleRatio * (center.x - this.translateX);
        this.translateY = center.y - scaleRatio * (center.y - this.translateY);

        this.scale = newScale;
      }

      if (touches.length === 1 && this.scale > 1) {
        // ===== 拖动 =====
        this.translateX = touches[0].pageX - this.gesture.startX;
        this.translateY = touches[0].pageY - this.gesture.startY;
      }

      this.updateTransform();

      this.ticking = false;
    });
  },

  // ========================
  // touchend
  // ========================
  onTouchEnd() {
    this.lastScale = this.scale;
    this.lastTranslateX = this.translateX;
    this.lastTranslateY = this.translateY;

    // ===== 回弹 =====
    if (this.scale < 1) {
      this.reset();
    }
  },

  // ========================
  // 重置
  // ========================
  reset() {
    this.scale = 1;
    this.translateX = 0;
    this.translateY = 0;

    this.lastScale = 1;
    this.lastTranslateX = 0;
    this.lastTranslateY = 0;

    this.updateTransform();
  },
});
