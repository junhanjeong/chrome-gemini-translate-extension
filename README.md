# web-translate-with-gemini-api

**Gemini API**를 사용하여 내가 원하는 프롬프트를 반영하여 번역하는 **Chrome 확장 프로그램**.  
기본모델: gemini-2.5-flash-lite

## 주요 기능
- 선택 텍스트 번역: 웹페이지에서 드래그하면 즉시 '번역' 버튼 표시
- X(트위터) 번역: X(트위터) 액션 영역에 '번역' 버튼 자동 삽입
- 재번역: 번역 결과 창에서 '재번역'으로 새로운 출력 요청
- Prompt 커스터마이징: 설정 팝업에서 Prompt 수정 가능 (`<TEXT>`, `<LANGUAGE>` 자리표시자 지원)
- 단축키:
	- Cmd+Shift+E / Ctrl+Shift+E: 선택 텍스트 있으면 즉시 번역 실행
	- Cmd+Shift+E / Ctrl+Shift+E: 선택 없고 창이 닫힌 경우 마지막 번역 복원

- 번역 캐시: 같은 문장 재요청시 API 호출 최소화
- 언어 제외 옵션: 특정 언어 X(트위터) 트윗에는 버튼 숨김

## 설치 방법
1. 저장소를 로컬에 clone
2. Chrome 주소창에 `chrome://extensions` 입력
3. 우측 상단 개발자 모드(Developer mode) 활성화
4. '압축해제된 확장 프로그램을 로드(Load unpacked)' 클릭 후 프로젝트 폴더 선택
5. Google AI Studio (https://aistudio.google.com/app/apikey)에서 Gemini API Key 생성
6. 확장 팝업 열어 API Key 입력
7. 필요 시 대상 언어 / 제외 언어 / 커스텀 프롬프트 설정 저장

## 사용 방법
- 트윗 번역: 트윗 하단 '번역' 클릭 → 결과 오버레이 창 표시, 재번역 가능
- 선택 텍스트 즉시 번역: 텍스트 드래그 → '번역' 버튼 클릭 또는 단축키(Cmd/Ctrl+Shift+E)
- 마지막 결과 복원: 번역 창 닫힌 뒤 Cmd/Ctrl+Shift+E
- PDF 번역: PDF 페이지 상단 'PDF 번역' 버튼 → 전체 또는 영역 선택 후 처리
- 영역 캡처: '영역 지정 캡처 & 번역' 또는 PDF 메뉴 내 영역 옵션 사용
- 프롬프트 수정: `<TEXT>`는 원문, `<LANGUAGE>`는 목표 언어로 치환되어 API에 전달


## 에러/실패 시
- API Key 누락, Rate Limit(429), 기타 네트워크 오류 발생 시 경고 표시
- 재번역 버튼으로 새 시도 가능

## 폰트 라이선스
이 프로젝트는 UI 가독성을 위해 `fonts/Vazirmatn[wght].woff2` 웹폰트를 포함합니다.

해당 폰트는 SIL Open Font License 1.1(OFL 1.1)에 따라 배포되며, 전체 라이선스 전문은 `OFL-Vazirmatn.txt` 파일을 참조하십시오.

OFL 1.1 조건 요약(비공식):
- 폰트 자체 단독 판매 금지
- 수정/재배포 허용 (Reserved Font Name 임의 사용 금지)
- 소프트웨어/문서와 번들 가능
- 폰트를 사용해 만든 문서에는 OFL 지속 의무 없음

자세한 법적 효력은 반드시 라이선스 전문을 확인하세요.
