# 루트로그 앱 (안드로이드·iOS)

저장소 루트의 웹앱을 [Capacitor](https://capacitorjs.com)로 감싼 앱이에요. 웹 파일을 앱 안에 담아 실행하고, 서버(Supabase)는 웹과 같은 곳을 써요.

- 앱 ID: `com.mytripatoz.routelog`
- 앱 이름: 루트로그
- 안드로이드 최소 버전 7.0(API 24), iOS 15 이상, iPhone 전용

## 폴더

- `scripts/copy-web.mjs`: 웹앱 파일(index.html, css, js, assets, vendor)을 `www/`로 복사
- `android/`: 안드로이드 스튜디오 프로젝트
- `ios/`: Xcode 프로젝트 (Swift Package Manager 사용, CocoaPods 필요 없음)
- `assets/`: 아이콘·스플래시 원본. 바꾸면 `npm run assets`로 다시 만들어요.

## 웹을 고친 뒤 앱에 반영하기

웹 파일은 앱 안에 들어가기 때문에, 웹을 배포해도 이미 설치된 앱은 바뀌지 않아요. 앱 업데이트를 스토어에 올려야 반영돼요.

```bash
cd mobile
npm ci
npm run sync      # 웹 파일 복사 + 안드로이드·iOS에 반영
npm run android   # 안드로이드 스튜디오 열기
npm run ios       # Xcode 열기 (Mac 필요)
```

## 자동 빌드 (GitHub Actions: Mobile build)

main에 웹이나 앱 파일이 바뀌어 올라가면 자동으로 돌아요. Actions 탭에서 직접 실행할 수도 있어요.

- 안드로이드: `routelog-android` 결과물에 설치용 `app-debug.apk`와 스토어용 `app-release.aab`가 들어 있어요.
- iOS: 시뮬레이터용으로 빌드만 확인해요. 스토어 업로드는 Mac의 Xcode에서 해요.

AAB에 서명하려면 저장소 비밀값을 넣어요.

| 이름 | 값 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 업로드 키 파일(.jks)을 `base64 -i upload.jks` 한 값 |
| `ANDROID_KEYSTORE_PASSWORD` | 키 저장소 비밀번호 |
| `ANDROID_KEY_ALIAS` | 키 별칭 (예: upload) |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

업로드 키 만들기:

```bash
keytool -genkey -v -keystore upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

이 파일과 비밀번호를 잃어버리면 Play Console에서 키 재설정을 요청해야 하니 안전한 곳에 따로 보관하세요. 버전 코드는 빌드 번호로 자동으로 올라가요.
