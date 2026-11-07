// @ts-check
import tseslint from 'typescript-eslint';

/**
 * 평문 로그 금지 규칙.
 * 1) 패키지 전체에서 console.* 금지 (no-console).
 * 2) 혹시 예외를 열더라도, 메모·키·비밀번호 같은 식별자를 console에 넘기는 호출은 별도로 막는다.
 */
const SECRET_ID = '/^(note|notes|key|keys|rootKey|itemsKey|password|passphrase|phrase|plaintext|plain)$/i';

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: `CallExpression[callee.object.name='console'] > Identifier[name=${SECRET_ID}]`,
          message: '평문 메모·키를 로그에 남기지 않는다 (CLAUDE.md 규칙 / SPEC §6).',
        },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
