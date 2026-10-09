import { createPvpQuestions } from '../src/domain/pvp/pvpQuestions';

describe('PvP canonical question sequence', () => {
  test.each([0, 1, 2, 42, 12345, 123456789, 999999])('seed %s produces identical nonrepeating Host/Guest questions', seed => {
    const match = { battleSeed: String(seed), level: 1, questionCount: 10 };
    const host = createPvpQuestions(match);
    const guest = createPvpQuestions(match);
    expect(host).toHaveLength(10);
    expect(host).toEqual(guest);
    expect(new Set(host.map(question => question.targetId)).size).toBe(10);
    // A reconnect can reconstruct any shared round without local answer history.
    expect(createPvpQuestions(match)[7]).toEqual(host[7]);
  });
  test.each([2, 3, 4, 5, 6])('level %s preserves canonical choices and target uniqueness', level => {
    const match = { battleSeed: '42', level, questionCount: 10 };
    const questions = createPvpQuestions(match);
    expect(questions).toEqual(createPvpQuestions(match));
    expect(new Set(questions.map(question => question.targetId)).size).toBe(10);
    questions.forEach(question => {
      expect(question.choices).toHaveLength(4);
      expect(question.choices.filter(choice => choice.id === question.correctChoiceId)).toHaveLength(1);
    });
  });
  test.each(['invalid', '123suffix', '', '-1'])('invalid seed %s fails without a clock fallback', battleSeed => {
    expect(() => createPvpQuestions({ battleSeed, level: 1, questionCount: 10 })).toThrow();
  });
});
