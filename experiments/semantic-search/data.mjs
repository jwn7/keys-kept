// 실험용 메모와 질의. 전부 지어낸 내용이다.
// gold: 그 질의로 찾고 싶은 메모 id. type: para(같은 언어, 다른 낱말) / cross(다른 언어) / key(낱말 그대로)
export const notes = [
  { id: 'n01', title: '치과 예약', body: '목요일 오후 3시 스케일링. 보험 서류 챙기기. 주차는 건물 지하.', tags: ['건강'] },
  { id: 'n02', title: '전세 계약 갱신', body: '집주인이 보증금 2천 올려 달라고 함. 계약 만료 3월 14일. 확정일자 다시 받아야 하는지 확인.', tags: ['집'] },
  { id: 'n03', title: '주간 회의 11/18', body: '결제 모듈 배포는 다음 주 화요일로 연기. 민수: 장애 보고서 초안, 지현: QA 일정 조율.', tags: ['업무'] },
  { id: 'n04', title: '엄마 생신 선물 후보', body: '안마기, 스카프, 건강검진권. 예산 20만원. 동생이랑 반반.', tags: ['가족'] },
  { id: 'n05', title: '러닝 기록', body: '5km 28분 40초. 무릎 약간 뻐근함. 다음엔 준비운동 더 길게.', tags: ['운동'] },
  { id: 'n06', title: '와이파이 비번 바꾼 날', body: '공유기 관리자 페이지 192.168.0.1 에서 변경. 손님용 네트워크 따로 만듦.', tags: ['집'] },
  { id: 'n07', title: '이직 고민', body: '지금 팀은 편한데 배우는 게 없다. 연봉보다 성장. 3개월 안에 결정하기로.', tags: ['커리어'] },
  { id: 'n08', title: '김치찌개 레시피', body: '묵은지 볶다가 돼지 목살, 쌀뜨물. 마지막에 두부와 대파. 설탕 반 스푼이 포인트.', tags: ['요리'] },
  { id: 'n09', title: '자동차 보험 갱신', body: '작년보다 8만원 오름. 다이렉트 견적 세 군데 비교. 블랙박스 할인 적용 여부 확인.', tags: ['돈'] },
  { id: 'n10', title: '읽은 책: 아주 작은 습관의 힘', body: '정체성 기반 습관. 2분 규칙. 환경을 바꾸는 게 의지보다 세다.', tags: ['독서'] },
  { id: 'n11', title: '제주 여행 일정', body: '첫날 애월 카페, 둘째날 한라산 영실 코스, 렌터카 반납 오후 6시.', tags: ['여행'] },
  { id: 'n12', title: '서버 장애 회고', body: '원인은 커넥션 풀 고갈. 재시도 폭주가 겹침. 서킷 브레이커와 타임아웃 재설정.', tags: ['업무'] },
  { id: 'n13', title: '아이 예방접종', body: '독감 2차는 4주 뒤. 접종 수첩 가져가기. 열나면 해열제 간격 4시간.', tags: ['가족', '건강'] },
  { id: 'n14', title: '연말정산 준비', body: '월세 세액공제 서류, 기부금 영수증, 안경 구입 영수증 모으기.', tags: ['돈'] },
  { id: 'n15', title: '영어 회화 표현', body: 'I was wondering if ~ 는 정중한 부탁. heads-up 은 미리 알려줌.', tags: ['공부'] },
  { id: 'n16', title: '불면 기록', body: '새벽 2시까지 못 잠. 카페인을 오후 2시 이후엔 끊어 보기. 자기 전 휴대폰 금지.', tags: ['건강'] },
  { id: 'n17', title: '사이드 프로젝트 아이디어', body: '동네 중고 책 교환 앱. 위치 기반 매칭. 수익 모델은 아직 없음.', tags: ['아이디어'] },
  { id: 'n18', title: '고양이 병원', body: '체중 4.8kg, 치석 있음. 사료를 저칼로리로 바꾸라고 함. 다음 검진 6개월 뒤.', tags: ['반려동물'] },
  { id: 'n19', title: '발표 준비: 분기 실적', body: '첫 장은 숫자 하나만. 질문 예상: 이탈률이 왜 올랐나. 리허설 두 번.', tags: ['업무'] },
  { id: 'n20', title: '통장 쪼개기', body: '월급 통장, 생활비, 비상금, 투자. 자동이체는 급여 다음날.', tags: ['돈'] },
  { id: 'n21', title: '운전면허 갱신', body: '적성검사 기간 올해 말까지. 사진 두 장, 신분증. 온라인 신청 가능.', tags: ['행정'] },
  { id: 'n22', title: '상담 3회차 메모', body: '완벽하지 않으면 시작을 못 하는 패턴. 숙제: 70%에서 제출해 보기.', tags: ['마음'] },
  { id: 'n23', title: '베란다 화분', body: '몬스테라 잎 끝이 갈색. 물을 너무 자주 줌. 흙이 마른 뒤에 주기.', tags: ['집'] },
  { id: 'n24', title: 'SQL 인덱스 정리', body: '복합 인덱스는 왼쪽 컬럼부터. 카디널리티 높은 것을 앞에. EXPLAIN으로 확인.', tags: ['공부', '업무'] },
  { id: 'n25', title: '이사 체크리스트', body: '전입신고, 인터넷 이전, 가스 해지, 관리비 정산, 우편물 주소 변경.', tags: ['집'] },
  { id: 'n26', title: '아버지 병원 일정', body: '심장내과 12월 9일 오전. 약 떨어지기 전에 처방전. 보호자 동행 필요.', tags: ['가족', '건강'] },
  { id: 'n27', title: '기타 연습', body: 'F 코드가 아직 안 잡힘. 하루 15분씩. 메트로놈 60으로 천천히.', tags: ['취미'] },
  { id: 'n28', title: '친구에게 빌려준 돈', body: '재현 50만원, 10월에 빌려줌. 연말까지 갚기로. 말 꺼내기 어렵다.', tags: ['돈'] },
  { id: 'n29', title: '면접 질문 모음', body: '가장 어려웠던 협업, 실패 경험, 5년 뒤 모습. STAR 방식으로 답 정리.', tags: ['커리어'] },
  { id: 'n30', title: '겨울 옷 정리', body: '안 입는 패딩 두 벌 기부. 니트는 접어서 보관. 제습제 교체.', tags: ['집'] },
  { id: 'n31', title: 'Flight to Tokyo', body: 'Departs 9:40 from gate 23. Seat 14C aisle. Passport expires next June, renew before the trip.', tags: ['travel'] },
  { id: 'n32', title: 'Landlord call notes', body: 'He agreed to fix the leaking faucet by Friday. Rent goes up 5% from January.', tags: ['home'] },
  { id: 'n33', title: 'Therapy homework', body: 'Write down three things that went well each night. Notice the all-or-nothing thinking.', tags: ['mind'] },
  { id: 'n34', title: 'API rate limiting design', body: 'Token bucket per user, 100 requests a minute. Return 429 with Retry-After header.', tags: ['work'] },
  { id: 'n35', title: 'Gift ideas for Sam', body: 'Noise cancelling headphones, a cooking class, or that board game he mentioned.', tags: ['friends'] },
  { id: 'n36', title: 'Marathon training plan', body: 'Long run on Sundays, add 2 km each week. Rest day after intervals. Taper two weeks before the race.', tags: ['fitness'] },
  { id: 'n37', title: 'Book notes: Deep Work', body: 'Schedule every minute. Embrace boredom. Quit social media that does not serve a goal.', tags: ['reading'] },
  { id: 'n38', title: 'Salary negotiation', body: 'Ask for 12% more, bring the market data. Do not give a number first.', tags: ['career'] },
  { id: 'n39', title: 'Sourdough starter', body: 'Feed 1:1:1 flour water starter every 12 hours. Ready when it doubles and smells tangy.', tags: ['cooking'] },
  { id: 'n40', title: 'Tax documents', body: 'Collect the W-2, mortgage interest statement and charity receipts before April.', tags: ['money'] },
];

