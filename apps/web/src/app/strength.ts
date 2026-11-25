import { useEffect, useState } from 'react';
import { passwordScore } from './util';

/**
 * 비밀번호 강도 0–4 (SPEC §1.1: 3 이상 요구). zxcvbn은 길이·문자 종류가 아니라
 * "공격자가 몇 번 만에 맞히는가"를 추정한다: 흔한 비밀번호, 사전 단어, 키보드 배열, 반복을 알아본다.
 * 사전이 커서(수백 KB) 비밀번호를 정하는 화면에서만 따로 내려받는다. 계산은 전부 기기 안에서 한다.
 */
type Checker = { check(pw: string): { score: number } };
let loading: Promise<Checker> | null = null;

function load(): Promise<Checker> {
  loading ??= (async () => {
    const [{ ZxcvbnFactory }, common, ko] = await Promise.all([import('@zxcvbn-ts/core'), import('@zxcvbn-ts/language-common'), import('@zxcvbn-ts/language-ko')]);
    return new ZxcvbnFactory({
      dictionary: { ...common.dictionary, ...ko.dictionary },
      graphs: common.adjacencyGraphs,
      translations: ko.translations,
    });
  })();
  return loading;
}

export async function strongScore(pw: string): Promise<number> {
  if (!pw) return 0;
  // 아주 긴 입력은 앞부분만 본다 (계산 시간 제한)
  return (await load()).check(pw.slice(0, 100)).score;
}

/**
 * 입력 중인 비밀번호의 점수. 사전을 받기 전에는 간이 추정(길이·문자 종류)을 먼저 보여주되,
 * 간이 추정만으로는 통과시키지 않는다: 3 이상은 zxcvbn 결과가 나온 뒤에만 준다.
 */
export function usePasswordScore(pw: string): number {
  const [score, setScore] = useState(0);
  useEffect(() => {
    let live = true;
    setScore(Math.min(2, passwordScore(pw)));
    if (!pw) return;
    const t = setTimeout(() => {
      void strongScore(pw)
        .then((s) => live && setScore(s))
        .catch(() => live && setScore(passwordScore(pw))); // 사전을 못 받으면(오프라인 첫 실행) 간이 추정으로
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [pw]);
  return score;
}
