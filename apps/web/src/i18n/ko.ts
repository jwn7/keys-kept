/** 한국어 UI 문구는 전부 여기. (CLAUDE.md 규칙 10) */
export const ko = {
  app: {
    name: 'Vault',
    tagline: '개발자도 못 보는 메모장.',
  },
  unlock: {
    title: '잠금 해제',
    password: '마스터 비밀번호',
    deriving: '열쇠 만드는 중…',
    wrong: '비밀번호가 틀렸습니다. 대소문자를 확인하세요.',
    restoreFromBackup: '백업 파일로 복구',
  },
  sync: {
    synced: (ago: string) => `동기화됨 · ${ago}`,
    offline: (n: number) => `오프라인 · 변경 ${n}개 대기`,
    conflicts: (n: number) => `충돌 사본 ${n}개`,
    error: '동기화 오류 (재시도)',
  },
} as const;