export const queries = [
  // para: 같은 언어, 낱말이 안 겹치게
  { q: '이 닦으러 가는 날이 언제였지', gold: 'n01', type: 'para' },
  { q: '집세 올려 달라는 얘기', gold: 'n02', type: 'para' },
  { q: '누가 뭘 하기로 했는지 지난번 미팅', gold: 'n03', type: 'para' },
  { q: '어머니께 뭐 사 드릴까', gold: 'n04', type: 'para' },
  { q: '달리기 얼마나 빨리 뛰었나', gold: 'n05', type: 'para' },
  { q: '인터넷 암호 어디서 바꿨더라', gold: 'n06', type: 'para' },
  { q: '회사를 옮길지 말지', gold: 'n07', type: 'para' },
  { q: '찌개 끓이는 법', gold: 'n08', type: 'para' },
  { q: '차 보험료 얼마나 올랐지', gold: 'n09', type: 'para' },
  { q: '좋은 버릇 들이는 방법', gold: 'n10', type: 'para' },
  { q: '장애 원인 분석', gold: 'n12', type: 'para' },
  { q: '애 주사 맞히는 날', gold: 'n13', type: 'para' },
  { q: '세금 환급 받으려면 뭘 챙겨야 하나', gold: 'n14', type: 'para' },
  { q: '잠이 안 올 때 해 볼 것', gold: 'n16', type: 'para' },
  { q: '만들어 보고 싶은 서비스', gold: 'n17', type: 'para' },
  { q: '냥이 살 빼야 한다고 했던 것', gold: 'n18', type: 'para' },
  { q: '월급 관리 어떻게 나누기로 했지', gold: 'n20', type: 'para' },
  { q: '완벽주의 때문에 미루는 문제', gold: 'n22', type: 'para' },
  { q: '식물이 시드는 이유', gold: 'n23', type: 'para' },
  { q: '데이터베이스 조회가 느릴 때', gold: 'n24', type: 'para' },
  { q: '집 옮길 때 해야 할 일', gold: 'n25', type: 'para' },
  { q: '못 받은 돈', gold: 'n28', type: 'para' },
  { q: 'when does my plane leave', gold: 'n31', type: 'para' },
  { q: 'how to ask for a raise', gold: 'n38', type: 'para' },
  { q: 'bread dough feeding schedule', gold: 'n39', type: 'para' },
  // cross: 다른 언어로 묻기
  { q: 'dentist appointment', gold: 'n01', type: 'cross' },
  { q: 'lease renewal deposit', gold: 'n02', type: 'cross' },
  { q: 'birthday present for mom', gold: 'n04', type: 'cross' },
  { q: 'kimchi stew recipe', gold: 'n08', type: 'cross' },
  { q: 'car insurance renewal', gold: 'n09', type: 'cross' },
  { q: 'Jeju trip itinerary', gold: 'n11', type: 'cross' },
  { q: 'server outage postmortem', gold: 'n12', type: 'cross' },
  { q: 'cannot sleep at night', gold: 'n16', type: 'cross' },
  { q: 'moving house checklist', gold: 'n25', type: 'cross' },
  { q: 'job interview questions', gold: 'n29', type: 'cross' },
  { q: '도쿄 가는 비행기', gold: 'n31', type: 'cross' },
  { q: '집주인이랑 통화한 내용', gold: 'n32', type: 'cross' },
  { q: '요청 횟수 제한 설계', gold: 'n34', type: 'cross' },
  { q: '마라톤 훈련 계획', gold: 'n36', type: 'cross' },
  { q: '연봉 협상', gold: 'n38', type: 'cross' },
  // key: 메모에 있는 낱말 그대로
  { q: '스케일링', gold: 'n01', type: 'key' },
  { q: '확정일자', gold: 'n02', type: 'key' },
  { q: '결제 모듈 배포', gold: 'n03', type: 'key' },
  { q: '안마기', gold: 'n04', type: 'key' },
  { q: '192.168.0.1', gold: 'n06', type: 'key' },
  { q: '묵은지', gold: 'n08', type: 'key' },
  { q: '블랙박스 할인', gold: 'n09', type: 'key' },
  { q: '2분 규칙', gold: 'n10', type: 'key' },
  { q: '영실 코스', gold: 'n11', type: 'key' },
  { q: '서킷 브레이커', gold: 'n12', type: 'key' },
  { q: '기부금 영수증', gold: 'n14', type: 'key' },
  { q: 'heads-up', gold: 'n15', type: 'key' },
  { q: '몬스테라', gold: 'n23', type: 'key' },
  { q: 'EXPLAIN', gold: 'n24', type: 'key' },
  { q: '전입신고', gold: 'n25', type: 'key' },
  { q: 'F 코드', gold: 'n27', type: 'key' },
  { q: 'STAR 방식', gold: 'n29', type: 'key' },
  { q: 'gate 23', gold: 'n31', type: 'key' },
  { q: 'Retry-After', gold: 'n34', type: 'key' },
  { q: 'W-2', gold: 'n40', type: 'key' },
];

