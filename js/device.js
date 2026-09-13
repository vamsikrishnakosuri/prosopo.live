// Device capability detection. iOS Safari has a hard memory cap that the
// in-browser Kokoro model (~300MB) blows through — the page crash-loops.
// LITE_MODE keeps everything working there with lightweight paths.

const params = new URLSearchParams(location.search);

export const IS_IOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export const LITE_MODE =
  params.get("lite") === "1" ||
  (params.get("lite") !== "0" &&
    (IS_IOS || (navigator.deviceMemory !== undefined && navigator.deviceMemory <= 3)));
