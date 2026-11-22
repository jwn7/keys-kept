import { ko } from '../i18n/ko';

/**
 * 도장(인장). 이 앱에서 붉은색이 넓게 쓰이는 유일한 곳이다. 버튼은 잉크색이고, 빨강은 도장 찍듯 아껴 쓴다.
 * size="hero"는 잠금 화면의 세로 도장("봉함": 봉해서 닫음), 기본은 이름 옆 작은 한 글자 도장.
 */
export function Seal({ size = 'mark' }: { size?: 'mark' | 'hero' }) {
  if (size === 'hero') {
    return (
      <span className="seal seal-hero" aria-hidden="true">
        {ko.app.sealHero.map((ch) => (
          <span key={ch}>{ch}</span>
        ))}
      </span>
    );
  }
  return (
    <span className="seal seal-mark" aria-hidden="true">
      {ko.app.sealMark}
    </span>
  );
}

export function Logo({ fontSize = 17, className = '' }: { fontSize?: number; className?: string }) {
  return (
    <span className={`logo ${className}`.trim()} style={{ fontSize }}>
      <Seal />
      {ko.app.name}
    </span>
  );
}
