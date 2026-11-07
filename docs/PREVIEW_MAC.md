# OOGAM Preview — Mac 에서 실행하기

대표 PC(Mac)에서 Preview 를 실행해 브라우저로 `https://localhost:8443` 에 접속하는 방법입니다.
인터넷에 공개되지 않으며 비용이 들지 않습니다. 모든 데이터는 가상입니다.

## 1. 준비 (최초 1회, 약 20분)

1. **Docker Desktop** 설치·실행: https://www.docker.com/products/docker-desktop/
   - Apple Silicon(M1~M4) 은 "Mac with Apple chip", Intel 은 "Mac with Intel chip"
   - 실행 후 Settings → Resources → Memory 를 **6GB 이상**으로 설정
2. **터미널** 열기 (Spotlight `⌘ + Space` → "터미널")
3. **Homebrew** 가 없다면 설치: https://brew.sh 의 설치 명령 실행
4. 필요한 도구 설치:
   ```bash
   brew install git node@22 openssl@3 gh
   ```
5. 저장소 내려받기 (GitHub 로그인 필요):
   ```bash
   gh auth login
   ```
   ```bash
   gh repo clone freemilesarea-boop/oogamcorp ~/oogam -- --branch claude/modest-thompson-bgzlmf
   ```

## 2. 실행

```bash
cd ~/oogam
```
```bash
export PATH="$(brew --prefix node@22)/bin:$(brew --prefix openssl@3)/bin:$PATH"
```
```bash
./infra/preview/up.sh
```
- 처음에는 이미지 빌드로 **10~20분** 걸립니다. 마지막에 `[preview] 완료: https://localhost:8443` 이 보이면 성공입니다.
- 접속 정보 확인:
  ```bash
  open -e .preview/credentials.txt
  ```

## 3. 접속

1. **Chrome** 에서 `https://localhost:8443` 접속
2. "연결이 비공개로 설정되어 있지 않습니다" 경고 → **고급 → localhost(안전하지 않음)로 이동**
   (이 PC 에서 만든 자체 인증서라 나오는 경고이며, 접속은 이 PC 안에서만 이뤄집니다)
3. 로그인 팝업 → credentials.txt 의 **1차 접근 인증** 입력
4. `https://localhost:8443/admin/login` → **관리자 이메일·비밀번호** 입력
5. 휴대폰 인증 앱(Google Authenticator 등)으로 QR 스캔 → 6자리 코드 입력 → **복구 코드 10개 보관**

## 4. 중지 · 재시작 · 삭제

| 할 일 | 명령 |
|---|---|
| 중지 (데이터 유지) | `./infra/preview/down.sh` |
| 다시 켜기 (빌드 생략, 1~2분) | `SKIP_BUILD=1 ./infra/preview/up.sh` |
| 최신 코드 반영 | `git pull` 후 `./infra/preview/up.sh` |
| 완전 삭제 (데이터·비밀값 포함) | `./infra/preview/down.sh --purge` |

Docker Desktop 을 종료하거나 Mac 을 재시동한 뒤에는 Docker Desktop 실행 → "다시 켜기" 명령을 실행하세요.

## 5. 문제 해결

| 증상 | 해결 |
|---|---|
| `준비 필요: …` 메시지 | 메시지에 나온 설치 명령 실행 후 다시 시도 |
| `LibreSSL` 관련 안내 | 2단계의 `export PATH=…` 줄을 먼저 실행 |
| 빌드 중 메모리 부족·멈춤 | Docker Desktop 메모리를 6~8GB 로 늘리고 다시 실행 |
| 8443 포트 사용 중 | `PREVIEW_HTTPS_PORT=9443 ./infra/preview/up.sh` 후 `https://localhost:9443` |
| 첫 화면 대신 오류 | 1~2분 기다린 뒤 새로고침 (서비스 기동 중) |
