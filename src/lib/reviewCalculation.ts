/** Numeric provenance captured alongside the calculation, before UI formatting. */
export interface ReviewCalculation {
  formula: string;
  inputs: Readonly<Record<string, number>>;
  substituted: string;
  result: number;
}
export function calculation(
  formula: string,
  inputs: Record<string, number>,
  expression: string,
  result: number,
): ReviewCalculation {
  return {
    formula,
    inputs,
    substituted: expression.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (key) =>
      key in inputs ? String(Number(inputs[key].toPrecision(8))) : key,
    ),
    result,
  };
}
