/** Lives only in the existing private autosave replay field, never in exported progress. */
export interface CheckpointBank {
  format: "poker-training-pro-checkpoints";
  version: 1;
  current?: Record<string, unknown>;
  careers: Partial<Record<"normal" | "rational", Record<string, unknown>>>;
}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function readCheckpointBank(
  value?: Record<string, unknown>,
): CheckpointBank {
  if (
    value?.format === "poker-training-pro-checkpoints" &&
    value.version === 1
  ) {
    const careers = record(value.careers) ? value.careers : {};
    return {
      format: "poker-training-pro-checkpoints",
      version: 1,
      ...(record(value.current) ? { current: value.current } : {}),
      careers: {
        ...(record(careers.normal) ? { normal: careers.normal } : {}),
        ...(record(careers.rational) ? { rational: careers.rational } : {}),
      },
    };
  }
  return rememberCheckpoint(
    { format: "poker-training-pro-checkpoints", version: 1, careers: {} },
    value,
  );
}
export function rememberCheckpoint(
  bank: CheckpointBank,
  current?: Record<string, unknown>,
): CheckpointBank {
  const mode = current?.mode;
  const career =
    current?.format === "poker-training-pro-tournament-replay" &&
    current.kind === "career" &&
    (mode === "normal" || mode === "rational");
  return {
    format: bank.format,
    version: 1,
    ...(current ? { current } : {}),
    careers: { ...bank.careers, ...(career ? { [mode]: current } : {}) },
  };
}
