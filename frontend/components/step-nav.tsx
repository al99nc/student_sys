export interface NavStep {
  label: string;
  href?: string;
}

export function StepNav(_: { steps: NavStep[] }) {
  return null;
}
