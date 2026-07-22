<script lang="ts">
  import I18nKey from "@i18n/i18nKey";
  import { i18n } from "@i18n/translation";
  import { getDefaultHue, getHueUI, setHueUI } from "@utils/setting-utils";
  import { onMount } from "svelte";

  const colorOptions = [
    { hue: 0, name: "御绯红", color: "oklch(0.75 0.15 0)" },
    { hue: 150, name: "翠微绿", color: "oklch(0.75 0.15 150)" },
    { hue: 265, name: "琉璃蓝", color: "oklch(0.75 0.15 265)" },
    { hue: 325, name: "皇家紫", color: "oklch(0.75 0.15 325)" },
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
            style={`background: ${option.color};`}
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

  :global(html.dark) #display-setting .display-setting-surface
    background var(--panel-bg)
    border 1px solid var(--display-panel-border)
    box-shadow var(--shadow-lg)

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

    &::after
      content ''
      position absolute
      bottom 0.3rem
      left 50%
      transform translateX(-50%)
      width 0.3rem
      height 0.3rem
      border-radius 50%
      background rgba(255, 255, 255, 0.85)
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
