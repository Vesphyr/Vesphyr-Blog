<script lang="ts">
  import Icon from "@iconify/svelte";
  import { onMount, tick } from "svelte";
  import { musicPlayerConfig } from "../../config";
  import Key from "../../i18n/i18nKey";
  import { i18n } from "../../i18n/translation";
  import { fetchMetingPlaylistSongs } from "../../scripts/music-player/player-meting";
  import {
    bindAutoplayRecovery,
    bindPlayerDocumentEvents,
    scheduleInitialPlaylistLoad,
  } from "../../scripts/music-player/player-runtime";
  import {
    createSong,
    getAssetPath,
    type Song,
  } from "../../scripts/music-player/player-types";

  let meting_api =
    musicPlayerConfig.meting_api ??
    "https://www.bilibili.uno/api?server=:server&type=:type&id=:id&auth=:auth&r=:r";
  let meting_id = musicPlayerConfig.id ?? "14164869977";
  let meting_server = musicPlayerConfig.server ?? "netease";
  let meting_type = musicPlayerConfig.type ?? "playlist";
  const DEFAULT_AUDIO_VOLUME = 0.8;
  const AUDIO_LOAD_TIMEOUT_MS = 12000;
  const SKIP_FAILURE_THRESHOLD = 3;

  let isPlaying = false;
  let isHidden = false;
  let showPlaylist = false;
  let currentTime = 0;
  let duration = 0;
  let isLoading = false;
  let isShuffled = false;
  let isRepeating = 2;
  let errorMessage = "";
  let showError = false;
  let autoplayFailed = false;
  let willAutoPlay = false;
  let playlistLoaded = false;

  let currentSong: Song = createSong({
    title: i18n(Key.musicPlayerLoading),
    artist: i18n(Key.unknownArtist),
  });
  let playlist: Song[] = [];
  let currentIndex = 0;
  let brokenSongs: Set<number> = new Set();

  let audio: HTMLAudioElement;
  let progressBar: HTMLElement;
  let playerRoot: HTMLDivElement;
  let playlistPanel: HTMLDivElement;
  let playlistCloseButton: HTMLButtonElement;
  let songTitleViewport: HTMLDivElement;
  let songTitleText: HTMLSpanElement;
  let shouldScrollSongTitle = false;
  let songTitleMeasureToken = 0;
  let audioLoadTimeout: ReturnType<typeof setTimeout> | undefined;
  let loadSongTimeout: ReturnType<typeof setTimeout> | undefined;
  let failedPlaybackAttempts = 0;

  function queueSongTitleMeasure() {
    const measureToken = ++songTitleMeasureToken;
    tick().then(() => {
      if (
        measureToken !== songTitleMeasureToken ||
        !songTitleViewport ||
        !songTitleText
      ) {
        return;
      }

      const overflowDistance =
        songTitleText.scrollWidth - songTitleViewport.clientWidth;
      shouldScrollSongTitle = overflowDistance > 2;
      songTitleViewport.style.setProperty(
        "--song-title-scroll-distance",
        `${Math.max(overflowDistance, 0)}px`,
      );
      songTitleViewport.style.setProperty(
        "--song-title-scroll-duration",
        `${Math.min(Math.max(songTitleText.scrollWidth / 28, 8), 20)}s`,
      );
    });
  }

  $: if (currentSong.title) {
    queueSongTitleMeasure();
  }

  function setPlayerFallback(
    title: string,
    artist = i18n(Key.musicPlayerRetryLater),
  ) {
    clearAudioLoadTimeout();
    currentSong = createSong({ title, artist });
    currentTime = 0;
    duration = 0;
    isLoading = false;
    isPlaying = false;
    willAutoPlay = false;
  }

  function clearAudioLoadTimeout() {
    if (!audioLoadTimeout) return;
    clearTimeout(audioLoadTimeout);
    audioLoadTimeout = undefined;
  }

  function clearLoadSongTimeout() {
    if (!loadSongTimeout) return;
    clearTimeout(loadSongTimeout);
    loadSongTimeout = undefined;
  }

  function startAudioLoadTimeout() {
    clearAudioLoadTimeout();
    const loadingSongUrl = currentSong.url;
    audioLoadTimeout = setTimeout(() => {
      if (!isLoading || currentSong.url !== loadingSongUrl) return;
      handlePlaybackFailure(
        `${i18n(Key.musicPlayerErrorSong)} - ${currentSong.title}`,
        true,
      );
    }, AUDIO_LOAD_TIMEOUT_MS);
  }

  function markAudioReady() {
    clearAudioLoadTimeout();
    isLoading = false;
    failedPlaybackAttempts = 0;
  }

  function handlePlaybackFailure(message: string, shouldSkip: boolean) {
    clearAudioLoadTimeout();
    isLoading = false;
    isPlaying = false;
    failedPlaybackAttempts += 1;
    brokenSongs = new Set([...brokenSongs, currentSong.id]);

    const canSkip =
      shouldSkip &&
      playlist.length > 1 &&
      failedPlaybackAttempts <= SKIP_FAILURE_THRESHOLD &&
      failedPlaybackAttempts < playlist.length;

    if (canSkip) {
      showErrorMessage(`${i18n(Key.musicPlayerSkipSong)} - ${currentSong.title}`);
      setTimeout(() => nextSong(true), 800);
      return;
    }

    if (failedPlaybackAttempts > SKIP_FAILURE_THRESHOLD) {
      showErrorMessage(i18n(Key.musicPlayerSkipMultiple));
    } else {
      showErrorMessage(message);
    }

    willAutoPlay = false;
  }

  async function fetchMetingPlaylist(): Promise<boolean> {
    if (!meting_api || !meting_id) {
      setPlayerFallback(i18n(Key.musicPlayerUnavailable));
      return false;
    }

    isLoading = true;
    try {
      playlist = await fetchMetingPlaylistSongs({
        apiTemplate: meting_api,
        id: meting_id,
        server: meting_server,
        type: meting_type,
        unknownSongLabel: i18n(Key.unknownSong),
        unknownArtistLabel: i18n(Key.unknownArtist),
      });

      if (playlist.length > 0) {
        loadSong(playlist[0]);
        return true;
      } else {
        setPlayerFallback(i18n(Key.musicPlayerErrorEmpty));
        showErrorMessage(i18n(Key.musicPlayerErrorEmpty));
      }
    } catch (_error) {
      setPlayerFallback(i18n(Key.musicPlayerUnavailable));
      showErrorMessage(i18n(Key.musicPlayerErrorPlaylist));
    } finally {
      isLoading = false;
    }

    return false;
  }

  function lazyLoadPlaylist(): Promise<boolean> {
    if (playlistLoaded) return Promise.resolve(playlist.length > 0);
    playlistLoaded = true;
    return fetchMetingPlaylist().then((ok) => {
      if (!ok) playlistLoaded = false;
      return ok;
    });
  }

  function playCurrentAudio() {
    if (!audio || !currentSong.url) {
      setPlayerFallback(i18n(Key.musicPlayerUnavailable));
      showErrorMessage(i18n(Key.musicPlayerRetryLater));
      return;
    }

    isLoading = true;
    startAudioLoadTimeout();
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((error) => {
        console.warn("Audio playback was blocked or failed.", error);
        autoplayFailed = true;
        handlePlaybackFailure(i18n(Key.musicPlayerRetryLater), false);
      });
    }
  }

  async function togglePlay() {
    if (!playlistLoaded) {
      const loaded = await lazyLoadPlaylist();
      if (!loaded) return;
    }
    if (!audio || !currentSong.url) return;

    if (isPlaying) {
      audio.pause();
      return;
    }

    playCurrentAudio();
  }

  function togglePlaylist() {
    if (!playlistLoaded) {
      lazyLoadPlaylist();
    }

    showPlaylist = !showPlaylist;
    if (showPlaylist) {
      tick().then(() => {
        playlistCloseButton?.focus();
      });
    }
  }

  function toggleHidden() {
    isHidden = !isHidden;
    if (isHidden) {
      showPlaylist = false;
    }
  }

  function closePlaylist() {
    showPlaylist = false;
  }

  function toggleRepeat() {
    if (!isShuffled && isRepeating === 2) {
      isRepeating = 1;
      return;
    }

    if (!isShuffled && isRepeating === 1) {
      isShuffled = true;
      isRepeating = 2;
      return;
    }

    isShuffled = false;
    isRepeating = 2;
  }

  function previousSong() {
    if (playlist.length <= 1) return;

    const newIndex = currentIndex > 0 ? currentIndex - 1 : playlist.length - 1;
    playSong(newIndex);
  }

  function nextSong(autoPlay = true) {
    if (playlist.length <= 1) return;

    let newIndex: number;
    if (isShuffled) {
      do {
        newIndex = Math.floor(Math.random() * playlist.length);
      } while (newIndex === currentIndex && playlist.length > 1);
    } else {
      newIndex = currentIndex < playlist.length - 1 ? currentIndex + 1 : 0;
    }

    playSong(newIndex, autoPlay);
  }

  function playSong(index: number, autoPlay = true) {
    if (index < 0 || index >= playlist.length) return;

    willAutoPlay = autoPlay;
    currentIndex = index;
    loadSong(playlist[currentIndex]);
  }

  function loadSong(song: Song) {
    if (!song) return;

    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }

    currentSong = { ...song };
    currentTime = 0;
    duration = song.duration ?? 0;
    clearAudioLoadTimeout();
    clearLoadSongTimeout();

    if (song.url) {
      const shouldStartPlayback = willAutoPlay || isPlaying;
      isLoading = shouldStartPlayback;
      const loadingSongUrl = song.url;
      loadSongTimeout = setTimeout(() => {
        if (!audio || currentSong.url !== loadingSongUrl) return;
        audio.load();
        if (shouldStartPlayback) {
          playCurrentAudio();
        }
      }, 50);
      return;
    }

    isLoading = false;
  }

  function handleLoadSuccess() {
    markAudioReady();
    if (audio?.duration && audio.duration > 1) {
      duration = Math.floor(audio.duration);
      if (playlist[currentIndex]) {
        playlist[currentIndex].duration = duration;
      }
      currentSong.duration = duration;
    }

    if (willAutoPlay || isPlaying) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.warn("Autoplay was blocked until user interaction.", error);
          autoplayFailed = true;
          handlePlaybackFailure(i18n(Key.musicPlayerRetryLater), false);
        });
      }
    }
  }

  function handleLoadError() {
    if (!currentSong.url) return;

    const shouldContinue = isPlaying || willAutoPlay;
    handlePlaybackFailure(
      `${i18n(Key.musicPlayerErrorSong)} - ${currentSong.title}`,
      shouldContinue,
    );
  }

  function handleAudioWaiting() {
    if (!isPlaying || !currentSong.url) return;
    isLoading = true;
    startAudioLoadTimeout();
  }

  function handleAudioPause() {
    clearAudioLoadTimeout();
    isLoading = false;
    isPlaying = false;
  }

  function handleAudioEnded() {
    if (isRepeating === 1) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }

    if (isRepeating === 2 || isShuffled) {
      nextSong(true);
      return;
    }

    isPlaying = false;
  }

  function showErrorMessage(message: string) {
    errorMessage = message;
    showError = true;
    setTimeout(() => {
      showError = false;
    }, 6000);
  }

  function hideError() {
    showError = false;
  }

  function setProgress(event: MouseEvent) {
    if (!audio || !progressBar || duration <= 0) return;

    const rect = progressBar.getBoundingClientRect();
    const percent = (event.clientX - rect.left) / rect.width;
    const newTime = percent * duration;
    audio.currentTime = newTime;
    currentTime = newTime;
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  onMount(() => {
    const cleanups: Array<() => void> = [];
    isHidden = false;
    if (audio) {
      audio.volume = DEFAULT_AUDIO_VOLUME;
    }

    const handleResize = () => queueSongTitleMeasure();
    window.addEventListener("resize", handleResize);
    cleanups.push(() => window.removeEventListener("resize", handleResize));

    cleanups.push(
      bindAutoplayRecovery({
        getAudio: () => audio,
        shouldRecover: () => autoplayFailed,
        onRecovered: () => {
          autoplayFailed = false;
        },
        onRecoveryFailed: () => {
          autoplayFailed = false;
          showErrorMessage(i18n(Key.musicPlayerRetryLater));
        },
      }),
    );

    cleanups.push(
      bindPlayerDocumentEvents({
        getPlayerRoot: () => playerRoot,
        getPlaylistPanel: () => playlistPanel,
        isPlaylistOpen: () => showPlaylist,
        closePlaylist,
      }),
    );

    scheduleInitialPlaylistLoad({
      enabled: musicPlayerConfig.enable,
      isMobileViewport: false,
      lazyLoadPlaylist,
    });

    return () => {
      clearAudioLoadTimeout();
      clearLoadSongTimeout();
      cleanups.forEach((cleanup) => cleanup());
    };
  });
</script>

<audio
  bind:this={audio}
  src={getAssetPath(currentSong.url)}
  on:play={() => (isPlaying = true)}
  on:playing={markAudioReady}
  on:pause={handleAudioPause}
  on:timeupdate={() => (currentTime = audio.currentTime)}
  on:ended={handleAudioEnded}
  on:error={handleLoadError}
  on:loadeddata={handleLoadSuccess}
  on:canplay={markAudioReady}
  on:waiting={handleAudioWaiting}
  on:stalled={handleAudioWaiting}
  preload="none"
></audio>

{#if musicPlayerConfig.enable}
  {#if showError}
    <div class="fixed bottom-20 right-4 z-60 max-w-sm">
      <div
        class="bg-red-500 text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-up"
      >
        <Icon icon="material-symbols:error" class="text-xl shrink-0" />
        <span class="text-sm flex-1">{errorMessage}</span>
        <button
          on:click={hideError}
          class="text-white/80 hover:text-white transition-colors"
          aria-label="Close"
        >
          <Icon icon="material-symbols:close" class="text-lg" />
        </button>
      </div>
    </div>
  {/if}

  <div
    bind:this={playerRoot}
    class="music-player fixed bottom-8 right-6 z-50 transition-all duration-300 ease-in-out"
    class:hidden-mode={isHidden}
  >
    <div
      class="orb-player rounded-xl flex items-center justify-center"
      class:opacity-0={!isHidden}
      class:scale-0={!isHidden}
      class:pointer-events-none={!isHidden}
      on:click={toggleHidden}
      on:keydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleHidden();
        }
      }}
      role="button"
      tabindex="0"
      aria-label={i18n(Key.musicPlayerShow)}
    >
      {#if isLoading}
        <Icon
          icon="eos-icons:loading"
          class="hidden-player-icon text-(--primary) text-3xl"
        />
      {:else if isPlaying}
        <div class="flex space-x-0.5">
          <div
            class="hidden-player-bar w-0.5 h-3 rounded-full animate-pulse"
          ></div>
          <div
            class="hidden-player-bar w-0.5 h-4 rounded-full animate-pulse"
            style="animation-delay: 150ms;"
          ></div>
          <div
            class="hidden-player-bar w-0.5 h-2 rounded-full animate-pulse"
            style="animation-delay: 300ms;"
          ></div>
        </div>
      {:else}
        <Icon
          icon="material-symbols:music-note"
          class="hidden-player-icon text-(--primary) text-3xl"
        />
      {/if}
    </div>

    <div
      class="expanded-player card-base rounded-2xl transition-all duration-500 ease-in-out overflow-hidden"
      style="background: var(--display-panel-bg); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%);"
      class:opacity-0={isHidden}
      class:scale-95={isHidden}
      class:pointer-events-none={isHidden}
    >
      <div
        class="expanded-player-surface p-3"
        style="background: var(--panel-bg); border: 1px solid var(--display-panel-border); box-shadow: var(--shadow-lg); border-radius: inherit;"
      >
        <div class="flex items-center gap-3 mb-3">
          <div
            class="cover-container relative w-13 h-13 rounded-full overflow-hidden shrink-0 cursor-pointer"
            on:click={togglePlay}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                togglePlay();
              }
            }}
            role="button"
            tabindex="0"
            aria-label={isPlaying
              ? i18n(Key.musicPlayerPause)
              : i18n(Key.musicPlayerPlay)}
          >
            {#if currentSong.cover}
              <img
                src={getAssetPath(currentSong.cover)}
                alt={i18n(Key.musicPlayerCover)}
                decoding="async"
                class="w-full h-full object-cover transition-transform duration-300"
                class:spinning={isPlaying && !isLoading}
                class:animate-pulse={isLoading}
              />
            {:else}
              <div
                class="w-full h-full flex items-center justify-center bg-(--btn-regular-bg) text-(--primary)"
              >
                <Icon icon="material-symbols:album-outline" class="text-2xl" />
              </div>
            {/if}
          </div>

          <div class="flex-1 min-w-0">
            <div
              bind:this={songTitleViewport}
              class="song-title text-base font-bold text-90 mb-0.5"
              class:is-scrolling={shouldScrollSongTitle}
              title={currentSong.title}
            >
              <span bind:this={songTitleText} class="song-title-text">
                {currentSong.title}
              </span>
            </div>
            <div class="song-artist text-sm text-50 truncate">
              {currentSong.artist}
            </div>
            <div class="text-[0.7rem] text-30 mt-0.5">
              {formatTime(currentTime)} / {formatTime(duration)}
            </div>
          </div>

          <div class="flex items-center gap-1">
            <button
              class="btn-plain w-7 h-7 rounded-lg flex items-center justify-center"
              aria-label={i18n(Key.musicPlayerHide)}
              on:click={toggleHidden}
              title={i18n(Key.musicPlayerHide)}
            >
              <Icon icon="material-symbols:visibility-off" class="text-base" />
            </button>
          </div>
        </div>

        <div class="progress-section mb-3">
          <div
            class="progress-bar flex-1 h-1.5 bg-(--btn-regular-bg) rounded-full cursor-pointer"
            bind:this={progressBar}
            on:click={setProgress}
            on:keydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                const percent = 0.5;
                const newTime = percent * duration;
                if (audio) {
                  audio.currentTime = newTime;
                  currentTime = newTime;
                }
              }
            }}
            role="slider"
            tabindex="0"
            aria-label={i18n(Key.musicPlayerProgress)}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={duration > 0 ? (currentTime / duration) * 100 : 0}
          >
            <div
              class="h-full bg-(--primary) rounded-full transition-all duration-100"
              style="width: {duration > 0
                ? (currentTime / duration) * 100
                : 0}%"
            ></div>
          </div>
        </div>

        <div class="controls flex items-center justify-between gap-0.5 px-1">
          <button
            class="btn-plain w-9 h-9 rounded-lg shrink-0"
            aria-label={isShuffled
              ? i18n(Key.musicPlayerShuffle)
              : isRepeating === 1
                ? i18n(Key.musicPlayerRepeatOne)
                : i18n(Key.musicPlayerRepeat)}
            on:click|stopPropagation={toggleRepeat}
          >
            {#if isShuffled}
              <Icon icon="material-symbols:shuffle" class="text-[1.05rem]" />
            {:else if isRepeating === 1}
              <Icon
                icon="material-symbols:repeat-one"
                class="text-[1.05rem]"
              />
            {:else}
              <Icon icon="material-symbols:repeat" class="text-[1.05rem]" />
            {/if}
          </button>

          <button
            class="btn-plain w-9 h-9 rounded-lg shrink-0"
            on:click={previousSong}
            aria-label={i18n(Key.musicPlayerPrevious)}
            disabled={playlist.length <= 1}
          >
            <Icon icon="material-symbols:skip-previous" class="text-lg" />
          </button>

          <button
            class="btn-plain w-9 h-9 rounded-lg shrink-0"
            aria-label={isPlaying
              ? i18n(Key.musicPlayerPause)
              : i18n(Key.musicPlayerPlay)}
            class:opacity-50={isLoading}
            disabled={isLoading}
            on:click|stopPropagation={togglePlay}
          >
            {#if isLoading}
              <Icon icon="eos-icons:loading" class="text-lg" />
            {:else if isPlaying}
              <Icon icon="material-symbols:pause" class="text-lg" />
            {:else}
              <Icon icon="material-symbols:play-arrow" class="text-lg" />
            {/if}
          </button>

          <button
            class="btn-plain w-9 h-9 rounded-lg shrink-0"
            aria-label={i18n(Key.musicPlayerNext)}
            on:click={() => nextSong()}
            disabled={playlist.length <= 1}
          >
            <Icon icon="material-symbols:skip-next" class="text-lg" />
          </button>

          <button
            class="btn-plain w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            aria-label={i18n(Key.musicPlayerPlaylist)}
            class:text-[var(--primary)]={showPlaylist}
            on:click={togglePlaylist}
            title={i18n(Key.musicPlayerPlaylist)}
          >
            <Icon icon="material-symbols:queue-music" class="text-base" />
          </button>

        </div>
      </div>
    </div>

    {#if showPlaylist}
      <div
        bind:this={playlistPanel}
        class="playlist-panel animate-slide-up float-panel fixed bottom-19 right-6 w-72 max-h-96 overflow-hidden z-50"
        style="background: var(--display-panel-bg); backdrop-filter: blur(20px) saturate(160%); -webkit-backdrop-filter: blur(20px) saturate(160%); border-radius: var(--radius-large);"
      >
        <div
          class="playlist-panel-surface"
          style="background: var(--panel-bg); border: 1px solid var(--display-panel-border); box-shadow: var(--shadow-lg); border-radius: inherit; overflow: hidden;"
        >
          <div
            class="playlist-header flex items-center justify-between p-4 border-b border-(--line-divider)"
          >
            <h3 class="text-lg font-semibold text-90">
              {i18n(Key.musicPlayerPlaylist)}
            </h3>
            <button
              bind:this={playlistCloseButton}
              class="btn-plain w-8 h-8 rounded-lg"
              aria-label="Close playlist"
              on:click={togglePlaylist}
            >
              <Icon icon="material-symbols:close" class="text-lg" />
            </button>
          </div>

          <div class="playlist-content overflow-y-auto max-h-80 hide-scrollbar">
            {#each playlist as song, index}
              <div
                class="playlist-item flex items-center gap-3 p-3 transition-colors"
                class:hover:bg-(--btn-plain-bg-hover)={!brokenSongs.has(song.id)}
                class:cursor-pointer={!brokenSongs.has(song.id)}
                class:opacity-40={brokenSongs.has(song.id)}
                class:bg-[var(--btn-plain-bg)]={index === currentIndex}
                class:text-[var(--primary)]={index === currentIndex}
                on:click={() => !brokenSongs.has(song.id) && playSong(index)}
                on:keydown={(e) => {
                  if (!brokenSongs.has(song.id) && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    playSong(index);
                  }
                }}
                role="button"
                tabindex={brokenSongs.has(song.id) ? -1 : 0}
                aria-label={brokenSongs.has(song.id) ? `${song.title} - unplayable` : `Play ${song.title} - ${song.artist}`}
                aria-disabled={brokenSongs.has(song.id)}
              >
                <div class="w-6 h-6 flex items-center justify-center">
                  {#if brokenSongs.has(song.id)}
                    <Icon
                      icon="material-symbols:block"
                      class="text-(--content-meta) text-base"
                    />
                  {:else if index === currentIndex && isPlaying}
                    <Icon
                      icon="material-symbols:graphic-eq"
                      class="text-(--primary) animate-pulse"
                    />
                  {:else if index === currentIndex}
                    <Icon
                      icon="material-symbols:pause"
                      class="text-(--primary)"
                    />
                  {:else}
                    <span class="text-sm text-(--content-meta)"
                      >{index + 1}</span
                    >
                  {/if}
                </div>

                <div
                  class="w-10 h-10 rounded-lg overflow-hidden bg-(--btn-regular-bg) shrink-0"
                >
                  <img
                    src={getAssetPath(song.cover)}
                    alt={song.title}
                    loading="lazy"
                    decoding="async"
                    class="w-full h-full object-cover"
                  />
                </div>

                <div class="flex-1 min-w-0">
                  <div
                    class="font-medium truncate"
                    class:text-[var(--primary)]={index === currentIndex}
                    class:text-90={index !== currentIndex}
                  >
                    {song.title}
                  </div>
                  <div
                    class="text-sm text-(--content-meta) truncate"
                    class:text-[var(--primary)]={index === currentIndex}
                  >
                    {song.artist}
                  </div>
                </div>
              </div>
            {:else}
              <div class="p-4 text-sm leading-6 text-(--content-meta)">
                <div class="font-medium text-90">
                  {i18n(Key.musicPlayerUnavailable)}
                </div>
                <div>{i18n(Key.musicPlayerRetryLater)}</div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <style>
    @import "../../styles/music-player.css";
  </style>
{/if}
