# 실험: 기기 안 임베딩으로 뜻 검색 (2026-11-25)

질문: 지금의 낱말 검색이 놓치는 질의를 기기 안 임베딩 모델이 얼마나 찾는가, 그리고 충분히 빠른가.
앱 코드에는 아무것도 들어가지 않았다. 결론과 다음 단계는 `docs/STRATEGY.md`.

## 통과 기준 (실험 전에 정함)
1. 낱말 검색이 놓친 질의의 절반 이상을 찾는다.
2. 메모 1,000개 색인이 PC에서 2분 이내.

## 방법
- 메모 300개: 손으로 쓴 정답 메모 40개(한국어 30, 영어 10) + 주제가 비슷한 방해 메모 260개. 전부 지어낸 내용.
- 질의 60개: 같은 언어·다른 낱말 25(para), 다른 언어 15(cross), 낱말 그대로 20(key).
- 지표: 정답 메모가 위에서 5번째 안에 있는 비율(hit@5).
- 비교: `and` = 지금 앱의 검색(모든 조각이 들어 있어야 함, `apps/web/src/app/util.ts`의 `searchScore`를 옮김), `or` = 조각이 하나라도 있으면 점수, `semantic` = 임베딩 코사인, `andFirst` = 낱말이 전부 맞은 메모 먼저 + 나머지는 뜻 순.

## 결과: 찾는 비율 (hit@5)
| | 전체 | 다른 낱말 | 다른 언어 | 낱말 그대로 |
|---|---|---|---|---|
| 지금 앱 (and) | 33% | 0% | 0% | 100% |
| 너그러운 낱말 검색 (or) | 45% | 32% | 0% | 95% |
| multilingual-e5-small (q8) | 78% | 80% | 53% | 95% |
| EmbeddingGemma 2 (q4) | 93% | 88% | 93% | 100% |
| **EmbeddingGemma 300M (q4)** | **97%** | **92%** | **100%** | **100%** |

지금 앱이 놓친 질의 40개 중: e5-small 28개(70%), EmbeddingGemma 300M 38개(95%). 기준 1 통과.

## 결과: 크기와 속도
| | 받는 크기 | Node CPU 메모 1개 | Chrome CPU(wasm) | Chrome GPU(WebGPU) | 메모 1,000개 |
|---|---|---|---|---|---|
| multilingual-e5-small q8 | 135MB | 4~6ms | 24ms | 70ms | 4~6초(Node) / 24초(Chrome CPU) |
| EmbeddingGemma 300M q4 | 219MB | 69ms | **실행 안 됨** | 59ms | 69초(Node) / 59초(Chrome GPU) |
| EmbeddingGemma 2 q4 | 174MB(글자만) | 70ms | 재지 않음 | 재지 않음 | 70초(Node) |

기준 2 통과. 질의 1개는 5~70ms. 실행 중 바깥 요청은 0건(브라우저 측정에서 localhost 외 요청을 전부 막고 확인).

## 알아낸 것
- **낱말 검색과 섞을 때는 단순하게**: 순위를 섞는 방식(RRF)은 오히려 나빠졌다(97% → 88%). "낱말이 전부 맞은 것 먼저, 나머지는 뜻 순"이 임베딩 단독과 같은 비율을 내면서 정확한 낱말 검색의 장점을 지킨다.
- **EmbeddingGemma의 기본 q4 파일은 브라우저 CPU에서 안 돈다** (`GatherBlockQuantized` 연산 미지원). GPU에서는 돈다. 저장소에 CPU용으로 보이는 `model_no_gather_q4`(195MB)가 따로 있는데 아직 재지 않았다.
- **모델은 하나로 통일해야 한다**: 벡터를 암호화해 기기끼리 나누려면 같은 모델이어야 한다. 폰은 색인은 받아 쓰더라도 질의 1개는 스스로 임베딩해야 하므로, 고른 모델이 GPU 없는 폰에서도 돌아야 한다.
- e5-small은 GPU에서 오히려 느리다(작은 모델은 CPU가 유리).

## 한계 (결과를 믿기 전에)
- 질의 60개는 적고, 메모와 질의를 같은 사람이 썼다. 실제 메모로 다시 재야 한다. 몇 퍼센트포인트 차이는 의미가 없다.
- 한 대의 PC(12스레드)에서만 쟀다. 폰은 재지 않았다.
- Chrome GPU 측정은 화면 없는 모드라 실제 그래픽 카드를 썼는지 확인하지 못했다.
- EmbeddingGemma는 Gemma 이용 약관을 따른다(MIT인 e5와 다르다). 앱에 싣기 전에 약관을 확인해야 한다.
- EmbeddingGemma 2는 그림·소리 인코더까지 같이 받아져 실제로는 505MB를 받았다. 글자만 쓰면 174MB.

## 다시 돌리기
```
cd experiments/semantic-search
npm install --ignore-scripts
node run.mjs onnx-community/embeddinggemma-300m-ONNX q4     # 처음 실행할 때 모델을 Hugging Face에서 받는다 (./models)
node run.mjs Xenova/multilingual-e5-small q8
node browser.mjs Xenova/multilingual-e5-small q8 wasm       # Chrome 안에서 속도 (저장소의 Playwright 사용)
node browser.mjs onnx-community/embeddinggemma-300m-ONNX q4 webgpu
```
