/** 복호화 실패: 키가 틀렸거나 암호문/AAD가 변조됨. 어느 쪽인지는 구분하지 않는다(의도적). */
export class DecryptError extends Error {
  constructor(message = 'decrypt failed') {
    super(message);
    this.name = 'DecryptError';
  }
}
