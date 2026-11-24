(() => {
  const section = document.querySelector("[data-scroll-film]");
  if (!section) return;
  const track = section.querySelector("[data-scroll-film-track]");
  const video = section.querySelector("[data-scroll-film-video]");
  const progress = section.querySelector("[data-scroll-film-progress]");
  const readout = section.querySelector("[data-scroll-film-readout]");
  if (!track || !video || !progress || !readout) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reducedMotion.matches) {
    video.controls = true;
    video.preload = "metadata";
    return;
  }

  let frame = 0;
  let lastTarget = -1;
  let duration = 0;
  const formatTime = (seconds) => {
    const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    const minutes = Math.floor(safe / 60);
    const remaining = Math.floor(safe % 60);
    return String(minutes).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  };

  const update = () => {
    frame = 0;
    if (!duration || !Number.isFinite(duration)) return;
    const rect = track.getBoundingClientRect();
    const scrollable = Math.max(1, track.offsetHeight - window.innerHeight);
    const travelled = Math.min(scrollable, Math.max(0, -rect.top));
    const ratio = Math.min(1, Math.max(0, travelled / scrollable));
    const target = Math.min(duration, ratio * duration);
    // Seek at roughly frame cadence; scrolling backwards reverses the footage.
    if (Math.abs(target - lastTarget) >= 1 / 30) {
      video.currentTime = target;
      lastTarget = target;
    }
    progress.style.width = (ratio * 100).toFixed(2) + "%";
    readout.textContent = formatTime(target) + " / " + formatTime(duration);
  };

  const requestUpdate = () => {
    if (!frame) frame = window.requestAnimationFrame(update);
  };

  const onMetadata = () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0;
    requestUpdate();
  };

  video.pause();
  video.addEventListener("loadedmetadata", onMetadata, { once: true });
  video.addEventListener("durationchange", onMetadata);
  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  if (video.readyState >= 1) onMetadata();
  requestUpdate();
})();