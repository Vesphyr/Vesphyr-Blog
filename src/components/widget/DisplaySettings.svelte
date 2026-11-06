<script lang="ts">
  import I18nKey from "@i18n/i18nKey";
  import { i18n } from "@i18n/translation";
  import { getDefaultHue, getHueUI, setHueUI } from "@utils/setting-utils";
  import { onMount } from "svelte";

  // 演示色条必须与真实页面底色同构：同明度/彩度、同纵向渐变方向，
  // 点开面板看到的色条就是"换成该色相后的网站背景"，而不是一个抽象色块。
  // 明度取自 theme-variables 的 --page-bg-top / --page-bg / --page-bg-bottom
  // （0.385 / 0.375 / 0.335，彩度 0.046 / 0.042 / 0.038）。
  // 色相与颜料体系一致：朱砂 32、群青 272、绛紫（骨螺紫）335——
  // 第三档必须与 config.themeColor.hue 相等，否则选中态永远不亮。
  const SURFACE_L = { top: 0.385, mid: 0.375, bottom: 0.335 };
  const SURFACE_C = { top: 0.046, mid: 0.042, bottom: 0.038 };

  /** 与 body::before 的纵向渐变同构，只替换色相 */
  function surfaceGradient(hue: number): string {
    const l = SURFACE_L;
    const c = SURFACE_C;
    return (
      `linear-gradient(180deg, oklch(${l.top} ${c.top} ${hue}), ` +
      `oklch(${l.mid} ${c.mid} ${hue}) 52%, oklch(${l.bottom} ${c.bottom} ${hue}))`
    );
  }

  const colorOptions = [
    {
      hue: 32,
      name: "朱砂",
      color: surfaceGradient(32),
      fallback: "linear-gradient(180deg, #5a3b34, #553933 52%, #482f2a)",
    },
    {
      hue: 272,
      name: "群青",
      color: surfaceGradient(272),
      fallback: "linear-gradient(180deg, #3b425d, #394058 52%, #30364b)",
    },
    {
      hue: 335,
      name: "绛紫",
      color: surfaceGradient(335),
      fallback: "linear-gradient(180deg, #533a4d, #4f394a 52%, #432f3e)",
    },
  ];

  let hueUI = 0;
  let defaultHueUI = 0;
  let isMounted = false;

  function applyHue(hue: number) {
    hueUI = hue;
    if (isMounted) {
      setHueUI(hue);
    }
  }

  onMount(() => {
    isMounted = true;
    defaultHueUI = getDefaultHue();
    const stored = getHueUI();

    if (colorOptions.some((option) => option.hue === stored)) {
      hueUI = stored;
      return;
    }

    applyHue(defaultHueUI);
  });
</script>

<div
  id="display-setting"
  class="float-panel float-panel-closed absolute transition-all w-72 right-4 px-4 py-4"
  style="
    background: var(--display-panel-bg);
    backdrop-filter: blur(20px) saturate(160%);
    -webkit-backdrop-filter: blur(20px) saturate(160%);
    border: 1px solid var(--display-panel-border);
    box-shadow: var(--display-panel-shadow);
    border-radius: var(--radius-large);
  "
>
  <div class="display-setting-surface">
    <div class="flex flex-row gap-2 mb-3 items-center justify-between">
      <div
        class="flex gap-2 font-bold text-lg text-90 transition relative ml-3
          before:w-1 before:h-4 before:rounded-md before:bg-(--primary)
          before:absolute before:-left-3 before:top-[0.33rem]"
      >
        {i18n(I18nKey.themeColor)}
      </div>
    </div>
    <div class="color-bar-container">
      <div class="color-bar">
        {#each colorOptions as option}
          <button
            class="color-segment"
            class:selected={hueUI === option.hue}
            style={`background: ${option.fallback}; background: ${option.color};`}
            on:click={() => applyHue(option.hue)}
            aria-label={option.name}
            title={option.name}
            type="button"
          >
            <span class="color-name">{option.name}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style lang="stylus">
  #display-setting
    padding 0 !important
    overflow hidden

    .display-setting-surface
      background var(--panel-bg)
      border 1px solid var(--display-panel-border)
      border-radius inherit
      box-shadow var(--shadow-lg)
      padding 1rem

  .color-bar-container
    padding 0.25rem

  .color-bar
    display flex
    height 2.5rem
    border-radius 0.375rem
    overflow hidden

  .color-segment
    flex 1 1 0
    height 100%
    border none
    padding 0
    cursor pointer
    position relative
    display flex
    align-items center
    justify-content center
    box-sizing border-box

    // 复刻页面的顶光与缎面光泽，让色条不只是"底色"，而是背景的缩略图
    &::before
      content ''
      position absolute
      inset 0
      pointer-events none
      background linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 70%), linear-gradient(118deg, transparent 0%, rgba(255, 255, 255, 0.06) 14%, transparent 30%, rgba(255, 255, 255, 0.04) 48%, transparent 64%, rgba(255, 255, 255, 0.05) 82%, transparent 100%)

    // 复刻页面的顶光与缎面光泽，让色条不只是"底色"，而是背景的缩略图
    &::before
      content ''
      position absolute
      inset 0
      pointer-events none
      background linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent 70%), linear-gradient(118deg, transparent 0%, rgba(255, 255, 255, 0.06) 14%, transparent 30%, rgba(255, 255, 255, 0.04) 48%, transparent 64%, rgba(255, 255, 255, 0.05) 82%, transparent 100%)

    &::after
      content ''
      position absolute
      bottom 0.3rem
      left 50%
      transform translateX(-50%)
      width 0
      height 0
      border-left 0.4rem solid transparent
      border-right 0.4rem solid transparent
      border-bottom 0.5rem solid rgba(255, 255, 255, 0.85)
      opacity 0
      transition opacity 0.2s ease

    &.selected::after
      opacity 1

    .color-name
      font-size 0.875rem
      font-weight 500
      color rgba(255, 255, 255, 0.9)
      text-shadow 0 1px 2px rgba(0, 0, 0, 0.3)
      z-index 1
</style>
