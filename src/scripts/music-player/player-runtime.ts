type BindAutoplayRecoveryOptions = {
  getAudio: () => HTMLAudioElement | undefined;
  shouldRecover: () => boolean;
  onRecovered: () => void;
  onRecoveryFailed?: () => void;
};

type BindPlayerDocumentEventsOptions = {
  getPlayerRoot: () => HTMLElement | null;
  getPlaylistPanel: () => HTMLElement | null;
  isPlaylistOpen: () => boolean;
  closePlaylist: () => void;
};

const interactionEvents = ["click", "keydown", "touchstart"] as const;

export function bindAutoplayRecovery(
  options: BindAutoplayRecoveryOptions,
): () => void {
  const { getAudio, shouldRecover, onRecovered, onRecoveryFailed } = options;

  const handleUserInteraction = () => {
    const audio = getAudio();
    if (!audio || !shouldRecover()) return;

    // Already playing (e.g. the muted-autoplay fallback) — just unmute.
    if (!audio.paused) {
      onRecovered();
      return;
    }

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.then(onRecovered).catch((error) => {
        const name = (error as DOMException | undefined)?.name;
        if (name === "AbortError" || name === "NotAllowedError") {
          // Still buffering (common on mobile): retry shortly — the
          // track is usually ready within a second. Real failures
          // surface via the audio element's error event.
          const retryPlayback = () => {
            const audioNow = getAudio();
            if (!audioNow || !shouldRecover()) return;
            if (!audioNow.paused) {
              onRecovered();
              return;
            }
            audioNow
              .play()
              .then(onRecovered)
              .catch(() => {});
          };
          if (audio.readyState >= 2) {
            setTimeout(retryPlayback, 800);
          } else {
            // Media is not buffered yet (slow mobile network): wait for
            // canplay so the retry isn't rejected with AbortError again.
            const onCanPlay = () => {
              audio.removeEventListener("canplay", onCanPlay);
              retryPlayback();
            };
            audio.addEventListener("canplay", onCanPlay);
          }
          return;
        }
        onRecoveryFailed?.();
      });
    }
  };

  interactionEvents.forEach((eventName) => {
    document.addEventListener(eventName, handleUserInteraction, {
      capture: true,
    });
  });

  return () => {
    interactionEvents.forEach((eventName) => {
      document.removeEventListener(eventName, handleUserInteraction, {
        capture: true,
      });
    });
  };
}

export function bindPlayerDocumentEvents(
  options: BindPlayerDocumentEventsOptions,
): () => void {
  const { getPlayerRoot, getPlaylistPanel, isPlaylistOpen, closePlaylist } =
    options;

  const handleDocumentClick = (event: MouseEvent) => {
    const target = event.target;
    if (!isPlaylistOpen()) return;
    if (!(target instanceof Node)) return;

    const playerRoot = getPlayerRoot();
    const playlistPanel = getPlaylistPanel();
    if (playlistPanel?.contains(target) || playerRoot?.contains(target)) return;
    closePlaylist();
  };

  const handleDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && isPlaylistOpen()) {
      closePlaylist();
    }
  };

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);

  return () => {
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleDocumentKeydown);
  };
}

type ScheduleInitialPlaylistLoadOptions = {
  enabled: boolean;
  isMobileViewport: boolean;
  lazyLoadPlaylist: () => void;
};

export function scheduleInitialPlaylistLoad(
  options: ScheduleInitialPlaylistLoadOptions,
) {
  const { enabled, isMobileViewport, lazyLoadPlaylist } = options;
  if (!enabled) return;

  if (!isMobileViewport) {
    lazyLoadPlaylist();
    return;
  }

  if ("requestIdleCallback" in window) {
    requestIdleCallback(
      () => {
        lazyLoadPlaylist();
      },
      { timeout: 5000 },
    );
    return;
  }

  setTimeout(lazyLoadPlaylist, 3000);
}
