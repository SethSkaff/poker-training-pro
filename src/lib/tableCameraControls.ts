/** Shared, DOM-free camera input math for the table surface. */
export const TABLE_CAMERA_MIN_PAN = -2;
export const TABLE_CAMERA_MAX_PAN = 2;
export const TABLE_CAMERA_DRAG_PIXELS_PER_PAN = 260;
export const TABLE_CAMERA_DRAG_START_PIXELS = 8;

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
