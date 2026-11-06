export type QuestionType = 'single' | 'multi' | 'bool' | 'blank';

export function gradeAnswer(input: {
  type: QuestionType;
  answerKey: string | null;
  options: Array<{ id: string; is_correct: number }>;
  answerPayload: unknown;
}): boolean {
  const payload = input.answerPayload;

  if (input.type === 'single' || input.type === 'bool') {
    const correct = input.options.find((o) => o.is_correct === 1);
    if (!correct) return false;
    const p = payload as { optionId?: string; optionIds?: string[] } | string | null;
    const chosen =
      typeof p === 'string'
        ? p
        : p?.optionId ?? (Array.isArray(p?.optionIds) ? p.optionIds[0] : undefined);
    return chosen === correct.id;
  }

  if (input.type === 'multi') {
    const correctIds = input.options.filter((o) => o.is_correct === 1).map((o) => o.id).sort();
    const chosen = Array.isArray(payload)
      ? [...payload].map(String).sort()
      : Array.isArray((payload as { optionIds?: string[] })?.optionIds)
        ? [...((payload as { optionIds: string[] }).optionIds)].sort()
        : [];
    return correctIds.length > 0 && JSON.stringify(correctIds) === JSON.stringify(chosen);
  }

  if (input.type === 'blank') {
    const expected = (input.answerKey ?? '').trim().toLowerCase();
    const actual =
      typeof payload === 'string'
        ? payload.trim().toLowerCase()
        : String((payload as { text?: string })?.text ?? '')
            .trim()
            .toLowerCase();
    return expected.length > 0 && expected === actual;
  }

  return false;
}

export function computeErrorRate(answered: number, wrong: number): number {
  if (answered <= 0) return 0;
  return Number((wrong / answered).toFixed(4));
}
