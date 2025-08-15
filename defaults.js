// 기본 번역 프롬프트 (사용자 요청에 따라 Korean 중심, <TEXT> 자리표시자 사용)
// <TEXT> 는 번역할 원문으로 치환되며, <LANGUAGE> 는 선택된 대상 언어로 치환됩니다.
const DEFAULT_TRANSLATION_PROMPT = `번역할 텍스트 원문:\n<TEXT>\n\n번역해줘. 불필요한 말을 추가로 하지 말고 번역한 것만 반환해줘. 한글로 번역할 때, 영어 용어는 번역하지말고 최대한 영어 원어로 작성해줘. 예를 들면 cross attention, DETR, Transformer, Gemini, Claude, Scaling law, Vision Encoder, Positional encoding 등은 그대로 유지해줘. 번역하기 전 원문은 적지말고 번역한 것만 반환해줘.`;

// 이미지 번역도 동일 지침 적용. 필요 시 <TEXT> 전에 이미지에서 추출한 텍스트가 삽입됨.
const DEFAULT_IMAGE_TRANSLATION_PROMPT = `<TEXT>\n\n번역해줘. 불필요한 말을 추가로 하지 말고 번역한 것만 반환해줘. 한글로 번역할 때, 영어 용어는 번역하지말고 최대한 영어 원어로 작성해줘. 예를 들면 cross attention, DETR, Transformer, Gemini, Claude, Scaling law, Vision Encoder, Positional encoding 등은 그대로 유지해줘. 번역하기 전 원문은 적지말고 번역한 것만 반환해줘.`;
