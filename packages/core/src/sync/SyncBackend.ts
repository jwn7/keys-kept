import type { EncryptedItem, ItemsKeyRecord } from '../model/types';

/**
 * 동기화 백엔드 인터페이스.
 * 구현체: MemoryBackend(테스트), DriveBackend(기본, 무료), SupabaseBackend(Pro).
 * 이 경계를 지나는 모든 것은 이미 암호문이다. 평문 Note는 여기 오지 않는다.
 */
export interface SyncBackend {
  /** 백엔드 식별자. 상태 뱃지와 설정 화면에서 표시 */
  readonly kind: 'memory' | 'drive' | 'supabase';

  /** 연결 상태 확인 (토큰 유효성 등). 실패 시 throw */
  ping(): Promise<void>;

  /** since(ISO) 이후 변경된 항목. tombstone(deletedAt 있음) 포함. updatedAt 오름차순 */
  list(since: string | null): Promise<EncryptedItem[]>;

  /** 단건 조회. 없으면 null */
  get(id: string): Promise<EncryptedItem | null>;

  /**
   * 저장(업서트). 백엔드에 더 높은 version이 이미 있으면 ConflictError를 던지고
   * 현재 원격 항목을 error.remote로 돌려준다. SyncEngine이 충돌 사본을 만든다.
   */
  put(item: EncryptedItem): Promise<void>;

  /** tombstone 반영. 실제 삭제가 아니라 deletedAt이 설정된 항목을 put하는 것과 같다 */
  delete(id: string, deletedAt: string): Promise<void>;

  /** 데이터 키 레코드 (새 기기 연결 시 가장 먼저 읽음) */
  getKeys(): Promise<ItemsKeyRecord[]>;
  putKeys(keys: ItemsKeyRecord[]): Promise<void>;

  /** 선택: 실시간 변경 알림. Drive는 미구현(폴링), Supabase는 Realtime */
  subscribe?(onChange: () => void): () => void;

  /** 계정 삭제 흐름에서만 호출. 이 사용자의 모든 원격 데이터를 지운다 */
  purgeAll(): Promise<void>;
}

export class ConflictError extends Error {
  constructor(public readonly remote: EncryptedItem) {
    super(`conflict on ${remote.id} (remote version ${remote.version})`);
    this.name = 'ConflictError';
  }
}

export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}
