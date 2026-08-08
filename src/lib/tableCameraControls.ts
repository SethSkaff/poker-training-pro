/** Shared, DOM-free camera input math for the table surface. */
export const TABLE_CAMERA_MIN_PAN = -2;
export const TABLE_CAMERA_MAX_PAN = 2;
export const TABLE_CAMERA_DRAG_PIXELS_PER_PAN = 260;
export const TABLE_CAMERA_DRAG_START_PIXELS = 8;

/**
 * Wheel zoom is deliberately a continuous camera adjustment, separate from
 * the saved close/standard/wide framing preference.  Positive means closer to
 * the felt; it is bounded so a trackpad cannot push the lens through cards or
 * pull it out of the room.
 */
export const TABLE_CAMERA_MIN_ZOOM = -1;
export const TABLE_CAMERA_MAX_ZOOM = 1;
export const TABLE_CAMERA_WHEEL_ZOOM_PER_PIXEL = 0.002;

export function clampTableCameraZoom(value: number): number {
  return Math.max(TABLE_CAMERA_MIN_ZOOM, Math.min(TABLE_CAMERA_MAX_ZOOM, value));
}

/** Converts browser wheel units into the camera's normalized zoom range. */
export function cameraZoomFromWheel(
  currentZoom: number,
  deltaY: number,
  deltaMode = 0,
): number {
  // DOM_DELTA_LINE and DOM_DELTA_PAGE are much coarser than pixel wheel input.
  const pixelDelta = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 240 : deltaY;
  return clampTableCameraZoom(currentZoom - pixelDelta * TABLE_CAMERA_WHEEL_ZOOM_PER_PIXEL);
}

export function clampTableCameraPan(value: number): number {
  return Math.max(TABLE_CAMERA_MIN_PAN, Math.min(TABLE_CAMERA_MAX_PAN, value));
}

/**
 * Converts a horizontal held-pointer drag into the same signed pan used by
 * Q/E and the controller. Tiny pointer wobble is ignored so a normal felt
 * click cannot make the camera feel loose.
 */
export function cameraPanFromHorizontalDrag(
  startPan: number,
  startX: number,
  currentX: number,
): number {
  const deltaX = currentX - startX;
  if (Math.abs(deltaX) < TABLE_CAMERA_DRAG_START_PIXELS) return startPan;
  return clampTableCameraPan(startPan + deltaX / TABLE_CAMERA_DRAG_PIXELS_PER_PAN);
}
