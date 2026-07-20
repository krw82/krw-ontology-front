export const BOTTOM_SHEET_DISMISS_DISTANCE_PX = 72;
export const BOTTOM_SHEET_DISMISS_VELOCITY_PX_PER_SECOND = 620;

export const BOTTOM_SHEET_SPRING = {
  type: "spring",
  stiffness: 440,
  damping: 38,
  mass: 0.9,
} as const;

export function shouldDismissBottomSheet(
  offsetY: number,
  velocityY: number,
): boolean {
  return (
    offsetY > BOTTOM_SHEET_DISMISS_DISTANCE_PX ||
    velocityY > BOTTOM_SHEET_DISMISS_VELOCITY_PX_PER_SECOND
  );
}
