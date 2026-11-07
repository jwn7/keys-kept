import sodium from 'libsodium-wrappers-sumo';

/**
 * libsodium 인스턴스. 모든 crypto/ 함수는 `await ready()` 이후에만 호출한다.
 * VaultSession이 생성 시 한 번 기다리고, 테스트는 beforeAll(ready).
 */
export { sodium };

export async function ready(): Promise<void> {
  await sodium.ready;
}