// 방해 메모: 주제는 비슷하지만 정답이 아닌 것들. 실제 메모장처럼 비슷한 글이 섞여 있게 한다.
const pick = (arr, i) => arr[i % arr.length];
const foods = ['두부', '달걀', '우유', '양파', '사과', '닭가슴살', '파스타', '올리브유', '커피 원두', '요거트'];
const people = ['수진', '태호', '은지', '동현', 'Alex', 'Priya', '유나', '상훈'];
const topics = ['로그인 화면', '알림 설정', '검색 속도', '결제 영수증', '온보딩', '다크 모드', 'push notifications', 'billing page'];
const books = ['사피엔스', '데미안', '코스모스', '1984', 'Atomic Design', 'The Pragmatic Programmer', '총 균 쇠', '어린 왕자'];
const places = ['부산', '강릉', '오사카', '경주', 'Seattle', '속초', '전주', 'Lisbon'];
const moods = ['피곤함', '뿌듯함', '불안함', '평온함', '짜증', '설렘'];
export function distractors(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = i % 8;
    const d = `${(i % 12) + 1}월 ${(i % 27) + 1}일`;
    const t =
      k === 0 ? { title: `장보기 ${d}`, body: `${pick(foods, i)}, ${pick(foods, i + 3)}, ${pick(foods, i + 5)}. 세일하면 ${pick(foods, i + 7)}도.`, tags: ['장보기'] }
      : k === 1 ? { title: `${pick(people, i)} 1:1`, body: `${pick(topics, i)} 진행 상황 공유. 다음 주까지 시안. 막히는 점: 일정이 빠듯함.`, tags: ['업무'] }
      : k === 2 ? { title: `일기 ${d}`, body: `오늘 기분은 ${pick(moods, i)}. ${pick(people, i + 2)} 만나서 저녁. 일찍 자야지.`, tags: ['일기'] }
      : k === 3 ? { title: `${pick(books, i)} 밑줄`, body: `${i + 12}쪽. 다시 읽고 싶은 문장을 옮겨 적음. 다음 장은 주말에.`, tags: ['독서'] }
      : k === 4 ? { title: `${pick(places, i)} 맛집 메모`, body: `${pick(people, i + 1)} 추천. 줄이 길어서 평일 점심에 가기. 예약은 전화로만.`, tags: ['여행'] }
      : k === 5 ? { title: `운동 ${d}`, body: `스쿼트 ${40 + (i % 30)}kg 5세트, 플랭크 ${60 + (i % 60)}초. 컨디션 ${pick(moods, i + 1)}.`, tags: ['운동'] }
      : k === 6 ? { title: `Standup ${d}`, body: `Yesterday: ${pick(topics, i + 1)}. Today: review with ${pick(people, i + 4)}. Blocker: waiting on design.`, tags: ['work'] }
      : { title: `할 일 ${d}`, body: `- [ ] ${pick(topics, i + 2)} 티켓 정리\n- [ ] ${pick(people, i + 5)}에게 답장\n- [x] 청소`, tags: ['할일'] };
    out.push({ id: `d${String(i).padStart(3, '0')}`, ...t });
  }
  return out;
}
