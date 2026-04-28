'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiForward10Line,
  RiHistoryLine,
  RiSkipForwardFill,
} from '@remixicon/react';

// ── helpers ──────────────────────────────────────────────────────────────────
function formatTime(s) {
  if (s == null || isNaN(s)) return '--:--';
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// Stable callback ref — avoids stale-closure bugs without re-creating the player
function useCallbackRef(fn) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback((...args) => ref.current?.(...args), []);
}

// ── component ─────────────────────────────────────────────────────────────────
export default function AnimePlayer({
  url,
  episodeData,
  skipTimes,
  onDurationKnown,
  onProgress,
  initialSeekTime = 0,
  onNextEpisode,
  onPrevEpisode,
  hasNextEpisode = false,
  hasPrevEpisode = false,
  autoPlayNext = true,
  episodeDuration = 24,
}) {
  const containerRef = useRef(null);
  const artRef       = useRef(null);
  const hlsRef       = useRef(null);

  // ── skip times (always latest via ref) ───────────────────────────────────
  const skipTimesRef = useRef(skipTimes);
  useEffect(() => {
    skipTimesRef.current = skipTimes;
  }, [skipTimes]);

  // ── FIX: reconcile state machine when skipTimes arrive late ─────────────
  // If the player is already inside (or past) a skip window when skipTimes
  // arrive, the normal timeupdate handler won't fire the transition because
  // it only moves idle→active while time < endTime. We catch that here.
  useEffect(() => {
    const art = artRef.current;
    if (!art || !skipTimes) return;
    const time = art.currentTime;
    if (!Number.isFinite(time) || isNaN(time)) return;

    const intro = skipTimes.intro;
    if (intro?.startTime != null && intro?.endTime != null && introStateRef.current === 'idle') {
      if (time >= intro.startTime && time < intro.endTime) {
        introStateRef.current = 'active';
        setShowSkipIntro(true);
      } else if (time >= intro.endTime) {
        introStateRef.current = 'done';
      }
    }

    const outro = skipTimes.outro;
    if (outro?.startTime != null && outro?.endTime != null && outroStateRef.current === 'idle') {
      if (time >= outro.startTime && time < outro.endTime) {
        outroStateRef.current = 'active';
        setShowSkipOutro(true);
      } else if (time >= outro.endTime) {
        outroStateRef.current = 'done';
      }
    }
  }, [skipTimes]);

  // ── intro/outro state machine ─────────────────────────────────────────────
  //   'idle' → 'active' (button shown) → 'done' (past end or skipped)
  //   reset to 'idle' if user seeks back before start
  const introStateRef = useRef('idle'); // idle | active | done
  const outroStateRef = useRef('idle');

  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showSkipOutro, setShowSkipOutro] = useState(false);

  // ── autoplay countdown ────────────────────────────────────────────────────
  const [showAutoPlay, setShowAutoPlay]     = useState(false);
  const [countdown, setCountdown]           = useState(10);
  const countdownRef                        = useRef(null);
  const autoPlayActiveRef                   = useRef(false);

  // stable wrappers so player effect never re-runs due to prop changes
  const onNextEpisodeStable = useCallbackRef(onNextEpisode);
  const onPrevEpisodeStable = useCallbackRef(onPrevEpisode);
  const onDurationKnownStable = useCallbackRef(onDurationKnown);
  const onProgressStable = useCallbackRef(onProgress);
  const autoPlayNextRef     = useRef(autoPlayNext);
  useEffect(() => { autoPlayNextRef.current = autoPlayNext; }, [autoPlayNext]);
  const hasNextEpisodeRef   = useRef(hasNextEpisode);
  useEffect(() => { hasNextEpisodeRef.current = hasNextEpisode; }, [hasNextEpisode]);
  const reportedDurationRef = useRef(0);
  const initialSeekTimeRef  = useRef(initialSeekTime);
  const seekAppliedRef      = useRef(false);
  const lastProgressSentRef = useRef(0);
  const qualityLevelsRef    = useRef([]);
  const selectedQualityRef  = useRef(-1);
  const autoQualityLabelRef = useRef('Auto');

  useEffect(() => {
    initialSeekTimeRef.current = initialSeekTime;
  }, [initialSeekTime]);

  const reportDuration = useCallback((duration) => {
    if (!isFinite(duration) || duration <= 0) return;
    if (Math.abs(reportedDurationRef.current - duration) < 1) return;
    reportedDurationRef.current = duration;
    onDurationKnownStable(Math.round(duration));
  }, [onDurationKnownStable]);

  // ── autoplay helpers ──────────────────────────────────────────────────────
  const stopCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = null;
    autoPlayActiveRef.current = false;
    setShowAutoPlay(false);
    setCountdown(10);
  }, []);

  const startAutoPlay = useCallback(() => {
    if (!autoPlayNextRef.current || !hasNextEpisodeRef.current) return;
    if (autoPlayActiveRef.current) return; // already running
    autoPlayActiveRef.current = true;
    setShowAutoPlay(true);
    setCountdown(10);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          stopCountdown();
          onNextEpisodeStable();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopCountdown, onNextEpisodeStable]);

  const confirmAutoPlay = useCallback(() => {
    stopCountdown();
    onNextEpisodeStable();
  }, [stopCountdown, onNextEpisodeStable]);

  // ── reset on URL change ───────────────────────────────────────────────────
  useEffect(() => {
    reportedDurationRef.current = 0;
    seekAppliedRef.current = false;
    lastProgressSentRef.current = 0;
    introStateRef.current = 'idle';
    outroStateRef.current = 'idle';
    setShowSkipIntro(false);
    setShowSkipOutro(false);
    stopCountdown();
  }, [url, stopCountdown]);

  const buildQualitySelector = useCallback((levels, autoLabel, selected) => {
    return [
      { html: autoLabel, value: -1, default: selected === -1 },
      ...levels.map((l, i) => ({ html: `${l.height}p`, value: i, default: selected === i })).reverse(),
    ];
  }, []);

  const updateQualitySetting = useCallback((artInstance) => {
    const levels = qualityLevelsRef.current;
    if (!levels.length) return;

    const selected = selectedQualityRef.current;
    const autoLabel = autoQualityLabelRef.current;
    const tooltip = selected === -1
      ? autoLabel
      : levels[selected]?.height ? `${levels[selected].height}p` : 'Auto';

    artInstance.setting.update({
      name: 'quality',
      html: 'Quality',
      tooltip,
      selector: buildQualitySelector(levels, autoLabel, selected),
    });
  }, [buildQualitySelector]);

  // ── skip actions ──────────────────────────────────────────────────────────
  const skipIntro = useCallback(() => {
    const st = skipTimesRef.current;
    if (!st?.intro || artRef.current == null) return;
    artRef.current.currentTime = st.intro.endTime;
    introStateRef.current = 'done';
    setShowSkipIntro(false);
  }, []);

  const skipOutro = useCallback(() => {
    const st = skipTimesRef.current;
    if (!st?.outro || artRef.current == null) return;
    artRef.current.currentTime = st.outro.endTime;
    outroStateRef.current = 'done';
    setShowSkipOutro(false);
  }, []);

  // ── timeupdate handler (replaces setInterval) ─────────────────────────────
  const handleTimeUpdate = useCallback(() => {
    const art = artRef.current;
    if (!art) return;

    const time = art.currentTime;
    if (!isFinite(time) || isNaN(time) || time < 0) return;

    const st = skipTimesRef.current;
    if (!st) return;

    // — intro —
    const intro = st.intro;
    if (intro?.startTime != null && intro?.endTime != null) {
      const { startTime: is, endTime: ie } = intro;

      // seeked back before intro → reset
      if (time < is && introStateRef.current !== 'idle') {
        introStateRef.current = 'idle';
        setShowSkipIntro(false);
      }
      // entered intro window
      if (time >= is && time < ie && introStateRef.current === 'idle') {
        introStateRef.current = 'active';
        setShowSkipIntro(true);
      }
      // passed intro end naturally
      if (time >= ie && introStateRef.current === 'active') {
        introStateRef.current = 'done';
        setShowSkipIntro(false);
      }
    }

    // — outro —
    const outro = st.outro;
    if (outro?.startTime != null && outro?.endTime != null) {
      const { startTime: os, endTime: oe } = outro;

      if (time < os && outroStateRef.current !== 'idle') {
        outroStateRef.current = 'idle';
        setShowSkipOutro(false);
      }
      if (time >= os && time < oe && outroStateRef.current === 'idle') {
        outroStateRef.current = 'active';
        setShowSkipOutro(true);
      }
      if (time >= oe && outroStateRef.current === 'active') {
        outroStateRef.current = 'done';
        setShowSkipOutro(false);
      }
    }

    // Persist watch position periodically without spamming storage writes.
    const now = Date.now();
    if (now - lastProgressSentRef.current >= 4000) {
      lastProgressSentRef.current = now;
      onProgressStable({ currentTime: time, duration: art.duration, ended: false });
    }
  }, [onProgressStable]);

  // ── inject progress bar markers ───────────────────────────────────────────
  const injectMarkers = useCallback((durationSec) => {
    if (!durationSec || !containerRef.current) return;

    const bar =
      containerRef.current.querySelector('.art-control-progress-inner') ||
      containerRef.current.querySelector('.art-control-progress');
    if (!bar) return;

    bar.querySelector('.skip-markers')?.remove();
    const st = skipTimesRef.current;
    if (!st) return;

    const wrap = document.createElement('div');
    wrap.className = 'skip-markers';
    wrap.style.cssText =
      'position:absolute;inset:0;pointer-events:none;z-index:100;';

    const addMarker = (start, end, label) => {
      if (start == null || end == null) return;
      const percentage = (start / durationSec) * 100;
      const widthPercentage = ((end - start) / durationSec) * 100;
      const el = document.createElement('div');
      el.title = `${label}: ${formatTime(start)} – ${formatTime(end)}`;
      el.style.cssText = `
        position:absolute;top:0;height:100%;border-radius:1px;
        left:${percentage}%;
        width:${widthPercentage}%;
        background:linear-gradient(to right,#2563eb,#3b82f6);
        opacity:.9;pointer-events:none;
      `;
      wrap.appendChild(el);
    };

    addMarker(st.intro?.startTime, st.intro?.endTime, 'Intro');
    addMarker(st.outro?.startTime, st.outro?.endTime, 'Outro');

    bar.style.position = 'relative';
    bar.appendChild(wrap);
  }, []);

  // ── player lifecycle (only re-runs when url changes) ─────────────────────
  useEffect(() => {
    stopCountdown();
    hlsRef.current?.destroy();
    hlsRef.current = null;
    artRef.current?.destroy(false);
    artRef.current = null;

    if (!containerRef.current || !url) return;

    const art = new Artplayer({
      container: containerRef.current,
      url,
      type: 'm3u8',
      customType: {
        m3u8(video, src, artInstance) {
          hlsRef.current?.destroy();
          hlsRef.current = null;

          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, backBufferLength: 90 });
            hls.loadSource(src);
            hls.attachMedia(video);
            hlsRef.current = hls;

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              video.play().catch(() => {});

              const levels = hls.levels.filter(l => l.height);
              if (!levels.length) return;

              qualityLevelsRef.current = levels;
              selectedQualityRef.current = -1;
              autoQualityLabelRef.current = 'Auto';

              artInstance.setting.add({
                name: 'quality',
                html: 'Quality',
                tooltip: 'Auto',
                selector: buildQualitySelector(levels, 'Auto', -1),
                onSelect(item) {
                  const chosen = Number(item.value);
                  selectedQualityRef.current = chosen;
                  hls.currentLevel = chosen;

                  if (chosen === -1) {
                    const level = hls.levels?.[hls.currentLevel];
                    autoQualityLabelRef.current = level?.height ? `Auto (${level.height}p)` : 'Auto';
                  } else {
                    autoQualityLabelRef.current = 'Auto';
                  }

                  updateQualitySetting(artInstance);
                  return chosen === -1 ? autoQualityLabelRef.current : item.html;
                },
              });
            });

            hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
              const lvl = hls.levels[data.level];
              if (lvl?.height) artInstance.notice.show = `${lvl.height}p`;

              if (selectedQualityRef.current === -1) {
                autoQualityLabelRef.current = lvl?.height ? `Auto (${lvl.height}p)` : 'Auto';
                updateQualitySetting(artInstance);
              }
            });

            hls.on(Hls.Events.ERROR, (_, data) => {
              if (!data.fatal) return;
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
              else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
              else { hls.destroy(); hlsRef.current = null; }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            video.play().catch(() => {});
          }
        },
      },
      volume: 0.8,
      autoplay: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      setting: true,
      hotkey: true,
      pip: false,
      fullscreen: true,
      fullscreenWeb: false,
      miniProgressBar: true,
      mutex: true,
      theme: '#e11d48',
      lang: navigator.language.toLowerCase(),
      moreVideoAttr: { crossOrigin: 'anonymous' },
    });

    artRef.current = art;

    // Keep native ArtPlayer volume UI but force it into a horizontal, touch-friendly mode.
    const volumeControl = art.template.query('.art-control-volume');
    const volumePanel = art.template.query('.art-control-volume .art-volume-panel');
    const volumeInner = art.template.query('.art-control-volume .art-volume-inner');
    const volumeSlider = art.template.query('.art-control-volume .art-volume-slider');
    const volumeLoaded = art.template.query('.art-control-volume .art-volume-loaded');
    const volumeIndicator = art.template.query('.art-control-volume .art-volume-indicator');
    const volumeVal = art.template.query('.art-control-volume .art-volume-val');

    // Detach the slider from ArtPlayer's popup panel and place it directly beside the icon.
    // This avoids the built-in blurred panel background on mobile while preserving native behavior.
    if (volumeControl && volumeSlider && volumeSlider.parentElement !== volumeControl) {
      volumeControl.appendChild(volumeSlider);
    }
    if (volumePanel) {
      volumePanel.style.display = 'none';
      volumePanel.style.visibility = 'hidden';
      volumePanel.style.opacity = '0';
    }
    if (volumeInner) {
      volumeInner.style.display = 'none';
    }
    if (volumeVal) {
      volumeVal.style.display = 'none';
    }

    const syncHorizontalVolumeUI = () => {
      const next = art.video?.muted ? 0 : art.volume;
      const percent = Math.round(Math.max(0, Math.min(1, next)) * 100);

      if (volumeLoaded) {
        volumeLoaded.style.left = '0';
        volumeLoaded.style.top = '0';
        volumeLoaded.style.width = `${percent}%`;
        volumeLoaded.style.height = '100%';
      }

      if (volumeIndicator) {
        volumeIndicator.style.left = `${percent}%`;
        volumeIndicator.style.top = '50%';
      }

      if (volumeVal) {
        volumeVal.textContent = String(percent);
      }
    };

    const setVolumeFromPointerX = (clientX) => {
      if (!volumeSlider || !Number.isFinite(clientX)) return;
      const rect = volumeSlider.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      art.video.muted = ratio === 0;
      art.volume = ratio;
      syncHorizontalVolumeUI();
    };

    const swallowEvent = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') {
        event.stopImmediatePropagation();
      }
    };

    let draggingVolume = false;

    const handleVolumePointerDown = (event) => {
      swallowEvent(event);
      draggingVolume = true;
      setVolumeFromPointerX(event.clientX);
      volumeSlider?.setPointerCapture?.(event.pointerId);
    };

    const handleVolumePointerMove = (event) => {
      if (!draggingVolume) return;
      swallowEvent(event);
      setVolumeFromPointerX(event.clientX);
    };

    const handleVolumePointerUp = (event) => {
      if (!draggingVolume) return;
      swallowEvent(event);
      draggingVolume = false;
      volumeSlider?.releasePointerCapture?.(event.pointerId);
      setVolumeFromPointerX(event.clientX);
    };

    const handleVolumeClick = (event) => {
      swallowEvent(event);
      setVolumeFromPointerX(event.clientX);
    };

    if (volumeSlider) {
      volumeSlider.style.touchAction = 'none';
      volumeSlider.addEventListener('pointerdown', handleVolumePointerDown, true);
      window.addEventListener('pointermove', handleVolumePointerMove, true);
      window.addEventListener('pointerup', handleVolumePointerUp, true);
      volumeSlider.addEventListener('click', handleVolumeClick, true);
    }

    const handleNativeVolumeChange = () => syncHorizontalVolumeUI();
    art.video?.addEventListener('volumechange', handleNativeVolumeChange);
    syncHorizontalVolumeUI();

    const applyInitialSeek = () => {
      if (seekAppliedRef.current) return;
      const seekTo = Number(initialSeekTimeRef.current || 0);
      if (!Number.isFinite(seekTo) || seekTo <= 2) return;

      const dur = art.duration;
      const cap = dur && Number.isFinite(dur) && dur > 0
        ? Math.max(0, Math.min(seekTo, dur - 3))
        : seekTo;
      if (cap <= 2) return;

      art.currentTime = cap;
      seekAppliedRef.current = true;
      art.notice.show = `Resumed at ${formatTime(cap)}`;
    };

    // ── wire timeupdate to our handler ───────────────────────────────────
    art.on('video:timeupdate', handleTimeUpdate);

    // ── duration + markers ───────────────────────────────────────────────
    const tryMarkers = () => {
      const dur = art.duration;
      if (dur && isFinite(dur) && dur > 0) {
        reportDuration(dur);
        injectMarkers(dur);
        return true;
      }
      return false;
    };

    art.on('video:loadedmetadata', () => {
      reportDuration(art.duration);
      applyInitialSeek();
      if (!tryMarkers()) {
        // fallback: use episodeDuration estimate until real duration arrives
        injectMarkers(episodeDuration * 60);
      }
    });

    art.on('video:durationchange', () => {
      reportDuration(art.duration);
      applyInitialSeek();
      tryMarkers();
    });

    // first paint: inject with estimate so markers appear immediately
    setTimeout(() => {
      if (!tryMarkers()) injectMarkers(episodeDuration * 60);
    }, 800);

    // ── ended → always try autoplay ──────────────────────────────────────
    art.on('video:ended', () => {
      onProgressStable({ currentTime: 0, duration: art.duration, ended: true });
      startAutoPlay();
    });

    return () => {
      stopCountdown();
      if (artRef.current) {
        onProgressStable({ currentTime: artRef.current.currentTime || 0, duration: artRef.current.duration, ended: false });
      }
      if (volumeSlider) {
        volumeSlider.removeEventListener('pointerdown', handleVolumePointerDown, true);
        window.removeEventListener('pointermove', handleVolumePointerMove, true);
        window.removeEventListener('pointerup', handleVolumePointerUp, true);
        volumeSlider.removeEventListener('click', handleVolumeClick, true);
      }
      art.video?.removeEventListener('volumechange', handleNativeVolumeChange);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      artRef.current?.destroy(false);
      artRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]); // only url — callbacks are stable refs

  // re-inject markers when skipTimes arrive (may come after player is ready)
  useEffect(() => {
    if (!artRef.current) return;
    const dur = artRef.current.duration;
    injectMarkers(dur && isFinite(dur) && dur > 0 ? dur : episodeDuration * 60);
  }, [skipTimes, injectMarkers, episodeDuration]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="relative w-full">
        <div
          ref={containerRef}
          className="aspect-video w-full bg-black"
        />

        {/* Skip Intro */}
        {showSkipIntro && (
          <button
            onClick={skipIntro}
            className="absolute top-3 right-3 z-50 flex items-center gap-1.5 px-3 py-2
                       bg-black/80 hover:bg-black/90 text-white rounded-lg backdrop-blur-sm
                       text-xs sm:top-4 sm:right-4 sm:gap-2 sm:px-4 sm:text-sm
                       border border-white/20 transition-all duration-200 shadow-lg animate-pulse"
          >
            <RiSkipForwardFill size={16} className="text-[var(--color-brass)]" />
            <span className="font-medium">Skip Intro</span>
          </button>
        )}

        {/* Skip Outro */}
        {showSkipOutro && (
          <button
            onClick={skipOutro}
            className="absolute top-3 right-3 z-50 flex items-center gap-1.5 px-3 py-2
                       bg-black/80 hover:bg-black/90 text-white rounded-lg backdrop-blur-sm
                       text-xs sm:top-4 sm:right-4 sm:gap-2 sm:px-4 sm:text-sm
                       border border-white/20 transition-all duration-200 shadow-lg animate-pulse"
          >
            <RiSkipForwardFill size={16} className="text-[var(--color-brass)]" />
            <span className="font-medium">Skip Outro</span>
          </button>
        )}

        {/* Autoplay modal */}
        {showAutoPlay && hasNextEpisode && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="mx-3 w-full max-w-sm rounded-[1.25rem] border border-white/10 bg-gray-900 p-4 shadow-2xl sm:mx-4 sm:rounded-2xl sm:p-6">
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-rose-600/20 sm:h-16 sm:w-16">
                  <span className="text-3xl font-bold text-rose-400">{countdown}</span>
                </div>
                <h3 className="mb-2 text-base font-semibold text-white sm:text-lg">Next Episode Playing Soon</h3>
                {episodeData?.nextEpisode && (
                  <p className="text-sm text-gray-400 mb-1">
                    Up next: Episode {episodeData.nextEpisode.number}
                  </p>
                )}
                {episodeData?.nextEpisode?.title && (
                  <p className="text-xs text-gray-500 mb-4">{episodeData.nextEpisode.title}</p>
                )}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={stopCountdown}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5
                               bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors border border-white/10"
                  >
                    <RiCloseLine size={16} />
                    <span className="text-sm font-medium">Cancel</span>
                  </button>
                  <button
                    onClick={confirmAutoPlay}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5
                               bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors"
                  >
                    <span className="text-sm font-medium">Play Now</span>
                    <RiArrowRightSLine size={16} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Touch controls */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button
          onClick={() => onPrevEpisodeStable()}
          disabled={!hasPrevEpisode}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-[var(--color-mist)] sm:px-4 sm:text-sm
                     disabled:cursor-not-allowed disabled:opacity-30"
        >
          <RiArrowLeftSLine size={16} />
          <span>Prev</span>
        </button>
        <button
          onClick={() => {
            if (artRef.current) artRef.current.currentTime = Math.max(0, artRef.current.currentTime - 10);
          }}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-[var(--color-mist)] sm:px-4 sm:text-sm"
        >
          <RiHistoryLine size={14} />
          <span className="sm:hidden">-10s</span>
          <span className="hidden sm:inline">Back 10s</span>
        </button>
        <button
          onClick={() => {
            if (artRef.current) {
              const dur = artRef.current.duration || episodeDuration * 60;
              artRef.current.currentTime = Math.min(dur, artRef.current.currentTime + 10);
            }
          }}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-[var(--color-mist)] sm:px-4 sm:text-sm"
        >
          <RiForward10Line size={14} />
          <span className="sm:hidden">+10s</span>
          <span className="hidden sm:inline">Forward 10s</span>
        </button>
        <button
          onClick={() => { if (showSkipIntro) skipIntro(); else if (showSkipOutro) skipOutro(); }}
          disabled={!showSkipIntro && !showSkipOutro}
          className="flex items-center gap-1.5 rounded-full border border-[rgba(196,160,96,0.24)] bg-[rgba(196,160,96,0.12)] px-3 py-2 text-xs text-[var(--color-brass)] sm:px-4 sm:text-sm
                     disabled:cursor-not-allowed disabled:opacity-30"
        >
          <RiSkipForwardFill size={14} />
          <span>Skip</span>
        </button>
        <button
          onClick={() => onNextEpisodeStable()}
          disabled={!hasNextEpisode}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/6 px-3 py-2 text-xs text-[var(--color-mist)] sm:px-4 sm:text-sm
                     disabled:cursor-not-allowed disabled:opacity-30"
        >
          <span>Next</span>
          <RiArrowRightSLine size={16} />
        </button>
      </div>
    </>
  );
}
