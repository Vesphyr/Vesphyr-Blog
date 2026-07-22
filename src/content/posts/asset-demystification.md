---
title: "资产祛魅：基于房产价值公式的定价分析"
description: "以房产价值公式为核心，拆解现金流、附加效用与增长预期，附估值工具与案例。"
published: 2026-03-07
author: "Vesphyr"
tags: ["投资", "房产", "财务模型"]
category: "投资"
---

房产价格混合了三类因素：现金流资产价值、居住与资源效用价值、以及未来涨价预期。不拆分三者，讨论只会停留在情绪叙事。本文用一个公式将它们分离：

$$\Large V = \frac{NOI}{r_{\!f} + r_{\!p} - g} + U$$

## 参数说明

| 符号 | 含义 | 要点 |
|------|------|------|
| `NOI` | 年净运营收入 | 年租金减空置损失减持有成本，最易被高估 |
| <span class="font-serif italic">r</span><sub>f</sub> | 无风险利率 | 参考长期国债收益率，是资金的基准回报要求 |
| <span class="font-serif italic">r</span><sub>p</sub> | 风险溢价 | 补偿流动性差、成交周期长、政策敏感等风险 |
| `g` | 长期增长率 | 对估值影响极大，切勿用短期行情外推 |
| `U` | 附加效用价值 | 学区、通勤、户籍等现金流之外的资源价值 |

核心原则：对 `NOI` 保持审慎，对 `g` 保持克制，将 `U` 与现金流价值分离。

## 房产价值试算

<div class="property-calculator card-base not-content my-8 overflow-hidden rounded-2xl border border-black/10 bg-white/75 p-5 shadow-lg shadow-black/5 backdrop-blur dark:border-white/10 dark:bg-black/30 dark:shadow-black/20">
  <div class="mb-5">
    <h3 class="text-xl font-bold text-black/90 dark:text-white/90">房产价值试算</h3>
    <p class="mt-2 text-sm text-black/60 dark:text-white/60">输入参数后结果实时更新。</p>
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">月租金（元）</span>
      <input id="pc-rent" type="number" value="4500" min="0" step="100" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">年持有成本（元）</span>
      <input id="pc-cost" type="number" value="4000" min="0" step="500" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">空置率（%）</span>
      <input id="pc-vacancy" type="number" value="5" min="0" max="100" step="0.1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">无风险利率（%）</span>
      <input id="pc-rf" type="number" value="1.8" min="0" max="20" step="0.1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">风险溢价（%）</span>
      <input id="pc-rp" type="number" value="1.0" min="0" max="20" step="0.1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">长期增长率（%）</span>
      <input id="pc-growth" type="number" value="0" min="-10" max="20" step="0.1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">附加效用价值 U（万元）</span>
      <input id="pc-utility" type="number" value="50" min="0" step="1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
    <label class="block">
      <span class="mb-2 block text-sm font-medium text-black/70 dark:text-white/70">挂牌价（万元）</span>
      <input id="pc-price" type="number" value="300" min="0" step="1" class="w-full rounded-xl border border-black/10 bg-white/85 px-4 py-3 text-black outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20 dark:border-white/10 dark:bg-white/5 dark:text-white" />
    </label>
  </div>

  <div class="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
    <div class="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div class="text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">NOI</div>
      <div id="pc-noi" class="mt-2 text-2xl font-bold text-black/90 dark:text-white/90">0 元/年</div>
      <div class="mt-1 text-sm text-black/55 dark:text-white/55">扣除空置与持有成本后</div>
    </div>
    <div class="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div class="text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">资本化率差值</div>
      <div id="pc-spread" class="mt-2 text-2xl font-bold text-black/90 dark:text-white/90">0%</div>
      <div class="mt-2 inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1 text-sm text-black/65 dark:border-white/10 dark:bg-white/[0.04] dark:text-white/65">
        <span class="font-serif italic">r</span><sub>f</sub>
        <span>+</span>
        <span class="font-serif italic">r</span><sub>p</sub>
        <span>-</span>
        <span class="font-serif italic">g</span>
      </div>
    </div>
    <div class="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div class="text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">模型估值</div>
      <div id="pc-value" class="mt-2 text-2xl font-bold text-black/90 dark:text-white/90">0 万元</div>
      <div class="mt-1 text-sm text-black/55 dark:text-white/55">现金流价值与附加效用之和</div>
    </div>
    <div class="rounded-2xl border border-black/10 bg-white/80 p-4 dark:border-white/10 dark:bg-white/5">
      <div class="text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">判断</div>
      <div id="pc-status" class="mt-2 text-2xl font-bold text-black/90 dark:text-white/90">-</div>
      <div id="pc-gap" class="mt-1 text-sm text-black/55 dark:text-white/55">等待输入</div>
    </div>
  </div>

  <p id="pc-note" class="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-7 text-black/70 dark:text-white/70">
    提示：当 <span class="inline-flex items-center gap-1 rounded-full border border-black/10 bg-black/[0.03] px-2 py-0.5 text-[0.95em] dark:border-white/10 dark:bg-white/[0.04]"><span class="font-serif italic">r</span><sub>f</sub><span>+</span><span class="font-serif italic">r</span><sub>p</sub><span>-</span><span class="font-serif italic">g</span></span> 小于或等于 0 时，模型在经济含义上不再成立，这通常意味着增长率假设过高。
  </p>
</div>

## 案例演算

挂牌价 300 万、月租 4500 元、年成本 4000 元、空置率 5%、<span class="font-serif italic">r</span><sub>f</sub> = 1.8%、<span class="font-serif italic">r</span><sub>p</sub> = 1.0%、g = 0、U = 50 万。

1. **NOI**：4500 × 12 × (1 − 5%) − 4000 = **47300 元**
2. **资本化率**：1.8% + 1.0% − 0 = **2.8%**
3. **模型估值**：47300 / 0.028 + 500000 ≈ **218.93 万**
4. **偏离**：挂牌价 300 万高出模型约 81 万——这部分是效用溢价还是涨价预期，需要自行判断。

## 结语

真正要回答的问题不是"贵不贵"，而是：你支付的价格中，有多少在为现金流付费，有多少在为资源付费，又有多少在为未经证实的预期付费。
