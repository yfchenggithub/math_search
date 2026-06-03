export type ContentModuleFilter = {
  key: string;
  label: string;
  backendModule: string;
  keywords: string[];
};

export const CONTENT_MODULE_FILTERS: ContentModuleFilter[] = [
  { key: "category:集合", label: "集合", backendModule: "set", keywords: ["集合", "set"] },
  {
    key: "category:立体几何",
    label: "立体几何",
    backendModule: "geometry-solid",
    keywords: ["立体几何", "空间几何", "geometry-solid", "solid geometry"],
  },
  { key: "category:向量", label: "向量", backendModule: "vector", keywords: ["向量", "vector"] },
  { key: "category:数列", label: "数列", backendModule: "sequence", keywords: ["数列", "sequence"] },
  {
    key: "category:导数与函数",
    label: "导数与函数",
    backendModule: "function",
    keywords: ["导数与函数", "函数与导数", "导数", "function", "derivative"],
  },
  {
    key: "category:圆锥曲线",
    label: "圆锥曲线",
    backendModule: "conic",
    keywords: ["圆锥曲线", "圆锥", "椭圆", "抛物线", "双曲线", "conic"],
  },
  {
    key: "category:平面几何",
    label: "平面几何",
    backendModule: "geometry-plane",
    keywords: ["平面几何", "geometry-plane", "plane geometry"],
  },
  {
    key: "category:概率",
    label: "概率",
    backendModule: "probability-stat",
    keywords: ["概率", "排列组合", "probability-stat", "probability"],
  },
  {
    key: "category:不等式",
    label: "不等式",
    backendModule: "inequality",
    keywords: ["不等式", "inequality"],
  },
  {
    key: "category:三角函数",
    label: "三角函数",
    backendModule: "trigonometry",
    keywords: ["三角函数", "三角", "解三角形", "trigonometry"],
  },
];
