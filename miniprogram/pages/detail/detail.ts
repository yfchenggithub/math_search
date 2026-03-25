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
  scale: 1, //当前帧
  lastScale: 1, //上一轮手势结果

  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,

  minScale: 1,
  maxScale: 6,

  // ========================
  // 手势状态（核心方案）
  // ========================
  gesture: {
    startDistance: 0,
    startScale: 1, //本轮起点
    startX: 0,
    startY: 0,
  },

  // 双击检测
  lastTapTime: 0,

  // 节流锁
  ticking: false,

  // ========================
  // 【新增】尺寸缓存
  // ========================
  containerWidth: 0,
  containerHeight: 0,
  contentWidth: 0,
  contentHeight: 0,

  // ========================
  // 【新增】惯性
  // ========================
  velocityX: 0,
  velocityY: 0,
  lastMoveTime: 0,
  lastMoveX: 0,
  lastMoveY: 0,
  inertiaId: 0,

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
    // 用 unknown 作为跳板，把一个不兼容的类型“强行伪装”成你想要的类型
    return e.touches as unknown as TouchPoint[]; // 把 TouchList 强行当成 TouchPoint[] 来用
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
  // 【新增】初始化尺寸
  // ========================
  onReady() {
    const query = wx.createSelectorQuery().in(this);
    query.select(".viewer").boundingClientRect();
    query.select(".svg-wrapper").boundingClientRect();
    query.exec((res) => {
      const viewer = res[0];
      const content = res[1];

      this.containerWidth = viewer.width;
      this.containerHeight = viewer.height;
      this.contentWidth = content.width;
      this.contentHeight = content.height;
    });
  },
  // ========================
  // 核心：更新 transform（无闪）
  // ========================
  updateTransform() {
    // 从对象里“解包”出属性，变成局部变量
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
  // 【新增】计算边界
  // ========================
  // ========================
  // 【修改后】calcBounds（严格按真实坐标系）
  // ========================
  calcBounds() {
    const scaledW = this.contentWidth * this.scale;
    const scaledH = this.contentHeight * this.scale;

    let minX: number, maxX: number;
    let minY: number, maxY: number;

    // ===== 横向 =====
    if (scaledW > this.containerWidth) {
      // 👉 可拖动
      minX = this.containerWidth - scaledW;
      maxX = 0;
    } else {
      // 👉 居中（不能拖）
      const center = (this.containerWidth - scaledW) / 2;
      minX = maxX = center;
    }

    // ===== 纵向（关键修复点）=====
    if (scaledH > this.containerHeight) {
      // 👉 可拖动（允许看到顶部）
      minY = this.containerHeight - scaledH;
      maxY = 0;
    } else {
      // 👉 居中
      const center = (this.containerHeight - scaledH) / 2;
      minY = maxY = center;
    }

    return { minX, maxX, minY, maxY };
  },

  // ========================
  // 【新增】阻尼（橡皮筋）
  // ========================
  // ========================
  // 【修改后】阻尼函数（只处理越界部分）
  // ========================
  applyResistance(value: number, min: number, max: number) {
    // ✅ 在边界内：完全不处理
    if (value >= min && value <= max) {
      return value;
    }

    // ===== 下越界 =====
    if (value < min) {
      const delta = value - min; // 超出距离（负数）

      // 👉 阻尼（越远越难）
      const resisted = delta * 0.35;

      return min + resisted;
    }

    // ===== 上越界 =====
    if (value > max) {
      const delta = value - max;

      const resisted = delta * 0.35;

      return max + resisted;
    }

    return value;
  },

  // ========================
  // 【新增】回弹动画
  // ========================
  rebound() {
    const { minX, maxX, minY, maxY } = this.calcBounds();

    let targetX = Math.min(maxX, Math.max(minX, this.translateX));
    let targetY = Math.min(maxY, Math.max(minY, this.translateY));

    const startX = this.translateX;
    const startY = this.translateY;

    const dx = targetX - startX;
    const dy = targetY - startY;

    const duration = 200;
    const startTime = Date.now();

    const animate = () => {
      let t = (Date.now() - startTime) / duration;
      if (t > 1) t = 1;

      const ease = 1 - Math.pow(1 - t, 3);

      this.translateX = startX + dx * ease;
      this.translateY = startY + dy * ease;

      this.updateTransform();

      if (t < 1) this.raf(animate);
    };

    animate();
  },

  // ========================
  // 【新增】惯性启动
  // ========================
  startInertia() {
    const friction = 0.95;

    const step = () => {
      this.velocityX *= friction;
      this.velocityY *= friction;

      this.translateX += this.velocityX;
      this.translateY += this.velocityY;

      const bounds = this.calcBounds();

      // 撞边停止
      if (
        this.translateX < bounds.minX ||
        this.translateX > bounds.maxX ||
        this.translateY < bounds.minY ||
        this.translateY > bounds.maxY
      ) {
        this.stopInertia();
        this.rebound();
        return;
      }

      this.updateTransform();

      if (Math.abs(this.velocityX) > 0.1 || Math.abs(this.velocityY) > 0.1) {
        this.inertiaId = this.raf(step);
      }
    };

    step();
  },

  stopInertia() {
    clearTimeout(this.inertiaId);
  },

  // ========================
  // 双击检测
  // ========================
  handleDoubleTap(e: any) {
    const now = Date.now();

    if (now - this.lastTapTime < 300) {
      const touches = this.getTouches(e);
      const point = touches[0];

      const targetScale = this.scale === 1 ? 2 : 1;

      // 👉 核心公式（保持点击点不动）
      const scaleRatio = targetScale / this.scale;

      this.translateX =
        point.pageX - scaleRatio * (point.pageX - this.translateX);
      this.translateY =
        point.pageY - scaleRatio * (point.pageY - this.translateY);

      this.scale = targetScale;

      this.updateTransform();
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
    this.stopInertia();
    this.handleDoubleTap(e);

    const touches = this.getTouches(e);

    // ========================
    // 【修改后】touchstart（双指）
    // ========================
    if (touches.length === 2) {
      this.gesture.startDistance = this.getDistance(touches);
      this.gesture.startScale = this.lastScale;
    }

    if (touches.length === 1) {
      this.gesture.startX = touches[0].pageX - this.lastTranslateX;
      this.gesture.startY = touches[0].pageY - this.lastTranslateY;
      // 【新增】记录速度
      this.lastMoveTime = Date.now();
      this.lastMoveX = touches[0].pageX;
      this.lastMoveY = touches[0].pageY;
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
        let rawX = touches[0].pageX - this.gesture.startX;
        let rawY = touches[0].pageY - this.gesture.startY;

        const bounds = this.calcBounds();

        // ❗先用 raw 值判断
        this.translateX = this.applyResistance(rawX, bounds.minX, bounds.maxX);
        this.translateY = this.applyResistance(rawY, bounds.minY, bounds.maxY);

        // 👉 计算速度
        const now = Date.now();
        const dt = now - this.lastMoveTime;

        if (dt > 0) {
          this.velocityX = ((touches[0].pageX - this.lastMoveX) / dt) * 16;
          this.velocityY = ((touches[0].pageY - this.lastMoveY) / dt) * 16;

          this.lastMoveX = touches[0].pageX;
          this.lastMoveY = touches[0].pageY;
          this.lastMoveTime = now;
        }
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

    // 👉 惯性触发
    if (Math.abs(this.velocityX) > 1 || Math.abs(this.velocityY) > 1) {
      this.startInertia();
    } else {
      this.rebound();
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
