import { ko } from '../i18n/ko';

/**
 * 도장(인장). 이 앱에서 붉은색이 넓게 쓰이는 유일한 곳이다. 버튼은 잉크색이고, 빨강은 도장 찍듯 아껴 쓴다.
 * 이름 옆의 작은 한 글자 도장(이름의 첫 글자 V) 하나뿐이다.
 */
export function Seal() {
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
