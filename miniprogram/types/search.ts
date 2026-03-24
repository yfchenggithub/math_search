export interface ResultItem {
  id: string;

  // 展示
  title: string;
  summary?: string;
  formula?: string;

  // 分类
  module?: string;
  tags?: string[];

  // 权重系统（搜索核心）
  score?: number;
  recentScore?: number;
  weight?: number;

  // 学习系统（你产品的核心）
  level?: string;
  mastery?: "已掌握" | "模糊" | "未掌握";

  // 场景
  usage?: string;
}