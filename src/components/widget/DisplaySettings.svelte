<script lang="ts">
  import I18nKey from "@i18n/i18nKey";
  import { i18n } from "@i18n/translation";
  import { getDefaultHue, getHueUI, setHueUI } from "@utils/setting-utils";
  import { onMount } from "svelte";

  // 色条背景不是另画的色卡，而是直接复用站点背景本身（.site-backdrop 与
  // body::before 共用同一份 background 声明），只在元素上覆写 --hue。
  // 因此色条与网站背景逐层一致：底色渐变、顶光、染斑、缎面、宋锦纹、珍珠点、
  // 暗角全部是同一套值，不会出现"演示色偏亮/偏暗"。
  // 色相与颜料体系一致：朱砂 32、群青 272、绛紫（骨螺紫）335——
  // 第三档必须与 config.themeColor.hue 相等，否则选中态永远不亮。
  const colorOptions = [
    { hue: 32, name: "朱砂" },
    { hue: 272, name: "群青" },
    { hue: 335, name: "绛紫" },
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
            class="color-segment site-backdrop"
            class:selected={hueUI === option.hue}
            style={`--hue: ${option.hue};`}
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
    border-radius 0.5rem
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

    // 背景由 .site-backdrop 提供（与 body::before 同一份声明），此处不再叠任何
    // 额外光效——否则色条就不是网站背景本身了。

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
      border-bottom 0.5rem solid #ffffff
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
